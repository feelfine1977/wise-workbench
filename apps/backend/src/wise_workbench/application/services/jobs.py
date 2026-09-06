"""Jobs: read, cancel, and a polling event stream for SSE."""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import Job

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

HEARTBEAT_SECONDS = 10.0


class JobService:
    def __init__(self, c: Container):
        self.c = c

    def get(self, job_id: str) -> Job:
        return self.c.queue.get(job_id)

    def cancel(self, job_id: str) -> Job:
        return self.c.queue.cancel(job_id)

    def list(self, status: str | None = None, project_id: str | None = None) -> list[Job]:
        return self.c.queue.list(status=status, project_id=project_id)

    def events(
        self,
        job_id: str,
        *,
        poll: float | None = None,
        timeout: float | None = None,
        heartbeat: float = HEARTBEAT_SECONDS,
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield ``(event, data)`` pairs until the job ends.

        ``progress`` on every change of status, progress or message, ``heartbeat``
        while nothing changes, then exactly one terminal ``done`` event (whose
        ``status`` is done, failed or cancelled) and the iterator ends. A
        ``timeout`` ends the stream early with a ``timeout`` event.
        """
        poll = poll or self.c.settings.job_poll_seconds
        deadline = time.monotonic() + timeout if timeout else None
        last: tuple[str, float, str | None] | None = None
        last_sent = time.monotonic()
        while True:
            job = self.c.queue.get(job_id)
            state = (str(job.status), round(job.progress, 4), job.message)
            if state != last:
                last = state
                last_sent = time.monotonic()
                yield (
                    "progress",
                    {
                        "id": job.id,
                        "status": str(job.status),
                        "progress": job.progress,
                        "message": job.message,
                        "attempts": job.attempts,
                        "resultRef": job.result_ref,
                        "error": job.error,
                    },
                )
            if job.is_final:
                yield (
                    "done",
                    {
                        "id": job.id,
                        "status": str(job.status),
                        "progress": job.progress,
                        "message": job.message,
                        "resultRef": job.result_ref,
                        "error": job.error,
                        "attempts": job.attempts,
                    },
                )
                return
            if deadline is not None and time.monotonic() > deadline:
                yield "timeout", {"id": job.id, "status": str(job.status)}
                return
            if time.monotonic() - last_sent >= heartbeat:
                last_sent = time.monotonic()
                yield "heartbeat", {}
            time.sleep(poll)
