"""Saved action context and the boundary between a proposal and a commitment."""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import ConflictError, NotFoundError, ValidationError

if TYPE_CHECKING:
    from wise_workbench.container import Container

FILTERED_CHECKS = ("censoring", "replication", "duplicates", "sentinel_dates", "window_edge")
COMMITTED_STATUSES = frozenset({"agreed", "in_progress", "done"})
SERVER_FIELDS = frozenset(
    {"id", "projectId", "kind", "createdAt", "updatedAt", "evidenceContext", "evidenceState", "commitmentCheck"}
)
SCOPE_FIELDS = frozenset(
    {
        "runId",
        "run_id",
        "slicing",
        "sliceKey",
        "key",
        "view",
        "filter",
        "normVersionId",
        "caseTableId",
        "comparator",
        "scope",
        "within",
        "drillFrom",
        "drillKey",
        "bands",
    }
)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def protected_fields(body: dict[str, Any], *, update: bool = False) -> None:
    fields = set(body) & (
        SERVER_FIELDS | (SCOPE_FIELDS if update else SCOPE_FIELDS - {"runId", "slicing", "sliceKey", "view", "filter"})
    )
    if fields:
        raise ValidationError(
            "Saved evidence and record identity cannot be replaced. Open the intended group and save a new proposal.",
            code="review.immutable_context",
            errors=[{"field": n, "message": "Read only"} for n in sorted(fields)],
        )


def run_identity(c: Container, project_id: str, run_id: str) -> tuple[Any, Any, str]:
    run, ctx = c.runs.ready(project_id, run_id)
    manifest = run.manifest
    norm = c.repos.get_norm_version(run.params.norm_version_id)
    if manifest is None or not manifest.norm_fingerprint or norm.fingerprint != manifest.norm_fingerprint:
        raise ConflictError(
            "The saved run no longer matches its norm. Run the assessment again and save a new proposal.",
            code="review.stale_evidence",
        )
    if manifest.params_hash != run.params_hash:
        raise ConflictError(
            "The run parameters no longer match the scored result. Run the assessment again.",
            code="review.stale_evidence",
        )
    return run, ctx, fingerprint(manifest.to_dict())


def canonical_filter(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    try:
        obj = json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError) as exc:
        raise ValidationError(
            "The saved filter is not valid JSON. Reopen the intended selection.", code="filter.json"
        ) from exc
    if not isinstance(obj, dict):
        raise ValidationError("The saved filter must be a case-filter object.", code="filter.shape")
    clauses = obj.get("and", [obj] if obj else [])
    if not isinstance(clauses, list) or ("and" in obj and set(obj) != {"and"}):
        raise ValidationError("The saved filter needs a list of clauses.", code="filter.shape")
    kinds = {"time", "attribute", "activity", "follows", "lag", "count", "open", "constraint", "slice", "any"}

    def validate(clause: Any, depth: int = 0) -> None:
        if (
            depth > 8
            or not isinstance(clause, dict)
            or not isinstance(clause.get("kind"), str)
            or clause["kind"] not in kinds
        ):
            raise ValidationError(
                "This filter contains an unsupported clause. Reopen the intended selection.", code="filter.clause"
            )
        if clause["kind"] == "any":
            nested = clause.get("clauses")
            if not isinstance(nested, list) or not nested:
                raise ValidationError("A choice filter needs its clauses.", code="filter.clause")
            for child in nested:
                validate(child, depth + 1)

    for clause in clauses:
        validate(clause)
    if not clauses:
        return None
    # Canonical provenance does not claim every UI clause is supported by the engine.
    try:
        unique = {json.dumps(c, sort_keys=True, separators=(",", ":"), allow_nan=False): c for c in clauses}
    except (TypeError, ValueError) as exc:
        raise ValidationError("The saved filter must contain finite JSON values.", code="filter.shape") from exc
    return {"and": [unique[k] for k in sorted(unique)]}


def capture(
    c: Container,
    project_id: str,
    run_id: str | None,
    slicing: str | None,
    slice_key: str | None,
    view: str | None,
    filter_value: Any,
) -> dict[str, Any] | None:
    filter_obj = canonical_filter(filter_value)
    if not any((run_id, slicing, slice_key, view, filter_obj)):
        return None
    if not all((run_id, slicing, slice_key)):
        raise ConflictError(
            "Choose a run and group before saving this scoped proposal, or clear its scope to record an unassessed proposal.",
            code="review.context_required",
        )
    assert run_id and slicing and slice_key
    try:
        run, ctx, identity = run_identity(c, project_id, run_id)
        selected_view = view or (ctx.views[0] if ctx.views else None)
        if not selected_view or selected_view not in ctx.views:
            raise ValidationError("Choose a perspective assessed by this run.", code="review.view")
        detail = c.runs.slice_detail(
            project_id, run_id, slicing=slicing, slice_key=slice_key, view=selected_view, drilldown=None
        )
    except (NotFoundError, ValidationError) as exc:
        raise ConflictError(
            "The saved run, group or perspective is unavailable. Open a valid assessed group and save a new proposal.",
            code="review.evidence_unavailable",
        ) from exc
    selection: dict[str, Any] = {}
    if filter_obj:
        try:
            detail = c.runs.review_selection(
                project_id,
                run_id,
                slicing=slicing,
                slice_key=slice_key,
                view=selected_view,
                filter_obj=filter_obj,
            )
            selection = {
                "selectionState": "measured",
                "selectionFingerprint": detail["selection"]["fingerprint"],
                "selectionReason": None,
            }
        except (ValidationError, ConflictError) as exc:
            if isinstance(exc, ConflictError) and exc.code != "review.empty_selection":
                raise
            selection = {"selectionState": "unavailable", "selectionFingerprint": None, "selectionReason": str(exc)}
    manifest = run.manifest
    assert manifest is not None
    return {
        "version": 1,
        "runId": run_id,
        "normVersionId": run.params.norm_version_id,
        "normFingerprint": manifest.norm_fingerprint,
        "caseTableId": run.params.case_table_id,
        "contentHash": manifest.content_hash,
        "paramsHash": manifest.params_hash,
        "manifestFingerprint": identity,
        "view": selected_view,
        "slicing": ctx.slicing_id(detail["params"]["slicing"], detail["params"].get("bands"))
        or ",".join(detail["params"]["slicing"]),
        "sliceKey": json.dumps(detail["params"]["key"], separators=(",", ":")),
        "filter": filter_obj,
        "flowScope": ctx.scope,
        "scenario": run.params.scenario or ("What-if scenario" if run.params.transforms else None),
        "comparator": {"kind": "run_population", "view": selected_view},
        "populationCases": None if selection.get("selectionState") == "unavailable" else detail["row"].get("n_cases"),
        **selection,
    }


def require_current(c: Container, project_id: str, saved: dict[str, Any] | None) -> None:
    if not saved:
        raise ConflictError(
            "This proposal has no saved evidence context. Open the intended assessed group and save a new proposal before agreeing or starting work.",
            code="review.context_required",
        )
    if saved.get("filter") and saved.get("selectionState") != "measured":
        raise ConflictError(
            "This proposal has no measured filtered selection. Open a supported selection and save a new proposal before committing.",
            code="review.filtered_evidence_unavailable",
        )
    if saved.get("scenario"):
        raise ConflictError(
            "This proposal comes from a what-if scenario. Save evidence from an observed run before committing to an intervention.",
            code="review.scenario_evidence",
        )
    try:
        run, ctx, _identity = run_identity(c, project_id, saved["runId"])
    except (NotFoundError, ValidationError, ConflictError, OSError) as exc:
        raise ConflictError(
            "The proposal's saved evidence is unavailable or has changed. Open a valid assessed group and save a new proposal.",
            code="review.evidence_unavailable",
        ) from exc
    manifest = run.manifest
    assert manifest is not None
    if not manifest.artefacts:
        raise ConflictError(
            "The run has no recorded result artefacts. Run the assessment again before committing.",
            code="review.evidence_unavailable",
        )
    for name, metadata in manifest.artefacts.items():
        path = (ctx.run_dir / name).resolve()
        if not path.is_relative_to(ctx.run_dir.resolve()) or not path.is_file() or not metadata.get("sha256"):
            raise ConflictError(
                "A saved result file is unavailable. Restore or rerun the assessment before committing.",
                code="review.evidence_unavailable",
            )
        try:
            with path.open("rb") as stream:
                actual = hashlib.file_digest(stream, "sha256").hexdigest()
        except OSError as exc:
            raise ConflictError(
                "A saved result file cannot be read. Retry after restoring the assessment.",
                code="review.evidence_unavailable",
            ) from exc
        if actual != metadata["sha256"]:
            raise ConflictError(
                "A saved result file has changed. Run the assessment again and review a new proposal.",
                code="review.stale_evidence",
            )
    try:
        current = capture(
            c,
            project_id,
            saved.get("runId"),
            saved.get("slicing"),
            saved.get("sliceKey"),
            saved.get("view"),
            saved.get("filter"),
        )
    except (NotFoundError, ValidationError, ConflictError, OSError) as exc:
        raise ConflictError(
            "The proposal's saved evidence is unavailable or has changed. Open a valid assessed group and save a new proposal.",
            code="review.evidence_unavailable",
        ) from exc
    if current != saved:
        raise ConflictError(
            "The proposal's evidence has changed since it was saved. Review the current assessment and save a new proposal.",
            code="review.stale_evidence",
        )
