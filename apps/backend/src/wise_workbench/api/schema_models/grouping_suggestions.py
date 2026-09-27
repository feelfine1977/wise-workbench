"""Pre-scoring context discovery; independent of run score/driver schemas."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from wise_workbench.api.schemas import BandSpec, RunScope

from .selections import SelectionSource


class GroupingSuggestionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    normVersionId: str = Field(min_length=1)
    views: list[str] = Field(min_length=1, max_length=100)
    scope: RunScope | None = None
    focusLayer: str | None = None
    focusConstraint: str | None = None
    minCases: int = Field(default=20, ge=1)
    limit: int = Field(default=15, ge=1, le=50)


class GroupingContextAttribute(BaseModel):
    name: str
    type: Literal["numeric", "categorical"]
    distinct: int
    missing: int


class RankedGroupingSuggestion(BaseModel):
    id: str
    attributes: list[str]
    bands: list[BandSpec]
    label: str
    reasons: list[str]
    relevance: float
    rankScore: float
    cases: int
    supportCases: int
    missingCases: int
    groups: int
    belowMinCases: int
    supportedCases: int
    relatedConstraints: list[str]


class GroupingSuggestionEvidence(BaseModel):
    kind: Literal["pre_scoring_context_support"] = "pre_scoring_context_support"
    projectId: str
    datasetId: str
    caseTableId: str
    normVersionId: str
    normFingerprint: str
    effectiveNormFingerprint: str
    source: SelectionSource
    selectionChecksum: str | None = None
    scope: RunScope | None = None
    views: list[str]
    focusLayer: str | None = None
    focusConstraint: str | None = None
    minCases: int
    cases: int
    fingerprint: str


class GroupingSuggestionsResponse(BaseModel):
    evidence: GroupingSuggestionEvidence
    attributes: list[GroupingContextAttribute]
    suggestions: list[RankedGroupingSuggestion]
    search: dict[str, Any]
    notice: str
