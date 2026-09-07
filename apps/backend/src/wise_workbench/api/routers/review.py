"""The review: gates, hypotheses, findings, actions and "What can we do?" (R1-12, R1-15, R2-01, R2-02)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import ReviewKind

router = APIRouter(prefix="/projects/{projectId}", tags=["review"])


def _out(item: object) -> schemas.ReviewItem:
    return schemas.ReviewItem(**item.to_dict())  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------- gates
@router.get(
    "/runs/{runId}/gates",
    operation_id="getGates",
    response_model=schemas.Gates,
    responses={404: {"model": schemas.Problem}, 409: {"model": schemas.Problem}},
    description=(
        "The readiness, censoring and replication gates of one group, each with the evidence that decided it and "
        "any decision taken on it. A hypothesis or an action on a group with a failed gate is refused with 409 "
        "until the gate is passed or waived with a note."
    ),
)
def get_gates(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: Annotated[str, Query()],
    key: Annotated[str, Query(description="the group's key (JSON array)")],
    view: str | None = None,
) -> schemas.Gates:
    return schemas.Gates(**c.review.gates(projectId, runId, slicing=slicing, slice_key=key, view=view))


@router.post(
    "/runs/{runId}/gates/{gateId}",
    operation_id="setGate",
    response_model=schemas.Gates,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description="Pass, fail or waive one gate. Passing or waiving needs a note that says why.",
)
def set_gate(
    projectId: str,
    runId: str,
    gateId: str,
    body: schemas.GateUpdate,
    c: ContainerDep,
    slicing: Annotated[str, Query()],
    key: Annotated[str, Query(description="the group's key (JSON array)")],
) -> schemas.Gates:
    return schemas.Gates(
        **c.review.set_gate(
            projectId,
            runId,
            gateId,
            slicing=slicing,
            slice_key=key,
            status=body.status,
            note=body.note,
            author=body.author,
        )
    )


# ---------------------------------------------------------------------------- hypotheses
@router.get("/hypotheses", operation_id="listHypotheses", response_model=list[schemas.ReviewItem])
def list_hypotheses(
    projectId: str, c: ContainerDep, runId: str | None = None, slicing: str | None = None, key: str | None = None
) -> list[schemas.ReviewItem]:
    items = c.review.list(projectId, str(ReviewKind.HYPOTHESIS), run_id=runId, slicing=slicing, slice_key=key)
    return [_out(i) for i in items]


@router.post(
    "/hypotheses",
    operation_id="createHypothesis",
    response_model=schemas.ReviewItem,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "Record a hypothesis about one group and one expectation. The backend computes its test from the run's "
        "contrast (risk difference with its interval, the real-unit shift) and refuses the record while a gate of "
        "that group has failed."
    ),
)
def create_hypothesis(projectId: str, body: schemas.HypothesisCreate, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.create_hypothesis(projectId, body.model_dump(exclude_none=True)))


@router.get("/hypotheses/{itemId}", operation_id="getHypothesis", response_model=schemas.ReviewItem)
def get_hypothesis(projectId: str, itemId: str, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.get(projectId, itemId))


@router.patch("/hypotheses/{itemId}", operation_id="updateHypothesis", response_model=schemas.ReviewItem)
def update_hypothesis(
    projectId: str, itemId: str, body: schemas.ReviewItemUpdate, c: ContainerDep
) -> schemas.ReviewItem:
    return _out(c.review.update(projectId, itemId, body.model_dump(exclude_none=True)))


# ---------------------------------------------------------------------------- findings
@router.get("/findings", operation_id="listFindings", response_model=list[schemas.ReviewItem])
def list_findings(
    projectId: str, c: ContainerDep, runId: str | None = None, slicing: str | None = None, key: str | None = None
) -> list[schemas.ReviewItem]:
    items = c.review.list(projectId, str(ReviewKind.FINDING), run_id=runId, slicing=slicing, slice_key=key)
    return [_out(i) for i in items]


@router.post(
    "/findings",
    operation_id="createFinding",
    response_model=schemas.ReviewItem,
    status_code=status.HTTP_201_CREATED,
    description="What the analysis concluded about a group, with the evidence it rests on.",
)
def create_finding(projectId: str, body: schemas.FindingCreate, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.create_finding(projectId, body.model_dump(exclude_none=True)))


@router.patch("/findings/{itemId}", operation_id="updateFinding", response_model=schemas.ReviewItem)
def update_finding(projectId: str, itemId: str, body: schemas.ReviewItemUpdate, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.update(projectId, itemId, body.model_dump(exclude_none=True)))


# ---------------------------------------------------------------------------- actions
@router.get("/actions", operation_id="listActions", response_model=list[schemas.ReviewItem])
def list_actions(
    projectId: str, c: ContainerDep, runId: str | None = None, slicing: str | None = None, key: str | None = None
) -> list[schemas.ReviewItem]:
    items = c.review.list(projectId, str(ReviewKind.ACTION), run_id=runId, slicing=slicing, slice_key=key)
    return [_out(i) for i in items]


@router.post(
    "/actions",
    operation_id="createAction",
    response_model=schemas.ReviewItem,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "What will be done: the mechanism, the remedy, the countermeasure type, the owner role, a due date and a "
        "status. Refused with 409 while a gate of the group has failed."
    ),
)
def create_action(projectId: str, body: schemas.ActionCreate, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.create_action(projectId, body.model_dump(exclude_none=True)))


@router.patch("/actions/{itemId}", operation_id="updateAction", response_model=schemas.ReviewItem)
def update_action(projectId: str, itemId: str, body: schemas.ReviewItemUpdate, c: ContainerDep) -> schemas.ReviewItem:
    return _out(c.review.update(projectId, itemId, body.model_dump(exclude_none=True)))


# ---------------------------------------------------------------------------- What can we do?
@router.get(
    "/runs/{runId}/what-can-we-do",
    operation_id="getWhatCanWeDo",
    response_model=schemas.WhatCanWeDo,
    responses={404: {"model": schemas.Problem}, 409: {"model": schemas.Problem}},
    description=(
        "The sixth step for one group: for its top expectations the usual reasons with what to check in the log "
        "and whom to ask outside it, the usual actions with a countermeasure type and an owner role, what to check "
        "first, and the headroom of each expectation in score points; plus the gates and the actions already saved."
    ),
)
def get_what_can_we_do(
    projectId: str,
    runId: str,
    c: ContainerDep,
    slicing: Annotated[str, Query()],
    key: Annotated[str, Query(description="the group's key (JSON array)")],
    view: str | None = None,
    top: Annotated[int, Query(ge=1, le=10)] = 3,
) -> schemas.WhatCanWeDo:
    return schemas.WhatCanWeDo(
        **c.review.what_can_we_do(projectId, runId, slicing=slicing, slice_key=key, view=view, top=top)
    )
