"""Domain errors. The API layer maps them to RFC 9457 problem responses."""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base class; ``code`` is stable and machine-readable."""

    code = "domain.error"
    status = 400

    def __init__(self, detail: str, *, code: str | None = None, errors: list[dict[str, Any]] | None = None):
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        self.errors = errors or []


class NotFoundError(DomainError):
    code = "not_found"
    status = 404


class ValidationError(DomainError):
    code = "validation_error"
    status = 422


class ConflictError(DomainError):
    code = "conflict"
    status = 409


class InvalidTransitionError(DomainError):
    code = "invalid_transition"
    status = 409
