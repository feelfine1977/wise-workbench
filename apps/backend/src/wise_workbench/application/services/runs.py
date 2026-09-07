"""Runs: creation with idempotency, and every read-side query over a run's artefacts."""

from __future__ import annotations

import builtins
import json
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import case_noun as pack_case_noun
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
    Slicing,
    ValidationError,
)
from wise_workbench.ids import new_id

CLOSURE_LABELS = {"p2p": "clearing", "o2c": "goods issue"}


def parse_bands(text: str | None) -> list[dict[str, Any]]:
    """Band specs from the ``bands`` query parameter (a JSON list)."""
    if not text:
        return []
    try:
        obj = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"bands is not valid JSON: {exc}", code="run.bands") from exc
    if isinstance(obj, dict):
        obj = [obj]
    if not isinstance(obj, list):
        raise ValidationError("bands must be a JSON list of band specs", code="run.bands")
    return [dict(b) for b in obj]


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
        if params.scope and params.scope.get("attribute") not in available:
            raise ValidationError(
                f"scope attribute {params.scope.get('attribute')!r} is not in the case table",
                code="run.scope_attribute",
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

    def list(self, project_id: str) -> builtins.list[Run]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_runs(project_id)

    def context(self, run: Run) -> RunContext:
        table = self.c.repos.get_case_table(run.params.case_table_id)
        mapping = self.c.repos.get_mapping(table.mapping_id)
        norm = self.c.repos.get_norm_version(run.params.norm_version_id)
        project = self.c.repos.get_project(run.project_id)
        views = tuple(run.params.views) or tuple(norm.view_names)
        window_end = None
        if table.readiness is not None and table.readiness.window_end:
            window_end = table.readiness.window_end
        elif run.manifest is not None and run.manifest.window_end:
            window_end = run.manifest.window_end
        noun = (
            mapping.case_noun
            or (table.readiness.case_noun if table.readiness else None)
            or pack_case_noun(project.process)
            or mapping.noun
        )
        settings = self.c.settings
        return RunContext(
            run_dir=self.c.workspace.run_dir(run.project_id, run.id),
            case_table_dir=self.c.workspace.case_table_dir(run.project_id, table.id),
            mapping=mapping,
            document=norm.document,
            views=views,
            gamma=run.params.gamma,
            min_cases=run.params.min_cases,
            slicings=tuple((s.id, tuple(s.attributes)) for s in run.params.slicings),
            bands={s.id: tuple(dict(b) for b in s.bands) for s in run.params.slicings if s.bands},
            scope=dict(run.params.scope) if run.params.scope else None,
            window_end=window_end,
            case_noun=noun,
            closure_label=CLOSURE_LABELS.get(str(project.process or ""), "closure"),
            process=project.process,
            project_id=run.project_id,
            run_id=run.id,
            norm_warnings=tuple(run.manifest.norm_warnings) if run.manifest else (),
            analytics={
                "bootstrap_b": settings.analytics_bootstrap_b,
                "comparison_top": settings.analytics_comparison_top,
                "cluster_share": settings.analytics_cluster_share,
                "seed": settings.analytics_seed,
            },
        )

    def _slicing(
        self, ctx: RunContext, slicing: str, bands: str | None
    ) -> tuple[builtins.list[str], builtins.list[dict[str, Any]]]:
        """Attributes and bands of a slicing given by id, or by attribute list plus the ``bands`` parameter."""
        attributes = ctx.slicing_attributes(slicing)
        if not attributes:
            raise ValidationError("slicing must name at least one case attribute", code="backlog.slicing")
        specs = parse_bands(bands) or ctx.slicing_bands(slicing)
        spec = Slicing(id="", attributes=tuple(attributes), bands=tuple(specs))  # validates the combination
        return list(spec.attributes), [dict(b) for b in spec.bands]

    def _drill(
        self, ctx: RunContext, drill_from: str | None, drill_key: str | None, bands: str | None = None
    ) -> dict[str, Any] | None:
        if not drill_from:
            return None
        if drill_key is None:
            raise ValidationError("drillKey is needed with drillFrom", code="backlog.drill")
        from wise_workbench.adapters.engine import parse_slice_key

        attrs, specs = self._slicing(ctx, drill_from, bands)
        key = parse_slice_key(drill_key, len(attrs))
        return {"id": ctx.slicing_id(attrs, specs) or ",".join(attrs), "attributes": attrs, "bands": specs, "key": key}

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
        stability: str | None = None,
        bands: str | None = None,
        drill_from: str | None = None,
        drill_key: str | None = None,
        filter_text: str | None = None,
        volume: str = "cases",
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes, specs = self._slicing(ctx, slicing, bands)
        drill = self._drill(ctx, drill_from, drill_key)
        filter_obj = parse_filter(filter_text)
        result = self.c.engine.backlog(
            run,
            ctx,
            attributes,
            view,
            gamma,
            min_cases,
            bands=specs,
            drill=drill,
            filter_obj=filter_obj,
            volume=volume,
        )
        rows, total = result.page(
            sort=sort,
            page=page,
            page_size=page_size,
            hotspot_type=hotspot_type,
            kind=kind,
            layer=layer,
            search=q,
            stability=stability,
        )
        analytics = dict(result.analytics)
        return {
            "rows": rows,
            "total": total,
            "globalMean": result.global_mean,
            "maxStablePI": result.max_stable_pi,
            "params": {
                "slicing": ctx.slicing_id(attributes, specs) or ",".join(attributes),
                "attributes": attributes,
                "bands": specs,
                "view": result.view,
                "gamma": result.gamma,
                "minCases": result.min_cases,
                "sort": sort,
                "page": page,
                "pageSize": page_size,
                "volume": volume,
                "z": 1.96,
                "normFingerprint": run.manifest.norm_fingerprint if run.manifest else None,
                "window_end": analytics.get("windowEnd") or ctx.window_end,
                "case_noun": ctx.case_noun,
                "scope": ctx.scope,
                "drill": result.scope.get("drill") if result.scope else None,
                "filter": filter_obj,
                "cases": result.scope.get("cases") if result.scope else (run.manifest.cases if run.manifest else None),
                "analytics_record_ids": analytics.get("recordIds", {}),
                "analytics_available": analytics.get("available", False),
                "stability_applies": analytics.get("stabilityApplies", True),
                "caveat_summary": analytics.get("caveatSummary", {}),
                "uncalibrated": self.c.engine.uncalibrated(run, ctx),
            },
        }

    def slice_detail(
        self,
        project_id: str,
        run_id: str,
        *,
        slicing: str,
        slice_key: str,
        view: str | None,
        drilldown: str | None,
        bands: str | None = None,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key

        run, ctx = self._ready(project_id, run_id)
        attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes))
        return self.c.engine.slice_detail(run, ctx, attributes, key, view, drilldown, bands=specs)

    def slicing_preview(
        self, project_id: str, run_id: str, *, slicing: str, bands: str | None, min_cases: int
    ) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        attributes, specs = self._slicing(ctx, slicing, bands)
        return self.c.engine.slicing_preview(run, ctx, attributes, specs, min_cases)

    # ------------------------------------------------------------- run manifest, plain first (R3-O7)
    def manifest(self, project_id: str, run_id: str) -> dict[str, Any]:
        """What a person needs about a run, and the fingerprints behind it.

        The owner's note was "manifest and provenance are full of fingerprints and hashes; chaos for a normal
        user". The two blocks are separated here: ``plain`` is a list of label/value/note rows in words,
        ``technical`` keeps every hash, fingerprint and artefact checksum for the reader who wants them.
        """
        run = self.get(project_id, run_id)
        table = self.c.repos.get_case_table(run.params.case_table_id)
        dataset = self.c.repos.get_dataset(table.dataset_id)
        norm = self.c.repos.get_norm_version(run.params.norm_version_id)
        project = self.c.repos.get_project(project_id)
        m = run.manifest
        readiness = table.readiness
        noun = (
            self.c.repos.get_mapping(table.mapping_id).case_noun
            or (readiness.case_noun if readiness else None)
            or pack_case_noun(project.process)
            or "cases"
        )
        views = list(run.params.views) or norm.view_names
        slicings = [" × ".join(s.attributes) for s in run.params.slicings]
        duration = None
        if m and m.started_at and m.finished_at:
            from datetime import datetime as _dt

            try:
                duration = (_dt.fromisoformat(m.finished_at) - _dt.fromisoformat(m.started_at)).total_seconds()
            except ValueError:  # pragma: no cover - a manifest written by an older version
                duration = None
        warn = [i for i in (readiness.items if readiness else ()) if str(i.level) in ("warn", "fail")]
        plain = [
            {"label": "Log", "value": dataset.name, "note": f"{table.cases or 0:,} {noun}"},
            {
                "label": "Expectations",
                "value": f"{norm.name} v{norm.version}",
                "note": f"{norm.status}; {len(norm.document.get('constraints') or [])} expectations"
                + (f"; {len(norm.validation)} warning(s)" if norm.validation else ""),
            },
            {
                "label": "Perspective",
                "value": ", ".join(views) or "none",
                "note": "the weighting of the expectation areas this run was read with",
            },
            {
                "label": "Grouped by",
                "value": "; ".join(slicings) or "nothing",
                "note": f"groups of at least {run.params.min_cases} {noun}",
            },
            {
                "label": "Small groups",
                "value": f"γ = {run.params.gamma:g}",
                "note": (
                    f"a group of {run.params.gamma:g} {noun} keeps half of its shortfall; larger groups keep more"
                    if run.params.gamma
                    else "no discount: every group counts with its raw shortfall"
                ),
            },
            {
                "label": "Scope",
                "value": (
                    ", ".join(f"{k} = {v}" for k, v in (run.params.scope or {}).items())
                    if run.params.scope
                    else "the whole log"
                ),
                "note": None,
            },
            {
                "label": "End of the data",
                "value": (m.window_end if m and m.window_end else (readiness.window_end if readiness else None))
                or self._resolved_window_end(project_id, run_id)
                or "not resolved",
                "note": "every open-case number in this run is counted at that moment",
            },
            {
                "label": "Run",
                "value": (m.finished_at[:19].replace("T", " ") if m and m.finished_at else str(run.status)),
                "note": (f"took {duration:.0f} s" if duration is not None else None),
            },
            {
                "label": "Data caveats",
                "value": f"{len(warn)} to keep in mind" if warn else "none",
                "note": "; ".join(i.message.split(";")[0] for i in warn[:3]) or None,
            },
        ]
        technical = dict(m.to_dict()) if m else {}
        technical["paramsHash"] = run.params_hash
        technical["caseTableId"] = table.id
        technical["datasetId"] = dataset.id
        technical["datasetContentHash"] = dataset.content_hash
        technical["normVersionId"] = norm.id
        technical["normFingerprint"] = norm.fingerprint
        return {
            "runId": run.id,
            "status": str(run.status),
            "caseNoun": noun,
            "plain": plain,
            "technical": technical,
            "uncalibrated": self._uncalibrated_or_empty(project_id, run_id),
        }

    def _resolved_window_end(self, project_id: str, run_id: str) -> str | None:
        try:
            _run, ctx = self._ready(project_id, run_id)
        except ConflictError:
            return None
        return self.c.engine.resolved_window_end(ctx)

    def _uncalibrated_or_empty(self, project_id: str, run_id: str) -> builtins.list[dict[str, Any]]:
        try:
            run, ctx = self._ready(project_id, run_id)
        except ConflictError:
            return []
        return self.c.engine.uncalibrated(run, ctx)

    # ------------------------------------------------------------- explore board (R3-O12)
    def facets(
        self,
        project_id: str,
        run_id: str,
        *,
        by: str,
        attribute: str | None,
        view: str | None,
        gamma: float | None,
        filter_text: str | None,
        period: str,
        sort: str,
        limit: int,
        min_cases: int,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.facets(
            run,
            ctx,
            by=by,
            attribute=attribute,
            view=view,
            gamma=gamma,
            filter_obj=parse_filter(filter_text),
            period=period,
            sort=sort,
            limit=limit,
            min_cases=min_cases,
        )

    def kpis(
        self,
        project_id: str,
        run_id: str,
        *,
        view: str | None,
        gamma: float | None,
        filter_text: str | None,
        slicing: str | None = None,
        slice_key: str | None = None,
        grouping: str | None = None,
        bands: str | None = None,
        min_cases: int = 1,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes: builtins.list[str] | None = None
        specs: builtins.list[dict[str, Any]] = []
        if slicing:
            attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        group_attrs = ctx.slicing_attributes(grouping) if grouping else None
        return self.c.engine.kpis(
            run,
            ctx,
            view=view,
            gamma=gamma,
            filter_obj=parse_filter(filter_text),
            attributes=attributes if key is not None else None,
            key=key,
            bands=specs,
            grouping=group_attrs,
            min_cases=min_cases,
        )

    def activity_profile(
        self,
        project_id: str,
        run_id: str,
        *,
        activity: str,
        abstraction: float,
        filter_text: str | None = None,
        slicing: str | None = None,
        slice_key: str | None = None,
        bands: str | None = None,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes: builtins.list[str] | None = None
        specs: builtins.list[dict[str, Any]] = []
        if slicing:
            attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        return self.c.engine.activity_profile(
            run,
            ctx,
            activity,
            abstraction=abstraction,
            process=self.c.repos.get_project(project_id).process,
            filter_obj=parse_filter(filter_text),
            attributes=attributes if key is not None else None,
            key=key,
            bands=specs,
        )

    def flow_bpmn(
        self,
        project_id: str,
        run_id: str,
        *,
        scope: str,
        detail: float,
        filter_text: str | None = None,
        slicing: str | None = None,
        slice_key: str | None = None,
        bands: str | None = None,
        gateways: bool = True,
    ) -> tuple[str, dict[str, Any]]:
        from wise_workbench.adapters.engine import parse_slice_key
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes: builtins.list[str] | None = None
        specs: builtins.list[dict[str, Any]] = []
        if slicing:
            attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        return self.c.engine.flow_bpmn(
            run,
            ctx,
            scope=scope,
            detail=detail,
            process=self.c.repos.get_project(project_id).process,
            filter_obj=parse_filter(filter_text),
            attributes=attributes if key is not None else None,
            key=key,
            bands=specs,
            gateways=gateways,
        )

    def filter_preview(self, project_id: str, run_id: str, *, filter_text: str | None) -> dict[str, Any]:
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.filter_preview(run, ctx, parse_filter(filter_text))

    # ------------------------------------------------------------- analytics (R1-01)
    def analytics(self, project_id: str, run_id: str) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        status = self.c.engine.analytics_status(run, ctx)
        job = None
        for state in ("running", "queued"):
            for j in self.c.queue.list(status=state, project_id=project_id):
                if j.kind == str(JobKind.ANALYTICS) and j.payload.get("runId") == run_id:
                    job = j
                    break
        status["runId"] = run_id
        status["jobId"] = job.id if job else None
        status["windowEnd"] = status["manifest"].get("windowEnd") or ctx.window_end
        return status

    def request_analytics(self, project_id: str, run_id: str) -> Job:
        from wise_workbench.adapters.engine.analytics import availability
        from wise_workbench.jobs.handlers import analytics as handler

        self._ready(project_id, run_id)
        if not availability()["available"]:
            raise ValidationError("wise-analytics is not installed on this machine", code="analytics.unavailable")
        for state in ("queued", "running"):
            for j in self.c.queue.list(status=state, project_id=project_id):
                if j.kind == str(JobKind.ANALYTICS) and j.payload.get("runId") == run_id:
                    return j
        job = handler.enqueue(self.c, project_id, run_id)
        if job is None:
            job = self.c.queue.enqueue(
                str(JobKind.ANALYTICS), {"projectId": project_id, "runId": run_id}, project_id=project_id
            )
        return job

    # ------------------------------------------------------------- flow types (R2-O10)
    def compare_flow_types(self, project_id: str, run_id: str, *, attribute: str | None) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.compare_flow_types(run, ctx, attribute=attribute)

    def trace(self, project_id: str, run_id: str, case_id: str) -> dict[str, Any]:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.trace(run, ctx, case_id)

    def diagnostics(self, project_id: str, run_id: str, *, slicing: str, view: str | None) -> Table:
        run, ctx = self._ready(project_id, run_id)
        return self.c.engine.diagnostics(run, ctx, ctx.slicing_attributes(slicing), view)

    def signals(
        self,
        project_id: str,
        run_id: str,
        *,
        constraint_id: str,
        slicing: str | None,
        slice_key: str | None,
        filter_text: str | None = None,
        scale: str = "linear",
        bands: str | None = None,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes: list[str] | None = None
        specs: list[dict[str, Any]] = []
        if slicing:
            attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        return self.c.engine.signals(
            run,
            ctx,
            constraint_id,
            attributes if key is not None else None,
            key,
            filter_obj=parse_filter(filter_text),
            scale=scale,
            bands=specs,
        )

    def flow(
        self,
        project_id: str,
        run_id: str,
        *,
        slicing: str | None,
        slice_key: str | None,
        abstraction: float,
        filter_text: str | None = None,
        focus: str | None = None,
        bands: str | None = None,
    ) -> dict[str, Any]:
        from wise_workbench.adapters.engine import parse_slice_key
        from wise_workbench.adapters.engine.filters import parse_filter

        run, ctx = self._ready(project_id, run_id)
        attributes: list[str] | None = None
        specs: list[dict[str, Any]] = []
        if slicing:
            attributes, specs = self._slicing(ctx, slicing, bands)
        key = parse_slice_key(slice_key, len(attributes)) if (attributes and slice_key is not None) else None
        process = self.c.repos.get_project(project_id).process
        return self.c.engine.flow(
            run,
            ctx,
            attributes if key is not None else None,
            key,
            abstraction,
            process=process,
            filter_obj=parse_filter(filter_text),
            focus=focus,
            bands=specs,
        )
