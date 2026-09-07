"""BPMN 2.0 export of the process flow (R3-O11: "I could not see the BPMN implementation").

The flow the screens show is a directly-follows graph. This module writes that
graph — or the knowledge pack's stage model — as a BPMN 2.0 document that any
modeller (Camunda, bpmn-js, Signavio, Visio) opens: a collaboration with one
participant, one process, one lane per stage, a task per activity, exclusive
gateways where a task branches or joins, sequence flows for the observed
paths, and a ``BPMNDiagram`` with coordinates so the file opens laid out
rather than as a pile at the origin.

The input is the ``FlowGraph`` payload of the flow endpoint (nodes, edges,
groups, meta), so the exported model is exactly what the map shows at the
chosen detail level: the same nodes, the same edges, the same filter.
Metrics travel as ``bpmn:documentation`` and as ``wise:*`` attributes in the
workbench's own namespace, which modellers ignore and the workbench reads back.
"""

from __future__ import annotations

import re
from typing import Any
from xml.sax.saxutils import escape, quoteattr

NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "wise": "https://wise-workbench.local/bpmn",
}
FLOW_EDGE_KINDS = ("follows", "flow")
TASK_W, TASK_H = 130, 70
GATEWAY_S = 40
EVENT_S = 36
COL_W, ROW_H = 220, 110
LANE_PAD = 30


def _ncname(value: str, prefix: str = "n") -> str:
    """An XML id: letters, digits, underscore, dash and dot, never starting with a digit."""
    cleaned = re.sub(r"[^A-Za-z0-9_.\-]", "_", str(value))
    if not cleaned or not re.match(r"[A-Za-z_]", cleaned[0]):
        cleaned = f"{prefix}_{cleaned}"
    return cleaned


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN out


def _documentation(node: dict[str, Any], noun: str) -> str:
    m = node.get("metrics") or {}
    parts: list[str] = []
    cases, events = _num(m.get("cases")), _num(m.get("events"))
    if cases is not None:
        parts.append(f"{int(cases):,} {noun}")
    if events is not None:
        parts.append(f"{int(events):,} events")
    share = _num(m.get("share"))
    if share is not None:
        parts.append(f"{share * 100:.0f} % of the {noun}")
    violated = _num(m.get("violationShare"))
    if violated:
        parts.append(f"{violated * 100:.0f} % of them miss an expectation that names this step")
    return "; ".join(parts)


def _edge_documentation(edge: dict[str, Any], noun: str) -> str:
    m = edge.get("metrics") or {}
    parts: list[str] = []
    cases = _num(m.get("cases"))
    if cases is not None:
        parts.append(f"{int(cases):,} {noun}")
    count = _num(m.get("count"))
    if count is not None:
        parts.append(f"{int(count):,} transitions")
    lag = _num(m.get("medianLagHours"))
    if lag is not None:
        parts.append(f"median {lag / 24:.1f} days" if lag >= 48 else f"median {lag:.1f} hours")
    return "; ".join(parts)


class _Model:
    """The BPMN elements built from a flow graph, before serialisation."""

    def __init__(self) -> None:
        self.elements: list[dict[str, Any]] = []
        self.flows: list[dict[str, Any]] = []
        self.by_id: dict[str, dict[str, Any]] = {}

    def add(self, element: dict[str, Any]) -> dict[str, Any]:
        self.elements.append(element)
        self.by_id[element["id"]] = element
        return element

    def flow(self, source: str, target: str, **extra: Any) -> None:
        fid = _ncname(f"flow_{source}__{target}_{len(self.flows)}")
        self.flows.append({"id": fid, "source": source, "target": target, **extra})


def _layers(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], stage_order: list[str]) -> dict[str, int]:
    """A column per node: the stage order when stages are known, else the longest path from a start node."""
    by_stage = {n["id"]: n.get("group") for n in nodes}
    if stage_order and all(by_stage.get(n["id"]) in stage_order for n in nodes if by_stage.get(n["id"])):
        known = {n["id"]: stage_order.index(str(by_stage[n["id"]])) for n in nodes if by_stage.get(n["id"])}
        if known:
            rest = [n["id"] for n in nodes if n["id"] not in known]
            depth = _longest_path(nodes, edges)
            return {**known, **{nid: len(stage_order) + depth.get(nid, 0) for nid in rest}}
    return _longest_path(nodes, edges)


def _longest_path(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, int]:
    ids = [n["id"] for n in nodes]
    incoming: dict[str, list[str]] = {i: [] for i in ids}
    outgoing: dict[str, list[str]] = {i: [] for i in ids}
    for e in edges:
        if e["source"] in outgoing and e["target"] in incoming and e["source"] != e["target"]:
            outgoing[e["source"]].append(e["target"])
            incoming[e["target"]].append(e["source"])
    depth = dict.fromkeys(ids, 0)
    frontier = [i for i in ids if not incoming[i]] or ids[:1]
    seen: set[str] = set()
    for _ in range(len(ids) + 1):  # bounded relaxation: cycles cannot grow the depth for ever
        changed = False
        for src in list(frontier) + [i for i in ids if i not in frontier]:
            for dst in outgoing[src]:
                if depth[dst] < depth[src] + 1:
                    depth[dst] = depth[src] + 1
                    changed = True
        seen.update(frontier)
        if not changed:
            break
    return depth


def build_model(graph: dict[str, Any], *, gateways: bool = True, noun: str = "cases") -> dict[str, Any]:
    """Elements, flows, lanes and coordinates for one flow graph."""
    nodes = list(graph.get("nodes") or [])
    edges = [e for e in (graph.get("edges") or []) if e.get("kind") in FLOW_EDGE_KINDS]
    groups = list(graph.get("groups") or [])
    stage_order = [str(g["id"]) for g in groups]
    activities = [n for n in nodes if n.get("kind") == "activity"]
    start_nodes = [n for n in nodes if "start" in (n.get("tags") or [])]
    end_nodes = [n for n in nodes if "end" in (n.get("tags") or [])]
    ids = {n["id"]: _ncname(n["id"]) for n in nodes}
    model = _Model()

    for n in activities:
        model.add(
            {
                "id": ids[n["id"]],
                "tag": "task",
                "name": str(n.get("label") or n["id"]),
                "lane": str(n.get("group")) if n.get("group") else None,
                "documentation": _documentation(n, noun),
                "metrics": dict(n.get("metrics") or {}),
                "w": TASK_W,
                "h": TASK_H,
            }
        )
    start_id = _ncname("start_event")
    end_id = _ncname("end_event")
    model.add({"id": start_id, "tag": "startEvent", "name": "Case starts", "lane": None, "w": EVENT_S, "h": EVENT_S})
    model.add({"id": end_id, "tag": "endEvent", "name": "Case ends", "lane": None, "w": EVENT_S, "h": EVENT_S})

    # observed transitions between activities; start/end pseudo nodes become the two events
    activity_ids = {ids[n["id"]] for n in activities}
    start_ids = {ids[n["id"]] for n in start_nodes}
    end_ids = {ids[n["id"]] for n in end_nodes}
    transitions: list[dict[str, Any]] = []
    for e in edges:
        src_id, dst_id = ids.get(e["source"]), ids.get(e["target"])
        if src_id is None or dst_id is None:
            continue
        src_id = start_id if src_id in start_ids else src_id
        dst_id = end_id if dst_id in end_ids else dst_id
        if src_id == dst_id and src_id not in (start_id, end_id):
            continue  # self-loops are not sequence flows in BPMN; they stay in the documentation
        if src_id in (start_id, end_id) and dst_id in (start_id, end_id):
            continue
        transitions.append({"source": src_id, "target": dst_id, "metrics": dict(e.get("metrics") or {}), "raw": e})
    if not any(t["source"] == start_id for t in transitions) and activity_ids:
        first = sorted(activities, key=lambda n: -float((n.get("metrics") or {}).get("cases") or 0))[0]
        transitions.insert(0, {"source": start_id, "target": ids[first["id"]], "metrics": {}, "raw": {}})
    if not any(t["target"] == end_id for t in transitions) and activity_ids:
        last = sorted(activities, key=lambda n: -float((n.get("metrics") or {}).get("cases") or 0))[-1]
        transitions.append({"source": ids[last["id"]], "target": end_id, "metrics": {}, "raw": {}})

    out_of: dict[str, list[dict[str, Any]]] = {}
    in_of: dict[str, list[dict[str, Any]]] = {}
    for t in transitions:
        out_of.setdefault(t["source"], []).append(t)
        in_of.setdefault(t["target"], []).append(t)

    split_gw: dict[str, str] = {}
    join_gw: dict[str, str] = {}
    if gateways:
        for nid, outs in out_of.items():
            if len(outs) > 1 and nid != start_id:
                gid = _ncname(f"{nid}_split")
                split_gw[nid] = gid
                model.add(
                    {
                        "id": gid,
                        "tag": "exclusiveGateway",
                        "name": "",
                        "lane": model.by_id[nid]["lane"] if nid in model.by_id else None,
                        "w": GATEWAY_S,
                        "h": GATEWAY_S,
                    }
                )
        for nid, ins in in_of.items():
            if len(ins) > 1 and nid != end_id:
                gid = _ncname(f"{nid}_join")
                join_gw[nid] = gid
                model.add(
                    {
                        "id": gid,
                        "tag": "exclusiveGateway",
                        "name": "",
                        "lane": model.by_id[nid]["lane"] if nid in model.by_id else None,
                        "w": GATEWAY_S,
                        "h": GATEWAY_S,
                    }
                )
        for nid, gid in split_gw.items():
            model.flow(nid, gid)
        for nid, gid in join_gw.items():
            model.flow(gid, nid)
    for t in transitions:
        source = split_gw.get(t["source"], t["source"])
        target = join_gw.get(t["target"], t["target"])
        metrics = t["metrics"]
        model.flow(
            source,
            target,
            name=_flow_name(metrics),
            documentation=_edge_documentation(t["raw"], noun),
            metrics=metrics,
        )

    # layout: one column per layer, rows inside it
    layer_nodes = [{"id": ids[n["id"]], "group": n.get("group")} for n in activities]
    layer_edges = [{"source": t["source"], "target": t["target"]} for t in transitions]
    depth = _layers(layer_nodes, layer_edges, stage_order)
    columns: dict[int, list[str]] = {}
    for element in model.elements:
        if element["tag"] != "task":
            continue
        columns.setdefault(int(depth.get(element["id"], 0)), []).append(element["id"])
    for elements in columns.values():
        elements.sort()
    max_rows = max((len(v) for v in columns.values()), default=1)
    for col, elements in sorted(columns.items()):
        for row, eid in enumerate(elements):
            model.by_id[eid]["x"] = 200 + col * COL_W
            model.by_id[eid]["y"] = 100 + row * ROW_H
    for nid, gid in split_gw.items():
        base = model.by_id.get(nid)
        model.by_id[gid]["x"] = (base.get("x", 200) if base else 200) + TASK_W + 25
        model.by_id[gid]["y"] = (base.get("y", 100) if base else 100) + (TASK_H - GATEWAY_S) / 2
    for nid, gid in join_gw.items():
        base = model.by_id.get(nid)
        model.by_id[gid]["x"] = (base.get("x", 200) if base else 200) - 65
        model.by_id[gid]["y"] = (base.get("y", 100) if base else 100) + (TASK_H - GATEWAY_S) / 2
    model.by_id[start_id]["x"] = 90
    model.by_id[start_id]["y"] = 100 + (TASK_H - EVENT_S) / 2
    last_col = max(columns) if columns else 0
    model.by_id[end_id]["x"] = 200 + (last_col + 1) * COL_W
    model.by_id[end_id]["y"] = 100 + (TASK_H - EVENT_S) / 2
    for element in model.elements:
        element.setdefault("x", 200)
        element.setdefault("y", 100)

    lanes = [
        {"id": _ncname(f"lane_{g['id']}"), "ref": str(g["id"]), "name": str(g.get("label") or g["id"])} for g in groups
    ]
    # the two events join the first and the last lane that hold a task, so that no flow node sits outside a lane
    used = [lane["ref"] for lane in lanes if any(e.get("lane") == lane["ref"] for e in model.elements)]
    if used:
        model.by_id[start_id]["lane"] = used[0]
        model.by_id[end_id]["lane"] = used[-1]
    width = 200 + (last_col + 2) * COL_W
    height = 120 + max_rows * ROW_H
    return {
        "elements": model.elements,
        "flows": model.flows,
        "lanes": lanes,
        "width": width,
        "height": height,
        "gateways": len(split_gw) + len(join_gw),
    }


def _flow_name(metrics: dict[str, Any]) -> str:
    share = _num(metrics.get("share"))
    return f"{share * 100:.0f} %" if share is not None and share > 0 else ""


def _attrs(pairs: dict[str, Any]) -> str:
    return "".join(f" {k}={quoteattr(str(v))}" for k, v in pairs.items() if v not in (None, ""))


def to_xml(
    graph: dict[str, Any],
    *,
    process_id: str = "wise_process",
    process_name: str = "Process",
    gateways: bool = True,
    noun: str = "cases",
    documentation: str = "",
) -> str:
    """A BPMN 2.0 document for one flow graph, with lanes, gateways and a laid-out diagram."""
    model = build_model(graph, gateways=gateways, noun=noun)
    pid = _ncname(process_id, "p")
    collaboration_id = f"{pid}_collaboration"
    participant_id = f"{pid}_participant"
    lanes = model["lanes"]
    by_lane: dict[str, list[str]] = {}
    for element in model["elements"]:
        lane = element.get("lane")
        if lane:
            by_lane.setdefault(str(lane), []).append(element["id"])
    used_lanes = [lane for lane in lanes if by_lane.get(lane["ref"])]

    lines: list[str] = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append(
        "<bpmn:definitions "
        + " ".join(f'xmlns:{p}="{u}"' for p, u in NS.items())
        + f' id="{pid}_definitions" targetNamespace="{NS["wise"]}" exporter="WISE Workbench" exporterVersion="1">'
    )
    lines.append(f'  <bpmn:collaboration id="{collaboration_id}">')
    lines.append(f'    <bpmn:participant id="{participant_id}" name={quoteattr(process_name)} processRef="{pid}" />')
    lines.append("  </bpmn:collaboration>")
    lines.append(f'  <bpmn:process id="{pid}" name={quoteattr(process_name)} isExecutable="false">')
    if documentation:
        lines.append(f"    <bpmn:documentation>{escape(documentation)}</bpmn:documentation>")
    if used_lanes:
        lines.append(f'    <bpmn:laneSet id="{pid}_lanes">')
        for lane in used_lanes:
            lines.append(f'      <bpmn:lane id="{lane["id"]}" name={quoteattr(lane["name"])}>')
            for ref in sorted(by_lane.get(lane["ref"], [])):
                lines.append(f"        <bpmn:flowNodeRef>{escape(ref)}</bpmn:flowNodeRef>")
            lines.append("      </bpmn:lane>")
        lines.append("    </bpmn:laneSet>")
    incoming: dict[str, list[str]] = {}
    outgoing: dict[str, list[str]] = {}
    for f in model["flows"]:
        outgoing.setdefault(f["source"], []).append(f["id"])
        incoming.setdefault(f["target"], []).append(f["id"])
    for element in model["elements"]:
        tag = f"bpmn:{element['tag']}"
        attrs = {"id": element["id"], "name": element.get("name") or None}
        metrics = element.get("metrics") or {}
        for key, out in (("cases", "wise:cases"), ("events", "wise:events"), ("violationShare", "wise:violationShare")):
            value = _num(metrics.get(key))
            if value is not None:
                attrs[out] = f"{value:g}"
        lines.append(f"    <{tag}{_attrs(attrs)}>")
        if element.get("documentation"):
            lines.append(f"      <bpmn:documentation>{escape(element['documentation'])}</bpmn:documentation>")
        for fid in incoming.get(element["id"], []):
            lines.append(f"      <bpmn:incoming>{fid}</bpmn:incoming>")
        for fid in outgoing.get(element["id"], []):
            lines.append(f"      <bpmn:outgoing>{fid}</bpmn:outgoing>")
        lines.append(f"    </{tag}>")
    for f in model["flows"]:
        attrs = {"id": f["id"], "sourceRef": f["source"], "targetRef": f["target"], "name": f.get("name") or None}
        cases = _num((f.get("metrics") or {}).get("cases"))
        if cases is not None:
            attrs["wise:cases"] = f"{cases:g}"
        lines.append(f"    <bpmn:sequenceFlow{_attrs(attrs)}>")
        if f.get("documentation"):
            lines.append(f"      <bpmn:documentation>{escape(f['documentation'])}</bpmn:documentation>")
        lines.append("    </bpmn:sequenceFlow>")
    lines.append("  </bpmn:process>")

    lines.append(f'  <bpmndi:BPMNDiagram id="{pid}_diagram">')
    lines.append(f'    <bpmndi:BPMNPlane id="{pid}_plane" bpmnElement="{collaboration_id}">')
    lines.append(
        f'      <bpmndi:BPMNShape id="{participant_id}_di" bpmnElement="{participant_id}" isHorizontal="true">'
    )
    lines.append(f'        <dc:Bounds x="40" y="40" width="{model["width"]}" height="{model["height"]}" />')
    lines.append("      </bpmndi:BPMNShape>")
    lane_height = max(int(model["height"] / max(len(used_lanes), 1)), 120)
    for i, lane in enumerate(used_lanes):
        lines.append(f'      <bpmndi:BPMNShape id="{lane["id"]}_di" bpmnElement="{lane["id"]}" isHorizontal="true">')
        lines.append(
            f'        <dc:Bounds x="{70}" y="{40 + i * lane_height}" width="{model["width"] - 30}" height="{lane_height}" />'
        )
        lines.append("      </bpmndi:BPMNShape>")
    for element in model["elements"]:
        lines.append(f'      <bpmndi:BPMNShape id="{element["id"]}_di" bpmnElement="{element["id"]}">')
        lines.append(
            f'        <dc:Bounds x="{int(element["x"])}" y="{int(element["y"])}" '
            f'width="{int(element["w"])}" height="{int(element["h"])}" />'
        )
        lines.append("      </bpmndi:BPMNShape>")
    for f in model["flows"]:
        s = next((e for e in model["elements"] if e["id"] == f["source"]), None)
        t = next((e for e in model["elements"] if e["id"] == f["target"]), None)
        if s is None or t is None:
            continue
        x1, y1 = int(s["x"]) + int(s["w"]), int(s["y"]) + int(s["h"] / 2)
        x2, y2 = int(t["x"]), int(t["y"]) + int(t["h"] / 2)
        lines.append(f'      <bpmndi:BPMNEdge id="{f["id"]}_di" bpmnElement="{f["id"]}">')
        lines.append(f'        <di:waypoint x="{x1}" y="{y1}" />')
        if y1 != y2:
            mid = int((x1 + x2) / 2)
            lines.append(f'        <di:waypoint x="{mid}" y="{y1}" />')
            lines.append(f'        <di:waypoint x="{mid}" y="{y2}" />')
        lines.append(f'        <di:waypoint x="{x2}" y="{y2}" />')
        lines.append("      </bpmndi:BPMNEdge>")
    lines.append("    </bpmndi:BPMNPlane>")
    lines.append("  </bpmndi:BPMNDiagram>")
    lines.append("</bpmn:definitions>")
    return "\n".join(lines) + "\n"


def summary(xml: str) -> dict[str, int]:
    """Counts a caller (or a test) can assert on without parsing the document."""
    return {
        "tasks": xml.count("<bpmn:task"),
        "gateways": xml.count("<bpmn:exclusiveGateway"),
        "sequenceFlows": xml.count("<bpmn:sequenceFlow"),
        "lanes": xml.count("<bpmn:lane "),
        "shapes": xml.count("<bpmndi:BPMNShape"),
        "edges": xml.count("<bpmndi:BPMNEdge"),
    }
