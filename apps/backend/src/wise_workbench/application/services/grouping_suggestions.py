"""Read-only suggestions tied to fixed project data, norm, and immutable cohort."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pandas as pd

from wise_workbench.adapters.engine.grouping_suggestions import discover_groupings
from wise_workbench.adapters.storage.selections import checksum, read_selection, source_identity
from wise_workbench.api.schema_models.grouping_suggestions import GroupingSuggestionsRequest
from wise_workbench.domain import ConflictError, ValidationError
from wise_workbench.domain.run import validate_scope

from .project_binding import require_dataset_binding
from .selections import get_selection, selection_context

if TYPE_CHECKING:
    from wise_workbench.container import Container


def suggest_groupings(c: Container, project_id: str, table_id: str, body: GroupingSuggestionsRequest) -> dict[str, Any]:
    require_dataset_binding(c, project_id, table_id)
    table, mapping, dataset, directory = selection_context(c, project_id, table_id)
    norm = c.norms.get(project_id, body.normVersionId)
    before = source_identity(directory, mapping, dataset.content_hash)
    frame = pd.read_parquet(directory / "cases.parquet")
    # Workspace parquet stores a named case index as a physical column; external
    # parquet may retain pandas index metadata instead. Both retain exact IDs.
    if frame.index.name is None:
        if mapping.case_id not in frame:
            raise ValidationError("Prepared case table has no case identity", code="selection.case_ids")
        frame = frame.set_index(mapping.case_id)
    if frame.index.hasnans or not frame.index.is_unique or not frame.index.astype(str).is_unique:
        raise ValidationError("Prepared case IDs must be unique and non-null", code="selection.case_ids")
    scope = validate_scope(body.scope.model_dump(exclude_none=True) if body.scope else None)
    selection_checksum = None
    if scope and scope.get("selection_id"):
        metadata = get_selection(c, project_id, table_id, scope["selection_id"])
        _, members = read_selection(directory, mapping, scope["selection_id"])
        if not set(members) <= set(frame.index.astype(str)):
            raise ValidationError("Saved selection IDs do not match the prepared case table", code="selection.case_ids")
        frame = frame.loc[frame.index.astype(str).isin(members)]
        selection_checksum = metadata["membershipChecksum"]
    if scope and (scope.get("flow_type") is not None or scope.get("value") is not None):
        attr = scope.get("attribute") or "flow_type"
        if attr not in frame:
            raise ValidationError("Unknown scope attribute", code="run.scope_attribute")
        frame = frame.loc[frame[attr].astype(str) == str(scope.get("flow_type", scope.get("value")))]
    if frame.empty:
        raise ValidationError("The selected scope contains no cases", code="run.scope_empty")
    result = discover_groupings(
        frame,
        list(table.attributes),
        norm.document,
        views=body.views,
        min_cases=body.minCases,
        case_id=mapping.case_id,
        focus_layer=body.focusLayer,
        focus_constraint=body.focusConstraint,
        limit=body.limit,
    )
    if before != source_identity(directory, mapping, dataset.content_hash):
        raise ConflictError(
            "Prepared source changed during discovery; refresh suggestions", code="selection.source_changed"
        )
    evidence = {
        "kind": "pre_scoring_context_support",
        "projectId": project_id,
        "datasetId": dataset.id,
        "caseTableId": table.id,
        "normVersionId": norm.id,
        "normFingerprint": norm.fingerprint,
        "effectiveNormFingerprint": result.pop("effectiveNormFingerprint"),
        "source": before,
        "selectionChecksum": selection_checksum,
        "scope": scope,
        "views": sorted(set(body.views)),
        "focusLayer": body.focusLayer,
        "focusConstraint": body.focusConstraint,
        "minCases": body.minCases,
        "cases": len(frame),
    }
    evidence["fingerprint"] = checksum(evidence)
    return {**result, "evidence": evidence}
