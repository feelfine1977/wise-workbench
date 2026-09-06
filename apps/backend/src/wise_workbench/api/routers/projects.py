"""Projects."""

from __future__ import annotations

from fastapi import APIRouter, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", operation_id="listProjects", response_model=list[schemas.Project])
def list_projects(c: ContainerDep) -> list[schemas.Project]:
    return [schemas.Project.from_domain(p) for p in c.projects.list()]


@router.post("", operation_id="createProject", response_model=schemas.Project, status_code=status.HTTP_201_CREATED)
def create_project(body: schemas.ProjectCreate, c: ContainerDep) -> schemas.Project:
    return schemas.Project.from_domain(c.projects.create(body.name, body.process, body.question))


@router.get(
    "/{projectId}",
    operation_id="getProject",
    response_model=schemas.Project,
    responses={404: {"model": schemas.Problem}},
)
def get_project(projectId: str, c: ContainerDep) -> schemas.Project:
    return schemas.Project.from_domain(c.projects.get(projectId))
