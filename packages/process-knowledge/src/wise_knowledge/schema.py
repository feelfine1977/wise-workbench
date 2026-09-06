"""JSON Schema validation of pack files, template norms and the datasets registry.

Two levels: the JSON Schemas in ``schema/`` (structure), then cross-reference
checks that a schema cannot express (stage ids exist, label packs point to
known activities, failure modes reference known roles, template files load
with the ``wise`` library when it is installed).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

from .paths import PACK_FILES, knowledge_root, pack_dir, schema_dir

SCHEMA_KINDS = (*PACK_FILES, "templates", "datasets")


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
    if any(i.level == "error" for i in issues):
        return issues
    issues.extend(_cross_check(path, docs))
    activity_ids = {a["id"] for a in docs["ontology"]["activities"]}
    issues.extend(_template_issues(path, docs["templates"], activity_ids))
    issues.extend(_mapping_issues(path, activity_ids))
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
    "SCHEMA_KINDS",
    "ValidationIssue",
    "read_yaml",
    "validate_datasets",
    "validate_document",
    "validate_file",
    "validate_pack",
    "validator",
]
