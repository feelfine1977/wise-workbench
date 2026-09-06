"""Workers claim jobs with a lease, heartbeat while running, and finish or requeue them.

``Worker`` is used by the ``wise-workbench worker`` process; ``InProcessWorker``
runs the same loop on a daemon thread inside the API process (desktop mode).
A handler that raises :class:`JobCancelled` ends as ``cancelled``; any other
exception requeues the job while attempts remain and marks it ``failed`` after
the last attempt. A worker that dies mid-job leaves an expiring lease behind,
so another worker (or the restarted one) claims the job with ``attempts + 1``.
"""

from __future__ import annotations

import os
import socket
import threading
import time
import traceback
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import Job, JobStatus
from wise_workbench.logging import get_logger

from .queue import JobCancelled, JobQueue
from .registry import final_hook_for, handler_for, known_kinds

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

log = get_logger("wise_workbench.jobs")


def default_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{threading.get_ident()}"


class JobContext:
    """What a handler gets: the job, the container, progress reporting and cancel checks."""

    def __init__(self, job: Job, queue: JobQueue, container: Container, worker_id: str):
        self.job = job
        self.queue = queue
        self.container = container
        self.worker_id = worker_id
        self.stop_requested = threading.Event()
        self._last_progress = 0.0

    def check_cancelled(self) -> None:
        if self.stop_requested.is_set():
            raise JobCancelled(f"job {self.job.id} was cancelled")

    def progress(self, fraction: float, message: str | None = None) -> None:
        self.check_cancelled()
        self._last_progress = fraction
        try:
            self.queue.progress(self.job.id, fraction, message)
        except Exception as exc:  # progress is best effort; never fail the job for it
            log.warning("job.progress_failed", job_id=self.job.id, error=str(exc))
        log.info("job.progress", job_id=self.job.id, kind=self.job.kind, progress=round(fraction, 3), message=message)

    @property
    def payload(self) -> dict[str, Any]:
        return self.job.payload


class Worker:
    def __init__(self, container: Container, worker_id: str | None = None):
        self.container = container
        self.queue: JobQueue = container.queue
        self.settings = container.settings
        self.worker_id = worker_id or default_worker_id()
        self.kinds = known_kinds()  # a worker process must know the built-in kinds before its first claim

    # ---------------------------------------------------------------- loops
    def run_once(self) -> bool:
        """Claim and execute one job. Returns ``False`` when nothing was claimable."""
        job = self.queue.claim(self.worker_id)
        if job is None:
            return False
        self.execute(job)
        return True

    def drain(self, max_jobs: int | None = None) -> int:
        """Run jobs until the queue has nothing claimable (CLI, demos and tests)."""
        n = 0
        while self.run_once():
            n += 1
            if max_jobs is not None and n >= max_jobs:
                break
        return n

    def run_forever(self, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        log.info("worker.start", worker_id=self.worker_id)
        while not stop.is_set():
            try:
                ran = self.run_once()
            except Exception as exc:  # the loop must survive DB hiccups
                log.error("worker.loop_error", error=str(exc))
                ran = False
            if not ran:
                stop.wait(self.settings.job_poll_seconds)
        log.info("worker.stop", worker_id=self.worker_id)

    # ---------------------------------------------------------------- execution
    def execute(self, job: Job) -> Job:
        ctx = JobContext(job, self.queue, self.container, self.worker_id)
        stop_heartbeat = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat_loop, args=(ctx, stop_heartbeat), name=f"heartbeat-{job.id}", daemon=True
        )
        heartbeat.start()
        started = time.perf_counter()
        log.info("job.start", job_id=job.id, kind=job.kind, attempt=job.attempts, worker_id=self.worker_id)
        try:
            if job.cancel_requested:
                raise JobCancelled("cancel requested before start")
            result_ref = handler_for(job.kind)(ctx)
            stop_heartbeat.set()
            heartbeat.join(timeout=5)
            final = self.queue.complete(job, result_ref=result_ref)
            log.info(
                "job.done",
                job_id=job.id,
                kind=job.kind,
                seconds=round(time.perf_counter() - started, 2),
                result=result_ref,
            )
            return final
        except JobCancelled as exc:
            stop_heartbeat.set()
            final = self.queue.mark_cancelled(job, message=str(exc))
            self._run_final_hook(ctx, JobStatus.CANCELLED, str(exc))
            log.info("job.cancelled", job_id=job.id, kind=job.kind)
            return final
        except Exception as exc:
            stop_heartbeat.set()
            error = f"{type(exc).__name__}: {exc}"
            log.error(
                "job.error",
                job_id=job.id,
                kind=job.kind,
                attempt=job.attempts,
                error=error,
                traceback=traceback.format_exc(),
            )
            final = self.queue.fail(job, error)
            if final.status == JobStatus.FAILED:
                self._run_final_hook(ctx, JobStatus.FAILED, error)
            return final
        finally:
            stop_heartbeat.set()

    def _run_final_hook(self, ctx: JobContext, status: JobStatus, error: str | None) -> None:
        hook = final_hook_for(ctx.job.kind)
        if hook is None:
            return
        try:
            hook(ctx, str(status), error)
        except Exception as exc:  # pragma: no cover - defensive
            log.error("job.final_hook_error", job_id=ctx.job.id, error=str(exc))

    def _heartbeat_loop(self, ctx: JobContext, stop: threading.Event) -> None:
        interval = self.settings.job_heartbeat_seconds
        while not stop.wait(interval):
            try:
                must_stop = self.queue.heartbeat(ctx.job, self.worker_id)
            except Exception as exc:
                log.warning("job.heartbeat_failed", job_id=ctx.job.id, error=str(exc))
                continue
            if must_stop:
                ctx.stop_requested.set()
                return


class InProcessWorker:
    """The worker loop on a daemon thread inside the API process."""

    def __init__(self, container: Container):
        self.worker = Worker(container, worker_id=f"inprocess:{default_worker_id()}")
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self.worker.run_forever, args=(self._stop,), name="wise-inprocess-worker", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
