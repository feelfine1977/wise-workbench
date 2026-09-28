"""Exact draft effects, scope integrity and immutable evidence."""

from copy import deepcopy
from hashlib import sha256

import pytest

from tests.api.test_norm_signals import world as world


def test_draft_preview_exact_counts_and_no_writes(world):
    client, pid, base, table, norm = world
    c = client.app.state.container
    directory = c.workspace.project_dir(pid)
    before = {p: sha256(p.read_bytes()).hexdigest() for p in directory.rglob("*") if p.is_file()}
    proposed = deepcopy(norm["norm"]["constraints"][0])
    proposed["params"]["delta"] = 12
    response = client.post(
        base + f"/norms/{norm['id']}/preview/elapsed", json={"caseTableId": table, "constraint": proposed}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    saved, draft = result["saved"], result["proposed"]
    assert saved["counts"]["violatingCases"] == 3
    assert draft["counts"]["violatingCases"] == 2
    assert draft["counts"]["populationCases"] == draft["counts"]["applicableCases"] == 4
    assert draft["counts"]["evaluatedCases"] == 4 and draft["counts"]["unknownCases"] == 0
    assert draft["counts"]["observedCases"] == 3 and draft["counts"]["missingSignalCases"] == 1
    assert draft["counts"]["violationShare"] == 0.5
    assert draft["distribution"]["stats"]["shareBeyondThreshold"] == pytest.approx(1 / 3)
    assert {p: sha256(p.read_bytes()).hexdigest() for p in before} == before
    assert client.get(base + "/runs").json() == []
    assert len(client.get(base + "/norms").json()) == 1


def test_saved_population_applies_to_relevance_signal_and_draft(world):
    client, pid, base, table, norm = world
    ct = client.app.state.container.mappings.get_case_table(pid, table)
    eda = client.get(base + f"/case-tables/{table}/eda", params={"datasetId": ct.dataset_id, "attribute": "group"})
    assert eda.status_code == 200, eda.text
    key = next(row["key"] for row in eda.json()["categories"] if row["value"] == "B")
    response = client.post(
        base + f"/case-tables/{table}/selections",
        json={
            "datasetId": ct.dataset_id,
            "attribute": "group",
            "name": "Group B",
            "selection": {"categoryKeys": [key]},
        },
    )
    assert response.status_code == 201, response.text
    selection = response.json()
    params = {"caseTableId": table, "selectionId": selection["id"]}
    relevance = client.get(base + f"/norms/{norm['id']}/relevance", params=params)
    assert relevance.status_code == 200, relevance.text
    assert relevance.json()["cases"] == 1
    assert relevance.json()["scope"]["membershipChecksum"] == selection["membershipChecksum"]
    signal = client.get(base + f"/norms/{norm['id']}/signals/elapsed", params=params).json()
    assert signal["stats"]["n"] == 1 and signal["stats"]["mean"] == 9
    proposed = deepcopy(norm["norm"]["constraints"][0])
    proposed["params"]["delta"] = 8
    result = client.post(base + f"/norms/{norm['id']}/preview/elapsed", json={**params, "constraint": proposed})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["scope"]["selectionId"] == selection["id"]
    assert data["saved"]["counts"]["violatingCases"] == 0
    assert data["proposed"]["counts"]["violatingCases"] == 1
    assert data["proposed"]["counts"]["populationCases"] == 1
    for url in ["relevance", "signals/elapsed"]:
        invalid = client.get(base + f"/norms/{norm['id']}/{url}", params={**params, "selectionId": "sel_missing"})
        assert invalid.status_code in (404, 422)
    assert client.get(base + f"/norms/{norm['id']}/relevance", params={"caseTableId": table}).json()["cases"] == 4


def test_proposed_applicability_empty_identity_and_invalid_rule(world):
    client, _pid, base, table, norm = world
    url = base + f"/norms/{norm['id']}/preview/elapsed"
    rule = deepcopy(norm["norm"]["constraints"][0])
    rule["applicability"] = {"attr": "group", "in": ["absent"]}
    response = client.post(url, json={"caseTableId": table, "constraint": rule})
    assert response.status_code == 200, response.text
    counts = response.json()["proposed"]["counts"]
    assert counts["populationCases"] == 4 and counts["applicableCases"] == counts["evaluatedCases"] == 0
    assert counts["violationShare"] is None and counts["meanPenalty"] is None
    rule["id"] = "another"
    assert client.post(url, json={"caseTableId": table, "constraint": rule}).status_code == 422
    rule["id"] = "elapsed"
    rule["params"]["delta"] = "not a number"
    assert client.post(url, json={"caseTableId": table, "constraint": rule}).status_code == 422
    assert client.get(base + f"/norms/{norm['id']}").json() == norm
