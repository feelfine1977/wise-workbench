"""Findings persist their exact assessment scope without client-authored evidence."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, run_running_example, upload_running_example
from wise_workbench.api.app import create_app


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(tmp_path_factory.mktemp("finding-evidence"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        ids = upload_running_example(client)
        run = run_running_example(client, ids)
        yield client, settings, ids, run


def url(world):
    return f"/api/v1/projects/{world[2]['project']}/findings"


def body(world, **extra):
    return {
        "title": "Review corrections",
        "runId": world[3],
        "slicing": "company",
        "sliceKey": '["A"]',
        "view": "Finance",
        "status": "investigate",
        "note": "Validate change reasons",
        "owner_role": "Buyer",
        **extra,
    }


def create(world, **extra):
    response = world[0].post(url(world), json=body(world, **extra))
    assert response.status_code == 201, response.text
    return response.json()


def test_findings_have_server_owned_context_and_survive_restart(world):
    selection = {"and": [{"kind": "attribute", "field": "vendor", "in": ["V1"]}]}
    saved = create(world, filter=selection)
    evidence = saved["evidenceContext"]
    assert saved["evidenceState"] == "recorded"
    assert evidence["runId"] == world[3]
    assert evidence["view"] == "Finance"
    assert evidence["filter"] == selection
    assert evidence["selectionState"] == "measured"
    assert evidence["populationCases"] == 1
    assert evidence["selectionFingerprint"]
    assert evidence["normVersionId"] == world[2]["norm"]
    assert evidence["normFingerprint"] and evidence["manifestFingerprint"]
    assert evidence["comparator"] == {"kind": "run_population", "view": "Finance"}
    with TestClient(create_app(world[1].model_copy(update={"inprocess_worker": False}))) as fresh:
        records = fresh.get(url(world), params={"runId": world[3]}).json()
        restored = next(item for item in records if item["id"] == saved["id"])
        assert restored == saved


def test_views_selections_and_revisions_are_separate(world):
    a = create(world, filter={"and": [{"kind": "attribute", "field": "vendor", "in": ["V1"]}]})
    b = create(world, filter={"and": [{"kind": "attribute", "field": "vendor", "in": ["V2"]}]})
    other_view = create(world, view="Logistics")
    whole = create(world)
    revision = create(world, note="Reviewed again")
    assert len({item["id"] for item in [a, b, other_view, whole, revision]}) == 5
    assert a["evidenceContext"]["selectionFingerprint"] != b["evidenceContext"]["selectionFingerprint"]
    assert other_view["evidenceContext"]["view"] == "Logistics"
    assert whole["evidenceContext"] == revision["evidenceContext"]
    records = world[0].get(url(world)).json()
    assert next(item for item in records if item["id"] == whole["id"])["note"] == "Validate change reasons"


@pytest.mark.parametrize(
    "extra",
    [
        {"evidenceContext": {"normVersionId": "forged"}},
        {"normVersionId": "forged"},
        {"evidenceState": "recorded"},
        {"within": "drilled"},
        {"test": {"risk_difference": 1}},
    ],
)
def test_client_cannot_supply_or_replace_evidence(world, extra):
    response = world[0].post(url(world), json=body(world, **extra))
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "review.immutable_context"
    saved = create(world)
    response = world[0].patch(url(world) + "/" + saved["id"], json=extra)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "extra,code",
    [
        ({"slicing": None}, "review.context_required"),
        ({"runId": "missing-run"}, "review.evidence_unavailable"),
        ({"filter": ""}, "filter.json"),
        ({"filter": "not-json"}, "filter.json"),
    ],
)
def test_incomplete_or_invalid_scope_is_refused(world, extra, code):
    response = world[0].post(url(world), json=body(world, **extra))
    assert response.status_code in (409, 422), response.text
    assert response.json()["code"] == code


def test_unmeasured_filter_is_preserved_without_whole_group_substitution(world):
    empty = {"and": [{"kind": "attribute", "field": "vendor", "in": ["missing"]}]}
    saved = create(world, filter=empty)
    evidence = saved["evidenceContext"]
    assert evidence["filter"] == empty
    assert evidence["selectionState"] == "unavailable"
    assert evidence["populationCases"] is None
    assert evidence["selectionReason"]


def test_unscoped_legacy_finding_is_explicitly_unassessed(world):
    response = world[0].post(url(world), json={"title": "Unassessed observation"})
    assert response.status_code == 201
    assert response.json()["evidenceState"] == "unassessed"
    assert response.json()["evidenceContext"] is None


def test_legacy_scope_without_view_returns_the_resolved_server_view(world):
    saved = create(world, view=None)
    assert saved["view"] and saved["view"] == saved["evidenceContext"]["view"]
