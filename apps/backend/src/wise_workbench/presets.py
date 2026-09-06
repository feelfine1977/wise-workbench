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
    """A public log with a known mapping and norm, loadable in one click."""

    id: str
    name: str
    description: str
    csv_setting: str
    norm_setting: str
    mapping: dict[str, Any]
    slicing: tuple[str, ...]
    view: str
    gamma: float
    min_cases: int
    process: str = "p2p"
    norm_note: str = "imported by the preset"
    run_note: str | None = None
    extra_slicings: tuple[tuple[str, ...], ...] = field(default_factory=tuple)


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
        extra_slicings=(("case Vendor",),),
    ),
}
