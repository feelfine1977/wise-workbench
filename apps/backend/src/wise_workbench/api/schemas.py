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
from wise_workbench.domain import NormVersion as DomainNormVersion
from wise_workbench.domain import Project as DomainProject
from wise_workbench.domain import Run as DomainRun
from wise_workbench.domain import Snapshot as DomainSnapshot


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
    flowTypeDefault: str = "other"
    closureActivities: list[str] = Field(default_factory=list)
    derivedAttributes: list[dict[str, Any]] = Field(default_factory=list, description="library derive recipes")
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


class NormVersionCreate(BaseModel):
    norm: dict[str, Any] = Field(description="library norm JSON")
    note: str
    parentId: str | None = None
    author: str | None = None


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
    createdAt: datetime
    normId: str
    name: str
    views: list[str] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, n: DomainNormVersion, guidance_complete: bool = False) -> NormVersion:
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
            createdAt=n.created_at,
            normId=n.norm_id,
            name=n.name,
            views=n.view_names,
        )


class NormStatusUpdate(BaseModel):
    status: Literal["draft", "reviewed", "approved"]


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
        default=None, description="one real-unit sentence from the top driver's contrast (top groups only)"
    )
    comparison_kind: Literal["lag", "count", "share", "metric", "rate"] | None = None
    caveats: list[Caveat] = Field(default_factory=list)
    n_caveats: int | None = None
    plain_layer: str | None = Field(default=None, description="the most-missed expectation area in plain words")
    layer_missed_label: str | None = Field(default=None, description="what it looks like when that area is missed")
    top_constraint_plain: str | None = None
    case_noun: str | None = Field(default=None, description='the business name of a case ("purchase order items")')
    points_below: str | None = Field(default=None, description='"0.9 points below the overall score of 84.4 (1 %)"')
    kind_source: Literal["analytics", "library"] | None = None
    reading: str | None = None
    reading_plain: str | None = Field(default=None, description="the one-sentence card reading (three numbers)")


class Caveat(BaseModel):
    id: str
    share: float | None = None
    status: str | None = None
    text: str
    window_end: str | None = None


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
    model_config = ConfigDict(extra="allow")


class FlowPaths(BaseModel):
    incoming: list[FlowPath] = Field(default_factory=list)
    outgoing: list[FlowPath] = Field(default_factory=list)


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


class FlowTypes(BaseModel):
    caseTableId: str
    attribute: str
    source: Literal["mapping", "attribute"]
    cases: int
    windowEnd: str | None = None
    caseNoun: str | None = None
    types: list[FlowType]


class FlowTypeComparison(BaseModel):
    attribute: str
    views: list[str]
    overall: dict[str, dict[str, Any]]
    windowEnd: str | None = None
    caseNoun: str | None = None
    slicing: str | None = None
    types: list[dict[str, Any]]


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


class DecisionApplied(BaseModel):
    decision: Decision
    caseTable: CaseTable
    job: Job


class DecisionKind(BaseModel):
    kind: str
    item: str
    params: list[str]
    label: str


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
