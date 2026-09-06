"""Runs: parameters, state machine, manifest and slicings."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import Any

from .errors import InvalidTransitionError, ValidationError
from .project import utcnow


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


_TRANSITIONS: dict[RunStatus, set[RunStatus]] = {
    RunStatus.QUEUED: {RunStatus.RUNNING, RunStatus.FAILED, RunStatus.CANCELLED},
    RunStatus.RUNNING: {RunStatus.DONE, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.QUEUED},
    RunStatus.DONE: set(),
    RunStatus.FAILED: {RunStatus.QUEUED},
    RunStatus.CANCELLED: {RunStatus.QUEUED},
}


def slicing_id(attributes: list[str] | tuple[str, ...]) -> str:
    """A stable identifier for a slicing: attribute names joined by ``+``."""
    return "+".join(attributes)


@dataclass(frozen=True)
class Slicing:
    id: str
    attributes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.attributes:
            raise ValidationError("a slicing needs at least one attribute", code="run.slicing_empty")
        object.__setattr__(self, "attributes", tuple(str(a) for a in self.attributes))
        if not self.id:
            object.__setattr__(self, "id", slicing_id(self.attributes))

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "attributes": list(self.attributes)}


@dataclass(frozen=True)
class RunParams:
    case_table_id: str
    norm_version_id: str
    views: tuple[str, ...] = ()
    slicings: tuple[Slicing, ...] = ()
    gamma: float = 50.0
    min_cases: int = 20
    baseline_run_id: str | None = None
    note: str | None = None

    def __post_init__(self) -> None:
        if not self.case_table_id or not self.norm_version_id:
            raise ValidationError("a run needs caseTableId and normVersionId", code="run.incomplete")
        if self.gamma < 0:
            raise ValidationError("gamma must be >= 0", code="run.gamma")
        if self.min_cases < 1:
            raise ValidationError("minCases must be >= 1", code="run.min_cases")
        ids = [s.id for s in self.slicings]
        if len(set(ids)) != len(ids):
            raise ValidationError("slicing ids must be unique", code="run.slicing_duplicate")

    def to_dict(self) -> dict[str, Any]:
        return {
            "caseTableId": self.case_table_id,
            "normVersionId": self.norm_version_id,
            "views": list(self.views),
            "slicings": [s.to_dict() for s in self.slicings],
            "gamma": self.gamma,
            "minCases": self.min_cases,
            "baselineRunId": self.baseline_run_id,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RunParams:
        slicings = tuple(
            Slicing(id=str(s.get("id") or ""), attributes=tuple(s.get("attributes") or ()))
            for s in d.get("slicings") or []
        )
        return cls(
            case_table_id=str(d.get("caseTableId") or ""),
            norm_version_id=str(d.get("normVersionId") or ""),
            views=tuple(d.get("views") or ()),
            slicings=slicings,
            gamma=float(d.get("gamma", 50.0)),
            min_cases=int(d.get("minCases", 20)),
            baseline_run_id=d.get("baselineRunId") or None,
            note=d.get("note") or None,
        )

    def params_hash(self) -> str:
        """Hash of everything that determines the result (the note is excluded)."""
        payload = {
            "caseTableId": self.case_table_id,
            "normVersionId": self.norm_version_id,
            "views": sorted(self.views),
            "slicings": sorted([list(s.attributes) for s in self.slicings]),
            "gamma": self.gamma,
            "minCases": self.min_cases,
            "baselineRunId": self.baseline_run_id,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RunManifest:
    norm_fingerprint: str
    content_hash: str
    mapping_id: str
    params_hash: str
    wise_version: str
    workbench_version: str = ""
    started_at: str | None = None
    finished_at: str | None = None
    artefacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    views: tuple[str, ...] = ()
    slicings: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "normFingerprint": self.norm_fingerprint,
            "contentHash": self.content_hash,
            "mappingId": self.mapping_id,
            "paramsHash": self.params_hash,
            "wiseVersion": self.wise_version,
            "workbenchVersion": self.workbench_version,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "artefacts": dict(self.artefacts),
            "views": list(self.views),
            "slicings": [dict(s) for s in self.slicings],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RunManifest:
        return cls(
            norm_fingerprint=str(d.get("normFingerprint", "")),
            content_hash=str(d.get("contentHash", "")),
            mapping_id=str(d.get("mappingId", "")),
            params_hash=str(d.get("paramsHash", "")),
            wise_version=str(d.get("wiseVersion", "")),
            workbench_version=str(d.get("workbenchVersion", "")),
            started_at=d.get("startedAt"),
            finished_at=d.get("finishedAt"),
            artefacts=dict(d.get("artefacts") or {}),
            views=tuple(d.get("views") or ()),
            slicings=tuple(d.get("slicings") or ()),
        )


@dataclass(frozen=True)
class Run:
    id: str
    project_id: str
    params: RunParams
    status: RunStatus = RunStatus.QUEUED
    params_hash: str = ""
    job_id: str | None = None
    idempotency_key: str | None = None
    manifest: RunManifest | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        if not self.params_hash:
            object.__setattr__(self, "params_hash", self.params.params_hash())

    def transition(self, status: RunStatus, **changes: Any) -> Run:
        if status == self.status:
            return replace(self, **changes)
        if status not in _TRANSITIONS[self.status]:
            raise InvalidTransitionError(
                f"run {self.id}: cannot go from {self.status} to {status}", code="run.transition"
            )
        return replace(self, status=status, **changes)

    @property
    def is_final(self) -> bool:
        return self.status in (RunStatus.DONE, RunStatus.FAILED, RunStatus.CANCELLED)
