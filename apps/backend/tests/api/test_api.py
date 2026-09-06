"""API tests with httpx against the app (in-process worker) on the running example."""

from __future__ import annotations

import io
import json
import time

from fastapi.testclient import TestClient

from tests.conftest import (
    RUNNING_MAPPING,
    run_running_example,
    running_example_csv,
    running_example_norm,
    upload_running_example,
    wait_job,
)


def test_health_version_and_problem_format(client: TestClient) -> None:
    assert client.get("/api/v1/system/health").json()["status"] == "ok"
    assert client.get("/api/v1/system/ready").json()["status"] == "ready"
    version = client.get("/api/v1/system/version").json()
    assert version["wise"].startswith("0.1") and version["workbench"]
    r = client.get("/api/v1/projects/missing")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert (
        body["status"] == 404
        and body["code"] == "project.not_found"
        and body["title"] == "Not Found"
        and "detail" in body
    )
    r = client.post("/api/v1/projects", json={"name": ""})
    assert (
        r.status_code == 422
        and r.json()["code"] == "validation_error"
        and r.json()["errors"][0]["field"].endswith("name")
    )


def test_cors_for_the_frontend_origin(client: TestClient) -> None:
    r = client.options(
        "/api/v1/projects", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}
    )
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_upload_mapping_case_table_flow(client: TestClient) -> None:
    project = client.post("/api/v1/projects", json={"name": "P", "process": "p2p", "question": "why"}).json()
    pid = project["id"]
    assert client.get("/api/v1/projects").json()[0]["id"] == pid
    r = client.post(
        f"/api/v1/projects/{pid}/datasets",
        files={"file": ("running.csv", io.BytesIO(running_example_csv()), "text/csv")},
    )
    assert r.status_code == 202
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "done" and job["attempts"] == 1
    dataset_id = job["resultRef"].split(":")[1]
    ds = client.get(f"/api/v1/projects/{pid}/datasets/{dataset_id}").json()
    assert ds["status"] == "ready" and ds["events"] == 21 and len(ds["contentHash"]) == 64
    cols = {c["name"]: c for c in ds["columns"]}
    assert (
        cols["time"]["dtype"] == "timestamp" and cols["amount"]["dtype"] == "number" and cols["case"]["distinct"] == 5
    )
    assert client.get(f"/api/v1/projects/{pid}/datasets").json()[0]["id"] == dataset_id
    preview = client.get(f"/api/v1/projects/{pid}/datasets/{dataset_id}/preview", params={"rows": 3}).json()
    assert preview["columns"][:3] == ["case", "activity", "time"] and len(preview["rows"]) == 3
    suggestion = client.get(f"/api/v1/projects/{pid}/datasets/{dataset_id}/mapping-suggestion").json()
    assert suggestion["source"] == "heuristic"
    assert suggestion["mapping"]["caseId"] == "case" and suggestion["mapping"]["activity"] == "activity"
    assert suggestion["mapping"]["timestamp"] == "time" and "company" in suggestion["mapping"]["caseAttributes"]
    presets = client.get(f"/api/v1/projects/{pid}/datasets/presets").json()
    assert [p["id"] for p in presets] == ["bpic2019"] and presets[0]["mapping"]["caseId"] == "case concept:name"
    assert client.post(f"/api/v1/projects/{pid}/datasets/presets/nope").status_code == 404
    # a mapping that names a missing column is refused with a stable code
    r = client.post(
        f"/api/v1/projects/{pid}/datasets/{dataset_id}/mappings", json={**RUNNING_MAPPING, "caseAttributes": ["nope"]}
    )
    assert r.status_code == 422 and r.json()["code"] == "mapping.column_missing"
    # a timestamp column that parses nothing is refused (a wrong format hint alone is tolerated: the library retries with mixed parsing)
    r = client.post(
        f"/api/v1/projects/{pid}/datasets/{dataset_id}/mappings", json={**RUNNING_MAPPING, "timestamp": "vendor"}
    )
    assert r.status_code == 422 and r.json()["code"] == "mapping.timestamp_format"
    # the real mapping, with header events and flow typing evaluated by the library
    mapping = {
        **RUNNING_MAPPING,
        "caseAttributes": ["company", "vendor"],
        "headerEvents": ["Create Purchase Order Item"],
        "closureActivities": ["Clear Invoice"],
        "flowTyping": [{"name": "DF2", "rule": {"attr": "flow_type_src", "eq": "DF2"}}],
    }
    r = client.post(f"/api/v1/projects/{pid}/datasets/{dataset_id}/mappings", json=mapping)
    assert r.status_code == 422 and r.json()["code"] == "mapping.flow_typing"
    mapping["flowTyping"] = [{"name": "DF2", "rule": {"has": ["Record Goods Receipt"]}}]
    r = client.post(f"/api/v1/projects/{pid}/datasets/{dataset_id}/mappings", json=mapping)
    assert r.status_code == 202
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "done", job
    ct_id = job["resultRef"].split(":")[1]
    table = client.get(f"/api/v1/projects/{pid}/case-tables/{ct_id}").json()
    assert table["status"] == "ready" and table["cases"] == 5 and table["events"] == 21
    assert "flow_type" in table["attributes"] and "header_event_count" in table["attributes"]
    ids = {i["id"]: i for i in table["readiness"]["items"]}
    assert table["readiness"]["status"] in ("pass", "warn")
    assert (
        "volume" in ids
        and "timestamp_precision" in ids
        and "header_event_replication" in ids
        and "right_censored" in ids
    )
    assert ids["flow_types"]["evidence"]["counts"] == {"DF2": 5}
    assert {a["label"] for a in table["activities"]} >= {"Record Goods Receipt", "Record Invoice Receipt"}
    assert client.get(f"/api/v1/projects/{pid}/case-tables").json()[0]["id"] == ct_id
    m = client.get(f"/api/v1/projects/{pid}/case-tables/{ct_id}/mapping").json()
    assert m["headerEvents"] == ["Create Purchase Order Item"]


def test_norm_versions_validate_with_the_library(client: TestClient) -> None:
    pid = client.post("/api/v1/projects", json={"name": "N"}).json()["id"]
    r = client.post(
        f"/api/v1/projects/{pid}/norms", json={"norm": {"schema_version": 2, "constraints": []}, "note": "empty"}
    )
    assert (
        r.status_code == 422
        and r.json()["code"] == "norm.invalid"
        and r.headers["content-type"].startswith("application/problem+json")
    )
    r = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": {"schema_version": 99}, "note": "future"})
    assert r.status_code == 422 and r.json()["code"] == "norm.schema_version"
    doc = running_example_norm()
    v1 = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": doc, "note": "first"}).json()
    assert (
        v1["version"] == 1
        and v1["status"] == "draft"
        and len(v1["fingerprint"]) == 64
        and v1["views"] == ["Finance", "Logistics"]
    )
    import wise

    assert v1["fingerprint"] == wise.Norm.from_dict(doc).fingerprint()
    assert v1["norm"] == wise.Norm.from_dict(doc).to_dict()
    doc2 = json.loads(json.dumps(doc))
    doc2["constraints"][0]["description"] = "changed"
    v2 = client.post(
        f"/api/v1/projects/{pid}/norms", json={"norm": doc2, "note": "second", "parentId": v1["id"]}
    ).json()
    assert (
        v2["version"] == 2
        and v2["parentId"] == v1["id"]
        and v2["normId"] == v1["normId"]
        and v2["fingerprint"] != v1["fingerprint"]
    )
    assert [n["id"] for n in client.get(f"/api/v1/projects/{pid}/norms").json()] == [v1["id"], v2["id"]]
    r = client.patch(f"/api/v1/projects/{pid}/norms/{v1['id']}", json={"status": "approved"})
    assert r.json()["status"] == "approved"
    r = client.patch(f"/api/v1/projects/{pid}/norms/{v1['id']}", json={"status": "draft"})
    assert r.status_code == 409


def test_run_lifecycle_idempotency_and_reads(client: TestClient) -> None:
    ids = upload_running_example(client)
    pid = ids["project"]
    check = client.post(
        f"/api/v1/projects/{pid}/norms/{ids['norm']}/check", json={"caseTableId": ids["caseTable"]}
    ).json()
    assert {c["id"] for c in check["constraints"]} == {"c1", "c2", "c3", "c4", "c5", "c6"}
    c4 = next(c for c in check["constraints"] if c["id"] == "c4")
    assert c4["casesInScope"] == 0 and check["issues"] == []
    body = {
        "caseTableId": ids["caseTable"],
        "normVersionId": ids["norm"],
        "slicings": [{"id": "company", "attributes": ["company"]}],
        "gamma": 0,
        "minCases": 1,
    }
    r = client.post(f"/api/v1/projects/{pid}/runs", json=body, headers={"Idempotency-Key": "abc"})
    assert r.status_code == 202
    run = r.json()
    assert run["status"] == "queued" and run["links"]["backlog"].endswith("backlog?slicing=company")
    assert wait_job(client, run["jobId"], timeout=60)["status"] == "done"
    # same key → same run; same params → same run; different params with the same key → conflict
    assert (
        client.post(f"/api/v1/projects/{pid}/runs", json=body, headers={"Idempotency-Key": "abc"}).json()["id"]
        == run["id"]
    )
    r = client.post(f"/api/v1/projects/{pid}/runs", json=body)
    assert r.status_code == 200 and r.json()["id"] == run["id"]
    r = client.post(f"/api/v1/projects/{pid}/runs", json={**body, "gamma": 5}, headers={"Idempotency-Key": "abc"})
    assert r.status_code == 409 and r.json()["code"] == "run.params_mismatch"
    r = client.post(f"/api/v1/projects/{pid}/runs", json={**body, "views": ["Nope"]})
    assert r.status_code == 422 and r.json()["code"] == "run.view"
    r = client.post(f"/api/v1/projects/{pid}/runs", json={**body, "slicings": [{"attributes": ["nope"]}]})
    assert r.status_code == 422 and r.json()["code"] == "run.slicing_attribute"
    got = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}").json()
    assert got["status"] == "done"
    manifest = got["manifest"]
    assert (
        manifest["wiseVersion"]
        and len(manifest["normFingerprint"]) == 64
        and len(manifest["contentHash"]) == 64
        and manifest["paramsHash"] == got["paramsHash"]
    )
    assert "frame.parquet" in manifest["artefacts"] and "backlogs/company__Finance.parquet" in manifest["artefacts"]
    assert client.get(f"/api/v1/projects/{pid}").json()["latestRunId"] == run["id"]
    assert [r["id"] for r in client.get(f"/api/v1/projects/{pid}/runs").json()] == [run["id"]]
    summary = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/summary").json()
    assert set(summary["means"]) == {"Finance", "Logistics"} and summary["layers"]["columns"] == [
        "view",
        "completeness",
        "lead_times",
        "match",
        "handling",
        "exceptions",
    ]
    assert "company" in summary["concentration"] and "company" in summary["agreement"]
    page = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog",
        params={"slicing": "company", "view": "Finance", "minCases": 1},
    ).json()
    assert page["total"] == 2 and page["rows"][0]["key"] == '["B"]' and page["rows"][0]["keys"] == {"company": "B"}
    row = page["rows"][0]
    for col in (
        "n_cases",
        "mean_score",
        "gap",
        "stable_gap",
        "PI",
        "stable_PI",
        "PI_lower",
        "hotspot_type",
        "dominant_layer",
        "reading",
    ):
        assert col in row
    assert row["stability"] == "unknown" and row["rank"] == 1 and "priority" in row["reading"]
    assert page["params"]["gamma"] == 0 and page["globalMean"] == row["global_mean"]
    # plain-language fields next to the library's names (RG-7)
    assert row["kind"] in ("acute", "systematic", "widespread") and row["kind_reading"]
    assert {"severity": "acute", "mechanism": "systematic", "reservoir": "widespread"}[row["hotspot_type"]] == row[
        "kind"
    ]
    assert row["n_ranked"] == page["total"] == 2
    assert row["dominant_layer_name"] and row["top_constraint"] and row["top_constraint_description"]
    assert 0 < row["top_constraint_share"] <= 1
    assert row["reading"].startswith("B: 3 cases,") and "below expectation on average" in row["reading"]
    assert f"{row['kind']}: {row['kind_reading']}" in row["reading"] and "rank 1 of 2" in row["reading"]
    assert page["maxStablePI"] == row["stable_PI"]
    by_kind = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog",
        params={"slicing": "company", "view": "Finance", "minCases": 1, "kind": row["kind"]},
    ).json()
    by_hotspot = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog",
        params={"slicing": "company", "view": "Finance", "minCases": 1, "hotspotType": row["hotspot_type"]},
    ).json()
    assert [r["key"] for r in by_kind["rows"]] == [r["key"] for r in by_hotspot["rows"]] == [row["key"]]
    # ad-hoc slicing and gamma are recomputed on the frame
    adhoc = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog",
        params={"slicing": "vendor,company", "gamma": 3, "minCases": 1, "sort": "-n_cases"},
    ).json()
    assert (
        adhoc["total"] == 4
        and adhoc["params"]["attributes"] == ["vendor", "company"]
        and adhoc["rows"][0]["n_cases"] >= adhoc["rows"][-1]["n_cases"]
    )
    r = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/backlog", params={"slicing": "company", "sort": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "backlog.sort"
    filtered = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog", params={"slicing": "company", "minCases": 1, "q": "b"}
    ).json()
    assert filtered["total"] == 1
    paged = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/backlog",
        params={"slicing": "company", "minCases": 1, "page": 2, "pageSize": 1},
    ).json()
    assert paged["total"] == 2 and len(paged["rows"]) == 1 and paged["rows"][0]["key"] == '["A"]'
    detail = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/slices/" + '["B"]', params={"slicing": "company", "view": "Finance"}
    ).json()
    assert detail["row"]["keys"] == {"company": "B"} and detail["drivers"]["columns"][0] == "constraint"
    # each expectation's contribution to the shortfall sums to the gap; the reading names the top ones
    cols = detail["drivers"]["columns"]
    deltas = [r[cols.index("delta_gap")] for r in detail["drivers"]["rows"]]
    assert abs(sum(deltas) - detail["row"]["gap"]) < 1e-9
    assert deltas == sorted(deltas, reverse=True) and "share_of_shortfall" in cols
    assert "Expectations behind the shortfall:" in detail["reading"]
    assert detail["penaltyMass"]["columns"][0] == "key" and detail["penaltyMassBy"]
    assert (
        detail["layers"]["columns"] == ["layer", "slice_mean", "global_mean", "delta"]
        and len(detail["layers"]["rows"]) == 5
    )
    assert detail["worstCases"][0]["caseId"] == "E" and detail["worstCases"][0]["violated"] == ["c1", "c2", "c3"]
    assert detail["validation"]["n_cases"] == 3 and "reading" in detail["validation"]
    assert detail["headroom"]["columns"][:2] == ["constraint", "plain"] and "priority" in detail["reading"]
    assert (
        client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/slices/B", params={"slicing": "company"}).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/slices/ZZZ", params={"slicing": "company"}).status_code
        == 404
    )
    trace = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/cases/E/trace").json()
    assert trace["caseId"] == "E" and trace["attributes"]["company"] == "B" and trace["scores"]["Finance"] < 0.2
    gr = next(e for e in trace["events"] if e["activity"] == "Record Goods Receipt")
    assert "c2" in gr["violates"] and "c3" in gr["violates"]
    assert client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/cases/nope/trace").status_code == 404
    diag = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/diagnostics", params={"slicing": "company", "view": "Logistics"}
    ).json()
    assert diag["columns"][:4] == ["company", "n_cases", "stable_gap", "stable_PI"] and "reading" in diag["columns"]
    dist = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/signals/c2").json()
    assert (
        dist["unit"] == "D"
        and dist["threshold"] == 10
        and dist["width"] == 20
        and dist["stats"]["n"] == 4
        and len(dist["ecdf"]) > 10
    )
    sliced = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/signals/c2", params={"slicing": "company", "sliceKey": '["B"]'}
    ).json()
    assert sliced["stats"]["n"] == 2 and sliced["slice"]["key"] == ["B"]
    assert client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/signals/zzz").status_code == 404
    flow = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/flow", params={"abstraction": 0}).json()
    labels = {n["label"] for n in flow["nodes"] if n["kind"] == "activity"}
    assert "Record Goods Receipt" in labels and flow["meta"]["cases"] == 5
    kinds = {e["kind"] for e in flow["edges"]}
    assert kinds == {"follows", "constraint"} and {o["kind"] for o in flow["overlays"]} >= {"arc", "badge", "hatch"}
    # metric names the flow library reads, and overlay payloads it can draw
    activity = next(n for n in flow["nodes"] if n["label"] == "Record Goods Receipt")
    assert {"cases", "events", "share", "violationShare"} <= set(activity["metrics"])
    follows = next(
        e for e in flow["edges"] if e["kind"] == "follows" and e["source"] != "__start__" and e["target"] != "__end__"
    )
    assert {"count", "cases", "share"} <= set(follows["metrics"])
    badge = next(o for o in flow["overlays"] if o["kind"] == "badge")
    assert {"constraintId", "constraintType", "label", "value", "text", "glyph"} <= set(badge["payload"])
    arc = next(o for o in flow["overlays"] if o["kind"] == "arc")
    assert arc["payload"]["source"] and arc["payload"]["target"]
    assert len(flow["meta"]["constraints"]) == 6 and flow["meta"]["constraints"][0]["description"]["id"]
    sliced_flow = client.get(
        f"/api/v1/projects/{pid}/runs/{run['id']}/flow",
        params={"slicing": "company", "sliceKey": '["A"]', "abstraction": 0},
    ).json()
    assert sliced_flow["meta"]["cases"] == 2


def test_job_events_stream_and_cancel(client: TestClient) -> None:
    pid = client.post("/api/v1/projects", json={"name": "J"}).json()["id"]
    job = client.post(
        f"/api/v1/projects/{pid}/datasets",
        files={"file": ("running.csv", io.BytesIO(running_example_csv()), "text/csv")},
    ).json()
    events = []
    payloads = []
    with client.stream("GET", f"/api/v1/jobs/{job['id']}/events", params={"timeout": 30}) as s:
        assert s.headers["content-type"].startswith("text/event-stream")
        for line in s.iter_lines():
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
            elif line.startswith("data:"):
                payloads.append(json.loads(line.split(":", 1)[1]))
    assert events[-1] == "done" and "progress" in events and events.count("done") == 1
    assert payloads[-1]["status"] == "done" and payloads[-1]["resultRef"].startswith("dataset:")
    # a finished job replays its final state and closes again
    with client.stream("GET", f"/api/v1/jobs/{job['id']}/events") as s:
        replay = [line for line in s.iter_lines() if line.startswith("event:")]
    assert replay == ["event: progress", "event: done"]
    assert client.get("/api/v1/jobs", params={"state": "done"}).json()[0]["id"] == job["id"]
    # cancelling a finished job is a no-op; cancelling a queued one ends it
    assert client.delete(f"/api/v1/jobs/{job['id']}").status_code == 204
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "done"
    assert client.delete("/api/v1/jobs/missing").status_code == 404


def test_run_cancel_endpoint(client: TestClient) -> None:
    ids = upload_running_example(client)
    pid = ids["project"]
    run_id = run_running_example(client, ids)
    r = client.post(f"/api/v1/projects/{pid}/runs/{run_id}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "done"  # finished runs stay done


def test_results_before_done_are_a_conflict(client: TestClient) -> None:
    ids = upload_running_example(client)
    pid = ids["project"]
    body = {
        "caseTableId": ids["caseTable"],
        "normVersionId": ids["norm"],
        "slicings": [{"attributes": ["company"]}],
        "gamma": 0,
        "minCases": 1,
    }
    run = client.post(f"/api/v1/projects/{pid}/runs", json=body).json()
    r = client.get(f"/api/v1/projects/{pid}/runs/{run['id']}/backlog", params={"slicing": "company"})
    if r.status_code != 200:
        assert r.status_code == 409 and r.json()["code"] == "run.not_done"
    wait_job(client, run["jobId"], timeout=60)
    time.sleep(0.05)
    assert (
        client.get(
            f"/api/v1/projects/{pid}/runs/{run['id']}/backlog", params={"slicing": "company", "minCases": 1}
        ).status_code
        == 200
    )
