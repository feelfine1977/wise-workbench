"""Versioned, derived general benchmark. Existing stakeholder views are preserved."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

BENCHMARK_POLICY = "equal_layers_union_v1"


def raw_view_weights(document: dict[str, Any], view: dict[str, Any]) -> dict[str, float]:
    constraints = document.get("constraints") or []
    if view.get("constraint_weights") is not None:
        return {c["id"]: float(view["constraint_weights"].get(c["id"], 0)) for c in constraints}
    totals: dict[str, float] = {}
    for c in constraints:
        totals[c["layer"]] = totals.get(c["layer"], 0) + float(c.get("weight", 1))
    return {
        c["id"]: float((view.get("layer_weights") or {}).get(c["layer"], 0))
        * float(c.get("weight", 1))
        / totals[c["layer"]]
        if totals[c["layer"]] > 0
        else 0
        for c in constraints
    }


def with_general_benchmark(document: dict[str, Any]) -> dict[str, Any]:
    """Give each represented layer total raw weight 1, and equal shares to its union members.

    Individual definitions, applicability, existing view weights and input object are untouched.
    A metadata marker identifies our generated view; a user's existing 'General' is never overwritten.
    """
    out = deepcopy(document)
    constraints = out.get("constraints") or []
    views = out.get("views") or []
    metadata = out.setdefault("metadata", {})
    previous = metadata.get("general_benchmark")
    previous = previous if isinstance(previous, dict) else {}
    managed = previous.get("name") if previous.get("policy") == BENCHMARK_POLICY else None
    others = [v for v in views if v.get("name") != managed]
    active = set()
    for view in others:
        active.update(cid for cid, weight in raw_view_weights(out, view).items() if weight > 0)
    if not others:
        active = {c["id"] for c in constraints if float(c.get("weight", 1)) > 0}
    if not active:
        return document  # original engine validation explains an empty/invalid norm
    names = {v["name"] for v in others}
    name = managed or "General"
    if name in names:
        name = "General benchmark"
        n = 2
        while name in names:
            name = f"General benchmark {n}"
            n += 1
    counts: dict[str, int] = {}
    for c in constraints:
        if c["id"] in active:
            counts[c["layer"]] = counts.get(c["layer"], 0) + 1
    weights = {c["id"]: 1.0 / counts[c["layer"]] if c["id"] in active else 0.0 for c in constraints}
    benchmark = {
        "name": name,
        "constraint_weights": weights,
        "description": "General benchmark: every constraint used by any stakeholder view; equal total weight per participating layer and equal constraint shares within each layer.",
    }
    out["views"] = [*others, benchmark]
    metadata["general_benchmark"] = {"policy": BENCHMARK_POLICY, "name": name}
    return out
