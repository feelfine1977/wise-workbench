"""Validated investigation recipes: knowledge definitions, never computed findings.

The block kind selects a trusted calculator and renderer in Workbench. Text in a
card cannot introduce code, SQL, arbitrary field expressions or data access.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from .paths import available_packs, knowledge_root
from .schema import read_yaml, validate_document

PRESENTATIONS = {
    "activity_coverage": "coverage",
    "endpoint_duration": "summary",
    "end_day_of_month": "day_bars",
    "due_date_lead": "availability",
}


def load_solution_cards(path: Path | None = None) -> dict[str, Any]:
    """Validate a catalogue and its block references before exposing any card."""
    path = path or knowledge_root() / "solution_cards.yaml"
    if not path.is_file():
        return {"version": 1, "blocks": {}, "cards": []}
    document = read_yaml(path)
    issues = validate_document("solution_cards", document, str(path))
    if issues:
        raise ValueError("\n".join(str(issue) for issue in issues))
    seen: set[str] = set()
    for key, block in document["blocks"].items():
        if block["id"] != key or PRESENTATIONS[block["kind"]] != block["presentation"]:
            raise ValueError(f"Invalid block identity or presentation: {key}")
    for card in document["cards"]:
        if card["id"] in seen:
            raise ValueError(f"Duplicate solution card: {card['id']}")
        seen.add(card["id"])
        if set(card["blocks"]) - document["blocks"].keys():
            raise ValueError(f"Unknown evidence block in {card['id']}")
        temporal = any(document["blocks"][key]["kind"] != "activity_coverage" for key in card["blocks"])
        if temporal and not set(card["match"]["types"]) <= {"lag", "precedence"}:
            raise ValueError(f"Temporal recipe needs endpoint rule types: {card['id']}")
    return document


def solution_card_for(
    process: str | None, constraint: dict[str, Any], *, catalogue: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Select the most specific recipe; do not infer matches from prose or labels."""
    catalogue = catalogue if catalogue is not None else load_solution_cards()
    candidates = []
    for card in catalogue["cards"]:
        match = card["match"]
        if constraint.get("type") not in match["types"]:
            continue
        if "processes" in match and process not in match["processes"]:
            continue
        if "constraintIds" in match and constraint.get("id") not in match["constraintIds"]:
            continue
        candidates.append(card)
    if not candidates:
        return None

    def specificity(card: dict[str, Any]) -> tuple[bool, bool]:
        return ("constraintIds" in card["match"], "processes" in card["match"])

    best_rank = max(map(specificity, candidates))
    best = [card for card in candidates if specificity(card) == best_rank]
    if len(best) != 1:
        raise ValueError("Ambiguous solution-card recipe selection")
    return expand_solution_card(best[0], process, catalogue)


def expand_solution_card(card: dict[str, Any], process: str | None, catalogue: dict[str, Any]) -> dict[str, Any]:
    """Expand block references from a validated catalogue for the Hub and Improve."""
    # A generic recipe can still belong to an installed process's knowledge hub.
    linked = process if process in available_packs() else None
    return {
        "id": card["id"],
        "version": card["version"],
        "title": card["title"],
        "intent": card["intent"],
        "process": process,
        "hubNode": f"solution_card:{linked}:{card['id']}" if linked else None,
        "blocks": [deepcopy(catalogue["blocks"][key]) for key in card["blocks"]],
    }
