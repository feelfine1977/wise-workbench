"""Exact sequences through real ingestion/scoring on the pinned engine, never raw log downloads."""

from __future__ import annotations

import io
import json
from dataclasses import replace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(tmp_path_factory.mktemp("variants"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        project = client.post("/api/v1/projects", json={"name": "Exact variants", "process": "p2p"}).json()["id"]
        base = f"/api/v1/projects/{project}"
        rows = []
        for case, acts, vendor, company, duration in [
            ("c1", "ABBAC", "V1", "X", 4),
            ("c2", "ABBAC", "V1", "X", 8),
            ("c3", "ABABC", "V2", "X", 4),
            ("c4", "AC", "V1", "Y", 1),
            ("c5", "ABC", "V2", "X", 2),
            ("c6", "AC", "V2", "X", 1),
        ]:
            for i, activity in enumerate(acts):
                rows.append(
                    {
                        "case": case,
                        "activity": activity,
                        "time": pd.Timestamp("2024-01-01") + pd.Timedelta(hours=duration * i / (len(acts) - 1)),
                        "position": i,
                        "vendor": vendor,
                        "company": company,
                        "amount": int(case[1:]) * 10,
                    }
                )
        csv = pd.DataFrame(rows[::-1]).to_csv(index=False).encode()
        response = client.post(base + "/datasets", files={"file": ("variants.csv", io.BytesIO(csv), "text/csv")})
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "done", job
        dataset = job["resultRef"].split(":", 1)[1]
        response = client.post(
            base + f"/datasets/{dataset}/mappings",
            json={
                "caseId": "case",
                "activity": "activity",
                "timestamp": "time",
                "order": "position",
                "caseAttributes": ["vendor", "company"],
                "exposure": "amount",
                "closureActivities": ["C"],
            },
        )
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "done", job
        # A real norm; the feature must not select only cases to which its expectations apply.
        response = client.post(
            base + "/norms",
            json={
                "note": "Synthetic variants",
                "norm": {
                    "schema_version": 2,
                    "name": "Synthetic selection",
                    "layers": [{"id": "L", "name": "Recorded"}],
                    "views": [{"name": "Observed", "constraint_weights": {"has_a": 1.0}}],
                    "constraints": [
                        {
                            "id": "has_a",
                            "layer": "L",
                            "type": "presence",
                            "params": {"activity": "A", "m": 1},
                            "weight": 1.0,
                            "applicability": {"attr": "vendor", "eq": "V1"},
                        }
                    ],
                },
            },
        )
        assert response.status_code == 201, response.text
        norm = response.json()["id"]
        body = {
            "caseTableId": job["resultRef"].split(":", 1)[1],
            "normVersionId": norm,
            "slicings": [{"id": "by-company", "attributes": ["company"]}],
            "minCases": 1,
        }
        binding = client.put(base + "/dataset-binding", json={"datasetId": dataset})
        assert binding.status_code == 200, binding.text
        response = client.post(base + "/runs", json=body)
        assert response.status_code == 202, response.text
        run = response.json()
        assert wait_job(client, run["jobId"])["status"] == "done"
        yield {"client": client, "base": base, "run": run["id"], "body": body, "settings": settings}


def get(w, **params):
    response = w["client"].get(f"{w['base']}/runs/{w['run']}/variants", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_counts_limits_full_sequences_samples_and_cold_restart(world):
    result = get(world, limit=1, exampleLimit=1)
    assert result["totalSelectedCases"] == 6 and result["totalVariants"] == 4
    assert result["coveredCount"] == 2 and result["coverage"] == pytest.approx(1 / 3)
    assert result["excludedZeroEventCases"] == 0
    top = result["variants"][0]
    assert top["activities"] == list("ABBAC") and top["exampleCaseIds"] == ["c1"]
    assert top["medianDurationHours"] == 6
    for variant in get(world)["variants"]:
        for case in variant["exampleCaseIds"]:
            trace = world["client"].get(f"{world['base']}/runs/{world['run']}/cases/{case}/trace").json()
            assert [e["activity"] for e in trace["events"]] == variant["activities"]
    with TestClient(create_app(world["settings"].model_copy(update={"inprocess_worker": False}))) as client:
        cold = client.get(f"{world['base']}/runs/{world['run']}/variants", params={"limit": 1, "exampleLimit": 1})
        assert cold.status_code == 200 and cold.json() == result


@pytest.mark.parametrize(
    "selection",
    [
        {"filter": json.dumps({"and": [{"kind": "attribute", "field": "vendor", "in": ["V1"]}]})},
        {"filter": json.dumps({"and": [{"kind": "count", "activity": "B", "min": 2}]})},
        {"slicing": "by-company", "sliceKey": '["X"]'},
        {
            "slicing": "company",
            "sliceKey": '["X"]',
            "filter": json.dumps({"kind": "attribute", "field": "vendor", "eq": "V1"}),
        },
        {
            "slicing": "exposure",
            "sliceKey": '["low"]',
            "bands": json.dumps([{"attribute": "exposure", "method": "cuts", "cuts": [35], "labels": ["low", "high"]}]),
        },
    ],
)
def test_same_verified_filter_slice_and_band_population_as_flow(world, selection):
    result = get(world, **selection)
    flow = world["client"].get(f"{world['base']}/runs/{world['run']}/flow", params=selection)
    assert flow.status_code == 200, flow.text
    assert result["totalSelectedCases"] == flow.json()["meta"]["cases"]
    assert sum(v["count"] for v in result["variants"]) == result["totalSelectedCases"]


def test_scope_and_transforms_and_trace_stay_with_exact_run(world):
    client = world["client"]
    scoped = client.post(
        world["base"] + "/runs", json={**world["body"], "scope": {"attribute": "company", "value": "X"}}
    ).json()
    assert wait_job(client, scoped["jobId"])["status"] == "done"
    scoped_world = {**world, "run": scoped["id"]}
    assert get(scoped_world)["totalSelectedCases"] == 5
    assert get(scoped_world)["scope"] == {"attribute": "company", "value": "X"}
    assert client.get(f"{world['base']}/runs/{scoped['id']}/cases/c4/trace").status_code == 404
    filtered = get(scoped_world, filter=json.dumps({"kind": "attribute", "field": "vendor", "eq": "V1"}))
    assert filtered["totalSelectedCases"] == 2 and filtered["totalVariants"] == 1

    container = client.app.state.container
    source = container.repos.get_run(scoped["id"])
    transformed, job, _ = container.runs.create(
        source.project_id, replace(source.params, transforms=({"kind": "keep_first", "activity": "B"},)), force=True
    )
    assert wait_job(client, job.id)["status"] == "done"
    changed = get(
        {**world, "run": transformed.id}, filter=json.dumps({"kind": "attribute", "field": "vendor", "eq": "V1"})
    )
    assert changed["variants"][0]["activities"] == list("ABAC")
    trace = client.get(f"{world['base']}/runs/{transformed.id}/cases/c1/trace").json()
    assert [e["activity"] for e in trace["events"]] == list("ABAC")
    assert get(scoped_world)["variants"][0]["activities"] == list("ABBAC")


def test_empty_filter_and_zero_event_frame_population(world, monkeypatch):
    empty = get(world, filter=json.dumps({"kind": "attribute", "field": "vendor", "eq": "absent"}))
    assert empty["totalSelectedCases"] == 0 and empty["variants"] == [] and empty["coverage"] == 0
    engine = world["client"].app.state.container.engine
    original = engine._get_frame

    # A frozen run frame may contain a case whose events were all removed by a scenario.
    def frame(run, ctx):
        out = original(run, ctx).copy()
        out.loc["no-events"] = out.iloc[0]
        return out

    monkeypatch.setattr(engine, "_get_frame", frame)
    result = get(world)
    assert result["totalSelectedCases"] == 7 and result["excludedZeroEventCases"] == 1
    assert result["coveredCount"] == 6 and result["coverage"] == pytest.approx(6 / 7)


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 51},
        {"exampleLimit": 0},
        {"exampleLimit": 6},
        {"filter": "{"},
        {"filter": '{"kind":"exact_variant","activities":["A"]}'},
        {"slicing": "company,vendor", "sliceKey": '["X"]'},
        {"sliceKey": '["X"]'},
        {"slicing": "nope", "sliceKey": '["X"]'},
    ],
)
def test_invalid_selection_is_rejected_not_widened(world, params):
    response = world["client"].get(f"{world['base']}/runs/{world['run']}/variants", params=params)
    assert response.status_code == 422, response.text


def test_run_ownership_and_ready_guard(world):
    client = world["client"]
    other = client.post("/api/v1/projects", json={"name": "Other"}).json()["id"]
    assert client.get(f"/api/v1/projects/{other}/runs/{world['run']}/variants").status_code == 404
    container = client.app.state.container
    run = container.repos.get_run(world["run"])
    from wise_workbench.domain import RunStatus

    try:
        container.repos.update_run(replace(run, status=RunStatus.QUEUED))
        assert client.get(f"{world['base']}/runs/{world['run']}/variants").status_code == 409
    finally:
        container.repos.update_run(run)
