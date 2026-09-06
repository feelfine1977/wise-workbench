"""Knowledge graph as node and edge tables (a data model, not a database).

Node types: ``activity``, ``stage``, ``constraint_pattern``, ``failure_mode``,
``cause_candidate``, ``remedy``, ``kpi``, ``role``. Edge types: ``in_stage``
(activity -> stage), ``precedes`` (stage -> stage from the stage order and
activity -> activity from the expected orderings), ``detected_by`` (failure
mode -> constraint pattern), ``typical_cause`` (failure mode -> cause
candidate), ``typical_remedy`` (failure mode -> remedy), ``owned_by``
(failure mode -> role; slice key owners are not nodes), plus two supporting
edges: ``involves`` (constraint pattern -> activity) and ``measures`` (kpi
-> failure mode). Every curated edge carries the pack and its sources.
"""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Any

from .models import Pack

NODE_TYPES = ("activity", "stage", "constraint_pattern", "failure_mode", "cause_candidate", "remedy", "kpi", "role")
EDGE_TYPES = (
    "in_stage",
    "precedes",
    "detected_by",
    "typical_cause",
    "typical_remedy",
    "owned_by",
    "involves",
    "measures",
)


@dataclass(frozen=True)
class Node:
    id: str
    type: str
    label: str
    pack: str
    stage: str | None = None
    attrs: dict[str, Any] = field(default_factory=dict)

    def as_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "label": self.label,
            "pack": self.pack,
            "stage": self.stage or "",
            "attrs": json.dumps(self.attrs, ensure_ascii=False, sort_keys=True),
        }


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    type: str
    pack: str
    origin: str = "curated"
    sources: tuple[str, ...] = ()
    attrs: dict[str, Any] = field(default_factory=dict)

    def as_row(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "pack": self.pack,
            "origin": self.origin,
            "sources": "; ".join(self.sources),
            "attrs": json.dumps(self.attrs, ensure_ascii=False, sort_keys=True),
        }


def _text_id(prefix: str, text: str) -> str:
    digest = hashlib.sha1(text.strip().lower().encode("utf-8")).hexdigest()[:10]
    return f"{prefix}:{digest}"


def _src(items: tuple[Any, ...]) -> tuple[str, ...]:
    out = []
    for s in items:
        out.append(s if isinstance(s, str) else str(s.get("title", s)))
    return tuple(out)


@dataclass
class KnowledgeGraph:
    pack: str
    nodes: list[Node]
    edges: list[Edge]

    # ---- tables
    def node_table(self) -> list[dict[str, Any]]:
        return [n.as_row() for n in self.nodes]

    def edge_table(self) -> list[dict[str, Any]]:
        return [e.as_row() for e in self.edges]

    def to_frames(self):  # pragma: no cover - convenience for notebooks
        import pandas as pd

        return pd.DataFrame(self.node_table()), pd.DataFrame(self.edge_table())

    def write_csv(self, directory: str | Path) -> tuple[Path, Path]:
        d = Path(directory)
        d.mkdir(parents=True, exist_ok=True)
        nodes_path, edges_path = d / f"{self.pack}_nodes.csv", d / f"{self.pack}_edges.csv"
        for path, rows in ((nodes_path, self.node_table()), (edges_path, self.edge_table())):
            with path.open("w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
        return nodes_path, edges_path

    # ---- lookups
    def node(self, node_id: str) -> Node:
        for n in self.nodes:
            if n.id == node_id:
                return n
        raise KeyError(node_id)

    def nodes_of_type(self, node_type: str) -> list[Node]:
        return [n for n in self.nodes if n.type == node_type]

    def edges_of_type(self, edge_type: str) -> list[Edge]:
        return [e for e in self.edges if e.type == edge_type]

    def neighbors(self, node_id: str, edge_type: str | None = None, direction: str = "out") -> list[Node]:
        ids: list[str] = []
        for e in self.edges:
            if edge_type and e.type != edge_type:
                continue
            if direction in ("out", "both") and e.source == node_id:
                ids.append(e.target)
            if direction in ("in", "both") and e.target == node_id:
                ids.append(e.source)
        by_id = {n.id: n for n in self.nodes}
        return [by_id[i] for i in dict.fromkeys(ids) if i in by_id]

    def explain(self, constraint_ref: str, template: str | None = None) -> list[dict[str, Any]]:
        """Explanation paths for a constraint: failure modes, candidate causes, remedies, evidence to check, owner."""
        out = []
        for pattern in self.nodes_of_type("constraint_pattern"):
            if pattern.attrs.get("constraint_ref") != constraint_ref:
                continue
            if template and pattern.attrs.get("template") != template:
                continue
            for fm in self.neighbors(pattern.id, "detected_by", direction="in"):
                out.append(
                    {
                        "constraint": constraint_ref,
                        "template": pattern.attrs.get("template"),
                        "pattern": pattern.id,
                        "failure_mode": fm.id,
                        "failure_mode_name": fm.label,
                        "stage": fm.stage,
                        "causes": [n.label for n in self.neighbors(fm.id, "typical_cause")],
                        "remedies": [n.label for n in self.neighbors(fm.id, "typical_remedy")],
                        "evidence_to_check": list(fm.attrs.get("evidence_to_check", [])),
                        "owner_role": [n.label for n in self.neighbors(fm.id, "owned_by")],
                        "sources": list(fm.attrs.get("sources", [])),
                    }
                )
        return out

    def to_networkx(self):
        try:
            import networkx as nx
        except ImportError as exc:  # pragma: no cover
            raise ImportError("networkx is optional; install wise-knowledge[graph]") from exc
        g = nx.MultiDiGraph(pack=self.pack)
        for n in self.nodes:
            g.add_node(n.id, type=n.type, label=n.label, stage=n.stage, **n.attrs)
        for e in self.edges:
            g.add_edge(e.source, e.target, key=e.type, type=e.type, origin=e.origin, sources=e.sources, **e.attrs)
        return g


def build_graph(pack: Pack) -> KnowledgeGraph:
    nodes: list[Node] = []
    edges: list[Edge] = []
    pid = pack.id
    seen: set[str] = set()

    def add_node(n: Node) -> None:
        if n.id not in seen:
            nodes.append(n)
            seen.add(n.id)

    # stages and their order
    ordered = pack.stage_model.ordered
    for s in ordered:
        add_node(
            Node(
                id=s.id,
                type="stage",
                label=s.name.get("en", s.id),
                pack=pid,
                stage=s.id,
                attrs={"order": s.order, "loops_allowed_to": list(s.loops_allowed_to)},
            )
        )
    for prev, nxt in pairwise(ordered):
        edges.append(Edge(source=prev.id, target=nxt.id, type="precedes", pack=pid, attrs={"level": "stage"}))

    # activities
    for a in pack.activities:
        add_node(
            Node(
                id=a.id,
                type="activity",
                label=a.name_en,
                pack=pid,
                stage=a.stage,
                attrs={
                    "granularity": a.granularity,
                    "tags": list(a.tags),
                    "synonyms_de": list(a.synonyms.get("de", ())),
                    "sources": list(_src(a.sources)),
                },
            )
        )
        edges.append(Edge(source=a.id, target=a.stage, type="in_stage", pack=pid, sources=_src(a.sources)))
    for o in pack.stage_model.expected_orderings:
        edges.append(
            Edge(
                source=o.a,
                target=o.b,
                type="precedes",
                pack=pid,
                attrs={"level": "activity", "variants": list(o.variants), "note": o.note},
            )
        )

    # roles
    for r in pack.slicing.roles:
        add_node(
            Node(
                id=f"role:{r.id}",
                type="role",
                label=r.name.get("en", r.id),
                pack=pid,
                attrs={"description": r.description},
            )
        )

    # kpis
    for k in pack.kpis:
        add_node(
            Node(
                id=k.id,
                type="kpi",
                label=k.name.get("en", k.id),
                pack=pid,
                stage=k.stage,
                attrs={"unit": k.unit, "direction": k.direction, "formula": k.formula},
            )
        )

    # failure modes, patterns, causes, remedies
    for fm in pack.failure_modes:
        add_node(
            Node(
                id=fm.id,
                type="failure_mode",
                label=fm.name_en,
                pack=pid,
                stage=fm.stage,
                attrs={
                    "signature": fm.signature,
                    "evidence": fm.evidence,
                    "observed_share": list(fm.observed_share),
                    "evidence_to_check": list(fm.evidence_to_check),
                    "sources": list(_src(fm.sources)),
                    "review_status": fm.review_status,
                },
            )
        )
        srcs = _src(fm.sources)
        for i, p in enumerate(fm.wise_patterns):
            pid_node = f"pattern:{fm.id}:{i}"
            add_node(
                Node(
                    id=pid_node,
                    type="constraint_pattern",
                    label=f"{p.type} in {p.layer}",
                    pack=pid,
                    stage=fm.stage,
                    attrs={
                        "constraint_type": p.type,
                        "layer": p.layer,
                        "params": p.params,
                        "template": p.template,
                        "constraint_ref": p.constraint_ref,
                        "calibration": p.calibration,
                        "applicability": p.applicability,
                    },
                )
            )
            edges.append(Edge(source=fm.id, target=pid_node, type="detected_by", pack=pid, sources=srcs))
            for act in p.referenced_activities():
                edges.append(Edge(source=pid_node, target=act, type="involves", pack=pid))
        for c in fm.typical_causes:
            cid = _text_id("cause", c)
            add_node(Node(id=cid, type="cause_candidate", label=c, pack=pid))
            edges.append(
                Edge(
                    source=fm.id,
                    target=cid,
                    type="typical_cause",
                    pack=pid,
                    sources=srcs,
                    attrs={"status": "candidate"},
                )
            )
        for r in fm.typical_remedies:
            rid = _text_id("remedy", r)
            add_node(Node(id=rid, type="remedy", label=r, pack=pid))
            edges.append(
                Edge(
                    source=fm.id,
                    target=rid,
                    type="typical_remedy",
                    pack=pid,
                    sources=srcs,
                    attrs={"status": "candidate"},
                )
            )
        edges.append(Edge(source=fm.id, target=f"role:{fm.owner_role}", type="owned_by", pack=pid, sources=srcs))
        for k in fm.kpis:
            edges.append(Edge(source=k, target=fm.id, type="measures", pack=pid))
    for k in pack.kpis:
        for fm_id in k.failure_modes:
            edge = Edge(source=k.id, target=fm_id, type="measures", pack=pid)
            if edge not in edges:
                edges.append(edge)
    return KnowledgeGraph(pack=pid, nodes=nodes, edges=edges)


__all__ = ["EDGE_TYPES", "NODE_TYPES", "Edge", "KnowledgeGraph", "Node", "build_graph"]
