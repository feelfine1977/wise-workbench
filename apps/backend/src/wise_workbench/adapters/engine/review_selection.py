"""Exact case selection for review decisions, with explicit measurement gaps."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import pandas as pd
import wise

from wise_workbench.application.ports import RunContext
from wise_workbench.domain import ConflictError, ValidationError

from . import analytics as an
from .filters import filter_masks
from .filters import validate_filter as validate_selection_filter
from .logs import censored_flags
from .tables import jsonable, table_from_frame


def validate_filter(filter_obj: dict[str, Any]) -> None:
    """Use the shared selection validator while preserving the review error contract."""
    try:
        validate_selection_filter(filter_obj)
    except ValidationError as exc:
        raise ValidationError(
            "This filter cannot yet be assessed exactly. Keep it as a proposal or choose a supported selection.",
            code="review.filter_unsupported",
        ) from exc


def assess(
    result: wise.ScoreResult,
    log: wise.EventLog,
    ctx: RunContext,
    attributes: list[str],
    key: list[Any],
    view: str,
    *,
    bands: list[dict[str, Any]],
    group: pd.Series,
    filter_obj: dict[str, Any],
    window_end: str | None,
) -> dict[str, Any]:
    validate_filter(filter_obj)
    censored = censored_flags(log, ctx.mapping, window_end=window_end)
    try:
        mask, _ = filter_masks(log, filter_obj, censored=censored)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValidationError(
            "The filter values cannot be evaluated. Check its dates and bounds.", code="filter.clause"
        ) from exc
    mask = mask.reindex(result.cases.index, fill_value=False) & group
    n = int(mask.sum())
    if not n:
        raise ConflictError(
            "No items in this group match the filter. Change the selection before assessing it.",
            code="review.empty_selection",
        )
    drivers = wise.constraint_drivers(result, view, where=mask).copy()
    baseline = wise.constraint_drivers(result, view)
    drivers["delta_gap"] = drivers["mean_penalty"] - baseline["mean_penalty"].reindex(drivers.index)
    drivers = drivers.sort_values("delta_gap", ascending=False, kind="mergesort")
    gate = an.gate_report(
        log, ctx.mapping, norm=result.norm, items=ctx.case_noun, closure_label=ctx.closure_label, window_end=window_end
    )
    caveats: list[dict[str, Any]] = []
    report: dict[str, Any] = {"status": "unknown", "checks": [], "failed": [], "warned": [], "logWideFailed": []}
    if gate is not None:
        from wise_analytics import quality

        selected = mask.reindex(gate.case_flags.index, fill_value=False)
        for kind, column, _warn, _fail in quality.CAVEAT_KINDS:
            # An inferred/default false flag cannot supply a missing closure definition.
            if kind == "censoring" and censored is None:
                continue
            if column not in gate.case_flags or gate.case_flags.loc[selected, column].isna().any():
                continue
            share = float(gate.case_flags.loc[selected, column].mean())
            caveats.extend(
                an.caveat_texts(
                    {kind: share},
                    items=ctx.case_noun,
                    window_end=gate.window_end,
                    closure_label=ctx.closure_label,
                    min_share=-1.0,
                )
            )
        for caveat in caveats:
            if caveat["share"] == 0.0:
                # Some warning thresholds are zero to detect any occurrence.
                caveat["status"] = "pass"
        checks = [
            {
                "check": str(name),
                "status": str(row["status"]),
                "perGroup": an.GROUP_SCOPED_CHECKS.get(str(name)),
                "metric": row["metric"],
                "value": jsonable(row["value"]),
                "warnAt": jsonable(row["threshold_warn"]),
                "failAt": jsonable(row["threshold_fail"]),
                "evidence": str(row["evidence"]),
            }
            for name, row in gate.table.iterrows()
        ]
        report = {
            "status": gate.status,
            "checks": checks,
            "failed": [x["check"] for x in checks if x["status"] == "fail"],
            "warned": [x["check"] for x in checks if x["status"] == "warn"],
            "logWideFailed": [x["check"] for x in checks if x["status"] == "fail" and not x["perGroup"]],
        }
    # Membership is not approval. The immutable run identity is recorded separately.
    ids = sorted(str(v) for v in result.cases.index[mask])
    fingerprint = hashlib.sha256(
        json.dumps({"cases": ids, "filter": filter_obj}, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "row": {"n_cases": n},
        "drivers": table_from_frame(drivers),
        "caveats": caveats,
        "analytics": {"available": gate is not None},
        "readiness": report,
        "selection": {"state": "measured", "cases": n, "wholeGroupCases": int(group.sum()), "fingerprint": fingerprint},
        "params": {
            "view": view,
            "slicing": attributes,
            "key": key,
            "bands": bands,
            "case_noun": ctx.case_noun,
            "filter": filter_obj,
        },
    }
