"""Selected-version signals use the mapped table without depending on or changing a run."""

from __future__ import annotations

import io
from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
import wise
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app


def create_table(client: TestClient, project_id: str) -> str:
    events = []
    for cid, group, end, close, amount in (
        ("one", "A", 11, 3, 11),
        ("two", "A", 13, 8, 13),
        ("three", "B", 9, 20, float("inf")),
        ("missing", "A", None, None, None),
    ):
        for activity, day in (("Start", 0), ("End", end), ("Close", close)):
            if day is not None:
                events.append(
                    {
                        "case": cid,
                        "activity": activity,
                        "time": (datetime(2026, 1, 1) + timedelta(days=day)).isoformat(),
                        "group": group,
                        "amount": amount,
                    }
                )
    csv = pd.DataFrame(events).to_csv(index=False).encode()
    base = f"/api/v1/projects/{project_id}"
    response = client.post(base + "/datasets", files={"file": ("signals.csv", io.BytesIO(csv), "text/csv")})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "done", job
    dataset_id = job["resultRef"].split(":", 1)[1]
    response = client.post(
        base + f"/datasets/{dataset_id}/mappings",
        json={
            "caseId": "case",
            "activity": "activity",
            "timestamp": "time",
            "caseAttributes": ["group", "amount"],
        },
    )
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "done", job
    return str(job["resultRef"].split(":", 1)[1])


def norm_document() -> dict[str, Any]:
    return wise.Norm(
        constraints=(
            wise.NormConstraint("elapsed", "time", wise.Lag("Start", "End", delta=10, width=20)),
            wise.NormConstraint("start", "time", wise.Presence("Start")),
        ),
        layers=(wise.Layer("time"),),
        views=(wise.View("Process", layer_weights={"time": 1}),),
    ).to_dict()


def save_norm(client: TestClient, base: str, document: dict[str, Any], **extra: Any) -> dict[str, Any]:
    response = client.post(base + "/norms", json={"norm": document, "note": "Synthetic preview", **extra})
    assert response.status_code == 201, response.text
    return dict(response.json())


@pytest.fixture
def world(tmp_path: Path) -> Iterator[tuple[TestClient, str, str, str, dict[str, Any]]]:
    app = create_app(make_settings(tmp_path, inprocess_worker=True, analytics_auto=False))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Selected norm signals"}).json()["id"]
        base = f"/api/v1/projects/{pid}"
        table = create_table(client, pid)
        yield client, pid, base, table, save_norm(client, base, norm_document())


def preview(client: TestClient, base: str, version: str, table: str) -> dict[str, Any]:
    response = client.get(base + f"/norms/{version}/signals/elapsed", params={"caseTableId": table})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["normVersionId"] == version and result["caseTableId"] == table
    assert result["constraintId"] == "elapsed"
    return dict(result)


def histogram_count(result: dict[str, Any]) -> int:
    return sum(b["n"] for b in result["bins"]) + sum((result.get(k) or {}).get("n", 0) for k in ("below", "beyond"))


def test_selected_threshold_and_full_rule_without_any_run(world: tuple) -> None:
    client, _pid, base, table, first = world
    document = deepcopy(first["norm"])
    document["constraints"][0]["params"]["delta"] = 12
    second = save_norm(client, base, document, parentId=first["id"])
    before = client.get(base + "/norms").json()
    jobs = client.get("/api/v1/jobs").json()
    first_signal = preview(client, base, first["id"], table)
    second_signal = preview(client, base, second["id"], table)
    for result, threshold, share in ((first_signal, 10, 2 / 3), (second_signal, 12, 1 / 3)):
        assert result["threshold"] == threshold and result["width"] == 20
        assert result["saturation"] == threshold + 20
        assert result["stats"]["n"] == 3 and result["stats"]["nCases"] == result["casesInScope"] == 4
        assert histogram_count(result) == 3
        assert result["stats"]["shareBeyondThreshold"] == pytest.approx(share)
        assert result["stats"]["shareBeyondSaturation"] == 0
    assert first_signal["stats"]["shareViolated"] == pytest.approx(3 / 4)
    assert second_signal["stats"]["shareViolated"] == pytest.approx(2 / 4)
    assert client.get(base + "/runs").json() == []
    assert client.get("/api/v1/jobs").json() == jobs
    assert client.get(base + "/norms").json() == before
    document["constraints"][0]["params"].update(b=["Close"], delta=4)
    document["constraints"][0]["applicability"] = {"attr": "group", "in": ["A"]}
    third = save_norm(client, base, document, parentId=second["id"])
    changed = preview(client, base, third["id"], table)
    assert changed["stats"]["n"] == 2 and changed["casesInScope"] == changed["stats"]["nCases"] == 3
    assert histogram_count(changed) == 2
    assert changed["stats"]["min"] == 3 and changed["stats"]["max"] == 8
    assert changed["stats"]["mean"] == 5.5 and changed["stats"]["shareBeyondThreshold"] == 0.5
    assert "Close" in changed["label"]
    assert preview(client, base, first["id"], table) == first_signal


def test_derivations_leave_cached_run_and_table_unchanged(world: tuple) -> None:
    client, pid, base, table, first = world
    document = deepcopy(first["norm"])
    document["constraints"][0].update(type="metric", params={"attribute": "elapsed_days", "threshold": 10, "width": 20})
    document["derived_attributes"] = [
        {"name": "elapsed_days", "kind": "lag", "a": ["Start"], "b": ["End"], "unit": "D"}
    ]
    original = save_norm(client, base, document, parentId=first["id"])
    response = client.post(
        base + "/runs",
        json={
            "caseTableId": table,
            "normVersionId": original["id"],
            "slicings": [{"attributes": ["group"]}],
            "minCases": 1,
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()
    assert wait_job(client, run["jobId"])["status"] == "done"
    run_url = base + f"/runs/{run['id']}"
    old_signal = client.get(run_url + "/signals/elapsed").json()
    saved_run = client.get(run_url).json()
    c = client.app.state.container
    artefacts = [*c.workspace.run_dir(pid, run["id"]).rglob("*"), *c.workspace.case_table_dir(pid, table).rglob("*")]
    hashes = {p: sha256(p.read_bytes()).hexdigest() for p in artefacts if p.is_file()}
    document["derived_attributes"][0]["b"] = ["Close"]
    document["constraints"][0]["applicability"] = {"attr": "elapsed_days", "in": [3, 8]}
    changed = save_norm(client, base, document, parentId=original["id"])
    previewed = preview(client, base, changed["id"], table)
    assert previewed["casesInScope"] == previewed["stats"]["n"] == 2
    assert (previewed["stats"]["min"], previewed["stats"]["max"]) == (3, 8)
    assert previewed["stats"]["shareBeyondThreshold"] == 0
    assert client.get(run_url + "/signals/elapsed").json() == old_signal
    assert client.get(run_url).json() == saved_run
    assert len(client.get(base + "/runs").json()) == 1
    assert client.get(base + f"/norms/{original['id']}").json() == original
    assert {p: sha256(p.read_bytes()).hexdigest() for p in hashes} == hashes


def test_native_shares_exclude_nonfinite_observations(world: tuple) -> None:
    client, _pid, base, table, first = world
    document = deepcopy(first["norm"])
    document["constraints"][0].update(type="metric", params={"attribute": "amount", "threshold": 12, "width": 20})
    selected = save_norm(client, base, document, parentId=first["id"])
    result = preview(client, base, selected["id"], table)
    assert result["stats"]["n"] == 2 and result["stats"]["nCases"] == 4
    assert result["stats"]["mean"] == 12 and result["stats"]["shareBeyondThreshold"] == 0.5
    assert histogram_count(result) == 2


@pytest.mark.parametrize("missing", ["metric", "applicability", "derived"])
def test_missing_attributes_return_typed_error(world: tuple, missing: str) -> None:
    client, _pid, base, table, first = world
    document = deepcopy(first["norm"])
    if missing == "metric":
        document["constraints"][0].update(type="metric", params={"attribute": "absent", "threshold": 12, "width": 20})
    elif missing == "applicability":
        document["constraints"][0]["applicability"] = {"attr": "absent", "in": ["A"]}
    else:
        document["derived_attributes"] = [{"name": "derived", "kind": "agg", "column": "absent", "agg": "sum"}]
    selected = save_norm(client, base, document, parentId=first["id"])
    response = client.get(base + f"/norms/{selected['id']}/signals/elapsed", params={"caseTableId": table})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "norm.signal_unavailable"
    assert client.get(base + f"/norms/{selected['id']}").json() == selected
    assert client.get(base + "/runs").json() == []


def test_project_boundaries_exclusions_and_required_table(world: tuple) -> None:
    client, _pid, base, table, first = world
    other = client.post("/api/v1/projects", json={"name": "Other project"}).json()["id"]
    other_base = f"/api/v1/projects/{other}"
    foreign_table = create_table(client, other)
    foreign_version = save_norm(client, other_base, norm_document())
    for version, case_table, code in (
        (first["id"], foreign_table, "case_table.not_found"),
        (foreign_version["id"], table, "norm.not_found"),
    ):
        response = client.get(base + f"/norms/{version}/signals/elapsed", params={"caseTableId": case_table})
        assert response.status_code == 404 and response.json()["code"] == code
    url = base + f"/norms/{first['id']}/signals/elapsed"
    assert client.get(url).status_code == 422
    assert client.get(url, params={"caseTableId": table, "scale": "unsupported"}).status_code == 422
    excluded = save_norm(
        client, base, first["norm"], parentId=first["id"], notApplicable={"elapsed": {"note": "Outside this norm"}}
    )
    response = client.get(base + f"/norms/{excluded['id']}/signals/elapsed", params={"caseTableId": table})
    assert response.status_code == 404 and response.json()["code"] == "constraint.not_found"
    assert client.get(base + f"/norms/{first['id']}").json() == first


def test_empty_applicability_has_no_fabricated_percentages(world: tuple) -> None:
    client, _pid, base, table, first = world
    document = deepcopy(first["norm"])
    document["constraints"][0]["applicability"] = {"attr": "group", "in": ["absent"]}
    selected = save_norm(client, base, document, parentId=first["id"])
    result = preview(client, base, selected["id"], table)
    assert result["casesInScope"] == 0 and result["stats"] == {"n": 0, "nCases": 0}
    assert result["bins"] == result["ecdf"] == []
