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
