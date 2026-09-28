import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, upload_running_example
from wise_workbench.api.app import create_app


@pytest.fixture
def world(tmp_path):
    app = create_app(make_settings(tmp_path, inprocess_worker=True, analytics_auto=False))
    with TestClient(app) as client:
        ids = upload_running_example(client)
        url = f"/api/v1/projects/{ids['project']}/case-tables/{ids['caseTable']}/grouping-suggestions"
        body = {"normVersionId": ids["norm"], "views": ["Finance", "General"], "minCases": 2}
        yield client, ids, url, body


def test_current_table_without_any_run_and_evidence_identity(world):
    client, ids, url, body = world
    assert client.get(f"/api/v1/projects/{ids['project']}/runs").json() == []
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    evidence = result["evidence"]
    assert evidence["cases"] == 5
    assert evidence["normVersionId"] == ids["norm"] and evidence["caseTableId"] == ids["caseTable"]
    assert evidence["datasetId"] == ids["dataset"]
    assert evidence["kind"] == "pre_scoring_context_support"
    from wise_workbench.adapters.engine.norms import _norm_from
    from wise_workbench.domain.norm_views import with_general_benchmark

    norm = client.app.state.container.norms.get(ids["project"], ids["norm"])
    assert evidence["effectiveNormFingerprint"] == _norm_from(with_general_benchmark(norm.document)).fingerprint()
    assert len(evidence["source"]["casesChecksum"]) == len(evidence["fingerprint"]) == 64
    assert result == client.post(url, json=body).json()
    changed = client.post(url, json={**body, "minCases": 5}).json()
    assert evidence["fingerprint"] != changed["evidence"]["fingerprint"]
    assert all(s["belowMinCases"] == s["groups"] for s in changed["suggestions"])


def test_saved_cohort_and_flow_intersection_and_stale_source(world):
    client, ids, url, body = world
    base = url.rsplit("/", 1)[0]
    categories = client.get(base + "/eda", params={"datasetId": ids["dataset"], "attribute": "company"}).json()[
        "categories"
    ]
    company_a_key = next(row["key"] for row in categories if row["value"] == "A")
    saved = client.post(
        base + "/selections",
        json={
            "name": "Company A",
            "datasetId": ids["dataset"],
            "attribute": "company",
            "selection": {"categoryKeys": [company_a_key]},
        },
    )
    assert saved.status_code == 201, saved.text
    selection = saved.json()
    only_saved = client.post(url, json={**body, "scope": {"selection_id": selection["id"]}})
    assert only_saved.status_code == 200, only_saved.text
    assert only_saved.json()["evidence"]["cases"] == selection["cases"] == 2
    empty_intersection = client.post(
        url, json={**body, "scope": {"selection_id": selection["id"], "attribute": "company", "value": "B"}}
    )
    assert empty_intersection.status_code == 422, empty_intersection.text
    scope = {"selection_id": selection["id"], "attribute": "company", "value": "A"}
    response = client.post(url, json={**body, "scope": scope})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["evidence"]["cases"] == 2
    assert result["evidence"]["scope"]["selection_id"] == selection["id"]
    assert result["evidence"]["selectionChecksum"] == selection["membershipChecksum"]
    assert not any(p["name"] == "company" for p in result["attributes"])
    assert client.post(url, json={**body, "scope": {**scope, "value": "absent"}}).status_code == 422
    directory = client.app.state.container.workspace.case_table_dir(ids["project"], ids["caseTable"])
    path = directory / "cases.parquet"
    frame = pd.read_parquet(path)
    frame["company"] = "changed"
    frame.to_parquet(path)
    stale = client.post(url, json={**body, "scope": scope})
    assert stale.status_code == 409, stale.text
    fresh = client.post(url, json=body)
    assert fresh.status_code == 200
    assert fresh.json()["evidence"]["source"]["casesChecksum"] != result["evidence"]["source"]["casesChecksum"]


def test_rejects_invalid_focus_scope_views_and_foreign_project(world):
    client, ids, url, body = world
    for patch in [
        {"views": []},
        {"views": ["not-a-view"]},
        {"focusConstraint": "absent"},
        {"scope": {"attribute": "company"}},
        {"minCases": 0},
        {"limit": 51},
    ]:
        response = client.post(url, json={**body, **patch})
        assert response.status_code == 422, response.text
    foreign = client.post("/api/v1/projects", json={"name": "Foreign"}).json()["id"]
    assert client.post(url.replace(ids["project"], foreign), json=body).status_code in (404, 409)


def test_requires_fixed_dataset_and_rejects_another_preparation(world):
    from dataclasses import replace

    from wise_workbench.domain.dataset import DatasetStatus, DatasetVersion

    client, ids, url, body = world
    c = client.app.state.container
    table = c.mappings.get_case_table(ids["project"], ids["caseTable"])
    c.repos.add_dataset(DatasetVersion(id="other", project_id=ids["project"], name="Other", status=DatasetStatus.READY))
    c.repos.add_case_table(replace(table, id="other-table", dataset_id="other"))
    response = client.post(url.replace(ids["caseTable"], "other-table"), json=body)
    assert response.status_code == 409, response.text
    binding = c.workspace.project_dir(ids["project"]) / "dataset-binding.json"
    binding.unlink()
    response = client.post(url, json=body)
    assert response.status_code == 409, response.text


def test_registered_openapi_exposes_request_response_and_problem_contract(world):
    client, _, _, _ = world
    document = client.app.openapi()
    operation = document["paths"]["/api/v1/projects/{projectId}/case-tables/{caseTableId}/grouping-suggestions"]["post"]
    assert operation["operationId"] == "suggestGroupings"
    assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/GroupingSuggestionsRequest"
    )
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/GroupingSuggestionsResponse"
    )
    for status in ("404", "409", "422"):
        assert operation["responses"][status]["content"]["application/json"]["schema"]["$ref"].endswith("/Problem")
