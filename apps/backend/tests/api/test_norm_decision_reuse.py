"""Saved norm decisions survive canonicalization and ancestry in a temporary API workspace."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import wise
from fastapi.testclient import TestClient

from wise_workbench.api.app import create_app
from wise_workbench.domain.norm_views import with_general_benchmark
from wise_workbench.settings import Settings

DECISIONS = {
    cid: {"rationale": f"Agreed definition of {cid}", "owner": f"{cid} owner"} for cid in ("lag", "metric", "balance")
}
AUTHORING = {
    "mode": "guided",
    "question": "Can we substantiate payment timeliness?",
    "answers": [{"businessApplicability": "applies", "evidence": "unknown", "value": None}],
    "extension": {"version": 1, "reviewed": False},
}


@pytest.fixture
def isolated_settings(tmp_path: Path) -> Settings:
    # Both storage destinations are explicit: WISE_* environment variables cannot select live data.
    return Settings(
        workspace=tmp_path / "workspace",
        database_url=f"sqlite:///{tmp_path / 'decisions.db'}",
        inprocess_worker=False,
        analytics_auto=False,
        log_level="WARNING",
    )


def seed(client: TestClient) -> tuple[str, dict[str, Any]]:
    created = client.post("/api/v1/projects", json={"name": "Synthetic decision reuse", "process": "p2p"})
    assert created.status_code == 201, created.text
    url = f"/api/v1/projects/{created.json()['id']}/norms"
    document = wise.Norm.from_dict(
        {
            "name": "Synthetic decisions",
            "layers": [{"id": "timing"}, {"id": "commercial"}],
            "views": [
                {"name": "Operations", "layer_weights": {"timing": 1, "commercial": 1}},
                {"name": "Direct", "constraint_weights": {"lag": 1, "metric": 1, "balance": 1}},
            ],
            "constraints": [
                {
                    "id": "lag",
                    "layer": "timing",
                    "type": "lag",
                    "params": {
                        "a": ["Order"],
                        "b": ["Invoice"],
                        "delta": 7,
                        "width": 3,
                        "missing_a": "skip",
                        "missing_b": "skip",
                    },
                },
                {
                    "id": "metric",
                    "layer": "commercial",
                    "type": "metric",
                    "params": {"attribute": "amount", "threshold": 100, "width": 20},
                },
                {
                    "id": "balance",
                    "layer": "commercial",
                    "type": "balance",
                    "params": {
                        "attr_x": "qty",
                        "activities_x": ["Receipt"],
                        "attr_y": "qty",
                        "activities_y": ["Invoice"],
                        "tau": 0.05,
                        "width": 0.1,
                    },
                },
            ],
            "metadata": {"authoring": deepcopy(AUTHORING)},
        }
    ).to_dict()
    response = client.post(url, json={"norm": document, "note": "Reviewed baseline", "calibration": DECISIONS})
    assert response.status_code == 201, response.text
    return url, response.json()


def save(
    client: TestClient, url: str, parent: dict[str, Any], document: dict[str, Any], **fields: Any
) -> dict[str, Any]:
    response = client.post(
        url, json={"norm": document, "parentId": parent["id"], "note": "Isolated regression", **fields}
    )
    assert response.status_code == 201, response.text
    return response.json()


def state(client: TestClient, url: str, version: dict[str, Any]) -> dict[str, Any]:
    response = client.get(f"{url}/{version['id']}/calibration")
    assert response.status_code == 200, response.text
    return response.json()


def assert_pending(client: TestClient, url: str, version: dict[str, Any], wanted: list[str]) -> None:
    calibration = state(client, url, version)
    assert calibration["missingRationale"] == wanted
    assert calibration["canLeaveDraft"] is (not wanted)
    if wanted:
        before = client.get(f"{url}/{version['id']}").json()
        refused = client.patch(f"{url}/{version['id']}", json={"status": "approved", "author": "Reviewer"})
        assert refused.status_code == 422, refused.text
        assert refused.json()["code"] == "norm.rationale_required"
        assert sorted(e["field"] for e in refused.json()["errors"]) == wanted
        assert client.get(f"{url}/{version['id']}").json() == before


def test_semantic_edits_carry_obligations_and_only_explicit_selected_decisions_clear_them(
    isolated_settings: Settings,
) -> None:
    with TestClient(create_app(isolated_settings)) as client:
        url, baseline = seed(client)
        document = deepcopy(baseline["norm"])
        document["constraints"][0]["params"]["unit"] = "H"
        document["constraints"][1]["params"]["direction"] = "low"
        document["constraints"][2]["params"]["tau"] = 0.07
        changed = save(client, url, baseline, document)
        assert_pending(client, url, changed, ["balance", "lag", "metric"])
        assert changed["norm"]["metadata"]["calibration"] == {}
        tau_row = next(r for r in state(client, url, changed)["thresholds"] if r["constraint_id"] == "balance")
        assert tau_row["threshold"]["tau"] == 0.07 and tau_row["changedHere"]

    # Restart proves pending decisions survive storage and engine canonicalization.
    with TestClient(create_app(isolated_settings)) as client:
        parent = client.get(f"{url}/{changed['id']}").json()
        for _ in range(2):
            document = deepcopy(parent["norm"])
            document["metadata"].pop("calibration_pending", None)
            # Resubmitting old complete metadata is not an explicit new calibration decision.
            document["metadata"]["calibration"] = deepcopy(baseline["norm"]["metadata"]["calibration"])
            descendant = save(client, url, parent, document)
            assert_pending(client, url, descendant, ["balance", "lag", "metric"])
            assert all(not row["changedHere"] for row in state(client, url, descendant)["thresholds"])
            assert descendant["norm"]["metadata"]["authoring"] == AUTHORING
            parent = descendant

        selected = save(client, url, parent, deepcopy(parent["norm"]), calibration={"lag": DECISIONS["lag"]})
        assert_pending(client, url, selected, ["balance", "metric"])
        assert selected["norm"]["metadata"]["calibration_pending"] == ["balance", "metric"]
        for cid in ("balance", "metric"):
            assert selected["norm"]["metadata"]["calibration"][cid] == baseline["norm"]["metadata"]["calibration"][cid]

        untouched = save(client, url, selected, deepcopy(selected["norm"]))
        assert_pending(client, url, untouched, ["balance", "metric"])
        finished = save(
            client,
            url,
            untouched,
            deepcopy(untouched["norm"]),
            calibration={cid: DECISIONS[cid] for cid in ("balance", "metric")},
        )
        assert_pending(client, url, finished, [])
        assert "calibration_pending" not in finished["norm"]["metadata"]
        signed = client.patch(f"{url}/{finished['id']}", json={"status": "approved", "author": "Reviewer"})
        assert signed.status_code == 200, signed.text
        assert_pending(client, url, changed, ["balance", "lag", "metric"])
        assert_pending(client, url, selected, ["balance", "metric"])
        assert client.get(f"{url}/{baseline['id']}").json() == baseline


def test_names_layers_weights_and_guided_metadata_round_trip_without_new_calibration(
    isolated_settings: Settings,
) -> None:
    with TestClient(create_app(isolated_settings)) as client:
        url, baseline = seed(client)
        document = deepcopy(baseline["norm"])
        document["name"] = "Renamed norm"
        document["constraints"][0].update(description="Clearer rule name", layer="commercial", weight=2)
        document["views"][0]["layer_weights"]["timing"] = 0
        document["views"][1]["constraint_weights"]["lag"] = 3
        document["metadata"]["authoring"]["answers"].append({"notes": ["Ask AP", "Check event coverage"]})
        edited = save(client, url, baseline, document)
        assert_pending(client, url, edited, [])
        assert edited["norm"] == with_general_benchmark(document)
        assert edited["norm"]["metadata"]["calibration"] == baseline["norm"]["metadata"]["calibration"]
        # The stored metadata is opaque guidance, not a substitute for explicit calibration.
        assert edited["norm"]["metadata"]["authoring"] == document["metadata"]["authoring"]
    with TestClient(create_app(isolated_settings)) as client:
        assert client.get(f"{url}/{edited['id']}").json() == edited
        assert client.get(f"{url}/{baseline['id']}").json() == baseline
        assert_pending(client, url, edited, [])
    artifact = (
        isolated_settings.workspace
        / "projects"
        / url.split("/")[4]
        / "norms"
        / edited["normId"]
        / f"v{edited['version']:03d}.json"
    )
    assert json.loads(artifact.read_text()) == edited["norm"]


def test_unknown_evidence_annotation_is_not_a_business_exclusion_or_a_calibration_decision(
    isolated_settings: Settings,
) -> None:
    with TestClient(create_app(isolated_settings)) as client:
        url, baseline = seed(client)
        document = deepcopy(baseline["norm"])
        document["constraints"][0]["params"]["delta"] = 9
        document["metadata"]["authoring"]["constraints"] = {
            "lag": {
                "businessApplicability": "applies",
                "evidence": "unknown",
                "reason": "Invoice events are absent from this extract",
            }
        }
        unknown = save(client, url, baseline, document)
        assert_pending(client, url, unknown, ["lag"])
        assert {c["id"] for c in unknown["norm"]["constraints"]} == {"lag", "metric", "balance"}
        assert "not_applicable" not in unknown["norm"]["metadata"]
        assert state(client, url, unknown)["notApplicable"] == []
        assert unknown["norm"]["views"][1]["constraint_weights"]["lag"] == 1
        assert unknown["norm"]["metadata"]["authoring"] == document["metadata"]["authoring"]

        without_reason = client.post(
            url,
            json={
                "norm": unknown["norm"],
                "parentId": unknown["id"],
                "note": "Missing business reason",
                "notApplicable": {"lag": {"note": "   "}},
            },
        )
        assert without_reason.status_code == 422
        assert without_reason.json()["code"] == "norm.not_applicable_note"

        reason = "This separately agreed business scope has no invoicing obligation"
        excluded = save(
            client,
            url,
            unknown,
            deepcopy(unknown["norm"]),
            notApplicable={"lag": {"note": reason}},
            author="Process owner",
        )
        assert_pending(client, url, excluded, [])
        assert {c["id"] for c in excluded["norm"]["constraints"]} == {"metric", "balance"}
        retained = excluded["norm"]["metadata"]["not_applicable"]["lag"]
        assert retained["constraint"] == unknown["norm"]["constraints"][0]
        assert retained["note"] == reason and retained["author"] == "Process owner"
        assert "lag" not in excluded["norm"]["views"][1]["constraint_weights"]
        assert_pending(client, url, unknown, ["lag"])
        assert client.get(f"{url}/{unknown['id']}").json() == unknown


def test_changed_derived_measurement_requires_fresh_decisions_after_storage(
    isolated_settings: Settings,
) -> None:
    with TestClient(create_app(isolated_settings)) as client:
        url, baseline = seed(client)
        document = deepcopy(baseline["norm"])
        document["derived_attributes"] = [{"name": "amount", "kind": "count", "activities": ["Order"]}]
        calibrated = save(client, url, baseline, document, calibration=DECISIONS)
        assert_pending(client, url, calibrated, [])
        document = deepcopy(calibrated["norm"])
        document["derived_attributes"][0]["activities"] = ["Invoice"]
        assert document["constraints"] == calibrated["norm"]["constraints"]
        changed = save(client, url, calibrated, document)
        assert_pending(client, url, changed, ["balance", "lag", "metric"])
        assert changed["norm"]["metadata"]["calibration"] == {}
    with TestClient(create_app(isolated_settings)) as client:
        copied = save(client, url, changed, deepcopy(changed["norm"]))
        assert_pending(client, url, copied, ["balance", "lag", "metric"])
        selected = save(client, url, copied, deepcopy(copied["norm"]), calibration={"metric": DECISIONS["metric"]})
        assert_pending(client, url, selected, ["balance", "lag"])
        assert selected["norm"]["metadata"]["authoring"] == AUTHORING
        assert client.get(f"{url}/{calibrated['id']}").json() == calibrated


def test_presence_only_initial_brief_survives_canonicalization_and_restart(
    isolated_settings: Settings,
) -> None:
    brief = {
        "mode": "guided",
        "startingPoint": "new_process",
        "purpose": "Understand whether eligible orders have approval evidence",
        "caseNoun": "purchase order items",
        "constraints": {"approval": {"businessApplicability": "applies", "evidence": "unknown", "owner": None}},
        "openQuestions": ["Are approvals recorded in every channel?"],
    }
    with TestClient(create_app(isolated_settings)) as client:
        project = client.post("/api/v1/projects", json={"name": "Presence-only starter", "process": "p2p"})
        assert project.status_code == 201, project.text
        url = f"/api/v1/projects/{project.json()['id']}/norms"
        response = client.post(
            url,
            json={
                "note": "Initial brief awaiting evidence",
                "norm": {
                    "name": "Approval expectation",
                    "layers": [{"id": "control"}],
                    "views": [{"name": "Control", "layer_weights": {"control": 1}}],
                    "constraints": [
                        {
                            "id": "approval",
                            "layer": "control",
                            "type": "presence",
                            "params": {"activity": "Approve", "m": 1},
                        }
                    ],
                    "metadata": {"authoring": brief},
                },
            },
        )
        assert response.status_code == 201, response.text
        root = response.json()
        assert root["parentId"] is None and root["status"] == "draft"
        assert root["norm"]["metadata"]["authoring"] == brief
        assert root["norm"]["constraints"][0]["params"]["activity"] == ["Approve"]
        assert len(root["norm"]["constraints"]) == 1
        assert state(client, url, root)["notApplicable"] == []
        assert state(client, url, root)["thresholds"] == []
        document = deepcopy(root["norm"])
        document["constraints"][0]["params"]["m"] = 2
        child = save(client, url, root, document)
        # Presence.m is outside the current numeric calibration gate; this does not certify policy approval.
        assert_pending(client, url, child, [])
        assert state(client, url, child)["thresholds"] == []
        assert child["norm"]["metadata"]["authoring"] == brief
    with TestClient(create_app(isolated_settings)) as client:
        assert client.get(f"{url}/{root['id']}").json() == root
        assert client.get(f"{url}/{child['id']}").json() == child
    artifact = (
        isolated_settings.workspace
        / "projects"
        / project.json()["id"]
        / "norms"
        / root["normId"]
        / f"v{root['version']:03d}.json"
    )
    assert json.loads(artifact.read_text())["metadata"]["authoring"] == brief
