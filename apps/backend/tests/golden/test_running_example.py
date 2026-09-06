"""Golden: the API backlog equals the library's ``prioritize`` output on the paper's running example."""

from __future__ import annotations

import math

import pytest
import wise
from fastapi.testclient import TestClient

from tests.conftest import run_running_example, upload_running_example

COLUMNS = ["n_cases", "mean_score", "gap", "PI", "stable_mean", "stable_gap", "stable_PI", "global_mean", "PI_lower"]


def _close(a: float | None, b: float) -> bool:
    if a is None:
        return math.isnan(b)
    return math.isclose(a, b, rel_tol=0, abs_tol=1e-12)


@pytest.mark.parametrize("gamma", [0.0, 20.0])
@pytest.mark.parametrize("view", ["Finance", "Logistics"])
@pytest.mark.parametrize("by", [["company"], ["vendor"], ["company", "vendor"]])
def test_backlog_matches_library(client: TestClient, gamma: float, view: str, by: list[str]) -> None:
    ids = upload_running_example(client)
    run_id = run_running_example(client, ids, gamma=gamma, slicings=[["company"], ["vendor"], ["company", "vendor"]])
    page = client.get(
        f"/api/v1/projects/{ids['project']}/runs/{run_id}/backlog",
        params={"slicing": ",".join(by), "view": view, "minCases": 1, "sort": "rank", "pageSize": 100},
    ).json()
    result = wise.score(wise.running_p2p_log(), wise.running_p2p_norm())
    expected = wise.prioritize(result, by, view=view, gamma=gamma, z=1.96)
    assert page["total"] == len(expected)
    assert math.isclose(page["globalMean"], float(expected.attrs["baseline"]), abs_tol=1e-12)
    for api_row, (key, lib_row) in zip(page["rows"], expected.iterrows()):
        key_values = list(key) if isinstance(key, tuple) else [key]
        assert [api_row["keys"][a] for a in by] == [str(k) for k in key_values]
        for col in COLUMNS:
            assert _close(api_row[col], float(lib_row[col])), (col, api_row[col], lib_row[col])
    drivers = wise.layer_drivers(result, by, view=view)
    for api_row in page["rows"]:
        key = tuple(api_row["keys"][a] for a in by)
        lib_key = key[0] if len(key) == 1 else key
        assert api_row["dominant_layer"] == drivers.loc[lib_key, "dominant_layer"]
    hot = wise.hotspot_table(expected, top=12, drivers=drivers)
    for api_row in page["rows"]:
        key = tuple(api_row["keys"][a] for a in by)
        lib_key = key[0] if len(key) == 1 else key
        expected_type = hot.loc[lib_key, "hotspot"] if lib_key in hot.index else None
        assert api_row["hotspot_type"] == expected_type


def test_slice_detail_matches_constraint_drivers(client: TestClient) -> None:
    ids = upload_running_example(client)
    run_id = run_running_example(client, ids, gamma=0.0, slicings=[["company"]])
    detail = client.get(
        f"/api/v1/projects/{ids['project']}/runs/{run_id}/slices/" + '["B"]',
        params={"slicing": "company", "view": "Finance"},
    ).json()
    result = wise.score(wise.running_p2p_log(), wise.running_p2p_norm())
    expected = wise.constraint_drivers(result, "Finance", {"company": "B"})
    cols = detail["drivers"]["columns"]
    for row in detail["drivers"]["rows"]:
        rec = dict(zip(cols, row))
        lib = expected.loc[rec["constraint"]]
        for col in ("mean_penalty", "mean_violation", "share_violated", "share_in_scope", "share_evaluated"):
            assert _close(rec[col], float(lib[col])), (rec["constraint"], col)
    summary = client.get(f"/api/v1/projects/{ids['project']}/runs/{run_id}/summary").json()
    lib_summary = result.summary()
    for view in ("Finance", "Logistics"):
        assert _close(summary["means"][view], float(lib_summary.loc[view, "mean_score"]))
    assert math.isclose(summary["density"]["evaluated"], result.applicability_density(), abs_tol=1e-12)
