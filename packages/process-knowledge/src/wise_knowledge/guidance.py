"""Knowledge hub: guidance pages, hub index and the ``metadata.guidance`` block of norm templates.

The hub is one page per node (``docs/panel/knowledge_hub_panel.md`` §3):
stages, layers (expectation areas), expectations (template constraints),
failure modes, usual reasons, usual actions and KPIs. Every page follows the
same template; the generic tier of the text comes from ``guidance.yaml``,
the project overlay is stored with the project and merged by the backend.

Shapes follow ``packages/api-schema/CONTRACT_CYCLE2.md``:

* ``Hub.index()`` -> ``{"nodes": [{id, kind, plain_name, method_name, ...}], "edges": [{from, to, kind}]}``
* ``Hub.page(node_id)`` -> ``{node, guidance, related: {stage, expectations[], failure_modes[], kpis[], playbook[]}, overlay}``
* ``template_guidance(pack, template_id)`` -> the ``metadata.guidance`` block keyed by layer id and constraint id.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import GUIDANCE_KINDS, Guidance, Pack

HUB_KINDS = ("stage", "layer", "expectation", "failure_mode", "reason", "action", "kpi")
HUB_EDGE_KINDS = (
    "precedes",
    "contains",
    "detects",
    "in_stage",
    "usual_reason",
    "usual_action",
    "related_kpi",
    "measures",
)
COUNTERMEASURE_LABELS = {
    "policy": "policy",
    "system_setting": "system setting",
    "standard_work": "standard work",
    "training": "training",
    "catalogue": "catalogue",
    "contract": "contract",
    "master_data": "master data",
    "automation": "automation",
    "review": "review cadence",
    "measurement": "measurement fix",
}


def _text_id(prefix: str, text: str) -> str:
    digest = hashlib.sha1(text.strip().lower().encode("utf-8")).hexdigest()[:10]
    return f"{prefix}:{digest}"


def hub_node_id(kind: str, *parts: str) -> str:
    if kind not in HUB_KINDS:
        raise KeyError(f"unknown hub kind {kind!r}; known {HUB_KINDS}")
    return ":".join([kind, *parts])


def _template_docs(pack: Pack) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for t in pack.templates:
        if t.path and t.path.is_file():
            out[t.id] = json.loads(t.path.read_text(encoding="utf-8"))
    return out


def _lang(text: dict[str, str], lang: str) -> str:
    return text.get(lang) or text.get("en", "")


# --------------------------------------------------------------------------- hub
@dataclass
class Hub:
    """The hub index (nodes and edges) and the page lookups of one pack."""

    pack: Pack
    lang: str = "en"
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    _by_id: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    _guidance: dict[str, Guidance] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._build()

    # ---- construction
    def _add(self, node: dict[str, Any]) -> dict[str, Any]:
        if node["id"] not in self._by_id:
            self.nodes.append(node)
            self._by_id[node["id"]] = node
        return self._by_id[node["id"]]

    def _edge(self, src: str, dst: str, kind: str) -> None:
        if kind not in HUB_EDGE_KINDS:
            raise KeyError(kind)
        e = {"from": src, "to": dst, "kind": kind}
        if e not in self.edges:
            self.edges.append(e)

    def _attach_guidance(self, node_id: str, g: Guidance | None) -> None:
        if g is None:
            return
        self._guidance[node_id] = g
        for r in g.usual_reasons:
            rid = _text_id("reason", r.text)
            self._add(
                {
                    "id": rid,
                    "kind": "reason",
                    "plain_name": r.text,
                    "method_name": f"{'in the log' if r.where == 'log' else 'outside the log'}: {r.check}",
                    "where": r.where,
                    "check": r.check,
                }
            )
            self._edge(node_id, rid, "usual_reason")
        for a in g.usual_actions:
            aid = _text_id("action", a.text)
            self._add(
                {
                    "id": aid,
                    "kind": "action",
                    "plain_name": a.text,
                    "method_name": COUNTERMEASURE_LABELS.get(a.countermeasure, a.countermeasure),
                    "countermeasure": a.countermeasure,
                    "owner_role": a.owner_role,
                    "effect_area": a.effect_area,
                }
            )
            self._edge(node_id, aid, "usual_action")
        for k in g.kpis:
            self._edge(node_id, hub_node_id("kpi", k), "related_kpi")

    def _build(self) -> None:
        pack, lang = self.pack, self.lang
        for s in pack.stages:
            self._add(
                {
                    "id": hub_node_id("stage", s.id),
                    "kind": "stage",
                    "plain_name": _lang(s.name, lang),
                    "method_name": s.id,
                    "order": s.order,
                }
            )
        for a, b in zip(pack.stages, pack.stages[1:], strict=False):
            self._edge(hub_node_id("stage", a.id), hub_node_id("stage", b.id), "precedes")
        for k in pack.kpis:
            self._add(
                {
                    "id": hub_node_id("kpi", k.id),
                    "kind": "kpi",
                    "plain_name": _lang(k.name, lang),
                    "method_name": k.formula or k.id,
                    "unit": k.unit,
                    "direction": k.direction,
                }
            )
        for layer in pack.layers:
            g = pack.guidance_for("layer", layer.id)
            node = {
                "id": hub_node_id("layer", layer.id),
                "kind": "layer",
                "plain_name": g.plain_name_en if g else _lang(layer.name, lang),
                "method_name": _lang(layer.name, lang),
                "missed_label": g.missed_label_en if g else "",
                "template_layers": dict(layer.template_layers),
            }
            self._add(node)
            self._attach_guidance(node["id"], g)
        docs = _template_docs(pack)
        for tid, doc in docs.items():
            for c in doc.get("constraints", []):
                cid = c["id"]
                layer = pack.layer_for_template(tid, c.get("layer", ""))
                g = pack.guidance_for("constraint", cid, template=tid)
                nid = hub_node_id("expectation", tid, cid)
                self._add(
                    {
                        "id": nid,
                        "kind": "expectation",
                        "plain_name": g.plain_name_en if g else cid,
                        "method_name": c.get("description") or f"{c.get('type')} constraint {cid}",
                        "template": tid,
                        "constraint_id": cid,
                        "constraint_type": c.get("type"),
                        "layer": layer.id if layer else c.get("layer"),
                        "missed_label": g.missed_label_en if g else "",
                    }
                )
                if layer:
                    self._edge(hub_node_id("layer", layer.id), nid, "contains")
                for fm in pack.failure_modes_for_constraint(cid, template=tid):
                    self._edge(nid, hub_node_id("failure_mode", fm.id), "detects")
                self._attach_guidance(nid, g)
        for fm in pack.failure_modes:
            g = pack.guidance_for("failure_mode", fm.id)
            nid = hub_node_id("failure_mode", fm.id)
            self._add(
                {
                    "id": nid,
                    "kind": "failure_mode",
                    "plain_name": g.plain_name_en if g else fm.name_en,
                    "method_name": fm.name_en,
                    "stage": fm.stage,
                    "pattern_kind": fm.kind,
                    "evidence": fm.evidence,
                    "missed_label": g.missed_label_en if g else "",
                }
            )
            self._edge(nid, hub_node_id("stage", fm.stage), "in_stage")
            for k in fm.kpis:
                self._edge(hub_node_id("kpi", k), nid, "measures")
            self._attach_guidance(nid, g)
        for k in pack.kpis:
            for fid in k.failure_modes:
                self._edge(hub_node_id("kpi", k.id), hub_node_id("failure_mode", fid), "measures")
        # edges to nodes that do not exist (a stale kpi id) are dropped
        ids = set(self._by_id)
        self.edges = [e for e in self.edges if e["from"] in ids and e["to"] in ids]

    # ---- lookups
    def node(self, node_id: str) -> dict[str, Any]:
        try:
            return self._by_id[node_id]
        except KeyError:
            raise KeyError(f"unknown hub node {node_id!r}") from None

    def node_for(self, kind: str, entry_id: str, template: str | None = None) -> str | None:
        """Hub node id for a guidance subject (layer, constraint or failure mode)."""
        if kind not in GUIDANCE_KINDS:
            raise KeyError(kind)
        if kind == "layer":
            layer = self.pack.layer_for_template(template or "", entry_id) if template else None
            if layer is None:
                for cand in self.pack.layers:
                    if cand.id == entry_id or entry_id in cand.template_layers.values():
                        layer = cand
                        break
            return hub_node_id("layer", layer.id) if layer else None
        if kind == "failure_mode":
            nid = hub_node_id("failure_mode", entry_id)
            return nid if nid in self._by_id else None
        for n in self.nodes:
            if (
                n["kind"] == "expectation"
                and n["constraint_id"] == entry_id
                and (template is None or n["template"] == template)
            ):
                return n["id"]
        return None

    def _out(self, node_id: str, kind: str | None = None) -> list[str]:
        return [e["to"] for e in self.edges if e["from"] == node_id and (kind is None or e["kind"] == kind)]

    def _in(self, node_id: str, kind: str | None = None) -> list[str]:
        return [e["from"] for e in self.edges if e["to"] == node_id and (kind is None or e["kind"] == kind)]

    def _brief_node(self, node_id: str) -> dict[str, Any]:
        n = self.node(node_id)
        return {k: n[k] for k in ("id", "kind", "plain_name", "method_name")}

    def index(self) -> dict[str, Any]:
        return {
            "pack": self.pack.id,
            "process": self.pack.process,
            "case_noun": self.pack.stage_model.noun.get(self.lang, self.pack.stage_model.noun.get("en")),
            "nodes": [dict(n) for n in self.nodes],
            "edges": [dict(e) for e in self.edges],
        }

    def page(self, node_id: str) -> dict[str, Any]:
        n = self.node(node_id)
        kind = n["kind"]
        g = self._guidance.get(node_id)
        fms: list[str] = []
        expectations: list[str] = []
        stage: str | None = None
        if kind == "layer":
            expectations = self._out(node_id, "contains")
            fms = _unique(f for e in expectations for f in self._out(e, "detects"))
        elif kind == "expectation":
            fms = self._out(node_id, "detects")
            expectations = _unique(e for f in fms for e in self._in(f, "detects") if e != node_id)
            stages = _unique(s for f in fms for s in self._out(f, "in_stage"))
            stage = stages[0] if stages else None
        elif kind == "failure_mode":
            stage = hub_node_id("stage", n["stage"])
            expectations = self._in(node_id, "detects")
            fms = [
                x["id"]
                for x in self.nodes
                if x["kind"] == "failure_mode" and x["stage"] == n["stage"] and x["id"] != node_id
            ]
        elif kind == "stage":
            stage = node_id
            fms = self._in(node_id, "in_stage")
            expectations = _unique(e for f in fms for e in self._in(f, "detects"))
        elif kind == "kpi":
            fms = self._out(node_id, "measures")
            expectations = _unique(e for f in fms for e in self._in(f, "detects"))
        else:  # reason, action: the subjects that list them
            subjects = self._in(node_id)
            expectations = [s for s in subjects if s.startswith("expectation:")]
            fms = [s for s in subjects if s.startswith("failure_mode:")]
        kpis = _unique([*self._out(node_id, "related_kpi"), *(k for f in fms for k in self._in(f, "measures"))])
        fm_ids = {f.split(":", 1)[1] for f in fms} | ({n["id"].split(":", 1)[1]} if kind == "failure_mode" else set())
        playbook = [
            {
                "id": pb.id,
                "journey_stage": pb.journey_stage,
                "title": _lang(pb.title, self.lang),
                "questions": [_lang(q, self.lang) for q in pb.questions],
            }
            for pb in self.pack.playbooks
            if set(pb.failure_modes) & fm_ids
        ]
        page = {
            "node": dict(n),
            "guidance": g.as_block(hub_node=node_id, method_name=n["method_name"]) if g else None,
            "related": {
                "stage": self._brief_node(stage) if stage else None,
                "expectations": [self._brief_node(e) for e in expectations],
                "failure_modes": [self._brief_node(f) for f in fms],
                "kpis": [self._brief_node(k) for k in kpis],
                "playbook": playbook,
                "reasons": [self._brief_node(r) for r in self._out(node_id, "usual_reason")],
                "actions": [self._brief_node(a) for a in self._out(node_id, "usual_action")],
            },
            "overlay": None,
        }
        return page

    def pages(self) -> dict[str, dict[str, Any]]:
        return {n["id"]: self.page(n["id"]) for n in self.nodes}

    def export(self) -> dict[str, Any]:
        """Index plus every page; what ``wise-knowledge hub <pack> --json`` prints."""
        return {**self.index(), "pages": self.pages()}


def _unique(items: Any) -> list[str]:
    return list(dict.fromkeys(items))


def build_hub(pack: Pack, lang: str = "en") -> Hub:
    return Hub(pack=pack, lang=lang)


# --------------------------------------------------------------------------- page rendering
def render_page(hub: Hub, node_id: str, lang: str = "en") -> str:
    """The hub page as text, in the template of knowledge_hub_panel.md §3."""
    pack = hub.pack
    page = hub.page(node_id)
    n, g, rel = page["node"], page["guidance"], page["related"]
    roles = {r.id: _lang(r.name, lang) for r in pack.slicing.roles}
    layers = {layer.id: layer for layer in pack.layers}

    def role(rid: str) -> str:
        return roles.get(rid, rid)

    def layer_plain(lid: str) -> str:
        lg = pack.guidance_for("layer", lid)
        return lg.plain_name_en if lg else _lang(layers[lid].name, lang) if lid in layers else lid

    header_right = f"{n['method_name']} · {n['kind']} {n['id'].split(':', 1)[1]}"
    if n["kind"] == "layer":
        tl = ", ".join(f"{v} in {k}" for k, v in n.get("template_layers", {}).items())
        header_right = f"{n['method_name']} · layer {n['id'].split(':', 1)[1]}" + (f" ({tl})" if tl else "")
    lines = [f"{n['plain_name']}", f"  [{header_right}]"]
    if n.get("missed_label"):
        lines.append(f"  when missed a card says: {n['missed_label']}")
    lines.append("")
    if g is None:
        lines.append("(no guidance entry for this node; reasons and actions are listed on the pages that name it)")
    else:
        lines += [
            "What this means",
            f"  {g['expectation']}",
            f"  When missed: {g['meaning_when_missed']}",
            "Why it matters",
            f"  {g['why_it_matters']}",
            "How we detect it",
            f"  {g['how_detected']}",
            "What usually causes it (candidates to test, not findings)",
        ]
        for r in g["usual_reasons"]:
            check = r["check"]
            if r["where"] == "log":
                where = "in the log:" if check.lower().startswith("check") else "in the log: check"
            else:
                where = "outside the log:" if check.lower().startswith("ask") else "outside the log: ask"
            lines.append(f"  - {r['text']} — {where} {check}")
        lines.append("What usually helps")
        for a in g["usual_actions"]:
            cm = COUNTERMEASURE_LABELS.get(a["countermeasure"], a["countermeasure"])
            lines.append(
                f"  - {a['text']} ({cm} · {role(a['owner_role'])} · effect on {layer_plain(a['effect_area'])})"
            )
        lines.append("What to check first")
        for i, c in enumerate(g["what_to_check_first"], 1):
            lines.append(f"  {i}. {c}")
        lines.append("Examples")
        for e in g["examples"]:
            trace = f" [{e['trace']}]" if e.get("trace") else ""
            lines.append(f"  - {e['kind']}: {e['text']}{trace}")
    lines.append("Related")
    if rel["stage"]:
        lines.append(f"  stage: {rel['stage']['plain_name']}")
    if rel["expectations"]:  # one expectation node per template; the same plain name is listed once
        lines.append("  expectations: " + "; ".join(_unique(x["plain_name"] for x in rel["expectations"])))
    if rel["failure_modes"]:
        lines.append("  failure modes: " + "; ".join(_unique(x["plain_name"] for x in rel["failure_modes"])))
    if rel["kpis"]:
        lines.append("  KPIs: " + "; ".join(_unique(x["plain_name"] for x in rel["kpis"])))
    for pb in rel["playbook"]:
        lines.append(f"  playbook {pb['journey_stage']} ({pb['title']}): " + " | ".join(pb["questions"][:3]))
    lines.append("Your organisation's note")
    lines.append(
        "  (none yet; the project overlay is written by the stakeholders and reviewed before it is shown here)"
    )
    if g is not None:
        lines.append("")
        lines.append(
            f"owner: {role(g['owner_role'])} · stakeholders: {g['stakeholders']} · sources: {'; '.join(str(s) for s in g['sources'])} · {g['review_status']} v{g['version']}"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------- norm metadata block
def template_guidance(pack: Pack, template_id: str) -> dict[str, Any]:
    """The ``metadata.guidance`` block for a template: generic tier keyed by layer id and constraint id."""
    docs = _template_docs(pack)
    if template_id not in docs:
        raise KeyError(f"unknown template {template_id!r}; known {list(docs)}")
    doc = docs[template_id]
    hub = build_hub(pack)
    guidance_doc = pack.raw.get("guidance") or {}
    layers: dict[str, Any] = {}
    for layer in doc.get("layers", []):
        tl = layer["id"]
        pl = pack.layer_for_template(template_id, tl)
        g = pack.guidance_for("layer", pl.id) if pl else None
        if g is None:
            continue
        layers[tl] = g.as_block(
            id=tl,
            pack_layer_id=pl.id,
            template_layer_id=tl,
            hub_node=hub.node_for("layer", pl.id),
            method_name=layer.get("name", ""),
        )
    constraints: dict[str, Any] = {}
    for c in doc.get("constraints", []):
        cid = c["id"]
        g = pack.guidance_for("constraint", cid, template=template_id)
        if g is None:
            continue
        constraints[cid] = g.as_block(
            id=cid,
            guidance_id=g.id,
            constraint_id=cid,
            template=template_id,
            hub_node=hub.node_for("constraint", cid, template=template_id),
            method_name=c.get("description", ""),
        )
    return {
        "version": str(guidance_doc.get("version", "1")),
        "pack": pack.id,
        "review_status": guidance_doc.get("review_status", "draft"),
        "source": "guidance.yaml of the pack (generic tier); the project overlay is stored with the project",
        "layers": layers,
        "constraints": constraints,
    }


def guidance_complete(pack: Pack, template_id: str) -> tuple[bool, list[str]]:
    """Whether every layer and constraint of a template has guidance; returns the missing ids."""
    doc = _template_docs(pack)[template_id]
    block = template_guidance(pack, template_id)
    missing = [f"layer {x['id']}" for x in doc.get("layers", []) if x["id"] not in block["layers"]]
    missing += [f"constraint {c['id']}" for c in doc.get("constraints", []) if c["id"] not in block["constraints"]]
    return (not missing, missing)


def embed_guidance(pack: Pack, template_id: str, write: bool = True) -> tuple[bool, dict[str, Any]]:
    """Write (or check) ``metadata.guidance`` in a template's JSON; returns (changed, document).

    Verbatim templates (``verbatim: true`` in templates/index.yaml) are never
    rewritten: their guidance is served from ``guidance.yaml`` only.
    """
    entry = pack.template(template_id)
    if entry.verbatim:
        raise ValueError(f"template {template_id!r} is a verbatim copy; guidance stays in guidance.yaml")
    path = Path(entry.path)
    doc = json.loads(path.read_text(encoding="utf-8"))
    block = template_guidance(pack, template_id)
    changed = doc.get("metadata", {}).get("guidance") != block
    if changed and write:
        doc.setdefault("metadata", {})["guidance"] = block
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed, doc


__all__ = [
    "COUNTERMEASURE_LABELS",
    "HUB_EDGE_KINDS",
    "HUB_KINDS",
    "Hub",
    "build_hub",
    "embed_guidance",
    "guidance_complete",
    "hub_node_id",
    "render_page",
    "template_guidance",
]
