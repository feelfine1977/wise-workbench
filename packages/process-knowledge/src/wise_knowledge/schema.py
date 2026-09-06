"""JSON Schema validation of pack files, template norms and the datasets registry.

Two levels: the JSON Schemas in ``schema/`` (structure), then cross-reference
checks that a schema cannot express (stage ids exist, label packs point to
known activities, failure modes reference known roles, template files load
with the ``wise`` library when it is installed).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

from .paths import GUIDANCE_FILE, PACK_FILES, knowledge_root, pack_dir, preset_files, schema_dir

SCHEMA_KINDS = (*PACK_FILES, "templates", GUIDANCE_FILE, "presets", "datasets")
GUIDANCE_BLOCKS = (
    "plain_name",
    "expectation",
    "meaning_when_missed",
    "why_it_matters",
    "how_detected",
    "usual_reasons",
    "usual_actions",
    "what_to_check_first",
    "examples",
    "kpis",
    "owner_role",
    "stakeholders",
    "sources",
    "review_status",
    "version",
)


@dataclass(frozen=True)
class ValidationIssue:
    file: str
    message: str
    path: str = ""
    level: str = "error"

    def __str__(self) -> str:
        where = f" at {self.path}" if self.path else ""
        return f"[{self.level}] {self.file}{where}: {self.message}"


class _Loader(yaml.SafeLoader):
    """SafeLoader that keeps dates and timestamps as strings (the schemas expect ISO strings)."""


_Loader.yaml_implicit_resolvers = {
    first: [(tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def read_yaml(path: Path) -> Any:
    with Path(path).open(encoding="utf-8") as fh:
        return yaml.load(fh, Loader=_Loader)


@lru_cache(maxsize=1)
def _registry() -> Registry:
    resources = []
    for p in sorted(schema_dir().glob("*.schema.json")):
        doc = json.loads(p.read_text(encoding="utf-8"))
        res = Resource.from_contents(doc)
        resources.append((doc["$id"], res))
        resources.append((p.name, res))
    return Registry().with_resources(resources)


@cache
def validator(kind: str) -> Draft202012Validator:
    if kind not in SCHEMA_KINDS:
        raise KeyError(f"unknown schema kind {kind!r}; known {SCHEMA_KINDS}")
    schema = json.loads((schema_dir() / f"{kind}.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=_registry())


def _json_path(error: ValidationError) -> str:
    return "/".join(str(x) for x in error.absolute_path)


def validate_document(kind: str, document: Any, file: str = "") -> list[ValidationIssue]:
    issues = []
    for err in sorted(validator(kind).iter_errors(document), key=lambda e: list(e.absolute_path)):
        issues.append(ValidationIssue(file=file or kind, message=err.message, path=_json_path(err)))
    return issues


def validate_file(kind: str, path: Path) -> list[ValidationIssue]:
    try:
        doc = read_yaml(path)
    except yaml.YAMLError as exc:
        return [ValidationIssue(file=str(path), message=f"YAML error: {exc}")]
    return validate_document(kind, doc, file=str(path))


# --------------------------------------------------------------------------- cross references
def _ids(items: Iterable[dict[str, Any]]) -> list[str]:
    return [str(x["id"]) for x in items]


def _dupes(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        if x in seen and x not in out:
            out.append(x)
        seen.add(x)
    return out


def _cross_check(path: Path, docs: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    ont, stg, fms = docs["ontology"], docs["stages"], docs["failure_modes"]
    kpis, glo, plb, slc = docs["kpis"], docs["glossary"], docs["playbooks"], docs["slicing"]
    tpl = docs.get("templates")
    pack_id = ont["pack"]

    def err(file: str, message: str, where: str = "") -> None:
        issues.append(ValidationIssue(file=str(path / f"{file}.yaml"), message=message, path=where))

    for name, doc in docs.items():
        if doc is not None and doc.get("pack") != pack_id:
            err(name, f"pack id {doc.get('pack')!r} differs from ontology pack {pack_id!r}", "pack")

    activity_ids = _ids(ont["activities"])
    for d in _dupes(activity_ids):
        err("ontology", f"duplicate activity id {d!r}")
    stage_ids = _ids(stg["stages"])
    for d in _dupes(stage_ids):
        err("stages", f"duplicate stage id {d!r}")
    orders = [s["order"] for s in stg["stages"]]
    if len(set(orders)) != len(orders):
        err("stages", "stage orders are not unique")
    role_ids = _ids(slc["roles"])
    for d in _dupes(role_ids):
        err("slicing", f"duplicate role id {d!r}")
    fm_ids = _ids(fms["failure_modes"])
    for d in _dupes(fm_ids):
        err("failure_modes", f"duplicate failure mode id {d!r}")
    kpi_ids = _ids(kpis["kpis"])
    for d in _dupes(kpi_ids):
        err("kpis", f"duplicate kpi id {d!r}")
    layer_ids = _ids(fms.get("layers", []))
    template_ids = _ids(tpl["templates"]) if tpl else []
    activity_set, stage_set, role_set = set(activity_ids), set(stage_ids), set(role_ids)

    for i, a in enumerate(ont["activities"]):
        if not a["id"].startswith(f"{pack_id}."):
            err("ontology", f"activity id {a['id']!r} should start with {pack_id + '.'!r}", f"activities/{i}/id")
        if a["stage"] not in stage_set:
            err("ontology", f"activity {a['id']!r} refers to unknown stage {a['stage']!r}", f"activities/{i}/stage")
    for pack_name, lp in ont["label_packs"].items():
        seen_keys: set[tuple[str, ...]] = set()
        for j, entry in enumerate(lp["labels"]):
            where = f"label_packs/{pack_name}/labels/{j}"
            if entry["activity"] not in activity_set:
                err("ontology", f"label {entry['label']!r} maps to unknown activity {entry['activity']!r}", where)
            key = (
                entry["label"],
                entry.get("lifecycle") or "",
                entry.get("document_type") or "",
                entry.get("subprocess") or "",
            )
            if key in seen_keys:
                err("ontology", f"duplicate label key {key!r} in label pack {pack_name!r}", where)
            seen_keys.add(key)

    for i, s in enumerate(stg["stages"]):
        for t in s.get("loops_allowed_to", []):
            if t not in stage_set:
                err("stages", f"stage {s['id']!r} loops to unknown stage {t!r}", f"stages/{i}")
        for m in s.get("milestones", []):
            if m not in activity_set:
                err("stages", f"stage {s['id']!r} milestone {m!r} is not an activity", f"stages/{i}")
    variant_ids = _ids(stg.get("variants", []))
    for i, v in enumerate(stg.get("variants", [])):
        for sid in v["stage_sequence"]:
            if sid not in stage_set:
                err("stages", f"variant {v['id']!r} uses unknown stage {sid!r}", f"variants/{i}")
    for i, o in enumerate(stg.get("expected_orderings", [])):
        for side in ("a", "b"):
            if o[side] not in activity_set:
                err(
                    "stages",
                    f"expected ordering refers to unknown activity {o[side]!r}",
                    f"expected_orderings/{i}/{side}",
                )
        for v in o.get("variants", []):
            if v not in variant_ids:
                err("stages", f"expected ordering refers to unknown variant {v!r}", f"expected_orderings/{i}")

    for i, fm in enumerate(fms["failure_modes"]):
        where = f"failure_modes/{i}"
        if not fm["id"].startswith(f"{pack_id}.fm."):
            err("failure_modes", f"failure mode id {fm['id']!r} should start with {pack_id + '.fm.'!r}", where)
        if fm["stage"] not in stage_set:
            err("failure_modes", f"failure mode {fm['id']!r} refers to unknown stage {fm['stage']!r}", where)
        if fm["owner_role"] not in role_set:
            err("failure_modes", f"failure mode {fm['id']!r} refers to unknown role {fm['owner_role']!r}", where)
        for a in fm.get("signature_activities", []):
            if a not in activity_set:
                err("failure_modes", f"failure mode {fm['id']!r} signature refers to unknown activity {a!r}", where)
        for k in fm.get("kpis", []):
            if k not in kpi_ids:
                err("failure_modes", f"failure mode {fm['id']!r} refers to unknown kpi {k!r}", where)
        if fm["evidence"] == "none" and fm.get("observed_share"):
            err("failure_modes", f"failure mode {fm['id']!r} has observed shares but evidence 'none'", where)
        for j, p in enumerate(fm["wise_patterns"]):
            pw = f"{where}/wise_patterns/{j}"
            for a in [
                *p.get("activities", []),
                *p.get("a", []),
                *p.get("b", []),
                *p.get("after", []),
                *p.get("before", []),
            ]:
                if a not in activity_set:
                    err("failure_modes", f"pattern refers to unknown activity {a!r}", pw)
            if p["type"] in ("presence", "exclusion", "singularity") and not p.get("activities"):
                err("failure_modes", f"{p['type']} pattern needs 'activities'", pw)
            if p["type"] in ("lag", "precedence") and not (p.get("a") and p.get("b")):
                err("failure_modes", f"{p['type']} pattern needs 'a' and 'b'", pw)
            if p["type"] == "metric" and not p.get("attribute"):
                err("failure_modes", "metric pattern needs 'attribute'", pw)
            if layer_ids and p["layer"] not in layer_ids:
                err("failure_modes", f"pattern uses unknown layer {p['layer']!r}", pw)
            if p.get("template") and template_ids and p["template"] not in template_ids:
                err("failure_modes", f"pattern refers to unknown template {p['template']!r}", pw)
            for extra in p.get("also_templates", []) or []:
                if template_ids and extra not in template_ids:
                    err("failure_modes", f"pattern refers to unknown template {extra!r} in also_templates", pw)
                if not p.get("template"):
                    err("failure_modes", "also_templates needs a primary template", pw)
            if p.get("constraint_ref") and not p.get("template"):
                err("failure_modes", "constraint_ref needs a template", pw)

    for i, k in enumerate(kpis["kpis"]):
        for fm_id in k.get("failure_modes", []):
            if fm_id not in fm_ids:
                err("kpis", f"kpi {k['id']!r} refers to unknown failure mode {fm_id!r}", f"kpis/{i}")
        for a in k.get("activities", []):
            if a not in activity_set:
                err("kpis", f"kpi {k['id']!r} refers to unknown activity {a!r}", f"kpis/{i}")
        if k.get("stage") and k["stage"] not in stage_set:
            err("kpis", f"kpi {k['id']!r} refers to unknown stage {k['stage']!r}", f"kpis/{i}")
    for i, t in enumerate(glo["terms"]):
        for a in t.get("activities", []):
            if a not in activity_set:
                err("glossary", f"term {t['id']!r} refers to unknown activity {a!r}", f"terms/{i}")
        for s in t.get("stages", []):
            if s not in stage_set:
                err("glossary", f"term {t['id']!r} refers to unknown stage {s!r}", f"terms/{i}")
        for f in t.get("failure_modes", []):
            if f not in fm_ids:
                err("glossary", f"term {t['id']!r} refers to unknown failure mode {f!r}", f"terms/{i}")
    for i, pb in enumerate(plb["playbooks"]):
        for f in pb.get("failure_modes", []):
            if f not in fm_ids:
                err("playbooks", f"playbook {pb['id']!r} refers to unknown failure mode {f!r}", f"playbooks/{i}")
        for s in pb.get("stages", []):
            if s not in stage_set:
                err("playbooks", f"playbook {pb['id']!r} refers to unknown stage {s!r}", f"playbooks/{i}")
    for i, sk in enumerate(slc["slice_keys"]):
        if sk["owner_role"] not in role_set:
            err("slicing", f"slice key {sk['id']!r} refers to unknown role {sk['owner_role']!r}", f"slice_keys/{i}")
        for c in sk.get("combine_with", []):
            if c not in _ids(slc["slice_keys"]):
                err("slicing", f"slice key {sk['id']!r} combines with unknown key {c!r}", f"slice_keys/{i}")

    # every template referenced by a pattern must exist and vice versa every template constraint should be catalogued
    if tpl:
        for i, t in enumerate(tpl["templates"]):
            tp = path / "templates" / t["file"]
            if not tp.is_file():
                err("templates", f"template file {t['file']!r} not found", f"templates/{i}")
    return issues


def template_constraints(path: Path, tpl: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Template id -> {"layers": [layer ids], "constraints": {constraint id -> layer id}} read from the JSON files."""
    out: dict[str, dict[str, Any]] = {}
    for t in (tpl or {}).get("templates", []) or []:
        tp = path / "templates" / t["file"]
        if not tp.is_file():
            continue
        try:
            doc = json.loads(tp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        layers = doc.get("layers", [])
        layer_ids = [x["id"] for x in layers] if isinstance(layers, list) else list(layers)
        out[t["id"]] = {
            "layers": layer_ids,
            "constraints": {c["id"]: c.get("layer") for c in doc.get("constraints", [])},
        }
    return out


def _guidance_issues(path: Path, docs: dict[str, Any]) -> list[ValidationIssue]:
    """Cross references and completeness of guidance.yaml.

    Every pack layer, every constraint of every template and every failure mode
    needs exactly one entry; entries resolve roles, layers and KPIs; every usual
    reason says where it is checked; every action names a countermeasure; the
    examples show a violating and a compliant case; layers carry a missed label.
    """
    issues: list[ValidationIssue] = []
    doc = docs.get(GUIDANCE_FILE)
    tpl = docs.get("templates")
    file = str(path / f"{GUIDANCE_FILE}.yaml")
    if doc is None:
        if tpl:
            issues.append(
                ValidationIssue(file=file, message="missing guidance.yaml (a pack with templates needs guidance)")
            )
        return issues

    def err(message: str, where: str = "") -> None:
        issues.append(ValidationIssue(file=file, message=message, path=where))

    fms = docs["failure_modes"]
    layer_ids = _ids(fms.get("layers", []))
    fm_ids = _ids(fms["failure_modes"])
    role_ids = set(_ids(docs["slicing"]["roles"]))
    kpi_ids = set(_ids(docs["kpis"]["kpis"]))
    templates = template_constraints(path, tpl)
    defaults = doc.get("defaults", {}) or {}

    def check_blocks(e: dict[str, Any], where: str) -> None:
        for block in ("stakeholders", "sources", "review_status", "version"):
            if block not in e and block not in defaults:
                err(f"entry {e.get('id')!r} lacks {block!r} (not in the entry, not in defaults)", where)
        if e.get("owner_role") not in role_ids:
            err(f"entry {e.get('id')!r} refers to unknown owner role {e.get('owner_role')!r}", where)
        for k in e.get("kpis", []) or []:
            if k not in kpi_ids:
                err(f"entry {e.get('id')!r} refers to unknown kpi {k!r}", where)
        for i, a in enumerate(e.get("usual_actions", []) or []):
            if a.get("owner_role") not in role_ids:
                err(f"action {i} of {e.get('id')!r} names unknown owner role {a.get('owner_role')!r}", where)
            if a.get("effect_area") not in layer_ids:
                err(f"action {i} of {e.get('id')!r} names unknown effect area {a.get('effect_area')!r}", where)
        kinds = {x.get("kind") for x in e.get("examples", []) or []}
        if not {"violating", "compliant"} <= kinds:
            err(f"entry {e.get('id')!r} needs a violating and a compliant example", where)
        text = " ".join(
            str(e.get(b, "")) for b in ("expectation", "meaning_when_missed", "why_it_matters", "how_detected")
        )
        for cid in _constraint_id_mentions(text):
            err(f"entry {e.get('id')!r} names constraint id {cid!r} in a plain-language block", where)

    seen_layers: list[str] = []
    for i, e in enumerate(doc.get("layers", []) or []):
        where = f"layers/{i}"
        check_blocks(e, where)
        if e["id"] not in layer_ids:
            err(f"layer guidance {e['id']!r} is not a layer of failure_modes.yaml", where)
        if e["id"] in seen_layers:
            err(f"duplicate layer guidance {e['id']!r}", where)
        seen_layers.append(e["id"])
        if not e.get("missed_label"):
            err(f"layer guidance {e['id']!r} needs a missed_label", where)
    for lid in layer_ids:
        if lid not in seen_layers:
            err(f"layer {lid!r} has no guidance")

    covered: dict[tuple[str, str], str] = {}
    for i, e in enumerate(doc.get("constraints", []) or []):
        where = f"constraints/{i}"
        check_blocks(e, where)
        pairs = [(t, e["id"]) for t in e["templates"]] + list((e.get("aliases", {}) or {}).items())
        for t, cid in pairs:
            if t not in templates:
                err(f"constraint guidance {e['id']!r} refers to unknown template {t!r}", where)
                continue
            if cid not in templates[t]["constraints"]:
                err(f"constraint guidance {e['id']!r}: template {t!r} has no constraint {cid!r}", where)
                continue
            if (t, cid) in covered:
                err(
                    f"constraint {cid!r} of template {t!r} has guidance twice ({covered[(t, cid)]!r} and {e['id']!r})",
                    where,
                )
            covered[(t, cid)] = e["id"]
    for t, info in templates.items():
        missing = sorted(cid for cid in info["constraints"] if (t, cid) not in covered)
        if missing:
            err(f"template {t!r}: constraints without guidance {missing}")
        layer_map = {layer["id"]: layer.get("template_layers", {}).get(t) for layer in fms.get("layers", [])}
        for tl in info["layers"]:
            if tl not in layer_map.values() and tl not in layer_map:
                err(f"template {t!r}: layer {tl!r} maps to no pack layer (template_layers) and has no guidance")

    seen_fms: list[str] = []
    for i, e in enumerate(doc.get("failure_modes", []) or []):
        where = f"failure_modes/{i}"
        check_blocks(e, where)
        if e["id"] not in fm_ids:
            err(f"failure-mode guidance {e['id']!r} is not a failure mode of failure_modes.yaml", where)
        if e["id"] in seen_fms:
            err(f"duplicate failure-mode guidance {e['id']!r}", where)
        seen_fms.append(e["id"])
    for fid in fm_ids:
        if fid not in seen_fms:
            err(f"failure mode {fid!r} has no guidance")
    return issues


_CONSTRAINT_ID_RX = re.compile(r"\b(?:c_l\d+_[a-z0-9_]+|b_[a-z]+_[a-z0-9_]+|o_[a-z]+_[a-z0-9_]+)\b")


def _constraint_id_mentions(text: str) -> list[str]:
    """Tokens that look like template constraint ids (``c_l3_...``, ``b_time_...``, ``o_deliv_...``)."""
    return _CONSTRAINT_ID_RX.findall(text)


def _preset_issues(path: Path, docs: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    pack_id = docs["ontology"]["pack"]
    template_ids = set(_ids(docs["templates"]["templates"])) if docs.get("templates") else set()
    slice_ids = set(_ids(docs["slicing"]["slice_keys"]))
    mapping_ids = {mp.stem for mp in (path / "mappings").glob("*.yaml")} if (path / "mappings").is_dir() else set()
    try:
        registry = read_yaml(knowledge_root() / "datasets.yaml")
        dataset_ids = {d["id"] for d in registry.get("datasets", [])}
    except (OSError, yaml.YAMLError):
        dataset_ids = set()
    for pp in preset_files(path):
        file_issues = validate_file("presets", pp)
        issues.extend(file_issues)
        if file_issues:
            continue
        doc = read_yaml(pp)
        file = str(pp)
        if doc.get("pack") != pack_id:
            issues.append(
                ValidationIssue(file=file, message=f"preset pack {doc.get('pack')!r} differs from {pack_id!r}")
            )
        if doc["norm"]["template"] not in template_ids:
            issues.append(
                ValidationIssue(file=file, message=f"preset refers to unknown template {doc['norm']['template']!r}")
            )
        am = doc["mapping"].get("activity_mapping")
        if am and am not in mapping_ids:
            issues.append(ValidationIssue(file=file, message=f"preset refers to unknown activity mapping {am!r}"))
        if dataset_ids and doc["dataset"] not in dataset_ids:
            issues.append(ValidationIssue(file=file, message=f"preset refers to unknown dataset {doc['dataset']!r}"))
        for i, sl in enumerate(doc["slicings"]):
            if sl["id"] not in slice_ids:
                issues.append(
                    ValidationIssue(
                        file=file,
                        message=f"slicing {sl['id']!r} is not a slice key of slicing.yaml",
                        path=f"slicings/{i}",
                    )
                )
        aliases = doc["mapping"].get("attribute_aliases", {}) or {}
        prepared = {a["name"] for a in doc.get("derived_case_attributes", []) or []}
        case_attrs = set(doc["mapping"].get("case_attributes", []) or [])
        for name, column in aliases.items():
            if column not in case_attrs and column not in prepared:
                issues.append(
                    ValidationIssue(
                        file=file,
                        message=f"attribute alias {name!r} -> {column!r} is neither a mapped case attribute nor a prepared attribute",
                        level="warning",
                    )
                )
    return issues


def _template_issues(path: Path, tpl: dict[str, Any] | None, activity_ids: set[str]) -> list[ValidationIssue]:
    """Load every template with the ``wise`` library when it is installed."""
    issues: list[ValidationIssue] = []
    if not tpl:
        return issues
    try:
        from wise import Norm
        from wise.errors import NormError
    except ImportError:
        issues.append(
            ValidationIssue(
                file=str(path / "templates"),
                message="wise not installed; template norms not validated",
                level="warning",
            )
        )
        return issues
    for t in tpl["templates"]:
        tp = path / "templates" / t["file"]
        if not tp.is_file():
            continue
        try:
            norm = Norm.from_dict(json.loads(tp.read_text(encoding="utf-8")))
            norm.validate()
        except (NormError, ValueError, json.JSONDecodeError) as exc:
            issues.append(ValidationIssue(file=str(tp), message=f"template does not load with wise: {exc}"))
            continue
        if t["activity_labels"] == "canonical_ids":
            unknown = sorted(set(norm.activities()) - activity_ids)
            if unknown:
                issues.append(ValidationIssue(file=str(tp), message=f"template uses unknown canonical ids {unknown}"))
        if t["calibration"] == "uncalibrated":
            meta = (norm.metadata or {}).get("meta", {})
            if meta.get("calibration") != "uncalibrated":
                issues.append(
                    ValidationIssue(
                        file=str(tp),
                        message="uncalibrated template must carry metadata.meta.calibration = 'uncalibrated'",
                    )
                )
    return issues


def _mapping_issues(path: Path, activity_ids: set[str]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for mp in sorted((path / "mappings").glob("*.yaml")) if (path / "mappings").is_dir() else []:
        try:
            doc = read_yaml(mp)
        except yaml.YAMLError as exc:
            issues.append(ValidationIssue(file=str(mp), message=f"YAML error: {exc}"))
            continue
        if not isinstance(doc, dict) or "labels" not in doc:
            issues.append(ValidationIssue(file=str(mp), message="mapping needs a 'labels' list"))
            continue
        for i, e in enumerate(doc["labels"]):
            if not isinstance(e, dict) or "label" not in e or "activity" not in e:
                issues.append(
                    ValidationIssue(
                        file=str(mp), message="mapping entry needs 'label' and 'activity'", path=f"labels/{i}"
                    )
                )
                continue
            if e["activity"] not in activity_ids:
                issues.append(
                    ValidationIssue(
                        file=str(mp),
                        message=f"label {e['label']!r} maps to unknown activity {e['activity']!r}",
                        path=f"labels/{i}",
                    )
                )
    return issues


def validate_pack(name_or_path: str | Path) -> list[ValidationIssue]:
    """Schema validation plus cross-reference checks; empty list means valid."""
    path = pack_dir(name_or_path)
    issues: list[ValidationIssue] = []
    docs: dict[str, Any] = {}
    for kind in PACK_FILES:
        fp = path / f"{kind}.yaml"
        if not fp.is_file():
            issues.append(ValidationIssue(file=str(fp), message="missing file"))
            continue
        file_issues = validate_file(kind, fp)
        issues.extend(file_issues)
        if not file_issues:
            docs[kind] = read_yaml(fp)
    index = path / "templates" / "index.yaml"
    if index.is_file():
        file_issues = validate_file("templates", index)
        issues.extend(file_issues)
        docs["templates"] = None if file_issues else read_yaml(index)
    else:
        docs["templates"] = None
    guidance_file = path / f"{GUIDANCE_FILE}.yaml"
    if guidance_file.is_file():
        file_issues = validate_file(GUIDANCE_FILE, guidance_file)
        issues.extend(file_issues)
        docs[GUIDANCE_FILE] = None if file_issues else read_yaml(guidance_file)
    else:
        docs[GUIDANCE_FILE] = None
    if any(i.level == "error" for i in issues):
        return issues
    issues.extend(_cross_check(path, docs))
    activity_ids = {a["id"] for a in docs["ontology"]["activities"]}
    issues.extend(_template_issues(path, docs["templates"], activity_ids))
    issues.extend(_mapping_issues(path, activity_ids))
    issues.extend(_guidance_issues(path, docs))
    issues.extend(_preset_issues(path, docs))
    return issues


def validate_datasets(path: Path | None = None) -> list[ValidationIssue]:
    p = Path(path) if path else knowledge_root() / "datasets.yaml"
    issues = validate_file("datasets", p)
    if issues:
        return issues
    doc = read_yaml(p)
    ids = [d["id"] for d in doc["datasets"]]
    for d in _dupes(ids):
        issues.append(ValidationIssue(file=str(p), message=f"duplicate dataset id {d!r}"))
    return issues


__all__ = [
    "GUIDANCE_BLOCKS",
    "SCHEMA_KINDS",
    "ValidationIssue",
    "read_yaml",
    "template_constraints",
    "validate_datasets",
    "validate_document",
    "validate_file",
    "validate_pack",
    "validator",
]
