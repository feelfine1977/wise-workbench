"""The what-if transform layer: what a scenario changes before it is scored again (R3-27, R1-11).

A what-if scenario answers *what would the backlog look like if …*. Two things can be changed, and both are
recorded so that the answer can be read back:

**The log.** Five transforms, each written in the canonical filter grammar where it needs to select cases:

``cap_lag``
    ``{"kind": "cap_lag", "a": "Create Order Item", "b": "Goods issue", "max": 14, "unit": "D"}`` — where the
    first ``b`` at or after the first ``a`` is later than ``max``, move it to ``t_a + max``. With
    ``"shiftFollowing": true`` every later event of the case moves by the same amount, so the order of events
    is kept; without it only the responding event moves.
``delete_activity``
    ``{"kind": "delete_activity", "activity": ["Changed RejectionReason"]}`` — remove those events.
``move_event``
    ``{"kind": "move_event", "activity": "Goods issue", "by": -2, "unit": "D", "which": "first"}`` — shift the
    events of an activity in time.
``set_attribute``
    ``{"kind": "set_attribute", "attribute": "planning_type", "value": "make_to_order", "where": {…}}`` — set a
    case attribute on the cases the filter selects (and, when the attribute is an event column, on their
    events). This is how a missing master-data join is simulated.
``keep_first``
    ``{"kind": "keep_first", "activity": "Record Goods Receipt"}`` — keep the first event of that activity per
    case and drop the repetitions.

Every transform reports what it touched: cases selected, events moved, events removed. A transform that selects
nothing says so rather than silently doing nothing.

**The norm.** ``{"constraints": [{"id": …, "delta": …, "width": …, "applicability": …}], "add": [...],
"remove": [...]}`` edits the baseline norm document into the scenario's, which becomes a real norm version with
its own fingerprint and a note, so that the scenario's score is reproducible.

Nothing here writes: a transform returns a new event frame and a record of what it did.
"""

from __future__ import annotations

import copy
from typing import Any, cast

import numpy as np
import pandas as pd
import wise

from wise_workbench.domain import ValidationError

TRANSFORM_KINDS = ("cap_lag", "delete_activity", "move_event", "set_attribute", "keep_first")
_UNITS = {"D": "D", "d": "D", "days": "D", "h": "h", "hours": "h", "min": "min", "s": "s", "W": "W"}


def _labels(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(v) for v in value]


def _unit(spec: dict[str, Any]) -> Any:
    """The time unit of a transform, as ``pd.Timedelta`` spells it."""
    unit = str(spec.get("unit") or "D")
    if unit not in _UNITS:
        raise ValidationError(f"unit must be one of {sorted(set(_UNITS))}, got {unit!r}", code="whatif.unit")
    return cast(Any, _UNITS[unit])


def _selected_cases(log: wise.EventLog, spec: dict[str, Any]) -> pd.Series:
    """The cases a transform applies to: its ``where`` filter, else every case."""
    from .filters import clause_mask, filter_masks

    where = spec.get("where")
    if not where:
        return pd.Series(True, index=log.case_ids)
    if "kind" in where:
        mask = clause_mask(log, where, censored=None)
    else:
        mask, _parts = filter_masks(log, where, censored=None)
    return mask.reindex(log.case_ids, fill_value=False).astype(bool)


def validate_transform(spec: dict[str, Any]) -> dict[str, Any]:
    """One transform checked before it is stored on a scenario run."""
    if not isinstance(spec, dict):
        raise ValidationError("a transform is a JSON object", code="whatif.transform")
    kind = str(spec.get("kind") or "")
    if kind not in TRANSFORM_KINDS:
        raise ValidationError(f"kind must be one of {list(TRANSFORM_KINDS)}", code="whatif.transform_kind")
    out = dict(spec)
    out["kind"] = kind
    if kind == "cap_lag":
        if not _labels(spec.get("a")) or not _labels(spec.get("b")):
            raise ValidationError("cap_lag needs the activities a and b", code="whatif.transform")
        if spec.get("max") is None:
            raise ValidationError("cap_lag needs max, the lag it caps at", code="whatif.transform")
        _unit(spec)
    elif kind in ("delete_activity", "keep_first"):
        if not _labels(spec.get("activity")):
            raise ValidationError(f"{kind} needs an activity", code="whatif.transform")
    elif kind == "move_event":
        if not _labels(spec.get("activity")) or spec.get("by") is None:
            raise ValidationError("move_event needs an activity and by", code="whatif.transform")
        _unit(spec)
    elif kind == "set_attribute" and not spec.get("attribute"):
        raise ValidationError("set_attribute needs an attribute", code="whatif.transform")
    return out


def apply_transforms(
    log: wise.EventLog, mapping: Any, transforms: list[dict[str, Any]]
) -> tuple[wise.EventLog, list[dict[str, Any]]]:
    """Apply the transform layer in order and return the new log with one record per transform."""
    from .logs import rebuild

    events = log.events.copy()
    current = log
    records: list[dict[str, Any]] = []
    for spec in transforms:
        spec = validate_transform(spec)
        events, record = _apply_one(current, mapping, events, spec)
        records.append(record)
        current = rebuild(log, events, mapping)
    return current, records


def _apply_one(
    log: wise.EventLog, mapping: Any, events: pd.DataFrame, spec: dict[str, Any]
) -> tuple[pd.DataFrame, dict[str, Any]]:
    kind = spec["kind"]
    case_col, act_col, ts_col = log.case_col, log.activity_col, log.timestamp_col
    selected = _selected_cases(log, spec)
    keep_cases = set(selected.index[selected.to_numpy(dtype=bool)])
    in_scope = events[case_col].isin(keep_cases) if spec.get("where") else pd.Series(True, index=events.index)
    record: dict[str, Any] = {
        "kind": kind,
        "spec": {k: v for k, v in spec.items() if k != "kind"},
        "casesSelected": len(keep_cases) if spec.get("where") else len(log.case_ids),
        "eventsMoved": 0,
        "eventsRemoved": 0,
        "casesTouched": 0,
    }
    if kind == "delete_activity":
        labels = _labels(spec.get("activity"))
        drop = in_scope & events[act_col].isin(labels)
        record["eventsRemoved"] = int(drop.sum())
        record["casesTouched"] = int(events.loc[drop, case_col].nunique())
        return events[~drop.to_numpy()].copy(), record
    if kind == "keep_first":
        labels = _labels(spec.get("activity"))
        hit = in_scope & events[act_col].isin(labels)
        ordered = events[hit.to_numpy()].sort_values([case_col, ts_col], kind="mergesort")
        repeats = ordered.index[ordered.duplicated(subset=[case_col, act_col], keep="first")]
        record["eventsRemoved"] = len(repeats)
        record["casesTouched"] = int(events.loc[repeats, case_col].nunique())
        return events.drop(index=repeats).copy(), record
    if kind == "move_event":
        labels = _labels(spec.get("activity"))
        hit = in_scope & events[act_col].isin(labels)
        if str(spec.get("which") or "all") == "first":
            ordered = events[hit.to_numpy()].sort_values([case_col, ts_col], kind="mergesort")
            first = ordered.index[~ordered.duplicated(subset=[case_col], keep="first")]
            hit = pd.Series(events.index.isin(first), index=events.index)
        delta = pd.Timedelta(float(spec["by"]), unit=_unit(spec))
        out = events.copy()
        out.loc[hit.to_numpy(), ts_col] = pd.to_datetime(out.loc[hit.to_numpy(), ts_col]) + delta
        record["eventsMoved"] = int(hit.sum())
        record["casesTouched"] = int(events.loc[hit.to_numpy(), case_col].nunique())
        return out, record
    if kind == "set_attribute":
        attribute, value = str(spec["attribute"]), spec.get("value")
        out = events.copy()
        if attribute not in out.columns:
            out[attribute] = pd.Series([None] * len(out), index=out.index, dtype=object)
        out.loc[in_scope.to_numpy(), attribute] = value
        record["eventsMoved"] = int(in_scope.sum())
        record["casesTouched"] = int(out.loc[in_scope.to_numpy(), case_col].nunique())
        record["attributeAdded"] = attribute not in events.columns
        return out, record
    return _cap_lag(log, events, spec, record)


def _cap_lag(
    log: wise.EventLog, events: pd.DataFrame, spec: dict[str, Any], record: dict[str, Any]
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Move the responding event of every case whose lag exceeds the cap, so that the lag becomes the cap."""
    case_col, act_col, ts_col = log.case_col, log.activity_col, log.timestamp_col
    a, b = _labels(spec["a"]), _labels(spec["b"])
    unit, cap = _unit(spec), float(spec["max"])
    t_a, t_b = log.first_after(a, b)
    start = pd.Series(pd.to_datetime(np.asarray(t_a)), index=log.case_ids)
    respond = pd.Series(pd.to_datetime(np.asarray(t_b)), index=log.case_ids)
    limit = start + pd.Timedelta(cap, unit=unit)
    over = respond.notna() & start.notna() & (respond > limit)
    if spec.get("where"):
        over &= _selected_cases(log, spec)
    cases = set(over.index[over.to_numpy(dtype=bool)])
    if not cases:
        return events, record
    shift_following = bool(spec.get("shiftFollowing"))
    out = events.copy()
    out[ts_col] = pd.to_datetime(out[ts_col])
    case_series = out[case_col]
    target = case_series.map(limit)
    old = case_series.map(respond)
    hit = case_series.isin(cases)
    is_b = hit & out[act_col].isin(b) & (out[ts_col] == old)
    moved = int(is_b.sum())
    out.loc[is_b.to_numpy(), ts_col] = target[is_b.to_numpy()]
    if shift_following:
        later = hit & (out[ts_col] > old) & ~is_b
        out.loc[later.to_numpy(), ts_col] = out.loc[later.to_numpy(), ts_col] - (
            old[later.to_numpy()] - target[later.to_numpy()]
        )
        moved += int(later.sum())
    record["eventsMoved"] = moved
    record["casesTouched"] = len(cases)
    return out, record


# ---------------------------------------------------------------------------- the norm layer
def apply_norm_changes(document: dict[str, Any], changes: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The scenario's norm document, and one plain line per change so that the scenario can say what it did."""
    out = copy.deepcopy(document)
    lines: list[str] = []
    constraints = list(out.get("constraints") or [])
    by_id = {str(c.get("id")): c for c in constraints}
    for edit in changes.get("constraints") or []:
        cid = str(edit.get("id") or "")
        target = by_id.get(cid)
        if target is None:
            raise ValidationError(f"the baseline norm has no expectation {cid!r}", code="whatif.constraint")
        for field, value in edit.items():
            if field in ("id", "note"):
                continue
            if field == "applicability":
                before = target.get("applicability")
                target["applicability"] = value
                lines.append(f"{cid}: applicability {before!r} → {value!r}")
                continue
            if field in ("weight", "description", "layer", "type"):
                before = target.get(field)
                target[field] = value
            else:
                params = target.setdefault("params", {})
                before = params.get(field)
                params[field] = value
            lines.append(f"{cid}: {field} {before} → {value}")
    for added in changes.get("add") or []:
        cid = str(added.get("id") or "")
        if not cid:
            raise ValidationError("an added expectation needs an id", code="whatif.constraint")
        if cid in by_id:
            raise ValidationError(f"the baseline norm already has {cid!r}", code="whatif.constraint")
        constraints.append(dict(added))
        by_id[cid] = constraints[-1]
        lines.append(f"{cid}: added")
    removed = {str(r) for r in changes.get("remove") or []}
    if removed:
        missing = sorted(removed - set(by_id))
        if missing:
            raise ValidationError(f"the baseline norm has no expectation {missing}", code="whatif.constraint")
        constraints = [c for c in constraints if str(c.get("id")) not in removed]
        lines.extend(f"{cid}: removed" for cid in sorted(removed))
    out["constraints"] = constraints
    if not lines:
        raise ValidationError("the norm changes of a scenario change nothing", code="whatif.norm_changes")
    return out, lines


__all__ = [
    "TRANSFORM_KINDS",
    "apply_norm_changes",
    "apply_transforms",
    "validate_transform",
]
