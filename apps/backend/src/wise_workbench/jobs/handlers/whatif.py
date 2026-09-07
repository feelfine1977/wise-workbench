"""``whatif``: a scenario against a frozen baseline — norm version, transformed log, score, change table (R3-27)."""

from __future__ import annotations

from typing import Any

from wise_workbench.domain import RunStatus
from wise_workbench.jobs.worker import JobContext

from . import score_run


def run(ctx: JobContext) -> str:
    c = ctx.container
    project_id = ctx.payload["projectId"]
    baseline_run_id = ctx.payload["baselineRunId"]
    body: dict[str, Any] = dict(ctx.payload.get("scenario") or {})
    ctx.progress(0.02, "preparing the scenario")
    scenario, _job = c.whatif.prepare(project_id, baseline_run_id, body)
    ctx.payload["runId"] = scenario.id
    c.repos.update_job_fields(ctx.job.id, payload=dict(ctx.payload))
    c.repos.update_run(c.repos.get_run(scenario.id).transition(RunStatus.QUEUED, job_id=ctx.job.id))
    ctx.progress(0.05, "scoring the scenario")
    score_run.perform(c, scenario.id, lambda p, m: ctx.progress(0.05 + 0.9 * p, m))
    ctx.progress(0.97, "comparing with the frozen baseline")
    table = c.whatif.change_table(project_id, scenario.id)
    c.workspace.write_json(c.workspace.run_dir(project_id, scenario.id) / "whatif.json", table)
    return f"run:{scenario.id}"


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    c = ctx.container
    run_id = ctx.payload.get("runId")
    if not run_id:
        return
    scenario = c.repos.get_run(run_id)
    if scenario.is_final:
        return
    target = RunStatus.CANCELLED if status == "cancelled" else RunStatus.FAILED
    c.repos.update_run(scenario.transition(target, error=error))
