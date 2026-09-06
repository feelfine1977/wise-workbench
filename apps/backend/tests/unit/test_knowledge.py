"""The knowledge bridge: stage groups survive a pack that fails validation, and vanish cleanly without a pack."""

from __future__ import annotations

import sys
import types
from typing import Any, cast

import pytest

from wise_workbench.adapters import knowledge
from wise_workbench.adapters.engine.flow import build_flow_graph
from wise_workbench.adapters.knowledge import StageMatch, StageModel, stage_model


class _Stage:
    def __init__(self, id: str, order: int) -> None:
        self.id = id
        self.order = order
        self.name = {"en": id.capitalize()}


class _Pack:
    stages = (_Stage("receive", 3), _Stage("order", 2), _Stage("request", 1))


class _Candidate:
    def __init__(self, activity_id: str, stage: str, confidence: float) -> None:
        self.activity_id = activity_id
        self.stage = stage
        self.confidence = confidence
        self.tier = "curated"


class _Matcher:
    def __init__(self, pack: Any) -> None:
        self.pack = pack

    def match(self, label: str) -> list[_Candidate]:
        return {
            "Record Goods Receipt": [_Candidate("p2p.gr", "receive", 1.0)],
            "Create Purchase Order Item": [_Candidate("p2p.po_item_create", "order", 0.95)],
            "Something odd": [_Candidate("p2p.unknown", "request", 0.2)],
        }.get(label, [])


def _install(monkeypatch: pytest.MonkeyPatch, load_pack: Any) -> None:
    module = types.ModuleType("wise_knowledge")
    module.load_pack = load_pack  # type: ignore[attr-defined]
    module.Matcher = _Matcher  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "wise_knowledge", module)
    knowledge.reset_cache()


@pytest.fixture(autouse=True)
def _clear_cache() -> Any:
    knowledge.reset_cache()
    yield
    knowledge.reset_cache()


def test_stage_model_uses_a_validated_pack(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[bool] = []

    def load_pack(name: str, validate: bool = True) -> _Pack:
        calls.append(validate)
        return _Pack()

    _install(monkeypatch, load_pack)
    model = stage_model("p2p", ["Record Goods Receipt", "Create Purchase Order Item", "Something odd", "Nothing"])
    assert model is not None and model.validated is True and calls == [True]
    assert [s["id"] for s in model.stages] == ["request", "order", "receive"]
    assert model.stage_of("Record Goods Receipt") == "receive"
    assert model.stage_of("Create Purchase Order Item") == "order"
    assert model.stage_of("Something odd") is None  # below MIN_CONFIDENCE
    assert model.stage_of("Nothing") is None


def test_stage_model_falls_back_to_an_unvalidated_load(monkeypatch: pytest.MonkeyPatch, caplog: Any) -> None:
    calls: list[bool] = []

    def load_pack(name: str, validate: bool = True) -> _Pack:
        calls.append(validate)
        if validate:
            raise ValueError("guidance.yaml: template 'x' refers to an unknown layer")
        return _Pack()

    _install(monkeypatch, load_pack)
    with caplog.at_level("WARNING", logger="wise_workbench.adapters.knowledge"):
        model = stage_model("p2p", ["Record Goods Receipt"])
    assert model is not None and model.validated is False
    assert calls == [True, False]
    assert model.stage_of("Record Goods Receipt") == "receive"
    assert any("fails validation" in r.getMessage() for r in caplog.records)
    # the pack is cached: a second call does not load again
    stage_model("p2p", ["Record Goods Receipt"])
    assert calls == [True, False]


def test_stage_model_is_none_without_a_usable_pack(monkeypatch: pytest.MonkeyPatch) -> None:
    def load_pack(name: str, validate: bool = True) -> _Pack:
        raise RuntimeError("no such pack")

    _install(monkeypatch, load_pack)
    assert stage_model("p2p", ["Record Goods Receipt"]) is None
    assert stage_model(None, ["Record Goods Receipt"]) is None


def test_stage_model_is_none_without_the_package(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "wise_knowledge", None)  # makes `import wise_knowledge` raise ImportError
    knowledge.reset_cache()
    assert stage_model("p2p", ["Record Goods Receipt"]) is None
    assert knowledge.knowledge_available() is False


def test_flow_graph_places_matched_activities_in_stage_groups() -> None:
    model = StageModel(
        process="p2p",
        stages=(
            {"id": "order", "label": "Order", "order": 2},
            {"id": "receive", "label": "Receive", "order": 3},
            {"id": "pay", "label": "Pay", "order": 6},
        ),
        matches={
            "Record Goods Receipt": StageMatch("Record Goods Receipt", "p2p.gr", "receive", 1.0, "curated"),
            "Create Purchase Order Item": StageMatch(
                "Create Purchase Order Item", "p2p.po_item_create", "order", 1.0, "curated"
            ),
        },
    )
    dfg = {
        "cases": 10,
        "events": 25,
        "nodes": [
            {"label": "Create Purchase Order Item", "cases": 10, "events": 10},
            {"label": "Record Goods Receipt", "cases": 9, "events": 12},
            {"label": "Unmapped step", "cases": 3, "events": 3},
        ],
        "edges": [
            {"source": "Create Purchase Order Item", "target": "Record Goods Receipt", "count": 9, "cases": 9},
            {"source": "Record Goods Receipt", "target": "Unmapped step", "count": 3, "cases": 3, "median_hours": 4.0},
        ],
        "starts": {"Create Purchase Order Item": 10},
        "ends": {"Record Goods Receipt": 7, "Unmapped step": 3},
    }
    norm = cast(Any, types.SimpleNamespace(constraints=[]))
    graph = build_flow_graph(dfg, norm, {}, abstraction=0.0, meta={"runId": "r"}, stages=model)
    by_label = {n["label"]: n for n in graph["nodes"]}
    assert by_label["Create Purchase Order Item"]["group"] == "order"
    assert by_label["Record Goods Receipt"]["group"] == "receive"
    assert by_label["Unmapped step"]["group"] is None
    # only stages with a member become groups, in the pack's order
    assert [g["id"] for g in graph["groups"]] == ["order", "receive"]
    assert all(g["kind"] == "stage" for g in graph["groups"])
    assert graph["meta"]["stagedActivities"] == 2
    assert [s["id"] for s in graph["meta"]["stages"]] == ["order", "receive", "pay"]
    # the metric names the flow library reads
    assert {"cases", "events", "share", "violationShare"} <= set(by_label["Record Goods Receipt"]["metrics"])
    lag = next(
        e for e in graph["edges"] if e["target"] == by_label["Unmapped step"]["id"] and e["source"] != "__start__"
    )
    assert lag["metrics"]["medianLagHours"] == 4.0
    # without a stage model the same graph has no groups and no stages
    plain = build_flow_graph(dfg, norm, {}, abstraction=0.0, meta={"runId": "r"})
    assert plain["groups"] == [] and plain["meta"]["stages"] == [] and plain["meta"]["stagedActivities"] == 0
