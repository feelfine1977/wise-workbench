"""Column mapping: roles, reserved names, derive recipes, flow typing rules, round trips."""

from __future__ import annotations

import pytest

from wise_workbench.domain import HEADER_EVENT_COUNT, ColumnMapping, FlowTypingRule, ValidationError


def mapping(**changes: object) -> ColumnMapping:
    base: dict[str, object] = {
        "id": "m",
        "dataset_id": "d",
        "case_id": "case",
        "activity": "activity",
        "timestamp": "time",
    }
    base.update(changes)
    return ColumnMapping(**base)  # type: ignore[arg-type]


def test_required_roles() -> None:
    with pytest.raises(ValidationError) as exc:
        mapping(timestamp="")
    assert exc.value.code == "mapping.incomplete"
    assert exc.value.errors == [{"field": "timestamp", "message": "required"}]


def test_duplicate_roles_and_reserved_attributes() -> None:
    with pytest.raises(ValidationError) as exc:
        mapping(activity="case")
    assert exc.value.code == "mapping.duplicate_role"
    with pytest.raises(ValidationError) as exc:
        mapping(case_attributes=("exposure",))
    assert exc.value.code == "mapping.reserved_attribute"


def test_missing_columns_are_reported_with_a_stable_code() -> None:
    m = mapping(case_attributes=("company",), exposure="amount")
    assert m.required_columns == ["case", "activity", "time", "company", "amount"]
    assert m.missing_columns(["case", "activity", "time"]) == ["company", "amount"]
    with pytest.raises(ValidationError) as exc:
        m.check_columns(["case", "activity", "time"])
    assert exc.value.code == "mapping.column_missing"
    assert exc.value.status == 422


def test_header_events_become_a_library_count_recipe() -> None:
    m = mapping(
        header_events=("Create Purchase Order Item",),
        derived_attributes=({"name": "x", "kind": "eval", "expr": "n_events"},),
    )
    recipes = m.derive_recipes()
    assert recipes[0] == {"name": HEADER_EVENT_COUNT, "kind": "count", "activities": ["Create Purchase Order Item"]}
    assert recipes[1]["kind"] == "eval"


def test_flow_typing_adds_the_flow_type_attribute() -> None:
    rules = (FlowTypingRule("DF1", {"attr": "cat", "eq": "3-way"}),)
    m = mapping(case_attributes=("cat",), flow_typing=rules)
    assert m.all_case_attributes == ["cat", "flow_type"]
    assert mapping().all_case_attributes == []
    with pytest.raises(ValidationError):
        FlowTypingRule("", {"attr": "x"})
    with pytest.raises(ValidationError):
        FlowTypingRule("a", {})
    with pytest.raises(ValidationError):
        mapping(flow_typing=(FlowTypingRule("a", {"attr": "x", "eq": 1}), FlowTypingRule("a", {"attr": "y", "eq": 2})))


def test_round_trip_through_the_api_document() -> None:
    m = mapping(
        timestamp_format="%d-%m-%Y",
        dayfirst=True,
        lifecycle="lc",
        keep_transitions=("complete", "COMPLETE"),
        resource="res",
        order="eid",
        case_attributes=("company", "vendor"),
        exposure="amount",
        exposure_agg="sum",
        exposure_abs=False,
        header_events=("PO",),
        flow_typing=(FlowTypingRule("DF1", {"attr": "cat", "in": ["a", "b"]}),),
        closure_activities=("Clear Invoice",),
        dedupe=True,
        note="n",
    )
    doc = m.to_dict()
    back = ColumnMapping.from_dict("m", "d", doc, created_at=m.created_at)
    assert back == m
    assert doc["flowTyping"] == [{"name": "DF1", "rule": {"attr": "cat", "in": ["a", "b"]}}]
