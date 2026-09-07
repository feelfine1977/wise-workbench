"""Known logs and column-name heuristics.

``suggest_mapping`` guesses a column mapping from column names (exact presets
for the BPI Challenge 2019 CSV and pm4py-style exports, regular expressions
otherwise) so that the mapping screen opens prefilled. ``PRESETS`` describes
public logs that a tester can load in one click: the file path comes from
the settings, the mapping and the norm are known.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BPIC19_MAPPING: dict[str, Any] = {
    "caseId": "case concept:name",
    "activity": "event concept:name",
    "timestamp": "event time:timestamp",
    "timestampFormat": "%d-%m-%Y %H:%M:%S.%f",
    "dayfirst": True,
    "resource": "event org:resource",
    "order": "eventID",
    "eventId": "eventID",
    "caseAttributes": [
        "case Company",
        "case Spend area text",
        "case Vendor",
        "case Item Type",
        "case Purchasing Document",
        "case Document Type",
        "case Item Category",
    ],
    "exposure": "event Cumulative net worth (EUR)",
    "exposureAgg": "max",
    "exposureAbs": True,
    "headerEvents": [
        "Create Purchase Order Item",
        "Vendor creates invoice",
        "Record Invoice Receipt",
        "Clear Invoice",
        "Remove Payment Block",
    ],
    "closureActivities": ["Clear Invoice"],
    "flowTyping": [
        {"name": "DF1", "rule": {"attr": "case Item Category", "eq": "3-way match, invoice after GR"}},
        {"name": "DF2", "rule": {"attr": "case Item Category", "eq": "3-way match, invoice before GR"}},
        {"name": "2-way", "rule": {"attr": "case Item Category", "eq": "2-way match"}},
        {"name": "Consignment", "rule": {"attr": "case Item Category", "eq": "Consignment"}},
    ],
    "flowTypeDefault": "other",
    "note": "BPI Challenge 2019 preset",
}

PM4PY_MAPPING: dict[str, Any] = {
    "caseId": "case:concept:name",
    "activity": "concept:name",
    "timestamp": "time:timestamp",
}

_ROLE_PATTERNS: dict[str, list[str]] = {
    "caseId": [r"^case concept:name$", r"^case:concept:name$", r"^case[_ ]?id$", r"^case$", r"case.?id", r"^case "],
    "activity": [r"^event concept:name$", r"^concept:name$", r"^activity$", r"activity", r"^event$", r"concept:name$"],
    "timestamp": [r"time:timestamp", r"^timestamp$", r"timestamp", r"^time$", r"^date$", r"time"],
    "resource": [r"org:resource", r"^resource$", r"resource", r"^user$", r"user"],
    "lifecycle": [r"lifecycle:transition", r"^lifecycle$", r"lifecycle"],
    "exposure": [r"net worth", r"^amount$", r"amount", r"value", r"exposure"],
}


def _first_match(columns: list[str], patterns: list[str], taken: set[str]) -> str | None:
    for pattern in patterns:
        rx = re.compile(pattern, re.IGNORECASE)
        for col in columns:
            if col not in taken and rx.search(col):
                return col
    return None


def suggest_mapping(columns: list[str]) -> dict[str, Any]:
    """A mapping document guessed from column names, with its ``source`` and ``notes``."""
    have = set(columns)
    if {"case concept:name", "event concept:name", "event time:timestamp"} <= have:
        doc = json.loads(json.dumps(BPIC19_MAPPING))
        doc["caseAttributes"] = [a for a in doc["caseAttributes"] if a in have]
        for key in ("resource", "order", "eventId", "exposure"):
            if doc.get(key) not in have:
                doc.pop(key, None)
        if "case Item Category" not in have:
            doc["flowTyping"] = []
        return {"mapping": doc, "source": "bpic2019", "notes": ["Column names match the BPI Challenge 2019 export."]}
    if {"case:concept:name", "concept:name", "time:timestamp"} <= have:
        doc = dict(PM4PY_MAPPING)
        extras = [c for c in columns if c.startswith("case:") and c != "case:concept:name"]
        if extras:
            doc["caseAttributes"] = extras[:8]
        if "org:resource" in have:
            doc["resource"] = "org:resource"
        if "lifecycle:transition" in have:
            doc["lifecycle"] = "lifecycle:transition"
        return {"mapping": doc, "source": "pm4py", "notes": ["Column names follow the XES / pm4py convention."]}
    taken: set[str] = set()
    doc = {}
    notes: list[str] = []
    for role in ("caseId", "activity", "timestamp"):
        hit = _first_match(columns, _ROLE_PATTERNS[role], taken)
        if hit is None:
            notes.append(f"no column looks like the {role}; choose one")
            doc[role] = ""
        else:
            doc[role] = hit
            taken.add(hit)
    for role in ("resource", "lifecycle", "exposure"):
        hit = _first_match(columns, _ROLE_PATTERNS[role], taken)
        if hit is not None:
            doc[role] = hit
            taken.add(hit)
    attrs = [c for c in columns if c not in taken and re.match(r"^case[ _:]", c, re.IGNORECASE)]
    if not attrs:
        attrs = [c for c in columns if c not in taken]
    doc["caseAttributes"] = attrs[:8]
    return {"mapping": doc, "source": "heuristic", "notes": notes or ["Guessed from column names; check every role."]}


@dataclass(frozen=True)
class Preset:
    """A public log with a known mapping and norm, loadable in one click.

    Built-in presets name a settings field for their file (``csv_setting``); a preset that comes from a knowledge
    pack (``packages/process-knowledge/*/presets/*.yaml``) carries the resolved paths instead, plus the pack's
    label pack, case noun, prepared attributes and pitfalls (R1-13, R2-04).
    """

    id: str
    name: str
    description: str
    mapping: dict[str, Any]
    slicing: tuple[str, ...]
    view: str
    gamma: float
    min_cases: int
    csv_setting: str | None = None
    norm_setting: str | None = None
    csv_path: Path | None = None
    norm_path: Path | None = None
    process: str = "p2p"
    norm_note: str = "imported by the preset"
    run_note: str | None = None
    extra_slicings: tuple[tuple[str, ...], ...] = field(default_factory=tuple)
    source: str = "builtin"
    label_pack: str | None = None
    case_noun: str | None = None
    pitfalls: tuple[str, ...] = ()
    note: str | None = None


PRESETS: dict[str, Preset] = {
    "bpic2019": Preset(
        id="bpic2019",
        name="BPI Challenge 2019 (purchase-to-pay)",
        description=(
            "251,734 purchase order items and 1,595,923 events; the paper's norm with 29 expectations in seven areas; "
            "groups by company × spend area in the Automation perspective with γ = 20."
        ),
        csv_setting="bpic19_csv",
        norm_setting="bpic19_norm",
        mapping=BPIC19_MAPPING,
        slicing=("case Company", "case Spend area text"),
        view="Automation",
        gamma=20.0,
        min_cases=1,
        norm_note="imported from bpic19_norm.json by the BPI Challenge 2019 preset",
        run_note="BPIC 2019 preset: company × spend area, γ = 20",
        # one case of this log is one purchase order item, and every screen says so
        case_noun="purchase order items",
        extra_slicings=(("case Vendor",),),
    ),
}


# ---------------------------------------------------------------------------- presets from the knowledge packs
PREPARED_KINDS_FROM_PACK = {"date_difference": "date_difference", "period": "period", "alias": "alias"}


def _prepared_from_pack(preset: Any) -> list[dict[str, Any]]:
    """The preset's prepared case attributes in the mapping's shape.

    ``date_difference`` and ``period`` are computed by the workbench; ``recipe`` describes the flow type, which
    the mapping's own flow typing already produces, so it is not repeated here. The ``attribute_aliases`` of the
    preset become ``alias`` attributes so that a template written against canonical names finds them.
    """
    out: list[dict[str, Any]] = []
    for spec in preset.derived_case_attributes:
        kind = str(spec.get("kind") or "")
        if kind not in PREPARED_KINDS_FROM_PACK:
            continue
        out.append(
            {
                "name": str(spec["name"]),
                "kind": PREPARED_KINDS_FROM_PACK[kind],
                "spec": dict(spec.get("spec") or {}),
                "description": spec.get("description"),
            }
        )
    names = {p["name"] for p in out}
    for canonical, column in (preset.mapping.get("attribute_aliases") or {}).items():
        if str(canonical) == str(column) or str(canonical) in names:
            continue
        out.append(
            {
                "name": str(canonical),
                "kind": "alias",
                "spec": {"from": str(column)},
                "description": f"the template expects {canonical!r}; this log carries it as {column!r}",
            }
        )
    return out


def mapping_from_pack(preset: Any) -> dict[str, Any]:
    """The workbench mapping document of a pack preset."""
    m = dict(preset.mapping)
    doc: dict[str, Any] = {
        "caseId": str(m.get("case_id") or ""),
        "activity": str(m.get("activity") or ""),
        "timestamp": str(m.get("timestamp") or ""),
        "caseAttributes": [str(a) for a in m.get("case_attributes") or []],
        "headerEvents": [str(a) for a in m.get("header_events") or []],
        "closureActivities": [str(a) for a in m.get("closure_activities") or []],
        "flowTyping": [{"name": str(r["name"]), "rule": dict(r["rule"])} for r in m.get("flow_typing") or []],
        "flowTypeDefault": str(m.get("flow_type_default") or "other"),
        "preparedAttributes": _prepared_from_pack(preset),
        "caseNoun": (preset.case_noun or {}).get("en") if isinstance(preset.case_noun, dict) else preset.case_noun,
        "note": f"{preset.id} preset of the {preset.pack} knowledge pack",
    }
    if m.get("timestamp_format"):
        doc["timestampFormat"] = str(m["timestamp_format"])
    if m.get("exposure"):
        doc["exposure"] = str(m["exposure"])
        doc["exposureAgg"] = str(m.get("exposure_agg") or "max")
    return doc


def preset_from_pack(preset: Any, csv_path: Path | None, norm_path: Path | None) -> Preset:
    slicings = list(preset.slicings)
    default = next((s for s in slicings if s.get("default")), slicings[0] if slicings else {"columns": []})
    extras = tuple(tuple(str(c) for c in s.get("columns") or []) for s in slicings if s is not default)
    return Preset(
        id=str(preset.id),
        name=str(preset.name),
        description=str(preset.description).strip(),
        mapping=mapping_from_pack(preset),
        slicing=tuple(str(c) for c in default.get("columns") or []),
        view=str(preset.view or ""),
        gamma=float(preset.gamma or 0.0),
        min_cases=int(preset.min_cases or 1),
        csv_path=csv_path,
        norm_path=norm_path,
        process=str(preset.pack),
        norm_note=f"{(preset.norm or {}).get('template')} of the {preset.pack} pack, translated to this log's labels",
        run_note=f"{preset.id} preset: {' × '.join(default.get('columns') or [])}, γ = {preset.gamma}",
        extra_slicings=tuple(e for e in extras if e),
        source="pack",
        label_pack=preset.mapping.get("activity_mapping"),
        case_noun=(preset.case_noun or {}).get("en") if isinstance(preset.case_noun, dict) else preset.case_noun,
        pitfalls=tuple(str(x) for x in preset.pitfalls or ()),
        note=str(preset.notes or "").strip() or None,
    )


def all_presets(settings: Any) -> dict[str, Preset]:
    """The built-in presets plus every preset the installed knowledge packs carry."""
    from wise_workbench.adapters.knowledge import pack_presets, template_path

    out = dict(PRESETS)
    data_dirs = [Path(d).expanduser() for d in getattr(settings, "preset_data_dirs", []) or []]
    for preset in pack_presets():
        if str(preset.id) in out:
            continue
        csv_path = next((d / str(preset.file) for d in data_dirs if (d / str(preset.file)).exists()), None)
        if csv_path is None and data_dirs:
            csv_path = data_dirs[0] / str(preset.file)
        norm_path = template_path(str(preset.pack), str((preset.norm or {}).get("template") or ""))
        out[str(preset.id)] = preset_from_pack(preset, csv_path, norm_path)
    return out
