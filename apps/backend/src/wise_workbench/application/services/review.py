"""The review: gates, hypotheses, findings, actions and "What can we do?" (R1-12, R1-15, R2-01, R2-02).

Three gates stand between a number and a claim about a group, and they are computed from what the run already
knows rather than asked of the reader:

* **readiness** — the analytics gate, read per group: the five of its checks that have a share for a single
  group (censoring, replication, duplicates, sentinel stamps, window edge) decide whether *this* group passes,
  and the checks that are properties of the whole log (drift, precision, exposure scale) are stated and decided
  once, at the run, under ``runWide`` (R3-03);
* **censoring** — the share of the group's cases still open at that window end;
* **replication** — the share of the group's cases carrying copied postings.

A gate is `failed` while its evidence is above the threshold. Action proposals remain recordable;
agreement or execution requires every gate for the saved context to pass or be waived with a note.
Hypotheses retain their separate validation path.

"What can we do?" reads the group's top drivers, asks the knowledge hub what usually causes them and what is
usually done about them, and pairs each action with the headroom of its expectation — the score points the group
would gain if that expectation were met.
"""

from __future__ import annotations

import json
from contextlib import suppress
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import (
    ConflictError,
    NotFoundError,
    ReviewItem,
    ReviewKind,
    ValidationError,
    validate_action,
    validate_gate_update,
    validate_hypothesis,
)
from wise_workbench.domain.comparison import Comparison, capitalised, percent, readable_comparison
from wise_workbench.domain.project import utcnow
from wise_workbench.ids import new_id

from . import action_evidence

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

CENSORING_WARN, CENSORING_FAIL = 0.20, 0.40
REPLICATION_WARN, REPLICATION_FAIL = 0.20, 0.50
_CHECK_WORDS = {
    "censoring": "still open at the end of the data",
    "replication": "carrying copied postings",
    "duplicates": "duplicating an earlier event",
    "sentinel_dates": "carrying a placeholder timestamp",
    "window_edge": "activated within the last window of the data",
}
_LOG_WIDE_WORDS = {
    "duplicate_events": "duplicate events",
    "frequency_drift": "a change in how often activities occur",
    "vocabulary_drift": "a change in the activity labels",
    "logging_asymmetry": "one side of an event pair missing",
    "timestamp_precision": "mixed timestamp precision",
    "timestamp_concentration": "events piled on one timestamp",
    "exposure_sanity": "exposure values on different scales",
    "sentinel_dates": "placeholder timestamps",
    "right_censoring": "items still open at the end of the data",
    "replication": "copied postings",
    "window_edge_share": "items activated at the window edge",
}


def _run_wide_text(report: dict[str, Any]) -> str:
    """What the readiness gate says once, at the run: the checks that are true of every group at once."""
    status = str(report.get("status") or "unknown")
    if status == "unknown":
        return "The data-readiness gate has not been computed for this run."
    log_wide = [str(c) for c in (report.get("logWideFailed") or [])]
    if not log_wide:
        return f"The data-readiness gate on this log reads {status}; every failed check has a share per group."
    words = ", ".join(_LOG_WIDE_WORDS.get(c, c.replace("_", " ")) for c in log_wide)
    return (
        f"The data-readiness gate on this log reads {status}. {len(log_wide)} of its failed checks are properties "
        f"of the whole log and are the same for every group ({words}); they are decided once, here."
    )


class ReviewService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- gates
    def gates(
        self,
        project_id: str,
        run_id: str,
        *,
        slicing: str,
        slice_key: str,
        view: str | None = None,
        filter_value: Any = None,
    ) -> dict:
        """The three gates of one group: computed evidence, merged with any decision taken on them.

        The readiness gate is **group-aware** (R3-03). Its evidence is a table of checks on the log, and five of
        them — censoring, replication, duplicates, sentinel stamps, the window edge — have a share for every
        group. The gate a group must pass is read from *its own* shares; the checks that are properties of the
        whole log (drift, precision, exposure scale) are stated once, at the run, under ``runWide``, where they
        are also decided once. A gate that reads ``fail`` identically on all 57 groups of a log is a door, not a
        gate, and blocks nothing by itself.
        """
        filter_obj = action_evidence.canonical_filter(filter_value)
        detail = (
            self.c.runs.review_selection(
                project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, filter_obj=filter_obj
            )
            if filter_obj
            else self.c.runs.slice_detail(
                project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, drilldown=None
            )
        )
        slice_key = json.dumps(detail["params"]["key"], separators=(",", ":"))
        resolved_view = detail["params"].get("view")
        _run, _ctx, evidence_identity = action_evidence.run_identity(self.c, project_id, run_id)
        slicing = _ctx.slicing_id(detail["params"]["slicing"], detail["params"].get("bands")) or ",".join(
            detail["params"]["slicing"]
        )
        row = detail["row"]
        noun = detail["params"].get("case_noun") or "cases"
        caveats = list(detail.get("caveats") or [])
        shares = {str(cav["id"]): cav.get("share") for cav in caveats}
        report = detail["readiness"] if filter_obj else self.c.runs.readiness_report(project_id, run_id)
        measured = bool((detail.get("analytics") or {}).get("available")) and bool(report.get("checks"))
        computed = [
            self._readiness_gate(report, caveats, noun, row, measured=measured),
            self._share_gate(
                "censoring",
                shares.get("censoring"),
                CENSORING_WARN,
                CENSORING_FAIL,
                f"still open at the end of the data: late closure cannot be judged for those {noun}",
                noun,
            ),
            self._share_gate(
                "replication",
                shares.get("replication"),
                REPLICATION_WARN,
                REPLICATION_FAIL,
                f"carrying copied postings: counts on those {noun} are inflated",
                noun,
            ),
            self._domain_gate(project_id, run_id, detail, noun),
        ]
        if filter_obj:
            # No display-threshold suppression: zero is measured, absence is unknown.
            expected = set(action_evidence.FILTERED_CHECKS)
            missing = sorted(expected - {k for k, value in shares.items() if value is not None})
            if missing:
                computed[0] = {
                    "id": "readiness",
                    "kind": "readiness",
                    "scope": "group",
                    "status": "failed" if computed[0]["status"] == "failed" else "pending",
                    "evidence": {"missingMeasurements": missing, "groupChecks": caveats},
                    "text": "Readiness for this selection is incomplete. Review the missing measurements before acting.",
                }
            for gate in computed[1:3]:
                if shares.get(gate["id"]) is None:
                    gate.update(
                        status="pending", scope="group", text="This measurement is unavailable for the selected items."
                    )
            computed[0]["scope"] = "group"
        # A clean group's checks cannot erase independent failures of the whole log.
        whole_checks = [check for check in report.get("checks", []) if not check.get("perGroup")]
        whole_failed = list(report.get("logWideFailed") or [])
        if computed[0].get("scope") == "group" and (whole_checks or whole_failed):
            failed = whole_failed or [str(check["check"]) for check in whole_checks if check.get("status") == "fail"]
            pending = [str(check["check"]) for check in whole_checks if check.get("status") not in {"pass", "fail"}]
            computed.append(
                {
                    "id": "run_readiness",
                    "kind": "readiness",
                    "scope": "run",
                    "status": "failed" if failed else "pending" if pending else "passed",
                    "evidence": {"failed": failed, "pending": pending, "checks": whole_checks},
                    "text": "Readiness checks for the whole log require a decision once for this run."
                    if failed or pending
                    else "Readiness checks for the whole log pass.",
                }
            )
        selection = dict(detail.get("selection") or {})
        decision_identity = (
            action_evidence.fingerprint(
                {
                    "filter": filter_obj,
                    "selection": selection,
                    "gates": [g for g in computed if g.get("scope") != "run"],
                }
            )
            if filter_obj
            else None
        )
        if selection:
            selection["decisionFingerprint"] = decision_identity
        group_items = self.c.repos.list_review_items(
            project_id, kind=str(ReviewKind.GATE), run_id=run_id, slicing=slicing, slice_key=slice_key
        )
        stored = {
            str(item.body.get("gate")): item
            for item in group_items
            if item.view == resolved_view
            and item.body.get("manifestFingerprint") == evidence_identity
            and item.body.get("selectionFingerprint") == decision_identity
        }
        # the readiness gate is decided once for the run, so a waiver on it is stored without a group
        run_scoped = {
            str(item.body.get("gate")): item
            for item in self.c.repos.list_review_items(project_id, kind=str(ReviewKind.GATE), run_id=run_id)
            if item.slice_key is None and item.body.get("manifestFingerprint") == evidence_identity
        }
        gates = []
        for gate in computed:
            scope = str(gate.get("scope") or "group")
            item = run_scoped.get(gate["id"]) if scope == "run" else stored.get(gate["id"])
            gates.append(
                {
                    **gate,
                    "computed_status": gate["status"],
                    "status": item.status if item is not None else gate["status"],
                    "note": item.note if item is not None else None,
                    "author": item.author if item is not None else None,
                    "decidedAt": item.updated_at.isoformat() if item is not None else None,
                    "scope": scope,
                }
            )
        blocking = [
            g["id"]
            for g in gates
            if (g["status"] not in {"passed", "waived"} if filter_obj else g["status"] == "failed")
        ]
        return {
            "runId": run_id,
            "slicing": slicing,
            "sliceKey": slice_key,
            "view": detail["params"].get("view"),
            "caseNoun": noun,
            "cases": row.get("n_cases"),
            "filter": filter_obj,
            "selection": selection or None,
            "gates": gates,
            "blocking": blocking,
            "passed": not blocking,
            "runWide": {
                "status": report.get("status", "unknown"),
                "failed": list(report.get("failed") or []),
                "warned": list(report.get("warned") or []),
                "logWideFailed": list(report.get("logWideFailed") or []),
                "checks": list(report.get("checks") or []),
                "text": _run_wide_text(report),
            },
        }

    def _readiness_gate(
        self,
        report: dict[str, Any],
        caveats: list[dict[str, Any]],
        noun: str,
        row: dict[str, Any],
        *,
        measured: bool = False,
    ) -> dict[str, Any]:
        """The readiness gate of one group: the worst of the checks the group has its own share of.

        ``measured`` says the shares were computed for this group. A group with no caveat of its own is then a
        group whose every share is small enough not to be worth showing — that is a pass, not an unknown, and it
        is the difference between a gate and a door: the leading customer of a log whose censoring fails overall
        may itself have almost nothing open.
        """
        by_kind = {str(c.get("id")): c for c in caveats}
        checks = [c for c in (report.get("checks") or []) if c.get("perGroup")]
        if not checks and report.get("status", "unknown") == "unknown":
            return {
                "id": "readiness",
                "kind": "readiness",
                "status": "pending",
                "evidence": {"runStatus": "unknown"},
                "text": "The data-readiness gate has not been computed for this run.",
            }
        own: list[dict[str, Any]] = []
        for check in checks:
            caveat = by_kind.get(str(check["perGroup"]))
            if caveat is None or caveat.get("share") is None:
                continue
            own.append(
                {
                    "check": check["check"],
                    "caveat": check["perGroup"],
                    "share": float(caveat["share"]),
                    "status": str(caveat.get("status") or "pass"),
                    "text": caveat.get("text"),
                }
            )
        failing = [e for e in own if e["status"] == "fail"]
        warning = [e for e in own if e["status"] == "warn"]
        cases = row.get("n_cases")
        who = f"these {int(cases):,} {noun}" if isinstance(cases, int | float) and cases else f"these {noun}"
        log_wide = [str(c) for c in (report.get("logWideFailed") or [])]
        beside = ""
        if str(report.get("status")) in ("fail", "warn"):
            beside = f" The log as a whole reads {report.get('status')}" + (
                # a count says its own plural: the gate sentence read "on 1 check(s)" (P1-13)
                f", on {len(log_wide)} check{'' if len(log_wide) == 1 else 's'} no group can be judged on."
                if log_wide
                else " on its own checks."
            )
        evidence = {
            "runStatus": report.get("status", "unknown"),
            "runFailed": list(report.get("failed") or []),
            "logWideFailed": log_wide,
            "groupChecks": own,
        }
        if not own and measured:
            return {
                "id": "readiness",
                "kind": "readiness",
                "status": "passed",
                "scope": "group",
                "evidence": evidence,
                "text": (
                    f"Every readiness check with a share of its own is below the reporting threshold for {who}.{beside}"
                ),
            }
        if not own:
            # nothing about this group separates it from the rest: the gate is the log's, and decided once
            return {
                "id": "readiness",
                "kind": "readiness",
                "status": {"fail": "failed", "warn": "pending", "pass": "passed"}.get(
                    str(report.get("status")), "pending"
                ),
                "scope": "run",
                "evidence": evidence,
                "text": (
                    f"No readiness check has a share of its own for {who}, so this gate is the log's and is "
                    f"decided once for the run: it reads {report.get('status', 'unknown')}."
                ),
            }
        words = "; ".join(
            f"{e['share'] * 100:.0f} % {_CHECK_WORDS.get(e['caveat'], e['caveat'])}" for e in (failing or warning)
        )
        if failing:
            worst, text = "fail", f"Readiness on this group: {words} among {who}.{beside}"
        elif warning:
            worst, text = (
                "warn",
                f"Readiness on this group: nothing fails, and {words} among {who} is close to the limit.{beside}",
            )
        else:
            worst, text = "pass", f"Every readiness check with a share of its own is clean for {who}.{beside}"
        return {
            "id": "readiness",
            "kind": "readiness",
            "status": {"fail": "failed", "warn": "pending", "pass": "passed"}[worst],
            "scope": "group",
            "evidence": evidence,
            "text": text,
        }

    def _domain_gate(self, project_id: str, run_id: str, detail: dict[str, Any], noun: str) -> dict[str, Any]:
        """Does the norm say anything about this group? (R3-27, the fourth gate of the vocabulary.)

        A claim about a group rests on the expectations that carry its shortfall. When the first of those is
        flagged — a placeholder threshold that every group misses, or an expectation whose shortfall counts
        missing events rather than measured values — the number is about the norm or about the logging, not
        about the group, and the claim is not yet in the domain the norm covers. The gate fails on the leading
        driver and warns when a flagged expectation is further down the list.
        """
        flagged = {str(r["id"]): r for r in self.c.runs.uncalibrated_flags(project_id, run_id)}
        drivers = [str(r.get("constraint") or "") for r in _rows(detail.get("drivers") or {}) if r.get("constraint")]
        if not drivers:
            return {
                "id": "domain",
                "kind": "domain",
                "status": "pending",
                "scope": "group",
                "evidence": {"drivers": [], "flagged": sorted(flagged)},
                "text": f"No expectation carries a share of the shortfall of these {noun} yet.",
            }
        hits = [(cid, flagged[cid]) for cid in drivers[:3] if cid in flagged]
        if not hits:
            return {
                "id": "domain",
                "kind": "domain",
                "status": "passed",
                "scope": "group",
                "evidence": {"drivers": drivers[:3], "flagged": []},
                "text": (
                    f"The expectations carrying the shortfall of these {noun} are calibrated and measure what "
                    "they name."
                ),
            }
        leading = drivers[0] in flagged
        first = hits[0][1]
        return {
            "id": "domain",
            "kind": "domain",
            "status": "failed" if leading else "pending",
            "scope": "group",
            "evidence": {
                "drivers": drivers[:3],
                "flagged": [cid for cid, _ in hits],
                "reasons": {cid: row.get("reason") for cid, row in hits},
            },
            "text": (
                ("The expectation this group's shortfall rests on is flagged: " if leading else "A flagged ")
                + ("" if leading else "expectation is among the three carrying this group's shortfall: ")
                + str(first.get("text") or first.get("id"))
            ),
        }

    def _share_gate(self, kind: str, share: Any, warn: float, fail: float, what: str, noun: str) -> dict[str, Any]:
        if share is None:
            return {
                "id": kind,
                "kind": kind,
                "status": "passed",
                "evidence": {"share": None},
                "text": f"No {kind} caveat on this group.",
            }
        value = float(share)
        status = "failed" if value >= fail else "pending" if value >= warn else "passed"
        return {
            "id": kind,
            "kind": kind,
            "status": status,
            "evidence": {"share": value, "warnAt": warn, "failAt": fail},
            "text": f"{value * 100:.0f} % of these {noun} are {what}.",
        }

    def set_gate(
        self,
        project_id: str,
        run_id: str,
        gate_id: str,
        *,
        slicing: str,
        slice_key: str,
        status: str,
        note: str | None,
        author: str | None = None,
        view: str | None = None,
        filter_value: Any = None,
    ) -> dict[str, Any]:
        status, note = validate_gate_update(status, note)
        current = self.gates(
            project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, filter_value=filter_value
        )
        decision_identity = (current.get("selection") or {}).get("decisionFingerprint")
        slicing, slice_key, view = current["slicing"], current["sliceKey"], current["view"]
        _run, _ctx, evidence_identity = action_evidence.run_identity(self.c, project_id, run_id)
        scopes = {str(g["id"]): str(g.get("scope") or "group") for g in current["gates"]}
        if gate_id not in scopes:
            raise NotFoundError(f"gate {gate_id!r} is not one of {sorted(scopes)}", code="gate.not_found")
        # a gate whose evidence is the log's, not the group's, is decided once for the whole run (R3-03)
        run_scoped = scopes[gate_id] == "run"
        stored_slicing = None if run_scoped else slicing
        stored_key = None if run_scoped else slice_key
        existing = [
            item
            for item in self.c.repos.list_review_items(
                project_id, kind=str(ReviewKind.GATE), run_id=run_id, slicing=stored_slicing, slice_key=stored_key
            )
            if item.body.get("gate") == gate_id
            and (not run_scoped or item.slice_key is None)
            and item.body.get("manifestFingerprint") == evidence_identity
            and (run_scoped or item.view == view)
            and (run_scoped or item.body.get("selectionFingerprint") == decision_identity)
        ]
        if existing:
            self.c.repos.update_review_item(
                existing[0].with_changes(status=status, note=note, author=author or existing[0].author)
            )
        else:
            self.c.repos.add_review_item(
                ReviewItem(
                    id=new_id("gate"),
                    project_id=project_id,
                    kind=ReviewKind.GATE,
                    status=status,
                    title=f"{gate_id} gate",
                    run_id=run_id,
                    slicing=stored_slicing,
                    slice_key=stored_key,
                    body={
                        "gate": gate_id,
                        "scope": "run" if run_scoped else "group",
                        "manifestFingerprint": evidence_identity,
                        "filter": None if run_scoped else current.get("filter"),
                        "selectionFingerprint": None if run_scoped else decision_identity,
                    },
                    view=None if run_scoped else view,
                    author=author,
                    note=note,
                )
            )
        return self.gates(
            project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, filter_value=filter_value
        )

    def _require_gates(self, project_id: str, run_id: str | None, slicing: str | None, slice_key: str | None) -> None:
        """Legacy hypothesis policy; action writes use the complete commitment check below."""
        if not (run_id and slicing and slice_key):
            return
        try:
            state = self.gates(project_id, run_id, slicing=slicing, slice_key=slice_key)
        except (NotFoundError, ConflictError, ValidationError):
            return
        if state["blocking"]:
            raise ConflictError(
                "the "
                + ", ".join(state["blocking"])
                + " gate has failed for this group; pass or waive it with a note first",
                code="review.gate_failed",
                errors=[{"field": "gate", "message": g} for g in state["blocking"]],
            )

    # ------------------------------------------------------------- hypotheses
    def create_hypothesis(self, project_id: str, body: dict[str, Any]) -> ReviewItem:
        self.c.repos.get_project(project_id)
        payload = dict(body)
        run_id = payload.pop("runId", None) or payload.pop("run_id", None)
        slicing = payload.pop("slicing", None)
        slice_key = payload.pop("sliceKey", None) or payload.pop("key", None)
        view = payload.pop("view", None)
        author = payload.pop("author", None)
        note = payload.pop("note", None)
        title = str(payload.pop("statement_plain", "") or payload.pop("title", "") or "")
        clean = validate_hypothesis(payload)
        self._require_gates(project_id, run_id, slicing, slice_key)
        clean["test"] = self._hypothesis_test(project_id, run_id, slicing, slice_key, view, clean)
        clean["statement_plain"] = title or self._statement(clean)
        item = ReviewItem(
            id=new_id("hyp"),
            project_id=project_id,
            kind=ReviewKind.HYPOTHESIS,
            status=str(clean["outcome"]),
            title=clean["statement_plain"],
            run_id=run_id,
            slicing=slicing,
            slice_key=slice_key,
            view=view,
            body=clean,
            author=author,
            note=note,
        )
        return self.c.repos.add_review_item(item)

    def _statement(self, body: dict[str, Any]) -> str:
        direction = {"higher": "misses it more often", "lower": "misses it less often", "none": "is no different"}[
            str(body["expected_direction"])
        ]
        return f"This group {direction} on {body['constraint_id']} than the rest."

    def _hypothesis_test(
        self,
        project_id: str,
        run_id: str | None,
        slicing: str | None,
        slice_key: str | None,
        view: str | None,
        body: dict[str, Any],
    ) -> dict[str, Any] | None:
        """The contrast row of the named expectation: risk difference with its interval and the real-unit shift."""
        if not (run_id and slicing and slice_key):
            return None
        try:
            detail = self.c.runs.slice_detail(
                project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, drilldown=None
            )
        except (NotFoundError, ConflictError, ValidationError):
            return None
        contrast = detail.get("contrast") or {}
        columns = list(contrast.get("columns") or [])
        if not columns:
            return None
        wanted = str(body["constraint_id"])
        for raw in contrast.get("rows") or []:
            row = dict(zip(columns, raw))
            if str(row.get("constraint")) != wanted:
                continue
            return {
                "constraint_id": wanted,
                "plain_name": row.get("plain"),
                "risk_difference": row.get("risk_difference"),
                "interval": [row.get("rd_lo"), row.get("rd_hi")],
                "interval_method": "bootstrap percentile (analytics)",
                "share_here": row.get("share_missed_group"),
                "share_elsewhere": row.get("share_missed_elsewhere"),
                "median_here": row.get("median_group"),
                "median_elsewhere": row.get("median_elsewhere"),
                "shift": row.get("shift"),
                "unit": row.get("unit"),
                "n_group": row.get("n_evaluated_group") or detail["row"].get("n_cases"),
                "n_rest": row.get("n_evaluated_elsewhere"),
                "share_of_shortfall": row.get("share_of_shortfall"),
                "reading": _comparison_line(row, detail["params"].get("case_noun") or "cases"),
                "median_reading": _median_line(row, detail["params"].get("case_noun") or "cases"),
                "measures_logging": self.c.runs.measures_logging(project_id, run_id).get(wanted) if run_id else None,
            }
        return None

    # ------------------------------------------------------------- findings and actions
    def create_finding(self, project_id: str, body: dict[str, Any]) -> ReviewItem:
        self.c.repos.get_project(project_id)
        payload = dict(body)
        item = ReviewItem(
            id=new_id("find"),
            project_id=project_id,
            kind=ReviewKind.FINDING,
            status=str(payload.pop("status", "open")),
            title=str(payload.pop("title", "") or ""),
            run_id=payload.pop("runId", None),
            slicing=payload.pop("slicing", None),
            slice_key=payload.pop("sliceKey", None),
            view=payload.pop("view", None),
            author=payload.pop("author", None),
            note=payload.pop("note", None),
            body=payload,
        )
        return self.c.repos.add_review_item(item)

    def create_action(self, project_id: str, body: dict[str, Any]) -> ReviewItem:
        self.c.repos.get_project(project_id)
        action_evidence.protected_fields(body)
        payload = dict(body)
        run_id = payload.pop("runId", None)
        slicing = payload.pop("slicing", None)
        slice_key = payload.pop("sliceKey", None)
        view = payload.pop("view", None)
        author = payload.pop("author", None)
        note = payload.pop("note", None)
        title = str(payload.pop("title", "") or "")
        filter_value = payload.pop("filter", None)
        clean = validate_action(payload)
        context = action_evidence.capture(self.c, project_id, run_id, slicing, slice_key, view, filter_value)
        clean["evidenceContext"] = context
        clean["evidenceState"] = "recorded" if context else "unassessed"
        if context:
            run_id, slicing, slice_key, view = (context[k] for k in ("runId", "slicing", "sliceKey", "view"))
        if clean["status"] in action_evidence.COMMITTED_STATUSES:
            clean["commitmentCheck"] = self._require_action_commitment(project_id, clean)
        item = ReviewItem(
            id=new_id("act"),
            project_id=project_id,
            kind=ReviewKind.ACTION,
            status=str(clean["status"]),
            title=title,
            run_id=run_id,
            slicing=slicing,
            slice_key=slice_key,
            view=view,
            body=clean,
            author=author,
            note=note,
        )
        return self.c.repos.add_review_item(item)

    def _require_action_commitment(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Every commitment write uses the same saved context and current gate decisions."""
        context = body.get("evidenceContext")
        action_evidence.require_current(self.c, project_id, context)
        assert context is not None
        if not isinstance(body.get("owner_role"), str) or not body["owner_role"].strip():
            raise ConflictError(
                "Name the owner role before agreeing or starting this action.",
                code="review.owner_required",
                errors=[{"field": "owner_role", "message": "Required"}],
            )
        try:
            state = self.gates(
                project_id,
                context["runId"],
                slicing=context["slicing"],
                slice_key=context["sliceKey"],
                view=context["view"],
                filter_value=context.get("filter"),
            )
        except (NotFoundError, ConflictError, ValidationError) as exc:
            raise ConflictError(
                "The saved group's readiness cannot be checked. Keep this action proposed and retry when its evidence is available.",
                code="review.evidence_unavailable",
            ) from exc
        blocking = [g["id"] for g in state["gates"] if g["status"] not in {"passed", "waived"}]
        if blocking:
            raise ConflictError(
                "Resolve or explicitly waive the "
                + ", ".join(blocking)
                + " checks for this saved group before agreeing or starting work.",
                code="review.gate_unresolved",
                errors=[{"field": "gate", "message": g} for g in blocking],
            )
        return {
            "checkedAt": utcnow().isoformat(),
            "contextFingerprint": action_evidence.fingerprint(context),
            "gates": state["gates"],
        }

    def update(self, project_id: str, item_id: str, body: dict[str, Any]) -> ReviewItem:
        item = self.get(project_id, item_id)
        if item.kind == ReviewKind.GATE:
            raise ValidationError(
                "Use the gate decision control to record a scoped decision with its rationale.",
                code="gate.decision_required",
            )
        if item.kind == ReviewKind.ACTION:
            action_evidence.protected_fields(body, update=True)
        payload = dict(body)
        status = payload.pop("status", None)
        title = payload.pop("title", None)
        note = payload.pop("note", None)
        merged = {**item.body, **payload}
        if item.kind == ReviewKind.HYPOTHESIS:
            if status is not None:
                merged["outcome"] = status
            merged = validate_hypothesis(merged)
            status = merged["outcome"]
        elif item.kind == ReviewKind.ACTION:
            if status is not None:
                merged["status"] = status
            merged = validate_action(merged)
            status = merged["status"]
            if status in action_evidence.COMMITTED_STATUSES and set(body) - {"note"}:
                merged["commitmentCheck"] = self._require_action_commitment(project_id, merged)
        return self.c.repos.update_review_item(
            item.with_changes(
                status=str(status if status is not None else item.status),
                title=str(title) if title is not None else item.title,
                note=note if note is not None else item.note,
                body=merged,
            )
        )

    def get(self, project_id: str, item_id: str) -> ReviewItem:
        item = self.c.repos.get_review_item(item_id)
        if item.project_id != project_id:
            raise NotFoundError(f"review item {item_id!r} not found in project {project_id!r}", code="review.not_found")
        return item

    def list(
        self,
        project_id: str,
        kind: str,
        *,
        run_id: str | None = None,
        slicing: str | None = None,
        slice_key: str | None = None,
    ) -> list[ReviewItem]:
        self.c.repos.get_project(project_id)
        items = self.c.repos.list_review_items(project_id, kind=kind, run_id=run_id)
        ctx = None
        if run_id and slicing:
            # Historical records remain readable after their run is unavailable.
            with suppress(NotFoundError, ConflictError, ValidationError):
                _run, ctx = self.c.runs.ready(project_id, run_id)

        def grouping(value: str | None) -> Any:
            if ctx and value:
                return (ctx.slicing_attributes(value), ctx.slicing_bands(value))
            return value

        def key(value: str | None) -> Any:
            if value is None:
                return None
            try:
                return json.loads(value)
            except (TypeError, ValueError):
                return value

        return [
            item
            for item in items
            if (slicing is None or grouping(item.slicing) == grouping(slicing))
            and (slice_key is None or key(item.slice_key) == key(slice_key))
        ]

    def delete(self, project_id: str, item_id: str) -> None:
        self.get(project_id, item_id)
        self.c.repos.delete_review_item(item_id)

    # ------------------------------------------------------------- "What can we do?" (R2-01)
    def what_can_we_do(
        self, project_id: str, run_id: str, *, slicing: str, slice_key: str, view: str | None = None, top: int = 3
    ) -> dict[str, Any]:
        """For the group's top expectations: the failure mode, the usual reasons with what to check in the log and
        whom to ask outside it, and the usual actions with a countermeasure type, an owner role and the headroom."""
        detail = self.c.runs.slice_detail(
            project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, drilldown=None
        )
        noun = detail["params"].get("case_noun") or "cases"
        headroom = _rows(detail.get("headroom") or {})
        gain_by_constraint = {
            str(r.get("constraint") or r.get("layer")): r for r in headroom if r.get("constraint") or r.get("layer")
        }
        drivers = _rows(detail.get("drivers") or {})
        logging_sentences = self.c.runs.measures_logging(project_id, run_id)
        contrast = {str(r.get("constraint")): r for r in _rows(detail.get("contrast") or {})}
        entries: list[dict[str, Any]] = []
        for driver in drivers[:top]:
            cid = str(driver.get("constraint") or driver.get("index") or "")
            if not cid:
                continue
            guidance = None
            try:
                guidance = self.c.knowledge.guidance(project_id, "constraint", cid)
            except NotFoundError:
                guidance = None
            block = (guidance or {}).get("generic") or {}
            overlay = (guidance or {}).get("overlay") or {}
            gain = gain_by_constraint.get(cid) or {}
            entries.append(
                {
                    "constraint_id": cid,
                    "plain_name": overlay.get("plain_name") or block.get("plain_name"),
                    "hub_node": (guidance or {}).get("hub_node"),
                    "share_of_shortfall": driver.get("share_of_shortfall"),
                    "comparison": _comparison_line(contrast.get(cid) or {}, noun),
                    "median_comparison": _median_line(contrast.get(cid) or {}, noun),
                    "measures_logging": logging_sentences.get(cid),
                    "headroom_points": gain.get("gain_points"),
                    "headroom_percent": gain.get("gain_percent"),
                    "meaning_when_missed": block.get("meaning_when_missed"),
                    "why_it_matters": block.get("why_it_matters"),
                    "what_to_check_first": list(block.get("what_to_check_first") or []),
                    "usual_reasons": [
                        {
                            "text": r.get("text"),
                            "where": r.get("where"),
                            "check": r.get("check"),
                            "reading": (
                                f"in the log: {r.get('check')}"
                                if str(r.get("where")) == "log"
                                else f"outside the log: {r.get('check')}"
                            ),
                        }
                        for r in (overlay.get("usual_reasons") or block.get("usual_reasons") or [])
                    ],
                    "usual_actions": [
                        {
                            "text": a.get("text"),
                            "countermeasure": a.get("countermeasure"),
                            "owner_role": a.get("owner_role"),
                            "effect_area": a.get("effect_area"),
                        }
                        for a in (overlay.get("usual_actions") or block.get("usual_actions") or [])
                    ],
                    "kpis": list(block.get("kpis") or []),
                    "note": overlay.get("note"),
                }
            )
        gates = self.gates(project_id, run_id, slicing=slicing, slice_key=slice_key, view=view)
        saved = self.list(project_id, str(ReviewKind.ACTION), run_id=run_id, slicing=slicing, slice_key=slice_key)
        return {
            "runId": run_id,
            "slicing": slicing,
            "sliceKey": slice_key,
            "view": detail["params"].get("view"),
            "caseNoun": noun,
            "reading": detail.get("reading_plain"),
            "drivers": entries,
            "gates": gates["gates"],
            "blocking": gates["blocking"],
            "actions": [a.to_dict() for a in saved],
            "guidanceAvailable": any(e["usual_actions"] for e in entries),
        }


def _comparison_line(row: dict[str, Any], noun: str) -> str | None:
    """The contrast row in one sentence: missed here against elsewhere, with the difference of those two shares.

    One comparison, one bracket (R3-04): the bracket is the difference of the two numbers this sentence prints,
    in percentage points. The real-unit medians are a second comparison and get their own sentence
    (:func:`_median_line`); the analytics package's shift estimate is neither, and stays a labelled column of the
    contrast table.
    """
    if not row:
        return None
    here, rest = row.get("share_missed_group"), row.get("share_missed_elsewhere")
    name = row.get("plain") or row.get("description") or row.get("constraint")
    if here is None or rest is None:
        return None
    sentence = readable_comparison(
        Comparison(kind="rate", name=str(name), rate_slice=float(here), rate_rest=float(rest)),
        items=noun,
    )
    if sentence.kind == "none":
        return f"{name}: missed in {percent(float(here))} of these {noun}, the same share as elsewhere."
    return capitalised(sentence.text)


def _median_line(row: dict[str, Any], noun: str) -> str | None:
    """The real-unit half of a contrast row: the two medians and the difference of the two printed numbers."""
    if not row:
        return None
    here, rest = row.get("median_group"), row.get("median_elsewhere")
    unit = row.get("unit")
    if here is None or rest is None or not unit:
        return None
    name = row.get("plain") or row.get("description") or row.get("constraint")
    sentence = readable_comparison(
        Comparison(
            kind="lag", name=f"{name} (median)", value_slice=float(here), value_rest=float(rest), unit=str(unit)
        ),
        items=noun,
    )
    return None if sentence.kind == "none" else capitalised(sentence.text)


def _rows(table: dict[str, Any]) -> list[dict[str, Any]]:
    columns = list(table.get("columns") or [])
    return [dict(zip(columns, row)) for row in (table.get("rows") or [])]
