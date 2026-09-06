"""Loaders: pack files -> typed dataclasses.

``load_pack`` validates first (schema and cross references) and raises
``PackError`` with every issue when the pack is not valid, so that callers
never work on a half-consistent pack.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import (
    Activity,
    Dataset,
    DatasetRegistry,
    ExpectedOrdering,
    FailureMode,
    GlossaryTerm,
    Guidance,
    GuidanceAction,
    GuidanceExample,
    GuidanceReason,
    Kpi,
    LabelEntry,
    LabelPack,
    Layer,
    Mapping,
    Pack,
    Playbook,
    Preset,
    Role,
    SliceKey,
    SlicingGuide,
    Stage,
    StageModel,
    TemplateEntry,
    Variant,
    WisePattern,
)
from .paths import GUIDANCE_FILE, PACK_FILES, knowledge_root, pack_dir, preset_files
from .schema import ValidationIssue, read_yaml, validate_datasets, validate_pack


class PackError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("\n".join(str(i) for i in issues))


def _t(x: Any) -> tuple:
    return tuple(x or ())


def _text(x: Any) -> dict[str, str]:
    if x is None:
        return {}
    if isinstance(x, str):
        return {"en": x}
    return {str(k): str(v) for k, v in x.items()}


def _label_entry(e: dict[str, Any]) -> LabelEntry:
    return LabelEntry(
        label=str(e["label"]),
        activity=str(e["activity"]),
        lifecycle=e.get("lifecycle"),
        document_type=e.get("document_type"),
        subprocess=e.get("subprocess"),
        tcode=e.get("tcode"),
        note=e.get("note", ""),
    )


def _activity(a: dict[str, Any]) -> Activity:
    syn = a.get("synonyms", {}) or {}
    return Activity(
        id=a["id"],
        name=_text(a["name"]),
        stage=a["stage"],
        description=a["description"],
        synonyms={k: tuple(v) for k, v in syn.items()},
        object_types=_t(a.get("object_types")),
        granularity=a.get("granularity"),
        tags=_t(a.get("tags")),
        tcodes=_t(a.get("tcodes")),
        version=str(a.get("version", "1")),
        sources=_t(a.get("sources")),
        review_status=a.get("review_status", "draft"),
        notes=a.get("notes", ""),
    )


def _pattern(p: dict[str, Any]) -> WisePattern:
    return WisePattern(
        type=p["type"],
        layer=p["layer"],
        activities=_t(p.get("activities")),
        a=_t(p.get("a")),
        b=_t(p.get("b")),
        after=_t(p.get("after")),
        before=_t(p.get("before")),
        attribute=p.get("attribute"),
        params=dict(p.get("params", {}) or {}),
        applicability=p.get("applicability", ""),
        template=p.get("template"),
        also_templates=_t(p.get("also_templates")),
        constraint_ref=p.get("constraint_ref"),
        calibration=p.get("calibration"),
        note=p.get("note", ""),
    )


def _failure_mode(f: dict[str, Any]) -> FailureMode:
    return FailureMode(
        id=f["id"],
        version=str(f["version"]),
        name=_text(f["name"]),
        stage=f["stage"],
        kind=f.get("kind", "process_behaviour"),
        signature=f["signature"],
        signature_activities=_t(f.get("signature_activities")),
        wise_patterns=tuple(_pattern(p) for p in f["wise_patterns"]),
        observed_share=tuple(dict(s) for s in f.get("observed_share", []) or []),
        evidence=f["evidence"],
        typical_causes=_t(f["typical_causes"]),
        typical_remedies=_t(f["typical_remedies"]),
        evidence_to_check=_t(f["evidence_to_check"]),
        owner_role=f["owner_role"],
        kpis=_t(f.get("kpis")),
        sources=_t(f["sources"]),
        review_status=f["review_status"],
        notes=f.get("notes", ""),
    )


def _stage_model(doc: dict[str, Any]) -> StageModel:
    stages = tuple(
        Stage(
            id=s["id"],
            name=_text(s["name"]),
            order=int(s["order"]),
            description=s["description"],
            loops_allowed_to=_t(s.get("loops_allowed_to")),
            milestones=_t(s.get("milestones")),
        )
        for s in doc["stages"]
    )
    orderings = tuple(
        ExpectedOrdering(a=o["a"], b=o["b"], variants=_t(o.get("variants")), note=o.get("note", ""))
        for o in doc.get("expected_orderings", []) or []
    )
    variants = tuple(
        Variant(
            id=v["id"],
            name=_text(v["name"]),
            description=v["description"],
            stage_sequence=tuple(v["stage_sequence"]),
            flow_type_codes=dict(v.get("flow_type_codes", {}) or {}),
            applicability_hint=v.get("applicability_hint", ""),
            evidence=v.get("evidence", "none"),
            observed_share=v.get("observed_share"),
            notes=v.get("notes", ""),
        )
        for v in doc.get("variants", []) or []
    )
    return StageModel(
        stages=stages,
        expected_orderings=orderings,
        variants=variants,
        case_notion=dict(doc.get("case_notion", {}) or {}),
    )


def _kpi(k: dict[str, Any]) -> Kpi:
    return Kpi(
        id=k["id"],
        version=str(k["version"]),
        name=_text(k["name"]),
        definition=_text(k["definition"]),
        unit=k["unit"],
        direction=k["direction"],
        review_status=k["review_status"],
        formula=k.get("formula", ""),
        stage=k.get("stage"),
        activities=_t(k.get("activities")),
        failure_modes=_t(k.get("failure_modes")),
        wise_expressible=k.get("wise_expressible"),
        sources=_t(k.get("sources")),
        notes=k.get("notes", ""),
    )


def _term(t: dict[str, Any]) -> GlossaryTerm:
    return GlossaryTerm(
        id=t["id"],
        term=_text(t["term"]),
        definition=_text(t["definition"]),
        review_status=t["review_status"],
        version=str(t.get("version", "1")),
        aliases=_t(t.get("aliases")),
        activities=_t(t.get("activities")),
        stages=_t(t.get("stages")),
        failure_modes=_t(t.get("failure_modes")),
        sources=_t(t.get("sources")),
    )


def _playbook(p: dict[str, Any]) -> Playbook:
    hyp = p.get("hypotheses", {}) or {}
    return Playbook(
        id=p["id"],
        version=str(p["version"]),
        journey_stage=p["journey_stage"],
        title=_text(p["title"]),
        questions=tuple(_text(q) for q in p["questions"]),
        review_status=p["review_status"],
        audience=_t(p.get("audience")),
        hypotheses={k: tuple(v) for k, v in hyp.items()},
        workshop_script=_t(p.get("workshop_script")),
        failure_modes=_t(p.get("failure_modes")),
        stages=_t(p.get("stages")),
        sources=_t(p.get("sources")),
    )


def _slicing(doc: dict[str, Any]) -> SlicingGuide:
    roles = tuple(
        Role(id=r["id"], name=_text(r["name"]), description=r.get("description", ""), systems=_t(r.get("systems")))
        for r in doc["roles"]
    )
    keys = tuple(
        SliceKey(
            id=k["id"],
            name=_text(k["name"]),
            description=k["description"],
            owner_role=k["owner_role"],
            recommended=bool(k.get("recommended", True)),
            attributes=dict(k.get("attributes", {}) or {}),
            cardinality_hint=k.get("cardinality_hint", ""),
            min_cases_hint=k.get("min_cases_hint"),
            pitfalls=_t(k.get("pitfalls")),
            combine_with=_t(k.get("combine_with")),
        )
        for k in doc["slice_keys"]
    )
    return SlicingGuide(
        roles=roles,
        slice_keys=keys,
        never_slice_by=tuple(dict(n) for n in doc["never_slice_by"]),
        exposure=tuple(dict(e) for e in doc.get("exposure", []) or []),
        identification_pitfalls=_t(doc.get("identification_pitfalls")),
    )


def _templates(path: Path, doc: dict[str, Any] | None) -> tuple[TemplateEntry, ...]:
    if not doc:
        return ()
    return tuple(
        TemplateEntry(
            id=t["id"],
            file=t["file"],
            name=t["name"],
            description=t["description"],
            calibration=t["calibration"],
            activity_labels=t["activity_labels"],
            evidence=t["evidence"],
            review_status=t["review_status"],
            dataset=t.get("dataset"),
            verbatim=bool(t.get("verbatim", False)),
            derived_from=t.get("derived_from"),
            flow_type_attribute=t.get("flow_type_attribute"),
            flow_types=dict(t.get("flow_types", {}) or {}),
            sources=_t(t.get("sources")),
            notes=t.get("notes", ""),
            path=path / "templates" / t["file"],
        )
        for t in doc["templates"]
    )


def _guidance_entries(doc: dict[str, Any] | None) -> tuple[Guidance, ...]:
    """Entries of guidance.yaml with the file's defaults applied."""
    if not doc:
        return ()
    defaults = dict(doc.get("defaults", {}) or {})
    out: list[Guidance] = []
    for kind, key in (("layer", "layers"), ("constraint", "constraints"), ("failure_mode", "failure_modes")):
        for e in doc.get(key, []) or []:
            out.append(
                Guidance(
                    kind=kind,
                    id=str(e["id"]),
                    plain_name=_text(e["plain_name"]),
                    missed_label=_text(e.get("missed_label")),
                    expectation=e["expectation"],
                    meaning_when_missed=e["meaning_when_missed"],
                    why_it_matters=e["why_it_matters"],
                    how_detected=e["how_detected"],
                    usual_reasons=tuple(
                        GuidanceReason(text=r["text"], where=r["where"], check=r["check"]) for r in e["usual_reasons"]
                    ),
                    usual_actions=tuple(
                        GuidanceAction(
                            text=a["text"],
                            countermeasure=a["countermeasure"],
                            owner_role=a["owner_role"],
                            effect_area=a["effect_area"],
                        )
                        for a in e["usual_actions"]
                    ),
                    what_to_check_first=_t(e["what_to_check_first"]),
                    examples=tuple(
                        GuidanceExample(kind=x["kind"], text=x["text"], trace=x.get("trace")) for x in e["examples"]
                    ),
                    kpis=_t(e.get("kpis")),
                    owner_role=e["owner_role"],
                    stakeholders=str(e.get("stakeholders", defaults.get("stakeholders", ""))),
                    sources=_t(e.get("sources", defaults.get("sources"))),
                    review_status=str(e.get("review_status", defaults.get("review_status", "draft"))),
                    version=str(e.get("version", defaults.get("version", "1"))),
                    templates=_t(e.get("templates")),
                    aliases=dict(e.get("aliases", {}) or {}),
                    notes=e.get("notes", ""),
                )
            )
    return tuple(out)


def load_preset(path: str | Path) -> Preset:
    """A public-log preset file (``presets/*.yaml``)."""
    p = Path(path)
    d = read_yaml(p)
    return Preset(
        id=str(d["id"]),
        pack=str(d["pack"]),
        name=d["name"],
        description=d["description"],
        dataset=d["dataset"],
        file=d["file"],
        case_noun=_text(d["case_noun"]),
        mapping=dict(d["mapping"]),
        norm=dict(d["norm"]),
        slicings=tuple(dict(s) for s in d["slicings"]),
        derived_case_attributes=tuple(dict(a) for a in d.get("derived_case_attributes", []) or []),
        view=d.get("view"),
        gamma=d.get("gamma"),
        min_cases=d.get("min_cases"),
        pitfalls=_t(d.get("pitfalls")),
        local_only=bool(d.get("local_only", False)),
        sources=_t(d.get("sources")),
        review_status=d.get("review_status", "draft"),
        notes=d.get("notes", ""),
        path=p,
    )


def load_mapping(path: str | Path) -> Mapping:
    """A curated ``label -> canonical id`` mapping file (``mappings/*.yaml``)."""
    p = Path(path)
    doc = read_yaml(p)
    key = dict(doc.get("key", {}) or {})
    key.setdefault("label", "label")
    return Mapping(
        id=str(doc.get("id", p.stem)),
        pack=str(doc.get("pack", "")),
        dataset=doc.get("dataset"),
        key=key,
        entries=tuple(_label_entry(e) for e in doc["labels"]),
        sources=_t(doc.get("sources")),
        path=p,
    )


def load_pack(name_or_path: str | Path, validate: bool = True) -> Pack:
    """Load a pack by name (``p2p``) or directory; raises ``PackError`` on issues."""
    path = pack_dir(name_or_path)
    if validate:
        issues = [i for i in validate_pack(path) if i.level == "error"]
        if issues:
            raise PackError(issues)
    docs = {kind: read_yaml(path / f"{kind}.yaml") for kind in PACK_FILES}
    index = path / "templates" / "index.yaml"
    docs["templates"] = read_yaml(index) if index.is_file() else None
    guidance_file = path / f"{GUIDANCE_FILE}.yaml"
    docs["guidance"] = read_yaml(guidance_file) if guidance_file.is_file() else None
    ont = docs["ontology"]
    label_packs = {
        name: LabelPack(
            id=name,
            system=lp["system"],
            description=lp.get("description", ""),
            dataset=lp.get("dataset"),
            language=lp.get("language", "en"),
            sources=_t(lp.get("sources")),
            labels=tuple(_label_entry(e) for e in lp["labels"]),
        )
        for name, lp in ont["label_packs"].items()
    }
    mappings: dict[str, Mapping] = {}
    if (path / "mappings").is_dir():
        for mp in sorted((path / "mappings").glob("*.yaml")):
            m = load_mapping(mp)
            mappings[m.id] = m
    presets: dict[str, Preset] = {}
    for pp in preset_files(path):
        preset = load_preset(pp)
        presets[preset.id] = preset
    layers = tuple(
        Layer(
            id=layer["id"],
            name=_text(layer["name"]),
            description=layer.get("description", ""),
            template_layers=dict(layer.get("template_layers", {}) or {}),
        )
        for layer in docs["failure_modes"].get("layers", []) or []
    )
    return Pack(
        id=ont["pack"],
        path=path,
        process=ont["process"],
        description=ont.get("description", ""),
        version=str(ont["version"]),
        review_status=ont["review_status"],
        activities=tuple(_activity(a) for a in ont["activities"]),
        label_packs=label_packs,
        object_types=tuple(dict(o) for o in ont.get("object_types", []) or []),
        stage_model=_stage_model(docs["stages"]),
        layers=layers,
        failure_modes=tuple(_failure_mode(f) for f in docs["failure_modes"]["failure_modes"]),
        kpis=tuple(_kpi(k) for k in docs["kpis"]["kpis"]),
        glossary=tuple(_term(t) for t in docs["glossary"]["terms"]),
        playbooks=tuple(_playbook(p) for p in docs["playbooks"]["playbooks"]),
        slicing=_slicing(docs["slicing"]),
        templates=_templates(path, docs["templates"]),
        mappings=mappings,
        guidance=_guidance_entries(docs["guidance"]),
        presets=presets,
        sources=_t(ont.get("sources")),
        raw=docs,
    )


def load_datasets(path: str | Path | None = None, validate: bool = True) -> DatasetRegistry:
    p = Path(path) if path else knowledge_root() / "datasets.yaml"
    if validate:
        issues = [i for i in validate_datasets(p) if i.level == "error"]
        if issues:
            raise PackError(issues)
    doc = read_yaml(p)
    datasets = tuple(
        Dataset(
            id=d["id"],
            title=d["title"],
            pack=str(d["pack"]),
            doi=d.get("doi"),
            process=d.get("process", ""),
            formats=_t(d.get("formats")),
            checked=d.get("checked"),
            raw=d,
        )
        for d in doc["datasets"]
    )
    return DatasetRegistry(
        version=int(doc["version"]), licence_default=str(doc.get("licence_default", "")), datasets=datasets, path=p
    )


__all__ = ["PackError", "load_datasets", "load_mapping", "load_pack", "load_preset"]
