"""Project: one process under study, its steering question and knowledge pack."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from .errors import ValidationError


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    process: str | None = None
    question: str | None = None
    latest_run_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        if not self.name or not self.name.strip():
            raise ValidationError("a project needs a name", errors=[{"field": "name", "message": "required"}])
