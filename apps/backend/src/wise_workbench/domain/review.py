"""What a review records (R1-12, R1-15): hypotheses, gates, findings and actions.

Four kinds of record with the same skeleton — who wrote it, about which run and which group, what it says, what
state it is in — and a JSON body that differs per kind. They live in one table because the review screens read
them together: a finding cites the hypothesis that survived its gates, an action cites the finding it answers.

* **hypothesis** — group, perspective, expectation, comparison, expected direction, evidence links, the computed
  test (risk difference with its interval, the shift in real units) and the outcome;
* **gate** — readiness, censoring, replication or domain; a hypothesis or an action on a group whose gate has
  failed is refused until the gate is passed or waived with a note;
* **finding** — what the analysis concluded about a group, with its evidence;
* **action** — what will be done: mechanism, remedy, countermeasure type, owner role, due date, status.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import Any

from .errors import ValidationError
from .project import utcnow


class ReviewKind(StrEnum):
    HYPOTHESIS = "hypothesis"
    GATE = "gate"
    FINDING = "finding"
    ACTION = "action"


GATE_KINDS = ("readiness", "censoring", "replication", "domain")
GATE_STATUSES = ("pending", "passed", "failed", "waived")
HYPOTHESIS_OUTCOMES = ("open", "supported", "not_supported", "inconclusive")
ACTION_STATUSES = ("proposed", "agreed", "in_progress", "done", "dropped")
COMPARISONS = ("group_vs_rest", "period", "subgroup")
DIRECTIONS = ("higher", "lower", "none")
COUNTERMEASURES = (
    "policy",
    "system_setting",
    "standard_work",
    "training",
    "catalogue",
    "contract",
    "master_data",
    "automation",
    "review",
    "measurement",
)


@dataclass(frozen=True)
class ReviewItem:
    id: str
    project_id: str
    kind: ReviewKind
    status: str
    title: str = ""
    run_id: str | None = None
    slicing: str | None = None
    slice_key: str | None = None
    view: str | None = None
    body: dict[str, Any] = field(default_factory=dict)
    author: str | None = None
    note: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    def with_changes(self, **changes: Any) -> ReviewItem:
        return replace(self, updated_at=utcnow(), **changes)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "kind": str(self.kind),
            "status": self.status,
            "title": self.title,
            "runId": self.run_id,
            "slicing": self.slicing,
            "sliceKey": self.slice_key,
            "view": self.view,
            "author": self.author,
            "note": self.note,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
            **dict(self.body),
        }


def validate_hypothesis(body: dict[str, Any]) -> dict[str, Any]:
    out = dict(body)
    comparison = str(out.get("comparison") or "group_vs_rest")
    if comparison not in COMPARISONS:
        raise ValidationError(f"comparison must be one of {list(COMPARISONS)}", code="hypothesis.comparison")
    direction = str(out.get("expected_direction") or "higher")
    if direction not in DIRECTIONS:
        raise ValidationError(f"expected_direction must be one of {list(DIRECTIONS)}", code="hypothesis.direction")
    outcome = str(out.get("outcome") or "open")
    if outcome not in HYPOTHESIS_OUTCOMES:
        raise ValidationError(f"outcome must be one of {list(HYPOTHESIS_OUTCOMES)}", code="hypothesis.outcome")
    if not out.get("constraint_id"):
        raise ValidationError("a hypothesis names the expectation it is about", code="hypothesis.constraint")
    out["comparison"] = comparison
    out["expected_direction"] = direction
    out["outcome"] = outcome
    out["evidence_links"] = [str(x) for x in out.get("evidence_links") or []]
    return out


def validate_action(body: dict[str, Any]) -> dict[str, Any]:
    out = dict(body)
    status = str(out.get("status") or "proposed")
    if status not in ACTION_STATUSES:
        raise ValidationError(f"status must be one of {list(ACTION_STATUSES)}", code="action.status")
    counter = out.get("countermeasure")
    if counter is not None and str(counter) not in COUNTERMEASURES:
        raise ValidationError(f"countermeasure must be one of {list(COUNTERMEASURES)}", code="action.countermeasure")
    if out.get("owner_role") is not None and not isinstance(out["owner_role"], str):
        raise ValidationError(
            "Name the owner role as text.",
            code="action.owner_role",
            errors=[{"field": "owner_role", "message": "Enter a role name"}],
        )
    out["status"] = status
    out["links"] = [str(x) for x in out.get("links") or []]
    return out


def validate_gate_update(status: str, note: str | None) -> tuple[str, str | None]:
    if status not in GATE_STATUSES:
        raise ValidationError(f"status must be one of {list(GATE_STATUSES)}", code="gate.status")
    if status in ("passed", "waived") and not (note or "").strip():
        raise ValidationError("passing or waiving a gate needs a note that says why", code="gate.note")
    return status, note
