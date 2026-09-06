"""``build_cases``: dataset + mapping → case table with readiness report."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import ActivityCount, CaseTableStatus
from wise_workbench.jobs.worker import JobContext


def run(ctx: JobContext) -> str:
    return perform(ctx.container, ctx.payload["caseTableId"], ctx.progress)


def perform(c: Any, case_table_id: str, progress: ProgressFn) -> str:
    """Build one case table; shared by the ``build_cases`` job and the preset job."""
    table = c.repos.get_case_table(case_table_id)
    dataset = c.repos.get_dataset(table.dataset_id)
    mapping = c.repos.get_mapping(table.mapping_id)
    dataset_dir = c.workspace.dataset_dir(dataset.project_id, dataset.id)
    dest = c.workspace.case_table_dir(table.project_id, table.id)
    dest.mkdir(parents=True, exist_ok=True)
    provenance = {
        "datasetId": dataset.id,
        "contentHash": dataset.content_hash,
        "mappingId": mapping.id,
        "caseTableId": table.id,
    }
    out = c.engine.build_case_table(dataset_dir, mapping, dest, progress, provenance=provenance)
    updated = replace(
        table,
        status=CaseTableStatus.READY,
        cases=int(out["cases"]),
        events=int(out["events"]),
        readiness=out["readiness"],
        activities=tuple(ActivityCount(str(a["label"]), int(a["events"]), int(a["cases"])) for a in out["activities"]),
        attributes=tuple(str(a) for a in out["attributes"]),
        error=None,
    )
    c.repos.update_case_table(updated)
    return f"case_table:{table.id}"


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    c = ctx.container
    table = c.repos.get_case_table(ctx.payload["caseTableId"])
    if table.status == CaseTableStatus.BUILDING:
        c.repos.update_case_table(replace(table, status=CaseTableStatus.FAILED, error=error or status))
