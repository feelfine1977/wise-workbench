"""``score_run``: case table + norm version + parameters → run artefacts and manifest (written last)."""

from __future__ import annotations

from typing import Any

from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import CaseTableStatus, RunManifest, RunStatus, ValidationError
from wise_workbench.jobs.queue import JobCancelled
from wise_workbench.jobs.worker import JobContext


def run(ctx: JobContext) -> str:
    return perform(ctx.container, ctx.payload["runId"], ctx.progress)


def perform(c: Any, run_id: str, progress: ProgressFn) -> str:
    """Score one run; shared by the ``score_run`` job and the preset job."""
    run_ = c.repos.get_run(run_id)
    if run_.status == RunStatus.CANCELLED:
        raise JobCancelled("run was cancelled")
    if run_.status != RunStatus.RUNNING:
        run_ = c.repos.update_run(run_.transition(RunStatus.RUNNING, error=None))
    table = c.repos.get_case_table(run_.params.case_table_id)
    if table.status != CaseTableStatus.READY:
        raise ValidationError(f"case table {table.id} is {table.status}", code="run.case_table_not_ready")
    dataset = c.repos.get_dataset(table.dataset_id)
    mapping = c.repos.get_mapping(table.mapping_id)
    norm = c.repos.get_norm_version(run_.params.norm_version_id)
    case_table_dir = c.workspace.case_table_dir(table.project_id, table.id)
    dest = c.workspace.run_dir(run_.project_id, run_.id)
    dest.mkdir(parents=True, exist_ok=True)
    manifest = c.engine.score_run(
        run_, case_table_dir, mapping, norm.document, dest, progress, content_hash=dataset.content_hash or ""
    )
    done = run_.transition(RunStatus.DONE, manifest=RunManifest.from_dict(manifest), error=None)
    c.repos.update_run(done)
    c.repos.set_latest_run(run_.project_id, run_.id)
    from . import analytics

    analytics.enqueue(c, run_.project_id, run_.id)
    return f"run:{run_.id}"


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    c = ctx.container
    run_ = c.repos.get_run(ctx.payload["runId"])
    if run_.is_final:
        return
    target = RunStatus.CANCELLED if status == "cancelled" else RunStatus.FAILED
    c.repos.update_run(run_.transition(target, error=error))
