"""Server-owned hypothesis evidence, separate from the reviewer's annotations."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import ConflictError, ReviewKind, ValidationError

from . import action_evidence

if TYPE_CHECKING:
    from wise_workbench.container import Container

CONCLUSIVE = frozenset({"supported", "not_supported"})


def protect(body: dict[str, Any], kind: ReviewKind, *, update: bool = False) -> None:
    """Updates edit annotations; a different population or question needs a new record."""
    if update:
        writable = {"status", "title", "note"}
        writable |= {"outcome", "statement_plain", "evidence_links"} if kind == ReviewKind.HYPOTHESIS else {"evidence"}
        forbidden = set(body) - writable
    else:
        forbidden = set(body) & (action_evidence.SERVER_FIELDS | {"test", "interval_method", "confidence_level"})
        forbidden |= set(body) & (action_evidence.SCOPE_FIELDS - {"runId", "slicing", "sliceKey", "view"})
        if kind == ReviewKind.HYPOTHESIS:
            forbidden |= set(body) & {"status"}
    if forbidden:
        raise ValidationError(
            "Computed evidence and record identity are read only. Create a new record to change its assessment or constraint.",
            code="review.immutable_context",
            errors=[{"field": key, "message": "Read only"} for key in sorted(forbidden)],
        )


def require_test(c: Container, project_id: str, body: dict[str, Any]) -> None:
    """A reviewed conclusion requires current evidence and two measured populations."""
    if body["outcome"] not in CONCLUSIVE:
        return
    action_evidence.require_current(c, project_id, body.get("evidenceContext"), comparison="group_vs_rest")
    test = body.get("test") or {}
    values = [test.get("risk_difference"), *(test.get("interval") or [])]
    if (
        test.get("comparison") != "group_vs_rest"
        or len(values) != 3
        or any(not isinstance(x, int | float) or not math.isfinite(x) for x in values)
        or not test.get("n_group")
        or not test.get("n_rest")
    ):
        raise ConflictError(
            "This hypothesis has no measured comparison for both groups. Keep it open or inconclusive until evidence is available.",
            code="review.test_unavailable",
        )
