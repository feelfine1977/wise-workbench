"""Cycle 2 through the API on the synthetic P2P log (packages/wise-analytics ``generate``, planted artefacts).

Covers R1-01 (analytics wired in), R1-02 (one censoring definition), R1-08 (norm warnings), R1-09 (robust
histograms), R2-O10 (flow-type fork), R2-O11 (notebook), R2-O1 (caveat actions), R2-O2 (slice designer),
R2-O7 (flow filter and focus).
"""

from __future__ import annotations

import io
import json
import re
import time
import zipfile
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app

wa = pytest.importorskip("wise_analytics")

MAPPING = {
    "caseId": "case",
    "activity": "activity",
    "timestamp": "time",
    "caseAttributes": ["company", "spend_area", "vendor", "document", "flow_type"],
    "exposure": "net_worth",
    "headerEvents": ["Create Purchase Order Item"],
    "closureActivities": ["Clear Invoice"],
}
SLICINGS = [
    {"attributes": ["vendor"]},
    {"attributes": ["company", "spend_area"]},
    {"attributes": ["company", "exposure"], "bands": [{"attribute": "exposure", "method": "quantile", "q": 3}]},
]
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _wait_analytics(client: TestClient, pid: str, run_id: str, timeout: float = 120.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = client.get(f"/api/v1/projects/{pid}/runs/{run_id}/analytics").json()
        if st["status"] == "done":
            return st
        time.sleep(0.1)
    raise AssertionError("analytics did not finish")


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Any]]:
    """A project with the synthetic log (planted censoring, replication, sentinel dates, duplicates), a norm and a
    scored run with its analytics."""
    slog, truth = wa.generate("p2p", n_cases=600, seed=3, artefacts=wa.synthetic.DEFAULT_ARTEFACTS)
    app = create_app(make_settings(tmp_path_factory.mktemp("cycle2"), inprocess_worker=True))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Synthetic P2P", "process": "p2p"}).json()["id"]
        csv = slog.events.to_csv(index=False).encode()
        job = client.post(
            f"/api/v1/projects/{pid}/datasets", files={"file": ("synthetic.csv", io.BytesIO(csv), "text/csv")}
        ).json()
        assert wait_job(client, job["id"])["status"] == "done"
        dataset = job["resultRef"].split(":")[1]
        r = client.post(f"/api/v1/projects/{pid}/datasets/{dataset}/mappings", json=MAPPING)
        assert r.status_code == 202, r.text
        job = wait_job(client, r.json()["id"])
        assert job["status"] == "done", job
        ct = job["resultRef"].split(":")[1]
        norm = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": truth.norm.to_dict(), "note": "synthetic"})
        assert norm.status_code == 201, norm.text
        body = {"caseTableId": ct, "normVersionId": norm.json()["id"], "slicings": SLICINGS, "gamma": 2, "minCases": 5}
        run = client.post(f"/api/v1/projects/{pid}/runs", json=body).json()
        assert wait_job(client, run["jobId"], timeout=120)["status"] == "done"
        analytics = _wait_analytics(client, pid, run["id"])
        yield {
            "client": client,
            "pid": pid,
            "dataset": dataset,
            "ct": ct,
            "norm": norm.json(),
            "run": run,
            "body": body,
            "analytics": analytics,
            "log": slog,
            "truth": truth,
        }


def _backlog(w: dict[str, Any], **params: Any) -> dict[str, Any]:
    r = w["client"].get(f"/api/v1/projects/{w['pid']}/runs/{w['run']['id']}/backlog", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------- R1-01 analytics wired in
def test_analytics_job_runs_after_scoring_and_caches_records(world: dict[str, Any]) -> None:
    st = world["analytics"]
    assert st["status"] == "done" and st["package"]["available"] and st["windowEnd"]
    manifest = st["manifest"]
    records = manifest["records"]
    assert not [k for k, v in records.items() if "error" in v], records
    assert records["readiness"]["recordId"] and manifest["readinessStatus"] in ("pass", "warn", "fail")
    assert records["bootstrap_backlog:vendor:Finance"]["badges"]
    assert "comparisons:company+exposure:q3:Finance" in records and "problem_kinds:vendor" in records
    run_dir = world["client"].app.state.container.workspace.run_dir(world["pid"], world["run"]["id"])
    parquet = list((run_dir / "analytics" / "bootstrap_backlog").glob("*.parquet"))
    assert parquet and all(p.with_suffix(".json").exists() for p in parquet)
    record = json.loads(parquet[0].with_suffix(".json").read_text())["record"]
    assert record["analytic"] == "bootstrap_backlog" and len(record["record_id"]) == 64 and record["log_fingerprint"]
    # on demand: a second request reuses the queued/finished state without failing
    r = world["client"].post(f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/analytics")
    assert r.status_code == 202 and r.json()["kind"] == "analytics"


def test_backlog_rows_carry_the_cycle2_fields(world: dict[str, Any]) -> None:
    page = _backlog(world, slicing="vendor", view="Finance", minCases=5)
    p = page["params"]
    assert p["window_end"] and p["case_noun"] == "purchase order items" and p["analytics_available"] is True
    assert set(p["analytics_record_ids"]) >= {"readiness", "bootstrap_backlog"}
    rows = page["rows"]
    assert rows and {r["stability"] for r in rows} <= {"stable", "fragile", "insufficient_support"}
    top = rows[0]
    assert top["stability"] != "unknown" and top["stability_reason"] and top["p_top"] is not None
    assert top["kind"] in ("acute", "systematic", "widespread") and top["kind_source"] == "analytics"
    assert (top["kind_reading"].startswith(top["kind"]) and "purchase order items" in top["kind_reading"]) or top[
        "kind"
    ] == "systematic"
    assert top["case_noun"] == "purchase order items"
    assert "points below the overall score" in top["points_below"]
    assert top["comparison"] and ("here against" in top["comparison"] or "no material difference" in top["comparison"])
    assert "constraint" not in top["comparison"] and "c2" not in top["comparison"].split()
    # the sentence is readable for every kind: it names the expectation first and never prints a zero difference
    for r in rows:
        if r["comparison"]:
            assert r["comparison_kind"] in ("lag", "count", "share", "metric", "rate", "none"), r["comparison"]
            assert not re.search(r"\((?:\+|-|±)0(?:\.0)?(?: [^)]*)?\)", r["comparison"]), r["comparison"]
            if r["comparison_kind"] == "rate":
                assert ": missed in " in r["comparison"] and "points)" in r["comparison"], r["comparison"]
            if r["comparison_kind"] == "count":
                assert " per purchase order item here against " in r["comparison"], r["comparison"]
    # the method's reading agrees with the confidence word of the badge
    words = {"stable": "high", "fragile": "medium", "insufficient_support": "not enough cases to be sure"}
    for r in rows:
        if r["gap"] > 0:
            assert f"confidence in rank: {words[r['stability']]}" in r["reading"], r["reading"]
    assert top["plain_layer"] and top["reading_plain"].startswith(f"{top['keys']['vendor']}: ")
    assert "purchase order items" in top["reading_plain"] and "confidence" in top["reading_plain"]
    # caveats name the window end; the planted artefacts touch some groups
    with_caveats = [r for r in rows if r["caveats"]]
    assert with_caveats, "no group carries a caveat although censoring and replication were planted"
    caveat = with_caveats[0]["caveats"][0]
    assert caveat["id"] in ("censoring", "replication", "duplicates", "sentinel_dates", "window_edge")
    assert 0 < caveat["share"] <= 1 and "purchase order items" in caveat["text"]
    if caveat["id"] in ("censoring", "window_edge"):
        assert caveat["window_end"] and caveat["window_end"] in caveat["text"]
    # the confidence filter
    stable = _backlog(world, slicing="vendor", view="Finance", minCases=5, stability="stable")
    assert all(r["stability"] == "stable" for r in stable["rows"])
    assert stable["total"] == sum(1 for r in rows if r["stability"] == "stable")
    # the plain kind filter uses the analytics kind
    kinds = _backlog(world, slicing="vendor", view="Finance", minCases=5, kind=top["kind"])
    assert all(r["kind"] == top["kind"] for r in kinds["rows"]) and kinds["total"] >= 1


def test_stability_matches_the_analytics_package(world: dict[str, Any]) -> None:
    import wise

    page = _backlog(world, slicing="vendor", view="Finance", minCases=1, pageSize=200, sort="rank")
    log, truth = world["log"], world["truth"]
    # the API's log is the case table's typed events, so score the same log the service scored
    result = wise.score(log, truth.norm)
    u = wa.bootstrap_backlog(result, ["vendor"], "Finance", gamma=2.0, B=200, seed=0, min_cases=1)
    expected = u.table["stability"].to_dict()
    for r in page["rows"]:
        assert r["stability"] == expected[r["keys"]["vendor"]], r["keys"]


def test_slice_detail_carries_contrast_headroom_caveats_subgroups_and_guidance(world: dict[str, Any]) -> None:
    page = _backlog(world, slicing="vendor", view="Finance", minCases=5)
    key = page["rows"][0]["key"]
    r = world["client"].get(
        f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/slices/{key}",
        params={"slicing": "vendor", "view": "Finance"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    cols = d["contrast"]["columns"]
    assert {
        "constraint",
        "plain",
        "share_missed_group",
        "share_missed_elsewhere",
        "risk_difference",
        "rd_lo",
        "rd_hi",
        "median_group",
        "median_elsewhere",
        "shift",
        "share_of_shortfall",
        "delta",
    } <= set(cols)
    rows = [dict(zip(cols, row)) for row in d["contrast"]["rows"]]
    assert rows and abs(sum(x["delta"] for x in rows) - (d["row"]["global_mean"] - d["row"]["mean_score"])) < 1e-9
    top = rows[0]
    assert top["rd_lo"] <= top["risk_difference"] <= top["rd_hi"]
    hcols = d["headroom"]["columns"]
    assert hcols[:2] == ["constraint", "plain"] and {"gain_points", "gain_percent", "stable_PI_after"} <= set(hcols)
    hrows = [dict(zip(hcols, row)) for row in d["headroom"]["rows"]]
    assert abs(sum(x["gain_points"] for x in hrows) / 100 - (1 - d["row"]["mean_score"])) < 1e-9
    assert d["subgroups"]["columns"][:4] == ["attribute", "value", "cases", "share"]
    assert {row[0] for row in d["subgroups"]["rows"]} >= {"flow_type", "start_Q"}
    assert d["guidance_refs"] and d["guidance_refs"][0]["kind"] == "layer"
    assert d["reading_plain"].startswith(page["rows"][0]["keys"]["vendor"]) and "points" in d["reading_plain"]
    assert (
        d["comparison"]
        and d["comparisons"]["columns"]
        and set(d["analytics"]["recordIds"]) >= {"contrast_slice", "headroom"}
    )
    assert d["params"]["window_end"] and d["params"]["case_noun"] == "purchase order items"
    assert isinstance(d["caveats"], list)


# ---------------------------------------------------------------------------- R1-02 one censoring definition
def test_one_window_end_in_readiness_validation_and_gate(world: dict[str, Any]) -> None:
    import wise

    c = world["client"]
    table = c.get(f"/api/v1/projects/{world['pid']}/case-tables/{world['ct']}").json()
    readiness = table["readiness"]
    assert readiness["windowEnd"] and readiness["caseNoun"] == "purchase order items"
    items = {i["id"]: i for i in readiness["items"]}
    window = items["window"]
    assert window["evidence"]["windowEnd"] == readiness["windowEnd"] and "window end" in window["message"]
    # the planted 2099 placeholder date pushes the library's robust end out; the gate falls back to the bulk end
    assert "bulk" in window["evidence"]["windowEndSource"], window["evidence"]["windowEndSource"]
    censored = items["right_censored"]
    assert censored["evidence"]["windowEnd"] == readiness["windowEnd"]
    assert censored["evidence"]["cases"] > 0 and readiness["windowEnd"][:10] in censored["message"]
    assert censored["decision"]["kind"] == "open_cases"
    # the same number from the library with the same window end
    ws = c.app.state.container.workspace
    mapping = c.app.state.container.repos.get_mapping(table["mappingId"])
    from wise_workbench.adapters.engine.logs import build_log
    from wise_workbench.adapters.storage.parquet import read_frame

    log = build_log(read_frame(ws.case_table_dir(world["pid"], world["ct"]) / "events.parquet"), mapping, typed=True)
    lib = wise.right_censored(log, ["Clear Invoice"], window="60D", window_end=readiness["windowEnd"])
    assert int(lib.sum()) == censored["evidence"]["cases"]
    # the run's manifest, the backlog parameters and the analytics gate print the same end
    run = c.get(f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}").json()
    assert run["manifest"]["windowEnd"] == readiness["windowEnd"]
    page = _backlog(world, slicing="vendor", view="Finance", minCases=5)
    assert page["params"]["window_end"] == readiness["windowEnd"]
    assert world["analytics"]["manifest"]["windowEnd"] == readiness["windowEnd"]
    # the validation table's censored share of a group equals its censoring caveat share
    with_caveat = next(r for r in page["rows"] if any(x["id"] == "censoring" for x in r["caveats"]))
    share = next(x["share"] for x in with_caveat["caveats"] if x["id"] == "censoring")
    diag = c.get(
        f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/diagnostics",
        params={"slicing": "vendor", "view": "Finance"},
    ).json()
    cols = diag["columns"]
    row = next(r for r in diag["rows"] if str(r[cols.index("vendor")]) == with_caveat["keys"]["vendor"])
    assert abs(row[cols.index("censored_share")] - share) < 1e-9
    # duplicates: the backend's count is the gate's key (case, activity, timestamp)
    dup = items["duplicate_events"]["evidence"]["events"]
    assert dup == int(log.events.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col]).sum())
    gate_ids = [i for i in items if i.startswith("gate:")]
    assert "gate:replication" in gate_ids and "gate:logging_asymmetry" in gate_ids


# ---------------------------------------------------------------------------- R1-08 norm warnings, R1-09 histograms
def test_norm_warnings_and_caveat_on_cards(world: dict[str, Any]) -> None:
    c = world["client"]
    doc = json.loads(json.dumps(world["norm"]["norm"]))
    doc["constraints"].append(
        {
            "id": "c_ghost",
            "layer": doc["layers"][0]["id"],
            "type": "presence",
            "params": {"activity": ["Vendor creates credit memo"], "m": 1},
            "description": "A credit memo exists",
        }
    )
    r = c.post(f"/api/v1/projects/{world['pid']}/norms", json={"norm": doc, "note": "with a ghost activity"})
    assert r.status_code == 201, r.text
    nv = r.json()
    assert any("Vendor creates credit memo" in w and "never occurs" in w for w in nv["warnings"]), nv["warnings"]
    assert nv["guidance_complete"] is False
    again = c.get(f"/api/v1/projects/{world['pid']}/norms/{nv['id']}", params={"caseTableId": world["ct"]}).json()
    assert again["warnings"] == nv["warnings"]
    check = c.post(f"/api/v1/projects/{world['pid']}/norms/{nv['id']}/check", json={"caseTableId": world["ct"]}).json()
    assert check["warnings"] == nv["warnings"]
    run = c.post(
        f"/api/v1/projects/{world['pid']}/runs",
        json={**world["body"], "normVersionId": nv["id"], "slicings": [{"attributes": ["vendor"]}]},
    ).json()
    assert wait_job(c, run["jobId"], timeout=120)["status"] == "done"
    got = c.get(f"/api/v1/projects/{world['pid']}/runs/{run['id']}").json()
    assert got["manifest"]["normWarnings"] == nv["warnings"]
    page = c.get(
        f"/api/v1/projects/{world['pid']}/runs/{run['id']}/backlog",
        params={"slicing": "vendor", "view": "Finance", "minCases": 1, "pageSize": 200},
    ).json()
    layer = doc["layers"][0]["id"]
    flagged = [r for r in page["rows"] if r["dominant_layer"] == layer]
    for row in flagged:
        assert any(x["id"] == "norm_warning" and "never occurs" in x["text"] for x in row["caveats"]), row["caveats"]
    for row in page["rows"]:
        if row["dominant_layer"] != layer:
            assert not any(x["id"] == "norm_warning" for x in row["caveats"])


def test_robust_signal_histograms(world: dict[str, Any]) -> None:
    c = world["client"]
    base = f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/signals/c2"
    d = c.get(base).json()
    assert d["unit"] == "D" and d["threshold"] == 10 and d["saturation"] == 30 and d["scale"] == "linear"
    assert len(d["bins"]) >= 20
    assert [m["id"] for m in d["markers"]] == ["threshold", "saturation"] and "δ = 10 days" in d["markers"][0]["label"]
    stats = d["stats"]
    assert stats["rangeLow"] <= 10 <= 30 <= stats["rangeHigh"]
    assert stats["shareBeyondThresholdText"].endswith("beyond 10 days")
    assert abs(stats["shareBeyondThreshold"] - stats["shareAboveThreshold"]) < 1e-12
    inside = sum(b["n"] for b in d["bins"])
    beyond = d["beyond"]["n"] if d["beyond"] else 0
    below = d["below"]["n"] if d["below"] else 0
    assert inside + beyond + below == stats["n"]
    # a planted placeholder date makes lags of years: they land in the beyond bin, not in 40 bins of a decade each
    assert d["beyond"] is not None and d["beyond"]["x1"] == stats["max"] and stats["rangeHigh"] < stats["max"]
    log_scale = c.get(base, params={"scale": "log"}).json()
    assert log_scale["scale"] == "log" and log_scale["bins"][0]["x0"] > 0
    xs = [b["x0"] for b in log_scale["bins"]]
    assert xs == sorted(xs) and xs[-1] / xs[0] > 10
    flt = json.dumps({"and": [{"kind": "attribute", "field": "flow_type", "in": ["DF1"]}]})
    filtered = c.get(base, params={"filter": flt}).json()
    assert filtered["filter"]["and"][0]["kind"] == "attribute" and filtered["stats"]["n"] < d["stats"]["n"]
    assert filtered["windowEnd"]


# ---------------------------------------------------------------------------- R2-O10 flow-type fork
def test_flow_types_scope_and_comparison(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    r = c.get(f"/api/v1/projects/{pid}/case-tables/{ct}/flow-types", params={"attribute": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "flow_types.attribute"
    assert "low-cardinality" in r.json()["detail"]
    # the mapping has no flow typing rules, but the log carries a flow_type attribute
    ft = c.get(f"/api/v1/projects/{pid}/case-tables/{ct}/flow-types").json()
    assert ft["attribute"] == "flow_type" and ft["source"] == "attribute" and ft["windowEnd"]
    names = {t["name"]: t for t in ft["types"]}
    assert set(names) == {"DF1", "DF2"} and sum(t["cases"] for t in ft["types"]) == ft["cases"]
    df1 = names["DF1"]
    assert abs(df1["share"] - df1["cases"] / ft["cases"]) < 1e-12
    assert df1["map"]["nodes"] and df1["map"]["groups"] and df1["map"]["meta"]["cases"] == df1["cases"]
    assert "purchase order items" in df1["readiness"]["headline"] and df1["readiness"]["censoredShare"] is not None
    assert df1["scope"] == {"flow_type": "DF1", "attribute": "flow_type"}
    # the comparison of a run without scope
    cmp = c.get(
        f"/api/v1/projects/{pid}/runs/{world['run']['id']}/compare-flow-types", params={"attribute": "flow_type"}
    ).json()
    assert cmp["attribute"] == "flow_type" and set(cmp["views"]) == {"Finance", "Logistics"}
    by_name = {t["name"]: t for t in cmp["types"]}
    assert set(by_name) == {"DF1", "DF2"}
    for t in cmp["types"]:
        assert t["cases"] == names[t["name"]]["cases"]
        assert "mean_score" in t["views"]["Finance"] and "points_below" in t["views"]["Finance"]
        assert t["mostMissed"]["constraint"] and t["topGroups"] and t["topGroups"][0]["key"]
    # a scoped run: backlog, flow and signals restricted to the flow type; scope recorded in the manifest
    scoped = c.post(f"/api/v1/projects/{pid}/runs", json={**world["body"], "scope": df1["scope"]}).json()
    assert scoped["scope"] == {"flow_type": "DF1", "attribute": "flow_type"}, scoped
    assert wait_job(c, scoped["jobId"], timeout=120)["status"] == "done"
    got = c.get(f"/api/v1/projects/{pid}/runs/{scoped['id']}").json()
    assert got["manifest"]["scope"] == df1["scope"] and got["manifest"]["cases"] == df1["cases"]
    assert got["paramsHash"] != world["run"]["paramsHash"]
    page = c.get(
        f"/api/v1/projects/{pid}/runs/{scoped['id']}/backlog",
        params={"slicing": "vendor", "minCases": 1, "pageSize": 200},
    ).json()
    assert page["params"]["scope"] == df1["scope"] and page["params"]["cases"] == df1["cases"]
    assert sum(r["n_cases"] for r in page["rows"]) == df1["cases"]
    flow = c.get(f"/api/v1/projects/{pid}/runs/{scoped['id']}/flow", params={"abstraction": 0}).json()
    assert flow["meta"]["cases"] == df1["cases"] and flow["meta"]["scope"] == df1["scope"]
    summary = c.get(f"/api/v1/projects/{pid}/runs/{scoped['id']}/summary").json()
    assert summary["cases"] == df1["cases"]
    r = c.get(f"/api/v1/projects/{pid}/runs/{scoped['id']}/compare-flow-types", params={"attribute": "flow_type"})
    assert r.status_code == 422 and r.json()["code"] == "run.scoped"
    r = c.post(f"/api/v1/projects/{pid}/runs", json={**world["body"], "scope": {"flow_type": "nope"}})
    assert r.status_code == 202 or r.status_code == 200
    failed = wait_job(c, r.json()["jobId"], timeout=60) if r.json().get("jobId") else {"status": "done"}
    assert failed["status"] in ("failed", "done")
    r = c.post(f"/api/v1/projects/{pid}/runs", json={**world["body"], "scope": {"attribute": "nope", "value": "x"}})
    assert r.status_code == 422 and r.json()["code"] == "run.scope_attribute"


# ---------------------------------------------------------------------------- R2-O11 notebook
def test_notebook_snapshots_reorder_export(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    base = f"/api/v1/projects/{pid}/notebook"
    assert c.get(base).json() == {"projectId": pid, "snapshots": [], "exportFormats": ["markdown"]}
    payload = {
        "title": "Top vendors",
        "note": "V007 carries the largest shortfall.",
        "context": {
            "run_id": world["run"]["id"],
            "slicing": "vendor",
            "view": "Finance",
            "url": "/p/x/signals",
            "screen": "signals",
        },
        "data": {"rows": [{"key": "V007", "PI": 4.2}]},
        "author": "analyst",
    }
    r = c.post(
        f"{base}/snapshots",
        files={"image": ("shot.png", io.BytesIO(PNG), "image/png")},
        data={"payload": json.dumps(payload)},
    )
    assert r.status_code == 201, r.text
    s1 = r.json()
    assert s1["hasImage"] and s1["imageUrl"].endswith(f"/snapshots/{s1['id']}/image") and s1["order"] == 0
    assert s1["context"]["run_id"] == world["run"]["id"] and s1["data"]["rows"][0]["key"] == "V007"
    img = c.get(s1["imageUrl"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content == PNG
    s2 = c.post(f"{base}/snapshots", data={"title": "Flow of DF1", "note": "the map"}).json()
    assert s2["order"] == 1 and not s2["hasImage"]
    assert c.get(f"{base}/snapshots/{s2['id']}/image").status_code == 404
    r = c.post(f"{base}/snapshots", data={"payload": json.dumps({"title": ""})})
    assert r.status_code == 422 and r.json()["code"] == "snapshot.title"
    r = c.post(
        f"{base}/snapshots", files={"image": ("x.png", io.BytesIO(b"not a png"), "image/png")}, data={"title": "x"}
    )
    assert r.status_code == 422 and r.json()["code"] == "snapshot.image"
    r = c.post(f"{base}/snapshots", data={"payload": json.dumps({"title": "x", "context": {"nope": 1}})})
    assert r.status_code == 422 and r.json()["code"] == "snapshot.context"
    edited = c.patch(
        f"{base}/snapshots/{s1['id']}", json={"note": "edited note", "title": "Top vendors (Finance)"}
    ).json()
    assert (
        edited["note"] == "edited note"
        and edited["title"] == "Top vendors (Finance)"
        and edited["updatedAt"] >= s1["updatedAt"]
    )
    ordered = c.post(f"{base}/reorder", json={"ids": [s2["id"], s1["id"]]}).json()
    assert [s["id"] for s in ordered["snapshots"]] == [s2["id"], s1["id"]] and [
        s["order"] for s in ordered["snapshots"]
    ] == [0, 1]
    assert c.post(f"{base}/reorder", json={"ids": ["snap_nope"]}).status_code == 404
    ex = c.get(f"{base}/export", params={"format": "markdown"})
    assert ex.status_code == 200 and ex.headers["content-type"] == "application/zip"
    assert ex.headers["content-disposition"].endswith('notebook.zip"')
    z = zipfile.ZipFile(io.BytesIO(ex.content))
    names = z.namelist()
    assert "notebook.md" in names and any(n.startswith("images/02-") and n.endswith(".png") for n in names)
    md = z.read("notebook.md").decode()
    assert (
        md.startswith("# Synthetic P2P — analysis notebook")
        and "## 1. Flow of DF1" in md
        and "## 2. Top vendors (Finance)" in md
    )
    assert "![Top vendors (Finance)](images/02-top-vendors-finance.png)" in md and "edited note" in md
    assert f"run_id = {world['run']['id']}" in md and "Data: `data/02-top-vendors-finance.json`" in md
    r = c.get(f"{base}/export", params={"format": "pptx"})
    assert r.status_code == 422 and r.json()["code"] == "notebook.format"
    assert "not available yet" in r.json()["detail"] and "cycle" not in r.json()["detail"]
    assert c.delete(f"{base}/snapshots/{s1['id']}").status_code == 204
    assert c.get(f"{base}/snapshots/{s1['id']}").status_code == 404
    left = c.get(base).json()["snapshots"]
    assert [s["id"] for s in left] == [s2["id"]] and left[0]["order"] == 0


# ---------------------------------------------------------------------------- R2-O1 caveat actions
def test_decision_preview_apply_and_rebuild(world: dict[str, Any]) -> None:
    c, pid, ct = world["client"], world["pid"], world["ct"]
    kinds = {k["kind"]: k for k in c.get(f"/api/v1/projects/{pid}/decisions/kinds").json()}
    assert set(kinds) == {
        "drop_outside_window",
        "sentinel_as_missing",
        "collapse_duplicates",
        "day_precision",
        "header_events",
        "open_cases",
        "zero_exposure",
        "flow_type_assignment",
    }
    table = c.get(f"/api/v1/projects/{pid}/case-tables/{ct}").json()
    items = {i["id"]: i for i in table["readiness"]["items"]}
    assert items["sentinel_dates"]["decision"]["kind"] == "sentinel_as_missing"
    assert items["duplicate_events"]["decision"]["kind"] == "collapse_duplicates"
    assert items["header_event_replication"]["decision"]["kind"] == "header_events"
    base = f"/api/v1/projects/{pid}/case-tables/{ct}/decisions"
    # previews
    pv = c.post(f"{base}/preview", json={"kind": "drop_outside_window"}).json()
    assert (
        pv["readinessItem"] == "timestamp_outliers"
        and pv["preview"]["events"] > 0
        and pv["preview"]["totalCases"] == table["cases"]
    )
    dup = c.post(f"{base}/preview", json={"kind": "collapse_duplicates"}).json()["preview"]
    assert dup["events"] == items["duplicate_events"]["evidence"]["events"] and 0 < dup["cases"] <= dup["events"]
    stamps = [v["timestamp"] for v in items["sentinel_dates"]["evidence"]["values"]]
    sen = c.post(f"{base}/preview", json={"kind": "sentinel_as_missing", "params": {"timestamps": stamps}}).json()[
        "preview"
    ]
    assert sen["events"] > 0 and sen["cases"] > 0
    oc = c.post(f"{base}/preview", json={"kind": "open_cases", "params": {"handling": "exclude"}}).json()["preview"]
    assert (
        oc["cases"] == items["right_censored"]["evidence"]["cases"]
        and oc["detail"]["windowEnd"] == table["readiness"]["windowEnd"]
    )
    ft = c.post(
        f"{base}/preview",
        json={
            "kind": "flow_type_assignment",
            "params": {"rules": [{"name": "with GR", "rule": {"has": ["Record Goods Receipt"]}}], "default": "other"},
        },
    ).json()["preview"]
    assert set(ft["detail"]["counts"]) <= {"with GR", "other"} and ft["cases"] == table["cases"]
    r = c.post(f"{base}/preview", json={"kind": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "decision.kind"
    r = c.post(f"{base}/preview", json={"kind": "day_precision"})
    assert r.status_code == 422 and r.json()["code"] == "decision.params"
    # apply: placeholder dates as missing → a child mapping, a new case table, readiness re-evaluated
    r = c.post(
        base,
        json={
            "kind": "sentinel_as_missing",
            "params": {"timestamps": stamps},
            "author": "data steward",
            "note": "SAP placeholder dates",
        },
    )
    assert r.status_code == 202, r.text
    applied = r.json()
    decision, new_table, job = applied["decision"], applied["caseTable"], applied["job"]
    assert (
        decision["version"] == 1
        and decision["readinessItem"] == "sentinel_dates"
        and decision["author"] == "data steward"
    )
    assert (
        decision["preview"]["events"] == sen["events"]
        and new_table["status"] == "building"
        and job["kind"] == "build_cases"
    )
    assert wait_job(c, job["id"], timeout=120)["status"] == "done"
    rebuilt = c.get(f"/api/v1/projects/{pid}/case-tables/{new_table['id']}").json()
    assert rebuilt["status"] == "ready" and rebuilt["cases"] == table["cases"]
    new_items = {i["id"]: i for i in rebuilt["readiness"]["items"]}
    still_listed = {
        v["timestamp"] for v in new_items.get("sentinel_dates", {"evidence": {"values": []}})["evidence"]["values"]
    }
    assert not (still_listed & set(stamps)), "the placeholder dates are no longer timestamps"
    assert new_items["missing_timestamps"]["evidence"]["events"] >= sen["events"]
    mapping = c.get(f"/api/v1/projects/{pid}/case-tables/{new_table['id']}/mapping").json()
    assert mapping["parentId"] == table["mappingId"] and mapping["decisions"][0]["kind"] == "sentinel_as_missing"
    # a second decision on the rebuilt table is version 2 and folds into the mapping
    r = c.post(
        f"/api/v1/projects/{pid}/case-tables/{new_table['id']}/decisions",
        json={"kind": "open_cases", "params": {"handling": "exclude"}},
    )
    assert r.status_code == 202, r.text
    second = r.json()
    assert second["decision"]["version"] == 2
    assert wait_job(c, second["job"]["id"], timeout=120)["status"] == "done"
    third = c.get(f"/api/v1/projects/{pid}/case-tables/{second['caseTable']['id']}").json()
    assert third["cases"] == table["cases"] - oc["cases"] or third["cases"] < table["cases"]
    m3 = c.get(f"/api/v1/projects/{pid}/case-tables/{third['id']}/mapping").json()
    assert m3["openCases"] == "exclude" and [d["kind"] for d in m3["decisions"]] == [
        "sentinel_as_missing",
        "open_cases",
    ]
    censored_after = {i["id"]: i for i in third["readiness"]["items"]}["right_censored"]
    assert censored_after["evidence"]["handling"] == "exclude" and "decision taken" in censored_after["message"]
    listed = c.get(f"/api/v1/projects/{pid}/decisions").json()
    assert [d["kind"] for d in listed] == ["sentinel_as_missing", "open_cases"] and listed[1][
        "caseTableId"
    ] == new_table["id"]
    # R3-O3: a case table's list is its whole lineage, so both decisions stay visible after the rebuild
    only = c.get(f"/api/v1/projects/{pid}/decisions", params={"caseTableId": ct}).json()
    assert [d["id"] for d in only] == [decision["id"], second["decision"]["id"]]


# ---------------------------------------------------------------------------- R2-O2 slice designer
def test_slice_designer_bands_drill_and_preview(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    page = _backlog(world, slicing="company+exposure:q3", view="Finance", minCases=1, pageSize=100)
    assert page["params"]["bands"] == [{"attribute": "exposure", "method": "quantile", "q": 3}]
    labels = {r["keys"]["exposure band"] for r in page["rows"]}
    assert (
        len(labels) == 3 and any(lab.startswith("<") for lab in labels) and any(lab.startswith("≥") for lab in labels)
    )
    assert page["rows"][0]["stability"] != "unknown"  # the banded run slicing has its own analytics
    row = page["rows"][0]
    detail = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/slices/{row['key']}",
        params={"slicing": "company+exposure:q3", "view": "Finance"},
    ).json()
    assert detail["row"]["keys"] == row["keys"] and detail["params"]["attributes"] == ["company", "exposure band"]
    assert detail["contrast"]["rows"] and detail["subgroups"]["rows"]
    # ad hoc bands with cut points on an attribute that is not reserved keep the attribute's name
    adhoc = _backlog(
        world,
        slicing="vendor,n_events",
        bands=json.dumps([{"attribute": "n_events", "method": "cuts", "cuts": [4, 6]}]),
        minCases=1,
        pageSize=300,
    )
    assert adhoc["params"]["slicing"] == "vendor,n_events" and {r["keys"]["n_events band"] for r in adhoc["rows"]} <= {
        "< 4",
        "4 – 6",
        "≥ 6",
    }
    r = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/backlog",
        params={"slicing": "vendor,company,spend_area,document", "minCases": 1},
    )
    assert r.status_code == 422 and r.json()["code"] == "run.slicing_too_wide"
    r = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/backlog",
        params={"slicing": "vendor", "bands": json.dumps([{"attribute": "exposure", "q": 4}])},
    )
    assert r.status_code == 422 and r.json()["code"] == "run.band_attribute"
    # drill into one group: the finer slicing restricted to it, same columns, baseline kept
    coarse = _backlog(world, slicing="company+spend_area", view="Finance", minCases=1)
    group = coarse["rows"][0]
    drill = _backlog(
        world,
        slicing="vendor",
        view="Finance",
        minCases=1,
        drillFrom="company+spend_area",
        drillKey=group["key"],
        pageSize=200,
    )
    assert drill["params"]["drill"]["key"] == json.loads(group["key"]) and drill["params"]["cases"] == group["n_cases"]
    assert sum(r["n_cases"] for r in drill["rows"]) == group["n_cases"]
    assert set(drill["rows"][0]) >= {"stability", "kind", "caveats", "points_below", "reading_plain", "case_noun"}
    assert abs(drill["globalMean"] - coarse["globalMean"]) < 1e-12 and drill["params"]["stability_applies"] is False
    r = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/backlog", params={"slicing": "vendor", "drillFrom": "company+spend_area"}
    )
    assert r.status_code == 422 and r.json()["code"] == "backlog.drill"
    # the preview of a slicing before it is run
    prev = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/slicings/preview",
        params={"slicing": "vendor,exposure", "bands": json.dumps([{"attribute": "exposure", "q": 4}]), "minCases": 5},
    ).json()
    assert prev["effectiveAttributes"] == ["vendor", "exposure band"] and prev["groups"] > 0 and prev["cases"] > 0
    assert (
        len(prev["bands"][0]["labels"]) == 4
        and sum(prev["bands"][0]["counts"]) + prev["bands"][0]["missing"] == prev["cases"]
    )
    assert prev["belowMinCases"] <= prev["groups"] and prev["largest"][0]["n_cases"] == prev["sizes"]["max"]


# ---------------------------------------------------------------------------- R2-O7 flow filter and focus
def test_flow_filter_focus_and_filter_preview(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    flt = {
        "and": [
            {"kind": "activity", "op": "contains", "activity": "Record Invoice Receipt"},
            {"kind": "open", "value": False},
            {"kind": "count", "activity": "Record Goods Receipt", "min": 1},
        ]
    }
    prev = c.get(f"/api/v1/projects/{pid}/runs/{rid}/filters/preview", params={"filter": json.dumps(flt)}).json()
    assert prev["cases_in"] + prev["cases_out"] == 600 and len(prev["per_clause"]) == 3
    assert all(x["removed_marginally"] >= 0 for x in prev["per_clause"]) and set(prev["in_scope_by_constraint"]) >= {
        "c1",
        "c2",
    }
    assert prev["in_scope_by_constraint"]["c1"] <= prev["cases_in"]
    flow = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/flow",
        params={"filter": json.dumps(flt), "focus": "Record Goods Receipt", "abstraction": 0},
    ).json()
    assert flow["meta"]["cases"] == prev["cases_in"] and flow["meta"]["filterCases"] == {
        "cases_in": prev["cases_in"],
        "cases_out": prev["cases_out"],
    }
    assert flow["meta"]["filter"] == flt and flow["meta"]["focus"]["id"] == "a_record_goods_receipt"
    paths = flow["paths"]
    assert paths["incoming"] and paths["outgoing"]
    inc = paths["incoming"][0]
    assert {"from", "node", "count", "cases", "median_lag", "violation_share"} <= set(inc) and 0 <= inc[
        "violation_share"
    ] <= 1
    assert all(p["node"].startswith("a_") for p in paths["outgoing"])
    assert flow["groups"], "stage lanes from the p2p pack"
    # focus by node id, and an unknown focus
    by_id = c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow", params={"focus": "a_record_goods_receipt"}).json()
    assert by_id["meta"]["focus"]["label"] == "Record Goods Receipt" and by_id["meta"]["focus"]["cases"] > 0
    assert c.get(f"/api/v1/projects/{pid}/runs/{rid}/flow", params={"focus": "nope"}).status_code == 404
    # filters on the backlog and the other clause kinds
    lag = json.dumps(
        {"and": [{"kind": "lag", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "unit": "D", "min": 10}]}
    )
    page = _backlog(world, slicing="vendor", view="Finance", minCases=1, filter=lag, pageSize=200)
    assert page["params"]["filter"]["and"][0]["kind"] == "lag" and 0 < page["params"]["cases"] < 600
    follows = json.dumps(
        {"and": [{"kind": "follows", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "directly": True}]}
    )
    assert (
        0
        < c.get(f"/api/v1/projects/{pid}/runs/{rid}/filters/preview", params={"filter": follows}).json()["cases_in"]
        <= 600
    )
    period = json.dumps({"and": [{"kind": "time", "field": "case_start", "from": "2024-01-01"}]})
    assert (
        0
        < c.get(f"/api/v1/projects/{pid}/runs/{rid}/filters/preview", params={"filter": period}).json()["cases_in"]
        < 600
    )
    for bad, code in (
        ("{", "filter.json"),
        (json.dumps({"and": [{"kind": "nope"}]}), "filter.clause"),
        (json.dumps({"and": [{"kind": "attribute", "field": "nope", "in": ["x"]}]}), "filter.attribute"),
    ):
        r = c.get(f"/api/v1/projects/{pid}/runs/{rid}/filters/preview", params={"filter": bad})
        assert r.status_code == 422 and r.json()["code"] == code, (bad, r.json())
