"""Norm versions."""

from __future__ import annotations

from fastapi import APIRouter, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import NormStatus

router = APIRouter(prefix="/projects/{projectId}/norms", tags=["norms"])


@router.get("", operation_id="listNorms", response_model=list[schemas.NormVersion])
def list_norms(projectId: str, c: ContainerDep) -> list[schemas.NormVersion]:
    return [schemas.NormVersion.from_domain(n) for n in c.norms.list(projectId)]


@router.post(
    "",
    operation_id="createNormVersion",
    response_model=schemas.NormVersion,
    status_code=status.HTTP_201_CREATED,
    responses={422: {"model": schemas.Problem}},
    description="Body is the library's norm JSON plus a note; a new immutable version is created and validated.",
)
def create_norm_version(projectId: str, body: schemas.NormVersionCreate, c: ContainerDep) -> schemas.NormVersion:
    return schemas.NormVersion.from_domain(
        c.norms.create_version(projectId, body.norm, body.note, body.parentId, body.author)
    )


@router.get("/{normVersionId}", operation_id="getNormVersion", response_model=schemas.NormVersion)
def get_norm_version(projectId: str, normVersionId: str, c: ContainerDep) -> schemas.NormVersion:
    return schemas.NormVersion.from_domain(c.norms.get(projectId, normVersionId))


@router.patch("/{normVersionId}", operation_id="setNormStatus", response_model=schemas.NormVersion)
def set_norm_status(
    projectId: str, normVersionId: str, body: schemas.NormStatusUpdate, c: ContainerDep
) -> schemas.NormVersion:
    return schemas.NormVersion.from_domain(c.norms.set_status(projectId, normVersionId, NormStatus(body.status)))


@router.post("/{normVersionId}/check", operation_id="checkNorm", response_model=schemas.NormCheck)
def check_norm(
    projectId: str, normVersionId: str, body: schemas.NormCheckRequest, c: ContainerDep
) -> schemas.NormCheck:
    return schemas.NormCheck(**c.norms.check(projectId, normVersionId, body.caseTableId))
