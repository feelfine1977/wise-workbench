"""Runs: creation with idempotency, and every read-side query over a run's artefacts."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wise_workbench.application.ports import RunContext, Table
from wise_workbench.domain import (
    CaseTableStatus,
    ConflictError,
    Job,
    JobKind,
    NotFoundError,
    Run,
    RunParams,
    RunStatus,
    ValidationError,
)
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class RunService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- create
    def create(
        self, project_id: str, params: RunParams, idempotency_key: str | None = None, force: bool = False
    ) -> tuple[Run, Job | None, bool]:
        """Returns ``(run, job, created)``; identical inputs return the existing run."""
        self.c.repos.get_project(project_id)
        if idempotency_key:
            existing = self.c.repos.find_run(project_id, idempotency_key=idempotency_key)
            if existing is not None:
                if existing.params_hash != params.params_hash():
                    raise ConflictError(
                        "Idempotency-Key was used with different parameters", code="run.params_mismatch"
                    )
                return existing, self._job_of(existing), False
        table = self.c.mappings.get_case_table(project_id, params.case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {table.id} is {table.status}", code="run.case_table_not_ready")
        norm = self.c.norms.get(project_id, params.norm_version_id)
        unknown_views = [v for v in params.views if v not in norm.view_names]
        if unknown_views:
            raise ValidationError(
                f"views {unknown_views} are not in norm {norm.name!r}; available: {norm.view_names}", code="run.view"
            )
        available = set(table.attributes) | {r["name"] for r in norm.document.get("derived_attributes", [])}
        for s in params.slicings:
            missing = [a for a in s.attributes if a not in available]
            if missing:
                raise ValidationError(
                    f"slicing {s.id!r} uses attributes that are not in the case table: {missing}",
                    code="run.slicing_attribute",
                    errors=[{"field": "slicings", "message": f"unknown attribute {m}"} for m in missing],
                )
        if not force:
            existing = self.c.repos.find_run(project_id, params_hash=params.params_hash())
            if existing is not None:
                return existing, self._job_of(existing), False
        run = Run(
            id=new_id("run"),
            project_id=project_id,
            params=params,
            status=RunStatus.QUEUED,
            idempotency_key=idempotency_key,
        )
        self.c.repos.add_run(run)
        job = self.c.queue.enqueue(
            str(JobKind.SCORE_RUN), {"projectId": project_id, "runId": run.id}, project_id=project_id
        )
        run = run.transition(RunStatus.QUEUED, job_id=job.id)
        self.c.repos.update_run(run)
        return run, job, True

    def _job_of(self, run: Run) -> Job | None:
        if not run.job_id:
            return None
        try:
            return self.c.repos.get_job(run.job_id)
        except NotFoundError:
            return None

    def cancel(self, project_id: str, run_id: str) -> Run:
        run = self.get(project_id, run_id)
        if run.job_id:
            self.c.queue.cancel(run.job_id)
        if run.status == RunStatus.QUEUED:
            run = self.c.repos.update_run(run.transition(RunStatus.CANCELLED))
        return run

    # ------------------------------------------------------------- read
    def get(self, project_id: str, run_id: str) -> Run:
        run = self.c.repos.get_run(run_id)
        if run.project_id != project_id:
            raise NotFoundError(f"run {run_id!r} not found in project {project_id!r}", code="run.not_found")
        return run

    def list(self, project_id: str) -> list[Run]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_runs(project_id)

    def context(self, run: Run) -> RunContext:
        table = self.c.repos.get_case_table(run.params.case_table_id)
        mapping = self.c.repos.get_mapping(table.mapping_id)
        norm = self.c.repos.get_norm_version(run.params.norm_version_id)
        views = tuple(run.params.views) or tuple(norm.view_names)
        return RunContext(
            run_dir=self.c.workspace.run_dir(run.project_id, run.id),
            case_table_dir=self.c.workspace.case_table_dir(run.project_id, table.id),
            mapping=mapping,
            document=norm.document,
            views=views,
            gamma=run.params.gamma,
            min_cases=run.params.min_cases,
            slicings=tuple((s.id, tuple(s.attributes)) for s in run.params.slicings),
        )

    def _ready(self, project_id: str, run_id: str) -> tuple[Run, RunContext]:
        run = self.get(project_id, run_id)
        if run.status != RunStatus.DONE:
            raise ConflictError(
                f"run {run_id} is {run.status}; results are available once it is done", code="run.not_done"
            )
        return run, self.context(run)

    def summary(self, project_id: str, run_id: str) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.summary(run, ctx)

    def backlog(
        self,
        project_id: str,
        run_id: str,
        *,
        slicing: str,
        view: str | None,
        gamma: float | None,
        min_cases: int,
        sort: str,
        hotspot_type: str | None,
        layer: str | None,
        q: str | None,
        page: int,
        page_size: int,
        kind: str | None = None,
    ) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        attributes = ctx.slicing_attributes(slicing)
        if not attributes:
            raise ValidationError("slicing must name at least one case attribute", code="backlog.slicing")
        result = self.c.engine.backlog(run, ctx, attributes, view, gamma, min_cases)
        rows, total = result.page(
            sort=sort, page=page, page_size=page_size, hotspot_type=hotspot_type, kind=kind, layer=layer, search=q
        )
        return {
            "rows": rows,
            "total": total,
            "globalMean": result.global_mean,
            "maxStablePI": result.max_stable_pi,
            "params": {
                "slicing": ctx.slicing_id(attributes) or ",".join(attributes),
                "attributes": attributes,
                "view": result.view,
                "gamma": result.gamma,
                "minCases": result.min_cases,
                "sort": sort,
                "page": page,
                "pageSize": page_size,
                "volume": "cases",
                "z": 1.96,
                "normFingerprint": run.manifest.norm_fingerprint if run.manifest else None,
            },
        }

    def slice_detail(
        self, project_id: str, run_id: str, *, slicing: str, slice_key: str, view: str | None, drilldown: str | None
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key

        run, ctx = self._ready(project_id, run_id)
        attributes = ctx.slicing_attributes(slicing)
        key = parse_slice_key(slice_key, len(attributes))
        return self.c.engine.slice_detail(run, ctx, attributes, key, view, drilldown)

    def trace(self, project_id: str, run_id: str, case_id: str) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.trace(run, ctx, case_id)

    def diagnostics(self, project_id: str, run_id: str, *, slicing: str, view: str | None) -> Table:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.diagnostics(run, ctx, ctx.slicing_attributes(slicing), view)

    def signals(
        self, project_id: str, run_id: str, *, constraint_id: str, slicing: str | None, slice_key: str | None
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key

        run, ctx = self._ready(project_id, run_id)
        attributes = ctx.slicing_attributes(slicing) if slicing else None
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        return self.c.engine.signals(run, ctx, constraint_id, attributes if key is not None else None, key)

    def flow(
        self, project_id: str, run_id: str, *, slicing: str | None, slice_key: str | None, abstraction: float
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key

        run, ctx = self._ready(project_id, run_id)
        attributes = ctx.slicing_attributes(slicing) if slicing else None
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        process = self.c.repos.get_project(project_id).process
        return self.c.engine.flow(run, ctx, attributes if key is not None else None, key, abstraction, process=process)
