"""The job queue on the ``jobs`` table: enqueue, claim with a lease, heartbeat, finish, cancel."""

from __future__ import annotations

from typing import Any

from wise_workbench.domain import FINAL_STATUSES, ConflictError, Job, JobStatus, utcnow
from wise_workbench.ids import new_id
from wise_workbench.settings import Settings

from .registry import ensure_known_kind


class JobCancelled(Exception):
    """Raised inside a handler when the job's cancel flag is set."""


class JobQueue:
    def __init__(self, repos: Any, settings: Settings):
        self.repos = repos
        self.settings = settings

    # ------------------------------------------------------------- producers
    def enqueue(self, kind: str, payload: dict[str, Any], project_id: str | None = None) -> Job:
        ensure_known_kind(kind)
        job = Job(
            id=new_id("job"),
            kind=kind,
            payload=dict(payload),
            project_id=project_id,
            max_attempts=self.settings.job_max_attempts,
        )
        return self.repos.add_job(job)

    def get(self, job_id: str) -> Job:
        return self.repos.get_job(job_id)

    def list(self, status: str | None = None, project_id: str | None = None) -> list[Job]:
        return self.repos.list_jobs(status=status, project_id=project_id)

    def cancel(self, job_id: str) -> Job:
        job = self.repos.get_job(job_id)
        if job.status in FINAL_STATUSES:
            return job
        if job.status == JobStatus.QUEUED:
            job = job.transition(JobStatus.CANCELLED, cancel_requested=True, message="cancelled before it started")
            return self.repos.save_job(job)
        self.repos.update_job_fields(job_id, cancel_requested=True, updated_at=utcnow())
        return self.repos.get_job(job_id)

    # ------------------------------------------------------------- workers
    def claim(self, worker_id: str) -> Job | None:
        return self.repos.claim_job(worker_id, self.settings.job_lease_seconds, utcnow())

    def heartbeat(self, job: Job, worker_id: str) -> bool:
        """Extend the lease; returns True when the job must stop (cancel flag or lost lease)."""
        return bool(self.repos.heartbeat(job.id, worker_id, self.settings.job_lease_seconds, utcnow()))

    def progress(self, job_id: str, progress: float, message: str | None) -> None:
        self.repos.update_job_fields(
            job_id, progress=max(0.0, min(float(progress), 1.0)), message=message, updated_at=utcnow()
        )

    def complete(self, job: Job, result_ref: str | None = None, message: str | None = None) -> Job:
        current = self.repos.get_job(job.id)
        if current.status in FINAL_STATUSES:
            raise ConflictError(f"job {job.id} is already {current.status}", code="job.final")
        done = current.transition(
            JobStatus.DONE, progress=1.0, result_ref=result_ref, message=message or "done", error=None
        )
        return self.repos.save_job(done)

    def fail(self, job: Job, error: str) -> Job:
        """Requeue while attempts remain, else mark failed."""
        current = self.repos.get_job(job.id)
        if current.status in FINAL_STATUSES:
            return current
        if current.can_retry() and not current.cancel_requested:
            requeued = current.transition(
                JobStatus.QUEUED,
                error=error,
                message=f"attempt {current.attempts} failed; retrying",
                lease_until=None,
                worker_id=None,
            )
            return self.repos.save_job(requeued)
        failed = current.transition(JobStatus.FAILED, error=error, message="failed")
        return self.repos.save_job(failed)

    def mark_cancelled(self, job: Job, message: str = "cancelled") -> Job:
        current = self.repos.get_job(job.id)
        if current.status in FINAL_STATUSES:
            return current
        return self.repos.save_job(current.transition(JobStatus.CANCELLED, message=message))
