"""Bind a project once to a dataset explicitly selected by its user."""

from fastapi import APIRouter

from wise_workbench.api.deps import ContainerDep
from wise_workbench.api.schema_models.project_binding import ProjectDatasetBinding, ProjectDatasetBindingPut
from wise_workbench.application.services.project_binding import bind_dataset, get_binding

router = APIRouter(prefix="/projects/{projectId}/dataset-binding", tags=["projects"])


@router.get("", operation_id="getProjectDatasetBinding", response_model=ProjectDatasetBinding)
def get_project_dataset_binding(projectId: str, c: ContainerDep) -> ProjectDatasetBinding:
    return ProjectDatasetBinding(**get_binding(c, projectId))


@router.put("", operation_id="bindProjectDataset", response_model=ProjectDatasetBinding)
def put_project_dataset_binding(
    projectId: str, body: ProjectDatasetBindingPut, c: ContainerDep
) -> ProjectDatasetBinding:
    return ProjectDatasetBinding(**bind_dataset(c, projectId, body.datasetId))
