"""Norm versions."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import NormStatus

router = APIRouter(prefix="/projects/{projectId}/norms", tags=["norms"])


@router.get(
    "/{normVersionId}/signals/{constraintId}",
    operation_id="getNormSignalDistribution",
    response_model=schemas.NormSignalDistribution,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "Preview the selected norm version's rule, derived attributes and applicability on the explicit mapped table. "
        "No run is required or created. Native threshold shares use finite observed signals; casesInScope and "
        "stats.nCases include applicable cases with missing signals. stats.n counts finite observations."
    ),
)
def get_norm_signal_distribution(
    projectId: str,
    normVersionId: str,
    constraintId: str,
    c: ContainerDep,
    caseTableId: Annotated[str, Query(description="the mapped case table to preview")],
    scale: Annotated[Literal["linear", "log"], Query(description="bin scale of the histogram")] = "linear",
) -> schemas.NormSignalDistribution:
    return schemas.NormSignalDistribution(
        **c.norms.signals(projectId, normVersionId, caseTableId, constraintId, scale=scale)
    )


def _out(c: ContainerDep, n: Any) -> schemas.NormVersion:
    return schemas.NormVersion.from_domain(n, guidance_complete=c.norms.guidance_complete(n))


@router.get("", operation_id="listNorms", response_model=list[schemas.NormVersion])
def list_norms(projectId: str, c: ContainerDep) -> list[schemas.NormVersion]:
    return [_out(c, n) for n in c.norms.list(projectId)]


@router.post(
    "",
    operation_id="createNormVersion",
    response_model=schemas.NormVersion,
    status_code=status.HTTP_201_CREATED,
    responses={422: {"model": schemas.Problem}},
    description="Body is the library's norm JSON plus a note; a new immutable version is created and validated.",
)
def create_norm_version(projectId: str, body: schemas.NormVersionCreate, c: ContainerDep) -> schemas.NormVersion:
    return _out(
        c,
        c.norms.create_version(
            projectId,
            body.norm,
            body.note,
            body.parentId,
            body.author,
            calibration={k: v.model_dump(exclude_none=True) for k, v in body.calibration.items()},
            not_applicable={k: v.model_dump(exclude_none=True) for k, v in body.notApplicable.items()},
        ),
    )


@router.get(
    "/applicability",
    operation_id="getApplicabilityOptions",
    response_model=schemas.ApplicabilityOptions,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "What an expectation can be made to apply to on this log (R3-02): the flow types the case table carries "
        "with their counts, the flow types the rules name that it does not carry and why, every case attribute "
        "with its values, and the shape of each applicability clause including *not applicable to this log*."
    ),
)
def get_applicability_options(
    projectId: str,
    c: ContainerDep,
    caseTableId: Annotated[str, Query(description="the case table the norm is written against")],
) -> schemas.ApplicabilityOptions:
    return schemas.ApplicabilityOptions(**c.norms.applicability_options(projectId, caseTableId))


# ---------------------------------------------------------------------------- norm builder (R3-O6)
@router.get(
    "/inventory",
    operation_id="getNormInventory",
    response_model=schemas.Inventory,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "The pickers of the norm builder: the log's activities with their event and case counts and their stage, "
        "and every case attribute with its distinct count and its values. Without `attribute` each attribute is "
        "summarised with its ten most frequent values; with one, that attribute's values are listed (searchable "
        "with `q`, up to `limit`)."
    ),
)
def get_norm_inventory(
    projectId: str,
    c: ContainerDep,
    caseTableId: Annotated[str, Query(description="the case table the norm is written against")],
    attribute: Annotated[str | None, Query(description="list this attribute's values in full")] = None,
    q: Annotated[str | None, Query(description="search activities or values")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
) -> schemas.Inventory:
    return schemas.Inventory(**c.norms.inventory(projectId, caseTableId, attribute=attribute, q=q, limit=limit))


@router.post(
    "/constraints/check",
    operation_id="checkConstraint",
    response_model=schemas.ConstraintCheck,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "One expectation checked against a case table before it goes into a norm: whether it is well formed, "
        "whether the activities it names occur, how many cases it applies to and how many miss it, and what it "
        "says in one plain sentence with its applicability in words."
    ),
)
def check_constraint(projectId: str, body: schemas.ConstraintCheckRequest, c: ContainerDep) -> schemas.ConstraintCheck:
    return schemas.ConstraintCheck(
        **c.norms.validate_constraint(projectId, body.caseTableId, body.constraint, norm_version_id=body.normVersionId)
    )


@router.get(
    "/guidance-questions",
    operation_id="getGuidanceQuestions",
    response_model=schemas.GuidanceQuestions,
    description=(
        "The five questions asked when an expectation area or an expectation is defined (knowledge-hub panel §4): "
        "what we call it, what we expect, what it means when missed, what usually causes it, what we do about it "
        "and who owns it. The pack's text is offered as a starting answer; answers are stored as the project's "
        "guidance overlay."
    ),
)
def get_guidance_questions(
    projectId: str,
    c: ContainerDep,
    kind: Annotated[Literal["layer", "constraint", "expectation", "failure_mode"], Query()] = "layer",
    id: Annotated[str | None, Query(description="the layer or expectation being defined")] = None,
) -> schemas.GuidanceQuestions:
    return schemas.GuidanceQuestions(**c.knowledge.questions(projectId, kind, id))


@router.get(
    "/{normVersionId}",
    operation_id="getNormVersion",
    response_model=schemas.NormVersion,
    description="A norm version; `warnings` lists activities and attributes it names that never occur in the case table (recomputed against `caseTableId` when given).",
)
def get_norm_version(
    projectId: str, normVersionId: str, c: ContainerDep, caseTableId: str | None = None
) -> schemas.NormVersion:
    n = c.norms.get(projectId, normVersionId)
    if caseTableId:
        n = c.norms.refresh_warnings(n, caseTableId)
    return _out(c, n)


@router.patch(
    "/{normVersionId}",
    operation_id="setNormStatus",
    response_model=schemas.NormVersion,
    responses={422: {"model": schemas.Problem}},
    description=(
        "Move a version along draft → reviewed → approved. Leaving draft needs a named person and a rationale "
        "with an owner for every threshold this version set (R3-02); it is refused with 422 otherwise."
    ),
)
def set_norm_status(
    projectId: str, normVersionId: str, body: schemas.NormStatusUpdate, c: ContainerDep
) -> schemas.NormVersion:
    return _out(c, c.norms.set_status(projectId, normVersionId, NormStatus(body.status), author=body.author))


@router.get(
    "/{normVersionId}/calibration",
    operation_id="getNormCalibration",
    response_model=schemas.NormCalibration,
    responses={404: {"model": schemas.Problem}},
    description=(
        "The calibration state of one version: every threshold with the rationale and the owner recorded for it, "
        "which of them this version set, the expectations marked not applicable with their notes, and what still "
        "keeps the version in draft."
    ),
)
def get_norm_calibration(projectId: str, normVersionId: str, c: ContainerDep) -> schemas.NormCalibration:
    return schemas.NormCalibration(**c.norms.calibration(projectId, normVersionId))


@router.post("/{normVersionId}/check", operation_id="checkNorm", response_model=schemas.NormCheck)
def check_norm(
    projectId: str, normVersionId: str, body: schemas.NormCheckRequest, c: ContainerDep
) -> schemas.NormCheck:
    return schemas.NormCheck(**c.norms.check(projectId, normVersionId, body.caseTableId))
