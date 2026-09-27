"""Computed review evidence survives edits and never borrows another assessment."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, run_running_example, upload_running_example
from wise_workbench.api.app import create_app
from wise_workbench.domain import ConflictError, ReviewItem, ReviewKind


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(
        tmp_path_factory.mktemp("hypothesis-integrity"), inprocess_worker=True, analytics_auto=False
    )
    with TestClient(create_app(settings)) as client:
        ids = upload_running_example(client)
        rid = run_running_example(client, ids)
        yield client, ids["project"], rid, settings


def scope(world, view="Finance"):
    return {"runId": world[2], "slicing": "company", "sliceKey": '["A"]', "view": view}


def url(world, kind="hypotheses"):
    return f"/api/v1/projects/{world[1]}/{kind}"


def decide(world, view="Finance", status="waived"):
    client, pid, rid, _ = world
    params = {"slicing": "company", "key": '["A"]', "view": view}
    endpoint = f"/api/v1/projects/{pid}/runs/{rid}/gates"
    gates = client.get(endpoint, params=params)
    assert gates.status_code == 200, gates.text
    for gate in gates.json()["gates"]:
        # Run-wide decisions have one scope, independently of the view.
        if view == "Logistics" and gate.get("scope") == "run":
            continue
        response = client.post(
            endpoint + "/" + gate["id"],
            params=params,
            json={"status": status, "note": "Reviewed synthetic evidence", "author": "Reviewer"},
        )
        assert response.status_code == 200, response.text


def create(world, **extra):
    response = world[0].post(url(world), json={**scope(world), "constraint_id": "c2", **extra})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("comparison", ["period", "subgroup"])
def test_unsupported_comparison_is_refused_before_computation(world, comparison):
    decide(world)
    response = world[0].post(url(world), json={**scope(world), "constraint_id": "c2", "comparison": comparison})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("kind", ["hypotheses", "findings"])
@pytest.mark.parametrize(
    "replacement",
    [
        {"test": {"risk_difference": 1}},
        {"test": None},
        {"id": "forged"},
        {"runId": "other"},
        {"view": "Logistics"},
        {"projectId": "other"},
        {"kind": "action"},
        {"constraint_id": "c5"},
        {"comparison": "period"},
    ],
)
def test_saved_identity_and_computation_cannot_be_replaced(world, kind, replacement):
    decide(world)
    item = (
        create(world)
        if kind == "hypotheses"
        else world[0].post(url(world, kind), json={"title": "Observation", **scope(world)}).json()
    )
    response = world[0].patch(url(world, kind) + "/" + item["id"], json=replacement)
    assert response.status_code == 422, response.text
    saved = next(x for x in world[0].get(url(world, kind)).json() if x["id"] == item["id"])
    assert saved == item


@pytest.mark.parametrize("kind", ["hypotheses", "findings"])
def test_creation_rejects_forged_computation_even_when_null(world, kind):
    for field in ("id", "test", "evidenceContext"):
        response = world[0].post(url(world, kind), json={"title": "Observation", "constraint_id": "c2", field: None})
        assert response.status_code == 422, response.text


def test_no_evidence_cannot_be_declared_supported(world):
    client = world[0]
    for extra in ({}, {"runId": "missing"}, {**scope(world), "runId": "missing"}):
        response = client.post(url(world), json={"constraint_id": "c2", "outcome": "supported", **extra})
        assert response.status_code == 409, response.text
    draft = client.post(url(world), json={"constraint_id": "c2"}).json()
    assert draft["status"] == "open" and draft["test"] is None
    for patch in ({"status": "supported"}, {"outcome": "not_supported"}):
        assert client.patch(url(world) + "/" + draft["id"], json=patch).status_code == 409


def test_the_recorded_view_governs_creation_and_outcome_changes(world):
    decide(world, "Finance")
    decide(world, "Logistics", "failed")
    create(world)
    response = world[0].post(url(world), json={**scope(world, "Logistics"), "constraint_id": "c2"})
    assert response.status_code == 409, response.text
    decide(world, "Logistics")
    item = create(world, view="Logistics")
    decide(world, "Logistics", "failed")
    response = world[0].patch(url(world) + "/" + item["id"], json={"outcome": "supported"})
    assert response.status_code == 409, response.text
    decide(world, "Logistics")


def test_unavailable_gate_calculation_is_not_a_pass(world, monkeypatch):
    def unavailable(*args, **kwargs):
        raise ConflictError("Evidence is unavailable")

    monkeypatch.setattr(world[0].app.state.container.review, "gates", unavailable)
    response = world[0].post(url(world), json={**scope(world), "constraint_id": "c2"})
    assert response.status_code == 409 and response.json()["code"] == "review.evidence_unavailable"


def test_interval_is_the_computed_newcombe_interval_and_edits_survive_restart(world, dependency_profile):
    if dependency_profile == "minimal":
        pytest.skip("Analytical comparison requires the full dependency profile")
    from wise_analytics._stats import newcombe_interval, z_for

    decide(world)
    item = create(world, outcome="supported")
    result = item["test"]
    assert result["interval_method"] == "Newcombe/Wilson"
    assert result["confidence_level"] == 0.9
    assert result["comparison"] == "group_vs_rest"
    expected = newcombe_interval(
        result["share_here"] * result["n_group"],
        result["n_group"],
        result["share_elsewhere"] * result["n_rest"],
        result["n_rest"],
        z_for(0.9),
    )
    assert result["interval"] == pytest.approx(expected)
    assert item["evidenceContext"]["view"] == "Finance"
    assert item["evidenceContext"]["comparator"]["kind"] == "group_vs_rest"
    response = world[0].patch(url(world) + "/" + item["id"], json={"note": "Checked", "title": "Invoice lag"})
    assert response.status_code == 200, response.text
    with TestClient(create_app(world[3].model_copy(update={"inprocess_worker": False}))) as client:
        saved = client.get(url(world) + "/" + item["id"]).json()
    assert saved["note"] == "Checked" and saved["test"] == result
    assert saved["evidenceContext"] == item["evidenceContext"]


def test_legacy_body_never_shadows_record_identity():
    item = ReviewItem(
        id="real",
        project_id="project",
        kind=ReviewKind.HYPOTHESIS,
        status="open",
        run_id="real-run",
        body={"id": "forged", "runId": "forged", "status": "supported"},
    )
    assert item.to_dict()["id"] == "real"
    assert item.to_dict()["runId"] == "real-run"
    assert item.to_dict()["status"] == "open"


def test_whole_group_and_equivalent_filter_report_unknown_closure(world):
    import json

    client, pid, rid, _ = world
    endpoint = f"/api/v1/projects/{pid}/runs/{rid}/gates"
    params = {"slicing": "company", "key": '["A"]', "view": "Finance"}
    whole = client.get(endpoint, params=params).json()
    filtered = client.get(
        endpoint,
        params={**params, "filter": json.dumps({"and": [{"kind": "attribute", "field": "company", "eq": "A"}]})},
    ).json()
    for state in (whole, filtered):
        censoring = next(g for g in state["gates"] if g["id"] == "censoring")
        assert censoring["evidence"]["share"] is None
        assert censoring["computed_status"] == "pending"


def test_measured_zero_is_not_an_unknown_measurement(world, dependency_profile):
    if dependency_profile == "minimal":
        pytest.skip("Measurement requires the analytics profile")
    response = world[0].get(
        f"/api/v1/projects/{world[1]}/runs/{world[2]}/gates",
        params={"slicing": "company", "key": '["A"]', "view": "Finance"},
    )
    assert response.status_code == 200, response.text
    replication = next(g for g in response.json()["gates"] if g["id"] == "replication")
    assert replication["evidence"]["share"] == 0
    assert replication["computed_status"] == "passed"
