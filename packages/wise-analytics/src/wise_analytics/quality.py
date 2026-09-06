"""The readiness gate: can this backlog be acted on, or is the signal an artefact?

:func:`readiness` runs a fixed list of descriptive checks on an event log
(and, when given, on a score result and backlog) and reports each with a
status ``pass`` / ``warn`` / ``fail`` (``skipped`` when its inputs are
missing), the measured value, the thresholds it was compared with, and a
detail table as evidence. Thresholds are conventions
(:data:`DEFAULT_THRESHOLDS`); they are configurable and recorded.

Checks
------
``sentinel_dates``
    events whose timestamp lies further than ``3·MAD + sentinel_gap_days``
    from the median event timestamp (placeholder dates such as
    1900-01-01 or 2099-12-31), plus the library's robust-window outliers,
``timestamp_concentration``
    any single timestamp carrying more than a share of all events (batch
    postings; informational),
``duplicate_events``
    exact duplicate rows and duplicate ``(case, activity, timestamp)`` keys,
``timestamp_precision``
    per activity the share of date-only timestamps; an activity with a mix
    of date-only and time-of-day stamps inflates ties and zero lags,
``vocabulary_drift``
    per period the Jensen–Shannon divergence of the activity frequencies to
    the other periods and the new / vanished labels (see
    :func:`vocabulary_drift`),
``exposure_sanity``
    zero exposure and order-of-magnitude outliers within and across groups
    (a currency-unit mix reorders an exposure-weighted backlog),
``window_edge_share``
    share of cases whose activation lies within ``δ + Δ`` of the window end
    for each lag constraint of the norm (such cases cannot yet have met the
    lag),
``right_censoring``
    :func:`wise.right_censored` with the closure activities, and for the
    top-``k`` slices :func:`wise.gap_retained` without the censored cases,
``replication``
    :func:`wise.event_replication` (events sharing one timestamp inside a
    case) and, per top-``k`` slice, the replicated share of the paper's
    Table XII.
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NotScoredError

from ._common import fmt, index_label, keys, pct
from ._stats import jensen_shannon
from .provenance import AnalyticResult, log_fingerprint, record

READINESS_VERSION = "1"
STATUS_ORDER = {"pass": 0, "skipped": 0, "warn": 1, "fail": 2}

DEFAULT_THRESHOLDS: dict[str, float] = {
    "sentinel_gap_days": 365.0,
    "sentinel_share_warn": 0.0,
    "sentinel_share_fail": 0.005,
    "concentration_share_warn": 0.01,
    "concentration_min_events": 100,
    "duplicate_share_warn": 0.001,
    "duplicate_share_fail": 0.05,
    "precision_min_events": 20,
    "precision_mix_low": 0.05,
    "precision_mix_fail": 0.20,
    "drift_min_events": 200,
    "drift_jsd_warn": 0.05,
    "drift_label_share_fail": 0.01,
    "exposure_zero_warn": 0.0,
    "exposure_zero_fail": 0.20,
    "exposure_decades": 2.0,
    "exposure_far_share_warn": 0.01,
    "exposure_far_share_fail": 0.10,
    "exposure_max_groups": 50,
    "edge_share_warn": 0.05,
    "edge_share_fail": 0.20,
    "censored_share_warn": 0.02,
    "censored_share_fail": 0.20,
    "retained_fail": 0.5,
    "replication_ratio_flag": 2.0,
    "replicated_cases_warn": 0.02,
    "replicated_cases_fail": 0.25,
    "replicated_slice_fail": 0.5,
}


@dataclass(frozen=True)
class ReadinessReport(AnalyticResult):
    """One row per check in ``table``; ``status`` is the overall verdict;
    ``evidence`` holds the detail table of every check; ``slices`` the
    per-slice validation table when a result and slicing were given."""

    status: str
    evidence: Mapping[str, pd.DataFrame]
    slices: pd.DataFrame | None

    def failed(self) -> list[str]:
        return list(self.table.index[self.table["status"] == "fail"])

    def warned(self) -> list[str]:
        return list(self.table.index[self.table["status"] == "warn"])


def _status(value: float, warn: float | None, fail: float | None, *, strict_warn: bool = False) -> str:
    if not np.isfinite(value):
        return "skipped"
    if fail is not None and value >= fail:
        return "fail"
    if warn is not None and (value > warn if (strict_warn or warn == 0.0) else value >= warn):
        return "warn"
    return "pass"


def _worst(*statuses: str) -> str:
    return max(statuses, key=lambda s: STATUS_ORDER.get(s, 0)) if statuses else "pass"


def _naive_ns(ts: pd.Series) -> np.ndarray:
    """Timestamps as int64 nanoseconds (NaT → int64 min), independent of the column's resolution and zone."""
    idx = pd.DatetimeIndex(ts)
    if idx.tz is not None:
        idx = idx.tz_convert("UTC").tz_localize(None)
    return idx.as_unit("ns").asi8


# ----------------------------------------------------------------------------- checks
def _sentinel_dates(log: wise.EventLog, th: Mapping[str, float]) -> dict[str, Any]:
    ts = log.events[log.timestamp_col]
    ns = _naive_ns(ts)
    valid = ns != np.iinfo(np.int64).min
    x = ns[valid].astype(float)
    if len(x) == 0:
        return {"status": "skipped", "value": np.nan, "evidence": "no valid timestamps", "detail": None}
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    gap = float(th["sentinel_gap_days"]) * 86400e9
    lo, hi = med - 3.0 * mad - gap, med + 3.0 * mad + gap
    far = np.zeros(len(ns), dtype=bool)
    far[valid] = (x < lo) | (x > hi)
    share = float(far.mean())
    detail = None
    if far.any():
        d = ts[far].value_counts().head(10).rename("n_events").to_frame()
        d["share_of_events"] = d["n_events"] / len(ts)
        d.index.name = "timestamp"
        detail = d
    robust = int(wise.timestamp_outliers(log).sum())
    status = _status(share, th["sentinel_share_warn"], th["sentinel_share_fail"])
    bulk_start, bulk_end = (
        pd.Timestamp(np.datetime64(int(x[~((x < lo) | (x > hi))].min()), "ns")),
        pd.Timestamp(np.datetime64(int(x[~((x < lo) | (x > hi))].max()), "ns")),
    )
    return {
        "status": status,
        "value": share,
        "evidence": f"{int(far.sum())} of {len(ts)} events lie further than 3·MAD + {th['sentinel_gap_days']:.0f} d from the median timestamp "
        f"(bulk {bulk_start.date()} – {bulk_end.date()}); {robust} events outside the library's robust observation window",
        "detail": detail,
        "far_mask": far,
        "bulk_end": bulk_end,
        "bulk_start": bulk_start,
    }


def _timestamp_concentration(log: wise.EventLog, th: Mapping[str, float]) -> dict[str, Any]:
    ts = log.events[log.timestamp_col]
    counts = ts.value_counts()
    if counts.empty:
        return {"status": "skipped", "value": np.nan, "evidence": "no timestamps", "detail": None}
    top = counts.head(10).rename("n_events").to_frame()
    top["share_of_events"] = top["n_events"] / len(ts)
    top.index.name = "timestamp"
    heavy = top[(top["share_of_events"] > th["concentration_share_warn"]) & (top["n_events"] >= th["concentration_min_events"])]
    value = float(top["share_of_events"].iloc[0])
    status = "warn" if len(heavy) else "pass"
    return {
        "status": status,
        "value": value,
        "evidence": f"the most frequent timestamp {top.index[0]} carries {pct(value)} of events ({int(top['n_events'].iloc[0])}); "
        f"{len(heavy)} timestamps above {pct(th['concentration_share_warn'])} with ≥ {int(th['concentration_min_events'])} events",
        "detail": top,
    }


def _duplicate_events(log: wise.EventLog, th: Mapping[str, float]) -> dict[str, Any]:
    ev = log.events
    exact = ev.duplicated(keep="first")
    key_dup = ev.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col], keep="first")
    share = float(exact.mean()) if len(ev) else 0.0
    detail = pd.DataFrame(
        {
            "n_events": [int(exact.sum()), int(key_dup.sum())],
            "share_of_events": [share, float(key_dup.mean()) if len(ev) else 0.0],
        },
        index=pd.Index(["exact duplicate rows", "duplicate (case, activity, timestamp)"], name="kind"),
    )
    status = _status(share, th["duplicate_share_warn"], th["duplicate_share_fail"])
    return {
        "status": status,
        "value": share,
        "evidence": f"{int(exact.sum())} exact duplicate events ({pct(share)}); {int(key_dup.sum())} events share case, activity and timestamp with another event",
        "detail": detail,
    }


def _timestamp_precision(log: wise.EventLog, norm: wise.Norm | None, th: Mapping[str, float]) -> dict[str, Any]:
    ev = log.events
    ns = _naive_ns(ev[log.timestamp_col])
    valid = ns != np.iinfo(np.int64).min
    day = 86400 * 10**9
    date_only = np.zeros(len(ns), dtype=bool)
    date_only[valid] = (ns[valid] % day) == 0
    act = ev[log.activity_col].astype(str)
    detail = pd.DataFrame(
        {"n_events": act.groupby(act).size(), "share_date_only": pd.Series(date_only).groupby(act.to_numpy()).mean()}
    )
    detail.index.name = "activity"
    p = detail["share_date_only"]
    eligible = detail["n_events"] >= th["precision_min_events"]
    mixed = eligible & (p > th["precision_mix_low"]) & (p < 1.0 - th["precision_mix_low"])
    detail["mixed"] = mixed
    worst = float(np.minimum(p[mixed], 1.0 - p[mixed]).max()) if mixed.any() else 0.0
    notes = []
    if norm is not None:
        for nc in norm.constraints:
            c = nc.constraint
            if isinstance(c, wise.Lag):
                pa = p.reindex(list(c.a)).mean()
                pb = p.reindex(list(c.b)).mean()
                if np.isfinite(pa) and np.isfinite(pb) and abs(pa - pb) > 0.5:
                    notes.append(f"lag {nc.id} pairs activities of different precision ({pct(pa)} vs {pct(pb)} date-only)")
    status = "fail" if worst >= th["precision_mix_fail"] else ("warn" if mixed.any() or notes else "pass")
    evidence = f"{int(mixed.sum())} of {int(eligible.sum())} activities mix date-only and time-of-day stamps (largest minority share {pct(worst)})"
    if notes:
        evidence += "; " + "; ".join(notes)
    return {
        "status": status,
        "value": worst,
        "evidence": evidence,
        "detail": detail.sort_values("share_date_only", ascending=False),
    }


def vocabulary_drift(
    log: wise.EventLog,
    period: str = "M",
    reference: str | None = None,
    *,
    min_events: int = 200,
    norm: wise.Norm | None = None,
) -> pd.DataFrame:
    """Activity-vocabulary drift per period.

    Events are binned by their timestamp (``period`` is a pandas offset
    alias such as ``"M"`` or ``"Q"``). Periods with fewer than
    ``min_events`` events are listed but not ``eligible``. For each period
    the reference is the pooled activity frequency of the eligible periods
    *before* it (for the first eligible period: those after it), or the
    period named by ``reference``. Reported per period: the Jensen–Shannon
    divergence (bits) to the reference, the labels new in the period with
    their share of the period's events (``new_share``), the labels present
    in the reference but absent from the period with their share of the
    reference (``vanished_share``), and, with a norm, the norm's activities
    absent from the period. A vanished label alone can be the tail of the
    observation window (no case starts any more); a new label is a
    vocabulary change.
    """
    ev = log.events
    ts = pd.DatetimeIndex(ev[log.timestamp_col])
    if ts.tz is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    valid = ~ts.isna()
    per = pd.Series(ts[valid].to_period(period).astype(str), index=ev.index[valid])
    act = ev.loc[valid, log.activity_col].astype(str)
    counts = pd.crosstab(per, act).sort_index()
    cols = [
        "period",
        "n_events",
        "eligible",
        "reference",
        "jsd",
        "new_labels",
        "new_share",
        "vanished_labels",
        "vanished_share",
        "missing_norm_activities",
    ]
    if counts.empty:
        return pd.DataFrame(columns=cols).set_index("period")
    norm_acts = set(norm.activities()) if norm is not None else set()
    n_per = counts.sum(axis=1)
    eligible = n_per >= min_events
    elig_periods = list(counts.index[eligible])
    rows = []
    for p in counts.index:
        cur = counts.loc[p]
        n = int(n_per[p])
        if reference is not None and reference in counts.index:
            ref, ref_name = counts.loc[reference], reference
        else:
            before = [q for q in elig_periods if q < p]
            after = [q for q in elig_periods if q > p]
            if before:
                ref, ref_name = counts.loc[before].sum(axis=0), f"{before[0]}..{before[-1]}"
            elif after:
                ref, ref_name = counts.loc[after].sum(axis=0), f"{after[0]}..{after[-1]}"
            else:
                ref, ref_name = cur * 0, ""
        ref_total = float(ref.sum())
        new = [a for a in counts.columns if cur[a] > 0 and ref[a] == 0]
        gone = [a for a in counts.columns if cur[a] == 0 and ref[a] > 0]
        rows.append(
            {
                "period": p,
                "n_events": n,
                "eligible": bool(eligible[p]),
                "reference": ref_name,
                "jsd": jensen_shannon(cur.to_numpy(dtype=float), ref.to_numpy(dtype=float)) if ref_total else np.nan,
                "new_labels": ", ".join(new),
                "new_share": float(cur[new].sum() / n) if (n and ref_total) else np.nan,
                "vanished_labels": ", ".join(gone),
                "vanished_share": float(ref[gone].sum() / ref_total) if ref_total else np.nan,
                "missing_norm_activities": ", ".join(sorted(a for a in norm_acts if a not in cur.index or cur[a] == 0))
                if norm_acts
                else "",
            }
        )
    return pd.DataFrame(rows, columns=cols).set_index("period")


def _vocabulary_drift(
    log: wise.EventLog, norm: wise.Norm | None, period: str, reference: str | None, th: Mapping[str, float]
) -> dict[str, Any]:
    detail = vocabulary_drift(log, period, reference, min_events=int(th["drift_min_events"]), norm=norm)
    el = detail[detail["eligible"] & detail["jsd"].notna()] if len(detail) else detail
    if el.empty:
        return {
            "status": "skipped",
            "value": np.nan,
            "evidence": f"fewer than two periods with ≥ {int(th['drift_min_events'])} events",
            "detail": detail,
        }
    new_share = float(el["new_share"].max())
    jsd = float(el["jsd"].max())
    with_new = el[el["new_labels"] != ""]
    with_gone = el[el["vanished_labels"] != ""]
    if new_share >= th["drift_label_share_fail"]:
        status = "fail"
    elif len(with_new) or len(with_gone) or jsd >= th["drift_jsd_warn"]:
        status = "warn"
    else:
        status = "pass"
    evidence = f"{len(el)} periods ({period}) with ≥ {int(th['drift_min_events'])} events; max Jensen–Shannon divergence {fmt(jsd, 3)} bits (period {el['jsd'].idxmax()})"
    if len(with_new):
        worst = el["new_share"].idxmax()
        r = el.loc[worst]
        evidence += f"; period {worst}: new labels [{r['new_labels']}] cover {pct(r['new_share'])} of its events"
        if r["vanished_labels"]:
            evidence += f" while [{r['vanished_labels']}] vanished"
    elif len(with_gone):
        first = with_gone.index[0]
        evidence += f"; labels absent from period {first} onwards: [{with_gone.loc[first, 'vanished_labels']}] ({pct(with_gone.loc[first, 'vanished_share'])} of the reference); no new labels"
    return {"status": status, "value": new_share if len(with_new) else jsd, "evidence": evidence, "detail": detail}


def _exposure_sanity(log: wise.EventLog, group_col: str | None, th: Mapping[str, float]) -> dict[str, Any]:
    cases = log.cases
    if "exposure" not in cases.columns:
        return {"status": "skipped", "value": np.nan, "evidence": "no exposure column", "detail": None}
    e = cases["exposure"].to_numpy(dtype=float)
    zero_share = float((e <= 0).mean())
    pos = e > 0
    lg = np.log10(e[pos]) if pos.any() else np.array([])
    overall = float(np.median(lg)) if len(lg) else np.nan
    if group_col is None:
        for attr in log.case_attributes:
            if cases[attr].nunique(dropna=True) <= th["exposure_max_groups"]:
                group_col = attr
                break
    if group_col is not None and group_col in cases.columns:
        g = cases.loc[pos, group_col].astype(str).to_numpy()
        df = pd.DataFrame({"group": g, "log10": lg})
        med = df.groupby("group")["log10"].median()
        far = (df["log10"] - df["group"].map(med).to_numpy()).abs() > th["exposure_decades"]
        detail = pd.DataFrame(
            {
                "n_cases": df.groupby("group").size(),
                "median_log10": med,
                "decades_from_overall": med - overall,
                "far_share": far.groupby(df["group"]).mean(),
            }
        )
        detail.index.name = group_col
        far_share = float(far.mean())
        max_dev = float(detail["decades_from_overall"].abs().max()) if len(detail) else 0.0
    else:
        far = np.abs(lg - overall) > th["exposure_decades"] if len(lg) else np.array([], dtype=bool)
        detail = pd.DataFrame(
            {
                "n_cases": [int(pos.sum())],
                "median_log10": [overall],
                "decades_from_overall": [0.0],
                "far_share": [float(far.mean()) if len(far) else 0.0],
            },
            index=pd.Index(["all"], name="group"),
        )
        far_share = float(far.mean()) if len(far) else 0.0
        max_dev = 0.0
    s_zero = _status(zero_share, th["exposure_zero_warn"], th["exposure_zero_fail"])
    s_far = _status(far_share, th["exposure_far_share_warn"], th["exposure_far_share_fail"])
    s_mix = "fail" if max_dev >= th["exposure_decades"] else "pass"
    status = _worst(s_zero, s_far, s_mix)
    evidence = (
        f"{pct(zero_share)} of cases have zero exposure; {pct(far_share)} of positive exposures lie more than "
        f"{th['exposure_decades']:g} decades from their group median"
    )
    if group_col is not None:
        evidence += f"; largest group-median offset from the overall median {fmt(max_dev, 1)} decades (by {group_col})"
        if s_mix == "fail":
            worst_group = detail["decades_from_overall"].abs().idxmax()
            evidence += f" — group {worst_group} looks like another unit"
    return {
        "status": status,
        "value": max(far_share, zero_share) if s_mix != "fail" else max_dev,
        "evidence": evidence,
        "detail": detail,
    }


def _window_edge_share(
    log: wise.EventLog,
    norm: wise.Norm | None,
    end: pd.Timestamp,
    result: wise.ScoreResult | None,
    by: Sequence[str] | None,
    view: str | None,
    k: int,
    th: Mapping[str, float],
) -> dict[str, Any]:
    if norm is None:
        return {"status": "skipped", "value": np.nan, "evidence": "no norm given", "detail": None}
    rows = []
    masks: dict[str, pd.Series] = {}
    for nc in norm.constraints:
        c = nc.constraint
        if not isinstance(c, wise.Lag) or c.delta is None:
            continue
        horizon = (c.delta + c.width) * c.timedelta_unit
        t_a = log.first_ts(c.a)
        cutoff = log._to_ts(end - horizon)
        defined = t_a.notna()
        edge = defined & (t_a > cutoff)
        masks[nc.id] = edge
        rows.append(
            {
                "constraint": nc.id,
                "horizon": f"{c.delta + c.width:g} {c.unit}",
                "n_with_activation": int(defined.sum()),
                "n_edge": int(edge.sum()),
                "edge_share": float(edge.sum() / defined.sum()) if defined.sum() else np.nan,
            }
        )
    if not rows:
        return {"status": "skipped", "value": np.nan, "evidence": "the norm has no bounded lag constraint", "detail": None}
    detail = pd.DataFrame(rows).set_index("constraint")
    value = float(detail["edge_share"].max())
    worst = detail["edge_share"].idxmax()
    status = _status(value, th["edge_share_warn"], th["edge_share_fail"])
    evidence = f"up to {pct(value)} of cases with an activation start within δ+Δ of the window end {end.date()} ({worst}, {detail.loc[worst, 'horizon']})"
    slices = None
    if result is not None and by:
        m = masks[worst].reindex(result.cases.index, fill_value=False)
        frame = result.cases.copy()
        frame["_edge"] = m.to_numpy()
        if any(c not in frame.columns for c in by):
            frame = frame.reset_index()
        slices = frame.groupby(list(by), dropna=False, observed=True)["_edge"].mean().rename("edge_share").to_frame()
        v = view or result.views[0]
        backlog = wise.prioritize(result, list(by), view=v)
        slices = slices.reindex(backlog.head(k).index)
        hot = slices[slices["edge_share"] >= th["edge_share_warn"]]
        if len(hot):
            evidence += f"; {len(hot)} of the top-{k} slices have an edge share ≥ {pct(th['edge_share_warn'])}"
            status = _worst(status, "warn")
    return {"status": status, "value": value, "evidence": evidence, "detail": detail, "slices": slices}


def _right_censoring(
    log: wise.EventLog,
    norm: wise.Norm | None,
    end: pd.Timestamp,
    closure: str | Sequence[str] | None,
    opened_by: str | Sequence[str] | None,
    window: str,
    result: wise.ScoreResult | None,
    by: Sequence[str] | None,
    view: str | None,
    gamma: float,
    k: int,
    th: Mapping[str, float],
) -> dict[str, Any]:
    if closure is None and norm is not None:
        closure = sorted({a for nc in norm.constraints if isinstance(nc.constraint, wise.Lag) for a in nc.constraint.b})
    if not closure:
        return {"status": "skipped", "value": np.nan, "evidence": "no closure activities (pass closure=...)", "detail": None}
    closure = list(wise.as_labels(closure, what="closure"))
    censored = wise.right_censored(log, closure, window=window, opened_by=opened_by, window_end=end)
    share = float(censored.mean())
    status = _status(share, th["censored_share_warn"], th["censored_share_fail"])
    evidence = f"{int(censored.sum())} of {len(censored)} cases ({pct(share)}) lack {closure} and were active within {window} of the window end {end.date()}"
    detail = None
    if result is not None and by:
        v = view or result.views[0]
        try:
            gr = wise.gap_retained(result, v, list(by), exclude=censored, gamma=gamma)
        except NotScoredError:
            gr = None
        if gr is not None:
            backlog = wise.prioritize(result, list(by), view=v, gamma=gamma)
            top = gr.reindex(backlog.head(k).index)
            top = top[top["stable_gap"] > 0]
            frame = result.cases.copy()
            frame["_c"] = censored.reindex(result.cases.index, fill_value=False).to_numpy()
            if any(c not in frame.columns for c in by):
                frame = frame.reset_index()
            top = top.join(frame.groupby(list(by), dropna=False, observed=True)["_c"].mean().rename("censored_share"))
            collapsed = top[top["retained"].notna() & (top["retained"] < th["retained_fail"])]
            detail = top
            evidence += f"; among the top-{k} backlog slices, {len(collapsed)} retain less than {pct(th['retained_fail'])} of their gap without censored cases"
            if len(collapsed):
                status = "fail"
    return {"status": status, "value": share, "evidence": evidence, "detail": detail, "censored": censored}


def _replication(
    log: wise.EventLog,
    result: wise.ScoreResult | None,
    by: Sequence[str] | None,
    view: str | None,
    gamma: float,
    k: int,
    document_col: str | None,
    th: Mapping[str, float],
) -> dict[str, Any]:
    rep = wise.event_replication(log)
    flagged = rep["replication_ratio"] > th["replication_ratio_flag"]
    share = float(flagged.mean())
    status = _status(share, th["replicated_cases_warn"], th["replicated_cases_fail"])
    evidence = (
        f"{int(flagged.sum())} of {len(rep)} cases ({pct(share)}) have more than {th['replication_ratio_flag']:g} events per distinct timestamp; "
        f"mean replicated share {pct(rep['replicated_share'].mean())}"
    )
    detail = rep.describe().T
    if document_col is not None and document_col in log.events.columns:
        cross = wise.cross_case_replication(log, document_col)
        evidence += f"; {pct((cross > 0).mean())} of cases share events with another case of the same {document_col}"
        detail.loc["cross_case_replicated_share"] = cross.describe()
    if result is not None and by:
        v = view or result.views[0]
        frame = result.cases.copy()
        frame["_r"] = flagged.reindex(result.cases.index, fill_value=False).to_numpy()
        if any(c not in frame.columns for c in by):
            frame = frame.reset_index()
        per_slice = frame.groupby(list(by), dropna=False, observed=True)["_r"].mean().rename("replicated_share")
        backlog = wise.prioritize(result, list(by), view=v, gamma=gamma)
        top = per_slice.reindex(backlog.head(k).index)
        heavy = top[top >= th["replicated_slice_fail"]]
        evidence += f"; {len(heavy)} of the top-{k} slices have a replicated share ≥ {pct(th['replicated_slice_fail'])}"
        if len(heavy):
            status = "fail"
    return {"status": status, "value": share, "evidence": evidence, "detail": detail, "replication": rep}


# ----------------------------------------------------------------------------- gate
def readiness(
    log: wise.EventLog,
    norm: wise.Norm | None = None,
    *,
    result: wise.ScoreResult | None = None,
    by: str | Sequence[str] | None = None,
    view: str | None = None,
    gamma: float = 0.0,
    closure: str | Sequence[str] | None = None,
    opened_by: str | Sequence[str] | None = None,
    window: str = "60D",
    period: str = "M",
    reference_period: str | None = None,
    group_col: str | None = None,
    document_col: str | None = None,
    k: int = 10,
    thresholds: Mapping[str, float] | None = None,
) -> ReadinessReport:
    """Run the readiness checks (see the module docstring).

    Parameters
    ----------
    log, norm
        The event log and, optionally, the norm (needed for the window-edge
        check and the default closure activities); ``norm`` defaults to
        ``result.norm`` when a result is given.
    result, by, view, gamma
        A score result and slicing enable the per-slice checks (gap
        retained without censored cases, replicated share per slice).
    closure, opened_by, window
        As in :func:`wise.right_censored`; ``closure`` defaults to the
        response activities of the norm's lag constraints.
    period, reference_period
        Period alias and optional reference period for the vocabulary drift.
    group_col
        Grouping attribute for exposure sanity (default: the first
        low-cardinality case attribute).
    document_col
        Event column naming the governance unit (e.g. the purchasing
        document) for :func:`wise.cross_case_replication`; skipped when
        omitted.
    k
        Number of top slices inspected by the per-slice checks.
    thresholds
        Overrides of :data:`DEFAULT_THRESHOLDS`.
    """
    t0 = time.perf_counter()
    th: dict[str, float] = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    if norm is None and result is not None:
        norm = result.norm
    by_l = keys(by) if by is not None else None
    if result is not None and view is None:
        view = result.views[0]
    caught: list[str] = []
    with warnings.catch_warnings(record=True) as wlist:
        warnings.simplefilter("always")
        checks: dict[str, dict[str, Any]] = {}
        sent = _sentinel_dates(log, th)
        checks["sentinel_dates"] = sent
        end = log.window[1] if (log.window and log.window[1] is not None) else sent.get("bulk_end", log.window_end)
        checks["timestamp_concentration"] = _timestamp_concentration(log, th)
        checks["duplicate_events"] = _duplicate_events(log, th)
        checks["timestamp_precision"] = _timestamp_precision(log, norm, th)
        checks["vocabulary_drift"] = _vocabulary_drift(log, norm, period, reference_period, th)
        checks["exposure_sanity"] = _exposure_sanity(log, group_col, th)
        checks["window_edge_share"] = _window_edge_share(log, norm, end, result, by_l, view, k, th)
        checks["right_censoring"] = _right_censoring(log, norm, end, closure, opened_by, window, result, by_l, view, gamma, k, th)
        checks["replication"] = _replication(log, result, by_l, view, gamma, k, document_col, th)
    caught.extend(str(w.message) for w in wlist)

    labels = {
        "sentinel_dates": ("share of far-out timestamps", th["sentinel_share_warn"], th["sentinel_share_fail"]),
        "timestamp_concentration": ("share of events on the busiest timestamp", th["concentration_share_warn"], np.nan),
        "duplicate_events": ("share of exact duplicate events", th["duplicate_share_warn"], th["duplicate_share_fail"]),
        "timestamp_precision": (
            "largest minority precision share within an activity",
            th["precision_mix_low"],
            th["precision_mix_fail"],
        ),
        "vocabulary_drift": ("share of events under new labels (or max JSD)", th["drift_jsd_warn"], th["drift_label_share_fail"]),
        "exposure_sanity": (
            "outlying exposure share (or decades of group offset)",
            th["exposure_far_share_warn"],
            th["exposure_far_share_fail"],
        ),
        "window_edge_share": (
            "max share of activations within δ+Δ of the window end",
            th["edge_share_warn"],
            th["edge_share_fail"],
        ),
        "right_censoring": ("share of right-censored cases", th["censored_share_warn"], th["censored_share_fail"]),
        "replication": ("share of cases with replicated events", th["replicated_cases_warn"], th["replicated_cases_fail"]),
    }
    rows = []
    evidence: dict[str, pd.DataFrame] = {}
    for name, c in checks.items():
        metric, w, f = labels[name]
        rows.append(
            {
                "check": name,
                "status": c["status"],
                "metric": metric,
                "value": c["value"],
                "threshold_warn": w,
                "threshold_fail": f,
                "evidence": c["evidence"],
            }
        )
        if c.get("detail") is not None:
            evidence[name] = c["detail"]
        if c.get("slices") is not None:
            evidence[f"{name}__slices"] = c["slices"]
    table = pd.DataFrame(rows).set_index("check")
    overall = _worst(*table["status"].tolist())

    slices = None
    if result is not None and by_l:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            slices = wise.validation_table(
                result,
                view or result.views[0],
                by_l,
                censored=checks["right_censoring"].get("censored"),
                replication=checks["replication"].get("replication"),
                gamma=gamma,
                ratio_flag=th["replication_ratio_flag"],
                top=k,
            )
    counts = table["status"].value_counts().to_dict()
    summary: dict[str, Any] = {
        "status": overall,
        "n_fail": int(counts.get("fail", 0)),
        "n_warn": int(counts.get("warn", 0)),
        "n_pass": int(counts.get("pass", 0)),
        "n_skipped": int(counts.get("skipped", 0)),
        "failed": list(table.index[table["status"] == "fail"]),
        "warned": list(table.index[table["status"] == "warn"]),
        "window_end_used": str(end),
        "n_events": len(log.events),
        "n_cases": len(log),
        "thresholds": th,
        "library_warnings": caught,
        "runtime_s": time.perf_counter() - t0,
    }
    readings = [
        f"Readiness: {overall} — {summary['n_fail']} checks fail ({', '.join(summary['failed']) or 'none'}), "
        f"{summary['n_warn']} warn ({', '.join(summary['warned']) or 'none'}), {summary['n_pass']} pass, {summary['n_skipped']} skipped. "
        + (
            "Action hypotheses for this backlog are blocked until the failing checks are resolved or waived with a note."
            if overall == "fail"
            else ""
        )
    ]
    for name, row in table.iterrows():
        if row["status"] in ("fail", "warn"):
            readings.append(f"{name} ({row['status']}): {row['evidence']}.")
    if slices is not None and by_l:
        flagged = slices[slices["reading"] != "stable signal"]
        for key, row in flagged.iterrows():
            readings.append(f"Slice {index_label(key, by_l)}: {row['reading']} (n = {int(row['n_cases'])}).")
    rec = record(
        "readiness",
        READINESS_VERSION,
        table=table.drop(columns=["evidence"]),
        params={
            "by": by_l,
            "view": view,
            "gamma": float(gamma),
            "closure": list(closure) if isinstance(closure, list | tuple) else closure,
            "opened_by": opened_by,
            "window": window,
            "period": period,
            "reference_period": reference_period,
            "group_col": group_col,
            "document_col": document_col,
            "k": int(k),
            "thresholds": th,
        },
        log_fingerprint=log_fingerprint(log),
        norm_fingerprint=norm.fingerprint() if norm is not None else None,
        warnings=caught,
        runtime_s=summary["runtime_s"],
    )
    return ReadinessReport(
        table=table, summary=summary, record=rec, readings=tuple(readings), status=overall, evidence=evidence, slices=slices
    )


__all__ = ["DEFAULT_THRESHOLDS", "READINESS_VERSION", "ReadinessReport", "readiness", "vocabulary_drift"]
