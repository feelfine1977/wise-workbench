"""FlowGraph JSON: a directly-follows graph with metrics, stage groups and constraint overlays.

The payload follows the flow library's contract (``@wise/flow`` ``docs/API.md``):
node metrics ``cases``, ``events``, ``share``, ``violationShare``; follows-edge
metrics ``count``, ``cases``, ``share``, ``medianLagHours``; overlay payloads
with ``value`` (a share in [0, 1]), ``label``, ``text``, ``coverage``, ``glyph``,
``threshold``, ``unit``. The workbench's own names (``caseShare``,
``medianHours``, ``shareViolated``) stay next to them.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import pandas as pd
import wise

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.adapters.knowledge import StageModel

START, END = "__start__", "__end__"


def _node_id(label: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").lower() or "node"
    return f"a_{slug}"


def _pct(value: float) -> str:
    p = value * 100
    return f"{p:.0f} %" if p >= 10 else f"{p:.1f} %"


def _payload(nc: wise.NormConstraint, share: dict[str, float], n_cases: int) -> dict[str, Any]:
    c = nc.constraint
    evaluated: int = int(share.get("casesEvaluated") or 0)
    value = share.get("shareViolated")
    description = str(nc.description or nc.id)
    if value is not None and evaluated > 0:
        text = f"{description.rstrip('.')} — missed in {_pct(float(value))} of {evaluated:,} evaluated cases"
    else:
        text = f"{description.rstrip('.')} — not evaluated in this scene"
    payload: dict[str, Any] = {
        "constraintId": nc.id,
        "constraintType": c.type,
        "type": c.type,
        "layer": nc.layer,
        "label": nc.id,
        "description": description,
        "value": value,
        "coverage": (evaluated / n_cases) if evaluated > 0 else None,
        "text": text,
        **share,
    }
    if isinstance(c, wise.Presence):
        payload.update(glyph=f"≥{c.m}", threshold=float(c.m))
    elif isinstance(c, wise.Singularity):
        payload.update(glyph=f"≤{c.k}", threshold=float(c.k), width=float(c.K))
    elif isinstance(c, wise.Exclusion):
        payload.update(glyph="∅", threshold=0.0)
    elif isinstance(c, wise.Lag):
        payload.update(
            glyph="⇒",
            threshold=float(c.delta) if c.delta is not None else None,
            width=float(c.width),
            unit=str(c.unit),
        )
    elif isinstance(c, wise.Precedence):
        payload.update(glyph="⇒", threshold=float(c.k), width=float(c.K))
    elif isinstance(c, wise.Balance):
        payload.update(glyph="=", threshold=float(c.tau), width=float(c.width))
    elif isinstance(c, wise.Metric):
        payload.update(
            glyph="#", threshold=float(c.threshold), width=float(c.width), unit=str(c.attribute), direction=c.direction
        )
    return payload


def build_flow_graph(
    dfg: dict[str, Any],
    norm: wise.Norm | None,
    violation_shares: dict[str, dict[str, float]],
    *,
    abstraction: float,
    meta: dict[str, Any],
    stages: StageModel | None = None,
) -> dict[str, Any]:
    """``dfg`` comes from the storage adapter; ``violation_shares`` maps constraint id → {shareViolated, meanViolation, casesEvaluated}."""
    n_cases = max(int(dfg.get("cases", 0)), 1)
    node_rows = [n for n in dfg["nodes"] if n["cases"] / n_cases >= abstraction]
    kept = {n["label"] for n in node_rows}
    ids = {label: _node_id(label) for label in kept}
    # keep ids unique when two labels slug to the same id
    seen: dict[str, int] = {}
    for label in sorted(kept):
        base = ids[label]
        if base in seen:
            seen[base] += 1
            ids[label] = f"{base}_{seen[base]}"
        else:
            seen[base] = 0
    constraints = list(norm.constraints) if norm is not None else []
    # violation share per activity: the largest share among the expectations that mention it
    node_violation: dict[str, float] = {}
    for nc in constraints:
        node_share = violation_shares.get(nc.id, {}).get("shareViolated")
        if node_share is None:
            continue
        for a in nc.constraint.activities():
            node_violation[a] = max(node_violation.get(a, 0.0), float(node_share))
    nodes: list[dict[str, Any]] = [
        {
            "id": START,
            "kind": "event",
            "label": "start",
            "group": None,
            "metrics": {"cases": float(n_cases), "share": 1.0},
            "tags": ["start"],
        },
        {
            "id": END,
            "kind": "event",
            "label": "end",
            "group": None,
            "metrics": {"cases": float(n_cases), "share": 1.0},
            "tags": ["end"],
        },
    ]
    group_members: dict[str, int] = {}
    for n in sorted(node_rows, key=lambda r: -r["events"]):
        stage = stages.stage_of(n["label"]) if stages is not None else None
        if stage:
            group_members[stage] = group_members.get(stage, 0) + 1
        nodes.append(
            {
                "id": ids[n["label"]],
                "kind": "activity",
                "label": n["label"],
                "group": stage,
                "metrics": {
                    "events": float(n["events"]),
                    "cases": float(n["cases"]),
                    "share": n["cases"] / n_cases,
                    "caseShare": n["cases"] / n_cases,
                    "eventsPerCase": n["events"] / max(n["cases"], 1),
                    "violationShare": node_violation.get(n["label"], 0.0),
                },
                "tags": [],
            }
        )
    edges: list[dict[str, Any]] = []
    for e in dfg["edges"]:
        if e["source"] not in kept or e["target"] not in kept or e["cases"] / n_cases < abstraction:
            continue
        metrics = {
            "count": float(e["count"]),
            "cases": float(e["cases"]),
            "share": e["cases"] / n_cases,
            "caseShare": e["cases"] / n_cases,
        }
        if e.get("median_hours") is not None:
            metrics["medianLagHours"] = float(e["median_hours"])
            metrics["medianHours"] = float(e["median_hours"])
        edges.append(
            {
                "id": f"f_{ids[e['source']]}__{ids[e['target']]}",
                "kind": "follows",
                "source": ids[e["source"]],
                "target": ids[e["target"]],
                "metrics": metrics,
                "tags": ["selfLoop"] if e["source"] == e["target"] else [],
            }
        )
    for label, n in dfg.get("starts", {}).items():
        if label in kept and n / n_cases >= abstraction:
            edges.append(
                {
                    "id": f"f_start__{ids[label]}",
                    "kind": "follows",
                    "source": START,
                    "target": ids[label],
                    "metrics": {"count": float(n), "cases": float(n), "share": n / n_cases, "caseShare": n / n_cases},
                    "tags": ["start"],
                }
            )
    for label, n in dfg.get("ends", {}).items():
        if label in kept and n / n_cases >= abstraction:
            edges.append(
                {
                    "id": f"f_{ids[label]}__end",
                    "kind": "follows",
                    "source": ids[label],
                    "target": END,
                    "metrics": {"count": float(n), "cases": float(n), "share": n / n_cases, "caseShare": n / n_cases},
                    "tags": ["end"],
                }
            )
    overlays: list[dict[str, Any]] = []
    without_activity: list[str] = []
    constraints_meta: list[dict[str, Any]] = []
    for nc in constraints:
        c = nc.constraint
        share = violation_shares.get(nc.id, {})
        payload = _payload(nc, share, n_cases)
        acts = [a for a in c.activities() if a in kept]
        descr: dict[str, Any] = {
            "id": nc.id,
            "type": c.type,
            "label": nc.id,
            "layer": nc.layer,
            "description": nc.description,
            "activities": [ids[a] for a in acts],
            "params": {k: v for k, v in payload.items() if k in ("threshold", "width", "unit", "direction")},
        }
        if isinstance(c, wise.Lag | wise.Precedence):
            sources = [a for a in c.a if a in kept]
            targets = [a for a in c.b if a in kept]
            descr["a"] = [ids[a] for a in sources]
            descr["b"] = [ids[b] for b in targets]
            for a in sources:
                for b in targets:
                    eid = f"c_{nc.id}__{ids[a]}__{ids[b]}"
                    arc_payload = {**payload, "source": ids[a], "target": ids[b]}
                    edges.append(
                        {
                            "id": eid,
                            "kind": "constraint",
                            "source": ids[a],
                            "target": ids[b],
                            "metrics": {k: float(v) for k, v in share.items()},
                            "tags": [c.type],
                            "payload": arc_payload,
                        }
                    )
                    overlays.append({"kind": "arc", "target": eid, "payload": arc_payload})
            if not sources or not targets:
                without_activity.append(nc.id)
        elif isinstance(c, wise.Exclusion):
            for a in acts:
                overlays.append({"kind": "hatch", "target": ids[a], "payload": payload})
        elif isinstance(c, wise.Presence | wise.Singularity):
            for a in acts:
                overlays.append({"kind": "badge", "target": ids[a], "payload": payload})
        elif isinstance(c, wise.Balance):
            for a in acts:
                overlays.append({"kind": "chip", "target": ids[a], "payload": payload})
        else:
            without_activity.append(nc.id)
        if share.get("shareViolated"):
            for a in acts:
                overlays.append(
                    {
                        "kind": "tint",
                        "target": ids[a],
                        "payload": {
                            "constraintId": nc.id,
                            "label": nc.id,
                            "value": share["shareViolated"],
                            "shareViolated": share["shareViolated"],
                        },
                    }
                )
        constraints_meta.append(
            {
                "description": descr,
                "stats": {
                    "cases": n_cases,
                    "evaluated": share.get("casesEvaluated"),
                    "violationShare": share.get("shareViolated"),
                    "coverage": payload.get("coverage"),
                    "meanViolation": share.get("meanViolation"),
                },
            }
        )
    groups: list[dict[str, Any]] = []
    if stages is not None:
        for stage_def in stages.stages:
            if group_members.get(str(stage_def["id"])):
                groups.append(
                    {"id": str(stage_def["id"]), "kind": "stage", "label": str(stage_def["label"]), "parent": None}
                )
    out_meta = {
        **meta,
        "abstraction": abstraction,
        "cases": dfg.get("cases", 0),
        "events": dfg.get("events", 0),
        "nodesTotal": len(dfg["nodes"]),
        "edgesTotal": len(dfg["edges"]),
        "constraintsWithoutNodes": without_activity,
        "stages": [dict(s) for s in stages.stages] if stages is not None else [],
        "stagedActivities": sum(group_members.values()),
        "constraints": constraints_meta,
    }
    return {"nodes": nodes, "edges": edges, "groups": groups, "overlays": overlays, "meta": out_meta}


def violation_shares(violations: pd.DataFrame) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for cid in violations.columns:
        v = violations[cid]
        ev = v.notna()
        if not ev.any():
            out[str(cid)] = {}
            continue
        out[str(cid)] = {
            "shareViolated": float((v[ev] > 0).mean()),
            "meanViolation": float(v[ev].mean()),
            "casesEvaluated": int(ev.sum()),
        }
    return out
