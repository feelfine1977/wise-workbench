"""Jobs: get, list, cancel, server-sent progress events."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import StreamingResponse

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.api.sse import sse_response

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", operation_id="listJobs", response_model=list[schemas.Job])
def list_jobs(c: ContainerDep, state: str | None = None, projectId: str | None = None) -> list[schemas.Job]:
    return [schemas.Job.from_domain(j) for j in c.jobs.list(status=state, project_id=projectId)]


@router.get("/{jobId}", operation_id="getJob", response_model=schemas.Job)
def get_job(jobId: str, c: ContainerDep) -> schemas.Job:
    return schemas.Job.from_domain(c.jobs.get(jobId))


@router.delete("/{jobId}", operation_id="cancelJob", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def cancel_job(jobId: str, c: ContainerDep) -> Response:
    c.jobs.cancel(jobId)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{jobId}/events",
    operation_id="jobEvents",
    description=(
        "Server-sent events: `progress` on every change, heartbeat comments while nothing changes, "
        "then one terminal `done` event (status done, failed or cancelled) and the stream closes."
    ),
    responses={200: {"content": {"text/event-stream": {}}, "description": "text/event-stream"}},
)
def job_events(
    jobId: str, c: ContainerDep, request: Request, timeout: Annotated[float | None, Query(ge=1)] = None
) -> StreamingResponse:
    c.jobs.get(jobId)
    return sse_response(c.jobs.events(jobId, timeout=timeout), request)
