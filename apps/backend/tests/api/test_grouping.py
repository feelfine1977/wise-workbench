"""Grouping definitions retain membership across overview, detail, drill and map."""

from __future__ import annotations

import io
import json
from urllib.parse import quote

import pandas as pd
import pytest
import wise
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app


def token(attributes, bands=None):
    return "group:" + json.dumps({"attributes": attributes, "bands": bands or []})


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings = make_settings(tmp_path_factory.mktemp("grouping"), inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        pid = client.post("/api/v1/projects", json={"name": "Grouping fixture", "process": "p2p"}).json()["id"]
        events = wise.running_p2p_events().copy()
        events["value, net"] = events["case"].map({"A": 10, "B": 20, "C": 40, "D": 80, "E": 160})
        events['team "region"'] = events["case"].map({"A": "east", "B": "west", "C": "east", "D": "west", "E": "east"})
        events["invoice_month"] = events["case"].map({"A": "2024-01", "B": "2024-02", "C": "2024-01", "D": "2024-02"})
        events.loc[events["case"] == "E", "time"] = pd.NaT
        job = client.post(
            f"/api/v1/projects/{pid}/datasets",
            files={"file": ("groups.csv", io.BytesIO(events.to_csv(index=False).encode()), "text/csv")},
        ).json()
        assert wait_job(client, job["id"])["status"] == "done"
        dataset = job["resultRef"].split(":", 1)[1]
        job = client.post(
            f"/api/v1/projects/{pid}/datasets/{dataset}/mappings",
            json={
                "caseId": "case",
                "activity": "activity",
                "timestamp": "time",
                "caseAttributes": ["company", "vendor", "flow_type", "value, net", 'team "region"', "invoice_month"],
            },
        ).json()
        assert wait_job(client, job["id"])["status"] == "done", job
        ct = job["resultRef"].split(":", 1)[1]
        nv = client.post(
            f"/api/v1/projects/{pid}/norms",
            json={"norm": wise.running_p2p_norm().to_dict(), "note": "grouping fixture"},
        ).json()["id"]
        body = {
            "caseTableId": ct,
            "normVersionId": nv,
            "slicings": [{"attributes": ["company"]}],
            "gamma": 0,
            "minCases": 1,
        }
        run = client.post(f"/api/v1/projects/{pid}/runs", json=body).json()
        assert wait_job(client, run["jobId"])["status"] == "done", run
        yield {
            "client": client,
            "pid": pid,
            "rid": run["id"],
            "body": body,
            "url": f"/api/v1/projects/{pid}/runs/{run['id']}",
        }


def get(world, suffix, **params):
    response = world["client"].get(world["url"] + suffix, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_options_profile_actual_cases_and_prefer_native_calendar(world):
    result = get(world, "/slicings/options")
    assert result["cases"] == 5 and result["scope"] is None
    attrs = {a["name"]: a for a in result["attributes"]}
    assert attrs["company"]["distinct"] == 2 and attrs["company"]["missing"] == 0
    assert attrs["invoice_month"]["distinct"] == 2 and attrs["invoice_month"]["missing"] == 1
    assert attrs["start_month"]["distinct"] == 1 and attrs["start_month"]["missing"] == 1
    assert attrs["value, net"]["type"] == "numeric"
    assert {"start_month", "start_year", "recorded_span_days", "n_events"} <= attrs.keys()
    assert all(not a.startswith(("score__", "contrib__")) for a in attrs)
    suggestions = result["suggestions"]
    assert any(s["attributes"] == ["invoice_month"] for s in suggestions)
    assert not any(s["attributes"] == ["start_month"] for s in suggestions)
    assert not any(s["attributes"] == ["spend_area"] for s in suggestions)
    for s in suggestions:
        assert json.loads(s["id"][6:]) == {"attributes": s["attributes"], "bands": s["bands"]}
        preview = get(world, "/slicings/preview", slicing=s["id"], minCases=1)
        assert preview["cases"] == 5


def test_profiles_are_recomputed_for_scoped_run(world):
    c = world["client"]
    scope = {"attribute": "company", "value": "A"}
    run = c.post(f"/api/v1/projects/{world['pid']}/runs", json={**world["body"], "scope": scope}).json()
    assert wait_job(c, run["jobId"])["status"] == "done"
    response = c.get(f"/api/v1/projects/{world['pid']}/runs/{run['id']}/slicings/options")
    assert response.status_code == 200, response.text
    result = response.json()
    attrs = {a["name"]: a for a in result["attributes"]}
    assert result["cases"] == 2 and result["scope"] == scope
    assert attrs["company"]["distinct"] == 1
    assert attrs["value, net"]["distinct"] == 2
    assert attrs["invoice_month"]["missing"] == 0


def test_inline_numeric_bands_keep_exact_membership_in_detail_map_and_drill(world):
    bands = [{"attribute": "value, net", "method": "cuts", "cuts": [40, 100]}]
    grouping = token(["value, net"], bands)
    page = get(world, "/backlog", slicing=grouping, minCases=1, pageSize=100, view="Finance")
    assert page["params"]["bands"] == bands and page["params"]["slicing"] == grouping
    assert sorted(row["n_cases"] for row in page["rows"]) == [1, 2, 2]
    expected_ids = {"< 40": {"A", "B"}, "40 – 100": {"C", "D"}, "≥ 100": {"E"}}
    for row in page["rows"]:
        expected = expected_ids[row["keys"]["value, net"]]
        detail = get(world, "/slices/" + quote(row["key"], safe=""), slicing=grouping, view="Finance")
        assert detail["params"]["bands"] == bands
        assert {case["caseId"] for case in detail["worstCases"]} == expected
        flow = get(world, "/flow", slicing=grouping, sliceKey=row["key"], abstraction=0)
        assert flow["meta"]["cases"] == len(expected)
        # Finer cuts on the same numeric attribute must not change the coarse selection.
        fine = token(["value, net"], [{"attribute": "value, net", "method": "cuts", "cuts": [20, 80]}])
        drill = get(world, "/backlog", slicing=fine, drillFrom=grouping, drillKey=row["key"], minCases=1, pageSize=100)
        assert drill["params"]["cases"] == len(expected)
        assert drill["params"]["drill"]["slicing"] == grouping
        assert sum(r["n_cases"] for r in drill["rows"]) == len(expected)


def test_calendar_unknown_and_recorded_features_are_consistent_in_frame_result_log_and_new_runs(world):
    c = world["client"]
    engine = c.app.state.container.engine
    run, ctx = c.app.state.container.runs.ready(world["pid"], world["rid"])
    frame, result, log = engine._get_frame(run, ctx), engine._get_result(run, ctx), engine._run_log(ctx)
    for name in ["start_month", "start_year", "recorded_span_days", "n_events", 'team "region"']:
        pd.testing.assert_series_equal(frame[name], result.cases[name])
        pd.testing.assert_series_equal(frame[name], log.cases[name])
    assert pd.isna(frame.loc["E", "start_month"])
    page = get(world, "/backlog", slicing=token(["start_month"]), minCases=1)
    missing = next(row for row in page["rows"] if row["keys"]["start_month"] == "(missing)")
    assert missing["n_cases"] == 1
    flow = get(world, "/flow", slicing=token(["start_month"]), sliceKey=missing["key"], abstraction=0)
    assert flow["meta"]["cases"] == 1
    detail = get(world, "/slices/" + quote(missing["key"], safe=""), slicing=token(["start_month"]), view="Finance")
    assert {case["caseId"] for case in detail["worstCases"]} == {"E"}
    body = {
        **world["body"],
        "slicings": [
            {"attributes": ["start_month"]},
            {
                "attributes": ["recorded_span_days"],
                "bands": [{"attribute": "recorded_span_days", "method": "quantile", "q": 4}],
            },
            {"attributes": ['team "region"']},
        ],
    }
    new = c.post(f"/api/v1/projects/{world['pid']}/runs", json=body)
    assert new.status_code == 202, new.text
    new_run = new.json()
    job = wait_job(c, new_run["jobId"])
    assert job["status"] == "done", job
    new_obj, new_ctx = c.app.state.container.runs.ready(world["pid"], new_run["id"])
    new_frame = engine._get_frame(new_obj, new_ctx)
    pd.testing.assert_series_equal(new_frame['team "region"'], frame['team "region"'])


@pytest.mark.parametrize(
    "grouping",
    [
        "group:",
        "group:[]",
        'group:{"attributes":["company"],"expression":"x"}',
        'group:{"attributes":["value, net"],"bands":[{"attribute":"value, net","q":"4"}]}',
        "group:" + " " * 8193,
    ],
)
def test_malformed_groupings_are_422_at_api_entry_points(world, grouping):
    for suffix in ["/backlog", "/slicings/preview", "/flow"]:
        response = world["client"].get(
            world["url"] + suffix, params={"slicing": grouping, "sliceKey": '["A"]', "minCases": 1}
        )
        assert response.status_code == 422, response.text


def test_conflicting_bands_and_unknown_column_are_rejected(world):
    grouping = token(["value, net"], [{"attribute": "value, net", "method": "cuts", "cuts": [40, 100]}])
    response = world["client"].get(world["url"] + "/backlog", params={"slicing": grouping, "bands": "[]"})
    assert response.status_code == 422 and response.json()["code"] == "run.grouping_conflict"
    response = world["client"].get(world["url"] + "/slicings/preview", params={"slicing": token(['__import__("os")'])})
    assert response.status_code == 422 and response.json()["code"] == "backlog.attribute"


def test_options_do_not_load_or_rescore_events(world, monkeypatch):
    engine = world["client"].app.state.container.engine

    def unexpected(*_args, **_kwargs):
        raise AssertionError("options must profile the persisted case frame, not load or score events")

    monkeypatch.setattr(engine, "_run_log", unexpected)
    monkeypatch.setattr(engine, "_get_result", unexpected)
    assert get(world, "/slicings/options")["cases"] == 5


def test_diagnostics_and_kpis_use_the_inline_band_definition(world):
    grouping = token(["value, net"], [{"attribute": "value, net", "method": "cuts", "cuts": [40, 100]}])
    diagnostics = get(world, "/diagnostics", slicing=grouping, view="Finance")
    assert len(diagnostics["rows"]) == 3
    assert {row[0] for row in diagnostics["rows"]} == {"< 40", "40 – 100", "≥ 100"}
    kpis = get(world, "/kpis", grouping=grouping, view="Finance", minCases=1)
    assert "3 groups" in json.dumps(kpis)


def test_derived_grouping_support_does_not_accept_unavailable_run_scope(world):
    # Scope is applied before run-derived fields; grouping support must not bypass scope validation.
    response = world["client"].post(
        f"/api/v1/projects/{world['pid']}/runs",
        json={**world["body"], "scope": {"attribute": "start_month", "value": "2023-12"}},
    )
    assert response.status_code == 422 and response.json()["code"] == "run.scope_attribute"


def test_cached_run_objects_are_not_copied_or_enriched_again(world, monkeypatch):
    from wise_workbench.adapters.engine import gateway

    container = world["client"].app.state.container
    engine = container.engine
    run, ctx = container.runs.ready(world["pid"], world["rid"])
    frame = engine._get_frame(run, ctx)
    result = engine._get_result(run, ctx)
    log = engine._run_log(ctx)
    cases = log.cases

    def unexpected(*_args, **_kwargs):
        raise AssertionError("immutable cached run objects must not be enriched or copied repeatedly")

    monkeypatch.setattr(gateway, "enrich_grouping_fields", unexpected)
    assert engine._get_frame(run, ctx) is frame
    assert engine._get_result(run, ctx) is result
    assert engine._run_log(ctx).cases is cases
