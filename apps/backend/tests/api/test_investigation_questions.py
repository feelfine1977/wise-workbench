from __future__ import annotations

import json
from dataclasses import replace

import pytest

from tests.api.test_process_variants import world as world
from tests.conftest import wait_job
from wise_workbench.domain import RunStatus


def get(w, **params):
    return w["client"].get(f"{w['base']}/runs/{w['run']}/investigation-questions", params=params)


def metrics(question):
    return {m["id"]: m["value"] for m in question["metrics"]}


def test_typed_contract_discovery_defaults_and_inherited_drill_populations(world):
    inherited = {"and": [{"kind": "attribute", "field": "vendor", "eq": "V1"}]}
    response = get(world, filter=json.dumps(inherited), limit=2)
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["totalCases"] == 6 and out["selectedCases"] == 3
    assert out["filter"] == inherited and out["family"] == "overview"
    assert set(out["choices"]["activities"]["values"]) == {"A", "B", "C"}
    assert out["choices"]["activities"]["total"] == 3
    assert {q["family"] for q in out["questions"]} == {"repetition", "timing", "boundaries"}
    assert len(out["questions"]) <= 6
    for q in out["questions"]:
        if q["filter"] is None:
            assert any("drill links" in text for text in q["limitations"])
            continue
        assert q["filter"]["and"][:1] == inherited["and"]
        variants = (
            world["client"]
            .get(f"{world['base']}/runs/{world['run']}/variants", params={"filter": json.dumps(q["filter"])})
            .json()
        )
        assert variants["totalSelectedCases"] == metrics(q)["affected_cases"]


@pytest.mark.parametrize(
    "params",
    [
        {"unrecognised": 1},
        {"source": "A"},
        {"family": "timing", "source": "A"},
        {"family": "sequence", "target": "B"},
        {"family": "identity", "activity": "A"},
        {"family": "repetition", "relation": "direct"},
        {"family": "nope"},
        {"family": "timing", "source": "A", "target": "B", "relation": "never"},
        {"family": "timing", "source": "A", "target": "B", "activity": "A"},
        {"family": "repetition", "activity": "missing"},
        {"limit": 0},
        {"limit": 51},
        {"filter": "{"},
        {"filter": '{"and":[{"kind":"follows","a":"A","b":"B","never":true,"unrecognised":true}]}'},
        {"filter": '{"and":[{"kind":"count","activity":"B","min":1.5}]}'},
    ],
)
def test_unknown_or_unsupported_parameters_are_rejected(world, params):
    response = get(world, **params)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("directly", [False, True])
def test_absent_observed_relation_selects_the_exact_inverse_population(world, directly):
    clause = {"kind": "follows", "a": "A", "b": "B", "directly": directly}
    positive_filter = {"and": [clause]}
    inverse_filter = {"and": [{**clause, "never": True}]}
    positive = get(world, family="missingness", filter=json.dumps(positive_filter))
    inverse = get(world, family="missingness", filter=json.dumps(inverse_filter))
    assert positive.status_code == inverse.status_code == 200
    observed, absent = positive.json(), inverse.json()
    # c1/c2 = ABBAC, c3 = ABABC, c5 = ABC; only c4/c6 = AC lack A→B.
    assert observed["totalCases"] == absent["totalCases"] == 6
    assert observed["selectedCases"] == 4 and absent["selectedCases"] == 2
    assert observed["selectedCases"] + absent["selectedCases"] == absent["totalCases"]
    assert absent["filter"] == inverse_filter
    question = absent["questions"][0]
    assert metrics(question)["events"] == 4
    assert question["filter"] == inverse_filter
    drill = world["client"].get(
        f"{world['base']}/runs/{world['run']}/variants", params={"filter": json.dumps(question["filter"])}
    )
    assert drill.status_code == 200, drill.text
    assert drill.json()["totalSelectedCases"] == 2
    assert {case for variant in drill.json()["variants"] for case in variant["exampleCaseIds"]} == {"c4", "c6"}


def test_filter_empty_selection_identity_unavailable_and_exact_whole_selection(world):
    response = get(
        world, family="missingness", filter=json.dumps({"kind": "attribute", "field": "vendor", "eq": "absent"})
    )
    assert response.status_code == 200, response.text
    assert response.json()["selectedCases"] == 0
    assert metrics(response.json()["questions"][0])["events"] == 0
    q = get(world, family="identity").json()["questions"][0]
    assert q["status"] == "unavailable" and q["filter"] == {"and": []}
    assert metrics(q)["known_identity_events"] is None
    q = get(world, family="sequence", source="C", target="A", relation="eventual").json()["questions"][0]
    assert q["filter"] is None and metrics(q)["pairs"] == 0


def test_scoped_and_transformed_runs_use_actual_events_including_open_filters(world):
    client = world["client"]
    container = client.app.state.container
    original = container.repos.get_run(world["run"])
    scoped, job, _ = container.runs.create(
        original.project_id, replace(original.params, scope={"attribute": "company", "value": "X"}), force=True
    )
    assert wait_job(client, job.id)["status"] == "done"
    out = get({**world, "run": scoped.id}).json()
    assert out["totalCases"] == out["selectedCases"] == 5
    before = get({**world, "run": scoped.id}, family="repetition", activity="B").json()
    assert metrics(before["questions"][0])["affected_cases"] == 3
    transformed, job, _ = container.runs.create(
        original.project_id, replace(scoped.params, transforms=({"kind": "keep_first", "activity": "B"},)), force=True
    )
    assert wait_job(client, job.id)["status"] == "done"
    after = get({**world, "run": transformed.id}, family="repetition", activity="B").json()
    assert metrics(after["questions"][0])["affected_cases"] == 0
    assert get({**world, "run": scoped.id}, family="repetition", activity="B").json() == before
    # All cases in this fixture have mapped closure C. An open filter selects zero.
    opened = get({**world, "run": transformed.id}, filter='{"kind":"open","value":true}')
    assert opened.status_code == 200 and opened.json()["selectedCases"] == 0
    # Prime the shared cache from the closed baseline, then remove closure events in a scenario.
    _, baseline_ctx = container.runs.ready(original.project_id, scoped.id)
    assert int(container.engine._censored(baseline_ctx).sum()) == 0
    no_closure, job, _ = container.runs.create(
        original.project_id,
        replace(
            scoped.params,
            transforms=(
                {
                    "kind": "delete_activity",
                    "activity": "C",
                    "where": {"kind": "attribute", "field": "vendor", "eq": "V2"},
                },
            ),
        ),
        force=True,
    )
    assert wait_job(client, job.id)["status"] == "done"
    params = {"filter": '{"kind":"open","value":true}', "family": "missingness"}
    opened = get({**world, "run": no_closure.id}, **params)
    assert opened.status_code == 200 and opened.json()["selectedCases"] == 3
    question = opened.json()["questions"][0]
    drill = client.get(
        f"{world['base']}/runs/{no_closure.id}/variants", params={"filter": json.dumps(question["filter"])}
    )
    assert drill.status_code == 200 and drill.json()["totalSelectedCases"] == 3
    assert int(container.engine._censored(baseline_ctx).sum()) == 0


def test_ready_and_project_guards(world):
    client = world["client"]
    other = client.post("/api/v1/projects", json={"name": "Other investigation project"}).json()["id"]
    response = client.get(f"/api/v1/projects/{other}/runs/{world['run']}/investigation-questions")
    assert response.status_code == 404
    repos = client.app.state.container.repos
    run = repos.get_run(world["run"])
    try:
        repos.update_run(replace(run, status=RunStatus.FAILED))
        assert get(world).status_code == 409
    finally:
        repos.update_run(run)


def test_read_only_analysis_does_not_write_artefacts_or_reuse_baseline_censoring(world, monkeypatch):
    container = world["client"].app.state.container
    run = container.repos.get_run(world["run"])
    ctx = container.runs.context(run)
    before = {p: (p.stat().st_mtime_ns, p.stat().st_size) for p in ctx.run_dir.rglob("*") if p.is_file()}

    def refuse(*args, **kwargs):
        raise AssertionError("read-only investigation attempted a write or a baseline censoring cache read")

    monkeypatch.setattr(container.workspace, "write_json", refuse)
    monkeypatch.setattr(container.queue, "enqueue", refuse)
    monkeypatch.setattr(container.engine, "_censored", refuse)
    for family in ("overview", "identity", "missingness"):
        response = get(world, family=family)
        assert response.status_code == 200, response.text
    after = {p: (p.stat().st_mtime_ns, p.stat().st_size) for p in ctx.run_dir.rglob("*") if p.is_file()}
    assert after == before
