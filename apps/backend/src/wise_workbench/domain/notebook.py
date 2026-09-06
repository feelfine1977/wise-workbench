"""The analysis notebook: frozen snapshots of analysis screens, per project, in an order the author chooses."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

from .errors import ValidationError
from .project import utcnow

CONTEXT_KEYS = ("run_id", "slicing", "view", "filters", "url", "screen", "slice_key", "case_table_id")


def validate_context(context: dict[str, Any] | None) -> dict[str, Any]:
    out = {k: v for k, v in (context or {}).items() if v is not None}
    unknown = [k for k in out if k not in CONTEXT_KEYS]
    if unknown:
        raise ValidationError(
            f"snapshot context accepts {list(CONTEXT_KEYS)}; unknown: {unknown}", code="snapshot.context"
        )
    return out


@dataclass(frozen=True)
class Snapshot:
    id: str
    project_id: str
    title: str
    note: str = ""
    context: dict[str, Any] = field(default_factory=dict)
    data: Any = None
    image_path: str | None = None
    order: int = 0
    author: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        if not self.title or not self.title.strip():
            raise ValidationError(
                "a snapshot needs a title", code="snapshot.title", errors=[{"field": "title", "message": "required"}]
            )
        object.__setattr__(self, "context", validate_context(self.context))

    def edited(self, **changes: Any) -> Snapshot:
        return replace(self, updated_at=utcnow(), **changes)
