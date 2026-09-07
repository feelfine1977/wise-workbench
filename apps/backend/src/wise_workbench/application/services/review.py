"""The review: gates, hypotheses, findings, actions and "What can we do?" (R1-12, R1-15, R2-01, R2-02).

Three gates stand between a number and a claim about a group, and they are computed from what the run already
knows rather than asked of the reader:

* **readiness** — the analytics gate on the log as a whole (one window end, drift, replication, exposure);
* **censoring** — the share of the group's cases still open at that window end;
* **replication** — the share of the group's cases carrying copied postings.

A gate is `failed` while its evidence is above the threshold; a hypothesis or an action on that group is refused
with 409 until someone passes or waives the gate with a note. The note is mandatory: a waived gate that says
nothing is not a decision, it is a silence.

"What can we do?" reads the group's top drivers, asks the knowledge hub what usually causes them and what is
usually done about them, and pairs each action with the headroom of its expectation — the score points the group
would gain if that expectation were met.
"""

from __future__ import annotations

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
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

CENSORING_WARN, CENSORING_FAIL = 0.20, 0.40
REPLICATION_WARN, REPLICATION_FAIL = 0.20, 0.50


class ReviewService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- gates
    def gates(self, project_id: str, run_id: str, *, slicing: str, slice_key: str, view: str | None = None) -> dict:
        """The three gates of one group: computed evidence, merged with any decision taken on them."""
        detail = self.c.runs.slice_detail(
            project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, drilldown=None
        )
        row = detail["row"]
        noun = detail["params"].get("case_noun") or "cases"
        shares = {str(cav["id"]): cav.get("share") for cav in detail.get("caveats") or []}
        analytics = self.c.runs.analytics(project_id, run_id)
        readiness_status = str(analytics.get("manifest", {}).get("readinessStatus") or "unknown")
        computed = [
            {
                "id": "readiness",
                "kind": "readiness",
                "status": {"fail": "failed", "warn": "pending", "pass": "passed"}.get(readiness_status, "pending"),
                "evidence": {"readinessStatus": readiness_status},
                "text": (
                    f"The data-readiness gate on this log is {readiness_status}."
                    if readiness_status != "unknown"
                    else "The data-readiness gate has not been computed for this run."
                ),
            },
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
        ]
        stored = {
            str(item.body.get("gate")): item
            for item in self.c.repos.list_review_items(
                project_id, kind=str(ReviewKind.GATE), run_id=run_id, slicing=slicing, slice_key=slice_key
            )
        }
        gates = []
        for gate in computed:
            item = stored.get(gate["id"])
            gates.append(
                {
                    **gate,
                    "computed_status": gate["status"],
                    "status": item.status if item is not None else gate["status"],
                    "note": item.note if item is not None else None,
                    "author": item.author if item is not None else None,
                    "decidedAt": item.updated_at.isoformat() if item is not None else None,
                }
            )
        blocking = [g["id"] for g in gates if g["status"] == "failed"]
        return {
            "runId": run_id,
            "slicing": slicing,
            "sliceKey": slice_key,
            "view": detail["params"].get("view"),
            "caseNoun": noun,
            "cases": row.get("n_cases"),
            "gates": gates,
            "blocking": blocking,
            "passed": not blocking,
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
    ) -> dict[str, Any]:
        status, note = validate_gate_update(status, note)
        current = self.gates(project_id, run_id, slicing=slicing, slice_key=slice_key)
        known = {g["id"] for g in current["gates"]}
        if gate_id not in known:
            raise NotFoundError(f"gate {gate_id!r} is not one of {sorted(known)}", code="gate.not_found")
        existing = [
            item
            for item in self.c.repos.list_review_items(
                project_id, kind=str(ReviewKind.GATE), run_id=run_id, slicing=slicing, slice_key=slice_key
            )
            if item.body.get("gate") == gate_id
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
                    slicing=slicing,
                    slice_key=slice_key,
                    body={"gate": gate_id},
                    author=author,
                    note=note,
                )
            )
        return self.gates(project_id, run_id, slicing=slicing, slice_key=slice_key)

    def _require_gates(self, project_id: str, run_id: str | None, slicing: str | None, slice_key: str | None) -> None:
        """A hypothesis or an action on a group whose gate has failed is refused (409) until it is decided."""
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
        payload = dict(body)
        run_id = payload.pop("runId", None)
        slicing = payload.pop("slicing", None)
        slice_key = payload.pop("sliceKey", None)
        view = payload.pop("view", None)
        author = payload.pop("author", None)
        note = payload.pop("note", None)
        title = str(payload.pop("title", "") or "")
        clean = validate_action(payload)
        self._require_gates(project_id, run_id, slicing, slice_key)
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

    def update(self, project_id: str, item_id: str, body: dict[str, Any]) -> ReviewItem:
        item = self.get(project_id, item_id)
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
        return self.c.repos.list_review_items(
            project_id, kind=kind, run_id=run_id, slicing=slicing, slice_key=slice_key
        )

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
    """The contrast row in one sentence: missed here against elsewhere, and the real-unit shift when there is one."""
    if not row:
        return None
    here, rest = row.get("share_missed_group"), row.get("share_missed_elsewhere")
    name = row.get("plain") or row.get("description") or row.get("constraint")
    if here is None or rest is None:
        return None
    text = f"{name}: missed in {float(here) * 100:.0f} % of these {noun} against {float(rest) * 100:.0f} % elsewhere"
    shift, unit = row.get("shift"), row.get("unit")
    if shift is not None and unit:
        text += f" ({float(shift):+.1f} {unit})"
    return text + "."


def _rows(table: dict[str, Any]) -> list[dict[str, Any]]:
    columns = list(table.get("columns") or [])
    return [dict(zip(columns, row)) for row in (table.get("rows") or [])]
