"""Jobs: claim with lease, heartbeat, lease expiry, retries, cancel, crash then resume."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from datetime import timedelta
from pathlib import Path

import pytest

from tests.conftest import make_settings
from wise_workbench.container import Container
from wise_workbench.domain import JobStatus, utcnow
from wise_workbench.jobs import JobCancelled, JobContext, Worker, register

SLOW_KIND = "test_slow"
BOOM_KIND = "test_boom"


def slow_handler(ctx: JobContext) -> str:
    steps = int(ctx.payload.get("steps", 10))
    delay = float(ctx.payload.get("delay", 0.05))
    marker = ctx.payload.get("marker")
    for i in range(steps):
        ctx.progress(i / steps, f"step {i}")
        if marker and i == int(ctx.payload.get("marker_at", 2)):
            Path(marker).write_text(str(os.getpid()))
        time.sleep(delay)
    return "slow:done"


def boom_handler(ctx: JobContext) -> str:
    raise RuntimeError("boom")


register(SLOW_KIND, slow_handler)
register(BOOM_KIND, boom_handler)


@pytest.fixture
def c(tmp_path: Path) -> Container:
    return Container(make_settings(tmp_path, job_lease_seconds=0.5, job_heartbeat_seconds=0.05))


def test_enqueue_claim_complete(c: Container) -> None:
    job = c.queue.enqueue(SLOW_KIND, {"steps": 2, "delay": 0.0})
    assert job.status == JobStatus.QUEUED and job.attempts == 0
    worker = Worker(c, worker_id="w1")
    assert worker.run_once()
    done = c.queue.get(job.id)
    assert (
        done.status == JobStatus.DONE and done.attempts == 1 and done.result_ref == "slow:done" and done.progress == 1.0
    )
    assert not worker.run_once()


def test_claim_is_fifo_and_exclusive(c: Container) -> None:
    first = c.queue.enqueue(SLOW_KIND, {"steps": 1})
    second = c.queue.enqueue(SLOW_KIND, {"steps": 1})
    a = c.queue.claim("w1")
    b = c.queue.claim("w2")
    assert a is not None and b is not None and a.id == first.id and b.id == second.id
    assert c.queue.claim("w3") is None


def test_lease_expiry_lets_another_worker_reclaim(c: Container) -> None:
    job = c.queue.enqueue(SLOW_KIND, {"steps": 1})
    claimed = c.queue.claim("w1")
    assert claimed is not None and claimed.attempts == 1
    assert c.queue.claim("w2") is None  # lease still valid
    c.repos.update_job_fields(job.id, lease_until=utcnow() - timedelta(seconds=1))
    reclaimed = c.queue.claim("w2")
    assert reclaimed is not None and reclaimed.id == job.id and reclaimed.attempts == 2 and reclaimed.worker_id == "w2"


def test_heartbeat_extends_the_lease_only_for_the_owner(c: Container) -> None:
    job = c.queue.enqueue(SLOW_KIND, {"steps": 1})
    claimed = c.queue.claim("w1")
    assert claimed is not None
    before = c.queue.get(job.id).lease_until
    time.sleep(0.01)
    assert c.queue.heartbeat(claimed, "w1") is False
    assert c.queue.get(job.id).lease_until > before
    assert c.queue.heartbeat(claimed, "intruder") is True


def test_failure_retries_then_fails(c: Container) -> None:
    job = c.queue.enqueue(BOOM_KIND, {})
    worker = Worker(c, worker_id="w1")
    for attempt in range(1, 4):
        assert worker.run_once()
        state = c.queue.get(job.id)
        if attempt < 3:
            assert state.status == JobStatus.QUEUED and state.attempts == attempt and "boom" in (state.error or "")
        else:
            assert state.status == JobStatus.FAILED and state.attempts == 3
    assert not worker.run_once()


def test_cancel_queued_job(c: Container) -> None:
    job = c.queue.enqueue(SLOW_KIND, {"steps": 1})
    cancelled = c.queue.cancel(job.id)
    assert cancelled.status == JobStatus.CANCELLED
    assert c.queue.claim("w1") is None


def test_cancel_running_job_stops_the_handler(c: Container) -> None:
    job = c.queue.enqueue(SLOW_KIND, {"steps": 100, "delay": 0.02})
    worker = Worker(c, worker_id="w1")
    thread = threading.Thread(target=worker.run_once)
    thread.start()
    deadline = time.monotonic() + 5
    while c.queue.get(job.id).status != JobStatus.RUNNING and time.monotonic() < deadline:
        time.sleep(0.01)
    c.queue.cancel(job.id)
    thread.join(timeout=10)
    final = c.queue.get(job.id)
    assert final.status == JobStatus.CANCELLED and final.progress < 1.0


def test_handler_can_raise_job_cancelled(c: Container) -> None:
    def handler(ctx: JobContext) -> str:
        raise JobCancelled("stop")

    register("test_cancel_self", handler)
    job = c.queue.enqueue("test_cancel_self", {})
    Worker(c, worker_id="w1").run_once()
    assert c.queue.get(job.id).status == JobStatus.CANCELLED


def test_crash_then_resume_in_a_new_process(tmp_path: Path) -> None:
    """A worker process is killed mid-job; the lease expires; the job resumes with attempts = 2."""
    settings = make_settings(tmp_path, job_lease_seconds=0.5, job_heartbeat_seconds=0.05)
    c = Container(settings)
    marker = tmp_path / "started.marker"
    job = c.queue.enqueue(SLOW_KIND, {"steps": 40, "delay": 0.1, "marker": str(marker), "marker_at": 1})
    root = str(Path(__file__).resolve().parents[2])
    script = (
        f"import sys; sys.path.insert(0, {root!r}); import tests.service.test_jobs as t; "
        "from wise_workbench.container import Container; from wise_workbench.jobs import Worker; "
        "from tests.conftest import make_settings; from pathlib import Path; "
        f"c = Container(make_settings(Path({str(tmp_path)!r}), job_lease_seconds=0.5, job_heartbeat_seconds=0.05)); "
        "Worker(c, worker_id='crashy').run_once()"
    )
    proc = subprocess.Popen([sys.executable, "-c", script], cwd=str(Path(__file__).resolve().parents[2]))
    deadline = time.monotonic() + 30
    while not marker.exists() and time.monotonic() < deadline and proc.poll() is None:
        time.sleep(0.05)
    assert marker.exists(), "the worker process never started the job"
    os.kill(proc.pid, signal.SIGKILL)
    proc.wait(timeout=10)
    stale = c.queue.get(job.id)
    assert stale.status == JobStatus.RUNNING and stale.attempts == 1
    assert c.queue.claim("resumer") is None  # the lease is still valid right after the crash
    time.sleep(0.7)  # let the lease expire (no heartbeat from the dead process)
    worker = Worker(c, worker_id="resumer")
    assert worker.run_once()
    final = c.queue.get(job.id)
    assert final.status == JobStatus.DONE and final.attempts == 2 and final.worker_id == "resumer"


def test_a_fresh_process_knows_the_builtin_kinds() -> None:
    """A standalone worker process must resolve ingest / build_cases / score_run without any prior enqueue."""
    code = (
        "from wise_workbench.jobs.registry import handler_for, known_kinds; "
        "assert {'ingest', 'build_cases', 'score_run'} <= set(known_kinds()); "
        "handler_for('score_run'); print('ok')"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0 and out.stdout.strip() == "ok", out.stderr
