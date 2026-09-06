"""The canonical ``filter`` parameter (CONTRACT_CYCLE2.md, RF-01): clauses over the case table → a case mask.

Clauses are evaluated with the library's log primitives (``count``,
``first_after``, ``first_ts``) on the run's log, never through
applicability: a filter restricts which cases a screen shows, the norm's
applicability still decides which expectations apply to a case.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.constraints import in_units

from wise_workbench.domain import ValidationError

KINDS = ("time", "attribute", "activity", "follows", "lag", "count", "open")
ACTIVITY_OPS = ("contains", "starts_with", "ends_with", "never")


def parse_filter(text: str | None) -> dict[str, Any] | None:
    """The filter object from its URL form (a JSON object, ``{"and": [...]}`` or a single clause)."""
    if not text:
        return None
    try:
        obj = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"filter is not valid JSON: {exc}", code="filter.json") from exc
    if not isinstance(obj, dict):
        raise ValidationError("filter must be a JSON object", code="filter.shape")
    if "and" not in obj:
        obj = {"and": [obj]} if obj else {"and": []}
    clauses = obj.get("and")
    if not isinstance(clauses, list):
        raise ValidationError("filter.and must be a list of clauses", code="filter.shape")
    for i, c in enumerate(clauses):
        if not isinstance(c, dict) or c.get("kind") not in KINDS:
            raise ValidationError(f"clause {i}: kind must be one of {KINDS}", code="filter.clause")
    return {"and": [dict(c) for c in clauses]}


def _labels(value: Any) -> list[str]:
    if value is None:
        return []
    return [str(v) for v in value] if isinstance(value, list | tuple) else [str(value)]


def _first_last_activity(log: wise.EventLog) -> tuple[pd.Series, pd.Series]:
    ev = log.events
    g = ev.groupby(log.case_col, sort=False, observed=True)[log.activity_col]
    return g.first().reindex(log.case_ids), g.last().reindex(log.case_ids)


def _directly_follows(log: wise.EventLog, a: list[str], b: list[str]) -> pd.Series:
    ev = log.events
    act = ev[log.activity_col].astype(str)
    case = ev[log.case_col]
    nxt_act = act.shift(-1)
    same = case.shift(-1) == case
    hit = same & act.isin(a) & nxt_act.isin(b)
    cases = case[hit].unique()
    return pd.Series(log.case_ids.isin(cases), index=log.case_ids)


def clause_mask(log: wise.EventLog, clause: dict[str, Any], *, censored: pd.Series | None) -> pd.Series:
    """Boolean per case for one clause."""
    kind = clause.get("kind")
    cases = log.cases
    idx = log.case_ids
    if kind == "time":
        field = str(clause.get("field") or "case_start")
        col = cases["first_ts"] if field in ("case_start", "first_ts", "start") else cases["last_ts"]
        mask = pd.Series(True, index=idx)
        if clause.get("from"):
            mask &= col >= log._to_ts(clause["from"])
        if clause.get("to"):
            mask &= col <= log._to_ts(clause["to"])
        return mask.fillna(False)
    if kind == "attribute":
        field = str(clause.get("field") or "")
        if field not in cases.columns:
            raise ValidationError(f"filter attribute {field!r} is not a case attribute", code="filter.attribute")
        col = cases[field]
        if "in" in clause:
            wanted = [str(v) for v in clause["in"]]
            mask = col.astype(str).isin(wanted)
            if any(v in ("(missing)", "") for v in wanted):
                mask |= col.isna()
            return mask
        if "eq" in clause:
            return col.astype(str) == str(clause["eq"])
        if "min" in clause or "max" in clause:
            num = pd.to_numeric(col, errors="coerce")
            mask = pd.Series(True, index=idx)
            if clause.get("min") is not None:
                mask &= num >= float(clause["min"])
            if clause.get("max") is not None:
                mask &= num <= float(clause["max"])
            return mask.fillna(False)
        raise ValidationError("an attribute clause needs in, eq, min or max", code="filter.clause")
    if kind == "activity":
        op = str(clause.get("op") or "contains")
        labels = _labels(clause.get("activity"))
        if op not in ACTIVITY_OPS or not labels:
            raise ValidationError(f"activity clause needs op in {ACTIVITY_OPS} and an activity", code="filter.clause")
        if op in ("contains", "never"):
            has = log.count(labels) > 0
            return has if op == "contains" else ~has
        first, last = _first_last_activity(log)
        col = first if op == "starts_with" else last
        return col.astype(str).isin(labels).reindex(idx, fill_value=False)
    if kind == "follows":
        a, b = _labels(clause.get("a")), _labels(clause.get("b"))
        if not a or not b:
            raise ValidationError("a follows clause needs a and b", code="filter.clause")
        if clause.get("directly"):
            return _directly_follows(log, a, b)
        t_a, t_b = log.first_after(a, b)
        return pd.Series(pd.notna(t_b).to_numpy(), index=idx)
    if kind == "lag":
        a, b = _labels(clause.get("a")), _labels(clause.get("b"))
        if not a or not b:
            raise ValidationError("a lag clause needs a and b", code="filter.clause")
        t_a, t_b = log.first_after(a, b)
        lag = in_units(t_b - t_a, str(clause.get("unit") or "D"))
        mask = pd.Series(pd.notna(lag).to_numpy(), index=idx)
        vals = pd.Series(np.asarray(lag, dtype=float), index=idx)
        if clause.get("min") is not None:
            mask &= vals >= float(clause["min"])
        if clause.get("max") is not None:
            mask &= vals <= float(clause["max"])
        return mask.fillna(False)
    if kind == "count":
        labels = _labels(clause.get("activity"))
        if not labels:
            raise ValidationError("a count clause needs an activity", code="filter.clause")
        n = log.count(labels)
        mask = pd.Series(True, index=idx)
        if clause.get("min") is not None:
            mask &= n >= int(clause["min"])
        if clause.get("max") is not None:
            mask &= n <= int(clause["max"])
        return mask
    if kind == "open":
        want = bool(clause.get("value", True))
        if censored is None:
            raise ValidationError(
                "an open clause needs closure activities in the mapping (open = still open at the window end)",
                code="filter.open",
            )
        c = censored.reindex(idx, fill_value=False).astype(bool)
        return c if want else ~c
    raise ValidationError(f"unknown clause kind {kind!r}", code="filter.clause")


def filter_masks(
    log: wise.EventLog, filter_obj: dict[str, Any] | None, *, censored: pd.Series | None
) -> tuple[pd.Series, list[pd.Series]]:
    """The combined mask and the per-clause masks."""
    idx = log.case_ids
    if not filter_obj:
        return pd.Series(True, index=idx), []
    parts = [
        clause_mask(log, c, censored=censored).reindex(idx, fill_value=False).astype(bool) for c in filter_obj["and"]
    ]
    mask = pd.Series(True, index=idx)
    for p in parts:
        mask &= p
    return mask, parts


def filter_preview(
    log: wise.EventLog,
    filter_obj: dict[str, Any] | None,
    *,
    censored: pd.Series | None,
    in_scope: pd.DataFrame | None,
) -> dict[str, Any]:
    """``cases_in``, ``cases_out``, what each clause removes on its own margin, and cases in scope per expectation."""
    mask, parts = filter_masks(log, filter_obj, censored=censored)
    per_clause = []
    for i, p in enumerate(parts):
        others = pd.Series(True, index=log.case_ids)
        for j, q in enumerate(parts):
            if j != i:
                others &= q
        per_clause.append({"clause": i, "removed_marginally": int((others & ~p).sum()), "kept_alone": int(p.sum())})
    scope: dict[str, int] = {}
    if in_scope is not None:
        m = mask.reindex(in_scope.index, fill_value=False).to_numpy()
        scope = {str(c): int(in_scope[c].to_numpy(dtype=bool)[m].sum()) for c in in_scope.columns}
    return {
        "cases_in": int(mask.sum()),
        "cases_out": int((~mask).sum()),
        "per_clause": per_clause,
        "in_scope_by_constraint": scope,
        "filter": filter_obj,
    }
