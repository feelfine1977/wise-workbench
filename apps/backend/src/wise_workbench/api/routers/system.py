"""System endpoints: health, readiness, version."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from wise_workbench import __version__
from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health", operation_id="health")
def health(c: ContainerDep) -> dict[str, Any]:
    return {"status": "ok", "workspace": str(c.workspace.root), "inprocessWorker": c.settings.inprocess_worker}


@router.get("/ready", operation_id="ready")
def ready(c: ContainerDep) -> dict[str, Any]:
    with c.db.engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok", "workspaceWritable": c.workspace.tmp_dir.exists()}


@router.get("/version", operation_id="version", response_model=schemas.Version)
def version(c: ContainerDep) -> schemas.Version:
    try:
        import duckdb

        duck = str(duckdb.__version__)
    except Exception:  # pragma: no cover
        duck = None
    return schemas.Version(workbench=__version__, wise=c.engine.library_version(), duckdb=duck)
