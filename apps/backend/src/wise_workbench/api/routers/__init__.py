"""Routers mounted under ``/api/v1``."""

from fastapi import APIRouter

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
    api_router.include_router(r)

__all__ = ["api_router"]
