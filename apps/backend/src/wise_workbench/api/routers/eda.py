"""Norm-free case-table EDA, separate from ingestion/catalogue and run analytics."""

from typing import Annotated

from fastapi import APIRouter, Query

from wise_workbench.api.deps import ContainerDep
from wise_workbench.api.schema_models.eda import EDARequest, EDAResponse
from wise_workbench.api.schema_models.selections import SavedSelection, SavedSelectionCreate
from wise_workbench.application.services.eda import explore_eda
from wise_workbench.application.services.selections import create_selection, get_selection, list_selections

router = APIRouter(prefix="/projects/{projectId}", tags=["data exploration"])


@router.get(
    "/case-tables/{caseTableId}/eda",
    operation_id="getCaseTableEDA",
    response_model=EDAResponse,
    description="Read-only linked case-table overview before norm selection. All views share one selection; only bounded aggregates and up to 100 case rows are returned. The selection JSON accepts categoryKeys, timeRanges with exclusive before bounds, spanRanges with exclusive max bounds, and timeMissing/spanMissing union flags. OR within dimensions, AND across dimensions and legacy parameters. Legacy time filter to bounds remain inclusive. Event/norm clauses are rejected.",
)
def get_case_table_eda(
    projectId: str,
    caseTableId: str,
    query: Annotated[EDARequest, Query()],
    c: ContainerDep,
) -> EDAResponse:
    return EDAResponse(**explore_eda(c, projectId, caseTableId, query))


@router.post(
    "/case-tables/{caseTableId}/eda/query",
    operation_id="queryCaseTableEDA",
    response_model=EDAResponse,
    description="Read-only bounded explorer query. Exact values and typed decimal-string ranges share immutable save membership. jointAny ORs context conjunctions; hierarchyFields declares three ordered levels. Event evidence is opt-in.",
)
def query_case_table_eda(projectId: str, caseTableId: str, body: EDARequest, c: ContainerDep) -> EDAResponse:
    return EDAResponse(**explore_eda(c, projectId, caseTableId, body))


@router.post(
    "/case-tables/{caseTableId}/selections",
    operation_id="createCaseTableSelection",
    response_model=SavedSelection,
    response_model_exclude_none=True,
    status_code=201,
)
def save_case_table_selection(
    projectId: str, caseTableId: str, body: SavedSelectionCreate, c: ContainerDep
) -> SavedSelection:
    return SavedSelection(**create_selection(c, projectId, caseTableId, body))


@router.get(
    "/case-tables/{caseTableId}/selections", operation_id="listCaseTableSelections", response_model=list[SavedSelection]
)
def list_case_table_selections(projectId: str, caseTableId: str, c: ContainerDep) -> list[SavedSelection]:
    return [SavedSelection(**item) for item in list_selections(c, projectId, caseTableId)]


@router.get(
    "/case-tables/{caseTableId}/selections/{selectionId}",
    operation_id="getCaseTableSelection",
    response_model=SavedSelection,
    response_model_exclude_none=True,
)
def get_case_table_selection(projectId: str, caseTableId: str, selectionId: str, c: ContainerDep) -> SavedSelection:
    return SavedSelection(**get_selection(c, projectId, caseTableId, selectionId))
