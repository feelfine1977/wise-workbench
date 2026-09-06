"""Building library event logs from stored events, flow typing, and the readiness report."""

from __future__ import annotations

import warnings
from typing import Any, cast

import numpy as np
import pandas as pd
import wise

from wise_workbench.domain import (
    FLOW_TYPE_ATTRIBUTE,
    ColumnMapping,
    Readiness,
    ReadinessItem,
    ReadinessLevel,
    ValidationError,
)

from .tables import jsonable

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
        return wise.EventLog(df, **kwargs)
    except wise.LogSchemaError as exc:
        raise _library_error(exc, "mapping.invalid") from exc
    except ValueError as exc:
        raise _library_error(exc, "mapping.invalid") from exc


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
    log.add_case_attribute(FLOW_TYPE_ATTRIBUTE, flow)
    return flow


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


def readiness_report(log: wise.EventLog, mapping: ColumnMapping, *, replication_ratio_flag: float = 2.0) -> Readiness:
    """The data-readiness report: library diagnostics plus precision, sentinel dates and duplicates."""
    items: list[ReadinessItem] = []
    v = log.validate()
    start, end = log.observation_window()
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
            f"Observation window {start} to {end} (robust quantiles); raw timestamps span {raw_min} to {raw_max}.",
            {"start": start, "end": end, "rawMin": raw_min, "rawMax": raw_max},
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
    # censoring (library) — when closure activities are known
    if mapping.closure_activities:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)  # the window is reported above
                censored = wise.right_censored(log, list(mapping.closure_activities), window="60D")
            n_c = int(censored.sum())
            items.append(
                ReadinessItem(
                    "right_censored",
                    ReadinessLevel.WARN if n_c / max(n_cases, 1) >= 0.05 else ReadinessLevel.INFO,
                    f"{n_c:,} cases ({n_c / max(n_cases, 1):.1%}) are still open within 60 days of the window end; "
                    "their missing closure is a window artefact until proven otherwise.",
                    {"cases": n_c, "closure": list(mapping.closure_activities), "window": "60D"},
                )
            )
        except wise.WiseError as exc:
            items.append(
                ReadinessItem("right_censored", ReadinessLevel.INFO, f"Censoring diagnostic unavailable: {exc}", {})
            )
    else:
        horizon = end - pd.Timedelta("60D") if pd.notna(end) else None
        if horizon is not None:
            last = log.cases["last_ts"]
            active = int((last >= horizon).sum())
            items.append(
                ReadinessItem(
                    "right_censored",
                    ReadinessLevel.INFO,
                    f"{active:,} cases ({active / max(n_cases, 1):.1%}) were still active within 60 days of the window end; "
                    "name the closure activities in the mapping to separate open from closed cases.",
                    {"casesActiveLate": active, "window": "60D"},
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
    return Readiness(items=tuple(ReadinessItem(i.id, i.level, i.message, jsonable(i.evidence)) for i in items))


def _header_replication(log: wise.EventLog, header_events: list[str]) -> float:
    ev = log.events
    mask = ev[log.activity_col].isin(header_events) & ev[log.timestamp_col].notna()
    sub = ev.loc[mask, [log.case_col, log.activity_col, log.timestamp_col]]
    if sub.empty:
        return 0.0
    n_cases = sub.groupby([log.activity_col, log.timestamp_col], observed=True)[log.case_col].transform("nunique")
    return float((n_cases > 1).mean())


def censored_flags(log: wise.EventLog, mapping: ColumnMapping) -> pd.Series | None:
    if not mapping.closure_activities:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            return wise.right_censored(log, list(mapping.closure_activities), window="60D")
    except wise.WiseError:
        return None


def flow_type_counts(log: wise.EventLog) -> dict[str, int]:
    if FLOW_TYPE_ATTRIBUTE not in log.cases.columns:
        return {}
    return {str(k): int(n) for k, n in log.cases[FLOW_TYPE_ATTRIBUTE].value_counts(dropna=False).items()}


def numeric_range(values: np.ndarray) -> tuple[float, float]:
    return float(np.nanmin(values)), float(np.nanmax(values))
