"""Run-bound driver evidence has no scoring, persistence or population fallback."""

import json
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256

import pytest
import wise
from fastapi.testclient import TestClient

from tests.api.test_norm_signals import save_norm
from tests.api.test_norm_signals import world as world
from tests.conftest import wait_job
from wise_workbench.api.app import create_app, openapi_document
from wise_workbench.domain import RunStatus


def run_fixture(world, *, selection=False, derived=False):
    client, _pid, base, table, saved = world
    document = deepcopy(saved["norm"])
    document["constraints"][0]["applicability"] = {"attr": "amount", "lt": 12}
    if derived:
        document["derived_attributes"] = [
            {"name": "elapsed_days", "kind": "lag", "a": ["Start"], "b": ["End"], "unit": "D"}
        ]
    norm = save_norm(client, base, document, parentId=saved["id"])
    c = client.app.state.container
    dataset = c.repos.get_case_table(table).dataset_id
    scope = None
    if selection:
        response = client.post(
            base + f"/case-tables/{table}/selections",
            json={
                "name": "Short observed spans",
                "datasetId": dataset,
                "attribute": "group",
                "selection": {"spanRanges": [{"min": 0, "max": 14}]},
            },
        )
        assert response.status_code == 201, response.text
        scope = {"selection_id": response.json()["id"]}
    response = client.post(
        base + "/runs",
        json={
            "caseTableId": table,
            "normVersionId": norm["id"],
            "slicings": [{"id": "by-group", "attributes": ["group"]}],
            "scope": scope,
            "minCases": 1,
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()
    assert wait_job(client, run["jobId"])["status"] == "done"
    return run, norm, scope


def request(world, run, **params):
    client, _, base, _, _ = world
    return client.get(
        base + f"/runs/{run['id']}/driver-evidence",
        params={"constraintId": "elapsed", "slicing": "by-group", "key": '["A"]', "view": "Process", **params},
    )


def read(world, run, **params):
    response = request(world, run, **params)
    assert response.status_code == 200, response.text
    return response.json()


def test_run_selection_group_filter_and_rule_scope_are_separate(world, monkeypatch):
    run, norm, scope = run_fixture(world, selection=True)
    client, _pid, base, _table, _ = world
    c = client.app.state.container
    before = {
        p: sha256(p.read_bytes()).hexdigest()
        for p in c.workspace.root.rglob("*")
        if p.is_file() and p.suffix not in (".db", "-wal", "-shm")
    }
    jobs = client.get("/api/v1/jobs").json()
    norms = client.get(base + "/norms").json()
    run_before = client.get(base + f"/runs/{run['id']}").json()

    def forbidden(*args, **kwargs):
        pytest.fail("Driver evidence must not score or write a run-side cache")

    monkeypatch.setattr(wise, "score", forbidden)
    monkeypatch.setattr(c.engine, "_censored", forbidden)
    whole = read(world, run)
    assert whole["scope"]["fullCaseTableCases"] == 4 and whole["scope"]["runCases"] == 3
    assert whole["scope"]["groupCases"] == whole["scope"]["selectedCases"] == 3
    assert whole["scope"]["ruleApplicabilityApplied"] is False and whole["scope"]["population"] == "selected_cases"
    assert whole["duration"]["pairedCases"] == 2 and whole["duration"]["median"] == 12
    assert whole["source"]["selectionId"] == scope["selection_id"] and whole["source"]["runScope"] == scope
    assert whole["solutionCard"]["id"] == "elapsed-time"
    assert whole["source"]["normVersionId"] == norm["id"]
    assert whole["source"]["normFingerprint"] == run_before["manifest"]["normFingerprint"]
    filtered = read(world, run, filter=json.dumps({"kind": "attribute", "field": "amount", "max": 12}))
    assert filtered["scope"]["groupCases"] == 3 and filtered["scope"]["selectedCases"] == 1
    assert filtered["scope"]["filtered"] is True and filtered["scope"]["selectedEvents"] == 3
    assert filtered["scope"]["filter"] == {"and": [{"kind": "attribute", "field": "amount", "max": 12}]}
    assert filtered["duration"]["median"] == 11 and filtered["endDayOfMonth"]["eventCount"] == 1
    assert whole["scope"]["fingerprint"] != filtered["scope"]["fingerprint"]
    assert request(world, run, key='["B"]').status_code == 404  # Present in source, excluded from this run.
    empty = read(world, run, filter=json.dumps({"kind": "activity", "activity": "Absent", "op": "contains"}))
    assert empty["status"] == "unavailable" and empty["scope"]["selectedCases"] == 0
    assert empty["duration"]["median"] is None
    assert whole == read(world, run)
    assert client.get("/api/v1/jobs").json() == jobs and client.get(base + "/norms").json() == norms
    assert client.get(base + f"/runs/{run['id']}").json() == run_before
    after = {
        p: sha256(p.read_bytes()).hexdigest()
        for p in c.workspace.root.rglob("*")
        if p.is_file() and p.suffix not in (".db", "-wal", "-shm")
    }
    assert after == before


def test_immutable_run_norm_identity_cold_read_and_generic_coverage(world):
    run, norm, _ = run_fixture(world)
    client, _, base, _, _ = world
    first = read(world, run)
    changed = deepcopy(norm["norm"])
    changed["constraints"][0]["params"]["b"] = ["Close"]
    save_norm(client, base, changed, parentId=norm["id"])
    assert read(world, run) == first
    assert first["endpoints"]["end"]["labels"] == ["End"]
    presence = read(world, run, constraintId="start")
    assert presence["status"] == "available" and presence["duration"] is None
    assert presence["activityCoverage"]["casesWithActivity"] == 3
    assert presence["dueDate"]["status"] == "unavailable"
    settings = client.app.state.container.settings.model_copy(update={"inprocess_worker": False})
    with TestClient(create_app(settings)) as cold:
        response = cold.get(
            base + f"/runs/{run['id']}/driver-evidence",
            params={"constraintId": "elapsed", "slicing": "by-group", "key": '["A"]', "view": "Process"},
        )
        assert response.status_code == 200 and response.json() == first


def test_invalid_scope_readiness_and_ownership_never_widen(world):
    run, _, _ = run_fixture(world)
    for params in (
        {"view": "absent"},
        {"key": '["A","B"]'},
        {"key": '["A"'},
        {"key": '{"value":"A"}'},
        {"key": '[["A"]]'},
        {"slicing": "unknown"},
        {"filter": "{"},
        {"filter": '{"kind":"unsupported"}'},
        {"within": "ignored"},
    ):
        assert request(world, run, **params).status_code == 422, params
    assert request(world, run, constraintId="absent").status_code == 404
    client, _, _base, _, _ = world
    other = client.post("/api/v1/projects", json={"name": "Other"}).json()["id"]
    assert (
        client.get(
            f"/api/v1/projects/{other}/runs/{run['id']}/driver-evidence",
            params={"constraintId": "elapsed", "slicing": "group", "key": '["A"]'},
        ).status_code
        == 404
    )
    c = client.app.state.container
    original = c.repos.get_run(run["id"])
    try:
        c.repos.update_run(replace(original, status=RunStatus.QUEUED))
        assert request(world, run).status_code == 409
    finally:
        c.repos.update_run(original)


def test_typed_schema_exposes_bounded_buckets_and_solution_blocks():
    doc = openapi_document()
    operation = doc["paths"]["/projects/{projectId}/runs/{runId}/driver-evidence"]["get"]
    assert operation["operationId"] == "getDriverEvidence"
    schema = doc["components"]["schemas"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/DriverEvidence")
    assert schema["DriverEndDayOfMonth"]["properties"]["buckets"]["minItems"] == 31
    assert schema["DriverEndDayOfMonth"]["properties"]["buckets"]["maxItems"] == 31
    assert set(schema["SolutionCardBlock"]["properties"]["kind"]["enum"]) == {
        "activity_coverage",
        "endpoint_duration",
        "end_day_of_month",
        "due_date_lead",
    }


def test_transforms_and_compound_filters_use_the_saved_run(world):
    run, _, _ = run_fixture(world, selection=True)
    client, pid, _base, _table, _ = world
    c = client.app.state.container
    before = read(world, run)
    source = c.repos.get_run(run["id"])
    transformed, job, _ = c.runs.create(
        pid,
        replace(source.params, transforms=({"kind": "cap_lag", "a": "Start", "b": "End", "max": 5, "unit": "D"},)),
        force=True,
    )
    assert job is not None and wait_job(client, job.id)["status"] == "done"
    after = read(
        world,
        {"id": transformed.id},
        filter=json.dumps(
            {
                "and": [
                    {"kind": "lag", "a": "Start", "b": "End", "unit": "D", "max": 6},
                    {"kind": "attribute", "field": "amount", "max": 12},
                ]
            }
        ),
    )
    assert after["source"]["transformCount"] == 1
    assert after["source"]["selectionId"] == before["source"]["selectionId"]
    assert after["scope"]["runCases"] == 3 and after["scope"]["selectedCases"] == 1
    assert after["duration"]["median"] == 5
    assert after["endDayOfMonth"]["topDay"]["day"] == 6
    assert read(world, run) == before


def test_cold_read_filters_saved_derived_attributes_without_scoring(world, monkeypatch):
    run, _, _ = run_fixture(world, derived=True)
    client, _pid, base, _table, _ = world
    settings = client.app.state.container.settings.model_copy(update={"inprocess_worker": False})

    def forbidden(*args, **kwargs):
        pytest.fail("Evidence may read the saved derived field, but must not re-score")

    monkeypatch.setattr(wise, "score", forbidden)
    with TestClient(create_app(settings)) as cold:
        response = cold.get(
            base + f"/runs/{run['id']}/driver-evidence",
            params={
                "constraintId": "elapsed",
                "slicing": "by-group",
                "key": '["A"]',
                "view": "Process",
                "filter": json.dumps({"kind": "attribute", "field": "elapsed_days", "max": 12}),
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["scope"]["selectedCases"] == 1 and result["duration"]["median"] == 11


def test_numeric_bands_and_duplicate_query_parameters(world):
    run, _, _ = run_fixture(world)
    bands = [{"attribute": "amount", "method": "cuts", "cuts": [12]}]
    result = read(world, run, slicing="amount", bands=json.dumps(bands), key='["< 12"]')
    assert result["scope"]["bands"] == bands
    assert result["scope"]["selectedCases"] == 1 and result["duration"]["median"] == 11
    client, _, base, _, _ = world
    response = client.get(
        base + f"/runs/{run['id']}/driver-evidence",
        params=[
            ("constraintId", "elapsed"),
            ("slicing", "by-group"),
            ("key", '["A"]'),
            ("filter", '{"kind":"activity","activity":"Absent"}'),
            ("filter", "{}"),
        ],
    )
    assert response.status_code == 422


def test_summary_cache_reuses_identical_measurements_without_sharing_mutable_payloads(world, monkeypatch):
    import wise_workbench.adapters.engine.driver_evidence as evidence

    run, _, _ = run_fixture(world)
    count = 0
    original = evidence.temporal_evidence

    def counted(*args, **kwargs):
        nonlocal count
        count += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(evidence, "temporal_evidence", counted)
    result = read(world, run)
    changed = read(world, run, filter=json.dumps({"kind": "attribute", "field": "amount", "max": 12}))
    assert changed["scope"]["selectedCases"] == 1
    assert read(world, run) == result and count == 2
    client, pid, _, _, _ = world
    c = client.app.state.container
    payload = c.runs.driver_evidence(pid, run["id"], constraint_id="elapsed", slicing="by-group", slice_key='["A"]')
    payload["duration"]["median"] = 9000
    assert read(world, run)["duration"]["median"] == 12 and count == 2
    # A cached response must not hide loss of the source artefact or reconstruct it.
    frame = c.workspace.run_dir(pid, run["id"]) / "frame.parquet"
    frame.unlink()
    response = request(world, run)
    assert response.status_code == 404 and response.json()["code"] == "driver_evidence.frame_unavailable"
    assert not frame.exists()


def test_concurrent_cards_share_log_and_bound_intermediate_computations(world, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    from time import sleep

    run, _, _ = run_fixture(world)
    client, pid, _, _, _ = world
    c = client.app.state.container
    original = c.engine._compute_driver_evidence
    load_log = c.engine._load_log
    log_identities = set()

    def reused_log(*args, **kwargs):
        log = load_log(*args, **kwargs)
        log_identities.add(id(log))
        return log

    monkeypatch.setattr(c.engine, "_load_log", reused_log)
    barrier, counter_lock = Barrier(3), Lock()
    active = peak = calls = 0

    def measured(*args, **kwargs):
        nonlocal active, peak, calls
        with counter_lock:
            active += 1
            calls += 1
            peak = max(peak, active)
        try:
            sleep(0.02)  # Make overlapping calls visible if the compute gate regresses.
            return original(*args, **kwargs)
        finally:
            with counter_lock:
                active -= 1

    monkeypatch.setattr(c.engine, "_compute_driver_evidence", measured)
    filters = [None, '{"kind":"attribute","field":"amount","max":12}', '{"kind":"attribute","field":"amount","min":12}']

    def measure(filter_text):
        barrier.wait(timeout=5)
        return c.runs.driver_evidence(
            pid, run["id"], constraint_id="elapsed", slicing="by-group", slice_key='["A"]', filter_text=filter_text
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(measure, filters))
    assert calls == 3 and peak == 1
    assert [r["scope"]["selectedCases"] for r in results] == [3, 1, 1]
    assert [r["duration"]["median"] for r in results] == [12, 11, 13]
    assert len({r["scope"]["fingerprint"] for r in results}) == 3
    assert len(log_identities) == 1
