"""Pydantic models at the API boundary. Names and fields follow ``packages/api-schema/openapi.yaml``."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from wise_workbench.domain import CaseTable as DomainCaseTable
from wise_workbench.domain import ColumnMapping as DomainMapping
from wise_workbench.domain import DatasetVersion as DomainDataset
from wise_workbench.domain import Decision as DomainDecision
from wise_workbench.domain import Job as DomainJob
from wise_workbench.domain import Project as DomainProject
from wise_workbench.domain import Run as DomainRun
from wise_workbench.domain import Snapshot as DomainSnapshot

from .schema_models.norms import ActivityInventory as ActivityInventory
from .schema_models.norms import AttributeInventory as AttributeInventory
from .schema_models.norms import AttributeValue as AttributeValue
from .schema_models.norms import CalibrationEntry as CalibrationEntry
from .schema_models.norms import ConstraintActivity as ConstraintActivity
from .schema_models.norms import ConstraintCheck as ConstraintCheck
from .schema_models.norms import ConstraintCheckRequest as ConstraintCheckRequest
from .schema_models.norms import Inventory as Inventory
from .schema_models.norms import NormCalibration as NormCalibration
from .schema_models.norms import NormCheck as NormCheck
from .schema_models.norms import NormCheckConstraint as NormCheckConstraint
from .schema_models.norms import NormCheckRequest as NormCheckRequest
from .schema_models.norms import NormStatusUpdate as NormStatusUpdate
from .schema_models.norms import NormVersion as NormVersion
from .schema_models.norms import NormVersionCreate as NormVersionCreate
from .schema_models.norms import NotApplicableEntry as NotApplicableEntry
from .schema_models.norms import ThresholdRow as ThresholdRow


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    code: str | None = None
    errors: list[dict[str, Any]] = Field(default_factory=list)


class Version(BaseModel):
    workbench: str
    wise: str
    duckdb: str | None = None


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    process: str | None = Field(default=None, description="knowledge pack id such as p2p or o2c")
    question: str | None = None


class Project(ProjectCreate):
    id: str
    createdAt: datetime
    latestRunId: str | None = None

    @classmethod
    def from_domain(cls, p: DomainProject) -> Project:
        return cls(
            id=p.id,
            name=p.name,
            process=p.process,
            question=p.question,
            createdAt=p.created_at,
            latestRunId=p.latest_run_id,
        )


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    nulls: float
    distinct: int
    sample: list[Any] = Field(default_factory=list)


class DatasetVersion(BaseModel):
    id: str
    name: str
    status: Literal["ingesting", "ready", "failed"]
    contentHash: str | None = None
    events: int | None = None
    columns: list[ColumnProfile] = Field(default_factory=list)
    createdAt: datetime
    jobId: str | None = None
    error: str | None = None
    sourceKind: str | None = None

    @classmethod
    def from_domain(cls, d: DomainDataset) -> DatasetVersion:
        return cls(
            id=d.id,
            name=d.name,
            status=str(d.status),  # type: ignore[arg-type]
            contentHash=d.content_hash,
            events=d.events,
            columns=[
                ColumnProfile(name=c.name, dtype=c.dtype, nulls=c.nulls, distinct=c.distinct, sample=list(c.sample))
                for c in d.columns
            ],
            createdAt=d.created_at,
            jobId=d.job_id,
            error=d.error,
            sourceKind=str(d.source_kind),
        )


class FlowTypingRule(BaseModel):
    name: str
    rule: dict[str, Any]


class ColumnMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    caseId: str
    activity: str
    timestamp: str
    timestampFormat: str | None = None
    dayfirst: bool = False
    utc: bool = False
    lifecycle: str | None = None
    keepTransitions: list[str] = Field(default_factory=lambda: ["complete"])
    resource: str | None = None
    order: str | None = None
    eventId: str | None = None
    caseAttributes: list[str] = Field(default_factory=list)
    exposure: str | None = None
    exposureAgg: str = "max"
    exposureAbs: bool = True
    headerEvents: list[str] = Field(
        default_factory=list, description="activities that belong to a header object and are replicated onto items"
    )
    flowTyping: list[FlowTypingRule] = Field(default_factory=list)
    flowTypingNotes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="flow types the rules name that this file cannot assign, with the columns they need (R3-15)",
    )
    flowTypeDefault: str = "other"
    closureActivities: list[str] = Field(default_factory=list)
    derivedAttributes: list[dict[str, Any]] = Field(default_factory=list, description="library derive recipes")
    preparedAttributes: list[dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "case attributes the workbench computes at build time next to the library's recipes: "
            '{"name", "kind": "date_difference" | "period", "spec", "description"}'
        ),
    )
    dedupe: bool = False
    missingLabel: str | None = Field(
        default="(missing)", description="label for null case-attribute values; null keeps them as nulls"
    )
    note: str | None = None
    caseNoun: str | None = Field(default=None, description='the business name of a case, e.g. "purchase order items"')
    dayPrecisionActivities: list[str] = Field(
        default_factory=list, description="activities marked as day-precise (lag thresholds on them in days only)"
    )
    openCases: Literal["keep", "censor", "exclude"] = "keep"
    zeroExposure: Literal["keep", "exclude"] = "keep"
    censoringWindow: str = "60D"
    decisions: list[dict[str, Any]] = Field(
        default_factory=list, description="the decisions on data caveats this mapping carries (versioned)"
    )
    parentId: str | None = None


class ColumnMappingOut(ColumnMapping):
    id: str
    datasetId: str
    createdAt: datetime

    @classmethod
    def from_domain(cls, m: DomainMapping) -> ColumnMappingOut:
        return cls(id=m.id, datasetId=m.dataset_id, createdAt=m.created_at, **m.to_dict())


class MappingSuggestion(BaseModel):
    mapping: ColumnMapping
    source: Literal["bpic2019", "pm4py", "heuristic"]
    notes: list[str] = Field(default_factory=list)


class Preset(BaseModel):
    id: str
    name: str
    description: str
    available: bool
    source: str | None = Field(default=None, description="path of the log file on this machine")
    norm: str | None = Field(default=None, description="path of the norm file on this machine")
    mapping: ColumnMapping
    slicing: list[str]
    view: str
    gamma: float
    minCases: int
    process: str
    kind: Literal["builtin", "pack"] = Field(default="builtin", description="where the preset is defined")
    caseNoun: str | None = Field(default=None, description='the business name of a case ("sales order items")')
    labelPack: str | None = Field(
        default=None, description="the curated label pack that translates the pack's template into this log's labels"
    )
    pitfalls: list[str] = Field(default_factory=list, description="what to read carefully on this log")
    extraSlicings: list[list[str]] = Field(default_factory=list)
    note: str | None = None


class ReadinessItem(BaseModel):
    id: str
    level: Literal["info", "warn", "fail"]
    message: str
    evidence: dict[str, Any] = Field(default_factory=dict)
    decision: dict[str, Any] | None = Field(
        default=None, description="the caveat action a reader can take on this item: kind, label, params"
    )


class Readiness(BaseModel):
    status: Literal["pass", "warn", "fail"]
    items: list[ReadinessItem] = Field(default_factory=list)
    windowEnd: str | None = Field(default=None, description="the one window end every censoring number uses")
    caseNoun: str | None = None


class ActivityCount(BaseModel):
    label: str
    events: int
    cases: int


class CaseTable(BaseModel):
    id: str
    datasetId: str
    mappingId: str | None = None
    cases: int
    events: int | None = None
    status: Literal["building", "ready", "failed"]
    readiness: Readiness | None = None
    activities: list[ActivityCount] = Field(default_factory=list)
    attributes: list[str] = Field(default_factory=list)
    jobId: str | None = None
    error: str | None = None
    createdAt: datetime

    @classmethod
    def from_domain(cls, t: DomainCaseTable) -> CaseTable:
        readiness = None
        if t.readiness is not None:
            rd = t.readiness.to_dict()
            readiness = Readiness(
                status=rd["status"],
                items=[ReadinessItem(**i) for i in rd["items"]],
                windowEnd=rd.get("windowEnd"),
                caseNoun=rd.get("caseNoun"),
            )
        return cls(
            id=t.id,
            datasetId=t.dataset_id,
            mappingId=t.mapping_id,
            cases=t.cases or 0,
            events=t.events,
            status=str(t.status),  # type: ignore[arg-type]
            readiness=readiness,
            activities=[ActivityCount(label=a.label, events=a.events, cases=a.cases) for a in t.activities],
            attributes=list(t.attributes),
            jobId=t.job_id,
            error=t.error,
            createdAt=t.created_at,
        )


class ApplicabilityKind(BaseModel):
    id: str
    label: str
    shape: dict[str, Any] | None = None
    available: bool = True
    note: str | None = None


class ApplicabilityOptions(BaseModel):
    """What an expectation can be made to apply to on this log: flow types, attribute values, or nothing."""

    caseTableId: str
    caseNoun: str | None = None
    flowTypeAttribute: str | None = None
    flowTypes: list[dict[str, Any]] = Field(default_factory=list)
    flowTypesAbsent: list[AbsentFlowType] = Field(default_factory=list)
    attributes: list[dict[str, Any]] = Field(default_factory=list)
    kinds: list[ApplicabilityKind] = Field(default_factory=list)


class BandSpec(BaseModel):
    attribute: str
    method: Literal["quantile", "cuts"] = "quantile"
    q: int | None = Field(default=None, description="number of quantile bands (2 to 20)")
    cuts: list[float] | None = Field(default=None, description="ascending cut points")
    labels: list[str] | None = None


class SlicingSpec(BaseModel):
    id: str | None = None
    attributes: list[str] = Field(min_length=1, max_length=3, description="one to three case attributes")
    bands: list[BandSpec] = Field(default_factory=list, description="banded numeric attributes")


class RunScope(BaseModel):
    flow_type: str | None = Field(default=None, description="restrict the run to this flow type of the mapping")
    attribute: str | None = Field(
        default=None, description="the attribute that holds the flow type (default flow_type)"
    )
    value: str | None = None


class RunCreate(BaseModel):
    caseTableId: str
    normVersionId: str
    views: list[str] = Field(default_factory=list)
    slicings: list[SlicingSpec] = Field(default_factory=list)
    gamma: float = 50
    minCases: int = 20
    baselineRunId: str | None = None
    note: str | None = None
    scope: RunScope | None = Field(default=None, description="a sub-log: one flow type (applicability untouched)")


class RunManifest(BaseModel):
    normFingerprint: str | None = None
    contentHash: str | None = None
    mappingId: str | None = None
    paramsHash: str | None = None
    wiseVersion: str | None = None
    workbenchVersion: str | None = None
    startedAt: str | None = None
    finishedAt: str | None = None
    views: list[str] = Field(default_factory=list)
    slicings: list[dict[str, Any]] = Field(default_factory=list)
    artefacts: dict[str, dict[str, Any]] = Field(default_factory=dict)
    scope: dict[str, Any] | None = None
    cases: int | None = None
    windowEnd: str | None = None
    normWarnings: list[str] = Field(default_factory=list)


class Run(RunCreate):
    id: str
    scope: dict[str, Any] | None = Field(default=None, description="the run's sub-log scope as recorded")  # type: ignore[assignment]
    status: Literal["queued", "running", "done", "failed", "cancelled"]
    jobId: str | None = None
    manifest: RunManifest | None = None
    paramsHash: str
    error: str | None = None
    createdAt: datetime
    links: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def from_domain(cls, r: DomainRun) -> Run:
        p = r.params
        base = f"/api/v1/projects/{r.project_id}/runs/{r.id}"
        links = {"self": base, "summary": f"{base}/summary"}
        if p.slicings:
            links["backlog"] = f"{base}/backlog?slicing={p.slicings[0].id}"
        return cls(
            id=r.id,
            caseTableId=p.case_table_id,
            normVersionId=p.norm_version_id,
            views=list(p.views),
            slicings=[
                SlicingSpec(id=s.id, attributes=list(s.attributes), bands=[BandSpec(**b) for b in s.bands])
                for s in p.slicings
            ],
            gamma=p.gamma,
            minCases=p.min_cases,
            baselineRunId=p.baseline_run_id,
            note=p.note,
            scope=dict(p.scope) if p.scope else None,
            status=str(r.status),  # type: ignore[arg-type]
            jobId=r.job_id,
            manifest=RunManifest(**r.manifest.to_dict()) if r.manifest else None,
            paramsHash=r.params_hash,
            error=r.error,
            createdAt=r.created_at,
            links=links,
        )


class ManifestRow(BaseModel):
    label: str
    value: str | None = None
    note: str | None = None
    options: list[dict[str, Any]] | None = Field(
        default=None,
        description="alternatives the run offers for this row, one of them in force (R3-15: rank by items or by quantity)",
    )


class RunManifestView(BaseModel):
    """The run screen, plain first (R3-O7): what a person needs, and the fingerprints behind `technical`."""

    runId: str
    status: str
    caseNoun: str
    plain: list[ManifestRow] = Field(default_factory=list)
    technical: dict[str, Any] = Field(default_factory=dict)
    uncalibrated: list[dict[str, Any]] = Field(
        default_factory=list, description="expectations whose threshold needs calibrating on this log (R2-09)"
    )


class Table(BaseModel):
    columns: list[str]
    rows: list[list[Any]]


class RunSummary(BaseModel):
    means: dict[str, float | None] = Field(default_factory=dict)
    scored: dict[str, int] = Field(default_factory=dict)
    density: dict[str, float | None] = Field(default_factory=dict)
    layers: Table | None = None
    concentration: dict[str, dict[str, Table]] = Field(default_factory=dict)
    agreement: dict[str, Table] = Field(default_factory=dict)
    cases: int | None = None
    views: list[str] = Field(default_factory=list)


HotspotType = Literal["severity", "mechanism", "reservoir"]
Kind = Literal["acute", "systematic", "widespread"]
Stability = Literal["stable", "fragile", "insufficient_support", "unknown"]


class BacklogRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str = Field(description='JSON array of the slice\'s key values, e.g. ["companyID_0000", "Packaging"]')
    keys: dict[str, str] = Field(default_factory=dict, description="key values by case attribute (column name)")
    n_cases: int
    mean_score: float
    gap: float
    stable_gap: float
    PI: float
    stable_PI: float
    PI_lower: float | None = None
    volume: float | None = None
    exposure: float | None = None
    stable_mean: float | None = None
    global_mean: float | None = None
    se: float | None = None
    gap_lower: float | None = None
    rank: int
    hotspot_type: HotspotType | None = Field(default=None, description="the library's name; `kind` is the plain label")
    kind: Kind | None = Field(default=None, description="kind of problem: acute | systematic | widespread")
    kind_reading: str | None = Field(
        default=None, description="few cases, far off | one pattern behind it | many cases, slightly off"
    )
    dominant_layer: str | None = None
    dominant_layer_name: str | None = Field(default=None, description="the most-missed expectation area, by name")
    top_constraint: str | None = Field(
        default=None, description="the expectation of that area missed most in this group"
    )
    top_constraint_description: str | None = None
    top_constraint_share: float | None = Field(default=None, description="share of the group's cases missing it")
    n_ranked: int | None = Field(default=None, description="how many groups are ranked (rank x of n_ranked)")
    stability: Stability = "unknown"
    stability_reason: str | None = Field(default=None, description="the bootstrap share behind the badge")
    rank_lo: float | None = None
    rank_hi: float | None = None
    stable_PI_lo: float | None = None
    stable_PI_hi: float | None = None
    p_top: float | None = Field(default=None, description="bootstrap share of replicates in the top-k")
    comparison: str | None = Field(
        default=None,
        description=(
            "one real-unit sentence from the top driver's contrast (top groups only): "
            "'<expectation>: <here> here against <elsewhere> elsewhere (<difference>)', or "
            "'No material difference on the top expectation (<expectation>)' when the numbers round to the same value"
        ),
    )
    comparison_kind: Literal["lag", "count", "share", "metric", "rate", "none"] | None = Field(
        default=None,
        description="the form of the sentence: a duration, a count per case, a share, another case attribute, "
        "the share of cases missing the expectation, or none when there is no material difference",
    )
    caveats: list[Caveat] = Field(default_factory=list)
    n_caveats: int | None = None
    n_caveats_shown: int | None = Field(
        default=None, description="caveats the page-wide rule leaves visible on the card (R2-06)"
    )
    plain_layer: str | None = Field(default=None, description="the most-missed expectation area in plain words")
    layer_missed_label: str | None = Field(default=None, description="what it looks like when that area is missed")
    top_constraint_plain: str | None = None
    top_constraint_measures_logging: bool | None = Field(
        default=None,
        description=(
            "true when the leading expectation is missed mostly because an event is not logged rather than "
            "because a measured value is beyond its threshold (R3-14); `top_constraint_flag` carries the sentence"
        ),
    )
    top_constraint_flag: str | None = Field(
        default=None, description="the sentence to print beside the leading expectation when it measures logging"
    )
    case_noun: str | None = Field(default=None, description='the business name of a case ("purchase order items")')
    points_below: str | None = Field(default=None, description='"0.9 points below the overall score of 84.4 (1 %)"')
    kind_source: Literal["analytics", "library"] | None = None
    comparison_constraint: str | None = Field(
        default=None, description="the expectation the comparison sentence is about"
    )
    expectation_note: str | None = Field(
        default=None,
        description=(
            "set when the headline expectation and the compared expectation differ: which is missed most often "
            "and which carries the largest share of the shortfall (R3-04)"
        ),
    )
    comparison_reason: ComparisonReason | None = Field(
        default=None, description="set exactly when `comparison` is null; never both (R2-05)"
    )
    reading: str | None = None
    reading_plain: str | None = Field(default=None, description="the one-sentence card reading (three numbers)")


class Caveat(BaseModel):
    id: str
    share: float | None = None
    status: str | None = None
    text: str
    window_end: str | None = None
    subgroup: dict[str, Any] | None = Field(
        default=None, description="for a sub-group caveat: the attribute, value and cases it names"
    )
    suppressed: bool = Field(
        default=False,
        description=(
            "true only when the page-wide rule may hide the chip: a warn caveat whose share is within the "
            "page-wide range. A fail caveat, and any caveat whose own share exceeds the page-wide threshold, "
            "is never suppressed (R2-06)"
        ),
    )
    page_share: float | None = Field(default=None, description="the page-wide share of this caveat kind")
    threshold: float | None = Field(default=None, description="the share above which the chip is always shown")


class ComparisonReason(BaseModel):
    code: Literal["no_scored_cases", "no_driver", "not_computed", "analytics_unavailable", "analytics_error"] = Field(
        description="why there is no comparison sentence"
    )
    text: str = Field(description="the reason in plain words; the screens print this instead of a sentence")


class BacklogPage(BaseModel):
    rows: list[BacklogRow]
    total: int
    params: dict[str, Any] = Field(
        description="echoes the slicing, view, gamma, window_end, case_noun, scope, filter, analytics_record_ids"
    )
    globalMean: float | None = None
    maxStablePI: float | None = Field(
        default=None, description="largest stable PI of the whole backlog (priority bars)"
    )


class WorstCase(BaseModel):
    caseId: str
    score: float | None = None
    violated: list[str] = Field(default_factory=list)


def _empty_table() -> Table:
    return Table(columns=[], rows=[])


class GuidanceRefOut(BaseModel):
    kind: Literal["layer", "constraint", "failure_mode"]
    id: str
    plain_name: str | None = None
    missed_label: str | None = None
    hub_node: str | None = None


class SliceDetail(BaseModel):
    row: BacklogRow
    reading: str
    reading_plain: str | None = None
    drivers: Table
    layers: Table
    penaltyMass: Table
    penaltyMassBy: str | None = None
    validation: dict[str, Any] = Field(default_factory=dict)
    worstCases: list[WorstCase] = Field(default_factory=list)
    headroom: Table = Field(description="possible gain per expectation in score points and percent of the priority")
    contrast: Table = Field(
        default_factory=_empty_table,
        description="per expectation: shares missed here and elsewhere, risk difference with interval, real-unit medians, shift, share of shortfall",
    )
    caveats: list[Caveat] = Field(default_factory=list)
    subgroups: Table = Field(default_factory=_empty_table)
    guidance_refs: list[GuidanceRefOut] = Field(default_factory=list)
    comparison: str | None = None
    comparison_reason: ComparisonReason | None = Field(
        default=None, description="set exactly when `comparison` is null; never both (R2-05)"
    )
    scoredCases: int | None = Field(default=None, description="cases of the group with a score in this view")
    comparisons: Table = Field(default_factory=_empty_table)
    analytics: dict[str, Any] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)


class TraceEvent(BaseModel):
    activity: str | None = None
    canonicalId: str | None = None
    timestamp: str | None = None
    resource: str | None = None
    lifecycle: str | None = None
    violates: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)


class Trace(BaseModel):
    caseId: str
    attributes: dict[str, Any] = Field(default_factory=dict)
    scores: dict[str, float | None] = Field(default_factory=dict)
    violations: dict[str, float | None] = Field(default_factory=dict)
    events: list[TraceEvent] = Field(default_factory=list)


class DistributionBin(BaseModel):
    x0: float
    x1: float
    n: int


class DistributionBeyond(BaseModel):
    x0: float
    x1: float
    n: int
    share: float


class DistributionMarker(BaseModel):
    id: Literal["threshold", "saturation"]
    x: float
    label: str


class Distribution(BaseModel):
    unit: str | None = None
    label: str | None = None
    constraintId: str | None = None
    type: str | None = None
    direction: str | None = None
    bins: list[DistributionBin] = Field(default_factory=list, description="bins over the robust range")
    beyond: DistributionBeyond | None = Field(default=None, description="values beyond the robust range")
    below: DistributionBeyond | None = None
    ecdf: list[list[float]] = Field(default_factory=list)
    threshold: float | None = None
    width: float | None = None
    saturation: float | None = Field(default=None, description="δ + W")
    scale: Literal["linear", "log"] = "linear"
    markers: list[DistributionMarker] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    slice: dict[str, Any] | None = None
    casesInScope: int | None = None
    windowEnd: str | None = None
    filter: dict[str, Any] | None = None
    note: str | None = None


class NormSignalDistribution(Distribution):
    """Selected-version native signals on an explicit mapped table; no scoring run is created."""

    normVersionId: str
    caseTableId: str
    constraintId: str


class FlowNode(BaseModel):
    id: str
    kind: Literal["activity", "stage", "gateway", "event", "note"]
    label: str
    group: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class FlowEdge(BaseModel):
    id: str
    kind: Literal["follows", "constraint", "flow"]
    source: str
    target: str
    metrics: dict[str, float] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    payload: Any = None


class FlowGroup(BaseModel):
    id: str
    kind: Literal["lane", "stage", "pool"]
    label: str
    parent: str | None = None


class FlowOverlay(BaseModel):
    kind: Literal["badge", "arc", "hatch", "tint", "chip", "selfLoop"]
    target: str
    payload: dict[str, Any] = Field(default_factory=dict)


class FlowPath(BaseModel):
    node: str | None = None
    count: int
    cases: int
    median_lag: float | None = Field(default=None, description="median lag of the transition in hours")
    violation_share: float | None = Field(
        default=None, description="share of the cases on the path missing any expectation"
    )
    onMap: bool = Field(default=True, description="whether the current detail level draws this path")
    model_config = ConfigDict(extra="allow")


class FlowPaths(BaseModel):
    """Every path of the **full** directly-follows relation, with the ones the detail level hides counted (R3-O8)."""

    incoming: list[FlowPath] = Field(default_factory=list)
    outgoing: list[FlowPath] = Field(default_factory=list)
    hiddenIncoming: int = 0
    hiddenOutgoing: int = 0
    hidden: int = Field(default=0, description="paths that exist below the detail level")
    totalIncoming: int = 0
    totalOutgoing: int = 0
    note: str | None = Field(default=None, description='"n paths hidden by the detail level", in words')


class FlowGraph(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]
    groups: list[FlowGroup] = Field(default_factory=list)
    overlays: list[FlowOverlay] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    paths: FlowPaths | None = Field(default=None, description="with focus: incoming and outgoing paths")


class FlowTypeReadiness(BaseModel):
    censoredShare: float | None = None
    replicatedShare: float | None = None
    medianDurationDays: float | None = None
    windowEnd: str | None = None
    headline: str


class FlowType(BaseModel):
    name: str
    cases: int
    share: float
    events: int
    activities: int
    map: FlowGraph
    readiness: FlowTypeReadiness
    scope: dict[str, Any] = Field(description="the run scope that analyses this flow type alone")


class AbsentFlowType(BaseModel):
    """A flow type the rules name that this log has none of, with the reason (R3-15)."""

    name: str
    reason: Literal["missing_column", "matches_nothing"]
    text: str | None = None


class FlowTypes(BaseModel):
    caseTableId: str
    attribute: str
    source: Literal["mapping", "attribute"]
    cases: int
    windowEnd: str | None = None
    caseNoun: str | None = None
    types: list[FlowType]
    absent: list[AbsentFlowType] = Field(
        default_factory=list, description="types the rules name that no case of this log carries, and why"
    )


class FlowTypeComparison(BaseModel):
    attribute: str
    views: list[str]
    overall: dict[str, dict[str, Any]]
    windowEnd: str | None = None
    caseNoun: str | None = None
    slicing: str | None = None
    types: list[dict[str, Any]]
    absent: list[AbsentFlowType] = Field(default_factory=list)


# ---------------------------------------------------------------------------- explore board (R3-O12)
FacetBy = Literal["attribute", "flow_type", "period"]


class FacetValue(BaseModel):
    model_config = ConfigDict(extra="allow")

    value: str
    label: str
    field: str | None = None
    cases: int
    share: float | None = Field(default=None, description="share of the selected cases carrying this value")
    mean_score: float | None = None
    cases_below: int | None = None
    share_below_expectation: float | None = Field(
        default=None, description="share of the value's scored cases that miss at least one expectation"
    )
    gap: float | None = None
    stable_gap: float | None = None
    PI: float | None = None
    priority_at_stake: float | None = Field(
        default=None, description="stabilised Priority Index of the value against the run's overall score"
    )
    open_cases: int | None = None
    open_share: float | None = Field(default=None, description="share still open at the window end")
    exposure: float | None = None


class Facets(BaseModel):
    by: FacetBy
    field: str = Field(description="the case attribute, the flow-type attribute or 'case start'")
    period: str | None = Field(default=None, description="month | quarter | year | week, for by=period")
    values: list[FacetValue]
    total: int = Field(description="how many values the facet has in this selection")
    shown: int
    cases: int = Field(description="cases the filter keeps")
    casesTotal: int = Field(description="cases in the run")
    belowMinCases: int = 0
    other: dict[str, Any] = Field(
        default_factory=dict, description="values not shown: how many, their cases and their priority"
    )
    params: dict[str, Any] = Field(default_factory=dict)


class KpiTile(BaseModel):
    id: str
    label: str
    value: float | None = None
    format: Literal["count", "share", "index", "points"] = "count"
    unit: str | None = None
    text: str = Field(description="the tile in one plain sentence")


class Kpis(BaseModel):
    tiles: list[KpiTile]
    cases: int
    casesTotal: int
    casesScored: int
    casesBelowExpectation: int
    meanScore: float | None = None
    baseline: float | None = None
    priorityAtStake: float
    groups: int
    openCases: int | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class ConstraintTouching(BaseModel):
    id: str
    type: str
    layer: str | None = None
    description: str | None = None
    plain_name: str | None = None
    hub_node: str | None = None


class ActivityProfile(BaseModel):
    id: str
    label: str
    onMap: bool = Field(description="whether the current detail level draws this activity")
    stage: str | None = None
    cases: int
    events: int
    shareOfCases: float | None = None
    metrics: dict[str, float] = Field(default_factory=dict)
    paths: FlowPaths
    constraintsTouching: list[ConstraintTouching] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class FilterPreview(BaseModel):
    cases_in: int
    cases_out: int
    per_clause: list[dict[str, Any]] = Field(default_factory=list)
    in_scope_by_constraint: dict[str, int] = Field(default_factory=dict)
    filter: dict[str, Any] | None = None


class SlicingPreview(BaseModel):
    attributes: list[str]
    effectiveAttributes: list[str] = Field(
        default_factory=list, description="key columns (banded reserved columns get ' band')"
    )
    bands: list[dict[str, Any]] = Field(default_factory=list)
    groups: int
    cases: int
    belowMinCases: int
    minCases: int
    sizes: dict[str, float]
    largest: list[dict[str, Any]] = Field(default_factory=list)


class AnalyticsStatus(BaseModel):
    runId: str
    status: str = Field(description="not_computed | done")
    package: dict[str, Any] = Field(default_factory=dict)
    jobId: str | None = None
    windowEnd: str | None = None
    manifest: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------- review records (R1-12, R1-15)
GateStatus = Literal["pending", "passed", "failed", "waived"]


class ActionEvidenceContext(BaseModel):
    """Server-recorded scope; it identifies evidence, not an approval or a current readiness verdict."""

    version: Literal[1] = 1
    runId: str
    normVersionId: str
    normFingerprint: str
    caseTableId: str
    contentHash: str
    paramsHash: str
    manifestFingerprint: str
    view: str
    slicing: str
    sliceKey: str
    filter: dict[str, Any] | None = None
    flowScope: dict[str, Any] | None = None
    scenario: str | None = None
    comparator: dict[str, Any]
    populationCases: int | None = Field(
        default=None,
        description="Number of items in the exact assessed group and filter; unavailable if the filter cannot be measured.",
    )
    selectionState: Literal["measured", "unavailable"] | None = None
    selectionFingerprint: str | None = None
    selectionReason: str | None = None


class ReviewItem(BaseModel):
    """A hypothesis, a gate decision, a finding or an action; the kind's own fields sit next to these."""

    model_config = ConfigDict(extra="allow")

    id: str
    projectId: str
    kind: Literal["hypothesis", "gate", "finding", "action"]
    status: str
    title: str = ""
    runId: str | None = None
    slicing: str | None = None
    sliceKey: str | None = None
    view: str | None = None
    author: str | None = None
    note: str | None = None
    createdAt: str
    updatedAt: str
    evidenceContext: ActionEvidenceContext | None = Field(default=None, json_schema_extra={"readOnly": True})
    evidenceState: Literal["unassessed", "recorded"] | None = Field(
        default=None,
        description="Recorded scope is not a readiness verdict. Missing on legacy records.",
        json_schema_extra={"readOnly": True},
    )
    commitmentCheck: dict[str, Any] | None = Field(
        default=None,
        description="Evidence and decisions checked at the last commitment write, not a promise of ongoing validity.",
        json_schema_extra={"readOnly": True},
    )


class ReviewItemUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str | None = None
    title: str | None = None
    note: str | None = None


class HypothesisCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    runId: str | None = None
    slicing: str | None = None
    sliceKey: str | None = None
    view: str | None = None
    constraint_id: str = Field(description="the expectation the hypothesis is about")
    comparison: Literal["group_vs_rest", "period", "subgroup"] = "group_vs_rest"
    expected_direction: Literal["higher", "lower", "none"] = "higher"
    statement_plain: str | None = Field(default=None, description="the hypothesis in the reader's own words")
    evidence_links: list[str] = Field(default_factory=list)
    outcome: Literal["open", "supported", "not_supported", "inconclusive"] = "open"
    author: str | None = None
    note: str | None = None


class FindingCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str
    runId: str | None = None
    slicing: str | None = None
    sliceKey: str | None = None
    view: str | None = None
    status: str = "open"
    evidence: list[str] = Field(default_factory=list)
    author: str | None = None
    note: str | None = None


class ActionCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str
    runId: str | None = None
    slicing: str | None = None
    sliceKey: str | None = None
    view: str | None = None
    filter: dict[str, Any] | str | None = Field(
        default=None,
        description="Saved case filter. Nonempty filters allow a proposal but cannot authorise commitment until exact filtered readiness is supported.",
    )
    mechanism: str | None = Field(default=None, description="what produces the shortfall")
    remedy: str | None = None
    countermeasure: (
        Literal[
            "policy",
            "system_setting",
            "standard_work",
            "training",
            "catalogue",
            "contract",
            "master_data",
            "automation",
            "review",
            "measurement",
        ]
        | None
    ) = None
    owner_role: str | None = None
    due: str | None = None
    status: Literal["proposed", "agreed", "in_progress", "done", "dropped"] = "proposed"
    links: list[str] = Field(default_factory=list)
    author: str | None = None
    note: str | None = None


class Gate(BaseModel):
    id: str
    kind: Literal["readiness", "censoring", "replication", "domain"]
    status: GateStatus
    computed_status: GateStatus | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)
    text: str
    note: str | None = None
    author: str | None = None
    decidedAt: str | None = None
    scope: Literal["run", "group"] | None = Field(
        default=None,
        description=(
            "`group` when the evidence is the group's own share; `run` when it is a property of the whole log, "
            "in which case the gate is stated once per run and decided once (R3-03)"
        ),
    )


class RunWideReadiness(BaseModel):
    """The readiness gate at the run: every check, and which of its failures no group can be judged on."""

    status: str = "unknown"
    failed: list[str] = Field(default_factory=list)
    warned: list[str] = Field(default_factory=list)
    logWideFailed: list[str] = Field(
        default_factory=list, description="failed checks that are the same for every group of this log"
    )
    checks: list[dict[str, Any]] = Field(default_factory=list)
    text: str = ""


class ReviewSelection(BaseModel):
    state: Literal["measured"]
    cases: int
    wholeGroupCases: int
    fingerprint: str
    decisionFingerprint: str | None = None


class Gates(BaseModel):
    runId: str
    slicing: str
    sliceKey: str
    view: str | None = None
    caseNoun: str | None = None
    cases: int | None = None
    filter: dict[str, Any] | None = None
    selection: ReviewSelection | None = None
    gates: list[Gate] = Field(default_factory=list)
    blocking: list[str] = Field(default_factory=list, description="gate ids that block saving a hypothesis or action")
    passed: bool = True
    runWide: RunWideReadiness | None = Field(
        default=None, description="the readiness gate stated once for the run, beside the group's own reading"
    )


class GateUpdate(BaseModel):
    status: GateStatus
    note: str | None = Field(default=None, description="mandatory when passing or waiving")
    author: str | None = None


class WhatCanWeDoDriver(BaseModel):
    model_config = ConfigDict(extra="allow")

    constraint_id: str
    plain_name: str | None = None
    hub_node: str | None = None
    share_of_shortfall: float | None = None
    comparison: str | None = Field(
        default=None,
        description=(
            "the shares missed here and elsewhere, with the difference of those two numbers in percentage "
            "points; one comparison, one bracket (R3-04)"
        ),
    )
    median_comparison: str | None = Field(
        default=None, description="the real-unit medians here and elsewhere, with the difference of the two"
    )
    measures_logging: str | None = Field(
        default=None,
        description="set when this expectation is missed mostly where an event is not logged (R3-14)",
    )
    headroom_points: float | None = Field(default=None, description="score points the group would gain")
    headroom_percent: float | None = None
    meaning_when_missed: str | None = None
    why_it_matters: str | None = None
    what_to_check_first: list[str] = Field(default_factory=list)
    usual_reasons: list[dict[str, Any]] = Field(default_factory=list)
    usual_actions: list[dict[str, Any]] = Field(default_factory=list)
    kpis: list[str] = Field(default_factory=list)
    note: str | None = None


class WhatCanWeDo(BaseModel):
    runId: str
    slicing: str
    sliceKey: str
    view: str | None = None
    caseNoun: str | None = None
    reading: str | None = None
    drivers: list[WhatCanWeDoDriver] = Field(default_factory=list)
    gates: list[Gate] = Field(default_factory=list)
    blocking: list[str] = Field(default_factory=list)
    actions: list[ReviewItem] = Field(default_factory=list)
    guidanceAvailable: bool = False


# ---------------------------------------------------------------------------- norm builder (R3-O6)


class GuidanceQuestion(BaseModel):
    id: str
    field: str
    question: str
    suggested: Any = Field(default=None, description="the pack's generic text, offered as a starting answer")
    answer: Any = Field(default=None, description="what the project has already answered")


class GuidanceQuestions(BaseModel):
    kind: str
    id: str | None = None
    questions: list[GuidanceQuestion] = Field(default_factory=list)


# ---------------------------------------------------------------------------- guidance and hub (RK-2, RK-3)
class GuidanceOverlay(BaseModel):
    """Your organisation's note on one entry; every field is optional and added to the generic tier."""

    model_config = ConfigDict(extra="forbid")

    note: str | None = None
    plain_name: str | None = None
    expectation: str | None = None
    meaning_when_missed: str | None = None
    why_it_matters: str | None = None
    usual_reasons: list[dict[str, Any]] | None = None
    usual_actions: list[dict[str, Any]] | None = None
    what_to_check_first: list[str] | None = None
    owner_role: str | None = None
    stakeholders: list[str] | None = None
    examples: list[dict[str, Any]] | None = None
    kpis: list[str] | None = None
    author: str | None = None


class Guidance(BaseModel):
    kind: str
    id: str
    generic: dict[str, Any] | None = Field(
        default=None,
        description=(
            "the pack's generic tier: plain_name, missed_label, expectation, meaning_when_missed, why_it_matters, "
            "how_detected, usual_reasons[], usual_actions[], what_to_check_first[], examples[], kpis[], owner_role, "
            "stakeholders, sources[], review_status, version"
        ),
    )
    overlay: dict[str, Any] | None = Field(default=None, description="the project's own note")
    hub_node: str | None = Field(default=None, description="the hub page to open for this entry")


class HubNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: str
    plain_name: str | None = None
    method_name: str | None = None
    hasOverlay: bool = False


class HubEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    from_: str = Field(alias="from")
    to: str
    kind: str


class HubIndex(BaseModel):
    pack: str | None = None
    process: str | None = None
    case_noun: str | None = None
    nodes: list[HubNode] = Field(default_factory=list)
    edges: list[HubEdge] = Field(default_factory=list)
    overlays: int = 0


class HubPage(BaseModel):
    node: dict[str, Any]
    guidance: dict[str, Any] | None = None
    related: dict[str, Any] = Field(
        default_factory=dict,
        description="stage, expectations[], failure_modes[], kpis[], playbook[], reasons[], actions[]",
    )
    overlay: dict[str, Any] | None = None
    process: str | None = None


class DecisionRequest(BaseModel):
    kind: str = Field(
        description="drop_outside_window | sentinel_as_missing | collapse_duplicates | day_precision | header_events | open_cases | zero_exposure | flow_type_assignment"
    )
    params: dict[str, Any] = Field(default_factory=dict)
    author: str | None = None
    note: str | None = None


class DecisionPreviewOut(BaseModel):
    kind: str
    params: dict[str, Any]
    readinessItem: str
    label: str
    preview: dict[str, Any] = Field(description="cases, events, totalCases, totalEvents, detail")
    caseTableId: str
    version: int


class Decision(BaseModel):
    id: str
    projectId: str
    caseTableId: str
    kind: str
    params: dict[str, Any]
    readinessItem: str
    version: int
    mappingId: str
    resultCaseTableId: str
    preview: dict[str, Any]
    author: str | None = None
    note: str | None = None
    createdAt: datetime

    @classmethod
    def from_domain(cls, d: DomainDecision) -> Decision:
        return cls(**{**d.to_dict(), "createdAt": d.created_at})


class DecisionItem(BaseModel):
    readinessItem: str
    kind: str
    label: str
    params: list[str] = Field(default_factory=list)
    options: dict[str, list[Any]] = Field(
        default_factory=dict, description="the values a parameter accepts, for the 'decide again' dialog"
    )
    selected: dict[str, Any] | None = Field(default=None, description="the parameters of the decision in force")
    currentValue: Any = Field(default=None, description="what the mapping carries for this item today")
    decided: bool = False
    canDecideAgain: bool = True
    note: str | None = None
    history: list[Decision] = Field(default_factory=list, description="every decision on this item, newest first")


class DecisionItems(BaseModel):
    """The readiness items with their full option set, the decision in force and its history (R3-O1)."""

    caseTableId: str = Field(description="the head of the lineage: where a new decision is applied")
    requestedCaseTableId: str
    mappingId: str | None = None
    version: int
    lineage: list[dict[str, Any]] = Field(
        default_factory=list, description="the chain of case tables the decisions built, oldest first"
    )
    items: list[DecisionItem] = Field(default_factory=list)


class DecisionApplied(BaseModel):
    decision: Decision
    caseTable: CaseTable
    job: Job
    appliedTo: str | None = Field(
        default=None, description="the case table the decision was applied to: the head of the lineage (R3-O3)"
    )


class DecisionKind(BaseModel):
    kind: str
    item: str
    params: list[str]
    label: str
    options: dict[str, list[Any]] = Field(default_factory=dict, description="the values a parameter accepts")
    default: dict[str, Any] = Field(default_factory=dict)
    note: str | None = None


class SnapshotCreate(BaseModel):
    title: str = Field(min_length=1)
    note: str = ""
    context: dict[str, Any] = Field(default_factory=dict, description="run_id, slicing, view, filters, url, screen")
    data: Any = None
    author: str | None = None


class SnapshotUpdate(BaseModel):
    title: str | None = None
    note: str | None = None
    context: dict[str, Any] | None = None
    data: Any = None
    author: str | None = None


class Snapshot(BaseModel):
    id: str
    projectId: str
    title: str
    note: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    data: Any = None
    hasImage: bool = False
    imageUrl: str | None = None
    order: int
    author: str | None = None
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_domain(cls, s: DomainSnapshot) -> Snapshot:
        base = f"/api/v1/projects/{s.project_id}/notebook/snapshots/{s.id}"
        return cls(
            id=s.id,
            projectId=s.project_id,
            title=s.title,
            note=s.note,
            context=dict(s.context),
            data=s.data,
            hasImage=bool(s.image_path),
            imageUrl=f"{base}/image" if s.image_path else None,
            order=s.order,
            author=s.author,
            createdAt=s.created_at,
            updatedAt=s.updated_at,
        )


class Notebook(BaseModel):
    projectId: str
    snapshots: list[Snapshot]
    exportFormats: list[str] = Field(default_factory=lambda: ["markdown"])


class SnapshotOrder(BaseModel):
    ids: list[str]


class Job(BaseModel):
    id: str
    kind: str
    status: Literal["queued", "running", "done", "failed", "cancelled"]
    progress: float = 0.0
    message: str | None = None
    attempts: int = 0
    resultRef: str | None = None
    error: str | None = None
    createdAt: datetime
    updatedAt: datetime
    projectId: str | None = None
    cancelRequested: bool = False

    @classmethod
    def from_domain(cls, j: DomainJob) -> Job:
        return cls(
            id=j.id,
            kind=str(j.kind),
            status=str(j.status),  # type: ignore[arg-type]
            progress=j.progress,
            message=j.message,
            attempts=j.attempts,
            resultRef=j.result_ref,
            error=j.error,
            createdAt=j.created_at,
            updatedAt=j.updated_at,
            projectId=j.project_id,
            cancelRequested=j.cancel_requested,
        )


# ---------------------------------------------------------------------------- what-if scenarios (R3-27, R1-11)
class Transform(BaseModel):
    """One step of a scenario's transform layer; the shape depends on `kind` (see the what-if documentation)."""

    model_config = ConfigDict(extra="allow")

    kind: Literal["cap_lag", "delete_activity", "move_event", "set_attribute", "keep_first"]
    where: dict[str, Any] | None = Field(
        default=None, description="canonical filter selecting the cases the step applies to; all of them without it"
    )


class NormChanges(BaseModel):
    """What a scenario changes in the baseline norm; the result becomes a norm version with its own fingerprint."""

    model_config = ConfigDict(extra="forbid")

    constraints: list[dict[str, Any]] = Field(
        default_factory=list,
        description="per expectation `{id, delta?, width?, applicability?}`: the fields to set on it",
    )
    add: list[dict[str, Any]] = Field(default_factory=list, description="whole expectations to add")
    remove: list[str] = Field(default_factory=list, description="expectation ids to drop")


class WhatIfCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="what the scenario is called on screen")
    transforms: list[Transform] = Field(default_factory=list)
    norm: NormChanges | None = None
    note: str | None = None
    author: str | None = None
    force: bool = Field(default=False, description="score again even when an identical scenario exists")


class TransformPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transforms: list[Transform] = Field(default_factory=list)


class TransformRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: str
    spec: dict[str, Any] = Field(default_factory=dict)
    casesSelected: int = 0
    casesTouched: int = 0
    eventsMoved: int = 0
    eventsRemoved: int = 0


class TransformPreview(BaseModel):
    runId: str
    caseNoun: str | None = None
    transforms: list[TransformRecord] = Field(default_factory=list)


class Scenario(BaseModel):
    runId: str
    name: str | None = None
    baselineRunId: str | None = None
    status: str
    note: str | None = None
    transforms: list[dict[str, Any]] = Field(default_factory=list)
    createdAt: str


class ChangeRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    keys: dict[str, Any] | None = None
    state: Literal["changed", "entered", "left"]
    baseline: dict[str, Any] | None = None
    scenario: dict[str, Any] | None = None
    deltaCases: float | None = None
    deltaMeanPoints: float | None = Field(default=None, description="scenario mean minus baseline mean, in points")
    deltaPriority: float | None = None
    deltaRank: float | None = Field(default=None, description="positive when the group moves up the list")
    unchanged: bool | None = None


class ChangeSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    groupsBaseline: int
    groupsScenario: int
    groupsCompared: int
    groupsChanged: int
    groupsUnchanged: int
    entered: list[str] = Field(default_factory=list)
    left: list[str] = Field(default_factory=list)
    topTenOverlap: float | None = None
    leaderBaseline: str | None = None
    leaderScenario: str | None = None
    priorityBaseline: float | None = None
    priorityScenario: float | None = None
    rankAgreement: float | None = Field(default=None, description="Spearman rank correlation of the two orders")
    largestMove: str | None = None
    text: str = ""


class ChangeTable(BaseModel):
    runId: str
    baselineRunId: str
    name: str | None = None
    note: str | None = None
    slicing: str
    view: str
    minCases: int
    caseNoun: str | None = None
    rows: list[ChangeRow] = Field(default_factory=list)
    total: int = 0
    summary: ChangeSummary
    transforms: list[dict[str, Any]] = Field(default_factory=list)
    normChanges: list[str] = Field(default_factory=list, description="one line per edit to the baseline norm")
    provenance: dict[str, Any] = Field(
        default_factory=dict, description="both runs with their fingerprints, so the comparison can be reproduced"
    )
