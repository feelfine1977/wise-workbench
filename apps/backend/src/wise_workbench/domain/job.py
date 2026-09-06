"""Jobs: the crash-safe unit of background work (lease, heartbeat, retries, cancel, progress)."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from .errors import InvalidTransitionError
from .project import utcnow


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobKind(StrEnum):
    """The built-in job kinds; ``Job.kind`` is a string so that extra handlers can be registered."""

    INGEST = "ingest"
    BUILD_CASES = "build_cases"
    SCORE_RUN = "score_run"
    LOAD_PRESET = "load_preset"


FINAL_STATUSES = {JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED}

_TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.QUEUED: {JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.FAILED},
    JobStatus.RUNNING: {JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.QUEUED, JobStatus.RUNNING},
    JobStatus.DONE: set(),
    JobStatus.FAILED: {JobStatus.QUEUED},
    JobStatus.CANCELLED: set(),
}


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    payload: dict[str, Any]
    project_id: str | None = None
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    message: str | None = None
    attempts: int = 0
    max_attempts: int = 3
    lease_until: datetime | None = None
    heartbeat_at: datetime | None = None
    worker_id: str | None = None
    cancel_requested: bool = False
    result_ref: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    @property
    def is_final(self) -> bool:
        return self.status in FINAL_STATUSES

    def lease_expired(self, now: datetime | None = None) -> bool:
        now = now or utcnow()
        return self.status == JobStatus.RUNNING and (self.lease_until is None or self.lease_until < now)

    def claim(self, worker_id: str, lease: timedelta, now: datetime | None = None) -> Job:
        """The state after a worker takes the job (queued or with an expired lease)."""
        now = now or utcnow()
        if self.status == JobStatus.QUEUED or self.lease_expired(now):
            return replace(
                self,
                status=JobStatus.RUNNING,
                worker_id=worker_id,
                attempts=self.attempts + 1,
                lease_until=now + lease,
                heartbeat_at=now,
                started_at=self.started_at or now,
                updated_at=now,
            )
        raise InvalidTransitionError(f"job {self.id} is {self.status} and its lease has not expired")

    def transition(self, status: JobStatus, now: datetime | None = None, **changes: Any) -> Job:
        now = now or utcnow()
        if status != self.status and status not in _TRANSITIONS[self.status]:
            raise InvalidTransitionError(
                f"job {self.id}: cannot go from {self.status} to {status}", code="job.transition"
            )
        finished = now if status in FINAL_STATUSES else self.finished_at
        return replace(self, status=status, updated_at=now, finished_at=finished, **changes)

    def can_retry(self) -> bool:
        return self.attempts < self.max_attempts

    def __post_init__(self) -> None:
        if not str(self.kind):
            raise InvalidTransitionError("a job needs a kind", code="job.kind")
        object.__setattr__(self, "kind", str(self.kind))
