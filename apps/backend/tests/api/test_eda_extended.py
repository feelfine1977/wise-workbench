"""Exact predicates, conservation, zero-inclusive activity rates and endpoint coverage."""

from __future__ import annotations

import json
from decimal import Decimal

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from tests.api.test_eda import world as world
from wise_workbench.adapters.storage.selections import read_selection
from wise_workbench.api.schema_models.eda import EDARequest
from wise_workbench.application.services.eda import aggregate_eda


def query(world, **kwargs):
    response = world[0].post(
        f"/api/v1/projects/{world[1]}/case-tables/ct/eda/query", json={"datasetId": "ds", **kwargs}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_exact_values_search_not_top_domain_and_save(world):
    path = world[2]
    frame = pd.read_parquet(path)
    frame["vendor"] = [
        "rare %_\\ value",
        "other",
        "Unknown / missing",
        None,
        "x" * 600,
        "x' OR TRUE --",
        "rare %_\\ value",
    ]
    frame.to_parquet(path)
    pd.DataFrame({"case": frame.index, "activity": "Observe", "time": frame.first_ts.values}).to_parquet(
        path.parent / "events.parquet"
    )
    searched = query(world, valueField="vendor", valueSearch="%_", selection=json.dumps({"eventRanges": [{"min": 2}]}))[
        "values"
    ]
    assert searched["rows"] == [{"value": "rare %_\\ value", "total": 2, "selected": 1, "selectable": True}]
    recipe = {"facets": [{"field": "vendor", "keys": [], "values": ["x" * 600, "x' OR TRUE --"]}]}
    chosen = query(world, selection=json.dumps(recipe))
    assert {r["caseId"] for r in chosen["details"]["rows"]} == {"E", "F"}
    saved = world[0].post(
        f"/api/v1/projects/{world[1]}/case-tables/ct/selections",
        json={"datasetId": "ds", "name": "Exact tail", "selection": recipe},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["selection"]["facets"] == recipe["facets"]
    assert read_selection(path.parent, world[3], saved.json()["id"])[1] == ["E", "F"]


def test_numeric_int64_and_decimal_bounds_do_not_round(world):
    frame = pd.read_parquet(world[2]).reset_index()
    table = pa.Table.from_pandas(frame)
    table = table.append_column(
        "large", pa.array([9007199254740992, 9007199254740993, 9007199254740994, None, -1, 0, 1], type=pa.int64())
    )
    table = table.append_column(
        "money",
        pa.array(
            [
                Decimal("9007199254740993.01"),
                Decimal("9007199254740993.02"),
                Decimal("9007199254740993.03"),
                None,
                Decimal("-0.01"),
                Decimal("0"),
                Decimal("1"),
            ],
            type=pa.decimal128(20, 2),
        ),
    )
    pq.write_table(table, world[2])
    for field, lower, upper in [
        ("large", "9007199254740993", "9007199254740994"),
        ("money", "9007199254740993.02", "9007199254740993.03"),
    ]:
        selection = {"numericFacets": [{"field": field, "ranges": [{"min": lower, "max": upper}]}]}
        response = query(world, selection=json.dumps(selection))
        assert [r["caseId"] for r in response["details"]["rows"]] == ["B"]
        assert aggregate_eda(
            world[2], world[3], EDARequest(datasetId="ds", selection=json.dumps(selection)), members_only=True
        )["memberIds"] == ["B"]
    result = query(
        world,
        selection=json.dumps(
            {"numericFacets": [{"field": "money", "ranges": [{"min": "-0.01", "max": "0"}], "missing": True}]}
        ),
    )
    assert {r["caseId"] for r in result["details"]["rows"]} == {"D", "E"}


def test_numeric_nonfinite_are_missing_and_strings_not_numeric(world):
    frame = pd.read_parquet(world[2])
    frame["numeric"] = [float("inf"), float("-inf"), float("nan"), 0, 1, 2, 3]
    frame.to_parquet(world[2])
    result = query(world, selection=json.dumps({"numericFacets": [{"field": "numeric", "missing": True}]}))
    assert {r["caseId"] for r in result["details"]["rows"]} == {"A", "B", "C"}
    result = query(
        world, selection=json.dumps({"numericFacets": [{"field": "numeric", "ranges": [{"min": "0", "max": "2"}]}]})
    )
    assert {r["caseId"] for r in result["details"]["rows"]} == {"D", "E"}


def test_joint_union_does_not_create_cross_pairs_and_hierarchy_conserves(world):
    recipe = {
        "jointAny": [
            {"facets": [{"field": "flow_type", "values": ["P2P"]}, {"field": "flag", "values": ["False"]}]},
            {"facets": [{"field": "flow_type", "values": ["O2C"]}, {"field": "flag", "values": ["True"]}]},
        ]
    }
    result = query(world, hierarchyFields=["flow_type", "flag", 'quoted " column'], selection=json.dumps(recipe))
    assert {r["caseId"] for r in result["details"]["rows"]} == {"B", "C"}
    hierarchy = result["hierarchy"]
    assert sum(r["total"] for r in hierarchy["cells"]) == 7
    assert sum(r["selected"] for r in hierarchy["cells"]) == 2
    branch = {
        "facets": [
            {"field": field, "keys": [key]}
            for field, key in zip(hierarchy["fields"], next(r for r in hierarchy["cells"] if r["selected"])["keys"])
        ]
    }
    selected = query(world, selection=json.dumps({"jointAny": [branch]}))
    assert selected["summary"]["cases"]["selected"] == 1
    recipe["numericFacets"] = [{"field": "numeric", "ranges": [{"min": "2"}]}]
    assert [r["caseId"] for r in query(world, selection=json.dumps(recipe))["details"]["rows"]] == ["C"]


@pytest.mark.parametrize(
    "selection",
    [
        {"numericFacets": [{"field": "flow_type", "ranges": [{"min": "0"}]}]},
        {"numericFacets": [{"field": "numeric", "ranges": [{"min": 1}]}]},
        {"numericFacets": [{"field": "numeric", "ranges": [{"min": "2", "max": "2"}]}]},
        {"numericFacets": [{"field": "numeric", "ranges": []}]},
        {"jointAny": []},
        {"jointAny": [{"facets": [{"field": "unknown", "keys": ["v1"]}]}]},
        {"jointAny": [{"facets": [{"field": "flag", "keys": ["v1"]}, {"field": "flag", "keys": ["v2"]}]}]},
        {"facets": [{"field": "flag", "values": ["x" * 4097]}]},
    ],
)
def test_invalid_extended_predicates_rejected(world, selection):
    response = world[0].post(
        f"/api/v1/projects/{world[1]}/case-tables/ct/eda/query",
        json={"datasetId": "ds", "selection": json.dumps(selection)},
    )
    assert response.status_code in (400, 422), response.text


@pytest.fixture
def evidence_world(world):
    case_ids = [f"c{i}" for i in range(9)]
    records = [
        ("c0", "Start", "2024-01-01"),
        ("c0", "End", "2024-01-03"),
        ("c1", "Start", "2024-01-01"),
        ("c1", "End", "2024-01-01"),
        ("c2", "Start", "2024-01-01"),
        ("c3", "End", "2024-01-01"),
        ("c4", None, None),
        ("c5", "Start", None),
        ("c5", "End", "2024-01-01"),
        ("c6", "Start", "2024-01-02"),
        ("c6", "End", "2024-01-01"),
        ("c7", "Start", "2024-01-01"),
        ("c7", "Start", "2024-01-02"),
        ("c7", "End", "2024-01-03"),
    ]
    events = pd.DataFrame(records, columns=["case", "activity", "time"])
    events["time"] = pd.to_datetime(events.time, utc=True)
    cases = pd.DataFrame(
        {
            "case": case_ids,
            "n_events": [2, 2, 1, 1, 1, 2, 2, 3, 0],
            "first_ts": pd.Timestamp("2024-01-01"),
            "last_ts": pd.Timestamp("2024-01-03"),
            "context": case_ids,
        }
    ).set_index("case")
    cases.to_parquet(world[2])
    events.to_parquet(world[2].parent / "events.parquet", index=False)
    return world


def test_zero_inclusive_activity_denominators_and_complete_endpoint_partition(evidence_world):
    result = query(evidence_world, eventInsight=True, endpointStart="Start", endpointEnd="End")["eventEvidence"]
    assert result["eligibleCases"] == 9
    assert result["recordedEvents"] == 14
    assert result["casesWithoutEvents"] == 1
    assert result["undatedEvents"] == 2
    start = next(r for r in result["activities"] if r["activity"] == "Start")
    assert start == {
        "activity": "Start",
        "occurrences": 7,
        "cases": 6,
        "repeatedCases": 1,
        "zeroCases": 3,
        "presenceRate": 6 / 9,
        "repetitionRate": 1 / 9,
    }
    coverage = result["endpoints"]
    assert {
        key: coverage[key]
        for key in (
            "pairedCases",
            "startOnlyCases",
            "endOnlyCases",
            "neitherCases",
            "undatedEndpointCases",
            "reversedCases",
            "ambiguousCases",
        )
    } == {
        "pairedCases": 2,
        "startOnlyCases": 1,
        "endOnlyCases": 1,
        "neitherCases": 2,
        "undatedEndpointCases": 1,
        "reversedCases": 1,
        "ambiguousCases": 1,
    }
    assert coverage["medianDays"] == 1
    assert coverage["p90Days"] == pytest.approx(1.8)
    selected = query(
        evidence_world, eventInsight=True, selection=json.dumps({"facets": [{"field": "context", "values": ["c8"]}]})
    )["eventEvidence"]
    assert selected["eligibleCases"] == selected["casesWithoutEvents"] == 1
    assert all(
        row["cases"] == row["occurrences"] == row["presenceRate"] == 0 and row["zeroCases"] == 1
        for row in selected["activities"]
    )


def test_trace_scoped_ties_unknown_chronology_and_endpoint_detail(evidence_world):
    trace = query(evidence_world, eventInsight=True, traceCaseId="c1", endpointStart="Start", endpointEnd="End")[
        "eventEvidence"
    ]["trace"]
    assert trace["total"] == 2
    assert all(e["timestampTied"] for e in trace["events"])
    assert trace["endpointStatus"] == "paired" and trace["endpointDays"] == 0
    trace = query(evidence_world, eventInsight=True, traceCaseId="c5")["eventEvidence"]["trace"]
    assert trace["events"][-1]["timestamp"] is None
    assert trace["undatedEvents"] == 1
    response = evidence_world[0].post(
        f"/api/v1/projects/{evidence_world[1]}/case-tables/ct/eda/query",
        json={
            "datasetId": "ds",
            "eventInsight": True,
            "traceCaseId": "c1",
            "selection": json.dumps({"facets": [{"field": "context", "values": ["c0"]}]}),
        },
    )
    assert response.status_code == 404


def test_trace_pagination_is_not_a_case_selection(evidence_world):
    path = evidence_world[2].parent / "events.parquet"
    events = pd.read_parquet(path)
    extra = pd.DataFrame(
        {
            "case": ["c0"] * 105,
            "activity": ["Observe"] * 105,
            "time": pd.date_range("2024-01-04", periods=105, freq="h", tz="UTC"),
        }
    )
    pd.concat([events, extra]).to_parquet(path, index=False)
    first = query(evidence_world, eventInsight=True, traceCaseId="c0")["eventEvidence"]
    second = query(evidence_world, eventInsight=True, traceCaseId="c0", tracePage=2)["eventEvidence"]
    assert first["eligibleCases"] == second["eligibleCases"] == 9
    assert first["trace"]["total"] == second["trace"]["total"] == 107
    assert len(first["trace"]["events"]) == 100 and len(second["trace"]["events"]) == 7
    assert second["trace"]["events"][0]["position"] == 101


def test_endpoint_names_must_be_recorded_and_zero_selection_has_no_rates(evidence_world):
    client, pid, *_ = evidence_world
    invalid = client.post(
        f"/api/v1/projects/{pid}/case-tables/ct/eda/query",
        json={"datasetId": "ds", "eventInsight": True, "endpointStart": "typo", "endpointEnd": "End"},
    )
    assert invalid.status_code == 422
    empty = query(
        evidence_world,
        eventInsight=True,
        endpointStart="Start",
        endpointEnd="End",
        selection=json.dumps({"facets": [{"field": "context", "values": ["absent"]}]}),
    )["eventEvidence"]
    assert empty["eligibleCases"] == empty["endpoints"]["pairedCases"] == 0
    assert empty["endpoints"]["medianDays"] is None
    assert all(row["presenceRate"] is None and row["repetitionRate"] is None for row in empty["activities"])
