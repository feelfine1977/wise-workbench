"""Norm version, calibration and inspection request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from wise_workbench.domain import NormVersion as DomainNormVersion


class CalibrationEntry(BaseModel):
    """Why a threshold is what it is, and who owns it (R3-02); both are required before the version is signed."""

    model_config = ConfigDict(extra="forbid")

    rationale: str
    owner: str
    decidedAt: str | None = None
    decidedBy: str | None = None


class NotApplicableEntry(BaseModel):
    """An expectation moved out of this version because it cannot be judged on this log, with the note why."""

    model_config = ConfigDict(extra="forbid")

    note: str
    author: str | None = None
    decidedAt: str | None = None


class NormVersionCreate(BaseModel):
    norm: dict[str, Any] = Field(description="library norm JSON")
    note: str
    parentId: str | None = None
    author: str | None = None
    calibration: dict[str, CalibrationEntry] = Field(
        default_factory=dict,
        description="per expectation id: the rationale and the owner of the threshold this version sets (R3-02)",
    )
    notApplicable: dict[str, NotApplicableEntry] = Field(
        default_factory=dict,
        description=(
            "expectation ids to mark not applicable to this log; each is moved out of the norm with its note "
            "and kept in the metadata"
        ),
    )


class NormVersion(BaseModel):
    id: str
    version: int
    fingerprint: str
    status: Literal["draft", "reviewed", "approved"]
    note: str = ""
    author: str | None = None
    parentId: str | None = None
    norm: dict[str, Any]
    validation: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(
        default_factory=list, description="Norm.check: activities or attributes the norm names that never occur"
    )
    guidance_complete: bool = Field(default=False, description="every layer and expectation has a plain name")
    guidance_missing: list[str] = Field(
        default_factory=list, description="layers that still have no guidance (the elicitation questions, RK-6)"
    )
    uncalibrated: list[str] = Field(
        default_factory=list,
        description="thresholds and weights the norm declares as not yet calibrated (metadata.meta, R2-09)",
    )
    calibration: str | None = Field(default=None, description="calibrated | mixed | uncalibrated, from the norm")
    createdAt: datetime
    normId: str
    name: str
    views: list[str] = Field(default_factory=list)

    @classmethod
    def from_domain(
        cls, n: DomainNormVersion, guidance_complete: bool = False, guidance_missing: list[str] | None = None
    ) -> NormVersion:
        return cls(
            id=n.id,
            version=n.version,
            fingerprint=n.fingerprint,
            status=str(n.status),  # type: ignore[arg-type]
            note=n.note,
            author=n.author,
            parentId=n.parent_id,
            norm=n.document,
            validation=list(n.validation),
            warnings=list(n.validation),
            guidance_complete=guidance_complete,
            guidance_missing=list(guidance_missing or []),
            uncalibrated=n.uncalibrated,
            calibration=n.calibration,
            createdAt=n.created_at,
            normId=n.norm_id,
            name=n.name,
            views=n.view_names,
        )


class NormStatusUpdate(BaseModel):
    status: Literal["draft", "reviewed", "approved"]
    author: str | None = Field(
        default=None, description="the person who signs the version; required to leave draft (R3-02)"
    )


class ThresholdRow(BaseModel):
    constraint_id: str
    threshold: dict[str, Any] = Field(default_factory=dict)
    changedHere: bool = False
    rationale: str | None = None
    owner: str | None = None
    decidedAt: str | None = None


class NormCalibration(BaseModel):
    """The calibration state of one norm version: its thresholds, their rationales and what still blocks signing."""

    normVersionId: str
    status: str
    parentId: str | None = None
    author: str | None = None
    thresholds: list[ThresholdRow] = Field(default_factory=list)
    notApplicable: list[dict[str, Any]] = Field(default_factory=list)
    missingRationale: list[str] = Field(default_factory=list)
    canLeaveDraft: bool = True


class NormCheckRequest(BaseModel):
    caseTableId: str


class NormCheckConstraint(BaseModel):
    id: str
    layer: str | None = None
    type: str | None = None
    activitiesMissing: list[str] = Field(default_factory=list)
    casesInScope: int
    casesEvaluated: int


class NormCheck(BaseModel):
    constraints: list[NormCheckConstraint]
    issues: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    cases: int | None = None
    fingerprint: str | None = None


class AttributeValue(BaseModel):
    value: str
    cases: int
    share: float


class AttributeInventory(BaseModel):
    name: str
    kind: Literal["text", "number"]
    distinct: int
    missing: int = 0
    total: int = Field(default=0, description="values that match the search")
    values: list[AttributeValue] = Field(default_factory=list)
    numeric: dict[str, float] | None = Field(default=None, description="min, p10, median, p90, max for numbers")


class ActivityInventory(BaseModel):
    label: str
    events: int
    cases: int
    share: float | None = None
    stage: str | None = None
    canonicalId: str | None = None


class Inventory(BaseModel):
    """What a norm can be built from (R3-O6): the log's activities and every case attribute's values, with counts."""

    caseTableId: str
    cases: int
    events: int
    caseNoun: str | None = None
    activities: list[ActivityInventory] = Field(default_factory=list)
    attributes: list[AttributeInventory] = Field(default_factory=list)
    attributeNames: list[str] = Field(default_factory=list)
    stages: list[dict[str, Any]] = Field(default_factory=list)


class ConstraintCheckRequest(BaseModel):
    caseTableId: str
    constraint: dict[str, Any] = Field(
        description='the library shape: {"id", "layer", "type", "params", "weight", "applicability", "description"}'
    )
    normVersionId: str | None = Field(default=None, description="read plain names from this norm's guidance")


class ConstraintActivity(BaseModel):
    label: str
    known: bool
    cases: int


class ConstraintCheck(BaseModel):
    valid: bool
    errors: list[dict[str, Any]] = Field(default_factory=list)
    id: str | None = None
    layer: str | None = None
    type: str | None = None
    sentence: str | None = Field(default=None, description="the expectation in one sentence, name and rule")
    rule_sentence: str | None = None
    applicability_sentence: str | None = Field(default=None, description="whom it applies to, in words")
    activities: list[ConstraintActivity] = Field(default_factory=list)
    casesInScope: int | None = None
    casesEvaluated: int | None = None
    casesMissing: int | None = None
    shareMissing: float | None = None
    note: str | None = None
    caseTableId: str | None = None
    caseNoun: str | None = None
