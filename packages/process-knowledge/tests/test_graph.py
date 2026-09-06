from __future__ import annotations

from collections import Counter

import pytest

from wise_knowledge import build_graph
from wise_knowledge.graph import EDGE_TYPES, NODE_TYPES


def test_node_and_edge_types(p2p):
    g = build_graph(p2p)
    node_types = {n.type for n in g.nodes}
    assert set(NODE_TYPES) <= node_types
    edge_types = {e.type for e in g.edges}
    assert {"in_stage", "precedes", "detected_by", "typical_cause", "typical_remedy", "owned_by"} <= edge_types
    assert edge_types <= set(EDGE_TYPES)
    ids = {n.id for n in g.nodes}
    assert len(ids) == len(g.nodes)
    for e in g.edges:
        assert e.source in ids and e.target in ids, e


def test_expected_edges(p2p):
    g = build_graph(p2p)
    in_stage = Counter(e.source for e in g.edges_of_type("in_stage"))
    assert set(in_stage) == set(p2p.activity_ids) and set(in_stage.values()) == {1}
    assert any(e.source == "p2p.gr" and e.target == "receive" for e in g.edges_of_type("in_stage"))
    stage_chain = [e for e in g.edges_of_type("precedes") if e.attrs.get("level") == "stage"]
    assert [(e.source, e.target) for e in stage_chain] == [
        ("request", "approve"),
        ("approve", "order"),
        ("order", "receive"),
        ("receive", "invoice"),
        ("invoice", "match"),
        ("match", "pay"),
    ]
    activity_chain = {(e.source, e.target) for e in g.edges_of_type("precedes") if e.attrs.get("level") == "activity"}
    assert ("p2p.gr", "p2p.ir") in activity_chain and ("p2p.ir", "p2p.invoice_clear") in activity_chain
    n_patterns = sum(len(fm.wise_patterns) for fm in p2p.failure_modes)
    assert len(g.edges_of_type("detected_by")) == n_patterns
    assert len(g.nodes_of_type("constraint_pattern")) == n_patterns
    owned = {e.source: e.target for e in g.edges_of_type("owned_by")}
    assert owned["p2p.fm.price_change_after_po"] == "role:purchasing"
    assert len(owned) == len(p2p.failure_modes)
    causes = g.neighbors("p2p.fm.price_change_after_po", "typical_cause")
    assert len(causes) == len(p2p.failure_mode("p2p.fm.price_change_after_po").typical_causes)
    assert all(n.type == "cause_candidate" for n in causes)
    remedies = g.neighbors("p2p.fm.payment_block", "typical_remedy")
    assert remedies and all(n.type == "remedy" for n in remedies)
    involves = {
        e.target for e in g.edges_of_type("involves") if e.source.startswith("pattern:p2p.fm.price_change_after_po:")
    }
    assert "p2p.po_change_price" in involves


def test_explain_path(p2p):
    g = build_graph(p2p)
    paths = g.explain("c_l6_change_price", template="p2p_bpic19")
    assert len(paths) == 1
    p = paths[0]
    assert p["failure_mode"] == "p2p.fm.price_change_after_po" and p["stage"] == "order"
    assert (
        p["causes"]
        and p["remedies"]
        and p["evidence_to_check"]
        and p["owner_role"] == ["Purchasing (buyer, purchasing group)"]
    )
    assert g.explain("no_such_constraint") == []
    assert {x["failure_mode"] for x in g.explain("o_deliv_order_to_issue_days")} == set()


def test_o2c_graph_and_tables(o2c, tmp_path):
    g = build_graph(o2c)
    assert {x["failure_mode"] for x in g.explain("o_deliv_order_to_issue_days")} == {
        "o2c.fm.late_goods_issue",
        "o2c.fm.long_tail_fulfilment",
    }
    nodes, edges = g.node_table(), g.edge_table()
    assert set(nodes[0]) == {"id", "type", "label", "pack", "stage", "attrs"}
    assert set(edges[0]) == {"source", "target", "type", "pack", "origin", "sources", "attrs"}
    n_path, e_path = g.write_csv(tmp_path)
    assert n_path.is_file() and e_path.is_file()
    measures = {(e.source, e.target) for e in g.edges_of_type("measures")}
    assert ("o2c.kpi.postponement_rate", "o2c.fm.delivery_date_postponed") in measures


def test_networkx_export(p2p):
    pytest.importorskip("networkx")
    g = build_graph(p2p)
    nx_graph = g.to_networkx()
    assert nx_graph.number_of_nodes() == len(g.nodes) and nx_graph.number_of_edges() == len(g.edges)
    assert nx_graph.nodes["p2p.gr"]["stage"] == "receive"
