"""Norm decisions and signatures survive reload without changing prior versions."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
import wise
from fastapi.testclient import TestClient

from wise_workbench.api.app import create_app
from wise_workbench.settings import Settings


def settings_for(path: Path) -> Settings:
    return Settings(
        workspace=path,
        database_url=f"sqlite:///{path / 'workbench.db'}",
        inprocess_worker=False,
        analytics_auto=False,
        log_level="WARNING",
    )


def create_parent(client: TestClient, author: str | None = None) -> tuple[str, dict[str, Any]]:
    pid = client.post("/api/v1/projects", json={"name": "Norm decision review", "process": "p2p"}).json()["id"]
    url = f"/api/v1/projects/{pid}/norms"
    response = client.post(
        url, json={"norm": wise.running_p2p_norm().to_dict(), "note": "Initial norm", "author": author}
    )
    assert response.status_code == 201, response.text
    return url, response.json()


def changed_document(parent: dict[str, Any]) -> tuple[dict[str, Any], str]:
    document = deepcopy(parent["norm"])
    target = next(c for c in document["constraints"] if "delta" in c.get("params", {}))
    target["params"]["delta"] += 7
    return document, target["id"]


def test_calibration_and_exclusion_survive_restart(tmp_path: Path) -> None:
    settings = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        url, parent = create_parent(client)
        document, cid = changed_document(parent)
        excluded = next(c["id"] for c in document["constraints"] if c["id"] != cid)
        request = {
            "norm": document,
            "parentId": parent["id"],
            "note": "Reviewed scope and target",
            "author": "Editor",
            "calibration": {cid: {"rationale": "The agreed target includes transit time", "owner": "Process owner"}},
            "notApplicable": {excluded: {"note": "This obligation belongs to another process"}},
        }
        created = client.post(url, json=request)
        assert created.status_code == 201, created.text
        version = created.json()
        state = client.get(f"{url}/{version['id']}/calibration").json()
        row = next(r for r in state["thresholds"] if r["constraint_id"] == cid)
        assert row["rationale"] == request["calibration"][cid]["rationale"]
        assert row["owner"] == "Process owner"
        assert datetime.fromisoformat(row["decidedAt"]).tzinfo is not None
        assert state["canLeaveDraft"] and not state["missingRationale"]
        decision = next(r for r in state["notApplicable"] if r["constraint_id"] == excluded)
        assert decision["note"] == request["notApplicable"][excluded]["note"]
        assert decision["author"] == "Editor"
        assert excluded not in {c["id"] for c in version["norm"]["constraints"]}
        assert version["norm"]["metadata"]["not_applicable"][excluded]["constraint"] == next(
            c for c in document["constraints"] if c["id"] == excluded
        )
        assert client.get(f"{url}/{parent['id']}").json() == parent
    with TestClient(create_app(settings)) as reloaded:
        assert reloaded.get(f"{url}/{version['id']}").json() == version
        assert reloaded.get(f"{url}/{version['id']}/calibration").json() == state
        assert reloaded.get(f"{url}/{parent['id']}").json() == parent


@pytest.mark.parametrize("creator", [None, "Original editor"])
def test_each_signature_is_persisted_and_noop_cannot_replace_it(tmp_path: Path, creator: str | None) -> None:
    settings = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        url, version = create_parent(client, creator)
        target = f"{url}/{version['id']}"
        reviewed = client.patch(target, json={"status": "reviewed", "author": "  Reviewer  "})
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["author"] == "Reviewer"
    with TestClient(create_app(settings)) as client:
        assert client.get(target).json()["author"] == "Reviewer"
        approved = client.patch(target, json={"status": "approved", "author": "Approver"})
        assert approved.status_code == 200, approved.text
        assert approved.json()["author"] == "Approver"
        assert approved.json()["norm"] == version["norm"]
        assert approved.json()["fingerprint"] == version["fingerprint"]
        again = client.patch(target, json={"status": "approved", "author": "Someone else"})
        assert again.status_code == 200 and again.json()["author"] == "Approver"
    with TestClient(create_app(settings)) as client:
        saved = client.get(target).json()
        assert saved["status"] == "approved" and saved["author"] == "Approver"
        assert client.get(target + "/calibration").json()["author"] == "Approver"
        assert next(n for n in client.get(url).json() if n["id"] == version["id"])["author"] == "Approver"


@pytest.mark.parametrize("entry", [{"rationale": "   ", "owner": "Owner"}, {"rationale": "Reason", "owner": "   "}])
def test_invalid_calibration_creates_no_version(tmp_path: Path, entry: dict[str, str]) -> None:
    with TestClient(create_app(settings_for(tmp_path))) as client:
        url, parent = create_parent(client)
        document, cid = changed_document(parent)
        response = client.post(
            url, json={"norm": document, "parentId": parent["id"], "note": "Draft", "calibration": {cid: entry}}
        )
        assert response.status_code == 422 and response.json()["code"] == "norm.rationale_required"
        assert client.get(url).json() == [parent]


def test_a_refused_signature_does_not_change_the_saved_version(tmp_path: Path) -> None:
    with TestClient(create_app(settings_for(tmp_path))) as client:
        url, parent = create_parent(client)
        document, cid = changed_document(parent)
        response = client.post(url, json={"norm": document, "parentId": parent["id"], "note": "Unjustified threshold"})
        assert response.status_code == 201, response.text
        version = response.json()
        refused = client.patch(f"{url}/{version['id']}", json={"status": "reviewed", "author": "Reviewer"})
        assert refused.status_code == 422 and refused.json()["code"] == "norm.rationale_required"
        assert any(error["field"] == cid for error in refused.json()["errors"])
        assert client.get(f"{url}/{version['id']}").json() == version
        assert client.get(f"{url}/{parent['id']}").json() == parent


@pytest.mark.parametrize("change", ["threshold", "applicability"])
def test_changed_expectations_need_a_fresh_decision(tmp_path: Path, change: str) -> None:
    settings = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        url, first = create_parent(client)
        document, cid = changed_document(first)
        decision = {"rationale": "Reviewed target for this population", "owner": "Process owner"}
        parent = client.post(
            url, json={"norm": document, "parentId": first["id"], "note": "Calibrated", "calibration": {cid: decision}}
        ).json()
        child_doc = deepcopy(parent["norm"])
        target = next(c for c in child_doc["constraints"] if c["id"] == cid)
        if change == "threshold":
            target["params"]["delta"] += 7
        else:
            target["applicability"] = {"attr": "company", "in": ["A"]}
        child = client.post(url, json={"norm": child_doc, "parentId": parent["id"], "note": "New decision needed"})
        assert child.status_code == 201, child.text
        child_id = child.json()["id"]
    with TestClient(create_app(settings)) as client:
        state = client.get(f"{url}/{child_id}/calibration").json()
        assert cid in state["missingRationale"] and not state["canLeaveDraft"]
        copied = client.get(f"{url}/{child_id}").json()
        grandchild = client.post(url, json={"norm": copied["norm"], "parentId": child_id, "note": "Unchanged draft"})
        assert grandchild.status_code == 201, grandchild.text
        grandchild_id = grandchild.json()["id"]
        carried = client.get(f"{url}/{grandchild_id}/calibration").json()
        assert cid in carried["missingRationale"] and not carried["canLeaveDraft"]
        assert (
            client.patch(f"{url}/{grandchild_id}", json={"status": "approved", "author": "Approver"}).status_code == 422
        )
        resolved = client.post(
            url,
            json={
                "norm": copied["norm"],
                "parentId": grandchild_id,
                "note": "Decision recorded",
                "calibration": {cid: decision},
            },
        )
        assert resolved.status_code == 201, resolved.text
        assert client.get(f"{url}/{resolved.json()['id']}/calibration").json()["canLeaveDraft"]
        assert client.patch(f"{url}/{child_id}", json={"status": "approved", "author": "Approver"}).status_code == 422
        reaffirmed = client.post(
            url,
            json={
                "norm": child_doc,
                "parentId": parent["id"],
                "note": "Reviewed again",
                "calibration": {cid: decision},
            },
        )
        assert reaffirmed.status_code == 201, reaffirmed.text
        refreshed = reaffirmed.json()
        assert client.get(f"{url}/{refreshed['id']}/calibration").json()["canLeaveDraft"]
        assert (
            client.patch(f"{url}/{refreshed['id']}", json={"status": "approved", "author": "Approver"}).status_code
            == 200
        )
        assert client.get(f"{url}/{parent['id']}").json() == parent
        same = client.post(
            url, json={"norm": parent["norm"], "parentId": parent["id"], "note": "Same expectations"}
        ).json()
        assert same["norm"]["metadata"]["calibration"][cid] == parent["norm"]["metadata"]["calibration"][cid]


@pytest.mark.parametrize("status", ["reviewed", "approved"])
@pytest.mark.parametrize("author", [None, "   "])
def test_a_real_signature_needs_an_explicit_person(tmp_path: Path, status: str, author: str | None) -> None:
    with TestClient(create_app(settings_for(tmp_path))) as client:
        url, version = create_parent(client, "Original editor")
        response = client.patch(f"{url}/{version['id']}", json={"status": status, "author": author})
        assert response.status_code == 422 and response.json()["code"] == "norm.author"
        assert client.get(f"{url}/{version['id']}").json() == version
