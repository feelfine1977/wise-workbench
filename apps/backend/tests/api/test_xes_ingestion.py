"""Real XES ingestion through the catalogue API, with isolated temporary workspaces."""

import gzip
import json

import pandas as pd
import pytest

from tests.conftest import wait_job

XES = b"""<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1.0" xmlns="http://www.xes-standard.org/">
<trace><string key="concept:name" value="case-1"/><string key="department" value="A"/>
<event><string key="concept:name" value="Review"/><string key="lifecycle:transition" value="start"/><date key="time:timestamp" value="2020-01-01T10:00:00+01:00"/><float key="amount" value="12.5"/><int key="Activity code" value="123"/></event>
<event><string key="concept:name" value="Review"/><string key="lifecycle:transition" value="complete"/><date key="time:timestamp" value="2020-01-01T10:05:00+01:00"/><boolean key="approved" value="true"/><string key="Activity code" value="339486E"/></event>
</trace></log>"""


@pytest.mark.parametrize("compressed", [False, True])
def test_xes_catalogue_import_preserves_case_attributes_lifecycle_and_time(client, tmp_path, compressed):
    source = tmp_path / ("BPIC15_1.xes.gz" if compressed else "BPIC15_1.xes")
    raw = gzip.compress(XES) if compressed else XES
    source.write_bytes(raw)
    pid = client.post("/api/v1/projects", json={"name": "XES test"}).json()["id"]
    c = client.app.state.container
    (c.settings.workspace_path / "workspace-links.json").write_text(
        json.dumps(
            {
                "version": 1,
                "imports": [{"id": "xes", "name": "XES", "path": str(source)}],
            }
        )
    )
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    assert client.get(url).json()["imports"][0]["available"]
    response = client.post(f"{url}/imports/xes")
    assert response.status_code == 202
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "done", job
    ds = c.datasets.list(pid)[0]
    frame = pd.read_parquet(c.workspace.dataset_dir(pid, ds.id) / "events.parquet")
    assert list(frame["case:concept:name"]) == ["case-1", "case-1"]
    assert list(frame["case:department"]) == ["A", "A"]
    assert list(frame["lifecycle:transition"]) == ["start", "complete"]
    assert frame["time:timestamp"].iloc[0] == pd.Timestamp("2020-01-01T09:00:00Z")
    assert frame["time:timestamp"].iloc[1] - frame["time:timestamp"].iloc[0] == pd.Timedelta(minutes=5)
    assert list(frame["Activity code"]) == ["123", "339486E"]
    assert frame["amount"].iloc[0] == 12.5
    assert bool(frame["approved"].iloc[1])
    assert source.read_bytes() == raw
    assert ds.events == 2
    assert c.mappings.list_case_tables(pid) == []
    assert client.get(url).json()["imports"][0]["dataset"]["id"] == ds.id


@pytest.mark.parametrize(("raw", "message"), [(b"not XML", "Cannot read XES"), (b"<log></log>", "contains no events")])
def test_invalid_xes_fails_with_useful_error_and_no_ready_dataset(client, tmp_path, raw, message):
    pid = client.post("/api/v1/projects", json={"name": "Bad XES"}).json()["id"]
    response = client.post(f"/api/v1/projects/{pid}/datasets", files={"file": ("bad.xes", raw, "application/xml")})
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "failed", job
    ds = client.app.state.container.datasets.list(pid)[0]
    assert ds.status == "failed"
    assert message in ds.error


def test_broken_xes_dependency_reports_environment_repair(container, tmp_path, monkeypatch):
    import builtins

    from wise_workbench.domain import ValidationError

    original = builtins.__import__

    def broken(name, *args, **kwargs):
        if name == "pm4py":
            raise ImportError("missing transitive dependency")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", broken)
    with pytest.raises(ValidationError, match="server Python environment") as error:
        container.engine.ingest(tmp_path / "source.xes", "xes", tmp_path, lambda *args: None)
    assert error.value.code == "dataset.xes_unavailable"
