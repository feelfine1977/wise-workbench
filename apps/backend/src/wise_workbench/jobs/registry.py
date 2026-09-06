"""Handler registry: job kind → handler callable, plus the hook run on final failure or cancel."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import ValidationError

if TYPE_CHECKING:  # pragma: no cover
    from .worker import JobContext

Handler = Callable[["JobContext"], str | None]
FinalHook = Callable[["JobContext", str, str | None], None]

_HANDLERS: dict[str, Handler] = {}
_FINAL_HOOKS: dict[str, FinalHook] = {}


def register(kind: str, handler: Handler, on_final: FinalHook | None = None) -> None:
    _HANDLERS[kind] = handler
    if on_final is not None:
        _FINAL_HOOKS[kind] = on_final


def _load_builtin() -> None:
    from . import handlers  # noqa: F401 - registers the built-in kinds on first use


def handler_for(kind: str) -> Handler:
    _load_builtin()
    try:
        return _HANDLERS[kind]
    except KeyError:
        raise ValidationError(f"no handler for job kind {kind!r}", code="job.kind") from None


def final_hook_for(kind: str) -> FinalHook | None:
    return _FINAL_HOOKS.get(kind)


def ensure_known_kind(kind: str) -> None:
    _load_builtin()
    if kind not in _HANDLERS:
        raise ValidationError(f"unknown job kind {kind!r}; known: {sorted(_HANDLERS)}", code="job.kind")


def known_kinds() -> list[str]:
    _load_builtin()
    return sorted(_HANDLERS)


def _reset_for_tests() -> dict[str, Any]:  # pragma: no cover - test helper
    return {"handlers": dict(_HANDLERS), "final": dict(_FINAL_HOOKS)}
