"""FastAPI application factory."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from wise_workbench import __version__
from wise_workbench.api import errors
from wise_workbench.api.routers import api_router
from wise_workbench.container import Container
from wise_workbench.jobs.worker import InProcessWorker
from wise_workbench.logging import get_logger
from wise_workbench.settings import Settings

log = get_logger("wise_workbench.api")

DESCRIPTION = (
    "WISE Workbench backend: projects, datasets, mappings, case tables, norm versions, runs, backlogs, "
    "slice detail, traces, diagnostics, signal distributions, process flow and jobs. Errors are RFC 9457 problem details."
)


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        c = container or Container(settings)
        app.state.container = c
        worker: InProcessWorker | None = None
        if c.settings.inprocess_worker:
            worker = InProcessWorker(c)
            worker.start()
            log.info("api.inprocess_worker", started=True)
        app.state.worker = worker
        try:
            yield
        finally:
            if worker is not None:
                worker.stop()
            if container is None:
                c.close()

    app = FastAPI(
        title="WISE Workbench API",
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        openapi_url="/api/v1/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    cfg = container.settings if container is not None else (settings or Settings())
    origins = cfg.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Location", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def _request_id(request: Request, call_next: Callable[[Request], Any]) -> Response:
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            response: Response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-Id"] = rid
        return response

    errors.install(app)
    app.include_router(api_router, prefix="/api/v1")
    return app


def openapi_document(app: FastAPI | None = None) -> dict[str, Any]:
    """The OpenAPI document with the ``/api/v1`` server prefix stripped from paths (as in the contract)."""
    app = app or create_app(Settings(inprocess_worker=False))
    doc = app.openapi()
    prefix = "/api/v1"
    doc["paths"] = {(p[len(prefix) :] if p.startswith(prefix) else p): v for p, v in doc["paths"].items()}
    doc["servers"] = [{"url": prefix}]
    return doc
