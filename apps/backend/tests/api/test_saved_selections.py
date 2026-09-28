"""Frozen EDA membership, source integrity and one sublog across run analysis."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, upload_running_example, wait_job
from wise_workbench.adapters.storage.selections import read_selection, selection_path
from wise_workbench.api.app import create_app
from wise_workbench.application.services.project_binding import bind_dataset
from wise_workbench.domain import CaseTable, CaseTableStatus, ColumnMapping, RunParams
from wise_workbench.domain.dataset import DatasetStatus, DatasetVersion


@pytest.fixture
def cohort_world(tmp_path):
    settings = make_settings(tmp_path, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        c = client.app.state.container
        pid = client.post("/api/v1/projects", json={"name": "Saved EDA"}).json()["id"]
        c.repos.add_dataset(
            DatasetVersion(id="ds", project_id=pid, name="fixture", status=DatasetStatus.READY, content_hash="original")
        )
        mapping = ColumnMapping(
            id="m",
            dataset_id="ds",
            case_id="case",
            activity="activity",
            timestamp="time",
            case_attributes=("category",),
        )
        c.repos.add_mapping(mapping)
        c.repos.add_case_table(
            CaseTable(
                id="ct",
                project_id=pid,
                dataset_id="ds",
                mapping_id="m",
                status=CaseTableStatus.READY,
                attributes=("category",),
            )
        )
        directory = c.workspace.case_table_dir(pid, "ct")
        directory.mkdir(parents=True, exist_ok=True)
        values = (
            [f"top{i:02}" for i in range(20) for _ in range(12)]
            + [f"rare{i}" for i in range(20)]
            + [None, "", "(missing)", "Unknown / missing", "Other categories", "x" * 600] * 6
        )
        records = []
        for i, category in enumerate(values):
            start = [
                pd.Timestamp("2024-01-15T00:00:00Z"),
                pd.Timestamp("2024-02-15T00:00:00Z"),
                pd.Timestamp("2024-03-15T00:00:00Z"),
                pd.NaT,
            ][i % 4]
            days = [0, 1, 3, 7, None, -1][i % 6]
            end = start + pd.Timedelta(days, "D") if days is not None and pd.notna(start) else pd.NaT
            records.append({"case": f"c{i:04}", "n_events": 1, "first_ts": start, "last_ts": end, "category": category})
        frame = pd.DataFrame(records).set_index("case")
        frame.to_parquet(directory / "cases.parquet")
        pd.DataFrame({"case": frame.index, "activity": "Observe", "time": frame["first_ts"].values}).to_parquet(
            directory / "events.parquet", index=False
        )
        yield client, pid, directory, mapping, frame, settings


def endpoint(world):
    return f"/api/v1/projects/{world[1]}/case-tables/ct/selections"


def save(world, **kwargs):
    response = world[0].post(
        endpoint(world), json={"name": "Chosen cases", "datasetId": "ds", "attribute": "category", **kwargs}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_exact_union_membership_independent_oracle_and_reload(cohort_world):
    client, pid, directory, mapping, frame, settings = cohort_world
    eda = client.get(
        f"/api/v1/projects/{pid}/case-tables/ct/eda", params={"datasetId": "ds", "attribute": "category"}
    ).json()
    ordinary_key = next(row["key"] for row in eda["categories"] if row["value"] == "top00")
    recipe = {
        "categoryKeys": [ordinary_key, "other", "missing"],
        "timeRanges": [
            {"from": "2024-01-01T00:00:00Z", "before": "2024-02-01T00:00:00Z"},
            {"from": "2024-03-01T00:00:00Z", "before": "2024-04-01T00:00:00Z"},
        ],
        "timeMissing": True,
        "spanRanges": [{"min": 0, "max": 1}, {"min": 7, "max": 14}],
        "spanMissing": True,
    }
    counts = Counter(
        value for value in frame.category if not pd.isna(value) and value not in ("", "(missing)") and len(value) <= 512
    )
    top = set(sorted(counts, key=lambda value: (-counts[value], value))[:20])
    expected = set()
    for case_id, row in frame.iterrows():
        category = row.category
        category_hit = pd.isna(category) or category in ("", "(missing)", "top00") or category not in top
        time_hit = pd.isna(row.first_ts) or row.first_ts.month in (1, 3)
        span = (
            None
            if pd.isna(row.first_ts) or pd.isna(row.last_ts) or row.last_ts < row.first_ts
            else (row.last_ts - row.first_ts).total_seconds() / 86400
        )
        span_hit = span is None or 0 <= span < 1 or 7 <= span < 14
        if category_hit and time_hit and span_hit:
            expected.add(case_id)
    saved = save(cohort_world, selection=recipe)
    metadata, members = read_selection(directory, mapping, saved["id"])
    assert set(members) == expected
    assert saved["cases"] == len(expected)
    assert saved["selection"] == recipe
    assert "memberIds" not in saved
    assert saved["source"]["mappingId"] == mapping.id
    assert len(saved["membershipChecksum"]) == 64
    assert client.get(endpoint(cohort_world)).json() == [saved]
    # A second application reads the persisted record without the first app's caches.
    with TestClient(create_app(settings)) as second:
        response = second.get(f"{endpoint(cohort_world)}/{saved['id']}")
        assert response.status_code == 200, response.text
        assert response.json() == saved
    assert metadata["cases"] == len(members)


def test_save_all_is_not_paginated_and_duplicate_names_are_immutable(cohort_world):
    first = save(cohort_world)
    second = save(cohort_world)
    assert first["id"] != second["id"]
    assert first["membershipChecksum"] == second["membershipChecksum"]
    assert first["cases"] == len(cohort_world[4]) > 100
    assert len(cohort_world[0].get(endpoint(cohort_world)).json()) == 2
    assert cohort_world[0].patch(f"{endpoint(cohort_world)}/{first['id']}", json={"name": "new"}).status_code == 405


@pytest.mark.parametrize(
    "body",
    [
        {"name": " "},
        {"datasetId": "foreign"},
        {"selection": {"categoryKeys": []}},
        {"selection": {"categoryKeys": ["absent"]}},
        {"selection": {"timeRanges": [{"from": "2024-03-01", "before": "2024-01-01"}]}},
        {"selection": {"timeRanges": [{"from": "2030-01-01"}]}},
        {"selection": {"spanRanges": [{"min": 2, "max": 1}]}},
        {"selection": {"unsupported": True}},
        {"selection": "{}"},
        {"filter": "{}"},
    ],
)
def test_invalid_or_empty_save_never_publishes(cohort_world, body):
    response = cohort_world[0].post(endpoint(cohort_world), json={"name": "Invalid", "datasetId": "ds", **body})
    assert response.status_code in (409, 422), response.text
    assert cohort_world[0].get(endpoint(cohort_world)).json() == []


@pytest.mark.parametrize(
    "change", ["cases", "events", "mapping", "dataset", "members", "metadata", "missing", "malformed"]
)
def test_stale_or_corrupt_saved_selections_fail_closed(cohort_world, change, monkeypatch):
    client, _pid, directory, mapping, frame, _settings = cohort_world
    saved = save(cohort_world)
    path = selection_path(directory, saved["id"])
    c = client.app.state.container
    if change == "cases":
        frame.iloc[:-1].to_parquet(directory / "cases.parquet")
    elif change == "events":
        events = pd.read_parquet(directory / "events.parquet")
        events.iloc[:-1].to_parquet(directory / "events.parquet")
    elif change == "mapping":
        monkeypatch.setattr(c.repos, "get_mapping", lambda _id: replace(mapping, missing_label="different"))
    elif change == "dataset":
        c.repos.update_dataset(replace(c.repos.get_dataset("ds"), content_hash="changed"))
    elif change in ("members", "metadata"):
        record = json.loads(path.read_text())
        if change == "members":
            record["memberIds"][0] = "invented"
        else:
            record["metadata"]["cases"] += 1
        path.write_text(json.dumps(record))
    elif change == "malformed":
        path.write_text("[]")
    else:
        (directory / "events.parquet").unlink()
    assert client.get(f"{endpoint(cohort_world)}/{saved['id']}").status_code == 409
    assert client.get(endpoint(cohort_world)).status_code == 409


def test_foreign_table_and_project_and_missing_selection(cohort_world):
    client, pid, directory, _mapping, _frame, _settings = cohort_world
    saved = save(cohort_world)
    c = client.app.state.container
    c.repos.add_case_table(
        CaseTable(id="ct2", project_id=pid, dataset_id="ds", mapping_id="m", status=CaseTableStatus.READY)
    )
    assert client.get(f"/api/v1/projects/{pid}/case-tables/ct2/selections/{saved['id']}").status_code == 404
    other = client.post("/api/v1/projects", json={"name": "Another"}).json()["id"]
    assert client.get(f"/api/v1/projects/{other}/case-tables/ct/selections/{saved['id']}").status_code == 404
    dest = c.workspace.case_table_dir(pid, "ct2") / "selections"
    dest.mkdir(parents=True)
    (dest / f"{saved['id']}.json").write_bytes(selection_path(directory, saved["id"]).read_bytes())
    assert client.get(f"/api/v1/projects/{pid}/case-tables/ct2/selections/{saved['id']}").status_code == 409
    assert client.get(endpoint(cohort_world) + "/bad-id").status_code == 422


def test_selection_scope_serialization_and_old_hash_compatibility():
    old = RunParams(case_table_id="ct", norm_version_id="n", scope={"flow_type": "A"})
    assert old.scope == {"flow_type": "A", "attribute": "flow_type"}
    new = replace(old, scope={"selection_id": "sel_00000000000000000", "flow_type": "A"})
    assert RunParams.from_dict(new.to_dict()) == new
    assert new.params_hash() != old.params_hash()
    assert (
        replace(new, scope={"selection_id": "sel_00000000000000001", "flow_type": "A"}).params_hash()
        != new.params_hash()
    )


@pytest.fixture
def run_world(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, inprocess_worker=True, analytics_auto=False))) as client:
        ids = upload_running_example(client)
        bind_dataset(client.app.state.container, ids["project"], ids["dataset"])
        yield client, ids


def test_saved_cohort_flow_cards_and_all_run_analysis_share_membership(run_world):
    client, ids = run_world
    pid, table_id = ids["project"], ids["caseTable"]
    base = f"/api/v1/projects/{pid}/case-tables/{table_id}"
    overview = client.get(base + "/eda", params={"datasetId": ids["dataset"], "attribute": "vendor"}).json()
    keys = [row["key"] for row in overview["categories"][:1]]
    recipe = {"categoryKeys": keys}
    selected = client.get(
        base + "/eda",
        params={"datasetId": ids["dataset"], "attribute": "vendor", "selection": json.dumps(recipe), "pageSize": 100},
    ).json()
    expected = {row["caseId"] for row in selected["details"]["rows"]}
    saved = client.post(
        base + "/selections",
        json={"name": "Selected vendors", "datasetId": ids["dataset"], "attribute": "vendor", "selection": recipe},
    )
    assert saved.status_code == 201, saved.text
    sid = saved.json()["id"]
    cards = client.get(base + "/flow-types", params={"selectionId": sid, "abstraction": 0})
    assert cards.status_code == 200, cards.text
    cards = cards.json()
    assert cards["selectionId"] == sid
    assert cards["cases"] == len(expected) == sum(row["cases"] for row in cards["types"])
    assert all(row["scope"]["selection_id"] == sid for row in cards["types"])
    body = {
        "caseTableId": table_id,
        "normVersionId": ids["norm"],
        "scope": {"selection_id": sid},
        "minCases": 1,
        "slicings": [{"attributes": ["vendor"]}],
    }
    created = client.post(f"/api/v1/projects/{pid}/runs", json=body)
    assert created.status_code == 202, created.text
    run = created.json()
    assert wait_job(client, run["jobId"])["status"] == "done"
    url = f"/api/v1/projects/{pid}/runs/{run['id']}"
    got = client.get(url).json()
    assert got["scope"] == {"selection_id": sid}
    assert got["manifest"]["scope"] == got["scope"]
    assert got["manifest"]["cases"] == len(expected)
    for suffix, params, count_path in [
        ("/summary", {}, ("cases",)),
        ("/flow", {"abstraction": 0}, ("meta", "cases")),
        ("/kpis", {}, ("cases",)),
        ("/backlog", {"slicing": "vendor", "minCases": 1}, ("params", "cases")),
    ]:
        response = client.get(url + suffix, params=params)
        assert response.status_code == 200, response.text
        value = response.json()
        for key in count_path:
            value = value[key]
        assert value == len(expected), (suffix, response.json())
    c = client.app.state.container
    result = c.engine._run_log(c.runs.context(c.runs.get(pid, run["id"])))
    assert set(result.case_ids.astype(str)) == expected
    outside = next(row["caseId"] for row in overview["details"]["rows"] if row["caseId"] not in expected)
    assert client.get(url + f"/cases/{outside}/trace").status_code == 404
    card = cards["types"][0]
    fork = client.post(f"/api/v1/projects/{pid}/runs", json={**body, "scope": card["scope"]})
    assert fork.status_code == 202, fork.text
    assert wait_job(client, fork.json()["jobId"])["status"] == "done"
    assert client.get(f"/api/v1/projects/{pid}/runs/{fork.json()['id']}/summary").json()["cases"] == card["cases"]
    empty = client.post(
        f"/api/v1/projects/{pid}/runs", json={**body, "scope": {"selection_id": sid, "flow_type": "absent"}}
    )
    assert empty.status_code == 422, empty.text
    (c.workspace.project_dir(pid) / "dataset-binding.json").unlink()
    assert client.get(url + "/kpis").status_code == 200
    unbound = client.post(f"/api/v1/projects/{pid}/runs", json=body)
    assert unbound.status_code == 409 and unbound.json()["code"] == "project.dataset_binding_required"
    bind_dataset(c, pid, ids["dataset"])
    # Source mutation is detected before both flow-card and scored-result caches.
    directory = c.workspace.case_table_dir(pid, table_id)
    data = pd.read_parquet(directory / "cases.parquet")
    data.iloc[:-1].to_parquet(directory / "cases.parquet")
    assert client.get(base + "/flow-types", params={"selectionId": sid}).status_code == 409
    assert client.get(url + "/kpis").status_code == 409
    assert client.post(f"/api/v1/projects/{pid}/runs", json=body).status_code == 409


def test_immutable_record_cannot_be_overwritten_even_on_id_collision(cohort_world, monkeypatch):
    from wise_workbench.application.services import selections

    saved = save(cohort_world)
    path = selection_path(cohort_world[2], saved["id"])
    original = path.read_bytes()
    monkeypatch.setattr(selections, "new_id", lambda _prefix: saved["id"])
    response = cohort_world[0].post(endpoint(cohort_world), json={"name": "Overwrite attempt", "datasetId": "ds"})
    assert response.status_code == 409 and response.json()["code"] == "selection.exists"
    assert path.read_bytes() == original


@pytest.mark.parametrize("broken", ["absent_event_case", "duplicate_case_id", "null_case_id"])
def test_unrunnable_membership_is_refused_before_save(cohort_world, broken):
    directory, frame = cohort_world[2], cohort_world[4]
    if broken == "absent_event_case":
        events = pd.read_parquet(directory / "events.parquet")
        events.iloc[1:].to_parquet(directory / "events.parquet")
    else:
        frame = frame.copy()
        ids = list(frame.index)
        ids[0] = ids[1] if broken == "duplicate_case_id" else None
        frame.index = pd.Index(ids, name="case")
        frame.to_parquet(directory / "cases.parquet")
    response = cohort_world[0].post(endpoint(cohort_world), json={"name": "Unrunnable", "datasetId": "ds"})
    assert response.status_code == 422 and response.json()["code"] == "selection.case_ids"
    assert cohort_world[0].get(endpoint(cohort_world)).json() == []


def test_generated_selection_contract_matches_live_schema():
    import yaml

    from tests.conftest import REPO_ROOT
    from wise_workbench.api.app import openapi_document

    saved = yaml.safe_load((REPO_ROOT / "packages/api-schema/openapi.yaml").read_text())
    live = openapi_document()
    for path in (
        "/projects/{projectId}/case-tables/{caseTableId}/selections",
        "/projects/{projectId}/case-tables/{caseTableId}/selections/{selectionId}",
        "/projects/{projectId}/case-tables/{caseTableId}/flow-types",
        "/projects/{projectId}/dataset-binding",
    ):
        assert saved["paths"][path] == live["paths"][path]
    for name in (
        "SavedSelection",
        "SavedSelectionCreate",
        "SelectionSource",
        "EDASelection",
        "EDATimeRange",
        "EDASpanRange",
        "RunScope",
        "FlowTypes",
    ):
        assert saved["components"]["schemas"][name] == live["components"]["schemas"][name]
