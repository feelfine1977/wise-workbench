"""Typed views of the pack files.

The dataclasses mirror the JSON Schemas in ``schema/``; they carry the raw
mapping in ``raw`` so that fields added to a pack before the loader learns
about them stay reachable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _text(value: Any) -> dict[str, str]:
    if value is None:
        return {}
    if isinstance(value, str):
        return {"en": value}
    return {str(k): str(v) for k, v in dict(value).items()}


@dataclass(frozen=True)
class LabelEntry:
    label: str
    activity: str
    lifecycle: str | None = None
    document_type: str | None = None
    subprocess: str | None = None
    tcode: str | None = None
    note: str = ""


@dataclass(frozen=True)
class LabelPack:
    id: str
    system: str
    labels: tuple[LabelEntry, ...]
    description: str = ""
    dataset: str | None = None
    language: str = "en"
    sources: tuple[Any, ...] = ()


@dataclass(frozen=True)
class Activity:
    id: str
    name: dict[str, str]
    stage: str
    description: str
    synonyms: dict[str, tuple[str, ...]] = field(default_factory=dict)
    object_types: tuple[str, ...] = ()
    granularity: str | None = None
    tags: tuple[str, ...] = ()
    tcodes: tuple[str, ...] = ()
    version: str = "1"
    sources: tuple[Any, ...] = ()
    review_status: str = "draft"
    notes: str = ""

    @property
    def name_en(self) -> str:
        return self.name.get("en", self.id)


@dataclass(frozen=True)
class Stage:
    id: str
    name: dict[str, str]
    order: int
    description: str
    loops_allowed_to: tuple[str, ...] = ()
    milestones: tuple[str, ...] = ()


@dataclass(frozen=True)
class Variant:
    id: str
    name: dict[str, str]
    description: str
    stage_sequence: tuple[str, ...]
    flow_type_codes: dict[str, str] = field(default_factory=dict)
    applicability_hint: str = ""
    evidence: Any = "none"
    observed_share: dict[str, Any] | None = None
    notes: str = ""


@dataclass(frozen=True)
class ExpectedOrdering:
    a: str
    b: str
    variants: tuple[str, ...] = ()
    note: str = ""


@dataclass(frozen=True)
class StageModel:
    stages: tuple[Stage, ...]
    expected_orderings: tuple[ExpectedOrdering, ...] = ()
    variants: tuple[Variant, ...] = ()
    case_notion: dict[str, Any] = field(default_factory=dict)

    def stage(self, stage_id: str) -> Stage:
        for s in self.stages:
            if s.id == stage_id:
                return s
        raise KeyError(stage_id)

    @property
    def ordered(self) -> tuple[Stage, ...]:
        return tuple(sorted(self.stages, key=lambda s: s.order))


@dataclass(frozen=True)
class WisePattern:
    type: str
    layer: str
    activities: tuple[str, ...] = ()
    a: tuple[str, ...] = ()
    b: tuple[str, ...] = ()
    after: tuple[str, ...] = ()
    before: tuple[str, ...] = ()
    attribute: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    applicability: str = ""
    template: str | None = None
    constraint_ref: str | None = None
    calibration: str | None = None
    note: str = ""

    def referenced_activities(self) -> tuple[str, ...]:
        seen: list[str] = []
        for group in (self.activities, self.a, self.b, self.after, self.before):
            for x in group:
                if x not in seen:
                    seen.append(x)
        return tuple(seen)


@dataclass(frozen=True)
class FailureMode:
    id: str
    version: str
    name: dict[str, str]
    stage: str
    signature: str
    wise_patterns: tuple[WisePattern, ...]
    evidence: Any
    typical_causes: tuple[str, ...]
    typical_remedies: tuple[str, ...]
    evidence_to_check: tuple[str, ...]
    owner_role: str
    sources: tuple[Any, ...]
    review_status: str
    signature_activities: tuple[str, ...] = ()
    observed_share: tuple[dict[str, Any], ...] = ()
    kpis: tuple[str, ...] = ()
    notes: str = ""

    @property
    def name_en(self) -> str:
        return self.name.get("en", self.id)

    @property
    def has_evidence(self) -> bool:
        return self.evidence != "none"


@dataclass(frozen=True)
class Layer:
    id: str
    name: dict[str, str]
    description: str = ""
    template_layers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Kpi:
    id: str
    version: str
    name: dict[str, str]
    definition: dict[str, str]
    unit: str
    direction: str
    review_status: str
    formula: str = ""
    stage: str | None = None
    activities: tuple[str, ...] = ()
    failure_modes: tuple[str, ...] = ()
    wise_expressible: bool | None = None
    sources: tuple[Any, ...] = ()
    notes: str = ""


@dataclass(frozen=True)
class GlossaryTerm:
    id: str
    term: dict[str, str]
    definition: dict[str, str]
    review_status: str
    version: str = "1"
    aliases: tuple[str, ...] = ()
    activities: tuple[str, ...] = ()
    stages: tuple[str, ...] = ()
    failure_modes: tuple[str, ...] = ()
    sources: tuple[Any, ...] = ()


@dataclass(frozen=True)
class Playbook:
    id: str
    version: str
    journey_stage: str
    title: dict[str, str]
    questions: tuple[dict[str, str], ...]
    review_status: str
    audience: tuple[str, ...] = ()
    hypotheses: dict[str, tuple[str, ...]] = field(default_factory=dict)
    workshop_script: tuple[str, ...] = ()
    failure_modes: tuple[str, ...] = ()
    stages: tuple[str, ...] = ()
    sources: tuple[Any, ...] = ()


@dataclass(frozen=True)
class Role:
    id: str
    name: dict[str, str]
    description: str = ""
    systems: tuple[str, ...] = ()


@dataclass(frozen=True)
class SliceKey:
    id: str
    name: dict[str, str]
    description: str
    owner_role: str
    recommended: bool = True
    attributes: dict[str, str] = field(default_factory=dict)
    cardinality_hint: str = ""
    min_cases_hint: int | None = None
    pitfalls: tuple[str, ...] = ()
    combine_with: tuple[str, ...] = ()


@dataclass(frozen=True)
class SlicingGuide:
    roles: tuple[Role, ...]
    slice_keys: tuple[SliceKey, ...]
    never_slice_by: tuple[dict[str, str], ...]
    exposure: tuple[dict[str, Any], ...] = ()
    identification_pitfalls: tuple[str, ...] = ()

    def role(self, role_id: str) -> Role:
        for r in self.roles:
            if r.id == role_id:
                return r
        raise KeyError(role_id)


@dataclass(frozen=True)
class TemplateEntry:
    id: str
    file: str
    name: str
    description: str
    calibration: str
    activity_labels: str
    evidence: Any
    review_status: str
    dataset: str | None = None
    flow_type_attribute: str | None = None
    flow_types: dict[str, str] = field(default_factory=dict)
    sources: tuple[Any, ...] = ()
    notes: str = ""
    path: Path | None = None


@dataclass(frozen=True)
class Mapping:
    """A curated label -> canonical id mapping (test oracle or preset)."""

    id: str
    pack: str
    dataset: str | None
    key: dict[str, str | None]
    entries: tuple[LabelEntry, ...]
    sources: tuple[Any, ...] = ()
    path: Path | None = None

    def as_dict(self) -> dict[str, str]:
        return {e.label: e.activity for e in self.entries}


@dataclass(frozen=True)
class Pack:
    id: str
    path: Path
    process: str
    description: str
    version: str
    review_status: str
    activities: tuple[Activity, ...]
    label_packs: dict[str, LabelPack]
    object_types: tuple[dict[str, Any], ...]
    stage_model: StageModel
    layers: tuple[Layer, ...]
    failure_modes: tuple[FailureMode, ...]
    kpis: tuple[Kpi, ...]
    glossary: tuple[GlossaryTerm, ...]
    playbooks: tuple[Playbook, ...]
    slicing: SlicingGuide
    templates: tuple[TemplateEntry, ...]
    mappings: dict[str, Mapping]
    sources: tuple[Any, ...] = ()
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    # ---- lookups
    def activity(self, activity_id: str) -> Activity:
        for a in self.activities:
            if a.id == activity_id:
                return a
        raise KeyError(activity_id)

    @property
    def activity_ids(self) -> tuple[str, ...]:
        return tuple(a.id for a in self.activities)

    @property
    def stages(self) -> tuple[Stage, ...]:
        return self.stage_model.ordered

    def failure_mode(self, fm_id: str) -> FailureMode:
        for fm in self.failure_modes:
            if fm.id == fm_id:
                return fm
        raise KeyError(fm_id)

    def failure_modes_for_constraint(self, constraint_ref: str, template: str | None = None) -> list[FailureMode]:
        out = []
        for fm in self.failure_modes:
            for p in fm.wise_patterns:
                if p.constraint_ref == constraint_ref and (template is None or p.template == template):
                    out.append(fm)
                    break
        return out

    def activities_in_stage(self, stage_id: str) -> tuple[Activity, ...]:
        return tuple(a for a in self.activities if a.stage == stage_id)

    def template(self, template_id: str) -> TemplateEntry:
        for t in self.templates:
            if t.id == template_id:
                return t
        raise KeyError(template_id)


@dataclass(frozen=True)
class Dataset:
    id: str
    title: str
    pack: str
    doi: str | None = None
    process: str = ""
    formats: tuple[str, ...] = ()
    checked: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True)
class DatasetRegistry:
    version: int
    licence_default: str
    datasets: tuple[Dataset, ...]
    path: Path | None = None

    def get(self, dataset_id: str) -> Dataset:
        for d in self.datasets:
            if d.id == dataset_id:
                return d
        raise KeyError(dataset_id)

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(d.id for d in self.datasets)


__all__ = [
    "Activity",
    "Dataset",
    "DatasetRegistry",
    "ExpectedOrdering",
    "FailureMode",
    "GlossaryTerm",
    "Kpi",
    "LabelEntry",
    "LabelPack",
    "Layer",
    "Mapping",
    "Pack",
    "Playbook",
    "Role",
    "SliceKey",
    "SlicingGuide",
    "Stage",
    "StageModel",
    "TemplateEntry",
    "Variant",
    "WisePattern",
]
