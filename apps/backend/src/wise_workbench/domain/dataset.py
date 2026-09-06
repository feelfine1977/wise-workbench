"""Dataset versions: an immutable ``events.parquet`` with a content hash and a column profile."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from .errors import InvalidTransitionError
from .project import utcnow


class DatasetStatus(StrEnum):
    INGESTING = "ingesting"
    READY = "ready"
    FAILED = "failed"


class SourceKind(StrEnum):
    CSV = "csv"
    PARQUET = "parquet"
    XES = "xes"


@dataclass(frozen=True)
class ColumnProfile:
    name: str
    dtype: str
    nulls: float
    distinct: int
    sample: tuple[Any, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "dtype": self.dtype,
            "nulls": self.nulls,
            "distinct": self.distinct,
            "sample": list(self.sample),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ColumnProfile:
        return cls(
            name=str(d["name"]),
            dtype=str(d.get("dtype", "string")),
            nulls=float(d.get("nulls", 0.0)),
            distinct=int(d.get("distinct", 0)),
            sample=tuple(d.get("sample", ())),
        )


@dataclass(frozen=True)
class DatasetVersion:
    id: str
    project_id: str
    name: str
    status: DatasetStatus = DatasetStatus.INGESTING
    source_kind: SourceKind = SourceKind.CSV
    source_path: str | None = None
    content_hash: str | None = None
    events: int | None = None
    columns: tuple[ColumnProfile, ...] = ()
    error: str | None = None
    job_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    def with_status(self, status: DatasetStatus, **changes: Any) -> DatasetVersion:
        allowed = {
            DatasetStatus.INGESTING: {DatasetStatus.READY, DatasetStatus.FAILED, DatasetStatus.INGESTING},
            DatasetStatus.READY: {DatasetStatus.READY},
            DatasetStatus.FAILED: {DatasetStatus.INGESTING, DatasetStatus.FAILED},
        }
        if status not in allowed[self.status]:
            raise InvalidTransitionError(f"dataset {self.id}: cannot go from {self.status} to {status}")
        from dataclasses import replace

        return replace(self, status=status, **changes)
