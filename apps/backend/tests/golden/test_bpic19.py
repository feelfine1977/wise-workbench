"""Opt-in: the full BPI Challenge 2019 log through the services reproduces the paper's Table XI.

Set ``WISE_BPIC19_CSV`` to the challenge CSV. Takes a few minutes.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.conftest import BPIC19_NORM, make_settings
from wise_workbench.container import Container
from wise_workbench.domain import RunParams, Slicing
from wise_workbench.domain.comparison import bracket_is_difference
from wise_workbench.jobs import Worker
from wise_workbench.presets import BPIC19_MAPPING

CSV = os.environ.get("WISE_BPIC19_CSV")
NORM = BPIC19_NORM
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


def test_cycle2_analytics_censoring_histogram_and_flow_types(pipeline: dict) -> None:
    """R1-01, R1-02, R1-09, R2-O10 on the full log: Packaging is stable at rank 1, 14 % of its items are still
    open at the window end 2019-01-17 (the same share in the caveat, the validation table and the library), the
    lens shows 97 % beyond 30 days over informative bins, and the four flow types are detected with their maps."""
    import json

    pytest.importorskip("wise_analytics")
    c, project, run, table = pipeline["c"], pipeline["project"], pipeline["run"], pipeline["table"]
    job = c.runs.request_analytics(project.id, run.id)
    Worker(c, worker_id="test").drain()
    assert str(c.jobs.get(job.id).status) == "done", c.jobs.get(job.id).error
    status = c.runs.analytics(project.id, run.id)
    assert status["status"] == "done" and status["windowEnd"].startswith("2019-01-17")
    assert table.readiness.window_end.startswith("2019-01-17") and table.readiness.case_noun == "purchase order items"
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
        page_size=5,
    )
    assert (
        page["params"]["window_end"].startswith("2019-01-17") and page["params"]["case_noun"] == "purchase order items"
    )
    packaging = page["rows"][0]
    assert packaging["keys"]["case Spend area text"] == "Packaging" and packaging["stability"] == "stable"
    assert packaging["kind"] == "widespread" and packaging["plain_layer"] == "On time"
    assert packaging["points_below"].startswith("0.9 points below the overall score of 84.4")
    # R3-04: the bracket is the difference of the two numbers the sentence prints (83 − 55), not the
    # analytics package's Hodges-Lehmann shift of 25 days, which keeps its own labelled column in the contrast
    assert packaging["comparison"].startswith("Paid within terms: 83 days here against 55 elsewhere (+28 days)")
    assert bracket_is_difference(packaging["comparison"]) is True
    censoring = next(x for x in packaging["caveats"] if x["id"] == "censoring")
    assert censoring["share"] == pytest.approx(0.1437, abs=5e-4)
    assert censoring["text"].startswith("14 % of purchase order items still open at the end of the data (2019-01-17)")
    real_estate = page["rows"][4]
    assert real_estate["keys"]["case Spend area text"] == "Real Estate"
    assert next(x for x in real_estate["caveats"] if x["id"] == "censoring")["text"].startswith(
        "44 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged"
    )
    key = json.dumps(["companyID_0000", "Packaging"])
    detail = c.runs.slice_detail(
        project.id, run.id, slicing="company+spend", slice_key=key, view="Automation", drilldown=None
    )
    assert detail["validation"]["censored_share"] == pytest.approx(censoring["share"], abs=1e-9)
    cols = detail["contrast"]["columns"]
    top = dict(zip(cols, detail["contrast"]["rows"][0]))
    assert top["constraint"] == "c_l3_invoice_to_clear_days" and top["plain"] == "Paid within terms"
    assert top["median_group"] == pytest.approx(83.4, abs=0.1) and top["median_elsewhere"] == pytest.approx(
        54.7, abs=0.1
    )
    assert detail["guidance_refs"][0] == {
        "kind": "layer",
        "id": "L3_timeliness_ageing",
        "plain_name": "On time",
        "missed_label": "waiting too long between steps",
        "hub_node": "layer:timeliness_ageing",
    }
    signal = c.runs.signals(
        project.id, run.id, constraint_id="c_l3_invoice_to_clear_days", slicing="company+spend", slice_key=key
    )
    assert len(signal["bins"]) >= 20 and sum(1 for b in signal["bins"] if b["n"] > 0) >= 20
    assert signal["stats"]["shareBeyondThresholdText"] == "97 % beyond 30 days"
    assert [m["x"] for m in signal["markers"]] == [30.0, 90.0] and signal["beyond"]["n"] > 0
    flow_types = c.mappings.flow_types(project.id, table.id, attribute=None)
    counts = {t["name"]: t["cases"] for t in flow_types["types"]}
    assert counts == {"DF2": 221_010, "DF1": 15_182, "Consignment": 14_498, "2-way": 1_044}
    assert all(
        t["map"]["groups"] and t["readiness"]["headline"].endswith("(2019-01-17).")
        for t in flow_types["types"]
        if t["readiness"]["replicatedShare"] < 0.05
    )
    warnings = c.norms.refresh_warnings(pipeline["norm"], table.id).validation
    assert any("Vendor creates credit memo" in w for w in warnings) and any(
        "Change Payment Terms" in w for w in warnings
    )


def test_summary_means(pipeline: dict) -> None:
    c, project, run = pipeline["c"], pipeline["project"], pipeline["run"]
    summary = c.runs.summary(project.id, run.id)
    assert summary["means"]["Finance"] == pytest.approx(0.819, abs=1e-3)
    assert summary["means"]["Automation"] == pytest.approx(0.844, abs=1e-3)
    assert summary["density"]["evaluated"] == pytest.approx(0.762, abs=1e-3)
