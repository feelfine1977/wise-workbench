"""Current case-table context discovery before a run exists."""

from fastapi import APIRouter

from wise_workbench.api.deps import ContainerDep
from wise_workbench.api.schema_models.grouping_suggestions import (
    GroupingSuggestionsRequest,
    GroupingSuggestionsResponse,
)
from wise_workbench.api.schemas import Problem
from wise_workbench.application.services.grouping_suggestions import suggest_groupings

router = APIRouter(prefix="/projects/{projectId}/case-tables/{caseTableId}/grouping-suggestions", tags=["groupings"])


@router.post(
    "",
    operation_id="suggestGroupings",
    response_model=GroupingSuggestionsResponse,
    responses={404: {"model": Problem}, 409: {"model": Problem}, 422: {"model": Problem}},
    description="Read-only, bounded discovery of 1–3 context-column groupings from the current fixed-dataset case table and saved cohort/flow scope. Relevance uses normalized selected stakeholder weights (General only when selected alone); support uses all scoped cases. This does not score constraints, verify drivers, or infer causes.",
)
def grouping_suggestions(
    projectId: str, caseTableId: str, body: GroupingSuggestionsRequest, c: ContainerDep
) -> GroupingSuggestionsResponse:
    return GroupingSuggestionsResponse(**suggest_groupings(c, projectId, caseTableId, body))
