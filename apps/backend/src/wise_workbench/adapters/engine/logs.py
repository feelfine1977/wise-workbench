"""Building library event logs from stored events, flow typing, decisions on data caveats, and the readiness report.

One window end (R1-02)
----------------------
Every censoring number the backend prints is computed against one window
end: the end the analytics gate resolves (the library's robust observation
window, ``EventLog.observation_window``, unless that end is itself a far-out
placeholder date), or the same robust end when the analytics package is not
installed. The value is stored in the case table's readiness report
(``windowEnd``), reused by the validation table and the analytics job, and
printed in every caveat sentence.
"""

from __future__ import annotations

import warnings
from typing import Any, cast

import numpy as np
import pandas as pd
import wise

from wise_workbench.domain import (
    DECISION_KINDS,
    FLOW_TYPE_ATTRIBUTE,
    ColumnMapping,
    DecisionPreview,
    Readiness,
    ReadinessItem,
    ReadinessLevel,
    ValidationError,
)

from .tables import jsonable

# readiness item → the decision a reader can take on it (R2-O1)
DECISION_FOR_ITEM: dict[str, str] = {spec["item"]: kind for kind, spec in DECISION_KINDS.items()}
DECISION_FOR_ITEM["event_replication"] = "header_events"
EVENT_LEVEL_DECISIONS = ("drop_outside_window", "sentinel_as_missing")
CASE_LEVEL_DECISIONS = ("open_cases", "zero_exposure")

SENTINEL_DATES = (
    "1900-01-01",
    "1900-12-31",
    "1970-01-01",
    "1999-12-31",
    "2099-12-31",
    "9999-12-31",
)


def _library_error(exc: Exception, code: str) -> ValidationError:
    return ValidationError(str(exc), code=code)


def build_log(df: pd.DataFrame, mapping: ColumnMapping, *, typed: bool = False) -> wise.EventLog:
    """``wise.EventLog`` from raw (``typed=False``) or already typed events.

    Typed events (the case table's ``events.parquet``) are already filtered by
    lifecycle, deduplicated, sorted, and carry the flow type as a column.
    """
    mapping.check_columns(list(df.columns))
    attrs = mapping.all_case_attributes if typed else list(mapping.case_attributes)
    attrs = [a for a in attrs if a in df.columns]
    if not typed:
        df = _prepare_raw(df, mapping, attrs)
    kwargs: dict[str, Any] = {
        "case_col": mapping.case_id,
        "activity_col": mapping.activity,
        "timestamp_col": mapping.timestamp,
        "case_attributes": attrs,
        "exposure_col": mapping.exposure,
        "exposure_agg": mapping.exposure_agg,
        "order_col": mapping.order,
        "event_id_col": mapping.event_id,
        "utc": mapping.utc,
        "timestamp_format": mapping.timestamp_format if not typed else None,
        "dayfirst": mapping.dayfirst,
        "missing_timestamps": "keep",
    }
    if not typed:
        kwargs["lifecycle_col"] = mapping.lifecycle
        kwargs["keep_transitions"] = mapping.keep_transitions
        kwargs["dedupe"] = mapping.dedupe
    try:
        log = wise.EventLog(df, **kwargs)
    except wise.LogSchemaError as exc:
        raise _library_error(exc, "mapping.invalid") from exc
    except ValueError as exc:
        raise _library_error(exc, "mapping.invalid") from exc
    if not typed:
        log = apply_event_decisions(log, mapping)
    if mapping.open_cases == "censor" and log.window is None:
        # open lags are censored at the window end (Lag(missing_b="censor") reads the log's window)
        start, end = log.observation_window()
        if pd.notna(start) and pd.notna(end):
            log.window = (start, end)
    return log


def rebuild(log: wise.EventLog, events: pd.DataFrame, mapping: ColumnMapping) -> wise.EventLog:
    """A new log from a subset (or an edited copy) of ``log.events``; typed columns, no re-parsing."""
    attrs = [a for a in mapping.all_case_attributes if a in events.columns]
    kwargs: dict[str, Any] = {
        "case_col": mapping.case_id,
        "activity_col": mapping.activity,
        "timestamp_col": mapping.timestamp,
        "case_attributes": attrs,
        "exposure_col": mapping.exposure if mapping.exposure in events.columns else None,
        "exposure_agg": mapping.exposure_agg,
        "order_col": mapping.order if mapping.order in events.columns else None,
        "event_id_col": mapping.event_id if mapping.event_id in events.columns else None,
        "utc": mapping.utc,
        "missing_timestamps": "keep",
    }
    try:
        out = wise.EventLog(events, **kwargs)
    except (wise.LogSchemaError, ValueError) as exc:
        raise _library_error(exc, "mapping.invalid") from exc
    if log.window is not None:
        out.window = log.window
    return out


def sublog(log: wise.EventLog, mapping: ColumnMapping, case_mask: pd.Series) -> wise.EventLog:
    """The log restricted to the cases where ``case_mask`` (indexed by case id) is true."""
    keep = case_mask.reindex(log.case_ids, fill_value=False).to_numpy(dtype=bool)
    if keep.all():
        return log
    if not keep.any():
        raise ValidationError("the scope selects no case", code="run.scope_empty")
    ev = log.events[keep[log._codes]]
    out = rebuild(log, ev, mapping)
    for attr in log.cases.columns:
        if attr in ("n_events", "first_ts", "last_ts", "exposure") or attr in out.cases.columns:
            continue
        out.add_case_attribute(attr, log.cases[attr].reindex(out.case_ids))
    return out


def scope_mask(log: wise.EventLog, scope: dict[str, Any] | None) -> pd.Series | None:
    """Boolean per case for a run scope ``{"flow_type": …}`` or ``{"attribute", "value"}``."""
    if not scope:
        return None
    attribute = str(scope.get("attribute") or FLOW_TYPE_ATTRIBUTE)
    value = scope.get("flow_type", scope.get("value"))
    if attribute not in log.cases.columns:
        raise ValidationError(
            f"scope attribute {attribute!r} is not a case attribute; known: {list(log.cases.columns)}",
            code="run.scope_attribute",
        )
    col = log.cases[attribute]
    mask = col.astype(str) == str(value)
    if not mask.any():
        raise ValidationError(
            f"no case has {attribute} = {value!r}; values: {sorted(col.dropna().astype(str).unique().tolist())[:20]}",
            code="run.scope_empty",
        )
    return mask


# ---------------------------------------------------------------------------- decisions (R2-O1)
def resolve_window_bounds(log: wise.EventLog) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Both ends of the observation window with the gate's sentinel-aware rule (else the robust window)."""
    try:
        from .analytics import gate_window_bounds
    except ImportError:  # pragma: no cover
        gate_window_bounds = None  # type: ignore[assignment]
    bounds = gate_window_bounds(log) if gate_window_bounds is not None else None
    if bounds is not None:
        return bounds
    start, end = log.observation_window()
    return pd.Timestamp(start), pd.Timestamp(end)


def _outside_window_mask(log: wise.EventLog, params: dict[str, Any]) -> np.ndarray:
    start, end = resolve_window_bounds(log)
    if params.get("start"):
        start = log._to_ts(params["start"])  # type: ignore[assignment]
    if params.get("end"):
        end = log._to_ts(params["end"])  # type: ignore[assignment]
    ts = log.events[log.timestamp_col]
    mask = pd.Series(False, index=ts.index)
    if pd.notna(start):
        mask |= ts < start
    if pd.notna(end):
        mask |= ts > end
    return mask.to_numpy(dtype=bool)


def _sentinel_mask(log: wise.EventLog, params: dict[str, Any]) -> np.ndarray:
    stamps = {log._to_ts(t) for t in params.get("timestamps") or []}
    ts = log.events[log.timestamp_col]
    mask = ts.isin(list(stamps))
    activities = params.get("activities")
    if activities:
        mask &= log.events[log.activity_col].astype(str).isin([str(a) for a in activities])
    return mask.to_numpy(dtype=bool)


def apply_event_decisions(log: wise.EventLog, mapping: ColumnMapping) -> wise.EventLog:
    """Apply the event-level decisions of the mapping (drop outside window, placeholder dates as missing)."""
    decisions = [d for d in mapping.decisions if d.get("kind") in EVENT_LEVEL_DECISIONS]
    if not decisions:
        return log
    ev = log.events.copy()
    drop = np.zeros(len(ev), dtype=bool)
    for d in decisions:
        params = dict(d.get("params") or {})
        if d["kind"] == "drop_outside_window":
            drop |= _outside_window_mask(log, params)
        elif d["kind"] == "sentinel_as_missing":
            hit = _sentinel_mask(log, params)
            ev.loc[hit, log.timestamp_col] = pd.NaT
    if drop.any():
        ev = ev[~drop]
    return rebuild(log, ev, mapping)


def censored_mask(log: wise.EventLog, mapping: ColumnMapping, window_end: Any = None) -> pd.Series | None:
    """The one censoring definition: ``wise.right_censored`` with the mapping's closure activities and the window end."""
    if not mapping.closure_activities:
        return None
    end = window_end if window_end is not None else resolve_window_end(log)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            return wise.right_censored(
                log, list(mapping.closure_activities), window=mapping.censoring_window, window_end=end
            )
    except wise.WiseError:
        return None


def apply_case_decisions(log: wise.EventLog, mapping: ColumnMapping) -> tuple[wise.EventLog, dict[str, int]]:
    """Exclude open cases and cases with exposure 0 when the mapping says so; returns the counts removed."""
    removed: dict[str, int] = {}
    drop = pd.Series(False, index=log.case_ids)
    if mapping.open_cases == "exclude":
        c = censored_mask(log, mapping)
        if c is not None:
            removed["open_cases"] = int(c.sum())
            drop |= c
    if mapping.zero_exposure == "exclude" and "exposure" in log.cases.columns:
        z = log.cases["exposure"].fillna(0.0) <= 0
        removed["zero_exposure"] = int(z.sum())
        drop |= z
    if not drop.any():
        return log, removed
    if drop.all():
        raise ValidationError("the decisions exclude every case", code="decision.empty")
    return sublog(log, mapping, ~drop), removed


def preview_decision(log: wise.EventLog, mapping: ColumnMapping, kind: str, params: dict[str, Any]) -> DecisionPreview:
    """Cases and events a decision would affect, computed on the current case table's log."""
    ev = log.events
    n_cases, n_events = len(log), len(ev)
    detail: dict[str, Any] = {}

    def by_events(mask: np.ndarray) -> tuple[int, int]:
        codes = log._codes[mask]
        return len(np.unique(codes)), int(mask.sum())

    if kind == "drop_outside_window":
        start, end = resolve_window_bounds(log)
        if params.get("start"):
            start = log._to_ts(params["start"])  # type: ignore[assignment]
        if params.get("end"):
            end = log._to_ts(params["end"])  # type: ignore[assignment]
        mask = _outside_window_mask(log, params)
        cases, events = by_events(mask)
        counts = np.bincount(log._codes[mask], minlength=n_cases)
        detail = {
            "start": jsonable(start),
            "end": jsonable(end),
            "casesDropped": int((counts == np.bincount(log._codes, minlength=n_cases)).sum()) if mask.any() else 0,
        }
    elif kind == "sentinel_as_missing":
        cases, events = by_events(_sentinel_mask(log, params))
    elif kind == "collapse_duplicates":
        dup = ev.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col]).to_numpy()
        cases, events = by_events(dup)
    elif kind in ("day_precision", "header_events"):
        acts = [str(a) for a in params.get("activities") or []]
        mask = ev[log.activity_col].astype(str).isin(acts).to_numpy()
        cases, events = by_events(mask)
        if kind == "header_events":
            detail["replicatedShare"] = _header_replication(log, acts) if acts else 0.0
    elif kind == "open_cases":
        closure = [str(a) for a in params.get("closure") or mapping.closure_activities]
        end = resolve_window_end(log)
        if not closure:
            raise ValidationError(
                "open cases need closure activities (in the mapping or the decision)", code="decision.params"
            )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            c = wise.right_censored(log, closure, window=str(params.get("window") or "60D"), window_end=end)
        cases = int(c.sum())
        events = int(log.cases.loc[c, "n_events"].sum())
        detail = {"handling": params.get("handling", "censor"), "windowEnd": jsonable(end), "closure": closure}
    elif kind == "zero_exposure":
        if "exposure" not in log.cases.columns:
            raise ValidationError("the mapping has no exposure column", code="decision.params")
        z = log.cases["exposure"].fillna(0.0) <= 0
        cases = int(z.sum())
        events = int(log.cases.loc[z, "n_events"].sum())
        detail = {"handling": params.get("handling", "exclude")}
    elif kind == "flow_type_assignment":
        from wise_workbench.domain.mapping import FlowTypingRule

        probe = ColumnMapping.from_dict(
            "probe",
            mapping.dataset_id,
            {
                **mapping.to_dict(),
                "flowTyping": [{"name": str(r["name"]), "rule": dict(r["rule"])} for r in params["rules"]],
                "flowTypeDefault": str(params.get("default") or "other"),
            },
        )
        assert all(isinstance(r, FlowTypingRule) for r in probe.flow_typing)
        new = _flow_types(log, probe)
        old = log.cases[FLOW_TYPE_ATTRIBUTE] if FLOW_TYPE_ATTRIBUTE in log.cases.columns else None
        changed = (new != old.astype(object)) if old is not None else pd.Series(True, index=new.index)
        cases = int(changed.sum())
        events = int(log.cases.loc[changed, "n_events"].sum())
        detail = {"counts": {str(k): int(v) for k, v in new.value_counts(dropna=False).items()}}
    else:
        raise ValidationError(f"unknown decision kind {kind!r}", code="decision.kind")
    return DecisionPreview(cases=cases, events=events, total_cases=n_cases, total_events=n_events, detail=detail)


def _prepare_raw(df: pd.DataFrame, mapping: ColumnMapping, attrs: list[str]) -> pd.DataFrame:
    """Exposure as non-negative numbers; null text attributes labelled so that slices keep a key."""
    out = df
    if mapping.exposure and mapping.exposure_abs and mapping.exposure in df.columns:
        out = out.copy()
        out[mapping.exposure] = pd.to_numeric(out[mapping.exposure], errors="coerce").abs()
    if mapping.missing_label:
        for attr in attrs:
            col = out[attr]
            if (col.dtype == object or pd.api.types.is_string_dtype(col)) and col.isna().any():
                if out is df:
                    out = out.copy()
                out[attr] = col.where(col.notna(), mapping.missing_label)
    return out


def apply_flow_typing(log: wise.EventLog, mapping: ColumnMapping) -> pd.Series | None:
    """Evaluate the ordered flow-typing rules with the library's applicability grammar."""
    if not mapping.flow_typing:
        return None
    flow = _flow_types(log, mapping)
    log.add_case_attribute(FLOW_TYPE_ATTRIBUTE, flow)
    return flow


def _flow_types(log: wise.EventLog, mapping: ColumnMapping) -> pd.Series:
    flow = pd.Series(mapping.flow_type_default, index=log.case_ids, dtype=object)
    assigned = pd.Series(False, index=log.case_ids)
    for rule in mapping.flow_typing:
        try:
            probe = wise.NormConstraint(
                id=f"flow_type:{rule.name}",
                layer="flow_typing",
                constraint=wise.Presence("__probe__"),
                applicability=rule.rule,
            )
            mask = probe.applies_to(log.cases, log)
        except wise.NormError as exc:
            raise ValidationError(f"flow typing rule {rule.name!r}: {exc}", code="mapping.flow_typing") from exc
        hit = mask.astype(bool) & ~assigned
        flow[hit] = rule.name
        assigned |= hit
    return flow


def flow_type_column(log: wise.EventLog, attribute: str | None) -> tuple[str, pd.Series]:
    """The attribute that splits the log into flow types: the mapping's ``flow_type`` or a named case attribute."""
    name = attribute or FLOW_TYPE_ATTRIBUTE
    if name not in log.cases.columns:
        candidates = [
            str(c)
            for c in log.cases.columns
            if c not in ("n_events", "first_ts", "last_ts", "exposure") and 1 < log.cases[c].nunique(dropna=True) <= 12
        ]
        raise ValidationError(
            f"no flow typing in the mapping and no attribute {name!r} in the case table; "
            f"name one with ?attribute= (low-cardinality attributes: {candidates})",
            code="flow_types.attribute",
        )
    return name, log.cases[name].astype(object).where(log.cases[name].notna(), "(missing)")


def apply_mapping_recipes(log: wise.EventLog, mapping: ColumnMapping) -> list[str]:
    recipes = mapping.derive_recipes()
    if not recipes:
        return []
    try:
        return log.derive(recipes, overwrite=False)
    except (wise.NormError, wise.LogSchemaError) as exc:
        raise ValidationError(f"derived attribute: {exc}", code="mapping.derived_attribute") from exc


def typed_events(log: wise.EventLog, mapping: ColumnMapping) -> pd.DataFrame:
    """The log's sorted, typed events plus the flow type broadcast per event."""
    ev = log.events.copy()
    if FLOW_TYPE_ATTRIBUTE in log.cases.columns and FLOW_TYPE_ATTRIBUTE not in ev.columns:
        codes = log._codes
        ev[FLOW_TYPE_ATTRIBUTE] = log.cases[FLOW_TYPE_ATTRIBUTE].to_numpy()[codes]
    if mapping.exposure and mapping.exposure in ev.columns:
        ev[mapping.exposure] = pd.to_numeric(ev[mapping.exposure], errors="coerce")
    return ev


def activity_inventory(log: wise.EventLog) -> list[dict[str, Any]]:
    ev = log.events
    act = ev[log.activity_col]
    per_event = act.value_counts(dropna=False)
    per_case = ev.groupby(act, dropna=False, observed=True)[log.case_col].nunique()
    out = []
    case_counts = {str(k): int(v) for k, v in per_case.items()}
    for label, n in per_event.items():
        name = "(null)" if label is None or (isinstance(label, float) and np.isnan(label)) else str(label)
        out.append({"label": name, "events": int(n), "cases": case_counts.get(str(label), 0)})
    return out


# ---------------------------------------------------------------------------- readiness
def _precision_per_activity(log: wise.EventLog) -> tuple[list[dict[str, Any]], dict[str, str]]:
    ev = log.events
    ts = ev[log.timestamp_col]
    valid = ts.notna()
    stamps = ts[valid] if getattr(ts.dt, "tz", None) is None else ts[valid].dt.tz_convert("UTC").dt.tz_localize(None)
    ns = pd.Series(stamps.to_numpy(dtype="datetime64[ns]").astype("int64"), index=stamps.index)
    ns = ns % (24 * 3600 * 10**9)
    day = ns == 0
    minute = ns % (60 * 10**9) == 0
    second = ns % 10**9 == 0
    frame = pd.DataFrame(
        {
            "activity": ev.loc[valid, log.activity_col].astype(str).to_numpy(),
            "day": day.to_numpy(),
            "minute": minute.to_numpy(),
            "second": second.to_numpy(),
        }
    )
    if frame.empty:
        return [], {}
    g = frame.groupby("activity", observed=True)
    shares = g[["day", "minute", "second"]].mean()
    counts = {str(k): int(v) for k, v in g.size().items()}
    rows: list[dict[str, Any]] = []
    labels: dict[str, str] = {}
    for activity, row in shares.iterrows():
        if row["day"] >= 0.95:
            label = "day"
        elif row["minute"] >= 0.95:
            label = "minute"
        elif row["second"] >= 0.95:
            label = "second"
        else:
            label = "sub-second"
        labels[str(activity)] = label
        rows.append(
            {
                "activity": str(activity),
                "events": counts.get(str(activity), 0),
                "precision": label,
                "dayShare": float(row["day"]),
                "minuteShare": float(row["minute"]),
                "secondShare": float(row["second"]),
            }
        )
    rows.sort(key=lambda r: -r["events"])
    return rows, labels


def _sentinel_dates(
    log: wise.EventLog, start: pd.Timestamp, end: pd.Timestamp, *, min_events: int = 5
) -> list[dict[str, Any]]:
    """Placeholder-looking stamps: one exact timestamp outside the window shared by ``min_events`` or
    more events, a known sentinel date, or the earliest / latest raw stamp when it lies outside."""
    ts = log.events[log.timestamp_col].dropna()
    if ts.empty:
        return []
    naive_all = ts.dt.tz_convert("UTC").dt.tz_localize(None) if getattr(ts.dt, "tz", None) is not None else ts
    has_window = pd.notna(start) and pd.notna(end)
    outside_mask = ((naive_all < start) | (naive_all > end)) if has_window else pd.Series(False, index=ts.index)
    counts = naive_all[outside_mask].value_counts() if has_window else naive_all.value_counts()
    known = {pd.Timestamp(d) for d in SENTINEL_DATES}
    out: list[dict[str, Any]] = []
    seen: set[pd.Timestamp] = set()
    for value, n in counts.items():
        stamp = pd.Timestamp(cast(Any, value))
        if n >= min_events or stamp.normalize() in known:
            out.append(
                {
                    "timestamp": stamp.isoformat(),
                    "events": int(n),
                    "outsideWindow": True,
                    "reason": "repeated stamp outside the window",
                }
            )
            seen.add(stamp)
        if len(out) >= 10:
            break
    for label, stamp in (
        ("earliest", pd.Timestamp(cast(Any, naive_all.min()))),
        ("latest", pd.Timestamp(cast(Any, naive_all.max()))),
    ):
        if has_window and (stamp < start or stamp > end) and stamp not in seen:
            out.append(
                {
                    "timestamp": stamp.isoformat(),
                    "events": int((naive_all == stamp).sum()),
                    "outsideWindow": True,
                    "reason": f"{label} raw timestamp",
                }
            )
    return out


def resolve_window_end(log: wise.EventLog) -> pd.Timestamp:
    """The window end of the one censoring definition (module docstring): the analytics gate's resolution when the
    package is installed, else the library's robust observation-window end."""
    try:
        from .analytics import gate_window_end
    except ImportError:  # pragma: no cover - the analytics adapter is part of the package
        gate_window_end = None  # type: ignore[assignment]
    if gate_window_end is not None:
        end = gate_window_end(log)
        if end is not None:
            return end
    return pd.Timestamp(log.observation_window()[1])


_GATE_LEVELS = {"pass": ReadinessLevel.INFO, "warn": ReadinessLevel.WARN, "fail": ReadinessLevel.FAIL}
_GATE_ONLY_CHECKS = (
    "timestamp_concentration",
    "vocabulary_drift",
    "frequency_drift",
    "logging_asymmetry",
    "exposure_sanity",
    "window_edge_share",
    "replication",
)


def readiness_report(
    log: wise.EventLog,
    mapping: ColumnMapping,
    *,
    replication_ratio_flag: float = 2.0,
    case_noun: str | None = None,
    closure_label: str = "closure",
) -> Readiness:
    """The data-readiness report: library diagnostics plus precision, sentinel dates and duplicates, merged with the
    analytics gate (same window end, same censored share, same duplicate count) and the decision each item allows."""
    items: list[ReadinessItem] = []
    noun = case_noun or mapping.noun
    try:
        from .analytics import gate_report

        gate = gate_report(log, mapping, items=noun, closure_label=closure_label)
    except ImportError:  # pragma: no cover
        gate = None
    v = log.validate()
    start, end = log.observation_window()
    robust_end = end
    end = gate.window_end if gate is not None and gate.window_end is not None else end
    end_source = str(gate.summary.get("window_end_source")) if gate is not None else "robust observation window"
    n_events, n_cases = int(v["n_events"]), int(v["n_cases"])
    items.append(
        ReadinessItem(
            "volume",
            ReadinessLevel.INFO,
            f"{n_events:,} events in {n_cases:,} cases over {int(v['n_activities'])} activities.",
            {
                "events": n_events,
                "cases": n_cases,
                "activities": int(v["n_activities"]),
                "attributes": list(log.case_attributes),
            },
        )
    )
    ts = log.events[log.timestamp_col]
    raw_min, raw_max = ts.min(), ts.max()
    items.append(
        ReadinessItem(
            "window",
            ReadinessLevel.INFO,
            f"Observation window {start} to {end}; window end {pd.Timestamp(end).date()} from the {end_source}; "
            f"raw timestamps span {raw_min} to {raw_max}.",
            {
                "start": start,
                "end": end,
                "windowEnd": end,
                "windowEndSource": end_source,
                "robustEnd": robust_end,
                "rawMin": raw_min,
                "rawMax": raw_max,
            },
        )
    )
    outliers = int(wise.timestamp_outliers(log).sum())
    if outliers:
        outside = log.events.loc[wise.timestamp_outliers(log).to_numpy(), log.timestamp_col]
        items.append(
            ReadinessItem(
                "timestamp_outliers",
                ReadinessLevel.WARN,
                f"{outliers:,} events lie outside the observation window (earliest {outside.min()}, latest {outside.max()}); "
                "lags touching them are unreliable.",
                {
                    "events": outliers,
                    "earliest": outside.min(),
                    "latest": outside.max(),
                    "share": outliers / max(n_events, 1),
                },
            )
        )
    sentinels = _sentinel_dates(log, start, end)
    if sentinels:
        items.append(
            ReadinessItem(
                "sentinel_dates",
                ReadinessLevel.WARN,
                f"{len(sentinels)} timestamp value(s) look like placeholders (identical stamp on many events or a known sentinel date); "
                f"most frequent: {sentinels[0]['timestamp']} on {sentinels[0]['events']:,} events.",
                {"values": sentinels},
            )
        )
    missing_ts = int(v["missing_timestamps"])
    if missing_ts:
        items.append(
            ReadinessItem(
                "missing_timestamps",
                ReadinessLevel.WARN if missing_ts / max(n_events, 1) < 0.05 else ReadinessLevel.FAIL,
                f"{missing_ts:,} events have no parseable timestamp; they count for presence but never define a lag.",
                {"events": missing_ts, "share": missing_ts / max(n_events, 1)},
            )
        )
    null_act = int(v["null_activity_labels"])
    if null_act:
        items.append(
            ReadinessItem(
                "null_activities",
                ReadinessLevel.WARN,
                f"{null_act:,} events have no activity label.",
                {"events": null_act},
            )
        )
    precision_rows, precision_labels = _precision_per_activity(log)
    coarse = [a for a, p in precision_labels.items() if p == "day"]
    level = ReadinessLevel.WARN if coarse and len(coarse) < len(precision_labels) else ReadinessLevel.INFO
    summary = (
        ", ".join(f"{p}: {n}" for p, n in pd.Series(list(precision_labels.values())).value_counts().items())
        if precision_labels
        else "n/a"
    )
    items.append(
        ReadinessItem(
            "timestamp_precision",
            level,
            f"Timestamp precision per activity ({summary})."
            + (
                f" Day-level activities: {', '.join(coarse[:5])}{'…' if len(coarse) > 5 else ''}; sub-day lags on them are not meaningful."
                if coarse
                else ""
            ),
            {"activities": precision_rows},
        )
    )
    dup = int(log.events.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col]).sum())
    if gate is not None and "duplicate_events" in gate.table.index:
        # the gate counts the same key (case, activity, timestamp); its evidence is printed next to the count
        gate_dup = gate.evidence.get("duplicate_events")
        if gate_dup is not None and "n" in getattr(gate_dup, "columns", []):
            dup = int(gate_dup["n"].sum()) if len(gate_dup) else dup
    if dup:
        items.append(
            ReadinessItem(
                "duplicate_events",
                ReadinessLevel.WARN,
                f"{dup:,} events are exact duplicates (same case, activity and timestamp); counts and singularity constraints are inflated.",
                {"events": dup, "share": dup / max(n_events, 1)},
            )
        )
    tied_share = float(v["tied_events_share"])
    if tied_share > 0:
        items.append(
            ReadinessItem(
                "tied_timestamps",
                ReadinessLevel.INFO if tied_share < 0.2 else ReadinessLevel.WARN,
                f"{tied_share:.1%} of events share their timestamp with another event of the same case; order between them is undefined.",
                {"share": tied_share, "casesShare": float(v["cases_with_ties_share"])},
            )
        )
    for key in v.index:
        if str(key).startswith("varying_within_case["):
            attr = str(key)[len("varying_within_case[") : -1]
            items.append(
                ReadinessItem(
                    f"varying_attribute:{attr}",
                    ReadinessLevel.WARN,
                    f"Case attribute {attr!r} varies within {int(v[key]):,} cases; the first value per case is used.",
                    {"attribute": attr, "cases": int(v[key])},
                )
            )
    if "zero_exposure_cases" in v.index:
        zero = int(v["zero_exposure_cases"])
        if zero:
            items.append(
                ReadinessItem(
                    "zero_exposure",
                    ReadinessLevel.INFO,
                    f"{zero:,} cases have exposure 0; exposure-weighted priorities ignore them.",
                    {"cases": zero},
                )
            )
    # replication (library) — for header events and overall
    rep = wise.event_replication(log)
    flagged = rep["replication_ratio"] > replication_ratio_flag
    n_flagged = int(flagged.sum())
    if mapping.header_events:
        labels = set(log.activity_labels)
        present = [a for a in mapping.header_events if a in labels]
        header_share = _header_replication(log, present) if present else None
        msg = (
            f"Header events ({', '.join(mapping.header_events)}) are replicated onto items: "
            f"{header_share:.1%} of their events share activity and timestamp with another case."
            if header_share is not None
            else "Header events were named but none occur in the log."
        )
        lvl = ReadinessLevel.WARN if (header_share or 0) >= 0.2 else ReadinessLevel.INFO
        items.append(
            ReadinessItem(
                "header_event_replication",
                lvl,
                msg
                + f" {n_flagged:,} cases ({n_flagged / max(n_cases, 1):.1%}) have more than {replication_ratio_flag:g} events per distinct timestamp.",
                {
                    "headerEvents": list(mapping.header_events),
                    "replicatedShare": header_share,
                    "casesFlagged": n_flagged,
                    "ratioFlag": replication_ratio_flag,
                },
            )
        )
    elif n_flagged:
        items.append(
            ReadinessItem(
                "event_replication",
                ReadinessLevel.WARN if n_flagged / max(n_cases, 1) >= 0.1 else ReadinessLevel.INFO,
                f"{n_flagged:,} cases ({n_flagged / max(n_cases, 1):.1%}) carry more than {replication_ratio_flag:g} events per distinct timestamp; "
                "name the header events in the mapping to type this replication.",
                {"casesFlagged": n_flagged, "ratioFlag": replication_ratio_flag},
            )
        )
    # censoring (library) — one definition: right_censored with the closure activities and the window end above
    window = mapping.censoring_window
    when = f"at the end of the data ({pd.Timestamp(end).date()})" if pd.notna(end) else "at the end of the data"
    if mapping.closure_activities:
        censored = censored_mask(log, mapping, window_end=end)
        if censored is not None:
            n_c = int(censored.sum())
            share = n_c / max(n_cases, 1)
            handling = {
                "keep": "",
                "censor": " Open lags are censored at the window end (decision taken).",
                "exclude": " Open cases were excluded from this case table (decision taken).",
            }[mapping.open_cases]
            items.append(
                ReadinessItem(
                    "right_censored",
                    ReadinessLevel.WARN if share >= 0.05 else ReadinessLevel.INFO,
                    f"{n_c:,} {noun} ({share:.1%}) are still open {when}: they lack a closure activity and were "
                    f"active within {window} of the window end; late {closure_label} cannot be judged for them.{handling}",
                    {
                        "cases": n_c,
                        "share": share,
                        "closure": list(mapping.closure_activities),
                        "window": window,
                        "windowEnd": end,
                        "handling": mapping.open_cases,
                    },
                )
            )
        else:
            items.append(ReadinessItem("right_censored", ReadinessLevel.INFO, "Censoring diagnostic unavailable.", {}))
    else:
        horizon = end - pd.Timedelta(window) if pd.notna(end) else None
        if horizon is not None:
            last = log.cases["last_ts"]
            active = int((last >= horizon).sum())
            items.append(
                ReadinessItem(
                    "right_censored",
                    ReadinessLevel.INFO,
                    f"{active:,} {noun} ({active / max(n_cases, 1):.1%}) were still active within {window} of the window end "
                    f"({pd.Timestamp(end).date()}); name the closure activities in the mapping to separate open from closed cases.",
                    {"casesActiveLate": active, "window": window, "windowEnd": end},
                )
            )
    if FLOW_TYPE_ATTRIBUTE in log.cases.columns:
        counts = log.cases[FLOW_TYPE_ATTRIBUTE].value_counts(dropna=False)
        other = int(counts.get(mapping.flow_type_default, 0))
        items.append(
            ReadinessItem(
                "flow_types",
                ReadinessLevel.WARN if other / max(n_cases, 1) > 0.1 else ReadinessLevel.INFO,
                "Flow types: " + ", ".join(f"{k}: {int(n):,}" for k, n in counts.items()) + ".",
                {"counts": {str(k): int(n) for k, n in counts.items()}, "untyped": other},
            )
        )
    else:
        items.append(
            ReadinessItem(
                "flow_types",
                ReadinessLevel.INFO,
                "No flow typing in the mapping; assign flow types from an attribute or rules to analyse per flow type.",
                {"counts": {}, "untyped": n_cases},
            )
        )
    if mapping.day_precision_activities:
        items.append(
            ReadinessItem(
                "day_precision_marked",
                ReadinessLevel.INFO,
                f"Day-precision activities marked by decision: {', '.join(mapping.day_precision_activities)}; "
                "lag thresholds on them are read in days only.",
                {"activities": list(mapping.day_precision_activities)},
            )
        )
    # the analytics gate's own checks, with the same window end
    if gate is not None:
        for check in _GATE_ONLY_CHECKS:
            if check not in gate.table.index:
                continue
            row = gate.table.loc[check]
            status = str(row["status"])
            if status == "skipped":
                continue
            items.append(
                ReadinessItem(
                    f"gate:{check}",
                    _GATE_LEVELS.get(status, ReadinessLevel.INFO),
                    f"{row['evidence']} (window end {pd.Timestamp(end).date()}).",
                    {
                        "check": check,
                        "status": status,
                        "metric": str(row["metric"]),
                        "value": jsonable(row["value"]),
                        "thresholdWarn": jsonable(row["threshold_warn"]),
                        "thresholdFail": jsonable(row["threshold_fail"]),
                        "windowEnd": end,
                    },
                )
            )
    out: list[ReadinessItem] = []
    for i in items:
        evidence = dict(i.evidence)
        kind = DECISION_FOR_ITEM.get(i.id)
        decision = None
        if kind is not None:
            decision = {"kind": kind, "label": DECISION_KINDS[kind]["label"], "params": DECISION_KINDS[kind]["params"]}
        out.append(ReadinessItem(i.id, i.level, i.message, jsonable(evidence), decision=decision))
    return Readiness(items=tuple(out), window_end=jsonable(end), case_noun=noun)


def _header_replication(log: wise.EventLog, header_events: list[str]) -> float:
    ev = log.events
    mask = ev[log.activity_col].isin(header_events) & ev[log.timestamp_col].notna()
    sub = ev.loc[mask, [log.case_col, log.activity_col, log.timestamp_col]]
    if sub.empty:
        return 0.0
    n_cases = sub.groupby([log.activity_col, log.timestamp_col], observed=True)[log.case_col].transform("nunique")
    return float((n_cases > 1).mean())


def censored_flags(log: wise.EventLog, mapping: ColumnMapping, window_end: Any = None) -> pd.Series | None:
    """Alias of :func:`censored_mask` (the one censoring definition)."""
    return censored_mask(log, mapping, window_end=window_end)


def flow_type_counts(log: wise.EventLog) -> dict[str, int]:
    if FLOW_TYPE_ATTRIBUTE not in log.cases.columns:
        return {}
    return {str(k): int(n) for k, n in log.cases[FLOW_TYPE_ATTRIBUTE].value_counts(dropna=False).items()}


def numeric_range(values: np.ndarray) -> tuple[float, float]:
    return float(np.nanmin(values)), float(np.nanmax(values))
