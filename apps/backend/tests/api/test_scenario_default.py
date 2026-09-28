"""Real scoring on the synthetic running example keeps scenarios out of the project default."""

from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from tests.conftest import run_running_example, upload_running_example, wait_job


def test_scenario_keeps_observed_default_and_remains_accessible(client: TestClient) -> None:
    ids = upload_running_example(client)
    project = f"/api/v1/projects/{ids['project']}"
    baseline_id = run_running_example(client, ids)
    baseline_url = f"{project}/runs/{baseline_id}"
    baseline = client.get(baseline_url).json()
    assert baseline["status"] == "done"
    assert client.get(project).json()["latestRunId"] == baseline_id
    summary_before = client.get(f"{baseline_url}/summary").json()

    transform = {"kind": "keep_first", "activity": "Record Goods Receipt"}
    preview = client.post(f"{baseline_url}/whatif/preview", json={"transforms": [transform]})
    assert preview.status_code == 200, preview.text
    assert preview.json()["transforms"][0]["eventsRemoved"] == 3

    response = client.post(
        f"{baseline_url}/whatif",
        json={"name": "One receipt per synthetic item", "transforms": [transform]},
    )
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()["id"], timeout=60)
    assert job["status"] == "done", job
    scenario_id = job["resultRef"].split(":", 1)[1]
    assert scenario_id != baseline_id
    assert client.get(project).json()["latestRunId"] == baseline_id

    scenario_url = f"{project}/runs/{scenario_id}"
    response = client.get(scenario_url)
    assert response.status_code == 200, response.text
    scenario = response.json()
    assert scenario["status"] == "done"
    assert scenario["baselineRunId"] == baseline_id
    assert scenario["manifest"]["paramsHash"] != baseline["manifest"]["paramsHash"]
    listed = client.get(f"{project}/runs").json()
    assert {run["id"] for run in listed} == {baseline_id, scenario_id}
    scenarios = client.get(f"{project}/scenarios", params={"baselineRunId": baseline_id}).json()
    assert [run["runId"] for run in scenarios] == [scenario_id]

    response = client.get(f"{scenario_url}/whatif")
    assert response.status_code == 200, response.text
    comparison = response.json()
    assert comparison["baselineRunId"] == baseline_id
    assert comparison["transforms"] == [transform]
    assert comparison["rows"]
    assert comparison["provenance"]["frozen"] is True
    response = client.get(
        f"{scenario_url}/backlog",
        params={"slicing": comparison["slicing"], "view": comparison["view"], "minCases": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["rows"]
    assert client.get(baseline_url).json()["manifest"] == baseline["manifest"]
    assert client.get(f"{baseline_url}/summary").json() == summary_before
    assert client.get(project).json()["latestRunId"] == baseline_id

    # An ordinary comparison run still advances the default, even with a baseline reference.
    response = client.post(
        f"{project}/runs",
        json={
            "caseTableId": ids["caseTable"],
            "normVersionId": ids["norm"],
            "slicings": [{"attributes": ["company"]}],
            "baselineRunId": baseline_id,
            "minCases": 1,
        },
    )
    assert response.status_code == 202, response.text
    observed = response.json()
    job = wait_job(client, observed["jobId"], timeout=60)
    assert job["status"] == "done", job
    assert client.get(project).json()["latestRunId"] == observed["id"]

    # Imported/internal transform runs need no scenario name or what-if job.
    container = client.app.state.container
    source = container.repos.get_run(baseline_id)
    transformed, transform_job, _ = container.runs.create(
        ids["project"],
        replace(source.params, transforms=(transform,)),
        force=True,
    )
    assert transform_job is not None
    assert wait_job(client, transform_job.id, timeout=60)["status"] == "done"
    assert client.get(project).json()["latestRunId"] == observed["id"]
    scenarios = client.get(f"{project}/scenarios").json()
    assert transformed.id in {r["runId"] for r in scenarios}

    # Scenarios of an older baseline must not reset the default to that baseline either.
    response = client.post(
        f"{baseline_url}/whatif",
        json={"name": "One receipt per synthetic item", "transforms": [transform], "force": True},
    )
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()["id"], timeout=60)
    assert job["status"] == "done", job
    assert job["resultRef"] != f"run:{scenario_id}"
    assert client.get(project).json()["latestRunId"] == observed["id"]
