"""Descriptive temporal evidence for one exact run/group/filter population."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DriverEvidenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DriverEvidenceSource(DriverEvidenceModel):
    projectId: str
    runId: str
    caseTableId: str
    datasetId: str
    normVersionId: str
    normFingerprint: str
    contentHash: str
    selectionId: str | None
    runScope: dict[str, Any] | None
    transformCount: int = Field(ge=0)


class DriverEvidenceScope(DriverEvidenceModel):
    fingerprint: str
    slicing: str
    attributes: list[str]
    bands: list[dict[str, Any]]
    key: list[Any]
    view: str
    filter: dict[str, Any] | None
    filtered: bool
    caseNoun: str
    fullCaseTableCases: int = Field(ge=0)
    runCases: int = Field(ge=0)
    groupCases: int = Field(ge=0)
    selectedCases: int = Field(ge=0)
    selectedEvents: int = Field(ge=0)
    population: Literal["selected_cases"] = "selected_cases"
    ruleApplicabilityApplied: Literal[False] = False
    viewAffectsMeasurements: Literal[False] = False


class DriverEndpoint(DriverEvidenceModel):
    labels: list[str]
    observedLabels: list[str]
    mappedHeaderLabels: list[str]
    eventCount: int = Field(ge=0)
    caseCount: int = Field(ge=0)
    missingTimestampEvents: int = Field(ge=0)


class DriverActivityCoverage(DriverEndpoint):
    selectedCases: int = Field(ge=0)
    casesWithActivity: int = Field(ge=0)
    casesWithoutActivity: int = Field(ge=0)
    singleOccurrenceCases: int = Field(ge=0)
    repeatedOccurrenceCases: int = Field(ge=0)


class SolutionCardBlock(DriverEvidenceModel):
    id: str
    kind: Literal["activity_coverage", "endpoint_duration", "end_day_of_month", "due_date_lead"]
    title: str
    question: str
    requires: list[str]
    calculation: str
    presentation: Literal["coverage", "summary", "day_bars", "availability"]
    missingData: str
    interpretation: str


class SolutionCard(DriverEvidenceModel):
    id: str
    version: int = Field(ge=1)
    title: str
    intent: str
    hubNode: str | None
    process: str | None
    blocks: list[SolutionCardBlock]


class DriverEndpoints(DriverEvidenceModel):
    start: DriverEndpoint
    end: DriverEndpoint


class DriverDayBucket(DriverEvidenceModel):
    day: int = Field(ge=1, le=31)
    eventCount: int = Field(ge=0)
    caseCount: int = Field(ge=0)
    monthsPresent: int = Field(ge=0)


class DriverEndDayOfMonth(DriverEvidenceModel):
    buckets: list[DriverDayBucket] = Field(min_length=31, max_length=31)
    eventCount: int = Field(ge=0, description="All recorded end-event rows, including missing timestamps")
    caseCount: int = Field(ge=0, description="Distinct selected items with any end-event row")
    datedEventCount: int = Field(ge=0)
    datedCaseCount: int = Field(ge=0)
    missingTimestampEvents: int = Field(ge=0)
    firstTimestamp: str | None
    lastTimestamp: str | None
    representedMonths: int = Field(ge=0)
    topDay: DriverDayBucket | None
    timezone: str | None = Field(description="Null means timestamps have no established timezone")
    calendarExposureAdjusted: Literal[False] = False


class DriverEndpointPartitions(DriverEvidenceModel):
    neitherEndpointCases: int = Field(ge=0)
    missingStartOnlyCases: int = Field(ge=0)
    missingEndOnlyCases: int = Field(ge=0)
    repeatedEndpointCases: int = Field(ge=0, description="Both endpoints present, with more than one start or end row")
    missingTimestampCases: int = Field(ge=0, description="Exactly one row of each endpoint, at least one undated")
    reversedCases: int = Field(ge=0, description="Exactly one dated row of each endpoint; end before start")
    tiedCases: int = Field(ge=0, description="Exactly one dated row of each endpoint; equal timestamps")
    orderedCases: int = Field(ge=0, description="Exactly one dated row of each endpoint; end after start")


class DriverEndpointOrdering(DriverEvidenceModel):
    casesWithKnownEndpointTimes: int = Field(ge=0, description="At least one dated start and end, including repeats")
    firstEndBeforeFirstStartCases: int = Field(ge=0)
    allDatedEndsBeforeFirstStartCases: int = Field(ge=0)


class DriverDurationEvidence(DriverEvidenceModel):
    status: Literal["available", "unavailable"]
    reason: str | None
    pairing: Literal["unique_endpoints"] = "unique_endpoints"
    unit: Literal["days"] = "days"
    pairedCases: int = Field(ge=0, description="Ordered plus tied unique endpoints; denominator of median and p90")
    median: float | None = Field(ge=0)
    p90: float | None = Field(ge=0)
    partitions: DriverEndpointPartitions
    ordering: DriverEndpointOrdering


class DriverDueDateEvidence(DriverEvidenceModel):
    status: Literal["unavailable"] = "unavailable"
    reason: str


class DriverEvidence(DriverEvidenceModel):
    constraintId: str
    constraintType: str
    status: Literal["available", "unavailable"]
    reason: str | None
    source: DriverEvidenceSource
    scope: DriverEvidenceScope
    solutionCard: SolutionCard | None
    activityCoverage: DriverActivityCoverage | None
    endpoints: DriverEndpoints | None
    endDayOfMonth: DriverEndDayOfMonth | None
    duration: DriverDurationEvidence | None
    dueDate: DriverDueDateEvidence
    caveats: list[str]
