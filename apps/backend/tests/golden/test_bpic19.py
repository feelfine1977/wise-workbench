"""Opt-in: the full BPI Challenge 2019 log through the services reproduces the paper's Table XI.

Set ``WISE_BPIC19_CSV`` to the challenge CSV. Takes a few minutes.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.conftest import WISE_LIB, make_settings
from wise_workbench.container import Container
from wise_workbench.domain import RunParams, Slicing
from wise_workbench.jobs import Worker
from wise_workbench.presets import BPIC19_MAPPING

CSV = os.environ.get("WISE_BPIC19_CSV")
NORM = WISE_LIB / "examples" / "bpic19_norm.json"
pytestmark = pytest.mark.skipif(
    not CSV or not Path(CSV).exists() or not NORM.exists(), reason="set WISE_BPIC19_CSV to the BPI Challenge 2019 CSV"
)

FOCUS = {
    ("companyID_0000", "Packaging"): (109_199, 0.0087, 945.7),
    ("companyID_0000", "Logistics"): (5_242, 0.0561, 294.2),
    ("companyID_0003", "Real Estate"): (583, 0.0869, 50.6),
}


@pytest.fixture(scope="module")
def pipeline(tmp_path_factory: pytest.TempPathFactory) -> dict:
    import json

    c = Container(make_settings(tmp_path_factory.mktemp("bpic")))
    project = c.projects.create("BPIC 2019", process="p2p")
    dataset, _ = c.datasets.ingest_path(project.id, Path(str(CSV)))
    Worker(c, worker_id="test").drain()
    dataset = c.datasets.get(project.id, dataset.id)
    assert str(dataset.status) == "ready", dataset.error
    _m, table, _job, _sample = c.mappings.create(project.id, dataset.id, BPIC19_MAPPING)
    Worker(c, worker_id="test").drain()
    table = c.mappings.get_case_table(project.id, table.id)
    assert str(table.status) == "ready", table.error
    norm = c.norms.create_version(project.id, json.loads(NORM.read_text(encoding="utf-8")), note="paper norm")
    by = ("case Company", "case Spend area text")
    params = RunParams(
        case_table_id=table.id,
        norm_version_id=norm.id,
        views=("Automation", "Finance"),
        slicings=(Slicing("company+spend", by),),
        gamma=20.0,
        min_cases=1,
    )
    run, _job, _created = c.runs.create(project.id, params)
    Worker(c, worker_id="test").drain()
    run = c.runs.get(project.id, run.id)
    assert str(run.status) == "done", run.error
    return {"c": c, "project": project, "dataset": dataset, "table": table, "run": run, "norm": norm}


def test_readiness_report(pipeline: dict) -> None:
    table = pipeline["table"]
    assert table.cases == 251_734
    items = {i.id: i for i in table.readiness.items}
    outliers = items["timestamp_outliers"].evidence
    assert str(outliers["earliest"]).startswith("1948") and str(outliers["latest"]).startswith("2020")
    stamps = [v["timestamp"] for v in items["sentinel_dates"].evidence["values"]]
    assert any(t.startswith("1948") for t in stamps) and any(t.startswith("2020") for t in stamps)
    precision = {r["activity"]: r["precision"] for r in items["timestamp_precision"].evidence["activities"]}
    assert precision["Record Goods Receipt"] == "minute" and precision["Create Purchase Requisition Item"] == "day"
    assert "header_event_replication" in items
    assert items["flow_types"].evidence["counts"]["DF1"] > 0


def test_table_xi(pipeline: dict) -> None:
    c, project, run = pipeline["c"], pipeline["project"], pipeline["run"]
    page = c.runs.backlog(
        project.id,
        run.id,
        slicing="company+spend",
        view="Automation",
        gamma=None,
        min_cases=1,
        sort="rank",
        hotspot_type=None,
        layer=None,
        q=None,
        page=1,
        page_size=500,
    )
    rows = {(r["keys"]["case Company"], r["keys"]["case Spend area text"]): r for r in page["rows"]}
    for key, (n, gap, pi) in FOCUS.items():
        row = rows[key]
        assert row["n_cases"] == n
        assert row["stable_gap"] == pytest.approx(gap, abs=5e-4)
        assert row["stable_PI"] == pytest.approx(pi, abs=1.0)
    # the focus slices sit at ranks 1, 2 and 5 of the Automation backlog (Additives and Latex & Monomers lie between)
    ranks = {key: rows[key]["rank"] for key in FOCUS}
    assert ranks[("companyID_0000", "Packaging")] == 1 and ranks[("companyID_0000", "Logistics")] == 2
    assert ranks[("companyID_0003", "Real Estate")] == 5
    assert rows[("companyID_0000", "Packaging")]["hotspot_type"] == "reservoir"


def test_summary_means(pipeline: dict) -> None:
    c, project, run = pipeline["c"], pipeline["project"], pipeline["run"]
    summary = c.runs.summary(project.id, run.id)
    assert summary["means"]["Finance"] == pytest.approx(0.819, abs=1e-3)
    assert summary["means"]["Automation"] == pytest.approx(0.844, abs=1e-3)
    assert summary["density"]["evaluated"] == pytest.approx(0.762, abs=1e-3)
