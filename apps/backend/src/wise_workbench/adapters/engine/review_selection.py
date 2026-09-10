"""Exact case selection for review decisions, with explicit measurement gaps."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import pandas as pd
import wise

from wise_workbench.application.ports import RunContext
from wise_workbench.domain import ConflictError, ValidationError

from . import analytics as an
from .filters import ACTIVITY_OPS, filter_masks
from .logs import censored_flags
from .tables import jsonable, table_from_frame

_FIELDS = {
    "activity": {"kind", "op", "activity"},
    "attribute": {"kind", "field", "in", "eq", "min", "max"},
    "time": {"kind", "field", "from", "to"},
    "follows": {"kind", "a", "b", "directly"},
    "lag": {"kind", "a", "b", "unit", "min", "max"},
    "count": {"kind", "activity", "min", "max"},
    "open": {"kind", "value"},
}


def _unsupported() -> None:
    raise ValidationError(
        "This filter cannot yet be assessed exactly. Keep it as a proposal or choose a supported selection.",
        code="review.filter_unsupported",
    )


def validate_filter(filter_obj: dict[str, Any]) -> None:
    """Only admit clauses whose complete semantics the shared filter engine evaluates.

    Unknown fields must not become ignored qualifiers (for example `never` on follows,
    `directly` on lag, or an active-period filter treated as case end).
    """
    for clause in filter_obj["and"]:
        kind = clause["kind"]
        if kind not in _FIELDS or set(clause) - _FIELDS[kind]:
            _unsupported()
        if kind == "time":
            if clause.get("field", "case_start") not in (
                "case_start",
                "case_end",
                "first_ts",
                "last_ts",
                "start",
                "end",
            ):
                _unsupported()
            if not any(clause.get(k) for k in ("from", "to")):
                _unsupported()
        if kind == "activity" and clause.get("op", "contains") not in ACTIVITY_OPS:
            _unsupported()
        for name in ("activity", "a", "b"):
            if name in _FIELDS[kind]:
                labels = clause.get(name)
                if not (isinstance(labels, str) and labels) and not (
                    isinstance(labels, list) and labels and all(isinstance(v, str) and v for v in labels)
                ):
                    _unsupported()
        if kind == "attribute":
            if not isinstance(clause.get("field"), str) or not clause["field"]:
                _unsupported()
            forms = sum(("in" in clause, "eq" in clause, "min" in clause or "max" in clause))
            if forms != 1:
                _unsupported()
            if "in" in clause and not (
                isinstance(clause["in"], list)
                and clause["in"]
                and all(isinstance(v, str | int | float | bool) for v in clause["in"])
            ):
                _unsupported()
            if "eq" in clause and not isinstance(clause["eq"], str | int | float | bool):
                _unsupported()
        if kind in {"count", "lag"} and not any(clause.get(k) is not None for k in ("min", "max")):
            _unsupported()
        for bound in ("min", "max"):
            if bound in clause and clause[bound] is not None:
                value = clause[bound]
                if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
                    _unsupported()
                if kind == "count" and (value < 0 or int(value) != value):
                    _unsupported()
        if clause.get("min") is not None and clause.get("max") is not None and clause["min"] > clause["max"]:
            _unsupported()
        if kind == "lag" and clause.get("unit", "D") not in ("D", "H", "M", "S"):
            _unsupported()
        for boolean in ("directly", "value"):
            if boolean in clause and not isinstance(clause[boolean], bool):
                _unsupported()


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
