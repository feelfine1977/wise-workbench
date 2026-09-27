"""Bounded, norm-free case-table exploration contract."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer, model_validator


class EDATimeRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    from_: str | None = Field(
        default=None,
        alias="from",
        max_length=64,
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?$",
    )
    before: str | None = Field(
        default=None,
        max_length=64,
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?$",
    )


class EDASpanRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    min: float | None = Field(default=None, ge=0)
    max: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_range(self) -> EDASpanRange:
        if self.min is None and self.max is None:
            raise ValueError("A span range needs a bound")
        if self.min is not None and self.max is not None and self.min >= self.max:
            raise ValueError("Span minimum must be below the exclusive maximum")
        return self


class EDAFacetSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    field: str = Field(min_length=1, max_length=256)
    keys: list[Annotated[str, Field(min_length=1, max_length=32)]] = Field(min_length=1, max_length=22)


class EDAEventRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    min: int | None = Field(default=None, ge=0, le=9_223_372_036_854_775_807)
    max: int | None = Field(default=None, ge=0, le=9_223_372_036_854_775_807)

    @model_validator(mode="after")
    def valid_range(self) -> EDAEventRange:
        if self.min is None and self.max is None:
            raise ValueError("An event range needs a bound")
        if self.min is not None and self.max is not None and self.min >= self.max:
            raise ValueError("Event minimum must be below the exclusive maximum")
        return self


class EDASelection(BaseModel):
    """OR within each dimension; AND across dimensions and legacy parameters."""

    model_config = ConfigDict(extra="forbid", strict=True)

    facets: list[EDAFacetSelection] | None = Field(default=None, min_length=1, max_length=16)
    eventRanges: list[EDAEventRange] | None = Field(default=None, min_length=1, max_length=11)
    eventMissing: bool = False
    categoryKeys: list[str] | None = Field(default=None, min_length=1, max_length=22)
    timeRanges: list[EDATimeRange] | None = Field(default=None, min_length=1, max_length=121)
    timeMissing: bool = False
    spanRanges: list[EDASpanRange] | None = Field(default=None, min_length=1, max_length=11)
    spanMissing: bool = False

    @model_serializer(mode="wrap")
    def serialize_selection(self, serializer: SerializerFunctionWrapHandler):
        # Preserve existing saved-selection recipes when the new union is inactive.
        data = serializer(self)
        if not self.eventMissing:
            data.pop("eventMissing", None)
        for name in ("facets", "eventRanges"):
            if getattr(self, name) is None:
                data.pop(name, None)
        return data

    @model_validator(mode="after")
    def unique_facets(self) -> EDASelection:
        fields = [facet.field for facet in self.facets or []]
        if len(fields) != len(set(fields)):
            raise ValueError("Facet fields must be unique")
        return self


class EDARequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    datasetId: str = Field(min_length=1, max_length=256)
    attribute: str | None = Field(default=None, max_length=256)
    insight: bool = False
    compareAttribute: str | None = Field(default=None, min_length=1, max_length=256)
    filter: str | None = Field(default=None, max_length=8192)
    selection: str | None = Field(
        default=None,
        min_length=2,
        max_length=32768,
        description="JSON object: facets ({field,keys}, up to 16 unique fields), eventRanges ({min,max}, nonnegative event counts, exclusive upper bound), eventMissing (union with eventRanges), categoryKeys (returned keys), timeRanges ({from,before}, exclusive upper bound), timeMissing, spanRanges ({min,max}, exclusive upper bound), spanMissing. OR within dimensions, AND across dimensions and legacy parameters. Empty arrays and unsupported fields are rejected.",
    )
    categoryMode: Literal["missing", "other"] | None = None
    timeMissing: bool = False
    spanMissing: bool = False
    spanMin: float | None = Field(default=None, ge=0)
    spanMax: float | None = Field(default=None, ge=0)
    page: int = Field(default=1, ge=1, le=10_000_000)
    pageSize: int = Field(default=25, ge=1, le=100)

    @model_validator(mode="after")
    def valid_range(self) -> EDARequest:
        if self.spanMin is not None and self.spanMax is not None and self.spanMin >= self.spanMax:
            raise ValueError("spanMin must be below the exclusive spanMax")
        if self.spanMissing and (self.spanMin is not None or self.spanMax is not None):
            raise ValueError("Select either unknown spans or a span range")
        return self


class EDACount(BaseModel):
    selected: int
    total: int


class EDACategory(EDACount):
    key: str
    label: str
    kind: Literal["value", "missing", "other"]
    value: str | None


class EDAPeriod(EDACount):
    key: str
    label: str
    from_: str | None = Field(alias="from")
    to: str | None


class EDASpan(EDACount):
    key: str
    label: str
    min: float | None
    max: float | None
    missing: bool


class EDARow(BaseModel):
    caseId: str
    events: int | None
    firstRecorded: str | None
    lastRecorded: str | None
    spanDays: float | None
    category: str | None


class EDADetails(BaseModel):
    rows: list[EDARow]
    page: int
    pageSize: int
    total: int


class EDASummary(BaseModel):
    cases: EDACount
    events: EDACount
    knownSpanCases: int
    unknownSpanCases: int
    unknownStartCases: int
    medianSpanDays: float | None
    p90SpanDays: float | None
    firstRecorded: str | None
    lastRecorded: str | None


class EDANumericStats(BaseModel):
    min: float | None
    max: float | None
    median: float | None
    p90: float | None


class EDAFieldProfile(BaseModel):
    name: str
    dataType: str
    role: Literal["case_id", "events", "timestamp", "attribute"]
    distinct: int = Field(description="Full-table distinct nonmissing values, independent of selection.")
    missing: EDACount
    numeric: EDANumericStats | None = Field(
        description="Selected-case finite numeric statistics; null for nonnumeric fields."
    )


class EDAFacet(BaseModel):
    field: str
    categories: list[EDACategory]


class EDAJointCell(EDACount):
    leftKey: str
    rightKey: str


class EDADensityCell(EDACount):
    spanKey: str
    eventKey: str


class EDAEventBin(EDACount):
    key: str
    label: str
    min: int | None
    max: int | None
    missing: bool


class EDAConcentration(EDACount):
    key: str
    label: str
    knownSpanCases: int = Field(description="Selected cases with a known recorded span in this category.")
    unknownSpanCases: int = Field(description="Selected cases with an unknown recorded span in this category.")
    unknownEventCases: int = Field(description="Selected cases with an unknown event count in this category.")
    medianSpanDays: float | None
    p90SpanDays: float | None
    events: int = Field(description="Sum of known event counts for selected cases in this category.")


class EDAInsights(BaseModel):
    compareAttribute: str | None
    fields: list[EDAFieldProfile]
    facets: list[EDAFacet]
    joint: list[EDAJointCell]
    density: list[EDADensityCell]
    eventBins: list[EDAEventBin]
    concentration: list[EDAConcentration]


class EDAResponse(BaseModel):
    datasetId: str
    caseTableId: str
    attribute: str | None
    attributes: list[str]
    caseNoun: str
    summary: EDASummary
    categories: list[EDACategory]
    trend: list[EDAPeriod]
    trendMonthsPerBucket: int
    trendOmittedEmptyMonths: int
    spans: list[EDASpan]
    details: EDADetails
    notes: list[str]
    insights: EDAInsights | None = None
