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

    @property
    def calibration_entries(self) -> dict[str, dict[str, Any]]:
        """Per expectation, the rationale and the owner recorded when its threshold was set (R3-02)."""
        block = (self.document.get("metadata") or {}).get("calibration")
        return {str(k): dict(v) for k, v in block.items()} if isinstance(block, dict) else {}

    @property
    def not_applicable(self) -> dict[str, dict[str, Any]]:
        """Expectations marked *not applicable to this log*, with the note that says why (R3-02)."""
        block = (self.document.get("metadata") or {}).get("not_applicable")
        return {str(k): dict(v) for k, v in block.items()} if isinstance(block, dict) else {}

    def with_status(self, status: NormStatus) -> NormVersion:
        if status == self.status:
            return self
        if status not in _TRANSITIONS[self.status]:
            raise InvalidTransitionError(f"norm version {self.id}: cannot go from {self.status} to {status}")
        return replace(self, status=status)


# ---------------------------------------------------------------------------- calibration (R3-02)
THRESHOLD_FIELDS = ("delta", "width", "k", "K", "max", "min", "threshold", "tolerance")


def thresholds_of(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Per expectation, the numbers that make it a threshold rather than a rule."""
    out: dict[str, dict[str, Any]] = {}
    for constraint in document.get("constraints") or []:
        cid = str(constraint.get("id") or "")
        params = dict(constraint.get("params") or {})
        values = {f: params[f] for f in THRESHOLD_FIELDS if f in params and params[f] is not None}
        if values:
            out[cid] = values
    return out


def changed_thresholds(document: dict[str, Any], parent: dict[str, Any] | None) -> list[str]:
    """Expectations whose threshold or applicability differs from the version this one was written from."""
    if not parent:
        return []
    here, before = thresholds_of(document), thresholds_of(parent)
    applicability_here = {str(c.get("id")): c.get("applicability") for c in document.get("constraints") or []}
    applicability_before = {str(c.get("id")): c.get("applicability") for c in parent.get("constraints") or []}
    changed = [cid for cid, values in here.items() if before.get(cid) != values]
    changed += [
        cid
        for cid, value in applicability_here.items()
        if cid in before and applicability_before.get(cid) != value and cid not in changed
    ]
    return sorted(set(changed))


def missing_rationales(
    document: dict[str, Any], parent: dict[str, Any] | None, declared_uncalibrated: list[str] | None = None
) -> list[str]:
    """Expectations whose threshold was set on this version without a rationale and an owner (R3-02).

    A threshold is a decision about the business, not a number: the version that carries it names the reason and
    the person who owns it, or it does not leave ``draft``.
    """
    calibration = (document.get("metadata") or {}).get("calibration") or {}
    changed = set(changed_thresholds(document, parent))
    still_flagged = {str(x).split(".")[0] for x in (declared_uncalibrated or [])}
    wanted = changed | (still_flagged & set(thresholds_of(document)))
    missing = []
    for cid in sorted(wanted):
        entry = calibration.get(cid) or {}
        if not str(entry.get("rationale") or "").strip() or not str(entry.get("owner") or "").strip():
            missing.append(cid)
    return missing
