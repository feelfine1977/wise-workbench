"""Every exploration route must refuse qualifiers the shared evaluator cannot honour."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, run_running_example, upload_running_example
from wise_workbench.api.app import create_app


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(tmp_path_factory.mktemp("filter-validation"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        ids = upload_running_example(client)
        run = run_running_example(client, ids)
        yield client, f"/api/v1/projects/{ids['project']}/runs/{run}"


@pytest.mark.parametrize(
    "path,params",
    [
        ("/filters/preview", {}),
        ("/backlog", {"slicing": "company"}),
        ("/flow", {}),
        ("/signals/c2", {}),
        ("/facets", {"attribute": "company"}),
        ("/kpis", {}),
        ("/variants", {}),
    ],
)
@pytest.mark.parametrize(
    "clause,qualifier",
    [
        ({"kind": "follows", "a": "A", "b": "B", "never": "false"}, "never"),
        ({"kind": "lag", "a": "A", "b": "B", "min": 0, "directly": True}, "directly"),
        ({"kind": "time", "field": "active", "from": "2024-01-04", "to": "2024-01-06"}, "active"),
    ],
)
def test_unsupported_filter_is_an_explicit_422_on_every_exploration_surface(world, path, params, clause, qualifier):
    client, base = world
    response = client.get(base + path, params={**params, "filter": json.dumps({"and": [clause]})})
    assert response.status_code == 422, response.text
    problem = response.json()
    assert problem["code"] == "filter.unsupported", problem
    assert qualifier in problem["detail"], problem


@pytest.mark.parametrize(
    "path,params",
    [
        ("/filters/preview", {}),
        ("/backlog", {"slicing": "company"}),
        ("/flow", {}),
        ("/signals/c2", {}),
        ("/facets", {"attribute": "company"}),
        ("/kpis", {}),
        ("/variants", {}),
    ],
)
def test_explicit_empty_filter_never_becomes_an_unfiltered_request(world, path, params):
    client, base = world
    response = client.get(base + path, params={**params, "filter": ""})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "filter.json"


@pytest.mark.parametrize("directly", [False, True])
def test_absent_observed_relation_is_the_public_preview_complement(world, directly):
    client, base = world
    clause = {"kind": "follows", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "directly": directly}
    positive = client.get(base + "/filters/preview", params={"filter": json.dumps({"and": [clause]})})
    negative = client.get(
        base + "/filters/preview", params={"filter": json.dumps({"and": [{**clause, "never": True}]})}
    )
    assert positive.status_code == negative.status_code == 200
    assert positive.json()["cases_in"] > 0 and positive.json()["cases_out"] > 0
    assert positive.json()["cases_in"] == negative.json()["cases_out"]
    assert positive.json()["cases_out"] == negative.json()["cases_in"]


@pytest.mark.parametrize("path", ["/filters/preview", "/variants", "/investigation-questions"])
@pytest.mark.parametrize(
    "bounds",
    [
        {"from": "not-a-date"},
        {"from": {"date": "2024-01-01"}},
        {"from": ""},
        {"to": "2024-02-30"},
        {"from": "2024-01-03", "to": "2024-01-01"},
    ],
)
def test_malformed_time_filter_returns_a_validation_error_before_analysis(world, path, bounds):
    client, base = world
    response = client.get(base + path, params={"filter": json.dumps({"kind": "time", **bounds})})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "filter.time"
