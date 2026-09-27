"""Read-only dataset relevance is bound to an exact project, table and saved norm."""

from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
import wise
from fastapi.testclient import TestClient

from tests.api.test_norm_signals import create_table, norm_document, save_norm
from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app, openapi_document
from wise_workbench.domain import CaseTableStatus


@pytest.fixture
def world(tmp_path: Path) -> Iterator[tuple[TestClient, str, str, str, dict[str, Any]]]:
    app = create_app(make_settings(tmp_path, inprocess_worker=True, analytics_auto=False))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Synthetic norm relevance"}).json()["id"]
        base = f"/api/v1/projects/{pid}"
        table = create_table(client, pid)
        yield client, pid, base, table, save_norm(client, base, norm_document())


def relevance(client: TestClient, base: str, version: str, table: str) -> dict[str, Any]:
    response = client.get(base + f"/norms/{version}/relevance", params={"caseTableId": table})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["normVersionId"] == version and body["caseTableId"] == table
    return body


def forbidden(*args: object, **kwargs: object) -> None:
    pytest.fail("relevance must neither score nor persist validation")


def test_exact_saved_version_union_counts_and_no_writes(world: tuple, monkeypatch: pytest.MonkeyPatch) -> None:
    client, pid, base, table, first = world
    doc = deepcopy(first["norm"])
    doc["constraints"][0]["params"].update(a=["End"], b=["Close", "Raw absent label"])
    doc["constraints"][0]["applicability"] = {"attr": "group", "eq": "A"}
    # Preset metadata can retain this flag after translation. Stored raw rule labels are authoritative.
    doc.setdefault("metadata", {}).setdefault("meta", {})["activity_labels"] = "canonical_ids"
    second = save_norm(client, base, doc, parentId=first["id"])
    c = client.app.state.container
    snapshots = client.get(base + "/norms").json(), client.get("/api/v1/jobs").json(), client.get(base + "/runs").json()
    files = {
        p: sha256(p.read_bytes()).hexdigest() for p in c.workspace.case_table_dir(pid, table).rglob("*") if p.is_file()
    }
    monkeypatch.setattr(wise, "evaluate_constraint", forbidden)
    monkeypatch.setattr(c.repos, "update_norm_validation", forbidden)
    monkeypatch.setattr(c.engine, "check_norm", forbidden)
    original = relevance(client, base, first["id"], table)
    selected = relevance(client, base, second["id"], table)
    assert original["cases"] == selected["cases"] == 4
    assert original["constraints"][0] == {
        "id": "elapsed",
        "casesInScope": 4,
        "observedCases": 4,
        "missingActivities": [],
        "issues": [],
    }
    assert selected["constraints"][0] == {
        "id": "elapsed",
        "casesInScope": 3,
        "observedCases": 2,
        "missingActivities": ["Raw absent label"],
        "issues": [],
    }
    assert relevance(client, base, first["id"], table) == original
    assert (
        client.get(base + "/norms").json(),
        client.get("/api/v1/jobs").json(),
        client.get(base + "/runs").json(),
    ) == snapshots
    assert {p: sha256(p.read_bytes()).hexdigest() for p in files} == files


def test_version_derivations_do_not_pollute_cached_log_or_other_versions(world: tuple) -> None:
    client, pid, base, table, first = world
    doc = deepcopy(first["norm"])
    doc["derived_attributes"] = [{"name": "elapsed_days", "kind": "lag", "a": ["Start"], "b": ["End"], "unit": "D"}]
    doc["constraints"][0]["applicability"] = {"all": [{"attr": "elapsed_days", "lt": 12}, {"attr": "group", "eq": "A"}]}
    first_derived = save_norm(client, base, doc, parentId=first["id"])
    c = client.app.state.container
    saved_table = c.mappings.get_case_table(pid, table)
    mapping = c.repos.get_mapping(saved_table.mapping_id)
    cached = c.engine._load_log(c.workspace.case_table_dir(pid, table), mapping)
    cached.derive(doc["derived_attributes"], overwrite=False)
    before = cached.cases.copy(deep=True)
    doc["derived_attributes"][0]["b"] = ["Close"]
    second = save_norm(client, base, doc, parentId=first_derived["id"])
    assert relevance(client, base, first_derived["id"], table)["constraints"][0]["casesInScope"] == 1
    assert relevance(client, base, second["id"], table)["constraints"][0]["casesInScope"] == 2
    assert relevance(client, base, first_derived["id"], table)["constraints"][0]["casesInScope"] == 1
    pd.testing.assert_frame_equal(cached.cases, before)
    assert "elapsed_days" not in pd.read_parquet(c.workspace.case_table_dir(pid, table) / "events.parquet").columns
    assert client.get(base + f"/norms/{first_derived['id']}").json() == first_derived
    assert client.get(base + "/runs").json() == []


def test_scope_failures_are_nullable_rows_and_metric_activity_presence_is_unknown(world: tuple) -> None:
    client, _pid, base, table, first = world
    doc = deepcopy(first["norm"])
    doc["constraints"][0]["applicability"] = {"attr": "unknown_attribute", "eq": 1}
    doc["constraints"].append(
        {
            "id": "numeric",
            "layer": "time",
            "type": "metric",
            "params": {"attribute": "amount", "threshold": 10, "width": 1},
        }
    )
    saved = save_norm(client, base, doc, parentId=first["id"])
    rows = {r["id"]: r for r in relevance(client, base, saved["id"], table)["constraints"]}
    assert rows["elapsed"]["casesInScope"] is rows["elapsed"]["observedCases"] is None
    assert "unknown_attribute" in rows["elapsed"]["issues"][0]
    assert rows["start"]["casesInScope"] == rows["start"]["observedCases"] == 4
    assert rows["numeric"] == {
        "id": "numeric",
        "casesInScope": 4,
        "observedCases": None,
        "missingActivities": [],
        "issues": [],
    }
    assert client.get(base + f"/norms/{saved['id']}").json() == saved


def test_exact_project_table_binding_required_query_and_ready_state(
    world: tuple, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, pid, base, table, first = world
    other = client.post("/api/v1/projects", json={"name": "Other synthetic project"}).json()["id"]
    other_base = f"/api/v1/projects/{other}"
    foreign_table = create_table(client, other)
    foreign_norm = save_norm(client, other_base, norm_document())
    for version, selected_table, code in (
        (first["id"], foreign_table, "case_table.not_found"),
        (foreign_norm["id"], table, "norm.not_found"),
    ):
        response = client.get(base + f"/norms/{version}/relevance", params={"caseTableId": selected_table})
        assert response.status_code == 404 and response.json()["code"] == code
    url = base + f"/norms/{first['id']}/relevance"
    assert client.get(url).status_code == 422
    c = client.app.state.container
    actual = c.mappings.get_case_table(pid, table)
    monkeypatch.setattr(c.mappings, "get_case_table", lambda *_: replace(actual, status=CaseTableStatus.BUILDING))
    response = client.get(url, params={"caseTableId": table})
    assert response.status_code == 422 and response.json()["code"] == "case_table.not_ready"
    # Test the mapping/dataset relation without touching a stored table.
    mapping = c.repos.get_mapping(actual.mapping_id)
    monkeypatch.setattr(c.mappings, "get_case_table", lambda *_: actual)
    monkeypatch.setattr(c.repos, "get_mapping", lambda *_: replace(mapping, dataset_id="different-dataset"))
    response = client.get(url, params={"caseTableId": table})
    assert response.status_code == 422 and response.json()["code"] == "case_table.mapping_mismatch"


def test_schema_keeps_unknown_counts_explicitly_nullable() -> None:
    doc = openapi_document()
    endpoint = doc["paths"]["/projects/{projectId}/norms/{normVersionId}/relevance"]["get"]
    assert endpoint["operationId"] == "getNormRelevance"
    assert next(p for p in endpoint["parameters"] if p["name"] == "caseTableId")["required"]
    row = doc["components"]["schemas"]["NormRelevanceConstraint"]
    for field in ("casesInScope", "observedCases"):
        assert field in row["required"]
        assert {v["type"] for v in row["properties"][field]["anyOf"]} == {"integer", "null"}


def test_explicit_table_is_not_replaced_by_latest_ready_table(world: tuple) -> None:
    client, pid, base, first_table, norm = world
    c = client.app.state.container
    dataset = c.mappings.get_case_table(pid, first_table).dataset_id
    # A second interpretation of the same bound dataset has different activity labels.
    mapped = client.post(
        base + f"/datasets/{dataset}/mappings",
        json={"caseId": "case", "activity": "group", "timestamp": "time", "caseAttributes": ["amount"]},
    )
    assert mapped.status_code == 202, mapped.text
    second_table = wait_job(client, mapped.json()["id"])["resultRef"].split(":", 1)[1]
    first = relevance(client, base, norm["id"], first_table)
    second = relevance(client, base, norm["id"], second_table)
    assert first["cases"] == 4 and first["constraints"][0]["observedCases"] == 4
    assert second["cases"] == 4
    assert second["constraints"][0] == {
        "id": "elapsed",
        "casesInScope": 4,
        "observedCases": 0,
        "missingActivities": ["End", "Start"],
        "issues": [],
    }
    assert relevance(client, base, norm["id"], first_table) == first
