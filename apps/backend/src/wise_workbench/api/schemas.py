"""Pydantic models at the API boundary. Names and fields follow ``packages/api-schema/openapi.yaml``."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from wise_workbench.domain import CaseTable as DomainCaseTable
from wise_workbench.domain import ColumnMapping as DomainMapping
from wise_workbench.domain import DatasetVersion as DomainDataset
from wise_workbench.domain import Job as DomainJob
from wise_workbench.domain import NormVersion as DomainNormVersion
from wise_workbench.domain import Project as DomainProject
from wise_workbench.domain import Run as DomainRun


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


class Readiness(BaseModel):
    status: Literal["pass", "warn", "fail"]
    items: list[ReadinessItem] = Field(default_factory=list)


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
            readiness = Readiness(status=rd["status"], items=[ReadinessItem(**i) for i in rd["items"]])
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
    createdAt: datetime
    normId: str
    name: str
    views: list[str] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, n: DomainNormVersion) -> NormVersion:
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
    cases: int | None = None
    fingerprint: str | None = None


class SlicingSpec(BaseModel):
    id: str | None = None
    attributes: list[str] = Field(min_length=1)


class RunCreate(BaseModel):
    caseTableId: str
    normVersionId: str
    views: list[str] = Field(default_factory=list)
    slicings: list[SlicingSpec] = Field(default_factory=list)
    gamma: float = 50
    minCases: int = 20
    baselineRunId: str | None = None
    note: str | None = None


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


class Run(RunCreate):
    id: str
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
            slicings=[SlicingSpec(id=s.id, attributes=list(s.attributes)) for s in p.slicings],
            gamma=p.gamma,
            minCases=p.min_cases,
            baselineRunId=p.baseline_run_id,
            note=p.note,
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

    key: str = Field(description="JSON array of the slice's key values, e.g. [\"companyID_0000\", \"Packaging\"]")
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
    reading: str | None = None


class BacklogPage(BaseModel):
    rows: list[BacklogRow]
    total: int
    params: dict[str, Any]
    globalMean: float | None = None
    maxStablePI: float | None = Field(
        default=None, description="largest stable PI of the whole backlog (priority bars)"
    )


class WorstCase(BaseModel):
    caseId: str
    score: float | None = None
    violated: list[str] = Field(default_factory=list)


class SliceDetail(BaseModel):
    row: BacklogRow
    reading: str
    drivers: Table
    layers: Table
    penaltyMass: Table
    penaltyMassBy: str | None = None
    validation: dict[str, Any] = Field(default_factory=dict)
    worstCases: list[WorstCase] = Field(default_factory=list)
    headroom: Table
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


class Distribution(BaseModel):
    unit: str | None = None
    label: str | None = None
    constraintId: str | None = None
    type: str | None = None
    direction: str | None = None
    bins: list[DistributionBin] = Field(default_factory=list)
    ecdf: list[list[float]] = Field(default_factory=list)
    threshold: float | None = None
    width: float | None = None
    stats: dict[str, Any] = Field(default_factory=dict)
    slice: dict[str, Any] | None = None
    casesInScope: int | None = None
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


class FlowGraph(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]
    groups: list[FlowGroup] = Field(default_factory=list)
    overlays: list[FlowOverlay] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


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
