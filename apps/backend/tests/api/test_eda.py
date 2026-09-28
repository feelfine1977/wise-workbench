"""Count conservation, exact intersections, nulls and bounds for norm-free EDA."""

from __future__ import annotations

import io
import json
from dataclasses import replace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app
from wise_workbench.api.schema_models.eda import EDARequest
from wise_workbench.application.services import eda
from wise_workbench.domain import CaseTable, CaseTableStatus, ColumnMapping
from wise_workbench.domain.dataset import DatasetStatus, DatasetVersion


def frame():
    return pd.DataFrame(
        {
            "case": list("ABCDEFG"),
            "n_events": [1, 3, 2, 2, 4, 2, 3],
            "first_ts": pd.to_datetime(
                ["2024-01-01", "2024-01-31", "2024-02-01", None, "2024-02-03", "2024-02-01", "2024-03-01"]
            ),
            "last_ts": pd.to_datetime(
                ["2024-01-01", "2024-02-01", "2024-02-04", None, None, "2024-02-08", "2024-03-31"]
            ),
            "flow_type": ["P2P", "P2P", "O2C", None, "(missing)", "Unknown / missing", "Other categories"],
            "flag": [True, False, True, False, True, False, True],
            "numeric": [0, 1, 2, None, 3, 4, 5],
            'quoted " column': ["x' OR TRUE --", "x", "x", "x", "x", "x", "x"],
        }
    ).set_index("case")


@pytest.fixture
def world(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, analytics_auto=False))) as client:
        c = client.app.state.container
        pid = client.post("/api/v1/projects", json={"name": "EDA without a norm"}).json()["id"]
        c.repos.add_dataset(DatasetVersion(id="ds", project_id=pid, name="case fixture", status=DatasetStatus.READY))
        mapping = ColumnMapping(id="m", dataset_id="ds", case_id="case", activity="activity", timestamp="time")
        c.repos.add_mapping(mapping)
        table = CaseTable(id="ct", project_id=pid, dataset_id="ds", mapping_id="m", status=CaseTableStatus.READY)
        c.repos.add_case_table(table)
        path = c.workspace.case_table_dir(pid, "ct") / "cases.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        frame().to_parquet(path, index=True)
        yield client, pid, path, mapping, table


def get(world, **params):
    client, pid, *_ = world
    result = client.get(f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", **params})
    assert result.status_code == 200, result.text
    return result.json()


def conservation(result):
    selected, total = result["summary"]["cases"].values()
    for chart in ("categories", "trend", "spans"):
        assert sum(row["selected"] for row in result[chart]) == selected
        assert sum(row["total"] for row in result[chart]) == total
    assert result["details"]["total"] == selected
    assert result["summary"]["knownSpanCases"] + result["summary"]["unknownSpanCases"] == selected
    assert all(row["selected"] <= row["total"] for key in ("categories", "trend", "spans") for row in result[key])


def test_actual_counts_known_denominators_and_nulls(world):
    result = get(world)
    assert result["summary"]["cases"] == {"selected": 7, "total": 7}
    assert result["summary"]["events"] == {"selected": 17, "total": 17}
    assert result["summary"]["knownSpanCases"] == 5
    assert result["summary"]["unknownSpanCases"] == 2
    assert result["summary"]["medianSpanDays"] == 3
    assert result["summary"]["p90SpanDays"] == pytest.approx(20.8)
    assert len(result["details"]["rows"]) == 7
    conservation(result)
    assert all(key not in json.dumps(result) for key in ('"score":', '"oee":', '"cost":'))


@pytest.mark.parametrize(
    ("params", "ids", "events"),
    [
        ({"spanMin": 1, "spanMax": 3}, {"B"}, 3),
        ({"spanMax": 1}, {"A"}, 1),
        ({"spanMin": 3}, {"C", "F", "G"}, 7),
        ({"spanMissing": 1}, {"D", "E"}, 6),
        ({"timeMissing": 1}, {"D"}, 2),
        ({"categoryMode": "missing"}, {"D", "E"}, 6),
        ({"categoryMode": "other"}, set(), 0),
        (
            {"filter": json.dumps({"and": [{"kind": "attribute", "field": "flow_type", "eq": "Unknown / missing"}]})},
            {"F"},
            2,
        ),
        (
            {"filter": json.dumps({"and": [{"kind": "attribute", "field": "flag", "eq": True}]})},
            {"A", "C", "E", "G"},
            10,
        ),
        (
            {"filter": json.dumps({"and": [{"kind": "attribute", "field": "numeric", "min": 2, "max": 3}]})},
            {"C", "E"},
            6,
        ),
        (
            {
                "attribute": 'quoted " column',
                "filter": json.dumps(
                    {"and": [{"kind": "attribute", "field": 'quoted " column', "eq": "x' OR TRUE --"}]}
                ),
            },
            {"A"},
            1,
        ),
    ],
)
def test_filters_preserve_exact_membership_and_all_chart_counts(world, params, ids, events):
    result = get(world, **params)
    assert {row["caseId"] for row in result["details"]["rows"]} == ids
    assert result["summary"]["events"]["selected"] == events
    conservation(result)


def test_category_month_duration_intersection_roundtrips_buckets(world):
    all_cases = get(world)
    month = next(row for row in all_cases["trend"] if row["label"] == "2024-01")
    clauses = [
        {"kind": "attribute", "field": "flow_type", "eq": "P2P"},
        {"kind": "time", "field": "case_start", "from": month["from"], "to": month["to"]},
    ]
    result = get(world, filter=json.dumps({"and": clauses}), spanMin=1, spanMax=3)
    assert [row["caseId"] for row in result["details"]["rows"]] == ["B"]
    conservation(result)
    for chart in ("categories", "trend", "spans"):
        assert [{k: v for k, v in row.items() if k != "selected"} for row in result[chart]] == [
            {k: v for k, v in row.items() if k != "selected"} for row in all_cases[chart]
        ]
    for span in all_cases["spans"]:
        params = (
            {"spanMissing": 1}
            if span["missing"]
            else {k: v for k, v in {"spanMin": span["min"], "spanMax": span["max"]}.items() if v is not None}
        )
        assert get(world, **params)["summary"]["cases"]["selected"] == span["total"]


def test_pagination_disjoint_and_does_not_change_aggregation(world):
    one, two = get(world, pageSize=3), get(world, pageSize=3, page=2)
    assert len(one["details"]["rows"]) == len(two["details"]["rows"]) == 3
    assert {r["caseId"] for r in one["details"]["rows"]}.isdisjoint(r["caseId"] for r in two["details"]["rows"])
    for key in ("summary", "categories", "trend", "spans"):
        assert one[key] == two[key]
    assert get(world, page=100)["details"]["rows"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"pageSize": 101},
        {"page": 0},
        {"spanMin": -1},
        {"spanMax": "nan"},
        {"spanMin": "inf"},
        {"spanMin": 3, "spanMax": 3},
        {"spanMissing": 1, "spanMin": 1},
        {"attribute": "absent"},
        {"filter": ""},
        {"filter": "{"},
        {"filter": json.dumps({"and": [{"kind": "open", "value": True}]})},
        {"filter": json.dumps({"and": [{"kind": "time", "field": "active", "from": "2024-01-01"}]})},
        {"filter": json.dumps({"and": [{"kind": "attribute", "field": "flow_type", "in": ["P2P"], "missing": True}]})},
    ],
)
def test_bad_or_unsupported_selection_is_never_silently_unfiltered(world, params):
    client, pid, *_ = world
    response = client.get(f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", **params})
    assert response.status_code == 422, response.text


def test_project_dataset_and_readiness_guards(world):
    client, pid, _, _, table = world
    assert client.get(f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "another"}).status_code == 404
    assert client.get("/api/v1/projects/another/case-tables/ct/eda", params={"datasetId": "ds"}).status_code == 404
    client.app.state.container.repos.update_case_table(replace(table, status=CaseTableStatus.BUILDING))
    assert client.get(f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds"}).status_code == 422


def test_cache_is_read_only_and_invalidated_when_case_artifact_changes(world, monkeypatch):
    client, _, path, *_ = world
    calls = []
    original = eda.aggregate_eda

    def counted(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(eda, "aggregate_eda", counted)
    before = {str(p): p.stat().st_mtime_ns for p in path.parent.iterdir()}
    assert get(world) == get(world)
    assert len(calls) == 1
    assert {str(p): p.stat().st_mtime_ns for p in path.parent.iterdir()} == before
    assert not client.app.state.container.repos.list_runs(world[1])
    frame().iloc[:2].to_parquet(path, index=True)
    assert get(world)["summary"]["cases"]["total"] == 2
    assert len(calls) == 2


def test_long_tail_long_timeline_and_empty_population_are_bounded(world):
    _, _, path, mapping, _ = world
    df = pd.concat([frame().iloc[[0]]] * 140).reset_index(drop=True)
    df.index.name = "case"
    df["flow_type"] = [f"Category {i}" for i in range(len(df))]
    df["first_ts"] = pd.date_range("1900-01-01", periods=140, freq="YS")
    df["last_ts"] = df["first_ts"]
    df.to_parquet(path, index=True)
    result = get(world)
    conservation(result)
    assert len(result["categories"]) == 21
    assert len(result["trend"]) <= 120
    assert len(result["details"]["rows"]) == 25
    assert get(world, categoryMode="other")["summary"]["cases"]["selected"] == 120
    assert result["trendMonthsPerBucket"] > 1
    df.iloc[:0].to_parquet(path, index=True)
    result = eda.aggregate_eda(path, mapping, EDARequest(datasetId="ds"))
    assert result["summary"]["cases"]["total"] == 0
    assert result["summary"]["medianSpanDays"] is None


def test_timestamp_offsets_and_nanosecond_month_boundaries(world):
    _, _, path, *_ = world
    df = frame().iloc[:3].copy()
    df["first_ts"] = pd.to_datetime(
        ["2024-01-31T23:59:59.999999999Z", "2024-02-01T00:00:00Z", "2024-02-01T01:00:00+02:00"],
        utc=True,
        format="mixed",
    )
    df["last_ts"] = df["first_ts"]
    df.to_parquet(path, index=True)
    initial = get(world)
    january = initial["trend"][0]
    result = get(world, filter=json.dumps({"and": [{"kind": "time", "from": january["from"], "to": january["to"]}]}))
    assert {row["caseId"] for row in result["details"]["rows"]} == {"A", "C"}
    conservation(result)


def test_sparse_old_outliers_keep_monthly_resolution_and_stable_selectable_domain(world):
    _, _, path, *_ = world
    months = ["1948-01-26", *[f"2018-{month:02d}-01" for month in range(1, 13) if month != 3]]
    df = pd.concat([frame().iloc[[0]]] * len(months)).reset_index(drop=True)
    df.index.name = "case"
    df["first_ts"] = pd.to_datetime(months)
    df["last_ts"] = df["first_ts"] + pd.Timedelta(days=1)
    df["flow_type"] = ["outlier", *["DF1" if i % 2 else "DF2" for i in range(11)]]
    df.to_parquet(path, index=True)
    overview = get(world)
    assert overview["trendMonthsPerBucket"] == 1
    assert overview["trendOmittedEmptyMonths"] == (2018 - 1948) * 12 + 12 - len(months)
    assert len(overview["trend"]) == len(months)
    assert overview["trend"][0]["label"] == "1948-01"
    assert "2018-03" not in [row["label"] for row in overview["trend"]]
    assert all(row["from"][:7] == row["to"][:7] == row["label"] for row in overview["trend"])
    conservation(overview)
    filtered = get(world, filter=json.dumps({"and": [{"kind": "attribute", "field": "flow_type", "eq": "DF1"}]}))
    assert filtered["trendOmittedEmptyMonths"] == overview["trendOmittedEmptyMonths"]
    assert [{k: v for k, v in row.items() if k != "selected"} for row in filtered["trend"]] == [
        {k: v for k, v in row.items() if k != "selected"} for row in overview["trend"]
    ]
    conservation(filtered)
    # Every individual month, including the old outlier, roundtrips through the shared filter.
    for month in overview["trend"]:
        result = get(world, filter=json.dumps({"and": [{"kind": "time", "from": month["from"], "to": month["to"]}]}))
        assert result["summary"]["cases"]["selected"] == month["total"] == 1
        conservation(result)


def test_short_calendar_preserves_zero_months_between_recorded_months(world):
    _, _, path, *_ = world
    df = frame().iloc[:2].copy()
    df["first_ts"] = pd.to_datetime(["2024-01-01", "2024-03-01"])
    df["last_ts"] = df["first_ts"]
    df.to_parquet(path, index=True)
    overview = get(world)
    assert overview["trendOmittedEmptyMonths"] == 0
    assert [(row["label"], row["total"]) for row in overview["trend"]] == [
        ("2024-01", 1),
        ("2024-02", 0),
        ("2024-03", 1),
    ]
    conservation(overview)


def test_real_ingestion_requires_no_norm_and_uses_prepared_case_population(client):
    pid = client.post("/api/v1/projects", json={"name": "O2C EDA", "process": "o2c"}).json()["id"]
    csv = b"case,activity,time,flow_type\nA,Order,2024-01-01,standard\nA,Issue,2024-01-03,standard\nB,Order,,return\n"
    job = client.post(
        f"/api/v1/projects/{pid}/datasets", files={"file": ("o2c.csv", io.BytesIO(csv), "text/csv")}
    ).json()
    assert wait_job(client, job["id"])["status"] == "done"
    did = job["resultRef"].split(":", 1)[1]
    job = client.post(
        f"/api/v1/projects/{pid}/datasets/{did}/mappings",
        json={"caseId": "case", "activity": "activity", "timestamp": "time", "caseAttributes": ["flow_type"]},
    ).json()
    assert wait_job(client, job["id"])["status"] == "done"
    tid = job["resultRef"].split(":", 1)[1]
    result = client.get(f"/api/v1/projects/{pid}/case-tables/{tid}/eda", params={"datasetId": did})
    assert result.status_code == 200, result.text
    result = result.json()
    assert result["summary"]["cases"]["total"] == 2
    assert result["summary"]["events"]["total"] == 3
    conservation(result)


def test_multi_dimensions_against_independent_case_oracle(world):
    """Expected membership comes from source rows, not the production SQL/predicate builder."""
    all_cases = get(world, pageSize=100)
    source = frame()
    categories = {r["value"]: r["key"] for r in all_cases["categories"] if r["kind"] == "value"}
    category_options = [None, ["P2P", "O2C"], ["Unknown / missing", None]]
    time_options = [None, {1, 3}, {1, None}]
    span_options = [None, True]
    for category_values in category_options:
        for months in time_options:
            for span_union in span_options:
                selection = {}
                if category_values:
                    selection["categoryKeys"] = [categories[v] if v is not None else "missing" for v in category_values]
                if months:
                    selection["timeRanges"] = [
                        {"from": f"2024-{m:02d}-01T00:00:00Z", "before": f"2024-{m + 1:02d}-01T00:00:00Z"}
                        for m in sorted(m for m in months if m is not None)
                    ]
                    selection["timeMissing"] = None in months
                if span_union:
                    selection.update(spanRanges=[{"min": 0, "max": 3}, {"min": 30}], spanMissing=True)
                expected = set()
                for case_id, row in source.iterrows():
                    category = None if pd.isna(row.flow_type) or row.flow_type == "(missing)" else row.flow_type
                    month = None if pd.isna(row.first_ts) else row.first_ts.month
                    span = (
                        None
                        if pd.isna(row.first_ts) or pd.isna(row.last_ts)
                        else (row.last_ts - row.first_ts).total_seconds() / 86400
                    )
                    if category_values is not None and category not in category_values:
                        continue
                    if months is not None and month not in months:
                        continue
                    if span_union and span is not None and not (0 <= span < 3 or span >= 30):
                        continue
                    expected.add(case_id)
                result = get(world, selection=json.dumps(selection), pageSize=100)
                assert {r["caseId"] for r in result["details"]["rows"]} == expected, selection
                assert result["summary"]["events"]["selected"] == int(source.loc[list(expected), "n_events"].sum())
                conservation(result)
                for chart in ("categories", "trend", "spans"):
                    assert [{k: v for k, v in r.items() if k != "selected"} for r in result[chart]] == [
                        {k: v for k, v in r.items() if k != "selected"} for r in all_cases[chart]
                    ]
    chosen = json.dumps({"categoryKeys": [categories["P2P"], categories["O2C"]]})
    pages = [get(world, selection=chosen, pageSize=1, page=p) for p in range(1, 4)]
    assert {r["caseId"] for page in pages for r in page["details"]["rows"]} == {"A", "B", "C"}
    assert all(page["summary"] == pages[0]["summary"] for page in pages)
    # Existing singular parameters remain an additional intersection, never ignored.
    assert [r["caseId"] for r in get(world, selection=chosen, spanMin=1, spanMax=3)["details"]["rows"]] == ["B"]


def test_union_other_missing_and_literal_reserved_labels(world):
    _, _, path, *_ = world
    labels = (
        ["Unknown / missing"] * 3
        + ["Other categories"] * 3
        + [f"cat{i:02}" for i in range(25)]
        + [None, "(missing)", "x" * 513]
    )
    source = pd.concat([frame().iloc[[0]]] * len(labels)).reset_index(drop=True)
    source.index = pd.Index([f"case{i}" for i in range(len(labels))], name="case")
    source["flow_type"] = labels
    source.to_parquet(path, index=True)
    all_cases = get(world, pageSize=100)
    literal = next(r["key"] for r in all_cases["categories"] if r["value"] == "Unknown / missing")
    counts = source.flow_type.value_counts().to_dict()
    top = set(sorted((v for v in counts if v != "(missing)" and len(v) <= 512), key=lambda v: (-counts[v], v))[:20])
    expected = {
        str(i)
        for i, r in source.iterrows()
        if r.flow_type is None
        or r.flow_type == "(missing)"
        or r.flow_type not in top
        or r.flow_type == "Unknown / missing"
    }
    result = get(world, selection=json.dumps({"categoryKeys": ["other", literal, "missing"]}), pageSize=100)
    assert {r["caseId"] for r in result["details"]["rows"]} == expected
    assert not {"case3", "case4", "case5"} & expected  # literal Other is not the aggregate tail
    conservation(result)


def test_exclusive_utc_day_range_preserves_last_nanosecond_and_unknown_union(world):
    _, _, path, *_ = world
    source = frame().iloc[:5].copy()
    source["first_ts"] = pd.to_datetime(
        [
            "2024-03-30T23:59:59.999999999Z",
            "2024-03-31T00:00:00Z",
            "2024-04-01T01:59:59.999999999+02:00",
            "2024-04-01T00:00:00Z",
            None,
        ],
        format="mixed",
        utc=True,
    )
    source["last_ts"] = source.first_ts
    source.to_parquet(path, index=True)
    period = {"from": "2024-03-31T00:00:00Z", "before": "2024-04-01T00:00:00Z"}
    result = get(world, selection=json.dumps({"timeRanges": [period]}))
    assert {r["caseId"] for r in result["details"]["rows"]} == {"B", "C"}
    conservation(result)
    with_unknown = get(world, selection=json.dumps({"timeRanges": [period, period], "timeMissing": True}))
    assert {r["caseId"] for r in with_unknown["details"]["rows"]} == {"B", "C", "E"}
    assert with_unknown["summary"]["unknownStartCases"] == 1
    conservation(with_unknown)


@pytest.mark.parametrize(
    "selection",
    [
        "",
        "{",
        "null",
        "[]",
        '{"activity":"Approve"}',
        '{"categoryKeys":[]}',
        '{"categoryKeys":["not-a-returned-key"]}',
        '{"categoryKeys":[1]}',
        '{"timeRanges":[]}',
        '{"timeRanges":[{}]}',
        '{"timeMissing":"true"}',
        '{"timeRanges":[{"from":"2024-02-01","before":"2024-01-01"}]}',
        '{"timeRanges":[{"from":"2024-02-01","before":"2024-02-01"}]}',
        '{"timeRanges":[{"from":"2024-02-30"}]}',
        '{"timeRanges":[{"from":"today"}]}',
        '{"timeRanges":[{"to":"2024-02-01"}]}',
        '{"spanRanges":[{}]}',
        '{"spanRanges":[{"min":3,"max":1}]}',
        '{"spanRanges":[{"min":-1}]}',
        '{"spanRanges":[{"min":"1"}]}',
        '{"spanRanges":[{"max":NaN}]}',
        json.dumps({"timeRanges": [{"from": "2024-01-01"}] * 122}),
    ],
)
def test_invalid_multi_selection_is_rejected_not_dropped(world, selection):
    client, pid, *_ = world
    response = client.get(
        f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", "selection": selection}
    )
    assert response.status_code == 422, response.text
