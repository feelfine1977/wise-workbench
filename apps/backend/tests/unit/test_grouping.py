"""Closed inline grouping grammar and deterministic population-independent features."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pandas as pd
import pytest

from wise_workbench.adapters.engine.grouping import enrich_grouping_fields, grouping_options
from wise_workbench.application.ports import RunContext, grouping_slicing, grouping_token
from wise_workbench.domain import ColumnMapping, ValidationError


def context() -> RunContext:
    return RunContext(
        run_dir=Path("/unused"),
        case_table_dir=Path("/unused"),
        mapping=ColumnMapping.from_dict(
            "m", "d", {"id": "m", "datasetId": "d", "caseId": "case", "activity": "activity", "timestamp": "time"}
        ),
        document={},
        views=(),
        gamma=0,
        min_cases=1,
    )


def test_inline_token_round_trips_full_column_names_and_bands():
    attrs = ["company, region", 'amount "net" €']
    bands = [
        {
            "attribute": attrs[1],
            "method": "cuts",
            "cuts": [20, 100],
            "labels": ["small, first", 'middle "tier"', "large €"],
        }
    ]
    token = "group:" + json.dumps({"attributes": attrs, "bands": bands}, ensure_ascii=False)
    ctx = context()
    assert ctx.slicing_attributes(token) == attrs
    assert ctx.slicing_bands(token) == bands
    assert json.loads(grouping_token(attrs, bands)[6:]) == {"attributes": attrs, "bands": bands}
    # Caller changes to one decoded value do not alter later resolutions.
    ctx.slicing_bands(token)[0]["labels"].append("changed")
    assert ctx.slicing_bands(token) == bands


@pytest.mark.parametrize(
    "payload",
    [
        "",
        "null",
        "[]",
        "7",
        '"vendor"',
        "{}",
        '{"attributes":"vendor"}',
        '{"attributes":[""]}',
        '{"attributes":[42]}',
        '{"attributes":["a","a"]}',
        '{"attributes":["a","b","c","d"]}',
        '{"attributes":["a"],"expression":"__import__(x)"}',
        '{"attributes":["a"],"attributes":["b"]}',
        '{"attributes":["a"],"bands":null}',
        '{"attributes":["a"],"bands":[7]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","q":true}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","q":"4"}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","q":4.5}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","q":0}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"eval","expression":"x"}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"cuts","cuts":[NaN]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"cuts","cuts":[1e999]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"cuts","cuts":[2,2]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"cuts","cuts":[2,1]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"cuts","cuts":[true]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","method":"quantile","cuts":[2]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"a","q":4,"labels":["one"]}]}',
        '{"attributes":["a"],"bands":[{"attribute":"b"}]}',
    ],
)
def test_malformed_inline_tokens_fail_closed(payload):
    with pytest.raises(ValidationError):
        context().slicing_attributes("group:" + payload)
    with pytest.raises(ValidationError):
        context().slicing_bands("group:" + payload)


def test_token_limits_deep_json_and_huge_numbers_fail_as_validation():
    for token in [
        "group:" + " " * 8193,
        "group:" + "[" * 1200 + "]" * 1200,
        "group:"
        + json.dumps({"attributes": ["a"], "bands": [{"attribute": "a", "method": "cuts", "cuts": [10**400]}]}),
    ]:
        with pytest.raises(ValidationError):
            grouping_slicing(token)


def test_existing_saved_and_comma_groupings_are_preserved():
    ctx = replace(
        context(),
        slicings=(("saved", ("company", "value")),),
        bands={"saved": ({"attribute": "value", "method": "quantile", "q": 4},)},
    )
    assert ctx.slicing_attributes("saved") == ["company", "value"]
    assert ctx.slicing_bands("saved")[0]["q"] == 4
    assert ctx.slicing_attributes("company,vendor") == ["company", "vendor"]
    assert ctx.slicing_bands("company,vendor") == []


def test_calendar_is_utc_unknown_is_missing_and_span_is_recorded_not_active():
    frame = pd.DataFrame(
        {
            "first_ts": ["2024-03-01T00:30:00+02:00", None, "2024-01-02"],
            "last_ts": ["2024-03-03T00:30:00+02:00", None, "2024-01-01"],
            "n_events": [8, 0, 1],
        }
    )
    derived = enrich_grouping_fields(frame)
    assert derived.loc[[0, 2], "start_month"].tolist() == ["2024-02", "2024-01"]
    assert pd.isna(derived.loc[1, "start_month"])
    assert derived.loc[[0, 2], "start_year"].tolist() == ["2024", "2024"]
    assert pd.isna(derived.loc[1, "start_year"])
    assert derived.loc[0, "recorded_span_days"] == 2
    assert derived["recorded_span_days"].isna().tolist() == [False, True, True]
    assert derived["n_events"].tolist() == [8, 0, 1]
    assert "start_month" not in frame
    changed = derived.copy()
    changed.loc[0, "first_ts"] = "2024-04-01T00:00:00Z"
    assert enrich_grouping_fields(changed).loc[0, "start_month"] == "2024-04"


def test_native_fields_are_preserved_and_existing_month_is_preferred():
    frame = pd.DataFrame(
        {
            "first_ts": ["2024-01-01", None],
            "last_ts": ["2024-01-02", None],
            "start_month": ["fiscal 1", "fiscal 2"],
            "invoice_month": ["May", "June"],
            "value": [10, 30],
            "company": ["A", None],
        }
    )
    derived = enrich_grouping_fields(frame, ["start_month", "invoice_month", "value", "company"])
    assert derived["start_month"].tolist() == ["fiscal 1", "fiscal 2"]
    native = ["invoice_month", "value", "company"]
    options = grouping_options(derived, native, scope={"attribute": "company", "value": "A"}, noun="orders")
    by_name = {a["name"]: a for a in options["attributes"]}
    assert by_name["company"]["distinct"] == 1 and by_name["company"]["missing"] == 1
    assert by_name["value"]["type"] == "numeric"
    assert options["cases"] == 2 and options["caseNoun"] == "orders"
    assert any(s["attributes"] == ["invoice_month"] for s in options["suggestions"])
    assert not any(s["attributes"] == ["start_month"] for s in options["suggestions"])
    assert not any(s["attributes"] == ["vendor"] for s in options["suggestions"])
    assert "first_ts" not in by_name
    for suggestion in options["suggestions"]:
        assert grouping_slicing(suggestion["id"]).attributes == tuple(suggestion["attributes"])


def test_automatic_suggestions_exclude_high_cardinality_and_timestamps_but_keep_manual_options():
    frame = pd.DataFrame(
        {
            "case PurchasingDocument": [f"id-{i}" for i in range(300)],
            "case Spend area text": ["services"] * 150 + ["materials"] * 150,
            "native_timestamp": pd.date_range("2024-01-01", periods=300, freq="h"),
            "company_code": [100] * 150 + [200] * 150,
        }
    )
    result = grouping_options(frame, frame.columns, scope=None, noun="items")
    assert len(result["attributes"]) == 4
    assert next(a for a in result["attributes"] if a["name"] == "case PurchasingDocument")["distinct"] == 300
    suggestions = {s["attributes"][0]: s for s in result["suggestions"]}
    assert set(suggestions) == {"case Spend area text", "company_code"}
    assert suggestions["case Spend area text"]["label"] == "Spend area"
    assert suggestions["company_code"]["bands"] == []
