"""Cycle 3 through the API on the synthetic P2P log (packages/wise-analytics ``generate``, planted artefacts).

Covers the explore board and the flow as an instrument (R3-O11, R3-O12): facets by attribute, flow type and case
start period, KPI tiles, paths from the full directly-follows relation with the hidden-path count (R3-O8), the
BPMN export, and the end-to-end check that one activity filter moves backlog, flow, facets and KPIs by the same
number of cases. Also the decision defects (R3-O1, R3-O3, R3-O4) and the truthfulness defects (R2-05, R2-06).
"""

from __future__ import annotations

import io
import json
import time
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from typing import Any

import pytest
import wise_analytics as wa
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app

BPMN_NS = {
    "b": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "di": "http://www.omg.org/spec/BPMN/20100524/DI",
}
MAPPING = {
    "caseId": "case",
    "activity": "activity",
    "timestamp": "time",
    "caseAttributes": ["company", "spend_area", "vendor", "document", "flow_type"],
    "exposure": "net_worth",
    "headerEvents": ["Create Purchase Order Item"],
    "closureActivities": ["Clear Invoice"],
    "flowTyping": [{"name": "with GR", "rule": {"has": ["Record Goods Receipt"]}}],
    "flowTypeDefault": "no GR",
}
SLICINGS = [{"attributes": ["vendor"]}, {"attributes": ["company", "spend_area"]}]
FILTER = {"and": [{"kind": "activity", "op": "contains", "activity": "Record Invoice Receipt"}]}


def _wait_analytics(client: TestClient, pid: str, run_id: str, timeout: float = 180.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = client.get(f"/api/v1/projects/{pid}/runs/{run_id}/analytics").json()
        if st["status"] == "done":
            return st
        time.sleep(0.1)
    raise AssertionError("analytics did not finish")


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Any]]:
    slog, truth = wa.generate("p2p", n_cases=600, seed=5, artefacts=wa.synthetic.DEFAULT_ARTEFACTS)
    app = create_app(make_settings(tmp_path_factory.mktemp("cycle3"), inprocess_worker=True))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Board", "process": "p2p"}).json()["id"]
        csv = slog.events.to_csv(index=False).encode()
        job = client.post(
            f"/api/v1/projects/{pid}/datasets", files={"file": ("synthetic.csv", io.BytesIO(csv), "text/csv")}
        ).json()
        assert wait_job(client, job["id"])["status"] == "done"
        dataset = job["resultRef"].split(":")[1]
        r = client.post(f"/api/v1/projects/{pid}/datasets/{dataset}/mappings", json=MAPPING)
        assert r.status_code == 202, r.text
        ct = wait_job(client, r.json()["id"])["resultRef"].split(":")[1]
        norm = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": truth.norm.to_dict(), "note": "synthetic"})
        assert norm.status_code == 201, norm.text
        body = {"caseTableId": ct, "normVersionId": norm.json()["id"], "slicings": SLICINGS, "gamma": 2, "minCases": 5}
        run = client.post(f"/api/v1/projects/{pid}/runs", json=body).json()
        assert wait_job(client, run["jobId"], timeout=180)["status"] == "done"
        analytics = _wait_analytics(client, pid, run["id"])
        yield {
            "client": client,
            "pid": pid,
            "dataset": dataset,
            "ct": ct,
            "run": run,
            "cases": 600,
            "analytics": analytics,
            "log": slog,
        }


def _get(w: dict[str, Any], path: str, **params: Any) -> dict[str, Any]:
    r = w["client"].get(f"/api/v1/projects/{w['pid']}/runs/{w['run']['id']}/{path}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- R3-O12 facets under the canonical filter
def test_facets_by_attribute_flow_type_and_period(world: dict[str, Any]) -> None:
    facets = _get(world, "facets", by="attribute", attribute="spend_area", view="Finance")
    assert facets["by"] == "attribute" and facets["field"] == "spend_area"
    assert facets["cases"] == facets["casesTotal"] == world["cases"]
    assert sum(v["cases"] for v in facets["values"]) + facets["other"]["cases"] == world["cases"]
    top = facets["values"][0]
    assert set(top) >= {
        "value",
        "label",
        "cases",
        "share",
        "share_below_expectation",
        "priority_at_stake",
        "open_share",
    }
    assert 0 <= top["share_below_expectation"] <= 1 and top["priority_at_stake"] >= 0
    assert 0 <= top["open_share"] <= 1, "the one censoring definition also answers per facet value"
    priorities = [v["priority_at_stake"] for v in facets["values"]]
    assert priorities == sorted(priorities, reverse=True), "default order is by priority"

    # the facet's priority is the backlog's priority for the same grouping
    backlog = _get(world, "backlog", slicing="spend_area", view="Finance", minCases=1, pageSize=100)
    by_key = {json.loads(r["key"])[0]: r for r in backlog["rows"]}
    for v in facets["values"]:
        row = by_key.get(v["value"])
        if row is not None:
            assert v["cases"] == row["n_cases"]
            assert abs(v["priority_at_stake"] - row["stable_PI"]) < 1e-6

    flows = _get(world, "facets", by="flow_type", view="Finance")
    assert flows["field"] == "flow_type" and {v["value"] for v in flows["values"]} == {"with GR", "no GR"}
    assert sum(v["cases"] for v in flows["values"]) == world["cases"]

    periods = _get(world, "facets", by="period", view="Finance", sort="period", limit=200)
    assert periods["field"] == "case start" and periods["period"] == "month"
    labels = [v["value"] for v in periods["values"]]
    assert labels == sorted(labels), "the period breakdown comes back in time order"
    assert all(len(v) == 7 and v[4] == "-" for v in labels), "case start month as YYYY-MM"
    assert sum(v["cases"] for v in periods["values"]) + periods["other"]["cases"] == world["cases"]
    quarters = _get(world, "facets", by="period", period="quarter", view="Finance", sort="period", limit=200)
    assert all("-Q" in v["value"] for v in quarters["values"]) and len(quarters["values"]) <= len(labels)


def test_facets_reject_an_unknown_attribute_and_a_missing_one(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    r = c.get(f"/api/v1/projects/{pid}/runs/{rid}/facets", params={"by": "attribute", "attribute": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "board.attribute"
    r = c.get(f"/api/v1/projects/{pid}/runs/{rid}/facets", params={"by": "attribute"})
    assert r.status_code == 422 and r.json()["code"] == "board.attribute"


# ---------------------------------------------------------------- R3-O12 KPI tiles
def test_kpi_tiles_carry_the_four_numbers_and_a_plain_sentence(world: dict[str, Any]) -> None:
    kpis = _get(world, "kpis", view="Finance")
    tiles = {t["id"]: t for t in kpis["tiles"]}
    assert {"items", "share_below_expectation", "priority_at_stake", "open_share"} <= set(tiles)
    assert tiles["items"]["value"] == world["cases"] and kpis["cases"] == world["cases"]
    assert 0 <= tiles["share_below_expectation"]["value"] <= 1
    assert tiles["priority_at_stake"]["value"] == pytest.approx(kpis["priorityAtStake"])
    assert 0 <= tiles["open_share"]["value"] <= 1
    assert all(t["text"] and t["text"].endswith(".") for t in kpis["tiles"])
    assert "purchase order items" in tiles["items"]["text"] or "cases" in tiles["items"]["text"]
    assert kpis["params"]["window_end"], "the tiles name the one window end"

    # without a grouping the tiles use the run's first slicing
    assert kpis["params"]["grouping"] == ["vendor"]
    # the priority tile is the sum of the backlog's bars for the same grouping
    grouped = _get(world, "kpis", view="Finance", grouping="company,spend_area")
    backlog = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=1, pageSize=200)
    assert grouped["groups"] == backlog["total"]
    assert grouped["priorityAtStake"] == pytest.approx(sum(r["stable_PI"] for r in backlog["rows"]), rel=1e-6)


def test_kpis_of_one_group_match_its_card(world: dict[str, Any]) -> None:
    backlog = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=1)
    row = backlog["rows"][0]
    kpis = _get(world, "kpis", view="Finance", slicing="vendor", sliceKey=row["key"])
    assert kpis["cases"] == row["n_cases"]
    assert kpis["meanScore"] == pytest.approx(row["mean_score"], rel=1e-9)


# ---------------------------------------------------------------- R3-O11 / R3-O9 one filter moves every panel
def test_an_activity_filter_changes_backlog_flow_facets_and_kpis_consistently(world: dict[str, Any]) -> None:
    flt = json.dumps(FILTER)
    preview = _get(world, "filters/preview", filter=flt)
    kept = preview["cases_in"]
    assert 0 < kept < world["cases"], "the filter must actually select a part of the log"
    assert preview["cases_in"] + preview["cases_out"] == world["cases"]

    plain = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=200)
    filtered = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=200, filter=flt)
    assert plain["params"]["cases"] in (None, world["cases"])
    assert filtered["params"]["cases"] == kept
    assert filtered["params"]["filter"] == FILTER
    assert sum(r["n_cases"] for r in filtered["rows"]) <= sum(r["n_cases"] for r in plain["rows"])
    assert filtered["total"] <= plain["total"]

    flow = _get(world, "flow", abstraction=0.05, filter=flt)
    assert flow["meta"]["cases"] == kept
    assert flow["meta"]["filterCases"] == {"cases_in": kept, "cases_out": world["cases"] - kept}

    facets = _get(world, "facets", by="flow_type", view="Finance", filter=flt)
    assert facets["cases"] == kept and facets["casesTotal"] == world["cases"]
    assert sum(v["cases"] for v in facets["values"]) == kept

    kpis = _get(world, "kpis", view="Finance", filter=flt)
    assert kpis["cases"] == kept and kpis["casesTotal"] == world["cases"]
    assert {t["id"]: t for t in kpis["tiles"]}["items"]["value"] == kept

    lens = _get(world, "signals/c1", filter=flt)
    assert lens["casesInScope"] <= kept


# ---------------------------------------------------------------- R3-O8 paths from the full relation
def test_paths_come_from_the_full_relation_and_count_what_the_detail_level_hides(world: dict[str, Any]) -> None:
    coarse = _get(world, "flow", abstraction=0.5, focus="Record Goods Receipt")
    fine = _get(world, "flow", abstraction=0.0, focus="Record Goods Receipt")
    assert coarse["paths"]["totalIncoming"] == fine["paths"]["totalIncoming"] > 0
    assert coarse["paths"]["totalOutgoing"] == fine["paths"]["totalOutgoing"] > 0
    assert coarse["paths"]["hidden"] >= fine["paths"]["hidden"]
    assert coarse["paths"]["hidden"] > 0 and "hidden by the detail level" in coarse["paths"]["note"]
    assert fine["paths"]["hidden"] == 0 and "drawn on the map" in fine["paths"]["note"]
    assert all(p["onMap"] for p in fine["paths"]["incoming"])
    assert coarse["meta"]["focus"]["cases"] == fine["meta"]["focus"]["cases"]

    profile = _get(world, "flow/activities/Record Goods Receipt", abstraction=0.5)
    assert profile["label"] == "Record Goods Receipt" and profile["id"] == "a_record_goods_receipt"
    assert profile["cases"] == coarse["meta"]["focus"]["cases"] and 0 < profile["shareOfCases"] <= 1
    assert profile["paths"]["totalIncoming"] == coarse["paths"]["totalIncoming"]
    assert profile["stage"], "the pack places the activity in a stage"
    assert any(c["id"] for c in profile["constraintsTouching"])
    by_id = _get(world, "flow/activities/a_record_goods_receipt", abstraction=0.5)
    assert by_id["label"] == profile["label"]
    r = world["client"].get(f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/flow/activities/nope")
    assert r.status_code == 404


def test_a_rare_activity_still_has_its_paths(world: dict[str, Any]) -> None:
    """The owner's report: an activity on the map whose every edge is below the detail level looked path-less."""
    whole = _get(world, "flow", abstraction=0.0)
    rare = min(
        (n for n in whole["nodes"] if n["kind"] == "activity" and n["metrics"]["cases"] > 3),
        key=lambda n: n["metrics"]["cases"],
    )
    profile = _get(world, "flow/activities/" + rare["id"], abstraction=0.5)
    assert profile["paths"]["totalIncoming"] + profile["paths"]["totalOutgoing"] > 0
    assert not profile["onMap"] or profile["paths"]["hidden"] > 0


# ---------------------------------------------------------------- R3-O11 BPMN export
def test_bpmn_export_of_the_observed_flow_and_of_the_stage_model(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    r = c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"scope": "flow", "detail": 0.05})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    root = ET.fromstring(r.text)
    assert root.tag == "{http://www.omg.org/spec/BPMN/20100524/MODEL}definitions"
    tasks = root.findall(".//b:task", BPMN_NS)
    flows = root.findall(".//b:sequenceFlow", BPMN_NS)
    lanes = root.findall(".//b:lane", BPMN_NS)
    shapes = root.findall(".//di:BPMNShape", BPMN_NS)
    assert tasks and flows and lanes and shapes
    assert int(r.headers["X-Wise-Bpmn-Tasks"]) == len(tasks)
    assert int(r.headers["X-Wise-Bpmn-Sequence-Flows"]) == len(flows)
    assert len(root.findall(".//b:startEvent", BPMN_NS)) == len(root.findall(".//b:endEvent", BPMN_NS)) == 1
    # every element the diagram references exists, and every element has a shape
    ids = {e.get("id") for e in root.iter() if e.get("id")}
    for shape in shapes:
        assert shape.get("bpmnElement") in ids
    nodes = {e.get("id") for e in [*tasks, *root.findall(".//b:exclusiveGateway", BPMN_NS)]}
    nodes |= {e.get("id") for e in root.findall(".//b:startEvent", BPMN_NS)}
    nodes |= {e.get("id") for e in root.findall(".//b:endEvent", BPMN_NS)}
    shaped = {s.get("bpmnElement") for s in shapes}
    assert nodes <= shaped, "the file opens laid out, not as a pile at the origin"
    for f in flows:
        assert f.get("sourceRef") in nodes and f.get("targetRef") in nodes
    # every flow node sits in a lane
    refs = {e.text for e in root.findall(".//b:flowNodeRef", BPMN_NS)}
    assert nodes <= refs
    assert [t.get("name") for t in tasks] == [
        n["label"]
        for n in sorted(
            (n for n in _get(world, "flow", abstraction=0.05)["nodes"] if n["kind"] == "activity"),
            key=lambda n: -n["metrics"]["events"],
        )
    ], "the export is the map at that detail level, in the map's order"

    # the filter travels into the export
    filtered = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"scope": "flow", "filter": json.dumps(FILTER)}
    )
    assert filtered.status_code == 200 and int(filtered.headers["X-Wise-Bpmn-Tasks"]) > 0

    stages = c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"scope": "stages"})
    assert stages.status_code == 200
    stage_root = ET.fromstring(stages.text)
    stage_lanes = [x.get("name") for x in stage_root.findall(".//b:lane", BPMN_NS)]
    assert stage_lanes[:3] == ["Request", "Approve", "Order"], "the pack's stage order"
    assert len(stage_root.findall(".//b:task", BPMN_NS)) > len(tasks)

    plain = c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"gateways": "false"})
    assert plain.status_code == 200 and int(plain.headers["X-Wise-Bpmn-Gateways"]) == 0
    download = c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"download": "true"})
    assert ".bpmn" in download.headers["content-disposition"]
    assert c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow/bpmn", params={"scope": "nope"}).status_code == 422


# ---------------------------------------------------------------- R2-05 no borrowed sentence
def test_no_row_borrows_another_row_s_comparison_sentence(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=200)
    by_sentence: dict[str, list[dict[str, Any]]] = {}
    for row in page["rows"]:
        if row["comparison"]:
            by_sentence.setdefault(row["comparison"], []).append(row)
    for sentence, rows in by_sentence.items():
        constraints = {r["comparison_constraint"] for r in rows}
        assert len(constraints) == 1, f"{sentence!r} is shared by rows about different expectations: {constraints}"
    for row in page["rows"]:
        assert bool(row["comparison"]) != bool(row["comparison_reason"]), row["key"]
        if row["comparison_reason"]:
            assert row["comparison_reason"]["text"].endswith((".", "!"))
            assert row["comparison_reason"]["code"] in {
                "no_scored_cases",
                "no_driver",
                "not_computed",
                "analytics_unavailable",
                "analytics_error",
            }


def test_a_group_without_scored_cases_says_so_instead_of_comparing(world: dict[str, Any]) -> None:
    from wise_workbench.adapters.engine import analytics as an

    reason = an.comparison_reason("no_scored_cases", items="purchase order items", view="Finance")
    assert reason["code"] == "no_scored_cases" and "nothing to compare" in reason["text"]
    assert an.top_comparison(None, items="purchase order items") is None
    # on a real group the sentence and the reason are mutually exclusive
    page = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=3)
    detail = _get(world, f"slices/{page['rows'][0]['key']}", slicing="vendor", view="Finance")
    assert detail["scoredCases"] > 0
    assert bool(detail["comparison"]) != bool(detail["comparison_reason"])


# ---------------------------------------------------------------- R2-06 the page-wide caveat rule
def test_a_group_above_the_page_wide_threshold_keeps_its_caveat_chip(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=200)
    summary = page["params"]["caveat_summary"]
    assert summary and "censoring" in summary
    threshold = summary["censoring"]["threshold"]
    assert threshold == pytest.approx(summary["censoring"]["page_share"] * 1.5)
    seen_shown = seen_hidden = False
    for row in page["rows"]:
        for caveat in row["caveats"]:
            if caveat["status"] == "fail":
                assert not caveat["suppressed"], "a fail caveat is always shown"
                seen_shown = True
            if caveat["share"] is not None and caveat["threshold"] is not None:
                if caveat["share"] > caveat["threshold"]:
                    assert not caveat["suppressed"], (row["key"], caveat["id"], caveat["share"])
                    seen_shown = True
                elif caveat["status"] == "warn":
                    assert caveat["suppressed"]
                    seen_hidden = True
        assert row["n_caveats_shown"] == sum(1 for c in row["caveats"] if not c["suppressed"])
    assert seen_shown and seen_hidden, "the rule must both show and hide chips on this page"


def test_slice_detail_carries_the_sub_group_censoring_caveats(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=1, pageSize=5)
    found = False
    for row in page["rows"]:
        detail = _get(world, f"slices/{row['key']}", slicing="company,spend_area", view="Finance")
        assert detail["subgroups"]["columns"], "sub-groups are computed"
        assert "censored_share" in detail["subgroups"]["columns"]
        for caveat in detail["caveats"]:
            if caveat["id"] == "subgroup_censoring":
                found = True
                assert caveat["subgroup"]["attribute"] and caveat["subgroup"]["value"]
                assert "still open at the end of the data" in caveat["text"]
    assert found, "a sub-group with open cases must show its own caveat on the slice detail"


# ---------------------------------------------------------------- R3-O1 / R3-O3 / R3-O4 decisions
def test_decisions_accumulate_on_one_lineage_and_stay_revisable(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    base = f"/api/v1/projects/{pid}/case-tables/{ct}/decisions"
    view = c.get(base).json()
    assert view["caseTableId"] == ct and len(view["lineage"]) == 1
    items = {i["kind"]: i for i in view["items"]}
    assert set(items) == {
        "drop_outside_window",
        "sentinel_as_missing",
        "collapse_duplicates",
        "day_precision",
        "header_events",
        "open_cases",
        "zero_exposure",
        "flow_type_assignment",
    }
    assert items["open_cases"]["options"]["handling"] == ["keep", "censor", "exclude"]
    assert items["open_cases"]["decided"] is False and items["open_cases"]["history"] == []

    first = c.post(base, json={"kind": "collapse_duplicates", "author": "steward"})
    assert first.status_code == 202, first.text
    first_body = first.json()
    assert first_body["appliedTo"] == ct
    assert wait_job(c, first_body["job"]["id"], timeout=180)["status"] == "done"

    # the second decision is taken from the *original* screen and must still accumulate (R3-O3)
    second = c.post(base, json={"kind": "open_cases", "params": {"handling": "exclude"}, "author": "steward"})
    assert second.status_code == 202, second.text
    second_body = second.json()
    assert second_body["appliedTo"] == first_body["caseTable"]["id"] != ct
    assert wait_job(c, second_body["job"]["id"], timeout=180)["status"] == "done"
    head_id = second_body["caseTable"]["id"]
    mapping = c.get(f"/api/v1/projects/{pid}/case-tables/{head_id}/mapping").json()
    assert [d["kind"] for d in mapping["decisions"]] == ["collapse_duplicates", "open_cases"]
    assert mapping["dedupe"] is True and mapping["openCases"] == "exclude"

    listed = c.get(f"/api/v1/projects/{pid}/decisions", params={"caseTableId": ct}).json()
    assert [d["kind"] for d in listed] == ["collapse_duplicates", "open_cases"]

    # decide again: the options are still there, the one in force is marked, the history is kept
    again = c.get(base).json()
    assert [x["caseTableId"] for x in again["lineage"]] == [ct, first_body["caseTable"]["id"], head_id]
    now = {i["kind"]: i for i in again["items"]}
    assert now["open_cases"]["decided"] and now["open_cases"]["selected"]["handling"] == "exclude"
    assert now["open_cases"]["currentValue"] == "exclude"
    assert now["open_cases"]["options"]["handling"] == ["keep", "censor", "exclude"], "the full option set stays"
    assert now["open_cases"]["canDecideAgain"] and len(now["open_cases"]["history"]) == 1
    assert now["collapse_duplicates"]["decided"] and now["collapse_duplicates"]["currentValue"] is True

    revised = c.post(base, json={"kind": "open_cases", "params": {"handling": "censor"}, "note": "changed my mind"})
    assert revised.status_code == 202, revised.text
    assert revised.json()["appliedTo"] == head_id
    assert wait_job(c, revised.json()["job"]["id"], timeout=180)["status"] == "done"
    final = c.get(base).json()
    revised_item = {i["kind"]: i for i in final["items"]}["open_cases"]
    assert revised_item["currentValue"] == "censor" and len(revised_item["history"]) == 2
    assert revised_item["history"][0]["note"] == "changed my mind"
    final_mapping = c.get(f"/api/v1/projects/{pid}/case-tables/{final['caseTableId']}/mapping").json()
    assert [d["kind"] for d in final_mapping["decisions"]] == ["collapse_duplicates", "open_cases", "open_cases"]
    assert final_mapping["openCases"] == "censor"

    readiness = c.get(f"/api/v1/projects/{pid}/case-tables/{final['caseTableId']}").json()["readiness"]
    censored_item = {i["id"]: i for i in readiness["items"]}["right_censored"]
    assert censored_item["decision"]["options"]["handling"] == ["keep", "censor", "exclude"]
    assert censored_item["decision"]["selected"]["handling"] == "censor"
    assert censored_item["decision"]["timesDecided"] == 2 and censored_item["decision"]["canDecideAgain"]


def test_flow_type_assignment_uses_the_mapping_and_says_when_it_is_already_typed(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    base = f"/api/v1/projects/{pid}/case-tables/{ct}/decisions"
    preview = c.post(f"{base}/preview", json={"kind": "flow_type_assignment"})
    assert preview.status_code == 200, preview.text
    detail = preview.json()["preview"]["detail"]
    assert detail["rulesFrom"] == "mapping" and detail["alreadyTyped"] is True
    assert set(detail["counts"]) == {"with GR", "no GR"} and sum(detail["counts"].values()) == world["cases"]
    assert "already types" in detail["message"] and preview.json()["preview"]["cases"] == 0

    # applying it changes nothing and says so instead of reporting "0 of 600 cases affected"
    applied = c.post(base, json={"kind": "flow_type_assignment"})
    assert applied.status_code == 409 and applied.json()["code"] == "decision.already_typed"
    assert "already types" in applied.json()["detail"]

    # a different rule set is a real assignment
    other = c.post(
        f"{base}/preview",
        json={
            "kind": "flow_type_assignment",
            "params": {"rules": [{"name": "invoiced", "rule": {"has": ["Record Invoice Receipt"]}}]},
        },
    ).json()["preview"]
    assert other["detail"]["rulesFrom"] == "request" and other["detail"]["alreadyTyped"] is False
    assert other["cases"] > 0 and "would change flow type" in other["detail"]["message"]


# ---------------------------------------------------------------- R3-O7 the run screen, plain first
def test_run_manifest_separates_the_plain_block_from_the_fingerprints(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    m = c.get(f"/api/v1/projects/{pid}/runs/{rid}/manifest").json()
    labels = [r["label"] for r in m["plain"]]
    assert labels[:6] == ["Log", "Expectations", "Perspective", "Grouped by", "Ranked by", "Small groups"]
    assert "End of the data" in labels and "Data caveats" in labels
    joined = " ".join(f"{r['label']} {r['value']} {r['note'] or ''}" for r in m["plain"])
    for forbidden in ("sha256", "fingerprint", "paramsHash"):
        assert forbidden.lower() not in joined.lower(), "the plain block carries no hashes"
    assert len(joined) < 4000
    assert m["technical"]["paramsHash"] and m["technical"]["normFingerprint"]
    assert m["technical"]["artefacts"] and m["caseNoun"]
    assert isinstance(m["uncalibrated"], list)


# ---------------------------------------------------------------- R2-09 uncalibrated expectations
def test_uncalibrated_expectations_are_flagged_on_the_list(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="vendor", view="Finance", minCases=1, pageSize=1)
    flags = page["params"]["uncalibrated"]
    assert isinstance(flags, list)
    for f in flags:
        assert f["reason"] in ("almost_always_missed", "almost_never_missed", "declared")
        assert f["text"].endswith(".") and f["evaluated"] > 0
        if f["reason"] == "almost_always_missed":
            assert f["share_violated"] > 0.90 and "threshold to calibrate" in f["text"]
        if f["reason"] == "almost_never_missed":
            assert f["share_violated"] < 0.01 and "cannot fail" in f["text"]


# ---------------------------------------------------------------- RK-2, RK-3 guidance and the hub
def test_guidance_and_hub_serve_the_pack(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    hub = c.get(f"/api/v1/projects/{pid}/knowledge/hub").json()
    assert hub["pack"] == "p2p" and hub["case_noun"] and len(hub["nodes"]) > 100 and hub["edges"]
    kinds = {n["kind"] for n in hub["nodes"]}
    assert {"stage", "layer", "expectation", "failure_mode", "reason", "action", "kpi"} <= kinds
    layer = next(n for n in hub["nodes"] if n["kind"] == "layer")
    page = c.get(f"/api/v1/projects/{pid}/knowledge/hub/{layer['id']}").json()
    assert page["node"]["id"] == layer["id"] and page["guidance"]["plain_name"]
    assert page["related"]["expectations"] and "meaning_when_missed" in page["guidance"]

    guidance = c.get(f"/api/v1/projects/{pid}/guidance/layer/{layer['method_name'] or layer['id']}")
    # the pack's layer ids differ per template; the hub node id always resolves
    assert guidance.status_code in (200, 404)
    assert c.get(f"/api/v1/projects/{pid}/guidance/constraint/nope").status_code == 404
    assert c.get(f"/api/v1/projects/{pid}/knowledge/hub/layer:nope").status_code == 404


def test_a_project_can_write_its_own_note_on_an_entry(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    hub = c.get(f"/api/v1/projects/{pid}/knowledge/hub").json()
    node = next(n for n in hub["nodes"] if n["kind"] == "layer")
    entry = node["id"].split(":", 1)[1]
    r = c.put(
        f"/api/v1/projects/{pid}/guidance/layer/{entry}",
        json={"note": "we call this ageing", "owner_role": "AP lead", "author": "process owner"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["overlay"]["note"] == "we call this ageing" and body["overlay"]["owner_role"] == "AP lead"
    assert body["generic"] is not None, "the overlay is added to the generic tier, not instead of it"
    again = c.get(f"/api/v1/projects/{pid}/guidance/layer/{entry}").json()
    assert again["overlay"]["note"] == "we call this ageing"
    marked = c.get(f"/api/v1/projects/{pid}/knowledge/hub").json()
    assert any(n.get("hasOverlay") for n in marked["nodes"]) and marked["overlays"] == 1
    bad = c.put(f"/api/v1/projects/{pid}/guidance/layer/{entry}", json={"nope": 1})
    assert bad.status_code == 422


# ---------------------------------------------------------------- R3-O6 the norm builder's pickers
def test_norm_inventory_lists_activities_and_attribute_values_with_counts(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    inv = c.get(f"/api/v1/projects/{pid}/norms/inventory", params={"caseTableId": ct}).json()
    assert inv["cases"] == world["cases"] and inv["events"] > inv["cases"]
    assert inv["activities"] and all(a["events"] >= a["cases"] > 0 for a in inv["activities"])
    assert any(a["stage"] for a in inv["activities"]), "the pack places activities in stages"
    assert "vendor" in inv["attributeNames"] and "spend_area" in inv["attributeNames"]
    by_name = {a["name"]: a for a in inv["attributes"]}
    assert by_name["spend_area"]["kind"] == "text" and by_name["spend_area"]["values"]
    assert sum(v["cases"] for v in by_name["spend_area"]["values"]) <= world["cases"]
    one = c.get(
        f"/api/v1/projects/{pid}/norms/inventory", params={"caseTableId": ct, "attribute": "vendor", "limit": 5}
    ).json()
    assert one["activities"] == [] and len(one["attributes"]) == 1
    assert len(one["attributes"][0]["values"]) <= 5 and one["attributes"][0]["total"] >= 5
    bad = c.get(f"/api/v1/projects/{pid}/norms/inventory", params={"caseTableId": ct, "attribute": "nope"})
    assert bad.status_code == 404


def test_a_constraint_is_checked_and_rendered_in_one_sentence(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    body = {
        "caseTableId": ct,
        "constraint": {
            "id": "c_probe",
            "layer": "L3",
            "type": "lag",
            "params": {
                "a": ["Record Invoice Receipt"],
                "b": ["Clear Invoice"],
                "delta": 30,
                "width": 60,
                "unit": "D",
            },
            "applicability": {"attr": "flow_type", "in": ["with GR"]},
            "description": "Paid within terms",
        },
    }
    out = c.post(f"/api/v1/projects/{pid}/norms/constraints/check", json=body).json()
    assert out["valid"] and out["type"] == "lag"
    assert "after Record Invoice Receipt, Clear Invoice follows within 30 days" in out["sentence"]
    assert out["applicability_sentence"] == "applies when flow_type is one of with GR"
    assert all(a["known"] for a in out["activities"])
    assert 0 < out["casesInScope"] <= world["cases"] and out["casesEvaluated"] >= 0
    assert out["note"] and "miss it" in out["note"]

    unknown = c.post(
        f"/api/v1/projects/{pid}/norms/constraints/check",
        json={
            "caseTableId": ct,
            "constraint": {"id": "x", "layer": "L1", "type": "presence", "params": {"activity": "Nope", "m": 1}},
        },
    ).json()
    assert not unknown["valid"] and "never occurs" in unknown["errors"][0]["message"]
    assert unknown["sentence"].endswith("Nope happens at least once.")

    broken = c.post(
        f"/api/v1/projects/{pid}/norms/constraints/check",
        json={"caseTableId": ct, "constraint": {"id": "x", "layer": "L1", "type": "nope", "params": {}}},
    ).json()
    assert not broken["valid"] and broken["sentence"] is None


def test_the_guidance_questions_come_with_the_pack_s_text_as_a_starting_answer(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    hub = c.get(f"/api/v1/projects/{pid}/knowledge/hub").json()
    entry = next(n for n in hub["nodes"] if n["kind"] == "layer")["id"].split(":", 1)[1]
    qs = c.get(f"/api/v1/projects/{pid}/norms/guidance-questions", params={"kind": "layer", "id": entry}).json()
    assert [q["id"] for q in qs["questions"]] == [
        "plain_name",
        "expectation",
        "meaning_when_missed",
        "usual_reasons",
        "usual_actions",
    ]
    assert all(q["question"].endswith("?") for q in qs["questions"])
    assert qs["questions"][0]["suggested"], "the pack's plain name is offered"
    norms = c.get(f"/api/v1/projects/{pid}/norms").json()
    assert isinstance(norms[0]["guidance_missing"], list) and isinstance(norms[0]["uncalibrated"], list)


# ---------------------------------------------------------------- R1-12, R1-15, R2-01 the review records
def _worst(world: dict[str, Any]) -> dict[str, Any]:
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=1, pageSize=50)
    return page["rows"][0]


def test_gates_block_a_hypothesis_until_they_are_waived_with_a_note(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    row = _worst(world)
    params = {"slicing": "company,spend_area", "key": row["key"], "view": "Finance"}
    gates = c.get(f"/api/v1/projects/{pid}/runs/{rid}/gates", params=params).json()
    assert [g["id"] for g in gates["gates"]] == ["readiness", "censoring", "replication", "domain", "run_readiness"]
    assert all(g["text"] for g in gates["gates"]) and gates["cases"] == row["n_cases"]

    body = {
        "runId": rid,
        "slicing": "company,spend_area",
        "sliceKey": row["key"],
        "view": "Finance",
        "constraint_id": "c1",
        "expected_direction": "higher",
        "author": "analyst",
    }
    first = c.post(f"/api/v1/projects/{pid}/hypotheses", json=body)
    if gates["blocking"]:
        assert first.status_code == 409 and first.json()["code"] == "review.gate_failed"
        # a waive without a note is refused
        for gate in gates["blocking"]:
            bad = c.post(
                f"/api/v1/projects/{pid}/runs/{rid}/gates/{gate}",
                params={"slicing": "company,spend_area", "key": row["key"]},
                json={"status": "waived"},
            )
            assert bad.status_code == 422 and bad.json()["code"] == "gate.note"
            ok = c.post(
                f"/api/v1/projects/{pid}/runs/{rid}/gates/{gate}",
                params={"slicing": "company,spend_area", "key": row["key"]},
                json={"status": "waived", "note": "known and accepted for this claim", "author": "analyst"},
            )
            assert ok.status_code == 200, ok.text
        after = c.get(f"/api/v1/projects/{pid}/runs/{rid}/gates", params=params).json()
        assert after["blocking"] == [] and after["passed"]
        decided = {g["id"]: g for g in after["gates"]}
        for gate in gates["blocking"]:
            assert decided[gate]["status"] == "waived" and decided[gate]["note"]
            assert decided[gate]["computed_status"] == "failed"
        first = c.post(f"/api/v1/projects/{pid}/hypotheses", json=body)
    assert first.status_code == 201, first.text
    hyp = first.json()
    assert hyp["kind"] == "hypothesis" and hyp["status"] == "open"
    assert hyp["statement_plain"].startswith("This group misses it more often")
    if hyp.get("test"):
        assert hyp["test"]["constraint_id"] == "c1" and len(hyp["test"]["interval"]) == 2
    listed = c.get(f"/api/v1/projects/{pid}/hypotheses", params={"runId": rid}).json()
    assert [h["id"] for h in listed] == [hyp["id"]]
    patched = c.patch(
        f"/api/v1/projects/{pid}/hypotheses/{hyp['id']}", json={"status": "supported", "note": "confirmed"}
    ).json()
    assert patched["status"] == "supported" and patched["outcome"] == "supported" and patched["note"] == "confirmed"
    assert c.post(f"/api/v1/projects/{pid}/hypotheses", json={**body, "constraint_id": ""}).status_code == 422


def test_findings_and_actions_are_saved_on_the_server(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    row = _worst(world)
    finding = c.post(
        f"/api/v1/projects/{pid}/findings",
        json={
            "title": "Approvals are repeated on this group",
            "runId": rid,
            "slicing": "company,spend_area",
            "sliceKey": row["key"],
            "evidence": ["hyp_1"],
            "author": "analyst",
        },
    )
    assert finding.status_code == 201, finding.text
    action = c.post(
        f"/api/v1/projects/{pid}/actions",
        json={
            "title": "Lock commercial fields after release",
            "runId": rid,
            "slicing": "company,spend_area",
            "sliceKey": row["key"],
            "mechanism": "changes after release reset the approval",
            "countermeasure": "system_setting",
            "owner_role": "purchasing",
            "due": "2026-12-01",
            "links": [finding.json()["id"]],
            "author": "process owner",
        },
    )
    assert action.status_code == 201, action.text
    saved = action.json()
    assert saved["status"] == "proposed" and saved["countermeasure"] == "system_setting"
    assert c.get(f"/api/v1/projects/{pid}/actions", params={"runId": rid}).json()[0]["id"] == saved["id"]
    # Agreement needs explicit decisions, independently of any earlier hypothesis test.
    gate_params = {"slicing": "company,spend_area", "key": row["key"], "view": saved["view"]}
    current_gates = c.get(f"/api/v1/projects/{pid}/runs/{rid}/gates", params=gate_params).json()["gates"]
    for gate in current_gates:
        if gate["status"] not in {"passed", "waived"}:
            decided = c.post(
                f"/api/v1/projects/{pid}/runs/{rid}/gates/{gate['id']}",
                params=gate_params,
                json={"status": "waived", "note": "Reviewed for this test action", "author": "process owner"},
            )
            assert decided.status_code == 200, decided.text
    moved = c.patch(f"/api/v1/projects/{pid}/actions/{saved['id']}", json={"status": "agreed"}).json()
    assert moved["status"] == "agreed"
    bad = c.post(f"/api/v1/projects/{pid}/actions", json={"title": "x", "countermeasure": "wishful_thinking"})
    assert bad.status_code == 422 and bad.json()["errors"], bad.text


def test_what_can_we_do_lists_reasons_and_actions_with_owner_and_headroom(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    row = _worst(world)
    params = {"slicing": "company,spend_area", "key": row["key"], "view": "Finance", "top": 3}
    out = c.get(f"/api/v1/projects/{pid}/runs/{rid}/what-can-we-do", params=params).json()
    assert out["reading"] and out["caseNoun"] and out["drivers"]
    assert len(out["drivers"]) <= 3
    top = out["drivers"][0]
    assert top["constraint_id"] and top["share_of_shortfall"] is not None
    assert top["headroom_points"] is not None
    assert [g["id"] for g in out["gates"]] == ["readiness", "censoring", "replication", "domain", "run_readiness"]
    assert isinstance(out["actions"], list)
