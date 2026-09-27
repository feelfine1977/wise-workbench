"""Persist findings with the same server-owned assessment context as action proposals."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wise_workbench.domain import ConflictError, ReviewItem, ReviewKind
from wise_workbench.ids import new_id

from . import action_evidence, hypothesis_evidence

if TYPE_CHECKING:
    from wise_workbench.container import Container


def create(c: Container, project_id: str, body: dict[str, Any]) -> ReviewItem:
    c.repos.get_project(project_id)
    # Findings accept the same filter input as actions; every other protected field
    # still follows the existing finding contract. Never trust a supplied context.
    hypothesis_evidence.protect({k: v for k, v in body.items() if k != "filter"}, ReviewKind.FINDING)
    payload = dict(body)
    run_id = payload.pop("runId", None)
    slicing = payload.pop("slicing", None)
    slice_key = payload.pop("sliceKey", None)
    view = payload.pop("view", None)
    filter_value = payload.pop("filter", None)
    if any(v is not None for v in (run_id, slicing, slice_key, view, filter_value)) and not all(
        (run_id, slicing, slice_key)
    ):
        raise ConflictError(
            "Choose a run and group before saving a scoped finding.",
            code="review.context_required",
        )
    context = action_evidence.capture(c, project_id, run_id, slicing, slice_key, view, filter_value)
    if context:
        run_id, slicing, slice_key, view = (context[k] for k in ("runId", "slicing", "sliceKey", "view"))
    payload["evidenceContext"] = context
    payload["evidenceState"] = "recorded" if context else "unassessed"
    item = ReviewItem(
        id=new_id("find"),
        project_id=project_id,
        kind=ReviewKind.FINDING,
        status=str(payload.pop("status", "open")),
        title=str(payload.pop("title", "") or ""),
        run_id=run_id,
        slicing=slicing,
        slice_key=slice_key,
        view=view,
        author=payload.pop("author", None),
        note=payload.pop("note", None),
        body=payload,
    )
    return c.repos.add_review_item(item)
