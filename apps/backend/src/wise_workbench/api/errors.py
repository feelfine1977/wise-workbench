"""RFC 9457 problem details for every error the API emits."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from wise_workbench.domain import DomainError
from wise_workbench.logging import get_logger

log = get_logger("wise_workbench.api")
PROBLEM = "application/problem+json"
_TITLES = {
    400: "Bad Request",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Content",
    500: "Internal Server Error",
}


def problem(
    status: int,
    detail: str,
    *,
    code: str | None = None,
    errors: list[dict[str, Any]] | None = None,
    instance: str | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"urn:wise-workbench:problem:{code}" if code else "about:blank",
        "title": _TITLES.get(status, "Error"),
        "status": status,
        "detail": detail,
    }
    if code:
        body["code"] = code
    if instance:
        body["instance"] = instance
    body["errors"] = errors or []
    return JSONResponse(status_code=status, content=body, media_type=PROBLEM)


def install(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(request: Request, exc: DomainError) -> JSONResponse:
        return problem(exc.status, exc.detail, code=exc.code, errors=exc.errors, instance=str(request.url.path))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"field": ".".join(str(p) for p in e.get("loc", ())), "message": e.get("msg", "")} for e in exc.errors()
        ]
        return problem(
            422, "request validation failed", code="validation_error", errors=errors, instance=str(request.url.path)
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(exc.status_code, str(exc.detail), instance=str(request.url.path))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.error("api.unhandled", path=str(request.url.path), error=f"{type(exc).__name__}: {exc}")
        return problem(500, f"{type(exc).__name__}: {exc}", code="internal_error", instance=str(request.url.path))
