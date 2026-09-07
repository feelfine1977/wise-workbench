"""What-if scenarios against a frozen baseline run (R3-27, R1-11).

A scenario is a run like any other, with three things added: the id of the run it is compared against, the
transform layer applied to the log before scoring, and a name a person recognises. Because it is a run it keeps
every guarantee a run has — its own artefacts, its own manifest with fingerprints, its own analytics — and every
screen that reads a run reads it too.

The baseline is **frozen**: the scenario names the run it is compared against, and that run's artefacts are read
as they were written. Nothing in a scenario touches the baseline; a scenario that changes the norm creates a new
norm version with its own fingerprint, parented on the baseline's, so the two scores can always be told apart.

The change table is the answer: per group of one slicing and view, the baseline's and the scenario's cases,
mean score and priority, the difference of each, and the movement in rank — with the groups that entered and
left, and the agreement of the two orders.
"""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.engine.transforms import apply_norm_changes, validate_transform
from wise_workbench.domain import (
    ConflictError,
    JobKind,
    RunParams,
    RunStatus,
    Slicing,
    ValidationError,
)

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

SCENARIO_FILE = "whatif.json"


class WhatIfService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- creating a scenario
    def enqueue(self, project_id: str, baseline_run_id: str, body: dict[str, Any]) -> Any:
        """Validate the scenario and queue its job; the job builds the norm version, the run and the answer."""
        baseline = self.c.runs.get(project_id, baseline_run_id)
        if baseline.status != RunStatus.DONE:
            raise ConflictError(
                f"the baseline run is {baseline.status}; a scenario needs a finished run to compare with",
                code="whatif.baseline_not_ready",
            )
        if not str(body.get("name") or "").strip():
            raise ValidationError("a scenario needs a name a person recognises", code="whatif.name")
        if not (body.get("transforms") or body.get("norm")):
            raise ValidationError(
                "a scenario changes the log, the norm, or both; this one changes nothing", code="whatif.empty"
            )
        for spec in body.get("transforms") or []:
            validate_transform(dict(spec))
        return self.c.queue.enqueue(
            str(JobKind.WHATIF),
            {"projectId": project_id, "baselineRunId": baseline_run_id, "scenario": dict(body)},
            project_id=project_id,
        )

    def prepare(self, project_id: str, baseline_run_id: str, body: dict[str, Any]) -> tuple[Any, Any]:
        """Build the scenario's norm version and its run row, without queueing a second job."""
        baseline = self.c.runs.get(project_id, baseline_run_id)
        if baseline.status != RunStatus.DONE:
            raise ConflictError(
                f"the baseline run is {baseline.status}; a scenario needs a finished run to compare with",
                code="whatif.baseline_not_ready",
            )
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("a scenario needs a name a person recognises", code="whatif.name")
        transforms = [validate_transform(dict(t)) for t in body.get("transforms") or []]
        norm_changes = dict(body.get("norm") or {})
        if not transforms and not norm_changes:
            raise ValidationError(
                "a scenario changes the log, the norm, or both; this one changes nothing", code="whatif.empty"
            )
        author = body.get("author") or None
        norm_version_id = baseline.params.norm_version_id
        norm_lines: builtins.list[str] = []
        if norm_changes:
            parent = self.c.norms.get(project_id, baseline.params.norm_version_id)
            document, norm_lines = apply_norm_changes(parent.document, norm_changes)
            version = self.c.norms.create_version(
                project_id,
                document,
                note=f"what-if: {name}",
                parent_id=parent.id,
                author=author,
            )
            norm_version_id = version.id
        params = RunParams(
            case_table_id=baseline.params.case_table_id,
            norm_version_id=norm_version_id,
            views=tuple(baseline.params.views),
            slicings=tuple(
                Slicing(id=s.id, attributes=tuple(s.attributes), bands=tuple(dict(b) for b in s.bands))
                for s in baseline.params.slicings
            ),
            gamma=baseline.params.gamma,
            min_cases=baseline.params.min_cases,
            baseline_run_id=baseline.id,
            note=str(body.get("note") or "") or None,
            scope=dict(baseline.params.scope) if baseline.params.scope else None,
            transforms=tuple(transforms),
            scenario=name,
        )
        run, job, _created = self.c.runs.create(project_id, params, force=bool(body.get("force")), enqueue=False)
        if norm_lines:
            self.c.workspace.write_json(
                self.c.workspace.run_dir(project_id, run.id) / "whatif_norm.json",
                {"changes": norm_changes, "lines": norm_lines, "parentNormVersionId": baseline.params.norm_version_id},
            )
        return run, job

    def preview(self, project_id: str, baseline_run_id: str, transforms: list[dict[str, Any]]) -> dict[str, Any]:
        """What the transform layer would touch, without scoring anything."""
        run, ctx = self.c.runs.ready(project_id, baseline_run_id)
        records = self.c.engine.transform_preview(
            ctx.case_table_dir, ctx.mapping, ctx.scope, [validate_transform(dict(t)) for t in transforms]
        )
        return {"runId": run.id, "transforms": records, "caseNoun": ctx.case_noun}

    # ------------------------------------------------------------- reading a scenario
    def list(self, project_id: str, baseline_run_id: str | None = None) -> builtins.list[dict[str, Any]]:
        """Every scenario of the project, newest first; with ``baseline_run_id`` only that baseline's."""
        out = []
        for run in self.c.runs.list(project_id):
            if not run.params.scenario:
                continue
            if baseline_run_id and run.params.baseline_run_id != baseline_run_id:
                continue
            out.append(
                {
                    "runId": run.id,
                    "name": run.params.scenario,
                    "baselineRunId": run.params.baseline_run_id,
                    "status": str(run.status),
                    "note": run.params.note,
                    "transforms": [dict(t) for t in run.params.transforms],
                    "createdAt": run.created_at.isoformat(),
                }
            )
        return sorted(out, key=lambda r: str(r["createdAt"]), reverse=True)

    def change_table(
        self,
        project_id: str,
        run_id: str,
        *,
        slicing: str | None = None,
        view: str | None = None,
        min_cases: int | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """The scenario against its frozen baseline: what changed per group, and what did not."""
        run, ctx = self.c.runs.ready(project_id, run_id)
        if not run.params.baseline_run_id:
            raise ValidationError(
                f"run {run_id} is not a what-if scenario; it names no baseline", code="whatif.not_a_scenario"
            )
        baseline = self.c.runs.get(project_id, run.params.baseline_run_id)
        if baseline.status != RunStatus.DONE:
            raise ConflictError("the frozen baseline is not readable", code="whatif.baseline_not_ready")
        view = view or (ctx.views[0] if ctx.views else None)
        slicing = slicing or (ctx.slicings[0][0] if ctx.slicings else None)
        if not slicing or not view:
            raise ValidationError("the scenario has no slicing or no view to compare on", code="whatif.compare")
        cases = int(min_cases if min_cases is not None else run.params.min_cases)
        rows_a = self._rows(project_id, baseline.id, slicing, view, cases)
        rows_b = self._rows(project_id, run.id, slicing, view, cases)
        table, summary = _compare(rows_a, rows_b)
        noun = ctx.case_noun
        return {
            "runId": run.id,
            "baselineRunId": baseline.id,
            "name": run.params.scenario,
            "note": run.params.note,
            "slicing": slicing,
            "view": view,
            "minCases": cases,
            "caseNoun": noun,
            "rows": table[: int(limit)],
            "total": len(table),
            "summary": {**summary, "text": _summary_text(summary, noun, run.params.scenario or "this scenario")},
            "transforms": [dict(t) for t in run.params.transforms],
            "normChanges": self._norm_lines(project_id, run.id),
            "provenance": _provenance(run, baseline),
        }

    def _norm_lines(self, project_id: str, run_id: str) -> builtins.list[str]:
        path = self.c.workspace.run_dir(project_id, run_id) / "whatif_norm.json"
        if not path.exists():
            return []
        return [str(line) for line in (self.c.workspace.read_json(path).get("lines") or [])]

    def _rows(self, project_id: str, run_id: str, slicing: str, view: str, min_cases: int) -> dict[str, dict[str, Any]]:
        page = self.c.runs.backlog(
            project_id,
            run_id,
            slicing=slicing,
            view=view,
            gamma=None,
            min_cases=min_cases,
            sort="-stable_PI",
            hotspot_type=None,
            layer=None,
            q=None,
            page=1,
            page_size=1000,
            volume="cases",
        )
        out: dict[str, dict[str, Any]] = {}
        for rank, row in enumerate(page.get("rows") or [], start=1):
            out[str(row.get("key"))] = {
                "key": row.get("key"),
                "keys": row.get("keys"),
                "rank": rank,
                "n_cases": row.get("n_cases"),
                "mean_score": row.get("mean_score"),
                "stable_PI": row.get("stable_PI"),
                "top_constraint_plain": row.get("top_constraint_plain") or row.get("top_constraint"),
            }
        return out


def _compare(
    before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """One row per group: the baseline's numbers, the scenario's, and the difference of the two."""
    rows: list[dict[str, Any]] = []
    for key in sorted(set(before) | set(after)):
        a, b = before.get(key), after.get(key)
        row: dict[str, Any] = {
            "key": key,
            "keys": (b or a or {}).get("keys"),
            "state": "changed" if a and b else ("entered" if b else "left"),
            "baseline": a,
            "scenario": b,
        }
        if a and b:
            row["deltaCases"] = _diff(b.get("n_cases"), a.get("n_cases"))
            row["deltaMeanPoints"] = _points(b.get("mean_score"), a.get("mean_score"))
            row["deltaPriority"] = _diff(b.get("stable_PI"), a.get("stable_PI"))
            row["deltaRank"] = _diff(a.get("rank"), b.get("rank"))  # positive = moved up the list
            row["unchanged"] = bool(
                row["deltaMeanPoints"] is not None
                and abs(row["deltaMeanPoints"]) < 0.05
                and row["deltaPriority"] is not None
                and abs(row["deltaPriority"]) < 0.05
                and row["deltaRank"] == 0
            )
        rows.append(row)
    rows.sort(key=lambda r: (-abs(r.get("deltaPriority") or 0.0), str(r["key"])))
    common = [r for r in rows if r["state"] == "changed"]
    moved = [r for r in common if not r.get("unchanged")]
    top_a = [k for k, v in sorted(before.items(), key=lambda kv: kv[1]["rank"])][:10]
    top_b = [k for k, v in sorted(after.items(), key=lambda kv: kv[1]["rank"])][:10]
    summary = {
        "groupsBaseline": len(before),
        "groupsScenario": len(after),
        "groupsCompared": len(common),
        "groupsChanged": len(moved),
        "groupsUnchanged": len(common) - len(moved),
        "entered": [r["key"] for r in rows if r["state"] == "entered"],
        "left": [r["key"] for r in rows if r["state"] == "left"],
        "topTenOverlap": len(set(top_a) & set(top_b)) / 10 if top_a and top_b else None,
        "leaderBaseline": top_a[0] if top_a else None,
        "leaderScenario": top_b[0] if top_b else None,
        "priorityBaseline": _sum(before, "stable_PI"),
        "priorityScenario": _sum(after, "stable_PI"),
        "rankAgreement": _spearman(before, after),
        "largestMove": moved[0]["key"] if moved else None,
    }
    return rows, summary


def _diff(b: Any, a: Any) -> float | None:
    if b is None or a is None:
        return None
    return round(float(b) - float(a), 6)


def _points(b: Any, a: Any) -> float | None:
    if b is None or a is None:
        return None
    return round((float(b) - float(a)) * 100, 4)


def _sum(rows: dict[str, dict[str, Any]], field: str) -> float:
    return round(sum(float(r.get(field) or 0.0) for r in rows.values()), 4)


def _spearman(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> float | None:
    """Rank correlation of the two orders over the groups both of them rank."""
    keys = sorted(set(before) & set(after))
    n = len(keys)
    if n < 3:
        return None
    d2 = sum((float(before[k]["rank"]) - float(after[k]["rank"])) ** 2 for k in keys)
    return round(1 - (6 * d2) / (n * (n * n - 1)), 4)


def _summary_text(summary: dict[str, Any], noun: str, name: str) -> str:
    """What changed in the order, in one sentence a person can read."""
    changed, compared = int(summary["groupsChanged"]), int(summary["groupsCompared"])
    leader_a, leader_b = summary.get("leaderBaseline"), summary.get("leaderScenario")
    lead = (
        f"the group at the top is unchanged ({leader_a})"
        if leader_a == leader_b
        else f"the group at the top changes from {leader_a} to {leader_b}"
    )
    overlap = summary.get("topTenOverlap")
    tail = f", {round(float(overlap) * 10)} of the top ten are the same" if overlap is not None else ""
    entered, left = len(summary.get("entered") or []), len(summary.get("left") or [])
    # a count says its own plural (P1-13)
    moves = (
        f" {entered} group{'' if entered == 1 else 's'} enter the list and {left} leave it."
        if (entered or left)
        else ""
    )
    return (
        f"Against the frozen baseline, {name} moves {changed} of the {compared} groups of {noun} that both runs "
        f"rank; {lead}{tail}.{moves}"
    )


def _provenance(run: Any, baseline: Any) -> dict[str, Any]:
    """Where both numbers come from: the two runs, their norms, their inputs and their parameters."""

    def of(r: Any) -> dict[str, Any]:
        m = r.manifest
        return {
            "runId": r.id,
            "normVersionId": r.params.norm_version_id,
            "normFingerprint": m.norm_fingerprint if m else None,
            "contentHash": m.content_hash if m else None,
            "paramsHash": r.params_hash,
            "wiseVersion": m.wise_version if m else None,
            "finishedAt": m.finished_at if m else None,
            "cases": m.cases if m else None,
            "gamma": r.params.gamma,
            "minCases": r.params.min_cases,
        }

    return {"baseline": of(baseline), "scenario": of(run), "frozen": True}


__all__ = ["SCENARIO_FILE", "WhatIfService"]
