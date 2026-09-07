"""Cycle 3 units: the board's facet and KPI arithmetic, the BPMN writer and the path marking."""

from __future__ import annotations

import xml.etree.ElementTree as ET

import numpy as np
import pandas as pd
import pytest

from wise_workbench.adapters.engine import board, bpmn
from wise_workbench.adapters.engine.gateway import _mark_paths
from wise_workbench.domain import ValidationError

BPMN_NS = {
    "b": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "di": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dd": "http://www.omg.org/spec/DD/20100524/DI",
}


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "vendor": ["A", "A", "B", "B", "B", None],
            "score__Finance": [1.0, 0.5, 0.9, 0.8, np.nan, 0.4],
            "first_ts": pd.to_datetime(["2024-01-05", "2024-01-20", "2024-02-03", "2024-03-30", "2024-03-31", None]),
            "exposure": [10.0, 20.0, 5.0, 5.0, 5.0, 1.0],
        },
        index=[f"c{i}" for i in range(6)],
    )


def test_facet_table_counts_shares_and_priority() -> None:
    frame = _frame()
    values, field = board.facet_values(
        frame, by="attribute", attribute="vendor", flow_type_attribute="flow_type", period="month", starts=None
    )
    assert field == "vendor" and list(values) == ["A", "A", "B", "B", "B", "(missing)"]
    table = board.facet_table(frame, values, view="Finance", gamma=0.0, baseline=0.72)
    rows = {r["value"]: r for r in table.to_dict("records")}
    assert set(rows) == {"A", "B", "(missing)"}, "the missing label is a value like any other"
    assert rows["A"]["cases"] == 2 and rows["B"]["cases"] == 2, "unscored cases are not counted"
    assert rows["A"]["mean_score"] == pytest.approx(0.75)
    assert rows["A"]["share_below_expectation"] == pytest.approx(0.5), "one of the two misses an expectation"
    assert rows["B"]["share_below_expectation"] == pytest.approx(1.0)
    # PI = n * (baseline - mean)+, and never negative
    assert rows["B"]["PI"] == pytest.approx(2 * (0.72 - 0.85)) or rows["B"]["PI"] == 0.0
    assert rows["(missing)"]["PI"] == pytest.approx(1 * (0.72 - 0.4))
    assert rows["A"]["share"] == pytest.approx(2 / 6)


def test_facet_table_carries_the_open_share_and_the_exposure() -> None:
    frame = _frame()
    values, _ = board.facet_values(
        frame, by="attribute", attribute="vendor", flow_type_attribute="flow_type", period="month", starts=None
    )
    censored = pd.Series([False, True, False, False, False, True], index=frame.index)
    table = board.facet_table(
        frame, values, view="Finance", gamma=0.0, baseline=0.7, censored=censored, exposure=frame["exposure"]
    )
    rows = {r["value"]: r for r in table.to_dict("records")}
    assert rows["A"]["open_cases"] == 1 and rows["A"]["open_share"] == pytest.approx(0.5)
    assert rows["B"]["open_share"] == 0.0
    assert rows["A"]["exposure"] == pytest.approx(30.0)


def test_period_facets_group_by_case_start_and_come_back_in_time_order() -> None:
    frame = _frame()
    values, field = board.facet_values(
        frame,
        by="period",
        attribute=None,
        flow_type_attribute="flow_type",
        period="month",
        starts=frame["first_ts"],
    )
    assert field == "case start"
    assert list(values) == ["2024-01", "2024-01", "2024-02", "2024-03", "2024-03", "(missing)"]
    table = board.order_facets(
        board.facet_table(frame, values, view="Finance", gamma=0.0, baseline=0.7), by="period", sort="period"
    )
    assert list(table["value"]) == ["(missing)", "2024-01", "2024-02", "2024-03"]
    quarters, _ = board.facet_values(
        frame, by="period", attribute=None, flow_type_attribute="flow_type", period="quarter", starts=frame["first_ts"]
    )
    assert set(quarters) == {"2024-Q1", "(missing)"}
    with pytest.raises(ValidationError, match="period"):
        board.period_values(frame["first_ts"], "fortnight")
    with pytest.raises(ValidationError, match="by must be"):
        board.facet_values(frame, by="nope", attribute=None, flow_type_attribute="f", period="month", starts=None)
    with pytest.raises(ValidationError, match="period facet needs"):
        board.facet_values(frame, by="period", attribute=None, flow_type_attribute="f", period="month", starts=None)


def test_kpi_tiles_read_in_plain_words() -> None:
    tiles = {
        t["id"]: t
        for t in board.kpi_tiles(
            cases=120,
            cases_total=600,
            mean_score=0.81,
            baseline=0.844,
            cases_below=118,
            scored=120,
            priority_at_stake=94.2,
            groups=7,
            open_cases=17,
            censored_known=True,
            noun="purchase order items",
            grouping_label="groups of vendor",
            window_end="2019-01-17T15:44:00",
        )
    }
    assert tiles["items"]["value"] == 120 and "20 % of all 600" in tiles["items"]["text"]
    assert tiles["share_below_expectation"]["value"] == pytest.approx(118 / 120)
    assert "98 % of the 120 scored" in tiles["share_below_expectation"]["text"]
    assert board._pct(0.9994) == "99.9 %", "a share just under 100 must never read as 100 %"
    assert board._pct(1.0) == "100 %" and board._pct(0.0) == "0 %" and board._pct(0.004) == "0.4 %"
    assert "94.2" in tiles["priority_at_stake"]["text"] and "groups of vendor" in tiles["priority_at_stake"]["text"]
    assert "2019-01-17" in tiles["open_share"]["text"]
    assert tiles["mean_score"]["value"] == pytest.approx(81.0)
    without_closure = {
        t["id"]: t
        for t in board.kpi_tiles(
            cases=10,
            cases_total=10,
            mean_score=None,
            baseline=None,
            cases_below=0,
            scored=0,
            priority_at_stake=0.0,
            groups=0,
            open_cases=None,
            censored_known=False,
            noun="cases",
            grouping_label="groups",
            window_end=None,
        )
    }
    assert without_closure["open_share"]["value"] is None
    assert "no closure activity" in without_closure["open_share"]["text"]
    assert "No scored cases" in without_closure["share_below_expectation"]["text"]


# ---------------------------------------------------------------------------- BPMN
def _graph() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "__start__", "kind": "event", "label": "start", "group": None, "metrics": {}, "tags": ["start"]},
            {"id": "__end__", "kind": "event", "label": "end", "group": None, "metrics": {}, "tags": ["end"]},
            {
                "id": "a_order",
                "kind": "activity",
                "label": "Create Purchase Order Item",
                "group": "order",
                "metrics": {"cases": 100.0, "events": 100.0, "share": 1.0, "violationShare": 0.2},
                "tags": [],
            },
            {
                "id": "a_receipt",
                "kind": "activity",
                "label": "Record Goods Receipt",
                "group": "receive",
                "metrics": {"cases": 80.0, "events": 90.0, "share": 0.8},
                "tags": [],
            },
            {
                "id": "a_invoice",
                "kind": "activity",
                "label": "Record Invoice Receipt",
                "group": "invoice",
                "metrics": {"cases": 70.0, "events": 70.0, "share": 0.7},
                "tags": [],
            },
        ],
        "edges": [
            {"id": "f1", "kind": "follows", "source": "__start__", "target": "a_order", "metrics": {"cases": 100.0}},
            {
                "id": "f2",
                "kind": "follows",
                "source": "a_order",
                "target": "a_receipt",
                "metrics": {"cases": 80.0, "share": 0.8, "medianLagHours": 60.0},
            },
            {"id": "f3", "kind": "follows", "source": "a_order", "target": "a_invoice", "metrics": {"cases": 20.0}},
            {"id": "f4", "kind": "follows", "source": "a_receipt", "target": "a_invoice", "metrics": {"cases": 70.0}},
            {"id": "f5", "kind": "follows", "source": "a_invoice", "target": "__end__", "metrics": {"cases": 70.0}},
            {"id": "f6", "kind": "follows", "source": "a_order", "target": "a_order", "metrics": {"cases": 5.0}},
            {"id": "c1", "kind": "constraint", "source": "a_order", "target": "a_invoice", "metrics": {}},
        ],
        "groups": [
            {"id": "order", "kind": "stage", "label": "Order", "parent": None},
            {"id": "receive", "kind": "stage", "label": "Receive", "parent": None},
            {"id": "invoice", "kind": "stage", "label": "Invoice", "parent": None},
        ],
        "meta": {},
    }


def test_bpmn_is_well_formed_with_lanes_gateways_and_a_diagram() -> None:
    xml = bpmn.to_xml(_graph(), process_id="run_1_flow", process_name="Observed flow", noun="items")
    root = ET.fromstring(xml)
    tasks = {t.get("name"): t for t in root.findall(".//b:task", BPMN_NS)}
    assert set(tasks) == {"Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt"}
    assert len(root.findall(".//b:startEvent", BPMN_NS)) == 1
    assert len(root.findall(".//b:endEvent", BPMN_NS)) == 1
    assert [x.get("name") for x in root.findall(".//b:lane", BPMN_NS)] == ["Order", "Receive", "Invoice"]
    # the branch after the order becomes an exclusive gateway, the join before the invoice another
    gateways = root.findall(".//b:exclusiveGateway", BPMN_NS)
    assert len(gateways) == 2
    flows = root.findall(".//b:sequenceFlow", BPMN_NS)
    node_ids = {
        e.get("id")
        for e in root.iter()
        if e.tag.split("}")[1] in ("task", "exclusiveGateway", "startEvent", "endEvent")
    }
    for f in flows:
        assert f.get("sourceRef") in node_ids and f.get("targetRef") in node_ids
        # the self-loop is not a sequence flow, and the constraint edge is not one either
        assert not any(f.get("sourceRef") == f.get("targetRef") for f in flows)
    assert len(flows) == 7, "5 observed transitions (the self-loop dropped) plus the two gateway links"
    shapes = {s.get("bpmnElement") for s in root.findall(".//di:BPMNShape", BPMN_NS)}
    assert node_ids <= shapes
    assert all(len(e.findall("dd:waypoint", BPMN_NS)) >= 2 for e in root.findall(".//di:BPMNEdge", BPMN_NS))
    assert "80 items" in xml and "median 2.5 days" in xml
    assert 'wise:cases="100"' in xml and 'wise:violationShare="0.2"' in xml
    assert bpmn.summary(xml) == {
        "tasks": 3,
        "gateways": 2,
        "sequenceFlows": 7,
        "lanes": 3,
        "shapes": len(shapes),
        "edges": len(flows),
    }


def test_bpmn_without_gateways_and_with_escaped_labels() -> None:
    graph = _graph()
    graph["nodes"][2]["label"] = 'Create "Order" & Item <1>'  # type: ignore[index]
    xml = bpmn.to_xml(graph, process_id="1 bad id", process_name="A & B", gateways=False)
    root = ET.fromstring(xml)  # parses: the label is escaped
    assert not root.findall(".//b:exclusiveGateway", BPMN_NS)
    names = [t.get("name") for t in root.findall(".//b:task", BPMN_NS)]
    assert 'Create "Order" & Item <1>' in names
    assert root.find(".//b:process", BPMN_NS).get("id").startswith("p_")


# ---------------------------------------------------------------------------- R3-O8 paths
def test_mark_paths_counts_what_the_detail_level_hides() -> None:
    graph = {
        "nodes": [
            {"id": "a_focus", "kind": "activity", "label": "Change Quantity"},
            {"id": "a_seen", "kind": "activity", "label": "Seen"},
        ],
        "edges": [
            {"id": "e1", "kind": "follows", "source": "a_seen", "target": "a_focus", "metrics": {}},
            {"id": "c1", "kind": "constraint", "source": "a_focus", "target": "a_seen", "payload": {}, "metrics": {}},
        ],
    }
    paths = {
        "incoming": [{"from": "Seen", "count": 10, "cases": 8}, {"from": "Hidden", "count": 3, "cases": 3}],
        "outgoing": [{"to": "Seen", "count": 4, "cases": 4}],
        "cases": 20,
        "events": 25,
    }
    out = _mark_paths(paths, graph, "Change Quantity", noun="items")
    assert out["totalIncoming"] == 2 and out["totalOutgoing"] == 1
    assert [p["onMap"] for p in out["incoming"]] == [True, False]
    assert out["incoming"][1]["node"] == "a_hidden"
    assert out["outgoing"][0]["onMap"] is False, "the constraint arc is not an observed path"
    assert out["hiddenIncoming"] == 1 and out["hiddenOutgoing"] == 1 and out["hidden"] == 2
    assert "2 of 3 paths through Change Quantity are hidden" in out["note"] and "7 items" in out["note"]

    everything = {
        "nodes": graph["nodes"],
        "edges": [
            {"id": "e1", "kind": "follows", "source": "a_seen", "target": "a_focus", "metrics": {}},
            {"id": "e2", "kind": "follows", "source": "a_focus", "target": "a_seen", "metrics": {}},
            {"id": "e3", "kind": "follows", "source": "a_hidden", "target": "a_focus", "metrics": {}},
        ],
    }
    everything["nodes"] = [*graph["nodes"], {"id": "a_hidden", "kind": "activity", "label": "Hidden"}]
    out = _mark_paths(paths, everything, "Change Quantity", noun="items")
    assert out["hidden"] == 0 and "All 3 paths" in out["note"]


def test_a_group_without_a_value_is_found_whether_it_is_null_or_the_label() -> None:
    """A group keyed ``(missing)`` is the group whose attribute has no value.

    The frame may hold that as a null or as the label itself, depending on how it was written; the filter has
    always accepted both, and the slice mask now does too. A mask that accepted only nulls left the map of
    such a group empty and the screen then showed the answer's status code instead of its numbers.
    """
    import pandas as pd

    from wise_workbench.adapters.engine.gateway import _slice_mask

    frame = pd.DataFrame(
        {"company": ["A", "A", "B", "B"], "area": ["Packaging", None, "(missing)", "Logistics"]},
        index=["c1", "c2", "c3", "c4"],
    )
    assert list(frame.index[_slice_mask(frame, ["company", "area"], ["A", "(missing)"])]) == ["c2"]
    assert list(frame.index[_slice_mask(frame, ["company", "area"], ["B", "(missing)"])]) == ["c3"]
    assert list(frame.index[_slice_mask(frame, ["area"], [None])]) == ["c2", "c3"]
    # a real value is unaffected
    assert list(frame.index[_slice_mask(frame, ["area"], ["Packaging"])]) == ["c1"]
