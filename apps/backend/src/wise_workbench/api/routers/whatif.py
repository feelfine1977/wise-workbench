"""What-if scenarios against a frozen baseline run (R3-27, R1-11)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep

router = APIRouter(prefix="/projects/{projectId}", tags=["what-if"])


@router.post(
    "/runs/{runId}/whatif",
    operation_id="createWhatIf",
    response_model=schemas.Job,
    status_code=status.HTTP_202_ACCEPTED,
    responses={404: {"model": schemas.Problem}, 409: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "Queue a scenario against this run as the frozen baseline. A scenario changes the log (the transform "
        "layer: cap a lag, delete an activity, move an event, set an attribute, keep first), the norm (thresholds "
        "and applicability, which become a new norm version with its own fingerprint), or both, and is then scored "
        "under the baseline's own parameters. The job's `resultRef` is the scenario run; its change table is read "
        "from `GET /runs/{scenarioId}/whatif`."
    ),
)
def create_whatif(projectId: str, runId: str, body: schemas.WhatIfCreate, c: ContainerDep) -> schemas.Job:
    job = c.whatif.enqueue(projectId, runId, body.model_dump(exclude_none=True))
    return schemas.Job.from_domain(job)


@router.post(
    "/runs/{runId}/whatif/preview",
    operation_id="previewWhatIfTransforms",
    response_model=schemas.TransformPreview,
    responses={404: {"model": schemas.Problem}, 409: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description="What the transform layer would touch on this run's log — cases selected, events moved, events removed — without scoring anything.",
)
def preview_whatif(
    projectId: str, runId: str, body: schemas.TransformPreviewRequest, c: ContainerDep
) -> schemas.TransformPreview:
    return schemas.TransformPreview(
        **c.whatif.preview(projectId, runId, [t.model_dump(exclude_none=True) for t in body.transforms])
    )


@router.get(
    "/scenarios",
    operation_id="listScenarios",
    response_model=list[schemas.Scenario],
    description="Every what-if scenario of the project, newest first; `baselineRunId` narrows it to one baseline.",
)
def list_scenarios(projectId: str, c: ContainerDep, baselineRunId: str | None = None) -> list[schemas.Scenario]:
    return [schemas.Scenario(**s) for s in c.whatif.list(projectId, baselineRunId)]


@router.get(
    "/runs/{runId}/whatif",
    operation_id="getWhatIf",
    response_model=schemas.ChangeTable,
    responses={404: {"model": schemas.Problem}, 409: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "The change table of a scenario run against its frozen baseline: per group the two runs' cases, mean score "
        "and priority with the difference of each and the movement in rank, the groups that entered and left, the "
        "agreement of the two orders, and the provenance of both numbers."
    ),
)
def get_whatif(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: str | None = None,
    view: str | None = None,
    minCases: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> schemas.ChangeTable:
    return schemas.ChangeTable(
        **c.whatif.change_table(projectId, runId, slicing=slicing, view=view, min_cases=minCases, limit=limit)
    )
