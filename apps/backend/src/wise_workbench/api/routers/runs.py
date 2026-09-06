"""Runs and every read-side query over their artefacts."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Response, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import RunParams, Slicing, slicing_id

router = APIRouter(prefix="/projects/{projectId}/runs", tags=["runs"])


def _params(body: schemas.RunCreate) -> RunParams:
    slicings = tuple(
        Slicing(id=s.id or slicing_id(s.attributes), attributes=tuple(s.attributes)) for s in body.slicings
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
    q: str | None = None,
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
    )
    return schemas.BacklogPage(**page_dict)


@router.get("/{runId}/slices/{sliceKey:path}", operation_id="getSlice", response_model=schemas.SliceDetail)
def get_slice(
    projectId: str,
    runId: str,
    sliceKey: str,
    c: ContainerDep,
    slicing: Annotated[str, Query()],
    view: str | None = None,
    drilldown: Annotated[str | None, Query(description="case attribute for the penalty-mass Pareto")] = None,
) -> schemas.SliceDetail:
    return schemas.SliceDetail(
        **c.runs.slice_detail(projectId, runId, slicing=slicing, slice_key=sliceKey, view=view, drilldown=drilldown)
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
) -> schemas.Distribution:
    return schemas.Distribution(
        **c.runs.signals(projectId, runId, constraint_id=constraintId, slicing=slicing, slice_key=sliceKey)
    )


@router.get("/{runId}/flow", operation_id="getFlow", response_model=schemas.FlowGraph)
def get_flow(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: str | None = None,
    sliceKey: str | None = None,
    abstraction: Annotated[float, Query(ge=0.0, le=1.0)] = 0.05,
) -> schemas.FlowGraph:
    return schemas.FlowGraph(
        **c.runs.flow(projectId, runId, slicing=slicing, slice_key=sliceKey, abstraction=abstraction)
    )
