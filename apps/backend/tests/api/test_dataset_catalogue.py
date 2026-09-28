"""Catalogue discovery must not import data; explicit imports use configured IDs only."""

import json

import pytest

from wise_workbench.domain.dataset import DatasetStatus, DatasetVersion


def setup_catalogue(client, document):
    c = client.app.state.container
    path = c.settings.workspace_path / "workspace-links.json"
    path.write_text(json.dumps(document))
    return c, path


def project(client, name):
    return client.post("/api/v1/projects", json={"name": name}).json()["id"]


def test_catalogue_lists_actual_projects_without_imports_or_raw_paths(client):
    a, b = project(client, "Purchasing"), project(client, "Sales")
    c = client.app.state.container
    c.repos.add_dataset(
        DatasetVersion(
            id="ds_sales",
            project_id=b,
            name="Sales",
            status=DatasetStatus.READY,
            events=42,
            source_path="/private/raw.csv",
        )
    )
    before = len(c.queue.list())
    response = client.get(f"/api/v1/projects/{a}/dataset-catalogue")
    assert response.status_code == 200
    data = response.json()
    assert [(p["name"], len(p["datasets"])) for p in data["projects"]] == [
        ("Purchasing", 0),
        ("Sales", 1),
    ]
    assert data["projects"][1]["datasets"][0]["events"] == 42
    assert data["workspaces"] == data["imports"] == []
    assert "/private/raw.csv" not in response.text
    assert len(c.queue.list()) == before
    assert client.get("/api/v1/projects/unknown/dataset-catalogue").status_code == 404


def test_explicit_links_refresh_and_invalid_registry_keeps_current_projects(client):
    pid = project(client, "Purchasing")
    _, path = setup_catalogue(
        client,
        {
            "version": 1,
            "workspaces": [
                {
                    "name": "Sales",
                    "origin": "http://127.0.0.1:8012",
                    "projectId": "sales",
                }
            ],
        },
    )
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    first = client.get(url).json()
    assert first["workspaces"][0]["origin"] == "http://127.0.0.1:8012"
    assert first["warning"] is None
    path.write_text("not JSON")
    second = client.get(url).json()
    assert second["workspaces"] == []
    assert len(second["projects"]) == 1
    assert second["warning"]
    path.write_text(" " * 65_537)
    assert client.get(url).json()["warning"]


@pytest.mark.parametrize(
    "origin",
    [
        "javascript:alert(1)",
        "http://example.com",
        "http://localhost@evil.test",
        "http://user:pass@localhost",
        "http://localhost/p/x",
        "http://localhost?token=secret",
        "http://localhost/#x",
        "http://localhost:99999",
        "http://localhost:0",
        "http://localhost\\evil.test",
        "http://local\nhost",
    ],
)
def test_refuses_unsafe_or_nonlocal_links(client, origin):
    pid = project(client, "Purchasing")
    setup_catalogue(
        client,
        {
            "version": 1,
            "workspaces": [{"name": "Other", "origin": origin, "projectId": "p"}],
        },
    )
    data = client.get(f"/api/v1/projects/{pid}/dataset-catalogue").json()
    assert data["warning"]
    assert data["workspaces"] == []


def test_only_explicit_configured_imports_can_start_jobs(client, tmp_path):
    pid = project(client, "Import target")
    source = tmp_path / "example.csv"
    source.write_text("case,activity,time\na,Start,2026-01-01\n")
    original = source.read_bytes()
    c, _ = setup_catalogue(
        client,
        {
            "version": 1,
            "imports": [{"id": "example", "name": "Example", "path": str(source)}],
        },
    )
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    assert client.get(url).json()["imports"][0]["available"]
    assert c.datasets.list(pid) == []
    assert client.post(f"{url}/imports/unknown", json={"path": str(source)}).status_code == 404
    response = client.post(f"{url}/imports/example")
    assert response.status_code == 202, response.text
    assert response.json()["resultRef"].startswith("dataset:")
    dataset = c.datasets.list(pid)[0]
    assert dataset.source_path == str(source)
    assert source.read_bytes() == original
    assert not (c.workspace.dataset_dir(pid, dataset.id) / "source").exists()
    assert c.mappings.list_case_tables(pid) == []


def test_missing_file_and_missing_xes_dependency_are_unavailable(client, tmp_path, monkeypatch):
    pid = project(client, "Import target")
    xes = tmp_path / "example.xes"
    xes.write_text("synthetic placeholder")
    monkeypatch.setattr(
        "wise_workbench.application.services.dataset_catalogue.importlib.util.find_spec",
        lambda name: None,
    )
    setup_catalogue(
        client,
        {
            "version": 1,
            "imports": [
                {
                    "id": "missing",
                    "name": "Missing",
                    "path": str(tmp_path / "missing.csv"),
                },
                {"id": "xes", "name": "XES", "path": str(xes)},
            ],
        },
    )
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    entries = client.get(url).json()["imports"]
    assert all(not e["available"] for e in entries)
    assert "XES importer" in entries[1]["reason"]
    assert client.post(f"{url}/imports/xes").status_code == 422


def test_duplicate_import_ids_are_rejected(client, tmp_path):
    pid = project(client, "Import target")
    entry = {
        "id": "duplicate",
        "name": "Example",
        "path": str(tmp_path / "example.csv"),
    }
    setup_catalogue(client, {"version": 1, "imports": [entry, entry]})
    data = client.get(f"/api/v1/projects/{pid}/dataset-catalogue").json()
    assert data["warning"]
    assert data["imports"] == []


@pytest.mark.parametrize(
    "filename",
    [
        "Hospital_log.xes.gz",
        "BPI_Challenge_2012.xes.gz",
        "BPI_Challenge_2013_incidents.xes.gz",
        "Detail_Incident.csv",
        "Detail_Change.csv",
        "Detail_Incident_Activity.csv",
        "Detail_Interaction.csv",
        *[f"BPIC15_{i}.xes" for i in range(1, 6)],
        "BPI Challenge 2017.xes.gz",
        "BPI Challenge 2018.xes.gz",
        "PrepaidTravelCost.xes.gz",
        "PermitLog.xes.gz",
        "InternationalDeclarations.xes.gz",
        "DomesticDeclarations.xes.gz",
        "RequestForPayment.xes.gz",
        "finale.csv",
        "Hospital Billing - Event Log.xes.gz",
        "Road_Traffic_Fine_Management_Process.xes.gz",
        "Sepsis Cases - Event Log.xes.gz",
        "BPI_Challenge_2019.csv",
    ],
)
def test_known_logs_have_sourced_context_even_when_source_missing(client, tmp_path, filename):
    pid = project(client, "Catalogue")
    setup_catalogue(
        client, {"version": 1, "imports": [{"id": "source", "name": "Source", "path": str(tmp_path / filename)}]}
    )
    entry = client.get(f"/api/v1/projects/{pid}/dataset-catalogue").json()["imports"][0]
    assert not entry["available"]
    assert entry["context"]["processDescription"]
    assert entry["context"]["sources"][0]["url"].startswith("https://")
    assert entry["dataset"] is None


def test_unknown_file_does_not_invent_public_context(client, tmp_path):
    pid = project(client, "Unknown")
    setup_catalogue(
        client, {"version": 1, "imports": [{"id": "custom", "name": "BPI 2017?", "path": str(tmp_path / "custom.csv")}]}
    )
    entry = client.get(f"/api/v1/projects/{pid}/dataset-catalogue").json()["imports"][0]
    assert entry["context"] is None


def test_catalogue_only_reuses_current_project_source_and_keeps_missing_source_openable(client, tmp_path):
    pid, other = project(client, "Target"), project(client, "Other")
    source = str(tmp_path / "BPIC15_1.xes")
    c, _ = setup_catalogue(client, {"version": 1, "imports": [{"id": "local", "name": "Local", "path": source}]})
    c.repos.add_dataset(
        DatasetVersion(id="other_ds", project_id=other, name="Other", status=DatasetStatus.READY, source_path=source)
    )
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    assert client.get(url).json()["imports"][0]["dataset"] is None
    c.repos.add_dataset(
        DatasetVersion(
            id="local_ds", project_id=pid, name="Local", status=DatasetStatus.READY, source_path=source, events=2
        )
    )
    entry = client.get(url).json()["imports"][0]
    assert entry["dataset"]["id"] == "local_ds"
    assert entry["dataset"]["status"] == "ready"
    assert not entry["available"]  # raw source availability is independent of a prepared dataset


@pytest.mark.parametrize(
    ("filename", "content", "limit", "reason"),
    [
        ("empty.csv", "", 100, "empty"),
        ("large.csv", "123456", 5, "size limit"),
        ("archive.zip", "zip", 100, "archives"),
        ("data.csv.gz", "gzip", 100, "archives"),
    ],
)
def test_unavailable_local_sources_fail_before_creating_jobs(client, tmp_path, filename, content, limit, reason):
    pid = project(client, "Target")
    source = tmp_path / filename
    source.write_text(content)
    c, _ = setup_catalogue(client, {"version": 1, "imports": [{"id": "source", "name": "Source", "path": str(source)}]})
    c.settings.max_upload_bytes = limit
    url = f"/api/v1/projects/{pid}/dataset-catalogue"
    assert reason in client.get(url).json()["imports"][0]["reason"]
    before = len(c.queue.list())
    assert client.post(f"{url}/imports/source").status_code == 422
    assert len(c.queue.list()) == before
    assert c.datasets.list(pid) == []


@pytest.mark.parametrize("extension", [".csv", ".tsv", ".txt", ".parquet", ".pq", ".xes", ".xes.gz"])
def test_catalogue_accepts_the_same_extensions_as_ingestion(tmp_path, extension):
    from wise_workbench.application.services.dataset_catalogue import LocalImportSpec, import_entry

    source = tmp_path / ("source" + extension)
    source.write_bytes(b"file metadata only")
    assert import_entry(LocalImportSpec(id="source", name="Source", path=str(source)), 100).available


def test_source_read_failure_is_reported_without_creating_dataset(client, tmp_path, monkeypatch):
    pid = project(client, "Unreadable source")
    source = tmp_path / "source.csv"
    source.write_text("case,activity,time\na,Start,2026-01-01\n")
    c, _ = setup_catalogue(client, {"version": 1, "imports": [{"id": "source", "name": "Source", "path": str(source)}]})

    def denied(_):
        raise PermissionError("access denied")

    monkeypatch.setattr("wise_workbench.application.services.datasets.sha256_file", denied)
    response = client.post(f"/api/v1/projects/{pid}/dataset-catalogue/imports/source")
    assert response.status_code == 422
    assert "permissions" in response.text
    assert not c.datasets.list(pid)
