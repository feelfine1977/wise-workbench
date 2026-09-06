"""The built single-page application, served next to the API.

``/assets/*`` are the content-hashed build files; any other path that is not an
API route answers with the file of that name when it exists (``mockServiceWorker.js``,
icons) and with ``index.html`` otherwise, so that the application's own routes
(``/p/<project>/runs/<run>/backlog``) survive a reload. ``/api/v1``, ``/docs`` and
``/redoc`` keep precedence because they are registered first.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

__all__ = ["mount_spa"]


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    root = static_dir.resolve()
    index = root / "index.html"
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{path:path}", include_in_schema=False, name="spa")
    async def spa(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"no API route at /{path}")
        if path:
            candidate = (root / path).resolve()
            if candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
