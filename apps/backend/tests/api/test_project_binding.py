"""Project dataset choices survive restart and cannot be silently replaced."""

import multiprocessing
from concurrent.futures import ProcessPoolExecutor

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings
from wise_workbench.api.app import create_app
from wise_workbench.application.services.project_binding import bind_dataset, get_binding, require_dataset_binding
from wise_workbench.container import Container
from wise_workbench.domain import (
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    ConflictError,
    DatasetStatus,
    DatasetVersion,
)
from wise_workbench.settings import Settings


@pytest.fixture
def world(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        c = client.app.state.container
        project = c.projects.create("Dataset choice")
        foreign = c.projects.create("Other project")
        for did, pid in [("o2c", project.id), ("p2p", project.id), ("foreign", foreign.id)]:
            c.repos.add_dataset(DatasetVersion(did, pid, did, status=DatasetStatus.READY))
            c.repos.add_mapping(ColumnMapping(f"map-{did}", did, "case", "activity", "time"))
            c.repos.add_case_table(CaseTable(f"ct-{did}", pid, did, f"map-{did}", status=CaseTableStatus.READY))
        yield client, settings, project.id


def endpoint(pid):
    return f"/api/v1/projects/{pid}/dataset-binding"


def test_get_is_read_only_and_never_infers_the_latest_dataset(world):
    client, _, pid = world
    assert client.get(endpoint(pid)).json() == {"projectId": pid, "datasetId": None, "boundAt": None}
    path = client.app.state.container.workspace.project_dir(pid) / "dataset-binding.json"
    assert not path.exists()
    assert client.get(endpoint("missing")).status_code == 404


def test_binding_survives_restart_and_same_put_is_idempotent(world):
    client, settings, pid = world
    response = client.put(endpoint(pid), json={"datasetId": "o2c"})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["datasetId"] == "o2c" and saved["boundAt"]
    assert client.put(endpoint(pid), json={"datasetId": "o2c"}).json() == saved
    with TestClient(create_app(settings)) as other:
        assert other.get(endpoint(pid)).json() == saved
        conflict = other.put(endpoint(pid), json={"datasetId": "p2p"})
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "project.dataset_already_bound"
    assert client.get(endpoint(pid)).json() == saved


@pytest.mark.parametrize(
    "body,status",
    [
        ({"datasetId": "foreign"}, 404),
        ({"datasetId": "missing"}, 404),
        ({"datasetId": ""}, 422),
        ({"datasetId": " "}, 422),
        ({"datasetId": None}, 422),
        ({"datasetId": 17}, 422),
        ({"datasetId": "o2c", "boundAt": "forged"}, 422),
    ],
)
def test_invalid_or_foreign_selection_does_not_bind(world, body, status):
    client, _, pid = world
    assert client.put(endpoint(pid), json=body).status_code == status
    assert client.get(endpoint(pid)).json()["datasetId"] is None


def test_unfinished_import_does_not_lock_project(world):
    client, _, pid = world
    client.app.state.container.repos.add_dataset(DatasetVersion("pending", pid, "Pending"))
    response = client.put(endpoint(pid), json={"datasetId": "pending"})
    assert response.status_code == 409 and response.json()["code"] == "project.dataset_not_ready"
    assert client.get(endpoint(pid)).json()["datasetId"] is None


def test_new_run_guard_rejects_unbound_foreign_and_wrong_dataset_tables(world):
    client, _, pid = world
    c = client.app.state.container
    with pytest.raises(ConflictError) as error:
        require_dataset_binding(c, pid, "ct-o2c")
    assert error.value.code == "project.dataset_binding_required"
    bind_dataset(c, pid, "o2c")
    assert require_dataset_binding(c, pid, "ct-o2c")["datasetId"] == "o2c"
    with pytest.raises(ConflictError) as error:
        require_dataset_binding(c, pid, "ct-p2p")
    assert error.value.code == "project.dataset_binding_mismatch"
    assert client.get(f"/api/v1/projects/{pid}/case-tables/ct-p2p").status_code == 200
    # Read access remains honest; the guard applies only to new assessments.
    from wise_workbench.domain import NotFoundError

    with pytest.raises(NotFoundError):
        require_dataset_binding(c, pid, "ct-foreign")


@pytest.mark.parametrize("contents", ["{", "null", '{"version":1,"datasetId":"o2c"}'])
def test_damaged_binding_fails_closed_instead_of_rebinding(world, contents):
    client, _, pid = world
    path = client.app.state.container.workspace.project_dir(pid) / "dataset-binding.json"
    path.write_text(contents)
    for response in [client.get(endpoint(pid)), client.put(endpoint(pid), json={"datasetId": "p2p"})]:
        assert response.status_code == 409
        assert response.json()["code"] == "project.dataset_binding_invalid"
    assert path.read_text() == contents


def _bind_from_process(settings, pid, did):
    c = Container(Settings.model_validate(settings), migrate=False)
    try:
        return bind_dataset(c, pid, did)
    except ConflictError as exc:
        return {"code": exc.code}
    finally:
        c.close()


@pytest.mark.parametrize("choices", [("o2c", "p2p"), ("o2c", "o2c")])
def test_competing_server_processes_cannot_overwrite_a_binding(world, choices):
    client, settings, pid = world
    with ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context("spawn")) as pool:
        attempts = [pool.submit(_bind_from_process, settings.model_dump(), pid, did) for did in choices]
        results = [attempt.result(timeout=30) for attempt in attempts]
    saved = get_binding(client.app.state.container, pid)
    if choices[0] == choices[1]:
        assert results == [saved, saved]
    else:
        assert sum(result == saved for result in results) == 1
        assert {"code": "project.dataset_already_bound"} in results
    assert not list(client.app.state.container.workspace.project_dir(pid).glob(".dataset-binding-*.tmp"))
