"""Cached run analytics must not describe a filtered or drilled backlog population."""

from __future__ import annotations

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, run_running_example, upload_running_example
from wise_workbench.adapters.engine import analytics as an
from wise_workbench.api.app import create_app
from wise_workbench.domain.readings import kind_of


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(
        tmp_path_factory.mktemp("backlog-analytics-scope"), inprocess_worker=True, analytics_auto=False
    )
    with TestClient(create_app(settings)) as client:
        ids = upload_running_example(client)
        run_id = run_running_example(client, ids)
        container = client.app.state.container
        run, ctx = container.runs.ready(ids["project"], run_id)
        store = an.AnalyticsStore(container.workspace, ctx.run_dir)
        records = {}
        tables = {
            "bootstrap_backlog": pd.DataFrame(
                {
                    "company": ["A", "B"],
                    "stability": ["stable"] * 2,
                    "stability_reason": ["RUN-WIDE-STABILITY"] * 2,
                    "rank_lo": [81, 82],
                    "rank_hi": [91, 92],
                    "p_top3": [0.987, 0.986],
                }
            ),
            "problem_kinds": pd.DataFrame({"company": ["A", "B"], "kind": ["acute", "systematic"]}),
            "comparisons": pd.DataFrame(
                {
                    "company": ["A", "B"],
                    "comparison": ["RUN-WIDE comparison: 83 days here versus 55 elsewhere (+28 days)."] * 2,
                    "comparison_kind": ["lag"] * 2,
                    "comparison_constraint": ["run-wide-constraint"] * 2,
                    "comparison_reason": ["run-wide-reason"] * 2,
                }
            ),
            "caveats": pd.DataFrame(
                {"company": ["A", "B"], "censoring_share": [0.83, 0.79], "replication_share": [0.67, 0.71]}
            ),
        }
        for name, table in tables.items():
            phash = "scope-regression"
            record_id = "RUN-WIDE-" + name
            store.save(name, phash, table, record={"record_id": record_id})
            key = f"{name}:company" + (":Finance" if name in {"bootstrap_backlog", "comparisons"} else "")
            records[key] = {"paramsHash": phash, "recordId": record_id}
        records["readiness"] = {"recordId": "RUN-WIDE-readiness"}
        store.write_manifest({"records": records, "windowEnd": "2024-12-31"})
        frame = container.engine._get_frame(run, ctx)
        yield {
            "client": client,
            "url": f"/api/v1/projects/{ids['project']}/runs/{run_id}/backlog",
            "frame": frame,
            "engine": container.engine,
            "norm_ids": [c["id"] for c in ctx.document["constraints"]],
        }


def backlog(world, **params):
    response = world["client"].get(
        world["url"], params={"slicing": "company", "view": "Finance", "minCases": 1, **params}
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    ("selection", "case_ids"),
    [
        ({"filter": json.dumps({"kind": "count", "activity": "Record Goods Receipt", "min": 2})}, ["B"]),
        ({"drillFrom": "vendor", "drillKey": '["V1"]'}, ["A", "C", "D"]),
        (
            {
                "drillFrom": "vendor",
                "drillKey": '["V1"]',
                "filter": json.dumps({"kind": "count", "activity": "Clear Invoice", "min": 1}),
            },
            ["A", "C"],
        ),
    ],
)
def test_subset_withholds_run_analytics_but_retains_exact_counts_and_scores(world, selection, case_ids):
    whole = backlog(world)
    assert whole["params"]["analytics_available"] is True
    assert whole["params"]["analytics_record_ids"]
    assert all(row["comparison"].startswith("RUN-WIDE") and row["kind_source"] == "analytics" for row in whole["rows"])
    if an.availability()["available"]:
        assert all(any(c["share"] in {0.83, 0.79} for c in row["caveats"]) for row in whole["rows"])

    selected = backlog(world, **selection)
    expected = world["frame"].loc[case_ids]
    assert selected["params"]["cases"] == sum(row["n_cases"] for row in selected["rows"]) == len(case_ids)
    assert selected["globalMean"] == pytest.approx(whole["globalMean"])
    assert selected["params"]["window_end"] == whole["params"]["window_end"]
    for row in selected["rows"]:
        group = expected.loc[expected["company"].eq(row["keys"]["company"])]
        assert row["n_cases"] == len(group)
        assert row["mean_score"] == pytest.approx(group["score__Finance"].mean())
        assert row["comparison"] is None
        assert row["comparison_kind"] is None and row["comparison_constraint"] is None
        assert row["comparison_reason"]["code"] == "not_computed"
        assert "selection" in row["comparison_reason"]["text"]
        assert row["kind_source"] != "analytics"
        assert row["kind"] == kind_of(row["hotspot_type"])
        assert row["stability"] == "unknown" and "selection" in row["stability_reason"]
        assert row["rank_lo"] is None and row["rank_hi"] is None and row["p_top"] is None
        assert row["caveats"] == []
        assert row["n_caveats"] == row["n_caveats_shown"] == 0
        assert "RUN-WIDE" not in json.dumps(row)
    assert selected["params"]["analytics_record_ids"] == {}
    assert selected["params"]["analytics_available"] is False
    assert selected["params"]["stability_applies"] is False
    assert selected["params"]["caveat_summary"] == {}
    # Both response caches must remain isolated, whichever population is read first.
    assert backlog(world) == whole
    assert backlog(world, **selection) == selected


def test_retained_norm_flags_explicitly_describe_the_whole_run(world, monkeypatch):
    monkeypatch.setattr(
        world["engine"], "_warned_constraints", lambda ctx: dict.fromkeys(world["norm_ids"], "A global norm warning")
    )
    monkeypatch.setattr(
        world["engine"],
        "measures_logging",
        lambda run, ctx: dict.fromkeys(world["norm_ids"], "83% of run cases lack an endpoint."),
    )
    page = backlog(world, filter=json.dumps({"kind": "attribute", "field": "vendor", "eq": "V2"}))
    for row in page["rows"]:
        assert row["top_constraint_flag"] == "For the whole run: 83% of run cases lack an endpoint."
        assert row["caveats"]
        assert all(c["id"] == "norm_warning" and c["share"] is None for c in row["caveats"])
        assert all(c["text"].startswith("Run-wide norm warning:") for c in row["caveats"])
    assert page["params"]["caveat_summary"] == {}
