from itertools import combinations

import wise

from tests.conftest import upload_running_example, wait_job
from wise_workbench.domain.norm_views import BENCHMARK_POLICY


def test_benchmark_is_automatic_and_run_keeps_seven_groupings(client):
    ids = upload_running_example(client)
    base = f"/api/v1/projects/{ids['project']}"
    saved = client.get(f"{base}/norms/{ids['norm']}").json()
    general = saved["norm"]["metadata"]["general_benchmark"]["name"]
    other = next(v["name"] for v in saved["norm"]["views"] if v["name"] != general)
    groupings = [
        {"attributes": list(attrs)}
        for width in (1, 2, 3)
        for attrs in combinations(["company", "vendor", "flow_type"], width)
    ]
    body = {
        "caseTableId": ids["caseTable"],
        "normVersionId": ids["norm"],
        "views": [other],
        "slicings": groupings,
        "minCases": 1,
    }
    created = client.post(f"{base}/runs", json=body, headers={"Idempotency-Key": "benchmark-retry"})
    assert created.status_code == 202, created.text
    run = created.json()
    assert run["views"] == [other, general]
    assert run["generalBenchmark"] == BENCHMARK_POLICY
    assert len(run["slicings"]) == 7
    assert wait_job(client, run["jobId"], timeout=60)["status"] == "done"
    done = client.get(f"{base}/runs/{run['id']}").json()
    assert done["manifest"]["normFingerprint"] == wise.Norm.from_dict(saved["norm"]).fingerprint()
    response = client.get(
        f"{base}/runs/{run['id']}/backlog", params={"view": general, "slicing": "company", "minCases": 1}
    )
    assert response.status_code == 200, response.text
    again = client.post(f"{base}/runs", json=body, headers={"Idempotency-Key": "benchmark-retry"})
    assert again.json()["id"] == run["id"]
    assert client.get(f"{base}/norms/{ids['norm']}").json()["norm"] == saved["norm"]


def test_legacy_norm_gets_a_run_only_benchmark_without_rewriting_source(client):
    from dataclasses import replace

    from wise_workbench.ids import new_id

    ids = upload_running_example(client)
    base = f"/api/v1/projects/{ids['project']}"
    container = client.app.state.container
    original = container.repos.get_norm_version(ids["norm"])
    doc = dict(original.document)
    general = doc["metadata"]["general_benchmark"]["name"]
    doc["views"] = [v for v in doc["views"] if v["name"] != general]
    doc["metadata"] = {k: v for k, v in doc["metadata"].items() if k != "general_benchmark"}
    canonical, fingerprint = container.engine.validate_norm(doc)
    legacy = container.repos.add_norm_version(
        replace(original, id=new_id("nv"), version=2, document=canonical, fingerprint=fingerprint)
    )
    response = client.post(
        f"{base}/runs",
        json={
            "caseTableId": ids["caseTable"],
            "normVersionId": legacy.id,
            "views": [canonical["views"][0]["name"]],
            "slicings": [{"attributes": ["company"]}],
            "minCases": 1,
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()
    assert wait_job(client, run["jobId"], timeout=60)["status"] == "done"
    done = client.get(f"{base}/runs/{run['id']}").json()
    assert general in done["views"]
    assert done["manifest"]["normFingerprint"] != fingerprint
    provenance = client.get(f"{base}/runs/{run['id']}/manifest").json()
    assert provenance["technical"]["sourceNormFingerprint"] == fingerprint
    assert provenance["technical"]["normFingerprint"] == done["manifest"]["normFingerprint"]
    assert client.get(f"{base}/norms/{legacy.id}").json()["norm"] == canonical
    assert (
        client.get(
            f"{base}/runs/{run['id']}/backlog", params={"view": general, "slicing": "company", "minCases": 1}
        ).status_code
        == 200
    )
