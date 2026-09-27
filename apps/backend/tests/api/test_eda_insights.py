"""Linked D3 insights: independent row oracles, frozen cohorts and bounded domains."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace

import pandas as pd
import pytest

from tests.api.test_eda import frame, get
from tests.api.test_eda import world as world
from wise_workbench.adapters.storage.selections import read_selection
from wise_workbench.api.schema_models.eda import EDARequest
from wise_workbench.application.services import eda


def insights(world, **params):
    return get(world, insight=True, **params)


def categories(result, field):
    return next(f["categories"] for f in result["insights"]["facets"] if f["field"] == field)


def keys(result, field):
    return {c["value"]: c["key"] for c in categories(result, field) if c["kind"] == "value"}


def assert_conserved(result):
    insight = result["insights"]
    charts = [insight[name] for name in ("eventBins", "density", "concentration")]
    charts.extend(facet["categories"] for facet in insight["facets"])
    if insight["joint"]:
        charts.append(insight["joint"])
    for chart in charts:
        for scope in ("total", "selected"):
            assert sum(row[scope] for row in chart) == result["summary"]["cases"][scope]
        assert all(0 <= row["selected"] <= row["total"] for row in chart)
    for scope in ("total", "selected"):
        for span in result["spans"]:
            assert sum(c[scope] for c in insight["density"] if c["spanKey"] == span["key"]) == span[scope]
        for event in insight["eventBins"]:
            assert sum(c[scope] for c in insight["density"] if c["eventKey"] == event["key"]) == event[scope]
        if insight["joint"]:
            for side, facet in zip(("leftKey", "rightKey"), insight["facets"]):
                for category in facet["categories"]:
                    assert sum(c[scope] for c in insight["joint"] if c[side] == category["key"]) == category[scope]
    assert sum(c["events"] for c in insight["concentration"]) == result["summary"]["events"]["selected"]
    for field in ("knownSpanCases", "unknownSpanCases"):
        assert sum(c[field] for c in insight["concentration"]) == result["summary"][field]
    assert sum(c["unknownEventCases"] for c in insight["concentration"]) == sum(
        b["selected"] for b in insight["eventBins"] if b["missing"]
    )
    for category in insight["concentration"]:
        assert category["knownSpanCases"] + category["unknownSpanCases"] == category["selected"]
        assert 0 <= category["unknownEventCases"] <= category["selected"]


def test_opt_in_profiles_selected_statistics_and_default_comparison(world):
    assert get(world)["insights"] is None
    result = insights(world)
    assert result["insights"]["compareAttribute"] == "flag"
    assert [f["field"] for f in result["insights"]["facets"]] == ["flow_type", "flag"]
    result = insights(world, selection=json.dumps({"eventRanges": [{"min": 3, "max": 4}]}))
    assert {row["caseId"] for row in result["details"]["rows"]} == {"B", "G"}
    profiles = {p["name"]: p for p in result["insights"]["fields"]}
    assert profiles["case"]["role"] == "case_id"
    assert profiles["n_events"]["role"] == "events"
    assert profiles["first_ts"]["role"] == "timestamp"
    assert profiles["numeric"]["role"] == "attribute"
    assert profiles["numeric"]["distinct"] == 6
    assert profiles["numeric"]["missing"] == {"selected": 0, "total": 1}
    assert profiles["numeric"]["numeric"] == {"min": 1, "max": 5, "median": 3, "p90": 4.6}
    assert profiles["flow_type"]["distinct"] == 4
    assert profiles["flow_type"]["missing"] == {"selected": 0, "total": 2}
    assert profiles["flow_type"]["numeric"] is None
    assert profiles["flag"]["numeric"] is None
    primary = {c["label"]: c for c in result["insights"]["concentration"] if c["selected"]}
    assert primary["P2P"]["events"] == 3
    assert primary["P2P"]["medianSpanDays"] == primary["P2P"]["p90SpanDays"] == 1
    assert primary["Other categories"]["medianSpanDays"] == 30
    assert any("distinct counts refer to the full table" in n for n in result["notes"])
    assert_conserved(result)


def test_facets_and_all_legacy_dimensions_intersect_in_members_only_path(world):
    baseline = insights(world)
    primary, flag = keys(baseline, "flow_type"), keys(baseline, "flag")
    selection = {
        "facets": [
            {"field": "flow_type", "keys": [primary["P2P"], primary["O2C"]]},
            {"field": "flag", "keys": [flag["False"]]},
        ],
        "categoryKeys": [primary["P2P"]],
        "timeRanges": [{"from": "2024-01-01", "before": "2024-02-01"}, {"from": "2024-03-01"}],
        "spanRanges": [{"min": 0, "max": 3}, {"min": 30}],
        "eventRanges": [{"min": 3, "max": 4}, {"min": 10}],
    }
    params = {
        "selection": json.dumps(selection),
        "spanMin": 1,
        "spanMax": 3,
        "filter": json.dumps(
            {
                "and": [
                    {"kind": "attribute", "field": "numeric", "min": 1, "max": 2},
                    {"kind": "time", "from": "2024-01-15", "to": "2024-02-01"},
                ]
            }
        ),
    }
    result = insights(world, **params)
    assert [row["caseId"] for row in result["details"]["rows"]] == ["B"]
    assert result["summary"]["events"] == {"selected": 3, "total": 17}
    assert_conserved(result)
    # Hidden facet: changing the primary/comparison must not change flag's own key domain.
    selection.pop("categoryKeys")
    params["selection"] = json.dumps(selection)
    _, _, path, mapping, _ = world
    request = EDARequest(datasetId="ds", attribute="numeric", compareAttribute='quoted " column', **params)
    assert eda.aggregate_eda(path, mapping, request, members_only=True)["memberIds"] == ["B"]
    assert get(world, attribute="numeric", **params)["summary"]["cases"]["selected"] == 1


@pytest.fixture
def rich_world(world):
    records = []
    for i in range(240):
        start = pd.NaT if i % 17 == 0 else pd.Timestamp("2024-01-01") + pd.Timedelta(i % 90, "D")
        days = [0, 1, 2, 3, 7, 30, None, -1][i % 8]
        end = start + pd.Timedelta(days, "D") if pd.notna(start) and days is not None else pd.NaT
        records.append(
            {
                "case": f"c{i:03}",
                "first_ts": start,
                "last_ts": end,
                "n_events": [0, 1, 2, 3, 4, 5, 10, 20, 100, 500, None][i % 11],
                "flow_type": [None, "", "(missing)", "x" * 513][i // 60] if i % 60 == 0 else f"left{i % 25:02}",
                "context": [None, "", "(missing)", "y" * 513][i // 60]
                if i % 60 == 1
                else f"right{(i * 7 + i // 5) % 25:02}",
                "hidden": bool(i % 2),
                "measure": None if i % 13 == 0 else i,
            }
        )
    source = pd.DataFrame(records).set_index("case")
    source["n_events"] = pd.array(source.n_events, dtype="Int64")
    path = world[2]
    source.to_parquet(path)
    # Only saved-selection integrity checks may read this file; EDA needs cases alone.
    pd.DataFrame({"case": source.index, "activity": "Observe", "time": source.first_ts.values}).to_parquet(
        path.parent / "events.parquet", index=False
    )
    return world, source


def oracle_keys(series):
    def normalize(value):
        return None if pd.isna(value) or value in ("", "(missing)") else str(value)

    normalized = series.map(normalize)
    counts = Counter(value for value in normalized if pd.notna(value) and len(value) <= 512)
    top = {value: f"v{i + 1}" for i, value in enumerate(sorted(counts, key=lambda value: (-counts[value], value))[:20])}
    return normalized.map(lambda value: "missing" if pd.isna(value) else top.get(value, "other"))


def test_full_joint_density_unknown_events_and_fixed_domains(rich_world):
    world, source = rich_world
    result = insights(world, compareAttribute="context")
    insight = result["insights"]
    assert len(insight["joint"]) == 22 * 22
    assert len(insight["density"]) == 11 * 12
    assert len(insight["eventBins"]) == 12
    missing = next(b for b in insight["eventBins"] if b["missing"])
    assert missing == {
        "key": "missing",
        "label": "Unknown event count",
        "min": None,
        "max": None,
        "missing": True,
        "selected": 21,
        "total": 21,
    }
    left, right = oracle_keys(source.flow_type), oracle_keys(source.context)
    expected = Counter(zip(left, right))
    for cell in insight["joint"]:
        assert cell["total"] == expected[(cell["leftKey"], cell["rightKey"])]
    assert any(cell["total"] == 0 for cell in insight["joint"])
    assert_conserved(result)
    # Every known bin is an exact, exclusive interval, including zero and the tail.
    for event in insight["eventBins"]:
        if event["missing"]:
            continue
        bounds = {k: event[k] for k in ("min", "max") if event[k] is not None}
        subset = insights(world, compareAttribute="context", selection=json.dumps({"eventRanges": [bounds]}))
        assert subset["summary"]["cases"]["selected"] == event["total"]
        assert next(b for b in subset["insights"]["eventBins"] if b["missing"])["selected"] == 0
        assert_conserved(subset)
    assert any(row["events"] is None for row in insights(world, pageSize=100)["details"]["rows"])


def test_saved_multi_facet_membership_is_exact_beyond_pagination(rich_world):
    world, source = rich_world
    client, pid, path, mapping, _ = world
    left, right = oracle_keys(source.flow_type), oracle_keys(source.context)
    left_keys = ["v1", "v2", "v3", "other", "missing"]
    right_keys = ["v1", "v2", "v3", "v4", "v5", "other", "missing"]
    recipe = {
        "facets": [{"field": "flow_type", "keys": left_keys}, {"field": "context", "keys": right_keys}],
        "eventRanges": [{"min": 0, "max": 5}, {"min": 10}],
        "timeRanges": [{"from": "2024-01-01", "before": "2024-03-01"}],
        "timeMissing": True,
        "spanRanges": [{"min": 0, "max": 3}, {"min": 7}],
        "spanMissing": True,
    }
    expected = set()
    for case_id, row in source.iterrows():
        if left[case_id] not in left_keys or right[case_id] not in right_keys:
            continue
        if pd.isna(row.n_events) or not (0 <= row.n_events < 5 or row.n_events >= 10):
            continue
        if pd.notna(row.first_ts) and row.first_ts >= pd.Timestamp("2024-03-01"):
            continue
        span = (
            None
            if pd.isna(row.first_ts) or pd.isna(row.last_ts) or row.last_ts < row.first_ts
            else (row.last_ts - row.first_ts).days
        )
        if span is not None and not (0 <= span < 3 or span >= 7):
            continue
        expected.add(case_id)
    assert len(expected) > 1
    params = {"attribute": "hidden", "compareAttribute": "measure", "selection": json.dumps(recipe), "pageSize": 1}
    result = insights(world, **params)
    assert result["details"]["total"] == len(expected)
    assert len(result["details"]["rows"]) == 1
    members = eda.aggregate_eda(path, mapping, EDARequest(datasetId="ds", **params), members_only=True)["memberIds"]
    assert set(members) == expected
    response = client.post(
        f"/api/v1/projects/{pid}/case-tables/ct/selections",
        json={"name": "Multi-facet exact", "datasetId": "ds", "attribute": "hidden", "selection": recipe},
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    metadata, members = read_selection(path.parent, mapping, saved["id"])
    assert metadata["cases"] == saved["cases"] == len(expected)
    assert set(members) == expected
    assert saved["selection"]["facets"] == recipe["facets"]
    assert saved["selection"]["eventRanges"] == recipe["eventRanges"]
    assert_conserved(result)


def test_empty_selection_retains_domains_totals_and_null_statistics(rich_world):
    world, _source = rich_world
    full = insights(world, compareAttribute="context")
    empty = insights(world, compareAttribute="context", selection=json.dumps({"eventRanges": [{"min": 10000}]}))
    assert empty["summary"]["cases"]["selected"] == 0
    assert empty["details"]["rows"] == []
    for name in ("facets", "joint", "density", "eventBins"):

        def context(value):
            if isinstance(value, list):
                return [context(v) for v in value]
            if isinstance(value, dict):
                return {k: context(v) for k, v in value.items() if k != "selected"}
            return value

        assert context(full["insights"][name]) == context(empty["insights"][name])
    for original, selected in zip(full["insights"]["fields"], empty["insights"]["fields"]):
        assert selected["distinct"] == original["distinct"]
        assert selected["missing"] == {"selected": 0, "total": original["missing"]["total"]}
        if selected["numeric"] is not None:
            assert selected["numeric"] == {"min": None, "max": None, "median": None, "p90": None}
    assert all(
        c["medianSpanDays"] is None and c["p90SpanDays"] is None and c["events"] == 0
        for c in empty["insights"]["concentration"]
    )
    assert_conserved(empty)


@pytest.mark.parametrize(
    "params,code",
    [
        ({"selection": json.dumps({"facets": [{"field": "absent", "keys": ["v1"]}]})}, "eda.field"),
        ({"selection": json.dumps({"facets": [{"field": "flag", "keys": ["v3"]}]})}, "eda.facet_key"),
        ({"selection": json.dumps({"facets": [{"field": 'flag" OR TRUE --', "keys": ["v1"]}]})}, "eda.field"),
        ({"selection": json.dumps({"facets": [{"field": "flag", "keys": ["v1') OR TRUE --"]}]})}, "eda.facet_key"),
        ({"compareAttribute": "absent"}, "eda.field"),
    ],
)
def test_unknown_fields_and_per_field_keys_are_explicit_400(world, params, code):
    client, pid, *_ = world
    response = client.get(f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", **params})
    assert response.status_code == 400, response.text
    assert response.json()["code"] == code


@pytest.mark.parametrize(
    "selection",
    [
        {"facets": []},
        {"facets": [{"field": "flag", "keys": []}]},
        {"facets": [{"field": "flag", "keys": ["v1"]}] * 2},
        {"facets": [{"field": f"f{i}", "keys": ["v1"]} for i in range(17)]},
        {"facets": [{"field": "flag", "keys": ["v1"] * 23}]},
        {"facets": [{"field": "", "keys": ["v1"]}]},
        {"facets": [{"field": "flag", "keys": [1]}]},
        {"facets": [{"field": "flag", "keys": ["v1"], "unknown": True}]},
        {"eventMissing": "true"},
        {"eventRanges": []},
        {"eventRanges": [{}]},
        {"eventRanges": [{"min": 1, "max": 1}]},
        {"eventRanges": [{"min": 2, "max": 1}]},
        {"eventRanges": [{"min": -1}]},
        {"eventRanges": [{"min": "2"}]},
        {"eventRanges": [{"min": True}]},
        {"eventRanges": [{"min": 1.5}]},
        {"eventRanges": [{"min": float("inf")}]},
        {"eventRanges": [{"max": float("nan")}]},
        {"eventRanges": [{"min": 2**63}]},
        {"eventRanges": [{"max": 2**63}]},
        {"eventRanges": [{"min": 0}] * 12},
        {"eventRanges": [{"min": 0, "missing": True}]},
    ],
)
def test_malformed_new_dimensions_are_never_silently_ignored(world, selection):
    client, pid, *_ = world
    response = client.get(
        f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", "selection": json.dumps(selection)}
    )
    assert response.status_code == 422, response.text


def test_missing_sentinel_literals_quoted_fields_and_unshown_facets(world):
    base = insights(world, attribute='quoted " column', compareAttribute="flow_type")
    quote_key = keys(base, 'quoted " column')["x' OR TRUE --"]
    recipe = {"facets": [{"field": 'quoted " column', "keys": [quote_key]}]}
    assert get(world, attribute="flag", selection=json.dumps(recipe))["details"]["rows"][0]["caseId"] == "A"
    for value, expected in (
        ("missing", {"D", "E"}),
        ("other", set()),
        (keys(base, "flow_type")["Unknown / missing"], {"F"}),
        (keys(base, "flow_type")["Other categories"], {"G"}),
    ):
        result = insights(
            world,
            attribute="flag",
            compareAttribute="numeric",
            selection=json.dumps({"facets": [{"field": "flow_type", "keys": [value]}]}),
        )
        assert {row["caseId"] for row in result["details"]["rows"]} == expected
        assert_conserved(result)
    source = frame()
    source["custom"] = ["NA'", "", None, "Unknown / missing", "Other categories", "NA'", "good"]
    source.to_parquet(world[2])
    request = EDARequest(
        datasetId="ds",
        attribute="custom",
        insight=True,
        selection=json.dumps({"facets": [{"field": "custom", "keys": ["missing"]}]}),
    )
    result = eda.aggregate_eda(world[2], replace(world[3], missing_label="NA'"), request)
    assert {r["caseId"] for r in result["details"]["rows"]} == {"A", "B", "C", "F"}
    profile = next(p for p in result["insights"]["fields"] if p["name"] == "custom")
    assert profile["distinct"] == 3 and profile["missing"] == {"selected": 4, "total": 4}


def test_auto_comparison_prefers_useful_non_identifiers_and_handles_no_alternative(world):
    source = frame()[["n_events", "first_ts", "last_ts", "flow_type"]]
    source["customer_id"] = ["1", "2", "1", "2", "1", "2", "1"]
    source["constant"] = "x"
    source["region"] = ["west", "east", "west", "east", "west", "east", "west"]
    source.to_parquet(world[2])
    assert insights(world)["insights"]["compareAttribute"] == "region"
    assert insights(world, compareAttribute="customer_id")["insights"]["compareAttribute"] == "customer_id"
    same = insights(world, compareAttribute="flow_type")["insights"]
    assert same["compareAttribute"] == "flow_type" and len(same["facets"]) == 1 and same["joint"] == []
    source = source.drop(columns=["customer_id", "region"])
    source.to_parquet(world[2])
    assert insights(world)["insights"]["compareAttribute"] == "constant"
    source = source.drop(columns="constant")
    source.to_parquet(world[2])
    assert insights(world)["insights"]["compareAttribute"] is None
    source = source.drop(columns="flow_type")
    source.to_parquet(world[2])
    result = insights(world)
    assert result["insights"]["facets"] == result["insights"]["joint"] == result["insights"]["concentration"] == []
    assert result["insights"]["compareAttribute"] is None


def test_limit_boundaries_and_referenced_fields_beyond_picker_limit(world):
    source = frame()[["n_events", "first_ts", "last_ts"]]
    source = pd.concat([source, pd.DataFrame({f"attr{i}": ["x"] * 7 for i in range(140)}, index=source.index)], axis=1)
    source.to_parquet(world[2])
    recipe = {
        "facets": [{"field": f"attr{i}", "keys": ["v1"] * 22} for i in range(124, 140)],
        "eventRanges": [{"min": 0, "max": 2**63 - 1}] * 11,
    }
    result = insights(world, compareAttribute="attr139", selection=json.dumps(recipe))
    assert len(result["attributes"]) == 128 and "attr139" not in result["attributes"]
    assert len(result["insights"]["fields"]) == 132
    assert result["summary"]["cases"]["selected"] == 7
    assert result["insights"]["compareAttribute"] == "attr139"
    assert eda.aggregate_eda(
        world[2], world[3], EDARequest(datasetId="ds", selection=json.dumps(recipe)), members_only=True
    )["memberIds"] == list("ABCDEFG")


def test_insights_are_case_only_and_empty_table_safe(world, monkeypatch):
    assert not (world[2].parent / "events.parquet").exists()
    monkeypatch.setattr(pd, "read_parquet", lambda *_args, **_kwargs: pytest.fail("EDA must aggregate in DuckDB"))
    full = insights(world)
    assert_conserved(full)
    assert insights(world, pageSize=1, page=2)["insights"] == full["insights"]
    frame().iloc[:0].to_parquet(world[2])
    empty = insights(world)
    assert empty["summary"]["cases"] == {"total": 0, "selected": 0}
    assert all(p["distinct"] == 0 and p["missing"] == {"total": 0, "selected": 0} for p in empty["insights"]["fields"])
    assert_conserved(empty)


@pytest.mark.parametrize("with_ranges", [False, True])
def test_event_missing_union_and_saved_resolution(rich_world, with_ranges):
    world, source = rich_world
    recipe = {"eventMissing": True}
    expected = set(source.index[source.n_events.isna()])
    if with_ranges:
        recipe["eventRanges"] = [{"min": 0, "max": 2}]
        expected.update(source.index[source.n_events.notna() & (source.n_events < 2)])
    result = insights(world, compareAttribute="context", selection=json.dumps(recipe), pageSize=100)
    assert {row["caseId"] for row in result["details"]["rows"]} == expected
    assert_conserved(result)
    resolved = eda.aggregate_eda(
        world[2], world[3], EDARequest(datasetId="ds", selection=json.dumps(recipe)), members_only=True
    )
    assert set(resolved["memberIds"]) == expected
    client, pid, path, mapping, _ = world
    response = client.post(
        f"/api/v1/projects/{pid}/case-tables/ct/selections",
        json={"name": "Unknown event counts", "datasetId": "ds", "selection": recipe},
    )
    assert response.status_code == 201, response.text
    _, members = read_selection(path.parent, mapping, response.json()["id"])
    assert set(members) == expected
    assert response.json()["selection"]["eventMissing"] is True


def test_numeric_missing_sentinel_and_nonfinite_statistics(world):
    request = EDARequest(
        datasetId="ds",
        insight=True,
        attribute="numeric",
        filter=json.dumps({"and": [{"kind": "attribute", "field": "numeric", "min": 1, "max": 1}]}),
    )
    result = eda.aggregate_eda(world[2], replace(world[3], missing_label="1.0"), request)
    assert result["summary"]["cases"]["selected"] == 0
    profile = next(p for p in result["insights"]["fields"] if p["name"] == "numeric")
    assert profile["distinct"] == 5 and profile["missing"] == {"total": 2, "selected": 0}
    assert profile["numeric"] == {"min": None, "max": None, "median": None, "p90": None}
    source = frame()
    source["numeric"] = [float("inf"), -float("inf"), None, 0, 2, 4, 6]
    source.to_parquet(world[2])
    result = insights(world)
    profile = next(p for p in result["insights"]["fields"] if p["name"] == "numeric")
    assert profile["numeric"] == {"min": 0, "max": 6, "median": 3, "p90": 5.4}
    # Missing-aware numeric predicates retain the legacy conversion of booleans.
    boolean = get(world, filter=json.dumps({"and": [{"kind": "attribute", "field": "flag", "min": 0, "max": 0}]}))
    assert {r["caseId"] for r in boolean["details"]["rows"]} == {"B", "D", "F"}


@pytest.mark.parametrize(
    "selection,expected",
    [
        ({}, {"Partial": (3, 2, 1, 1, 5), "Unknown": (2, 0, 2, 2, 0), "Complete": (2, 2, 0, 0, 5)}),
        ({"eventMissing": True}, {"Partial": (1, 1, 0, 1, 0), "Unknown": (2, 0, 2, 2, 0), "Complete": (0, 0, 0, 0, 0)}),
        (
            {"eventRanges": [{"min": 10000}]},
            {"Partial": (0, 0, 0, 0, 0), "Unknown": (0, 0, 0, 0, 0), "Complete": (0, 0, 0, 0, 0)},
        ),
    ],
)
def test_concentration_selected_coverage_partial_unknown_and_empty(world, selection, expected):
    source = frame()
    source["flow_type"] = ["Partial"] * 3 + ["Unknown"] * 2 + ["Complete"] * 2
    source["n_events"] = pd.array([None, 3, 2, None, None, 2, 3], dtype="Int64")
    source.loc["B", "last_ts"] = pd.NaT
    source.to_parquet(world[2])
    result = insights(world, selection=json.dumps(selection))
    groups = {c["label"]: c for c in result["insights"]["concentration"]}
    for label, coverage in expected.items():
        group = groups[label]
        assert (
            tuple(
                group[field]
                for field in ("selected", "knownSpanCases", "unknownSpanCases", "unknownEventCases", "events")
            )
            == coverage
        )
        assert group["total"] == {"Partial": 3, "Unknown": 2, "Complete": 2}[label]
        if group["knownSpanCases"] == 0:
            assert group["medianSpanDays"] is None and group["p90SpanDays"] is None
    for category in result["insights"]["concentration"]:
        if category["total"] == 0:
            assert category["knownSpanCases"] == category["unknownSpanCases"] == category["unknownEventCases"] == 0
    if not selection:
        assert groups["Partial"]["medianSpanDays"] == 1.5
        assert groups["Partial"]["p90SpanDays"] == pytest.approx(2.7)
    assert_conserved(result)
