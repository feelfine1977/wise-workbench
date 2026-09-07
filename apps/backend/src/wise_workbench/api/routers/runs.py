"""Runs and every read-side query over their artefacts."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Response, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import RunParams, Slicing

router = APIRouter(prefix="/projects/{projectId}/runs", tags=["runs"])

FilterParam = Annotated[
    str | None,
    Query(
        alias="filter",
        description='URL-safe JSON filter: {"and": [{"kind": "attribute", "field": "…", "in": […]}, …]}; never changes applicability',
    ),
]
BandsParam = Annotated[
    str | None,
    Query(
        description='JSON list of band specs for numeric attributes: [{"attribute": "exposure", "method": "quantile", "q": 4}]'
    ),
]


def _params(body: schemas.RunCreate) -> RunParams:
    slicings = tuple(
        Slicing(
            id=s.id or "",
            attributes=tuple(s.attributes),
            bands=tuple(b.model_dump(exclude_none=True) for b in s.bands),
        )
        for s in body.slicings
    )
    return RunParams(
        case_table_id=body.caseTableId,
        norm_version_id=body.normVersionId,
        views=tuple(body.views),
        slicings=slicings,
        gamma=float(body.gamma),
        min_cases=int(body.minCases),
        baseline_run_id=body.baselineRunId,
        note=body.note,
        scope=body.scope.model_dump(exclude_none=True) if body.scope else None,
    )


@router.get("", operation_id="listRuns", response_model=list[schemas.Run])
def list_runs(projectId: str, c: ContainerDep) -> list[schemas.Run]:
    return [schemas.Run.from_domain(r) for r in c.runs.list(projectId)]


@router.post(
    "",
    operation_id="createRun",
    response_model=schemas.Run,
    status_code=status.HTTP_202_ACCEPTED,
    description="Creates a run and queues its job; identical parameters (or the same Idempotency-Key) return the existing run.",
)
def create_run(
    projectId: str,
    body: schemas.RunCreate,
    c: ContainerDep,
    response: Response,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    force: Annotated[bool, Query()] = False,
) -> schemas.Run:
    run, _job, created = c.runs.create(projectId, _params(body), idempotency_key=idempotency_key, force=force)
    if not created:
        response.status_code = status.HTTP_200_OK
    return schemas.Run.from_domain(run)


@router.get("/{runId}", operation_id="getRun", response_model=schemas.Run)
def get_run(projectId: str, runId: str, c: ContainerDep) -> schemas.Run:
    return schemas.Run.from_domain(c.runs.get(projectId, runId))


@router.post("/{runId}/cancel", operation_id="cancelRun", response_model=schemas.Run)
def cancel_run(projectId: str, runId: str, c: ContainerDep) -> schemas.Run:
    return schemas.Run.from_domain(c.runs.cancel(projectId, runId))


@router.get(
    "/{runId}/manifest",
    operation_id="getRunManifest",
    response_model=schemas.RunManifestView,
    description=(
        "The run in two blocks (R3-O7): `plain` is what a person needs — the log, the expectations, the "
        "perspective, the grouping, the parameters in words, the end of the data, when it ran and how long, and "
        "the data caveats; `technical` keeps the fingerprints, hashes and artefact checksums."
    ),
)
def get_run_manifest(projectId: str, runId: str, c: ContainerDep) -> schemas.RunManifestView:
    return schemas.RunManifestView(**c.runs.manifest(projectId, runId))


@router.get("/{runId}/summary", operation_id="getRunSummary", response_model=schemas.RunSummary)
def get_run_summary(projectId: str, runId: str, c: ContainerDep) -> schemas.RunSummary:
    return schemas.RunSummary(**c.runs.summary(projectId, runId))


@router.get("/{runId}/backlog", operation_id="getBacklog", response_model=schemas.BacklogPage)
def get_backlog(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: Annotated[str, Query(description="slicing id or comma-separated case attributes")],
    view: str | None = None,
    gamma: float | None = None,
    minCases: Annotated[int, Query(ge=1)] = 20,
    sort: str = "-PI",
    hotspotType: Annotated[
        Literal["severity", "mechanism", "reservoir"] | None, Query(description="method name of the kind")
    ] = None,
    kind: Annotated[Literal["acute", "systematic", "widespread"] | None, Query(description="kind of problem")] = None,
    layer: Annotated[str | None, Query(description="most-missed expectation area (layer id)")] = None,
    stability: Annotated[
        Literal["stable", "fragile", "insufficient_support", "unknown"] | None, Query(description="confidence badge")
    ] = None,
    q: str | None = None,
    bands: BandsParam = None,
    drillFrom: Annotated[
        str | None,
        Query(description="drill into one group of this slicing (id or attributes): a finer backlog scoped to it"),
    ] = None,
    drillKey: Annotated[str | None, Query(description="the group's key (JSON array) in drillFrom")] = None,
    filter: FilterParam = None,
    volume: Annotated[
        Literal["cases", "exposure"],
        Query(description="what the Priority Index weighs: the number of cases (default) or their exposure"),
    ] = "cases",
    page: Annotated[int, Query(ge=1)] = 1,
    pageSize: Annotated[int, Query(ge=1, le=500)] = 50,
) -> schemas.BacklogPage:
    page_dict = c.runs.backlog(
        projectId,
        runId,
        slicing=slicing,
        view=view,
        gamma=gamma,
        min_cases=minCases,
        sort=sort,
        hotspot_type=hotspotType,
        kind=kind,
        layer=layer,
        q=q,
        page=page,
        page_size=pageSize,
        stability=stability,
        bands=bands,
        drill_from=drillFrom,
        drill_key=drillKey,
        filter_text=filter,
        volume=volume,
    )
    return schemas.BacklogPage(**page_dict)


@router.get(
    "/{runId}/slicings/preview",
    operation_id="previewSlicing",
    response_model=schemas.SlicingPreview,
    description="The slice designer's preview: how many groups a slicing (two or three attributes, banded numbers) makes and how big they are.",
)
def preview_slicing(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: Annotated[str, Query(description="slicing id or comma-separated case attributes")],
    bands: BandsParam = None,
    minCases: Annotated[int, Query(ge=1)] = 20,
) -> schemas.SlicingPreview:
    return schemas.SlicingPreview(
        **c.runs.slicing_preview(projectId, runId, slicing=slicing, bands=bands, min_cases=minCases)
    )


@router.get(
    "/{runId}/filters/preview",
    operation_id="previewFilter",
    response_model=schemas.FilterPreview,
    description="Cases in and out of a filter, what each clause removes on its own, and cases in scope per expectation.",
)
def preview_filter(projectId: str, runId: str, c: ContainerDep, filter: FilterParam = None) -> schemas.FilterPreview:
    return schemas.FilterPreview(**c.runs.filter_preview(projectId, runId, filter_text=filter))


# ---------------------------------------------------------------------------- explore board (R3-O12)
@router.get(
    "/{runId}/facets",
    operation_id="getFacets",
    response_model=schemas.Facets,
    description=(
        "One row per value of a case attribute (`by=attribute&attribute=…`), of the flow type (`by=flow_type`) or "
        "of the case start period (`by=period`), under the canonical filter: how many cases carry it, how many of "
        "them miss at least one expectation, how much priority is at stake on it and how many are still open. "
        "Periods come back in time order, everything else by priority."
    ),
)
def get_facets(
    projectId: str,
    runId: str,
    c: ContainerDep,
    by: Annotated[Literal["attribute", "flow_type", "period"], Query()] = "attribute",
    attribute: Annotated[str | None, Query(description="case attribute; required for by=attribute")] = None,
    view: str | None = None,
    gamma: float | None = None,
    period: Annotated[Literal["month", "quarter", "year", "week"], Query()] = "month",
    sort: Annotated[
        Literal["-priority", "priority", "-cases", "cases", "-share_below", "share_below", "period"], Query()
    ] = "-priority",
    minCases: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    filter: FilterParam = None,
) -> schemas.Facets:
    return schemas.Facets(
        **c.runs.facets(
            projectId,
            runId,
            by=by,
            attribute=attribute,
            view=view,
            gamma=gamma,
            filter_text=filter,
            period=period,
            sort=sort,
            limit=limit,
            min_cases=minCases,
        )
    )


@router.get(
    "/{runId}/kpis",
    operation_id="getKpis",
    response_model=schemas.Kpis,
    description=(
        "The board's KPI tiles for the cases the filter (and, when given, the group) keeps: items, share below "
        "expectation, priority at stake, still open and the mean score, each with a plain sentence."
    ),
)
def get_kpis(
    projectId: str,
    runId: str,
    c: ContainerDep,
    view: str | None = None,
    gamma: float | None = None,
    slicing: Annotated[str | None, Query(description="restrict the tiles to one group of this slicing")] = None,
    sliceKey: Annotated[str | None, Query(description="the group's key (JSON array)")] = None,
    grouping: Annotated[
        str | None, Query(description="slicing whose groups carry the priority (default: the run's first slicing)")
    ] = None,
    minCases: Annotated[int, Query(ge=1)] = 1,
    bands: BandsParam = None,
    filter: FilterParam = None,
) -> schemas.Kpis:
    return schemas.Kpis(
        **c.runs.kpis(
            projectId,
            runId,
            view=view,
            gamma=gamma,
            filter_text=filter,
            slicing=slicing,
            slice_key=sliceKey,
            grouping=grouping,
            bands=bands,
            min_cases=minCases,
        )
    )


@router.get(
    "/{runId}/analytics",
    operation_id="getAnalytics",
    response_model=schemas.AnalyticsStatus,
    description="Whether the run's analytics (stability, kinds, comparisons, caveats, readiness gate) are computed, with the manifest of cached records.",
)
def get_analytics(projectId: str, runId: str, c: ContainerDep) -> schemas.AnalyticsStatus:
    return schemas.AnalyticsStatus(**c.runs.analytics(projectId, runId))


@router.post(
    "/{runId}/analytics",
    operation_id="requestAnalytics",
    response_model=schemas.Job,
    status_code=status.HTTP_202_ACCEPTED,
    description="Queue the analytics job for a finished run (it runs after every scoring job by default).",
)
def request_analytics(projectId: str, runId: str, c: ContainerDep) -> schemas.Job:
    return schemas.Job.from_domain(c.runs.request_analytics(projectId, runId))


@router.get(
    "/{runId}/compare-flow-types",
    operation_id="compareFlowTypes",
    response_model=schemas.FlowTypeComparison,
    description="Per flow type side by side: cases, score and shortfall per view, the most-missed expectation and the top groups (a run without scope).",
)
def compare_flow_types(
    projectId: str,
    runId: str,
    c: ContainerDep,
    attribute: Annotated[
        str | None, Query(description="attribute holding the flow type (default: the mapping's)")
    ] = None,
) -> schemas.FlowTypeComparison:
    return schemas.FlowTypeComparison(**c.runs.compare_flow_types(projectId, runId, attribute=attribute))


@router.get("/{runId}/slices/{sliceKey:path}", operation_id="getSlice", response_model=schemas.SliceDetail)
def get_slice(
    projectId: str,
    runId: str,
    sliceKey: str,
    c: ContainerDep,
    slicing: Annotated[str, Query()],
    view: str | None = None,
    drilldown: Annotated[str | None, Query(description="case attribute for the penalty-mass Pareto")] = None,
    bands: BandsParam = None,
) -> schemas.SliceDetail:
    return schemas.SliceDetail(
        **c.runs.slice_detail(
            projectId, runId, slicing=slicing, slice_key=sliceKey, view=view, drilldown=drilldown, bands=bands
        )
    )


@router.get("/{runId}/cases/{caseId:path}/trace", operation_id="getTrace", response_model=schemas.Trace)
def get_trace(projectId: str, runId: str, caseId: str, c: ContainerDep) -> schemas.Trace:
    return schemas.Trace(**c.runs.trace(projectId, runId, caseId))


@router.get("/{runId}/diagnostics", operation_id="getDiagnostics", response_model=schemas.Table)
def get_diagnostics(
    projectId: str, runId: str, c: ContainerDep, slicing: Annotated[str, Query()], view: str | None = None
) -> schemas.Table:
    return schemas.Table(**c.runs.diagnostics(projectId, runId, slicing=slicing, view=view))


@router.get(
    "/{runId}/signals/{constraintId}", operation_id="getSignalDistribution", response_model=schemas.Distribution
)
def get_signal_distribution(
    projectId: str,
    runId: str,
    constraintId: str,
    c: ContainerDep,
    slicing: str | None = None,
    sliceKey: str | None = None,
    filter: FilterParam = None,
    scale: Annotated[Literal["linear", "log"], Query(description="bin scale of the histogram")] = "linear",
    bands: BandsParam = None,
) -> schemas.Distribution:
    return schemas.Distribution(
        **c.runs.signals(
            projectId,
            runId,
            constraint_id=constraintId,
            slicing=slicing,
            slice_key=sliceKey,
            filter_text=filter,
            scale=scale,
            bands=bands,
        )
    )


@router.get(
    "/{runId}/flow/bpmn",
    operation_id="exportFlowBpmn",
    response_class=Response,
    responses={
        200: {
            "content": {"application/xml": {"schema": {"type": "string"}}},
            "description": "A BPMN 2.0 document with lanes, gateways, sequence flows and a laid-out diagram.",
        },
        404: {"model": schemas.Problem},
        422: {"model": schemas.Problem},
    },
    description=(
        "The flow as BPMN 2.0. `scope=flow` (default) exports the observed map at `detail` (the abstraction level "
        "of the map, so the file is what the screen shows, filter included); `scope=stages` exports the knowledge "
        "pack's stage model. Stages become lanes, activities tasks, branches exclusive gateways; counts travel in "
        "`bpmn:documentation` and in `wise:*` attributes. The response headers carry the element counts."
    ),
)
def export_flow_bpmn(
    projectId: str,
    runId: str,
    c: ContainerDep,
    scope: Annotated[Literal["flow", "stages"], Query(description="the observed flow or the pack's stage model")] = (
        "flow"
    ),
    detail: Annotated[float, Query(ge=0.0, le=1.0, description="detail level of the map (abstraction)")] = 0.05,
    slicing: str | None = None,
    sliceKey: str | None = None,
    gateways: Annotated[bool, Query(description="insert exclusive gateways where a task branches or joins")] = True,
    bands: BandsParam = None,
    filter: FilterParam = None,
    download: Annotated[bool, Query(description="offer the file as an attachment")] = False,
) -> Response:
    xml, meta = c.runs.flow_bpmn(
        projectId,
        runId,
        scope=scope,
        detail=detail,
        filter_text=filter,
        slicing=slicing,
        slice_key=sliceKey,
        bands=bands,
        gateways=gateways,
    )
    headers = {
        "X-Wise-Bpmn-Tasks": str(meta.get("tasks", 0)),
        "X-Wise-Bpmn-Gateways": str(meta.get("gateways", 0)),
        "X-Wise-Bpmn-Sequence-Flows": str(meta.get("sequenceFlows", 0)),
        "X-Wise-Bpmn-Lanes": str(meta.get("lanes", 0)),
        "X-Wise-Bpmn-Scope": str(meta.get("scope", scope)),
    }
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{runId}_{scope}.bpmn"'
    return Response(content=xml, media_type="application/xml", headers=headers)


@router.get(
    "/{runId}/flow/activities/{activityId:path}",
    operation_id="getActivityProfile",
    response_model=schemas.ActivityProfile,
    responses={404: {"model": schemas.Problem}},
    description=(
        "One activity of the map by node id or label: counts, stage, the expectations that name it, and every "
        "incoming and outgoing path of the **full** directly-follows relation with the count of the paths the "
        "detail level hides (R3-O8)."
    ),
)
def get_activity_profile(
    projectId: str,
    runId: str,
    activityId: str,
    c: ContainerDep,
    abstraction: Annotated[float, Query(ge=0.0, le=1.0)] = 0.05,
    slicing: str | None = None,
    sliceKey: str | None = None,
    bands: BandsParam = None,
    filter: FilterParam = None,
) -> schemas.ActivityProfile:
    return schemas.ActivityProfile(
        **c.runs.activity_profile(
            projectId,
            runId,
            activity=activityId,
            abstraction=abstraction,
            filter_text=filter,
            slicing=slicing,
            slice_key=sliceKey,
            bands=bands,
        )
    )


@router.get(
    "/{runId}/flow",
    operation_id="getFlow",
    response_model=schemas.FlowGraph,
    description="The process map of the run (its scope), of one group, or of the cases a filter keeps; with focus the incoming and outgoing paths of one activity.",
)
def get_flow(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: str | None = None,
    sliceKey: str | None = None,
    abstraction: Annotated[float, Query(ge=0.0, le=1.0)] = 0.05,
    filter: FilterParam = None,
    focus: Annotated[str | None, Query(description="activity node id or label")] = None,
    bands: BandsParam = None,
) -> schemas.FlowGraph:
    return schemas.FlowGraph(
        **c.runs.flow(
            projectId,
            runId,
            slicing=slicing,
            slice_key=sliceKey,
            abstraction=abstraction,
            filter_text=filter,
            focus=focus,
            bands=bands,
        )
    )
