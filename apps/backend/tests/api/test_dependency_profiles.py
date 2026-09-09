"""Explicit product/minimal contracts using public synthetic data and a fresh workspace."""

from __future__ import annotations

from fastapi.testclient import TestClient
from wise_knowledge import available_packs, load_pack

from tests.conftest import run_running_example, upload_running_example
from wise_workbench.adapters.engine.analytics import availability


def test_declared_dependencies(dependency_profile: str) -> None:
    expected = dependency_profile == "full"
    assert availability()["available"] is expected
    if not expected:
        assert availability() == {"available": False, "version": None, "reason": "wise-analytics is not installed"}
    assert {"p2p", "o2c"} <= set(available_packs())
    assert load_pack("p2p").templates and load_pack("o2c").presets


def test_profile_scoring_and_headroom(client: TestClient, dependency_profile: str) -> None:
    ids = upload_running_example(client)
    run = run_running_example(client, ids)
    base = f"/api/v1/projects/{ids['project']}/runs/{run}"
    backlog = client.get(f"{base}/backlog", params={"slicing": "company", "view": "Finance", "minCases": 1})
    assert backlog.status_code == 200, backlog.text
    rows = backlog.json()["rows"]
    assert len(rows) == 2 and all(row["PI"] >= 0 for row in rows)
    response = client.get(f'{base}/slices/["B"]', params={"slicing": "company", "view": "Finance"})
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["row"]["keys"] == {"company": "B"}
    assert detail["drivers"]["rows"] and "priority" in detail["reading"]
    if dependency_profile == "full":
        assert detail["analytics"]["available"] is True
        assert detail["headroom"]["columns"][:2] == ["constraint", "plain"]
        assert detail["headroom"]["rows"]
        assert {"headroom", "contrast_slice"} <= set(detail["analytics"]["recordIds"])
    else:
        assert detail["analytics"]["available"] is False
        assert detail["analytics"]["recordIds"] == {}
        assert detail["headroom"]["columns"] == ["layer", "headroom", "note"]
        assert len(detail["headroom"]["rows"]) == 5
        assert all(
            row[1:] == [None, "not available: wise-analytics is not installed"] for row in detail["headroom"]["rows"]
        )
        assert detail["contrast"] == detail["subgroups"] == {"columns": [], "rows": []}
        assert all(row["stability"] == "unknown" and row["comparison"] is None for row in rows)
