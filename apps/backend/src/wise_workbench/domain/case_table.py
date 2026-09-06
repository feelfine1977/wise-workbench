"""Case tables and the data-readiness report."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from .project import utcnow


class ReadinessLevel(StrEnum):
    INFO = "info"
    WARN = "warn"
    FAIL = "fail"


class ReadinessStatus(StrEnum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


class CaseTableStatus(StrEnum):
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


@dataclass(frozen=True)
class ReadinessItem:
    id: str
    level: ReadinessLevel
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "level": str(self.level), "message": self.message, "evidence": dict(self.evidence)}


@dataclass(frozen=True)
class Readiness:
    items: tuple[ReadinessItem, ...] = ()

    @property
    def status(self) -> ReadinessStatus:
        levels = {i.level for i in self.items}
        if ReadinessLevel.FAIL in levels:
            return ReadinessStatus.FAIL
        if ReadinessLevel.WARN in levels:
            return ReadinessStatus.WARN
        return ReadinessStatus.PASS

    def to_dict(self) -> dict[str, Any]:
        return {"status": str(self.status), "items": [i.to_dict() for i in self.items]}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Readiness:
        items = tuple(
            ReadinessItem(
                id=str(i["id"]),
                level=ReadinessLevel(str(i.get("level", "info"))),
                message=str(i.get("message", "")),
                evidence=dict(i.get("evidence") or {}),
            )
            for i in d.get("items", [])
        )
        return cls(items=items)


@dataclass(frozen=True)
class ActivityCount:
    label: str
    events: int
    cases: int


@dataclass(frozen=True)
class CaseTable:
    id: str
    project_id: str
    dataset_id: str
    mapping_id: str
    status: CaseTableStatus = CaseTableStatus.BUILDING
    cases: int | None = None
    events: int | None = None
    readiness: Readiness | None = None
    activities: tuple[ActivityCount, ...] = ()
    attributes: tuple[str, ...] = ()
    error: str | None = None
    job_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)
