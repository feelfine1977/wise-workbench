"""Routers mounted under ``/api/v1``."""

from fastapi import APIRouter
from fastapi.routing import APIRoute

from . import datasets, jobs, knowledge, norms, notebook, projects, review, runs, system, whatif

api_router = APIRouter()
for r in (
    system.router,
    projects.router,
    datasets.router,
    norms.router,
    knowledge.router,
    runs.router,
    review.router,
    notebook.router,
    whatif.router,
    jobs.router,
):
    # Python 3.12 calls HTTP 422 "Unprocessable Entity", while 3.13 calls it
    # "Unprocessable Content". Set explicit Problem text on each leaf router
    # before inclusion (FastAPI may retain included routers lazily).
    # Generated request-validation responses retain "Validation Error".
    for route in r.routes:
        if isinstance(route, APIRoute) and 422 in route.responses:
            # Reserve content before description to preserve the committed YAML's
            # key order when FastAPI expands the response model into its schema.
            route.responses[422].setdefault("content", {})
            route.responses[422].setdefault("description", "Unprocessable Content")
    api_router.include_router(r)

__all__ = ["api_router"]
