"""The BPIC 2019 preset on a small log with the challenge's column names: one job from file to scored run."""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import WISE_LIB, make_settings, wait_job
from wise_workbench.api.app import create_app
from wise_workbench.presets import suggest_mapping

NORM = WISE_LIB / "examples" / "bpic19_norm.json"

COLUMNS = [
    "eventID",
    "case Spend area text",
    "case Company",
    "case Document Type",
    "case Purchasing Document",
    "case Vendor",
    "case Item Type",
    "case Item Category",
    "case concept:name",
    "event User",
    "event org:resource",
    "event concept:name",
    "event Cumulative net worth (EUR)",
    "event time:timestamp",
]


def small_bpic_csv() -> bytes:
    """Ten purchase order items in two companies and three spend areas, DF1 and DF2 flows, one open item."""
    rows: list[list[object]] = []
    eid = 0
    specs = [
        (
            "companyID_0000",
            "Packaging",
            "vendorID_0001",
            "3-way match, invoice after GR",
            ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"],
            [0, 5, 9, 20],
        ),
        (
            "companyID_0000",
            "Packaging",
            "vendorID_0001",
            "3-way match, invoice after GR",
            [
                "Create Purchase Order Item",
                "Record Goods Receipt",
                "Record Goods Receipt",
                "Record Invoice Receipt",
                "Clear Invoice",
            ],
            [0, 4, 6, 8, 70],
        ),
        (
            "companyID_0000",
            "Packaging",
            "vendorID_0002",
            "3-way match, invoice after GR",
            ["Create Purchase Order Item", "Record Invoice Receipt", "Record Goods Receipt", "Clear Invoice"],
            [0, 2, 9, 40],
        ),
        (
            "companyID_0000",
            "Logistics",
            "vendorID_0003",
            "3-way match, invoice before GR",
            [
                "Create Purchase Order Item",
                "Record Invoice Receipt",
                "Record Goods Receipt",
                "Remove Payment Block",
                "Clear Invoice",
            ],
            [0, 3, 12, 30, 45],
        ),
        (
            "companyID_0000",
            "Logistics",
            "vendorID_0003",
            "3-way match, invoice before GR",
            [
                "Create Purchase Order Item",
                "Change Price",
                "Record Invoice Receipt",
                "Record Goods Receipt",
                "Remove Payment Block",
                "Clear Invoice",
            ],
            [0, 1, 3, 15, 60, 95],
        ),
        (
            "companyID_0000",
            "Logistics",
            "vendorID_0004",
            "3-way match, invoice before GR",
            ["Create Purchase Order Item", "Record Invoice Receipt", "Record Goods Receipt"],
            [0, 3, 12],
        ),
        (
            "companyID_0001",
            "Travel",
            "vendorID_0005",
            "3-way match, invoice after GR",
            ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"],
            [0, 3, 5, 12],
        ),
        (
            "companyID_0001",
            "Travel",
            "vendorID_0005",
            "3-way match, invoice after GR",
            [
                "Create Purchase Order Item",
                "Record Goods Receipt",
                "Record Invoice Receipt",
                "Cancel Invoice Receipt",
                "Record Invoice Receipt",
                "Clear Invoice",
            ],
            [0, 3, 5, 6, 9, 50],
        ),
        (
            "companyID_0001",
            "Travel",
            "vendorID_0006",
            "2-way match",
            ["Create Purchase Order Item", "Record Invoice Receipt", "Clear Invoice"],
            [0, 4, 10],
        ),
        (
            "companyID_0001",
            "Packaging",
            "vendorID_0001",
            "3-way match, invoice after GR",
            ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"],
            [0, 6, 8, 25],
        ),
    ]
    for i, (company, spend, vendor, category, activities, days) in enumerate(specs, start=1):
        doc = f"45070000{i:02d}"
        case = f"{doc}_00010"
        for act, day in zip(activities, days):
            eid += 1
            resource = "batch_01" if act in ("Vendor creates invoice", "Clear Invoice") else f"user_{i:03d}"
            rows.append(
                [
                    eid,
                    spend,
                    company,
                    "Standard PO",
                    doc,
                    vendor,
                    "Standard",
                    category,
                    case,
                    resource,
                    resource,
                    act,
                    1000.0 + 10 * i,
                    f"{(1 + day) % 28 + 1:02d}-{1 + day // 28:02d}-2018 10:00:00.000",
                ]
            )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    w.writerows(rows)
    return buf.getvalue().encode()


def test_suggest_mapping_recognises_the_bpic_columns_and_trims_them() -> None:
    suggestion = suggest_mapping(COLUMNS)
    assert suggestion["source"] == "bpic2019"
    assert "case Spend area text" in suggestion["mapping"]["caseAttributes"]
    assert suggestion["mapping"]["order"] == "eventID" and suggestion["mapping"]["flowTyping"]
    trimmed = suggest_mapping([c for c in COLUMNS if c not in ("eventID", "case Item Category")])
    assert "order" not in trimmed["mapping"] and trimmed["mapping"]["flowTyping"] == []
    assert suggest_mapping(["case:concept:name", "concept:name", "time:timestamp", "org:resource"])["source"] == "pm4py"
    heuristic = suggest_mapping(["Case ID", "Activity", "Complete Timestamp", "Resource", "Amount", "case Region"])
    assert heuristic["mapping"] == {
        "caseId": "Case ID",
        "activity": "Activity",
        "timestamp": "Complete Timestamp",
        "resource": "Resource",
        "exposure": "Amount",
        "caseAttributes": ["case Region"],
    }


@pytest.mark.skipif(not NORM.exists(), reason="the paper's norm is not checked out")
def test_bpic2019_preset_loads_a_scored_run_in_one_job(tmp_path: Path) -> None:
    log = tmp_path / "BPI_Challenge_2019.csv"
    log.write_bytes(small_bpic_csv())
    app = create_app(make_settings(tmp_path, inprocess_worker=True, bpic19_csv=log, bpic19_norm=NORM))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Preset", "process": "p2p"}).json()["id"]
        presets = client.get(f"/api/v1/projects/{pid}/datasets/presets").json()
        assert presets[0]["available"] is True and presets[0]["source"] == str(log)
        r = client.post(f"/api/v1/projects/{pid}/datasets/presets/bpic2019")
        assert r.status_code == 202 and r.json()["kind"] == "load_preset"
        job = wait_job(client, r.json()["id"], timeout=120)
        assert job["status"] == "done", job
        run_id = job["resultRef"].split(":", 1)[1]
        run = client.get(f"/api/v1/projects/{pid}/runs/{run_id}").json()
        assert run["status"] == "done" and run["gamma"] == 20 and run["minCases"] == 1
        assert run["slicings"][0]["id"] == "case Company+case Spend area text"
        assert "Automation" in run["views"]
        datasets = client.get(f"/api/v1/projects/{pid}/datasets").json()
        assert len(datasets) == 1 and datasets[0]["status"] == "ready" and datasets[0]["name"] == log.name
        tables = client.get(f"/api/v1/projects/{pid}/case-tables").json()
        assert len(tables) == 1 and tables[0]["cases"] == 10 and "flow_type" in tables[0]["attributes"]
        mapping = client.get(f"/api/v1/projects/{pid}/case-tables/{tables[0]['id']}/mapping").json()
        assert mapping["headerEvents"] and mapping["closureActivities"] == ["Clear Invoice"]
        # a preset names what one case is, and the case table it loads says the same
        assert mapping["caseNoun"] == "purchase order items"
        assert (tables[0].get("readiness") or {}).get("caseNoun") == "purchase order items"
        norms = client.get(f"/api/v1/projects/{pid}/norms").json()
        assert len(norms) == 1 and norms[0]["name"] == "WISE BPIC'19 norm"
        page = client.get(
            f"/api/v1/projects/{pid}/runs/{run_id}/backlog",
            params={"slicing": "case Company+case Spend area text", "view": "Automation", "minCases": 1},
        ).json()
        assert page["total"] == 4 and page["rows"][0]["keys"]["case Company"].startswith("companyID_")
        assert page["params"]["case_noun"] == "purchase order items"
        assert all(row["kind"] in ("acute", "systematic", "widespread", None) for row in page["rows"])
        assert client.get(f"/api/v1/projects/{pid}").json()["latestRunId"] == run_id
        # loading again reuses everything and answers with a job that finishes on the same run
        again = client.post(f"/api/v1/projects/{pid}/datasets/presets/bpic2019").json()
        assert wait_job(client, again["id"], timeout=60)["resultRef"] == f"run:{run_id}"
        assert len(client.get(f"/api/v1/projects/{pid}/datasets").json()) == 1
        assert len(client.get(f"/api/v1/projects/{pid}/runs").json()) == 1


def test_preset_without_the_file_is_refused(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, inprocess_worker=False, bpic19_csv=tmp_path / "missing.csv"))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Preset"}).json()["id"]
        assert client.get(f"/api/v1/projects/{pid}/datasets/presets").json()[0]["available"] is False
        r = client.post(f"/api/v1/projects/{pid}/datasets/presets/bpic2019")
        assert r.status_code == 422 and r.json()["code"] == "preset.unavailable"
