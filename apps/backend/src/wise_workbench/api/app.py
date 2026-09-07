"""FastAPI application factory."""

from __future__ import annotations

import contextlib
import threading
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from wise_workbench import __version__
from wise_workbench.adapters.knowledge import case_noun as pack_case_noun
from wise_workbench.api import errors
from wise_workbench.api.routers import api_router
from wise_workbench.api.static import mount_spa
from wise_workbench.container import Container
from wise_workbench.jobs.worker import InProcessWorker
from wise_workbench.logging import get_logger
from wise_workbench.settings import Settings

log = get_logger("wise_workbench.api")

DESCRIPTION = (
    "WISE Workbench backend: projects, datasets, mappings, case tables, norm versions, runs, backlogs, "
    "slice detail, traces, diagnostics, signal distributions, process flow and jobs. Errors are RFC 9457 problem details."
)


def _warm_knowledge_packs(c: Container) -> None:
    """Load the knowledge packs of the workspace's projects in the background.

    Building a pack and its matcher takes about 1.2 s and every screen's first answer needs the case noun, so the
    very first request of a fresh process paid for it — including the board's first paint, which has a budget of
    one second (R3-07). The thread is a daemon and every failure is the pack's own business: without it the first
    caller loads the pack as before.
    """

    def warm() -> None:
        try:
            processes = {p.process for p in c.repos.list_projects() if p.process}
        except Exception:  # pragma: no cover - a workspace that cannot be read is reported by the first request
            return
        for process in sorted(processes):
            with contextlib.suppress(Exception):
                pack_case_noun(process)

    threading.Thread(target=warm, name="wise-knowledge-warm", daemon=True).start()


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
        _warm_knowledge_packs(c)
        if app.state.static_dir is not None:
            log.info("api.static", directory=str(app.state.static_dir))
        elif c.settings.static_dir is not None:
            log.warning(
                "api.static_missing", directory=str(c.settings.static_dir), detail="no index.html; serving the API only"
            )
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
    # The built frontend, when there is one; the message about it is logged at start-up (lifespan), after the
    # logging configuration, so that ``wise-workbench openapi`` keeps a clean stdout.
    static_dir = cfg.resolved_static_dir
    app.state.static_dir = static_dir
    if static_dir is not None:
        mount_spa(app, static_dir)
    return app


def openapi_document(app: FastAPI | None = None) -> dict[str, Any]:
    """The OpenAPI document with the ``/api/v1`` server prefix stripped from paths (as in the contract)."""
    app = app or create_app(Settings(inprocess_worker=False))
    doc = app.openapi()
    prefix = "/api/v1"
    doc["paths"] = {(p[len(prefix) :] if p.startswith(prefix) else p): v for p, v in doc["paths"].items()}
    doc["servers"] = [{"url": prefix}]
    return doc
