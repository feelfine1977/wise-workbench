"""Routers mounted under ``/api/v1``."""

from fastapi import APIRouter

from . import datasets, jobs, norms, projects, runs, system

api_router = APIRouter()
for r in (system.router, projects.router, datasets.router, norms.router, runs.router, jobs.router):
    api_router.include_router(r)

__all__ = ["api_router"]
