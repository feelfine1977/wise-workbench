"""Opt-in report-inspired diagnostic norms; no dataset logic in the engine.

Mappings are supplied by the caller. Unknown mappings omit the affected rule
with an explicit gap; they never turn missing evidence into a satisfied rule.
The original document, constraints, recipes and views are copied unchanged.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

_DATA = Path(__file__).parent / "data" / "p2p"


def load_report_patterns() -> tuple[dict[str, Any], dict[str, Any]]:
    return (
        json.loads((_DATA / "templates/p2p_report_patterns.json").read_text()),
        json.loads((_DATA / "report-pattern-catalogue.json").read_text()),
    )


def extend_report_patterns(
    base: Mapping[str, Any],
    *,
    activity_mapping: Mapping[str, Sequence[str]],
    attribute_mapping: Mapping[str, str],
    flow_values: Mapping[str, Sequence[str]],
    available_activities: Sequence[str],
    available_attributes: Sequence[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Append explicitly mapped candidates and a separate diagnostic view.

    ``invoice_bearing`` and ``all_items`` flow sets express proposed screening
    applicability, not approved business policy. Input labels must be known.
    Optional automation evidence uses validated case fields, never identities.
    ``available_attributes`` must include every existing case attribute, so
    selected recipes cannot overwrite raw values used by the original norm.
    """
    template, catalogue = load_report_patterns()
    document = copy.deepcopy(dict(base))
    labels, attributes = set(available_activities), set(available_attributes)
    recipes = {r["name"]: r for r in template["derived_attributes"]}
    accepted, selected_recipes, omitted = [], {}, []
    definitions = {r["constraint_id"]: r for r in catalogue["patterns"]}

    def activities(values: Sequence[str]) -> list[str]:
        result = []
        for canonical in values:
            mapped = activity_mapping.get(canonical)
            if not mapped or isinstance(mapped, str):
                raise ValueError(f"activity mapping required: {canonical}")
            if any(not isinstance(v, str) or not v for v in mapped):
                raise ValueError(f"invalid activity mapping: {canonical}")
            if set(mapped) - labels:
                raise ValueError(f"mapped activities absent: {sorted(set(mapped) - labels)}")
            result.extend(mapped)
        return list(dict.fromkeys(result))

    def attribute(name: str, needed: dict[str, Any]) -> str:
        if name in recipes:
            recipe = copy.deepcopy(recipes[name])
            recipe["activities"] = activities(recipe["activities"])
            needed[name] = recipe
            return name
        mapped = attribute_mapping.get(name)
        if not mapped or mapped not in attributes:
            raise ValueError(f"case attribute mapping required: {name}")
        return mapped

    def applicability(rule: dict[str, Any], needed: dict[str, Any]) -> dict[str, Any]:
        rule = copy.deepcopy(rule)
        if "all" in rule or "any" in rule:
            key = "all" if "all" in rule else "any"
            return {key: [applicability(r, needed) for r in rule[key]]}
        if "not" in rule:
            return {"not": applicability(rule["not"], needed)}
        for key in ("has", "lacks"):
            if key in rule:
                rule[key] = activities(rule[key])
        if "attr" in rule:
            name = rule["attr"]
            rule["attr"] = attribute(name, needed)
            if name == "flow_type":
                vals = []
                for semantic in rule["in"]:
                    mapped = flow_values.get(semantic)
                    if not mapped or isinstance(mapped, str):
                        raise ValueError(f"flow applicability mapping required: {semantic}")
                    vals.extend(mapped)
                rule["in"] = list(dict.fromkeys(vals))
        return rule

    for original in template["constraints"]:
        rule, needed = copy.deepcopy(original), {}
        try:
            for key in ("activity", "a", "b", "after", "before"):
                if rule["params"].get(key) is not None:
                    rule["params"][key] = activities(rule["params"][key])
            if "attribute" in rule["params"]:
                rule["params"]["attribute"] = attribute(rule["params"]["attribute"], needed)
            rule["applicability"] = applicability(rule["applicability"], needed)
        except ValueError as exc:
            omitted.append({"constraint_id": rule["id"], "reason": str(exc), "status": "not_assessable"})
            continue
        accepted.append(rule)
        selected_recipes.update(needed)
    if not accepted:
        raise ValueError("No report patterns are assessable with these explicit mappings")

    raw_collisions = attributes & selected_recipes.keys()
    if raw_collisions:
        raise ValueError(f"Derived recipe/raw attribute collision: {sorted(raw_collisions)}")

    for key, entries, id_key in (
        ("constraints", accepted, "id"),
        ("derived_attributes", list(selected_recipes.values()), "name"),
    ):
        existing = {r[id_key] for r in document.get(key, [])}
        collisions = existing & {r[id_key] for r in entries}
        if collisions:
            raise ValueError(f"Extension already present or identifier collision: {sorted(collisions)}")
        document.setdefault(key, []).extend(entries)
    layers = [r for r in template["layers"] if r["id"] in {c["layer"] for c in accepted}]
    if {r["id"] for r in document["layers"]} & {r["id"] for r in layers}:
        raise ValueError("Extension layer collision")
    document["layers"].extend(copy.deepcopy(layers))
    view = copy.deepcopy(template["views"][0])
    view["layer_weights"] = {r["id"]: 1.0 for r in layers}
    if view["name"] in {v["name"] for v in document["views"]}:
        raise ValueError("Extension view collision")
    document["views"].append(view)
    metadata = document.setdefault("metadata", {})
    meta = metadata.setdefault("meta", {})
    meta.update({"review_status": "draft", "calibration": "uncalibrated"})
    meta.setdefault("uncalibrated_parameters", {}).update({r["id"]: ["weight", *r["params"]] for r in accepted})
    report = {
        "catalogue": catalogue["id"],
        "review_status": "draft",
        "source": catalogue["sources"],
        "mapping": {
            "activities": dict(activity_mapping),
            "attributes": dict(attribute_mapping),
            "flow_values": dict(flow_values),
        },
        "added_constraint_ids": [r["id"] for r in accepted],
        "omitted": omitted,
        "semantic_gaps": catalogue["gaps"],
        "definitions": {r["id"]: definitions[r["id"]] for r in accepted},
        "interpretation": catalogue["interpretation"],
        "legacy_note": "Original rules and views retained verbatim, including legacy identity proxies and warnings. These are not validated labor or automation evidence. Only the new Report candidates view uses the extension.",
    }
    metadata["report_patterns"] = report
    guidance = metadata.setdefault("guidance", {})
    for key, selected in (("layers", [r["id"] for r in layers]), ("constraints", [r["id"] for r in accepted])):
        guidance.setdefault(key, {}).update(
            {k: copy.deepcopy(template["metadata"]["guidance"][key][k]) for k in selected}
        )
    document["name"] = str(base["name"]) + " — report candidates (draft)"
    document["version"] = str(base.get("version", "1")) + "+report-patterns.1"
    document["description"] = (
        str(base.get("description", ""))
        + " Separate report-inspired diagnostic view; all additions are draft screening proposals requiring applicability and threshold review."
    )
    return document, report
