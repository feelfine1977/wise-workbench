"""A review selection uses its own items and cannot inherit a different selection's decisions."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from tests.api.test_action_eligibility import decide_all, endpoint, proposal
from tests.conftest import RUNNING_MAPPING, make_settings, run_running_example, upload_running_example
from wise_workbench.api.app import create_app


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(tmp_path_factory.mktemp("filtered-evidence"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        with pytest.MonkeyPatch.context() as patch:
            patch.setitem(RUNNING_MAPPING, "closureActivities", ["Clear Invoice"])
            ids = upload_running_example(client)
        rid = run_running_example(client, ids)
        yield {"client": client, "ids": ids, "run": rid, "settings": settings, "container": client.app.state.container}


V1 = {"and": [{"kind": "attribute", "field": "vendor", "in": ["V1"]}]}
V2 = {"and": [{"kind": "attribute", "field": "vendor", "in": ["V2"]}]}


def params(filter_obj=V1, *, company="A"):
    return {"slicing": "company", "key": json.dumps([company]), "view": "Finance", "filter": json.dumps(filter_obj)}


def gates(w, filter_obj=V1, *, company="A"):
    r = w["client"].get(endpoint(w) + f"/runs/{w['run']}/gates", params=params(filter_obj, company=company))
    assert r.status_code == 200, r.text
    return r.json()


def waive(w, filter_obj=V1):
    for g in gates(w, filter_obj)["gates"]:
        r = w["client"].post(
            endpoint(w) + f"/runs/{w['run']}/gates/{g['id']}",
            params=params(filter_obj),
            json={"status": "waived", "note": "Reviewed this public synthetic selection", "author": "Reviewer"},
        )
        assert r.status_code == 200, r.text


def test_selection_has_exact_count_and_survives_restart(world):
    state = gates(world)
    assert state["cases"] == state["selection"]["cases"] == 1
    assert state["selection"]["wholeGroupCases"] == 2
    assert state["filter"] == V1
    draft = proposal(world, filter=V1)
    context = draft["evidenceContext"]
    assert context["populationCases"] == 1
    assert context["selectionFingerprint"] == state["selection"]["fingerprint"]
    assert context["comparator"] == {"kind": "run_population", "view": "Finance"}
    with TestClient(create_app(world["settings"].model_copy(update={"inprocess_worker": False}))) as c:
        same = c.get(endpoint(world) + f"/runs/{world['run']}/gates", params=params()).json()
        assert same["selection"] == state["selection"]
        saved = next(x for x in c.get(endpoint(world) + "/actions").json() if x["id"] == draft["id"])
        assert saved["evidenceContext"] == context


def test_filtered_waivers_do_not_grant_other_filter_or_whole_group(world):
    decide_all(world, status="failed")
    rejected_other = world["client"].post(
        endpoint(world) + f"/runs/{world['run']}/gates/domain",
        params=params(V2),
        json={"status": "failed", "note": "The other selection needs investigation", "author": "Reviewer"},
    )
    assert rejected_other.status_code == 200
    first = proposal(world, filter=V1)
    second = proposal(world, filter=V2)
    url = endpoint(world) + "/actions/"
    assert world["client"].patch(url + first["id"], json={"status": "agreed"}).status_code == 409
    waive(world, V1)
    accepted = world["client"].patch(url + first["id"], json={"status": "agreed"})
    assert accepted.status_code == 200, accepted.text
    assert proposal(world, filter=V1, status="agreed")["status"] == "agreed"
    for draft in (second, proposal(world)):
        refused = world["client"].patch(url + draft["id"], json={"status": "agreed"})
        assert refused.status_code == 409 and refused.json()["code"] == "review.gate_unresolved"
    # Equivalent clause ordering and repetition retain the same measured selection.
    dup = {"and": V1["and"] * 2}
    assert gates(world, dup)["selection"] == gates(world, V1)["selection"]
    assert all(g["status"] == "waived" for g in gates(world, dup)["gates"])


def test_zero_share_is_measured_and_missing_measurements_stay_pending(world, dependency_profile):
    state = gates(world, V2, company="B")
    assert state["cases"] == 1 and state["selection"]["wholeGroupCases"] == 3
    rows = {g["id"]: g for g in state["gates"]}
    if dependency_profile == "full":
        assert rows["replication"]["evidence"]["share"] == 0.0
        assert rows["replication"]["computed_status"] == "passed"
        assert rows["censoring"]["evidence"]["share"] == 1.0
        assert rows["censoring"]["computed_status"] == "failed"
    else:
        assert rows["readiness"]["computed_status"] == "pending"
        for kind in ("censoring", "replication"):
            assert rows[kind]["evidence"]["share"] is None
            assert rows[kind]["computed_status"] == "pending"


@pytest.mark.parametrize(
    "clause",
    [
        {"kind": "time", "field": "active", "from": "2024-01-01"},
        {"kind": "follows", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "never": True},
        {"kind": "lag", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "min": 1, "directly": True},
        {"kind": "attribute", "field": "vendor", "in": ["V1"], "not_in": ["V2"]},
        {"kind": "count", "activity": "Record Goods Receipt", "min": 1.5},
        {"kind": "open", "value": "false"},
        {"kind": "any", "clauses": V1["and"]},
        {"kind": "constraint", "constraint": "c2", "state": "violating"},
    ],
)
def test_unsupported_qualifiers_are_not_silently_discarded(world, clause):
    obj = {"and": [clause]}
    url = endpoint(world) + f"/runs/{world['run']}/gates"
    for r in (
        world["client"].get(url, params=params(obj)),
        world["client"].post(
            url + "/readiness", params=params(obj), json={"status": "waived", "note": "Review", "author": "Reviewer"}
        ),
    ):
        assert r.status_code == 422 and r.json()["code"] == "review.filter_unsupported"
    draft = proposal(world, filter=obj)
    assert draft["evidenceContext"]["selectionState"] == "unavailable"
    assert draft["evidenceContext"]["populationCases"] is None
    assert draft["evidenceContext"]["filter"] == obj
    r = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert r.status_code == 409 and r.json()["code"] == "review.filtered_evidence_unavailable"


def test_empty_selection_cannot_be_waived_into_an_intervention(world):
    obj = {"and": [{"kind": "attribute", "field": "vendor", "in": ["absent vendor"]}]}
    url = endpoint(world) + f"/runs/{world['run']}/gates"
    assert world["client"].get(url, params=params(obj)).json()["code"] == "review.empty_selection"
    assert (
        world["client"]
        .post(url + "/domain", params=params(obj), json={"status": "waived", "note": "Review"})
        .status_code
        == 409
    )
    draft = proposal(world, filter=obj)
    assert draft["evidenceContext"]["selectionState"] == "unavailable"
    assert (
        world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"}).status_code == 409
    )


def test_measurement_change_invalidates_a_filtered_waiver(world, monkeypatch):
    waive(world)
    before = gates(world)
    original = world["container"].runs.review_selection

    def changed(*args, **kwargs):
        result = original(*args, **kwargs)
        result["caveats"] = [{"id": "replication", "share": 1.0, "status": "fail", "text": "Changed measured evidence"}]
        return result

    monkeypatch.setattr(world["container"].runs, "review_selection", changed)
    after = gates(world)
    assert before["selection"]["fingerprint"] == after["selection"]["fingerprint"]
    assert before["selection"]["decisionFingerprint"] != after["selection"]["decisionFingerprint"]
    assert next(g for g in after["gates"] if g["id"] == "replication")["status"] == "failed"


@pytest.mark.parametrize(
    ("clause", "expected"),
    [
        ({"kind": "activity", "op": "contains", "activity": "Record Invoice Receipt"}, 2),
        ({"kind": "attribute", "field": "vendor", "in": ["V2"]}, 1),
        ({"kind": "time", "field": "case_end", "to": "2024-01-20"}, 1),
        ({"kind": "count", "activity": "Record Goods Receipt", "min": 2}, 1),
        ({"kind": "lag", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "min": 10, "unit": "D"}, 1),
        ({"kind": "follows", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "directly": True}, 2),
    ],
)
def test_supported_filter_membership_matches_the_public_example(world, clause, expected):
    obj = {"and": [clause]}
    state = gates(world, obj)
    draft = proposal(world, filter=obj)
    assert state["cases"] == expected == draft["evidenceContext"]["populationCases"]
    assert state["selection"]["fingerprint"] == draft["evidenceContext"]["selectionFingerprint"]


def test_changed_selection_membership_cannot_authorise_saved_proposal(world, monkeypatch):
    waive(world)
    draft = proposal(world, filter=V1)
    original = world["container"].runs.review_selection

    def changed(*args, **kwargs):
        result = original(*args, **kwargs)
        result["selection"]["fingerprint"] = "different-membership"
        return result

    monkeypatch.setattr(world["container"].runs, "review_selection", changed)
    r = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert r.status_code == 409 and r.json()["code"] == "review.stale_evidence"


@pytest.mark.parametrize(
    "clause",
    [
        {"kind": []},
        {"kind": "time", "field": [], "from": "2024-01-01"},
        {"kind": "lag", "a": "A", "b": "B", "unit": {}, "min": 0},
    ],
)
def test_malformed_filter_values_have_a_visible_client_error(world, clause):
    url = endpoint(world) + f"/runs/{world['run']}/gates"
    assert world["client"].get(url, params=params({"and": [clause]})).status_code == 422


def test_absent_closure_rule_cannot_be_reported_as_zero_open(world, monkeypatch):
    runs = world["container"].runs
    original = runs.context

    def without_closure(run):
        ctx = original(run)
        return replace(ctx, mapping=replace(ctx.mapping, closure_activities=()))

    monkeypatch.setattr(runs, "context", without_closure)
    # This selection has no decisions left by an earlier test's explicit waiver.
    fresh = {"and": [*V1["and"], {"kind": "activity", "op": "contains", "activity": "Record Goods Receipt"}]}
    state = gates(world, fresh)
    censoring = next(g for g in state["gates"] if g["id"] == "censoring")
    assert censoring["evidence"]["share"] is None
    assert censoring["computed_status"] == "pending"
    for g in state["gates"]:
        if g["id"] == "censoring":
            continue
        r = world["client"].post(
            endpoint(world) + f"/runs/{world['run']}/gates/{g['id']}",
            params=params(fresh),
            json={"status": "waived", "note": "Other checks reviewed", "author": "Reviewer"},
        )
        assert r.status_code == 200, r.text
    draft = proposal(world, filter=fresh)
    refused = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert refused.status_code == 409 and refused.json()["code"] == "review.gate_unresolved"


def test_zero_placeholder_dates_are_explicitly_measured_as_pass(world, dependency_profile):
    state = gates(world)
    check = next(g for g in state["gates"] if g["id"] == "readiness")
    if dependency_profile == "minimal":
        assert check["computed_status"] == "pending"
    else:
        rows = check["evidence"]["groupChecks"]
        sentinel = next(r for r in rows if r.get("caveat", r.get("id")) == "sentinel_dates")
        assert sentinel["share"] == 0.0 and sentinel["status"] == "pass"
