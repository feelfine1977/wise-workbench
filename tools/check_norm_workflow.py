"""Exercise norm decisions in Chromium against a disposable public five-case log with a threshold boundary.

Run from an installed development environment with frontend npm dependencies
and Playwright Chromium available. No existing workspace or server is used.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


def main() -> int:
    import httpx
    import uvicorn
    import wise
    from wise_workbench.api.app import create_app
    from wise_workbench.settings import Settings

    root = Path(__file__).resolve().parents[1]
    frontend = root / "apps/frontend"
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("Node and npm are required for the browser workflow")
    with tempfile.TemporaryDirectory(prefix="wise-norm-workflow-") as directory:
        workspace = Path(directory)
        settings = Settings(
            workspace=workspace,
            database_url=f"sqlite:///{workspace / 'workbench.db'}",
            inprocess_worker=True,
            analytics_auto=False,
            job_poll_seconds=0.02,
            bpic19_csv=None,
            preset_data_dirs=[],
            static_dir=workspace / "no-static",
            log_level="WARNING",
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            server = uvicorn.Server(
                uvicorn.Config(create_app(settings), log_level="warning")
            )
            thread = threading.Thread(
                target=server.run, kwargs={"sockets": [sock]}, daemon=True
            )
            thread.start()
            try:
                deadline = time.monotonic() + 30
                while not server.started:
                    if not thread.is_alive() or time.monotonic() > deadline:
                        raise RuntimeError(
                            "The isolated norm-workflow API did not start"
                        )
                    time.sleep(0.05)
                url = f"http://127.0.0.1:{port}"
                with httpx.Client(
                    base_url=url + "/api/v1", timeout=60, trust_env=False
                ) as client:

                    def post(path: str, **kwargs: Any) -> dict[str, Any]:
                        response = client.post(path, **kwargs)
                        response.raise_for_status()
                        return response.json()

                    def wait_job(job: dict[str, Any]) -> dict[str, Any]:
                        deadline = time.monotonic() + 60
                        while time.monotonic() < deadline:
                            response = client.get("/jobs/" + job["id"])
                            response.raise_for_status()
                            state = response.json()
                            if state["status"] == "done":
                                return state
                            if state["status"] in {"failed", "cancelled"}:
                                raise RuntimeError(
                                    "Synthetic fixture job failed: " + str(state)
                                )
                            time.sleep(0.05)
                        raise RuntimeError("Synthetic fixture job did not finish")

                    project = post(
                        "/projects",
                        json={"name": "Public norm workflow", "process": "p2p"},
                    )["id"]
                    prefix = "/projects/" + project
                    events = wise.running_p2p_events().copy()
                    # One observation lies strictly between the old (10) and new (12) targets.
                    # This is a synthetic variant, not a reproduction of the paper's numbers.
                    events.loc[
                        (events["case"] == "B") & (events["activity"] == "Record Invoice Receipt"), "time"
                    ] = "2024-01-12"
                    job = post(
                        prefix + "/datasets",
                        files={
                            "file": (
                                "public-example.csv",
                                events.to_csv(index=False).encode(),
                                "text/csv",
                            )
                        },
                    )
                    dataset = wait_job(job)["resultRef"].split(":", 1)[1]
                    job = post(
                        prefix + "/datasets/" + dataset + "/mappings",
                        json={
                            "caseId": "case",
                            "activity": "activity",
                            "timestamp": "time",
                            "caseAttributes": ["flow_type", "company", "vendor"],
                        },
                    )
                    case_table = wait_job(job)["resultRef"].split(":", 1)[1]
                    version = post(
                        prefix + "/norms",
                        json={
                            "norm": wise.running_p2p_norm().to_dict(),
                            "note": "Public five-case example",
                        },
                    )["id"]
                    run = post(
                        prefix + "/runs",
                        json={
                            "caseTableId": case_table,
                            "normVersionId": version,
                            "slicings": [{"attributes": ["company"]}],
                            "gamma": 0,
                            "minCases": 1,
                        },
                    )
                    wait_job({"id": run["jobId"]})
                env = dict(
                    os.environ,
                    E2E_API_URL=url,
                    E2E_PROJECT_ID=project,
                    E2E_NORM_VERSION_ID=version,
                    E2E_CASE_TABLE_ID=case_table,
                    E2E_BASELINE_RUN_ID=run["id"],
                    PLAYWRIGHT_JSON_OUTPUT_FILE=str(workspace / "browser-report.json"),
                )
                completed = subprocess.run(
                    [
                        npm,
                        "run",
                        "e2e",
                        "--",
                        "e2e/norm-persistence.spec.ts",
                        "--workers=1",
                        "--reporter=list,json",
                    ],
                    cwd=frontend,
                    env=env,
                    timeout=480,
                    check=False,
                )
                if completed.returncode == 0:
                    report = json.loads((workspace / "browser-report.json").read_text())
                    stats = report["stats"]
                    if stats["expected"] != 1 or any(
                        stats[key] for key in ("unexpected", "flaky", "skipped")
                    ):
                        raise RuntimeError(
                            "The required norm workflow did not execute and pass exactly once"
                        )
                    print(
                        "Public norm workflow passed against the actual API; temporary workspace will be removed."
                    )
                return completed.returncode
            finally:
                server.should_exit = True
                thread.join(timeout=15)
                if thread.is_alive():
                    raise RuntimeError(
                        "The isolated norm-workflow API did not shut down"
                    )


if __name__ == "__main__":
    raise SystemExit(main())
