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


BAND_METHODS = ("quantile", "cuts")
MAX_SLICING_ATTRIBUTES = 3


def band_suffix(band: dict[str, Any]) -> str:
    """The id suffix of a banded attribute: ``exposure:q4`` or ``exposure:cuts(10,100)``."""
    method = str(band.get("method") or "quantile")
    if method == "quantile":
        return f"q{int(band.get('q') or 4)}"
    cuts = ",".join(f"{float(c):g}" for c in band.get("cuts") or [])
    return f"cuts({cuts})"


def slicing_id(attributes: list[str] | tuple[str, ...], bands: list[dict[str, Any]] | tuple[Any, ...] = ()) -> str:
    """A stable identifier for a slicing: attribute names joined by ``+``; banded attributes carry their band."""
    by_attr = {str(b.get("attribute")): b for b in bands}
    parts = []
    for a in attributes:
        parts.append(f"{a}:{band_suffix(by_attr[a])}" if a in by_attr else a)
    return "+".join(parts)


def validate_band(band: dict[str, Any], attributes: tuple[str, ...]) -> dict[str, Any]:
    attr = str(band.get("attribute") or "")
    if attr not in attributes:
        raise ValidationError(
            f"band attribute {attr!r} is not one of the slicing's attributes {list(attributes)}",
            code="run.band_attribute",
        )
    method = str(band.get("method") or "quantile")
    if method not in BAND_METHODS:
        raise ValidationError(f"band method {method!r} must be one of {BAND_METHODS}", code="run.band_method")
    out: dict[str, Any] = {"attribute": attr, "method": method}
    if method == "quantile":
        q = int(band.get("q") or 4)
        if q < 2 or q > 20:
            raise ValidationError("a quantile band needs 2 to 20 bands", code="run.band_q")
        out["q"] = q
    else:
        cuts = [float(c) for c in (band.get("cuts") or [])]
        if not cuts or cuts != sorted(cuts):
            raise ValidationError("cut points must be an ascending list of numbers", code="run.band_cuts")
        out["cuts"] = cuts
    if band.get("labels"):
        out["labels"] = [str(x) for x in band["labels"]]
    return out


@dataclass(frozen=True)
class Slicing:
    """A slicing: one to three case attributes; numeric attributes may be banded (quantiles or cut points)."""

    id: str
    attributes: tuple[str, ...]
    bands: tuple[dict[str, Any], ...] = ()

    def __post_init__(self) -> None:
        if not self.attributes:
            raise ValidationError("a slicing needs at least one attribute", code="run.slicing_empty")
        object.__setattr__(self, "attributes", tuple(str(a) for a in self.attributes))
        if len(self.attributes) > MAX_SLICING_ATTRIBUTES:
            raise ValidationError(
                f"a slicing combines at most {MAX_SLICING_ATTRIBUTES} attributes", code="run.slicing_too_wide"
            )
        if len(set(self.attributes)) != len(self.attributes):
            raise ValidationError("a slicing lists every attribute once", code="run.slicing_duplicate_attribute")
        bands = tuple(validate_band(dict(b), self.attributes) for b in self.bands)
        if len({b["attribute"] for b in bands}) != len(bands):
            raise ValidationError("one band per attribute", code="run.band_duplicate")
        object.__setattr__(self, "bands", bands)
        if not self.id:
            object.__setattr__(self, "id", slicing_id(self.attributes, bands))

    def band_for(self, attribute: str) -> dict[str, Any] | None:
        return next((b for b in self.bands if b["attribute"] == attribute), None)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "attributes": list(self.attributes)}
        if self.bands:
            out["bands"] = [dict(b) for b in self.bands]
        return out


SCOPE_KEYS = ("flow_type", "attribute", "value")


def validate_scope(scope: dict[str, Any] | None) -> dict[str, Any] | None:
    """``{"flow_type": "DF2"}`` (the mapping's flow type) or ``{"attribute": "…", "value": "…"}``."""
    if not scope:
        return None
    unknown = [k for k in scope if k not in SCOPE_KEYS]
    if unknown:
        raise ValidationError(f"scope accepts {list(SCOPE_KEYS)}; unknown: {unknown}", code="run.scope")
    out: dict[str, Any] = {}
    if scope.get("flow_type") is not None:
        out["flow_type"] = str(scope["flow_type"])
        out["attribute"] = str(scope.get("attribute") or "flow_type")
    elif scope.get("attribute") and scope.get("value") is not None:
        out["attribute"] = str(scope["attribute"])
        out["value"] = str(scope["value"])
    else:
        raise ValidationError("scope needs flow_type, or attribute and value", code="run.scope")
    return out


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
    scope: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if not self.case_table_id or not self.norm_version_id:
            raise ValidationError("a run needs caseTableId and normVersionId", code="run.incomplete")
        object.__setattr__(self, "scope", validate_scope(self.scope))
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
            "scope": dict(self.scope) if self.scope else None,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RunParams:
        slicings = tuple(
            Slicing(
                id=str(s.get("id") or ""),
                attributes=tuple(s.get("attributes") or ()),
                bands=tuple(dict(b) for b in s.get("bands") or ()),
            )
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
            scope=dict(d["scope"]) if d.get("scope") else None,
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
        # keys added in cycle 2 enter the hash only when set, so that earlier runs keep their hash
        bands = sorted(
            json.dumps([list(s.attributes), list(s.bands)], sort_keys=True) for s in self.slicings if s.bands
        )
        if bands:
            payload["bands"] = bands
        if self.scope:
            payload["scope"] = self.scope
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
    scope: dict[str, Any] | None = None
    cases: int | None = None
    window_end: str | None = None
    norm_warnings: tuple[str, ...] = ()

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
            "scope": dict(self.scope) if self.scope else None,
            "cases": self.cases,
            "windowEnd": self.window_end,
            "normWarnings": list(self.norm_warnings),
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
            scope=dict(d["scope"]) if d.get("scope") else None,
            cases=int(d["cases"]) if d.get("cases") is not None else None,
            window_end=str(d["windowEnd"]) if d.get("windowEnd") else None,
            norm_warnings=tuple(str(w) for w in d.get("normWarnings") or ()),
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
