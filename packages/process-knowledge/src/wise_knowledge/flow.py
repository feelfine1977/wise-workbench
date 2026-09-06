"""Stage lanes for the flow map: the pack's stage model in the ``FlowGraph`` shape.

``stage_lanes`` returns ``groups`` (one lane per stage, in stage order),
``nodes`` (canonical activities placed in their stage, with the log labels of
a mapping when one is given), ``edges`` (the expected orderings as ``flow``
edges tagged with the variants they hold for) and ``meta`` (case noun, stage
order, milestones, allowed loops, label mapping, variants). The backend's
flow endpoint merges the observed directly-follows graph into these lanes.
"""

from __future__ import annotations

from typing import Any

from .models import Mapping, Pack


def _lang(text: dict[str, str], lang: str) -> str:
    return text.get(lang) or text.get("en", "")


def stage_lanes(
    pack: Pack,
    mapping: Mapping | str | None = None,
    variant: str | None = None,
    lang: str = "en",
    only_mapped: bool | None = None,
) -> dict[str, Any]:
    """Stage lanes with canonical activity ids in the FlowGraph ``groups`` / ``nodes`` / ``edges`` shape.

    ``mapping`` is a curated label mapping of the pack (id or object); with a
    mapping, ``meta.labels`` lists the log labels per canonical activity and,
    unless ``only_mapped`` is False, the nodes are limited to the activities
    the mapping covers. ``variant`` limits the lanes to that variant's stage
    sequence and the edges to orderings that hold for it.
    """
    if isinstance(mapping, str):
        mapping = pack.mappings[mapping]
    labels: dict[str, list[str]] = {}
    if mapping is not None:
        for e in mapping.entries:
            labels.setdefault(e.activity, []).append(e.label)
    if only_mapped is None:
        only_mapped = mapping is not None

    stages = list(pack.stages)
    var = None
    if variant:
        var = next((v for v in pack.stage_model.variants if v.id == variant), None)
        if var is None:
            raise KeyError(f"unknown variant {variant!r}; known {[v.id for v in pack.stage_model.variants]}")
        wanted = list(dict.fromkeys(var.stage_sequence))
        stages = [s for s in stages if s.id in wanted]
        stages.sort(key=lambda s: wanted.index(s.id))
    stage_ids = [s.id for s in stages]

    groups = [{"id": f"stage:{s.id}", "kind": "lane", "label": _lang(s.name, lang), "parent": None} for s in stages]
    nodes = []
    for s in stages:
        for a in pack.activities_in_stage(s.id):
            if only_mapped and a.id not in labels:
                continue
            tags = list(a.tags)
            if a.granularity:
                tags.append(a.granularity)
            nodes.append(
                {
                    "id": a.id,
                    "kind": "activity",
                    "label": _lang(a.name, lang),
                    "group": f"stage:{a.stage}",
                    "metrics": {},
                    "tags": tags,
                }
            )
    node_ids = {n["id"] for n in nodes}
    edges = []
    for o in pack.stage_model.expected_orderings:
        if o.a not in node_ids or o.b not in node_ids:
            continue
        if var is not None and o.variants and var.id not in o.variants:
            continue
        edges.append(
            {
                "id": f"{o.a}->{o.b}",
                "kind": "flow",
                "source": o.a,
                "target": o.b,
                "metrics": {},
                "tags": list(o.variants),
                "payload": {"note": o.note, "variants": list(o.variants), "origin": "expected_ordering"},
            }
        )
    meta = {
        "pack": pack.id,
        "process": pack.process,
        "case_noun": _lang(pack.stage_model.noun, lang),
        "mapping": mapping.id if mapping else None,
        "variant": var.id if var else None,
        "stage_order": stage_ids,
        "milestones": {s.id: list(s.milestones) for s in stages},
        "loops_allowed_to": {s.id: list(s.loops_allowed_to) for s in stages},
        "labels": {a: labels[a] for a in sorted(labels) if a in node_ids},
        "variants": [
            {
                "id": v.id,
                "label": _lang(v.name, lang),
                "stage_sequence": list(v.stage_sequence),
                "flow_type_codes": dict(v.flow_type_codes),
            }
            for v in pack.stage_model.variants
        ],
    }
    return {"groups": groups, "nodes": nodes, "edges": edges, "overlays": [], "meta": meta}


__all__ = ["stage_lanes"]
