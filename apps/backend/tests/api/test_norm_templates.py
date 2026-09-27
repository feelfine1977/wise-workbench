"""Norm-only templates use isolated tables, preserve all rules and require fresh numeric decisions."""

from __future__ import annotations

import json
from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from typing import Any

import pytest
import wise
from fastapi.testclient import TestClient

from tests.api.test_norm_signals import create_table, norm_document, save_norm
from tests.conftest import make_settings
from wise_workbench.adapters.knowledge import template_path
from wise_workbench.api.app import create_app, openapi_document
from wise_workbench.domain import CaseTableStatus, thresholds_of


@pytest.fixture
def world(tmp_path: Path) -> Iterator[tuple[TestClient, str, str, str, Path]]:
    source = tmp_path / "standalone.json"
    document = norm_document()
    document["metadata"] = {
        "meta": {"calibration": "calibrated"},
        "calibration": {"elapsed": {"owner": "Original owner", "rationale": "Another dataset"}},
        "authoring": {"goal": "Source brief"},
    }
    source.write_text(json.dumps(document), encoding="utf-8")
    settings = make_settings(
        tmp_path,
        database_url=f"sqlite:///{tmp_path / 'templates.db'}",
        inprocess_worker=True,
        analytics_auto=False,
        bpic19_csv=tmp_path / "missing.csv",
        bpic19_norm=source,
        preset_data_dirs=(),
    )
    with TestClient(create_app(settings)) as client:
        pid = client.post("/api/v1/projects", json={"name": "Synthetic templates", "process": "p2p"}).json()["id"]
        base = f"/api/v1/projects/{pid}"
        table = create_table(client, pid)
        yield client, pid, base, table, source


def catalogue(client: TestClient, base: str, table: str, **params: Any) -> dict[str, Any]:
    response = client.get(base + "/norms/templates", params={"caseTableId": table, **params})
    assert response.status_code == 200, response.text
    return response.json()


def snapshot(client: TestClient, base: str) -> tuple:
    return tuple(
        client.get(path).json()
        for path in (
            base + "/norms",
            base + "/datasets",
            base + "/dataset-binding",
            base + "/runs",
            "/api/v1/jobs",
        )
    )


def test_pack_and_standalone_norm_sources_are_available_without_their_logs_and_preview_never_writes(
    world: tuple,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, pid, base, table, source = world
    c = client.app.state.container
    before = snapshot(client, base)
    files = {
        p: sha256(p.read_bytes()).hexdigest() for p in c.workspace.case_table_dir(pid, table).rglob("*") if p.is_file()
    }
    source_bytes = source.read_bytes()

    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("template preview must not score, create norms, update validation or enqueue jobs")

    monkeypatch.setattr(wise, "evaluate_constraint", forbidden)
    monkeypatch.setattr(c.norms, "create_version", forbidden)
    monkeypatch.setattr(c.repos, "update_norm_validation", forbidden)
    monkeypatch.setattr(c.queue, "enqueue", forbidden)
    monkeypatch.setattr(c.engine, "norm_relevance", forbidden)
    monkeypatch.setattr(c.norms, "inventory", forbidden)
    body = catalogue(client, base, table)
    assert body["process"] == "p2p" and body["caseTableId"] == table
    entries = {entry["id"]: entry for entry in body["templates"]}
    assert {"p2p_bpic19", "p2p_bpic19_v1_1", "p2p_baseline", "preset:bpic2019"} <= entries.keys()
    assert "o2c_baseline" not in entries
    assert all(entry["available"] for entry in entries.values()), entries
    assert all(entry["norm"] is None and entry["constraints"] == [] for entry in entries.values())
    assert catalogue(client, base, table, labelPack="bpic2019")["templateId"] is None
    assert snapshot(client, base) == before
    assert {p: sha256(p.read_bytes()).hexdigest() for p in files} == files
    assert source.read_bytes() == source_bytes


def test_template_creation_is_an_independent_root_with_numeric_decisions_pending(world: tuple) -> None:
    client, _pid, base, table, _source = world
    existing = save_norm(client, base, norm_document())
    before = snapshot(client, base)
    entry = next(
        item
        for item in catalogue(client, base, table, templateId="preset:bpic2019")["templates"]
        if item["id"] == "preset:bpic2019"
    )
    document = entry["norm"]
    assert entry["pendingConstraintIds"] == ["elapsed"]
    assert "calibration" not in document["metadata"]
    assert document["metadata"]["calibration_pending"] == ["elapsed"]
    assert document["metadata"]["template_import"]["caseTableId"] == table
    saved = save_norm(client, base, document)
    assert saved["parentId"] is None and saved["version"] == 1 and saved["status"] == "draft"
    assert saved["normId"] != existing["normId"]
    assert saved["norm"]["metadata"]["authoring"] == {"goal": "Source brief"}
    state = client.get(base + f"/norms/{saved['id']}/calibration").json()
    assert state["missingRationale"] == ["elapsed"] and not state["canLeaveDraft"]
    refused = client.patch(base + f"/norms/{saved['id']}", json={"status": "approved", "author": "Reviewer"})
    assert refused.status_code == 422 and refused.json()["code"] == "norm.rationale_required"
    assert client.get(base + f"/norms/{existing['id']}").json() == existing
    # Norm creation is the sole persisted change: binding, datasets, jobs and runs are identical.
    assert snapshot(client, base)[1:] == before[1:]


def test_actual_pack_templates_keep_all_rules_scopes_and_weights_even_when_unsupported(world: tuple) -> None:
    client, _pid, base, table, _source = world
    entry = next(
        item
        for item in catalogue(client, base, table, templateId="p2p_bpic19")["templates"]
        if item["id"] == "p2p_bpic19"
    )
    original = wise.Norm.from_dict(json.loads(template_path("p2p", "p2p_bpic19").read_text())).to_dict()
    for key in ("constraints", "layers", "views", "derived_attributes"):
        assert entry["norm"].get(key) == original.get(key)
    assert set(entry["pendingConstraintIds"]) == set(thresholds_of(entry["norm"]))
    assert entry["constraints"] and all(row["priority"] == "low" for row in entry["constraints"])
    assert any(row["missingActivities"] for row in entry["constraints"])
    assert "not_applicable" not in entry["norm"]["metadata"]


def test_readable_rules_precede_unobserved_rules_without_changing_rule_weights(world: tuple) -> None:
    client, _pid, base, table, source = world
    document = norm_document()
    absent = deepcopy(document["constraints"][0])
    absent.update(id="absent", params={**absent["params"], "b": ["Payment absent"]})
    document["constraints"].insert(0, absent)
    source.write_text(json.dumps(document))
    entry = next(
        item
        for item in catalogue(client, base, table, templateId="preset:bpic2019")["templates"]
        if item["id"] == "preset:bpic2019"
    )
    assert entry["norm"]["constraints"][0]["id"] == "absent"
    assert entry["constraints"][-1]["id"] == "absent"
    assert entry["constraints"][-1]["priority"] == "low"
    assert entry["constraints"][-1]["casesInScope"] == 4
    assert entry["constraints"][-1]["observedCases"] == 4
    assert entry["constraints"][-1]["missingActivities"] == ["Payment absent"]


def test_legacy_unbound_project_previews_and_creates_without_binding_it(world: tuple) -> None:
    client, pid, base, table, _source = world
    path = client.app.state.container.workspace.project_dir(pid) / "dataset-binding.json"
    path.unlink()
    before = snapshot(client, base)
    body = catalogue(client, base, table, templateId="preset:bpic2019")
    document = next(item["norm"] for item in body["templates"] if item["id"] == "preset:bpic2019")
    saved = save_norm(client, base, document)
    assert saved["status"] == "draft"
    assert not path.exists()
    assert snapshot(client, base)[1:] == before[1:]


def test_bound_mismatch_foreign_table_not_ready_and_unknown_mapping_are_rejected(world: tuple) -> None:
    client, pid, base, table, _source = world
    c = client.app.state.container
    original = c.mappings.get_case_table(pid, table)
    c.repos.add_dataset(replace(c.repos.get_dataset(original.dataset_id), id="other-dataset"))
    c.repos.add_case_table(replace(original, id="ct-mismatch", dataset_id="other-dataset"))
    response = client.get(base + "/norms/templates", params={"caseTableId": "ct-mismatch"})
    assert response.status_code == 409 and response.json()["code"] == "project.dataset_binding_mismatch"
    c.repos.add_case_table(replace(original, id="ct-building", status=CaseTableStatus.BUILDING))
    response = client.get(base + "/norms/templates", params={"caseTableId": "ct-building"})
    assert response.status_code == 422 and response.json()["code"] == "case_table.not_ready"
    other = client.post("/api/v1/projects", json={"name": "Other", "process": "o2c"}).json()["id"]
    assert client.get(f"/api/v1/projects/{other}/norms/templates", params={"caseTableId": table}).status_code == 404
    response = client.get(base + "/norms/templates", params={"caseTableId": table, "labelPack": "made-up"})
    assert response.status_code == 422 and response.json()["code"] == "norm.template_label_pack"


def test_curated_translation_is_explicit_and_unresolved_canonical_labels_remain(world: tuple) -> None:
    client, pid, base, table, _source = world
    pid = client.post("/api/v1/projects", json={"name": "Synthetic sales", "process": "o2c"}).json()["id"]
    base = f"/api/v1/projects/{pid}"
    table = create_table(client, pid)
    native = catalogue(client, base, table, templateId="o2c_baseline")
    assert [entry["id"] for entry in native["templates"]] == ["o2c_baseline"]
    assert native["labelPack"] is None
    original = native["templates"][0]["norm"]
    assert "o2c.goods_issue" in json.dumps(original["constraints"])
    translated = catalogue(client, base, table, templateId="o2c_baseline", labelPack="hackathon_sales")
    entry = translated["templates"][0]
    assert "Goods issue" in json.dumps(entry["norm"]["constraints"])
    assert entry["norm"]["metadata"]["template_import"]["binding"] == "explicit_curated_labels"
    assert entry["norm"]["metadata"]["template_import"]["labelPack"] == "hackathon_sales"
    assert any("No curated label for:" in warning for warning in entry["warnings"])
    assert any(row["missingActivities"] for row in entry["constraints"])
    assert catalogue(client, base, table, templateId="o2c_baseline")["templates"][0]["norm"] == original


def test_unreadable_or_missing_template_is_reported_without_hiding_other_sources(world: tuple) -> None:
    client, _pid, base, table, source = world
    source.write_text("not JSON")
    body = catalogue(client, base, table, templateId="preset:bpic2019")
    configured = next(item for item in body["templates"] if item["id"] == "preset:bpic2019")
    assert not configured["available"] and configured["norm"] is None
    assert any(item["available"] for item in body["templates"])
    source.unlink()
    configured = next(
        item
        for item in catalogue(client, base, table, templateId="preset:bpic2019")["templates"]
        if item["id"] == "preset:bpic2019"
    )
    assert configured["reason"] == "The configured norm document is unavailable."


def test_template_endpoint_has_a_concrete_openapi_contract() -> None:
    doc = openapi_document()
    operation = doc["paths"]["/projects/{projectId}/norms/templates"]["get"]
    assert operation["operationId"] == "getNormTemplates"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/NormTemplateCatalogue"
    )


def test_only_the_requested_template_reads_current_data(world: tuple, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _pid, base, table, _source = world
    engine = client.app.state.container.engine
    original = engine.norm_relevance
    calls = []

    def record(*args):
        calls.append(args[2])
        return original(*args)

    monkeypatch.setattr(engine, "norm_relevance", record)
    body = catalogue(client, base, table, templateId="preset:bpic2019")
    assert len(calls) == 1
    assert body["templateId"] == "preset:bpic2019"
    selected = next(item for item in body["templates"] if item["id"] == body["templateId"])
    assert selected["norm"] == calls[0]
    assert selected["documentHash"] == sha256(json.dumps(selected["norm"], sort_keys=True).encode()).hexdigest()
    assert all(item["norm"] is None for item in body["templates"] if item["id"] != body["templateId"])
    assert (
        client.get(base + "/norms/templates", params={"caseTableId": table, "templateId": "o2c_baseline"}).status_code
        == 404
    )
    assert len(calls) == 1
