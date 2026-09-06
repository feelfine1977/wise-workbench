"""Decisions taken on data caveats: each one is a versioned mapping decision that rebuilds the case table.

A decision names the readiness item it answers, the kind of action, its
parameters, and the numbers of cases and events it affects (from the
preview). Applying it creates a new mapping (child of the case table's
mapping, with the decision appended) and a new case table built from it;
the readiness report of that table is the re-evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .errors import ValidationError
from .project import utcnow

# kind → the readiness item it answers and the parameters it accepts
DECISION_KINDS: dict[str, dict[str, Any]] = {
    "drop_outside_window": {
        "item": "timestamp_outliers",
        "params": ["start", "end"],
        "label": "Drop events outside the observation window",
    },
    "sentinel_as_missing": {
        "item": "sentinel_dates",
        "params": ["timestamps", "activities"],
        "label": "Treat placeholder dates as missing timestamps",
    },
    "collapse_duplicates": {
        "item": "duplicate_events",
        "params": [],
        "label": "Collapse exact duplicate events",
    },
    "day_precision": {
        "item": "timestamp_precision",
        "params": ["activities"],
        "label": "Mark day-precision activities (lag thresholds on them in days only)",
    },
    "header_events": {
        "item": "header_event_replication",
        "params": ["activities"],
        "label": "Type header events (replicated onto items) away",
    },
    "open_cases": {
        "item": "right_censored",
        "params": ["handling", "closure", "window"],
        "label": "Handle open cases: censor in lags, exclude, or keep",
    },
    "zero_exposure": {
        "item": "zero_exposure",
        "params": ["handling"],
        "label": "Handle cases with exposure 0",
    },
    "flow_type_assignment": {
        "item": "flow_types",
        "params": ["rules", "default"],
        "label": "Assign flow types",
    },
}


def validate_decision(kind: str, params: dict[str, Any] | None) -> dict[str, Any]:
    """Check the kind and normalise its parameters."""
    spec = DECISION_KINDS.get(kind)
    if spec is None:
        raise ValidationError(f"unknown decision kind {kind!r}; known: {sorted(DECISION_KINDS)}", code="decision.kind")
    p = dict(params or {})
    unknown = [k for k in p if k not in spec["params"]]
    if unknown:
        raise ValidationError(f"decision {kind!r} accepts {spec['params']}; unknown: {unknown}", code="decision.params")
    if kind in ("day_precision", "header_events") and not p.get("activities"):
        raise ValidationError(f"decision {kind!r} needs a non-empty list of activities", code="decision.params")
    if kind == "sentinel_as_missing" and not p.get("timestamps"):
        raise ValidationError("decision 'sentinel_as_missing' needs the placeholder timestamps", code="decision.params")
    if kind == "open_cases":
        handling = str(p.get("handling") or "censor")
        if handling not in ("keep", "censor", "exclude"):
            raise ValidationError("open cases handling must be keep, censor or exclude", code="decision.params")
        p["handling"] = handling
        p["window"] = str(p.get("window") or "60D")
    if kind == "zero_exposure":
        handling = str(p.get("handling") or "exclude")
        if handling not in ("keep", "exclude"):
            raise ValidationError("zero exposure handling must be keep or exclude", code="decision.params")
        p["handling"] = handling
    if kind == "flow_type_assignment":
        rules = list(p.get("rules") or [])
        if not rules:
            raise ValidationError("decision 'flow_type_assignment' needs at least one rule", code="decision.params")
        p["rules"] = rules
        p["default"] = str(p.get("default") or "other")
    for key in ("activities", "timestamps"):
        if key in p and p[key] is not None:
            p[key] = [str(x) for x in p[key]]
    return p


@dataclass(frozen=True)
class DecisionPreview:
    cases: int
    events: int
    total_cases: int
    total_events: int
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cases": self.cases,
            "events": self.events,
            "totalCases": self.total_cases,
            "totalEvents": self.total_events,
            "detail": dict(self.detail),
        }


@dataclass(frozen=True)
class Decision:
    id: str
    project_id: str
    case_table_id: str
    kind: str
    params: dict[str, Any]
    readiness_item: str
    version: int
    mapping_id: str
    result_case_table_id: str
    preview: DecisionPreview
    author: str | None = None
    note: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "caseTableId": self.case_table_id,
            "kind": self.kind,
            "params": dict(self.params),
            "readinessItem": self.readiness_item,
            "version": self.version,
            "mappingId": self.mapping_id,
            "resultCaseTableId": self.result_case_table_id,
            "preview": self.preview.to_dict(),
            "author": self.author,
            "note": self.note,
            "createdAt": self.created_at.isoformat(),
        }
