"""Public example: saving a proposal never silently grants permission to act."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, run_running_example, upload_running_example
from wise_workbench.api.app import create_app
from wise_workbench.domain import ConflictError, ReviewItem, ReviewKind
from wise_workbench.ids import new_id


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory):
    settings = make_settings(tmp_path_factory.mktemp("action-evidence"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        ids = upload_running_example(client)
        rid = run_running_example(client, ids)
        yield {"client": client, "ids": ids, "run": rid, "settings": settings, "container": client.app.state.container}


def scope(w: dict[str, Any], *, view: str = "Finance") -> dict[str, Any]:
    return {"runId": w["run"], "slicing": "company", "sliceKey": '["A"]', "view": view}


def endpoint(w: dict[str, Any]) -> str:
    return f"/api/v1/projects/{w['ids']['project']}"


def proposal(w: dict[str, Any], **extra: Any) -> dict[str, Any]:
    r = w["client"].post(
        endpoint(w) + "/actions",
        json={"title": "Investigate invoice delay", "owner_role": "Process owner", **scope(w), **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


def decide_all(w: dict[str, Any], *, view: str = "Finance", status: str = "waived") -> None:
    for gate in ["readiness", "censoring", "replication", "domain"]:
        r = w["client"].post(
            endpoint(w) + f"/runs/{w['run']}/gates/{gate}",
            params={"slicing": "company", "key": '["A"]', "view": view},
            json={"status": status, "note": "Synthetic decision for this exact assessment", "author": "Reviewer"},
        )
        assert r.status_code == 200, r.text


def test_unassessed_draft_is_saved_but_every_commitment_path_refuses(world):
    c, url = world["client"], endpoint(world) + "/actions"
    for state in ("agreed", "in_progress", "done"):
        refused = c.post(url, json={"title": "Investigate", "status": state})
        assert refused.status_code == 409 and refused.json()["code"] == "review.context_required"
    draft = c.post(url, json={"title": "Investigate", "note": "Evidence still needed"}).json()
    assert draft["evidenceContext"] is None and draft["evidenceState"] == "unassessed"
    for state in ("agreed", "in_progress", "done"):
        refused = c.patch(url + "/" + draft["id"], json={"status": state})
        assert refused.status_code == 409 and refused.json()["code"] == "review.context_required"
    saved = next(x for x in c.get(url).json() if x["id"] == draft["id"])
    assert saved == draft
    assert c.patch(url + "/" + draft["id"], json={"status": "dropped"}).status_code == 200


def test_pending_and_failed_gates_block_create_and_update_but_allow_proposals(world):
    c, url = world["client"], endpoint(world) + "/actions"
    for status in ("pending", "failed"):
        decide_all(world, status=status)
        draft = proposal(world)
        for target in ("agreed", "in_progress", "done"):
            created = c.post(url, json={"title": "Commit now", "owner_role": "Owner", **scope(world), "status": target})
            updated = c.patch(url + "/" + draft["id"], json={"status": target})
            assert created.status_code == updated.status_code == 409
            assert created.json()["code"] == updated.json()["code"] == "review.gate_unresolved"
    decide_all(world)
    accepted = c.patch(url + "/" + draft["id"], json={"status": "agreed"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["evidenceContext"] == draft["evidenceContext"]
    assert all(g["status"] in ("passed", "waived") for g in accepted.json()["commitmentCheck"]["gates"])
    direct = proposal(world, status="agreed")
    assert direct["status"] == "agreed"


def test_waiver_for_one_perspective_cannot_authorise_another(world):
    decide_all(world, view="Finance", status="waived")
    decide_all(world, view="Logistics", status="failed")
    finance = proposal(world, view="Finance", status="agreed")
    assert finance["view"] == "Finance"
    logistics = proposal(world, view="Logistics")
    r = world["client"].patch(endpoint(world) + "/actions/" + logistics["id"], json={"status": "agreed"})
    assert r.status_code == 409 and r.json()["code"] == "review.gate_unresolved"


def test_filtered_proposal_keeps_filter_and_cannot_borrow_whole_group_waivers(world):
    decide_all(world)
    clause = {"kind": "activity", "activity": "Record Invoice Receipt", "op": "contains"}
    draft = proposal(world, filter={"and": [clause, clause]})
    context = draft["evidenceContext"]
    assert context["filter"] == {"and": [clause]} and context["populationCases"] == 2
    assert context["selectionState"] == "measured"
    r = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert r.status_code == 409 and r.json()["code"] == "review.gate_unresolved"
    # Clear filters in the browser or create another proposal; the saved one is unchanged.
    proposal(world, filter={"and": []})
    read = next(x for x in world["client"].get(endpoint(world) + "/actions").json() if x["id"] == draft["id"])
    assert read["evidenceContext"] == context


def test_scoped_evidence_survives_a_fresh_application_and_requires_owner(world):
    draft = proposal(world, owner_role="")
    with TestClient(create_app(world["settings"].model_copy(update={"inprocess_worker": False}))) as client:
        row = next(x for x in client.get(endpoint(world) + "/actions").json() if x["id"] == draft["id"])
        assert row == draft
        refused = client.patch(endpoint(world) + "/actions/" + row["id"], json={"status": "agreed"})
        assert refused.status_code == 409 and refused.json()["code"] == "review.owner_required"


@pytest.mark.parametrize(
    "replacement",
    [
        {"view": "Logistics"},
        {"runId": "missing"},
        {"evidenceContext": {}},
        {"projectId": "other"},
        {"id": "other"},
        {"filter": None},
        {"kind": "finding"},
    ],
)
def test_patch_cannot_replace_saved_identity_or_evidence(world, replacement):
    draft = proposal(world)
    r = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json=replacement)
    assert r.status_code == 422 and r.json()["code"] == "review.immutable_context"


def test_client_cannot_supply_a_trusted_context(world):
    r = world["client"].post(
        endpoint(world) + "/actions", json={"title": "Forged", "evidenceContext": {"runId": world["run"]}}
    )
    assert r.status_code == 422 and r.json()["code"] == "review.immutable_context"


def test_legacy_unscoped_record_remains_readable_and_cannot_be_committed(world):
    item = ReviewItem(
        id=new_id("act"),
        project_id=world["ids"]["project"],
        kind=ReviewKind.ACTION,
        title="Legacy",
        body={"status": "proposed"},
        status="proposed",
        run_id=world["run"],
    )
    world["container"].repos.add_review_item(item)
    url = endpoint(world) + "/actions"
    assert any(x["id"] == item.id for x in world["client"].get(url).json())
    assert world["client"].patch(url + "/" + item.id, json={"note": "Needs re-assessment"}).status_code == 200
    assert (
        world["client"].patch(url + "/" + item.id, json={"status": "agreed"}).json()["code"]
        == "review.context_required"
    )


def test_missing_run_and_missing_scope_are_explicit_refusals(world):
    c, url = world["client"], endpoint(world) + "/actions"
    for body, code in [
        ({"runId": "missing"}, "review.context_required"),
        ({**scope(world), "runId": "missing"}, "review.evidence_unavailable"),
        ({**scope(world), "view": "Unknown"}, "review.evidence_unavailable"),
    ]:
        r = c.post(url, json={"title": "Proposal", **body})
        assert r.status_code == 409 and r.json()["code"] == code


def test_stale_norm_or_run_manifest_refuses_new_commitment(world, monkeypatch):
    c, repos = world["client"], world["container"].repos
    draft = proposal(world)
    norm = repos.get_norm_version(world["ids"]["norm"])
    original = repos.get_norm_version
    with monkeypatch.context() as patch:
        patch.setattr(
            repos,
            "get_norm_version",
            lambda version_id: replace(norm, fingerprint="changed") if version_id == norm.id else original(version_id),
        )
        r = c.patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
        assert r.status_code == 409
    run = repos.get_run(world["run"])
    try:
        repos.update_run(replace(run, manifest=replace(run.manifest, content_hash="changed")))
        r = c.patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
        assert r.status_code == 409 and r.json()["code"] == "review.stale_evidence"
    finally:
        repos.update_run(run)


def test_unavailable_gates_never_authorise_a_commitment(world, monkeypatch):
    draft = proposal(world)

    def unavailable(*args, **kwargs):
        raise ConflictError("Unavailable")

    monkeypatch.setattr(world["container"].review, "gates", unavailable)
    r = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert r.status_code == 409 and r.json()["code"] == "review.evidence_unavailable"


def test_result_file_changes_and_missing_files_block_even_with_warm_cache(world):
    draft = proposal(world)
    run = world["container"].repos.get_run(world["run"])
    path = world["container"].workspace.run_dir(world["ids"]["project"], world["run"]) / "frame.parquet"
    original = path.read_bytes()
    assert run.manifest.artefacts["frame.parquet"]["sha256"]
    try:
        path.write_bytes(original + b"changed")
        refused = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
        assert refused.status_code == 409 and refused.json()["code"] == "review.stale_evidence"
        path.unlink()
        refused = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
        assert refused.status_code == 409 and refused.json()["code"] == "review.evidence_unavailable"
    finally:
        path.write_bytes(original)


def test_generic_patch_cannot_bypass_the_gate_decision_route(world):
    decide_all(world, status="failed")
    item = world["container"].repos.list_review_items(world["ids"]["project"], kind="gate", run_id=world["run"])[0]
    refused = world["client"].patch(endpoint(world) + "/actions/" + item.id, json={"status": "waived"})
    assert refused.status_code == 422 and refused.json()["code"] == "gate.decision_required"
    assert world["container"].repos.get_review_item(item.id) == item


def test_old_group_waiver_does_not_apply_to_a_changed_manifest(world):
    decide_all(world)
    repos = world["container"].repos
    run = repos.get_run(world["run"])
    try:
        repos.update_run(replace(run, manifest=replace(run.manifest, finished_at="2026-09-11T12:00:00Z")))
        gates = (
            world["client"]
            .get(
                endpoint(world) + f"/runs/{world['run']}/gates",
                params={"slicing": "company", "key": '["A"]', "view": "Finance"},
            )
            .json()
        )
        assert all(g["status"] == g["computed_status"] and g["note"] is None for g in gates["gates"])
    finally:
        repos.update_run(run)


def test_scenario_cannot_be_used_as_observed_evidence(world, monkeypatch):
    repos = world["container"].repos
    run = repos.get_run(world["run"])
    original = repos.get_run
    scenario = replace(run, params=replace(run.params, scenario="Hypothetical target"))
    monkeypatch.setattr(repos, "get_run", lambda run_id: scenario if run_id == run.id else original(run_id))
    draft = proposal(world)
    assert draft["evidenceContext"]["scenario"] == "Hypothetical target"
    refused = world["client"].patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
    assert refused.status_code == 409 and refused.json()["code"] == "review.scenario_evidence"


def test_query_keeps_grouping_and_handles_equivalent_json_keys(world):
    draft = proposal(world, sliceKey='[ "A" ]')
    c = world["client"]
    url = endpoint(world) + "/actions"
    selected = c.get(url, params={"runId": world["run"], "slicing": "company", "key": '[ "A" ]'}).json()
    assert any(x["id"] == draft["id"] for x in selected)
    other_grouping = c.get(url, params={"runId": world["run"], "slicing": "vendor", "key": '[ "A" ]'}).json()
    assert all(x["id"] != draft["id"] for x in other_grouping)


@pytest.mark.parametrize("unsupported", ["within", "drillFrom", "drillKey", "bands"])
def test_unimplemented_drill_scope_is_refused_instead_of_recorded_as_the_whole_group(world, unsupported):
    r = world["client"].post(
        endpoint(world) + "/actions",
        json={"title": "Inspect selected subgroup", **scope(world), unsupported: "parent selection"},
    )
    assert r.status_code == 422 and r.json()["code"] == "review.immutable_context"


def test_missing_result_after_restart_is_a_visible_refusal(world):
    draft = proposal(world)
    path = world["container"].workspace.run_dir(world["ids"]["project"], world["run"]) / "frame.parquet"
    original = path.read_bytes()
    try:
        path.unlink()
        settings = world["settings"].model_copy(update={"inprocess_worker": False})
        with TestClient(create_app(settings)) as fresh:
            refused = fresh.patch(endpoint(world) + "/actions/" + draft["id"], json={"status": "agreed"})
            assert refused.status_code == 409 and refused.json()["code"] == "review.evidence_unavailable"
    finally:
        path.write_bytes(original)


@pytest.mark.parametrize("raw", ["{broken", {"and": [None]}, {"and": [{"kind": "open", "value": True}, {}]}])
def test_malformed_filter_is_not_silently_recorded_as_unfiltered(world, raw):
    r = world["client"].post(endpoint(world) + "/actions", json={"title": "Inspect", **scope(world), "filter": raw})
    assert r.status_code == 422 and r.json()["code"].startswith("filter.")


def test_ui_filter_clauses_are_preserved_without_claiming_the_engine_evaluated_them(world):
    filter_value = {
        "and": [
            {
                "kind": "any",
                "clauses": [
                    {"kind": "constraint", "constraint": "c2", "state": "violating"},
                    {"kind": "slice", "slicing": "company", "key": ["A"]},
                ],
            }
        ]
    }
    saved = proposal(world, filter=filter_value)
    assert saved["evidenceContext"]["filter"] == filter_value
    assert saved["evidenceContext"]["populationCases"] is None
    refused = world["client"].patch(endpoint(world) + "/actions/" + saved["id"], json={"status": "agreed"})
    assert refused.status_code == 409 and refused.json()["code"] == "review.filtered_evidence_unavailable"


@pytest.mark.parametrize("owner", [[""], {}, 1, False])
def test_owner_role_cannot_be_an_arbitrary_json_value(world, owner):
    saved = proposal(world)
    refused = world["client"].patch(
        endpoint(world) + "/actions/" + saved["id"], json={"status": "agreed", "owner_role": owner}
    )
    assert refused.status_code == 422 and refused.json()["code"] == "action.owner_role"
    assert (
        next(item for item in world["client"].get(endpoint(world) + "/actions").json() if item["id"] == saved["id"])[
            "status"
        ]
        == "proposed"
    )


@pytest.mark.parametrize("whole_status", ["fail", "warn"])
def test_whole_log_problem_is_checked_even_when_the_groups_checks_pass(world, monkeypatch, whole_status):
    runs = world["container"].runs
    original_detail = runs.slice_detail

    def clean_group(*args, **kwargs):
        detail = dict(original_detail(*args, **kwargs))
        detail["analytics"] = {"available": True}
        detail["caveats"] = []
        return detail

    monkeypatch.setattr(runs, "slice_detail", clean_group)
    monkeypatch.setattr(
        runs,
        "readiness_report",
        lambda *args, **kwargs: {
            "status": whole_status,
            "logWideFailed": ["frequency_drift"] if whole_status == "fail" else [],
            "checks": [
                {"check": "censoring", "perGroup": "censoring", "status": "pass"},
                {"check": "frequency_drift", "status": whole_status, "perGroup": None},
            ],
        },
    )
    decide_all(world)
    # An explicit new unresolved decision avoids borrowing a waiver from another parameterised case.
    gate_url = endpoint(world) + f"/runs/{world['run']}/gates/run_readiness"
    params = {"slicing": "company", "key": '["A"]', "view": "Finance"}
    unresolved = world["client"].post(
        gate_url,
        params=params,
        json={"status": "failed" if whole_status == "fail" else "pending", "note": "Needs review"},
    )
    assert unresolved.status_code == 200
    group = [g for g in unresolved.json()["gates"] if g["scope"] == "group"]
    assert group and all(g["status"] in {"passed", "waived"} for g in group)
    saved = proposal(world)
    for create in (True, False):
        refused = (
            world["client"].post(
                endpoint(world) + "/actions",
                json={"title": "Act", "owner_role": "Owner", **scope(world), "status": "agreed"},
            )
            if create
            else world["client"].patch(endpoint(world) + "/actions/" + saved["id"], json={"status": "agreed"})
        )
        assert refused.status_code == 409 and "run_readiness" in refused.json()["detail"]
    waived = world["client"].post(
        gate_url, params=params, json={"status": "waived", "note": "Reviewed the log-wide issue", "author": "Reviewer"}
    )
    assert waived.status_code == 200
    accepted = world["client"].patch(endpoint(world) + "/actions/" + saved["id"], json={"status": "agreed"})
    assert accepted.status_code == 200, accepted.text
    other = world["client"].get(
        endpoint(world) + f"/runs/{world['run']}/gates", params={**params, "key": '["B"]', "view": "Logistics"}
    )
    assert next(g for g in other.json()["gates"] if g["id"] == "run_readiness")["status"] == "waived"
