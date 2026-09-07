"""Norm versions: immutable library documents with a fingerprint, status and lineage."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import Any

from .errors import InvalidTransitionError
from .project import utcnow


class NormStatus(StrEnum):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    APPROVED = "approved"


_TRANSITIONS = {
    NormStatus.DRAFT: {NormStatus.REVIEWED, NormStatus.APPROVED},
    NormStatus.REVIEWED: {NormStatus.APPROVED, NormStatus.DRAFT},
    NormStatus.APPROVED: set(),
}


@dataclass(frozen=True)
class NormVersion:
    """``document`` is exactly what ``Norm.to_dict()`` emits; the app never rewrites it."""

    id: str
    project_id: str
    norm_id: str
    version: int
    fingerprint: str
    document: dict[str, Any]
    status: NormStatus = NormStatus.DRAFT
    note: str = ""
    author: str | None = None
    parent_id: str | None = None
    validation: tuple[str, ...] = ()
    created_at: datetime = field(default_factory=utcnow)

    @property
    def name(self) -> str:
        return str(self.document.get("name", "norm"))

    @property
    def view_names(self) -> list[str]:
        return [str(v["name"]) for v in self.document.get("views", [])]

    @property
    def meta(self) -> dict[str, Any]:
        """``metadata.meta`` of the document (the knowledge packs put calibration there; the library rejects
        unknown top-level keys, so the block sits inside ``metadata``)."""
        meta = (self.document.get("metadata") or {}).get("meta")
        return dict(meta) if isinstance(meta, dict) else {}

    @property
    def calibration(self) -> str | None:
        value = self.meta.get("calibration")
        return str(value) if value else None

    @property
    def uncalibrated(self) -> list[str]:
        """Thresholds and weights the norm itself declares as not yet calibrated (R2-09)."""
        return [str(x) for x in (self.meta.get("uncalibrated_parameters") or [])]

    def with_status(self, status: NormStatus) -> NormVersion:
        if status == self.status:
            return self
        if status not in _TRANSITIONS[self.status]:
            raise InvalidTransitionError(f"norm version {self.id}: cannot go from {self.status} to {status}")
        return replace(self, status=status)
