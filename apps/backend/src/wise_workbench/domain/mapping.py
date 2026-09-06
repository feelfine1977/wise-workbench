"""Column mapping: which columns play which role, plus header events and flow typing.

Flow-typing rules use the library's applicability grammar (``attr``/``in``/
``eq``/``has``/``all``/``any``/``not``) so that they are evaluated by the
library, never by the app. Header events are stored as a library derive
recipe (a scoped ``count``) so that the case table carries
``header_event_count`` as an ordinary derived attribute.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .errors import ValidationError
from .project import utcnow

RESERVED_ATTRIBUTES = {"n_events", "first_ts", "last_ts", "exposure", "score"}
FLOW_TYPE_ATTRIBUTE = "flow_type"
HEADER_EVENT_COUNT = "header_event_count"
OPEN_CASE_HANDLING = ("keep", "censor", "exclude")
ZERO_EXPOSURE_HANDLING = ("keep", "exclude")
DEFAULT_CASE_NOUN = "cases"


@dataclass(frozen=True)
class FlowTypingRule:
    """``name`` is the flow-type label; ``rule`` is a library applicability rule."""

    name: str
    rule: dict[str, Any]

    def __post_init__(self) -> None:
        if not self.name:
            raise ValidationError("flow typing: every rule needs a name")
        if not isinstance(self.rule, dict) or not self.rule:
            raise ValidationError(f"flow typing rule {self.name!r}: rule must be a non-empty mapping")


@dataclass(frozen=True)
class ColumnMapping:
    id: str
    dataset_id: str
    case_id: str
    activity: str
    timestamp: str
    timestamp_format: str | None = None
    dayfirst: bool = False
    utc: bool = False
    lifecycle: str | None = None
    keep_transitions: tuple[str, ...] = ("complete",)
    resource: str | None = None
    order: str | None = None
    event_id: str | None = None
    case_attributes: tuple[str, ...] = ()
    exposure: str | None = None
    exposure_agg: str = "max"
    exposure_abs: bool = True
    header_events: tuple[str, ...] = ()
    flow_typing: tuple[FlowTypingRule, ...] = ()
    flow_type_default: str = "other"
    closure_activities: tuple[str, ...] = ()
    derived_attributes: tuple[dict[str, Any], ...] = ()
    dedupe: bool = False
    missing_label: str | None = "(missing)"
    note: str | None = None
    case_noun: str | None = None
    day_precision_activities: tuple[str, ...] = ()
    open_cases: str = "keep"
    zero_exposure: str = "keep"
    censoring_window: str = "60D"
    decisions: tuple[dict[str, Any], ...] = ()
    parent_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        errors: list[dict[str, Any]] = []
        if self.open_cases not in OPEN_CASE_HANDLING:
            raise ValidationError(f"open cases handling must be one of {OPEN_CASE_HANDLING}", code="mapping.open_cases")
        if self.zero_exposure not in ZERO_EXPOSURE_HANDLING:
            raise ValidationError(
                f"zero exposure handling must be one of {ZERO_EXPOSURE_HANDLING}", code="mapping.zero_exposure"
            )
        for role in ("case_id", "activity", "timestamp"):
            if not getattr(self, role):
                errors.append({"field": role, "message": "required"})
        if errors:
            raise ValidationError("mapping is incomplete", code="mapping.incomplete", errors=errors)
        roles = {"case_id": self.case_id, "activity": self.activity, "timestamp": self.timestamp}
        seen: dict[str, str] = {}
        for role, col in roles.items():
            if col in seen:
                raise ValidationError(
                    f"column {col!r} is mapped to both {seen[col]} and {role}",
                    code="mapping.duplicate_role",
                    errors=[{"field": role, "message": "duplicate"}],
                )
            seen[col] = role
        for attr in self.case_attributes:
            if attr in RESERVED_ATTRIBUTES:
                raise ValidationError(
                    f"case attribute {attr!r} is reserved by the library; rename the column",
                    code="mapping.reserved_attribute",
                    errors=[{"field": "caseAttributes", "message": f"{attr} reserved"}],
                )
        if self.exposure_agg not in ("max", "sum", "first", "last", "min", "mean"):
            raise ValidationError(f"exposure_agg {self.exposure_agg!r} is not a supported aggregation")
        names = [r.name for r in self.flow_typing]
        if len(set(names)) != len(names):
            raise ValidationError("flow typing: rule names must be unique", code="mapping.flow_typing")

    # ------------------------------------------------------------------ derived
    @property
    def required_columns(self) -> list[str]:
        cols = [self.case_id, self.activity, self.timestamp, *self.case_attributes]
        for c in (self.lifecycle, self.resource, self.order, self.event_id, self.exposure):
            if c:
                cols.append(c)
        return list(dict.fromkeys(cols))

    def missing_columns(self, available: list[str]) -> list[str]:
        have = set(available)
        return [c for c in self.required_columns if c not in have]

    def check_columns(self, available: list[str]) -> None:
        missing = self.missing_columns(available)
        if missing:
            raise ValidationError(
                f"mapped columns are not in the dataset: {missing}",
                code="mapping.column_missing",
                errors=[{"field": "columns", "message": f"missing {c}"} for c in missing],
            )

    @property
    def noun(self) -> str:
        """The business name of a case ("purchase order items"); ``cases`` when the mapping has none."""
        return self.case_noun or DEFAULT_CASE_NOUN

    @property
    def version(self) -> int:
        """How many decisions this mapping carries (the mapping's decision version)."""
        return len(self.decisions)

    @property
    def all_case_attributes(self) -> list[str]:
        """Case attributes the case table carries: mapped ones plus the flow type."""
        attrs = list(self.case_attributes)
        if self.flow_typing and FLOW_TYPE_ATTRIBUTE not in attrs:
            attrs.append(FLOW_TYPE_ATTRIBUTE)
        return attrs

    def derive_recipes(self) -> list[dict[str, Any]]:
        """Library derive recipes implied by the mapping (header events, explicit recipes)."""
        recipes: list[dict[str, Any]] = []
        if self.header_events:
            recipes.append({"name": HEADER_EVENT_COUNT, "kind": "count", "activities": list(self.header_events)})
        recipes.extend(dict(r) for r in self.derived_attributes)
        return recipes

    def to_dict(self) -> dict[str, Any]:
        return {
            "caseId": self.case_id,
            "activity": self.activity,
            "timestamp": self.timestamp,
            "timestampFormat": self.timestamp_format,
            "dayfirst": self.dayfirst,
            "utc": self.utc,
            "lifecycle": self.lifecycle,
            "keepTransitions": list(self.keep_transitions),
            "resource": self.resource,
            "order": self.order,
            "eventId": self.event_id,
            "caseAttributes": list(self.case_attributes),
            "exposure": self.exposure,
            "exposureAgg": self.exposure_agg,
            "exposureAbs": self.exposure_abs,
            "headerEvents": list(self.header_events),
            "flowTyping": [{"name": r.name, "rule": dict(r.rule)} for r in self.flow_typing],
            "flowTypeDefault": self.flow_type_default,
            "closureActivities": list(self.closure_activities),
            "derivedAttributes": [dict(r) for r in self.derived_attributes],
            "dedupe": self.dedupe,
            "missingLabel": self.missing_label,
            "note": self.note,
            "caseNoun": self.case_noun,
            "dayPrecisionActivities": list(self.day_precision_activities),
            "openCases": self.open_cases,
            "zeroExposure": self.zero_exposure,
            "censoringWindow": self.censoring_window,
            "decisions": [dict(d) for d in self.decisions],
            "parentId": self.parent_id,
        }

    @classmethod
    def from_dict(
        cls, id: str, dataset_id: str, d: dict[str, Any], created_at: datetime | None = None
    ) -> ColumnMapping:
        flow = tuple(
            FlowTypingRule(name=str(r["name"]), rule=dict(r.get("rule") or {})) for r in d.get("flowTyping") or []
        )
        kwargs: dict[str, Any] = {}
        if created_at is not None:
            kwargs["created_at"] = created_at
        return cls(
            id=id,
            dataset_id=dataset_id,
            case_id=str(d.get("caseId") or ""),
            activity=str(d.get("activity") or ""),
            timestamp=str(d.get("timestamp") or ""),
            timestamp_format=d.get("timestampFormat") or None,
            dayfirst=bool(d.get("dayfirst", False)),
            utc=bool(d.get("utc", False)),
            lifecycle=d.get("lifecycle") or None,
            keep_transitions=tuple(d.get("keepTransitions") or ("complete",)),
            resource=d.get("resource") or None,
            order=d.get("order") or None,
            event_id=d.get("eventId") or None,
            case_attributes=tuple(d.get("caseAttributes") or ()),
            exposure=d.get("exposure") or None,
            exposure_agg=str(d.get("exposureAgg") or "max"),
            exposure_abs=bool(d.get("exposureAbs", True)),
            header_events=tuple(d.get("headerEvents") or ()),
            flow_typing=flow,
            flow_type_default=str(d.get("flowTypeDefault") or "other"),
            closure_activities=tuple(d.get("closureActivities") or ()),
            derived_attributes=tuple(dict(r) for r in d.get("derivedAttributes") or ()),
            dedupe=bool(d.get("dedupe", False)),
            missing_label=(str(d["missingLabel"]) if d.get("missingLabel") else None)
            if "missingLabel" in d
            else "(missing)",
            note=d.get("note") or None,
            case_noun=str(d["caseNoun"]) if d.get("caseNoun") else None,
            day_precision_activities=tuple(str(a) for a in d.get("dayPrecisionActivities") or ()),
            open_cases=str(d.get("openCases") or "keep"),
            zero_exposure=str(d.get("zeroExposure") or "keep"),
            censoring_window=str(d.get("censoringWindow") or "60D"),
            decisions=tuple(dict(x) for x in d.get("decisions") or ()),
            parent_id=d.get("parentId") or None,
            **kwargs,
        )
