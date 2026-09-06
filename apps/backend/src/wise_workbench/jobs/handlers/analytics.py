"""``analytics``: the analytics of a finished run (stability, kinds, comparisons, caveats, readiness gate),
cached under ``runs/<id>/analytics`` with provenance records. Queued after ``score_run`` and on demand."""

from __future__ import annotations

from typing import Any

from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import ConflictError, JobKind, RunStatus
from wise_workbench.jobs.worker import JobContext


def run(ctx: JobContext) -> str:
    return perform(ctx.container, ctx.payload["projectId"], ctx.payload["runId"], ctx.progress)


def perform(c: Any, project_id: str, run_id: str, progress: ProgressFn) -> str:
    run_ = c.runs.get(project_id, run_id)
    if run_.status != RunStatus.DONE:
        raise ConflictError(f"run {run_id} is {run_.status}; analytics need a finished run", code="run.not_done")
    context = c.runs.context(run_)
    progress(0.02, "loading the run")
    manifest = c.engine.run_analytics(run_, context, progress)
    progress(1.0, f"analytics done ({len(manifest.get('records') or {})} records)")
    return f"analytics:{run_id}"


def enqueue(c: Any, project_id: str, run_id: str) -> Any | None:
    """Queue the analytics job for a run unless one is already queued or running."""
    from wise_workbench.adapters.engine.analytics import availability

    if not c.settings.analytics_auto or not availability()["available"]:
        return None
    for status in ("queued", "running"):
        for job in c.queue.list(status=status, project_id=project_id):
            if job.kind == str(JobKind.ANALYTICS) and job.payload.get("runId") == run_id:
                return job
    return c.queue.enqueue(str(JobKind.ANALYTICS), {"projectId": project_id, "runId": run_id}, project_id=project_id)


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    return None
