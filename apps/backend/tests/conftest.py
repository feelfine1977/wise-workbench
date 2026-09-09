"""Shared fixtures: temp workspaces, containers, an app with the in-process worker, the running example."""

from __future__ import annotations

import importlib.util
import io
import os
import tempfile
import time
import warnings
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

# keep hypothesis' storage out of the repository (the root.gitignore is owned by the workbench)
os.environ.setdefault("HYPOTHESIS_STORAGE_DIRECTORY", os.path.join(tempfile.gettempdir(), "wise-workbench-hypothesis"))
from hypothesis import settings as hypothesis_settings

warnings.filterwarnings("ignore", message=".*httpx.*starlette.testclient.*")
hypothesis_settings.register_profile("workbench", database=None, deadline=None)
hypothesis_settings.load_profile("workbench")

from fastapi.testclient import TestClient

from wise_workbench.api.app import create_app
from wise_workbench.container import Container
from wise_workbench.settings import Settings

REPO_ROOT = Path(__file__).resolve().parents[3]
from wise_knowledge.paths import knowledge_root

BPIC19_NORM = knowledge_root() / "p2p" / "templates" / "p2p_bpic19.json"
FULL_ONLY_MODULES = {"test_cycle2.py", "test_cycle3.py", "test_cycle4.py"}


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--dependency-profile", choices=("full", "minimal"), default=os.environ.get("WISE_TEST_PROFILE", "full")
    )


def pytest_configure(config: pytest.Config) -> None:
    profile = config.getoption("--dependency-profile")
    if profile not in {"full", "minimal"}:
        raise pytest.UsageError("WISE_TEST_PROFILE must be full or minimal")
    present = importlib.util.find_spec("wise_analytics") is not None
    if profile == "full" and not present:
        raise pytest.UsageError(
            "full profile requires wise-analytics; install packages/wise-analytics or select --dependency-profile=minimal"
        )
    if profile == "minimal" and present:
        raise pytest.UsageError("minimal profile requires an environment without wise-analytics")


def pytest_ignore_collect(collection_path: Path, config: pytest.Config) -> bool | None:
    if config.getoption("--dependency-profile") == "minimal" and collection_path.name in FULL_ONLY_MODULES:
        return True
    return None


@pytest.fixture(scope="session")
def dependency_profile(pytestconfig: pytest.Config) -> str:
    return str(pytestconfig.getoption("--dependency-profile"))


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "workspace": tmp_path / "workspace",
        "inprocess_worker": False,
        "job_poll_seconds": 0.02,
        "job_heartbeat_seconds": 0.1,
        "job_lease_seconds": 2.0,
        "job_max_attempts": 3,
        "log_format": "console",
        "log_level": "WARNING",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def container(settings: Settings) -> Iterator[Container]:
    c = Container(settings)
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """An app with the in-process worker running, on a fresh workspace."""
    app = create_app(make_settings(tmp_path, inprocess_worker=True))
    with TestClient(app) as c:
        yield c


def wait_job(client: TestClient, job_id: str, timeout: float = 30.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")


def running_example_csv() -> bytes:
    import wise

    return wise.running_p2p_events().to_csv(index=False).encode()


def running_example_norm() -> dict[str, Any]:
    import wise

    return wise.running_p2p_norm().to_dict()


RUNNING_MAPPING = {
    "caseId": "case",
    "activity": "activity",
    "timestamp": "time",
    "caseAttributes": ["flow_type", "company", "vendor"],
}


def upload_running_example(client: TestClient) -> dict[str, str]:
    """Project → dataset → mapping → case table → norm version, all through the API. Returns the ids."""
    project = client.post("/api/v1/projects", json={"name": "Running example", "process": "p2p"}).json()
    pid = project["id"]
    job = client.post(
        f"/api/v1/projects/{pid}/datasets",
        files={"file": ("running.csv", io.BytesIO(running_example_csv()), "text/csv")},
        data={"name": "running"},
    ).json()
    assert wait_job(client, job["id"])["status"] == "done"
    dataset_id = job["resultRef"].split(":", 1)[1]
    job = client.post(f"/api/v1/projects/{pid}/datasets/{dataset_id}/mappings", json=RUNNING_MAPPING).json()
    assert wait_job(client, job["id"])["status"] == "done", job
    case_table_id = job["resultRef"].split(":", 1)[1]
    norm = client.post(
        f"/api/v1/projects/{pid}/norms", json={"norm": running_example_norm(), "note": "paper Table V"}
    ).json()
    return {"project": pid, "dataset": dataset_id, "caseTable": case_table_id, "norm": norm["id"]}


def run_running_example(
    client: TestClient,
    ids: dict[str, str],
    *,
    gamma: float = 0.0,
    min_cases: int = 1,
    slicings: list[list[str]] | None = None,
) -> str:
    body = {
        "caseTableId": ids["caseTable"],
        "normVersionId": ids["norm"],
        "slicings": [{"attributes": s} for s in (slicings or [["company"], ["vendor"]])],
        "gamma": gamma,
        "minCases": min_cases,
    }
    run = client.post(f"/api/v1/projects/{ids['project']}/runs", json=body).json()
    assert "jobId" in run, run
    assert wait_job(client, run["jobId"], timeout=60)["status"] == "done"
    return str(run["id"])
