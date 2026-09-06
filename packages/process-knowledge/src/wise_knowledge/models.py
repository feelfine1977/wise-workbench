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

    @property
    def noun(self) -> dict[str, str]:
        """The business name of the case notion in plural ('purchase order items')."""
        return _text(self.case_notion.get("noun")) or {"en": "cases"}


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
    also_templates: tuple[str, ...] = ()
    constraint_ref: str | None = None
    calibration: str | None = None
    note: str = ""

    @property
    def templates(self) -> tuple[str, ...]:
        """Every template that carries this pattern's constraint (primary first)."""
        return ((self.template,) if self.template else ()) + tuple(t for t in self.also_templates if t != self.template)

    def in_template(self, template_id: str | None) -> bool:
        return template_id is None or template_id in self.templates

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
    kind: str = "process_behaviour"
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

    @property
    def is_data_quality(self) -> bool:
        return self.kind == "data_quality"


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
    verbatim: bool = False
    derived_from: str | None = None
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


GUIDANCE_KINDS = ("layer", "constraint", "failure_mode")
COUNTERMEASURES = (
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
)


@dataclass(frozen=True)
class GuidanceReason:
    """A candidate cause: in the log (with the check to run) or outside the log (whom to ask)."""

    text: str
    where: str
    check: str

    def as_dict(self) -> dict[str, str]:
        return {"text": self.text, "where": self.where, "check": self.check}


@dataclass(frozen=True)
class GuidanceAction:
    text: str
    countermeasure: str
    owner_role: str
    effect_area: str

    def as_dict(self) -> dict[str, str]:
        return {
            "text": self.text,
            "countermeasure": self.countermeasure,
            "owner_role": self.owner_role,
            "effect_area": self.effect_area,
        }


@dataclass(frozen=True)
class GuidanceExample:
    kind: str
    text: str
    trace: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "text": self.text, "trace": self.trace}


@dataclass(frozen=True)
class Guidance:
    """The generic tier of guidance for one layer, template constraint or failure mode (knowledge_hub_panel.md §1)."""

    kind: str
    id: str
    plain_name: dict[str, str]
    expectation: str
    meaning_when_missed: str
    why_it_matters: str
    how_detected: str
    usual_reasons: tuple[GuidanceReason, ...]
    usual_actions: tuple[GuidanceAction, ...]
    what_to_check_first: tuple[str, ...]
    examples: tuple[GuidanceExample, ...]
    kpis: tuple[str, ...]
    owner_role: str
    stakeholders: str
    sources: tuple[Any, ...]
    review_status: str
    version: str
    missed_label: dict[str, str] = field(default_factory=dict)
    templates: tuple[str, ...] = ()
    aliases: dict[str, str] = field(default_factory=dict)
    notes: str = ""

    @property
    def plain_name_en(self) -> str:
        return self.plain_name.get("en", self.id)

    @property
    def missed_label_en(self) -> str:
        return self.missed_label.get("en", "")

    def ids_in(self, template_id: str) -> tuple[str, ...]:
        """Constraint ids under which this guidance appears in a template."""
        if self.kind != "constraint":
            return ()
        out = [self.id] if template_id in self.templates else []
        alias = self.aliases.get(template_id)
        if alias and alias not in out:
            out.append(alias)
        return tuple(out)

    def as_block(self, **extra: Any) -> dict[str, Any]:
        """The ``GuidanceBlock`` shape of packages/api-schema/CONTRACT_CYCLE2.md."""
        block: dict[str, Any] = {
            "kind": self.kind,
            "id": self.id,
            "plain_name": self.plain_name_en,
            "plain_name_de": self.plain_name.get("de"),
            "missed_label": self.missed_label.get("en"),
            "missed_label_de": self.missed_label.get("de"),
            "expectation": self.expectation,
            "meaning_when_missed": self.meaning_when_missed,
            "why_it_matters": self.why_it_matters,
            "how_detected": self.how_detected,
            "usual_reasons": [r.as_dict() for r in self.usual_reasons],
            "usual_actions": [a.as_dict() for a in self.usual_actions],
            "what_to_check_first": list(self.what_to_check_first),
            "examples": [e.as_dict() for e in self.examples],
            "kpis": list(self.kpis),
            "owner_role": self.owner_role,
            "stakeholders": self.stakeholders,
            "sources": [s if isinstance(s, str) else dict(s) for s in self.sources],
            "review_status": self.review_status,
            "version": self.version,
        }
        if self.kind == "constraint":
            block["templates"] = list(self.templates)
        block.update(extra)
        return block


@dataclass(frozen=True)
class Preset:
    """A public log with its column mapping, prepared attributes, starting norm and slicings (presets/*.yaml)."""

    id: str
    pack: str
    name: str
    description: str
    dataset: str
    file: str
    case_noun: dict[str, str]
    mapping: dict[str, Any]
    norm: dict[str, Any]
    slicings: tuple[dict[str, Any], ...]
    derived_case_attributes: tuple[dict[str, Any], ...] = ()
    view: str | None = None
    gamma: float | None = None
    min_cases: int | None = None
    pitfalls: tuple[str, ...] = ()
    local_only: bool = False
    sources: tuple[Any, ...] = ()
    review_status: str = "draft"
    notes: str = ""
    path: Path | None = None

    @property
    def header_events(self) -> tuple[str, ...]:
        return tuple(self.mapping.get("header_events", ()) or ())

    @property
    def activity_mapping(self) -> str | None:
        return self.mapping.get("activity_mapping")


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
    guidance: tuple[Guidance, ...] = ()
    presets: dict[str, Preset] = field(default_factory=dict)
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
                if p.constraint_ref == constraint_ref and p.in_template(template):
                    out.append(fm)
                    break
        return out

    def layer(self, layer_id: str) -> Layer:
        for layer in self.layers:
            if layer.id == layer_id:
                return layer
        raise KeyError(layer_id)

    def layer_for_template(self, template_id: str, template_layer_id: str) -> Layer | None:
        """The pack layer that a template's layer id maps to (through ``template_layers``)."""
        for layer in self.layers:
            if layer.template_layers.get(template_id) == template_layer_id or layer.id == template_layer_id:
                return layer
        return None

    def guidance_for(self, kind: str, entry_id: str, template: str | None = None) -> Guidance | None:
        """Generic-tier guidance by kind and id.

        Layers resolve pack layer ids and template layer ids; constraints resolve
        the constraint id in any of the pack's templates (or in ``template`` only),
        including alias ids of derived templates.
        """
        if kind not in GUIDANCE_KINDS:
            raise KeyError(f"unknown guidance kind {kind!r}; known {GUIDANCE_KINDS}")
        if kind == "layer":
            for g in self.guidance:
                if g.kind == "layer" and g.id == entry_id:
                    return g
            for layer in self.layers:
                if entry_id in layer.template_layers.values() and (
                    template is None or layer.template_layers.get(template) == entry_id
                ):
                    return self.guidance_for("layer", layer.id)
            return None
        if kind == "failure_mode":
            return next((g for g in self.guidance if g.kind == "failure_mode" and g.id == entry_id), None)
        for g in self.guidance:
            if g.kind != "constraint":
                continue
            templates = [template] if template else [*g.templates, *g.aliases]
            for t in templates:
                if entry_id in g.ids_in(t):
                    return g
        return None

    def template_ids(self) -> tuple[str, ...]:
        return tuple(t.id for t in self.templates)

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
    "COUNTERMEASURES",
    "GUIDANCE_KINDS",
    "Activity",
    "Dataset",
    "DatasetRegistry",
    "ExpectedOrdering",
    "FailureMode",
    "GlossaryTerm",
    "Guidance",
    "GuidanceAction",
    "GuidanceExample",
    "GuidanceReason",
    "Kpi",
    "LabelEntry",
    "LabelPack",
    "Layer",
    "Mapping",
    "Pack",
    "Playbook",
    "Preset",
    "Role",
    "SliceKey",
    "SlicingGuide",
    "Stage",
    "StageModel",
    "TemplateEntry",
    "Variant",
    "WisePattern",
]
