"""The readiness gate: can this backlog be acted on, or is the signal an artefact?

:func:`readiness` runs a fixed list of descriptive checks on an event log
(and, when given, on a score result and backlog) and reports each with a
status ``pass`` / ``warn`` / ``fail`` (``skipped`` when its inputs are
missing), the measured value, the thresholds it was compared with, the
window end it was computed against, and a detail table as evidence.
Thresholds are conventions (:data:`DEFAULT_THRESHOLDS`); they are
configurable and recorded.

Definitions shared with the library
-----------------------------------
Every number below is computed against **one window end** and with the
library's own diagnostics, so that the backend's readiness report, the
validation table (:func:`wise.validation_table`) and this gate print the
same censored share and the same duplicate count for a group.

``window_end``
    The explicit ``window_end`` argument; else the log's explicit window
    (``EventLog(window=...)``); else the end of the robust observation
    window :meth:`wise.EventLog.observation_window` (the ``1 − q`` quantile
    of case ends, ``q = 0.001``). Only when that robust end is itself a
    far-out date — it lies more than ``sentinel_gap_days`` beyond the bulk
    of the timestamps (the 3·MAD rule of the sentinel check) — the bulk end
    is used instead; the sentinel check then fails and the summary and the
    readings say which end was used and why. The value travels in the
    ``window_end`` column of every check row, in ``summary["window_end"]``
    and in every caveat text.
``right-censored`` case
    :func:`wise.right_censored` with that window end: the case lacks every
    closure activity, its last event lies within ``window`` (default 60
    days) before the window end or after it, and — when ``opened_by`` is
    given — at least one of those activities occurred.
``duplicate`` event
    An event that shares case, activity and timestamp with an earlier
    event of the log — the key :class:`wise.EventLog` drops with
    ``dedupe=True``. Exact duplicate rows (every column equal) are reported
    next to it as a subset.
``timestamp precision``
    An event has *day* precision when its timestamp carries no time of
    day (00:00:00), *time* precision otherwise. An activity is ``day`` when
    at least ``1 − precision_mix_low`` of its events are day-precise,
    ``time`` when at most ``precision_mix_low`` are, ``mixed`` in between;
    a mixed activity inflates ties and zero lags. A lag constraint whose
    two ends differ in precision is named.
``replicated`` case
    :func:`wise.event_replication`: more than ``replication_ratio_flag``
    events per distinct timestamp inside the case.
``sentinel`` date
    An event timestamp further than ``3·MAD + sentinel_gap_days`` from the
    median timestamp (placeholder dates such as 1900-01-01 or 2099-12-31);
    the library's robust-window outliers are reported next to it.

Checks
------
``sentinel_dates``
    share of events on sentinel dates (definition above),
``timestamp_concentration``
    any single timestamp carrying more than a share of all events (batch
    postings; informational),
``duplicate_events``
    share of duplicate events (definition above),
``timestamp_precision``
    per activity the precision class; the largest minority share within
    a mixed activity is the value,
``vocabulary_drift``
    per period the Jensen–Shannon divergence of the activity frequencies to
    the other periods and the new / vanished labels (see
    :func:`vocabulary_drift`),
``frequency_drift``
    per activity the share of cases (by start period) that carry the
    activity, and the largest step between two stretches of periods (see
    :func:`activity_frequency_drift`); periods within the censoring window
    of the window end are excluded,
``logging_asymmetry``
    a releasing or closing activity logged far more often than its setting
    activity (``Remove Payment Block`` without ``Set Payment Block``): the
    share of cases with the release but no logged setting event (see
    :func:`logging_asymmetry`),
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

The per-case flags behind the checks stay on the report
(``ReadinessReport.case_flags``) so that :func:`caveats_for_slice` can
print, for any group of cases, the caveats that touch it with their share
in plain words ("14 % of items still open at the end of the data …").
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NormError, NotScoredError

from ._common import fmt, index_label, keys, pct, slice_mask
from ._stats import jensen_shannon
from .provenance import AnalyticResult, log_fingerprint, record

READINESS_VERSION = "2"
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
    "frequency_min_cases": 50,
    "frequency_step_warn": 0.10,
    "frequency_step_fail": 0.30,
    "asymmetry_share_warn": 0.10,
    "asymmetry_share_fail": 0.50,
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

#: Verb pairs that name a setting activity and the activity releasing or
#: closing it; two labels with the same remainder ("Payment Block") and
#: verbs from one pair form a setting / releasing pair for
#: :func:`logging_asymmetry`.
SETTING_RELEASING_VERBS: tuple[tuple[str, str], ...] = (
    ("set", "remove"),
    ("set", "release"),
    ("set", "unset"),
    ("set", "clear"),
    ("set", "delete"),
    ("block", "unblock"),
    ("block", "release"),
    ("lock", "unlock"),
    ("hold", "release"),
    ("open", "close"),
    ("start", "end"),
    ("start", "finish"),
    ("start", "complete"),
    ("start", "stop"),
    ("add", "remove"),
    ("create", "delete"),
    ("create", "cancel"),
    ("record", "cancel"),
    ("assign", "unassign"),
    ("activate", "deactivate"),
    ("raise", "resolve"),
    ("raise", "close"),
    ("grant", "revoke"),
    ("suspend", "resume"),
    ("reserve", "release"),
)

#: Caveat kinds in the order they are printed: kind, per-case flag column,
#: and the threshold names (warn, fail) that give a share its status.
CAVEAT_KINDS: tuple[tuple[str, str, str, str], ...] = (
    ("censoring", "censored", "censored_share_warn", "censored_share_fail"),
    ("replication", "replicated", "replicated_cases_warn", "replicated_slice_fail"),
    ("duplicates", "duplicate", "duplicate_share_warn", "duplicate_share_fail"),
    ("sentinel_dates", "sentinel", "sentinel_share_warn", "sentinel_share_fail"),
    ("window_edge", "window_edge", "edge_share_warn", "edge_share_fail"),
)


@dataclass(frozen=True)
class Caveat:
    """One data caveat that touches a group of cases, with its share and a plain sentence."""

    id: str
    n: int
    n_group: int
    share: float
    status: str
    text: str
    window_end: pd.Timestamp | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "n": int(self.n),
            "n_group": int(self.n_group),
            "share": float(self.share),
            "status": self.status,
            "text": self.text,
            "window_end": str(self.window_end.date()) if self.window_end is not None else None,
        }


@dataclass(frozen=True)
class ReadinessReport(AnalyticResult):
    """One row per check in ``table``; ``status`` is the overall verdict;
    ``evidence`` holds the detail table of every check; ``slices`` the
    per-slice validation table when a result and slicing were given;
    ``case_flags`` the boolean per-case flags behind the caveats and
    ``cases`` the case attributes they are joined with."""

    status: str
    evidence: Mapping[str, pd.DataFrame]
    slices: pd.DataFrame | None
    case_flags: pd.DataFrame | None = field(default=None, repr=False)
    cases: pd.DataFrame | None = field(default=None, repr=False)

    def failed(self) -> list[str]:
        return list(self.table.index[self.table["status"] == "fail"])

    def warned(self) -> list[str]:
        return list(self.table.index[self.table["status"] == "warn"])

    @property
    def window_end(self) -> pd.Timestamp | None:
        """The window end every check was computed against."""
        value = self.summary.get("window_end")
        return None if value is None else pd.Timestamp(value)


def _status(value: float, warn: float | None, fail: float | None, *, strict_warn: bool = False) -> str:
    if not np.isfinite(value):
        return "skipped"
    if fail is not None and np.isfinite(fail) and value >= fail:
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


def _naive_index(ts: pd.Series | Sequence[Any]) -> pd.DatetimeIndex:
    idx = pd.DatetimeIndex(ts)
    return idx.tz_convert("UTC").tz_localize(None) if idx.tz is not None else idx


def _case_any(log: wise.EventLog, event_mask: np.ndarray) -> pd.Series:
    """Boolean per case: any event of the case is flagged in ``event_mask`` (aligned with ``log.events``)."""
    ev = log.events
    flagged = pd.Series(np.asarray(event_mask, dtype=bool), index=ev.index).groupby(ev[log.case_col].to_numpy()).any()
    return flagged.reindex(log.case_ids, fill_value=False).astype(bool)


def _in_log_zone(log: wise.EventLog, t: pd.Timestamp) -> pd.Timestamp:
    if log.tz is not None and t.tzinfo is None:
        return t.tz_localize("UTC").tz_convert(log.tz)
    return t


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
    inside = x[~((x < lo) | (x > hi))]
    bulk_start = _in_log_zone(log, pd.Timestamp(np.datetime64(int(inside.min()), "ns")))
    bulk_end = _in_log_zone(log, pd.Timestamp(np.datetime64(int(inside.max()), "ns")))
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
    key_dup = ev.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col], keep="first")
    exact = ev.duplicated(keep="first")
    share = float(key_dup.mean()) if len(ev) else 0.0
    detail = pd.DataFrame(
        {
            "n_events": [int(key_dup.sum()), int(exact.sum())],
            "share_of_events": [share, float(exact.mean()) if len(ev) else 0.0],
        },
        index=pd.Index(["duplicate (case, activity, timestamp)", "exact duplicate rows"], name="kind"),
    )
    status = _status(share, th["duplicate_share_warn"], th["duplicate_share_fail"])
    per_case = _case_any(log, key_dup.to_numpy())
    return {
        "status": status,
        "value": share,
        "evidence": f"{int(key_dup.sum())} events ({pct(share)}) share case, activity and timestamp with an earlier event "
        f"(the key EventLog(dedupe=True) drops), {int(exact.sum())} of them exact duplicate rows; "
        f"{int(per_case.sum())} cases ({pct(per_case.mean())}) carry a duplicate",
        "detail": detail,
        "per_case": per_case,
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
    low = float(th["precision_mix_low"])
    eligible = detail["n_events"] >= th["precision_min_events"]
    detail["precision"] = np.where(p >= 1.0 - low, "day", np.where(p <= low, "time", "mixed"))
    mixed = eligible & (detail["precision"] == "mixed")
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
    day_acts = list(detail.index[eligible & (detail["precision"] == "day")])
    evidence = f"{int(mixed.sum())} of {int(eligible.sum())} activities mix date-only and time-of-day stamps (largest minority share {pct(worst)})"
    if day_acts:
        shown = ", ".join(day_acts[:5]) + (f" and {len(day_acts) - 5} more" if len(day_acts) > 5 else "")
        evidence += f"; day precision on {len(day_acts)} activities ({shown})"
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
    ts = _naive_index(ev[log.timestamp_col])
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


# ----------------------------------------------------------------------------- frequency drift
def activity_frequency_drift(
    log: wise.EventLog,
    period: str = "M",
    *,
    window_end: Any = None,
    window: str | pd.Timedelta = "60D",
    min_cases: int = 50,
    activities: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Share of cases carrying each activity, by the period of the case start.

    Cases are binned by their first timestamp (``period`` is a pandas
    offset alias such as ``"M"`` or ``"Q"``). For every activity and period
    the table gives ``n_cases`` (cases starting in the period), ``n_with``
    (those with at least one event of the activity), ``share``,
    ``eligible`` (``n_cases ≥ min_cases``) and ``censored`` — the period
    ends within ``window`` of ``window_end`` (default: the robust
    observation-window end), so cases starting in it may not have reached
    the activity yet. Indexed by ``(activity, period)``.
    """
    start = _naive_index(log.cases["first_ts"])
    valid = np.asarray(~start.isna())
    end = log._to_ts(window_end) if window_end is not None else log.observation_window()[1]
    end_naive = _naive_index([end])[0] if not pd.isna(end) else pd.NaT
    win = pd.Timedelta(window)
    labels = list(activities) if activities is not None else list(log.activity_labels)
    cols = ["activity", "period", "n_cases", "n_with", "share", "eligible", "censored"]
    if not valid.any() or not labels:
        return pd.DataFrame(columns=cols).set_index(["activity", "period"])
    per = start[valid].to_period(period)
    per_codes, per_index = pd.factorize(per, sort=True)
    n_cases = np.bincount(per_codes, minlength=len(per_index)).astype(int)
    censored = np.array([bool(not pd.isna(end_naive) and p.end_time > end_naive - win) for p in per_index], dtype=bool)
    rows = []
    for a in labels:
        has = (log.count(a).to_numpy(dtype=float) > 0)[valid]
        n_with = np.bincount(per_codes, weights=has.astype(float), minlength=len(per_index)).astype(int)
        for j, p in enumerate(per_index):
            rows.append(
                {
                    "activity": a,
                    "period": str(p),
                    "n_cases": int(n_cases[j]),
                    "n_with": int(n_with[j]),
                    "share": float(n_with[j] / n_cases[j]) if n_cases[j] else np.nan,
                    "eligible": bool(n_cases[j] >= int(min_cases)),
                    "censored": bool(censored[j]),
                }
            )
    return pd.DataFrame(rows, columns=cols).set_index(["activity", "period"])


def frequency_drift_summary(table: pd.DataFrame) -> pd.DataFrame:
    """Per activity: the largest step of the share between two stretches of usable periods.

    Usable periods are ``eligible`` and not ``censored``. For every split
    point the case-weighted share before and after the split is compared;
    the split with the largest absolute difference gives ``step_period``
    (the first period after the split), ``share_before``, ``share_after``
    and ``step_size``. ``share_min`` / ``share_max`` are over the usable
    periods. Activities with fewer than two usable periods have NaN steps.
    """
    rows = []
    if len(table):
        for a, g in table.groupby(level="activity", sort=False):
            u = g[g["eligible"] & ~g["censored"]].sort_index(level="period")
            row: dict[str, Any] = {
                "activity": a,
                "n_periods": len(u),
                "n_censored": int(g["censored"].sum()),
                "share_min": float(u["share"].min()) if len(u) else np.nan,
                "share_max": float(u["share"].max()) if len(u) else np.nan,
                "share_first": float(u["share"].iloc[0]) if len(u) else np.nan,
                "share_last": float(u["share"].iloc[-1]) if len(u) else np.nan,
                "step_period": None,
                "share_before": np.nan,
                "share_after": np.nan,
                "step_size": np.nan,
            }
            if len(u) >= 2:
                n = u["n_cases"].to_numpy(dtype=float)
                w = u["n_with"].to_numpy(dtype=float)
                cn, cw = np.cumsum(n), np.cumsum(w)
                before = cw[:-1] / cn[:-1]
                after = (cw[-1] - cw[:-1]) / (cn[-1] - cn[:-1])
                diff = after - before
                j = int(np.argmax(np.abs(diff)))
                row.update(
                    {
                        "step_period": str(u.index.get_level_values("period")[j + 1]),
                        "share_before": float(before[j]),
                        "share_after": float(after[j]),
                        "step_size": float(abs(diff[j])),
                    }
                )
            rows.append(row)
    cols = [
        "activity",
        "n_periods",
        "n_censored",
        "share_min",
        "share_max",
        "share_first",
        "share_last",
        "step_period",
        "share_before",
        "share_after",
        "step_size",
    ]
    out = pd.DataFrame(rows, columns=cols).set_index("activity")
    return out.sort_values("step_size", ascending=False, kind="mergesort", na_position="last")


def _frequency_drift(log: wise.EventLog, end: pd.Timestamp, period: str, window: str, th: Mapping[str, float]) -> dict[str, Any]:
    table = activity_frequency_drift(log, period, window_end=end, window=window, min_cases=int(th["frequency_min_cases"]))
    summary = frequency_drift_summary(table)
    usable = summary[summary["n_periods"] >= 2]
    if usable.empty:
        return {
            "status": "skipped",
            "value": np.nan,
            "evidence": f"fewer than two periods ({period}) with ≥ {int(th['frequency_min_cases'])} case starts outside the censoring window",
            "detail": summary,
            "periods": table,
        }
    value = float(usable["step_size"].max())
    worst = str(usable["step_size"].idxmax())
    r = usable.loc[worst]
    status = _status(value, th["frequency_step_warn"], th["frequency_step_fail"])
    n_shift = int((usable["step_size"] >= th["frequency_step_warn"]).sum())
    n_cens = int(pd.Index(table.index.get_level_values("period")[table["censored"].to_numpy()]).nunique()) if len(table) else 0
    evidence = (
        f"{worst}: share of cases with the activity {pct(r['share_before'])} → {pct(r['share_after'])} from {r['step_period']} on "
        f"(largest step over {int(r['n_periods'])} periods of {period}); {n_shift} of {len(usable)} activities shift by ≥ "
        f"{100 * th['frequency_step_warn']:.0f} points; {n_cens} periods within {window} of the window end {end.date()} excluded"
    )
    return {"status": status, "value": value, "evidence": evidence, "detail": summary, "periods": table}


# ----------------------------------------------------------------------------- logging asymmetry
def activity_pairs(labels: Sequence[str]) -> list[tuple[str, str]]:
    """Setting / releasing label pairs among ``labels``: two labels whose
    first word is a verb pair of :data:`SETTING_RELEASING_VERBS` and whose
    remainder is the same ("Set Payment Block" / "Remove Payment Block")."""
    stems: dict[str, dict[str, str]] = {}
    for lab in labels:
        toks = str(lab).strip().split()
        if len(toks) < 2:
            continue
        verb, stem = toks[0].lower(), " ".join(t.lower() for t in toks[1:])
        stems.setdefault(stem, {}).setdefault(verb, str(lab))
    pairs = set()
    for verbs in stems.values():
        for s, r in SETTING_RELEASING_VERBS:
            if s in verbs and r in verbs:
                pairs.add((verbs[s], verbs[r]))
    return sorted(pairs)


def logging_asymmetry(
    log: wise.EventLog,
    pairs: Sequence[tuple[str, str]] | None = None,
    *,
    norm: wise.Norm | None = None,
) -> pd.DataFrame:
    """Releasing or closing activities logged without their setting activity.

    ``pairs`` are ``(setting, releasing)`` labels; ``None`` detects them
    with :func:`activity_pairs`. Per pair: the event counts, the number
    of cases with the release, the share of those without any logged
    setting event (``share_release_without_set``), the event ratio, and
    whether the norm references either activity. A high share means the
    setting step is invisible in the log: an expectation on it measures
    logging, not behaviour, and a lag from it cannot be evaluated.
    """
    found = list(pairs) if pairs is not None else activity_pairs(log.activity_labels)
    norm_acts = set(norm.activities()) if norm is not None else set()
    rows = []
    for setting, releasing in found:
        n_set_events = int(log.count(setting).sum())
        n_rel_events = int(log.count(releasing).sum())
        has_set = log.count(setting) > 0
        has_rel = log.count(releasing) > 0
        n_rel = int(has_rel.sum())
        without = int((has_rel & ~has_set).sum())
        ratio = (n_rel_events / n_set_events) if n_set_events else (np.inf if n_rel_events else np.nan)
        rows.append(
            {
                "setting": setting,
                "releasing": releasing,
                "n_setting_events": n_set_events,
                "n_releasing_events": n_rel_events,
                "event_ratio": ratio,
                "cases_with_release": n_rel,
                "cases_release_without_set": without,
                "share_release_without_set": (without / n_rel) if n_rel else np.nan,
                "setting_in_norm": setting in norm_acts,
                "releasing_in_norm": releasing in norm_acts,
            }
        )
    cols = [
        "setting",
        "releasing",
        "n_setting_events",
        "n_releasing_events",
        "event_ratio",
        "cases_with_release",
        "cases_release_without_set",
        "share_release_without_set",
        "setting_in_norm",
        "releasing_in_norm",
    ]
    out = pd.DataFrame(rows, columns=cols).set_index(["setting", "releasing"])
    return out.sort_values("share_release_without_set", ascending=False, kind="mergesort", na_position="last")


def _logging_asymmetry(
    log: wise.EventLog, norm: wise.Norm | None, pairs: Sequence[tuple[str, str]] | None, th: Mapping[str, float]
) -> dict[str, Any]:
    detail = logging_asymmetry(log, pairs, norm=norm)
    usable = detail[detail["share_release_without_set"].notna()]
    if usable.empty:
        return {
            "status": "skipped",
            "value": np.nan,
            "evidence": "no setting / releasing activity pair with a logged release"
            + ("" if len(detail) else " (no label pair detected; pass asymmetry_pairs=...)"),
            "detail": detail,
        }
    value = float(usable["share_release_without_set"].max())
    key = usable["share_release_without_set"].idxmax()
    r = usable.loc[key]
    status = _status(value, th["asymmetry_share_warn"], None)
    heavy = usable[usable["share_release_without_set"] >= th["asymmetry_share_fail"]]
    if len(heavy) and bool(heavy["setting_in_norm"].any()):
        status = "fail"
    setting, releasing = key
    evidence = (
        f"{releasing} is logged {int(r['n_releasing_events'])} times against {int(r['n_setting_events'])} {setting}; "
        f"{pct(value)} of the {int(r['cases_with_release'])} cases with a release have no logged setting event"
        + (f"; the norm references {setting}" if r["setting_in_norm"] else "")
        + f"; {int((usable['share_release_without_set'] >= th['asymmetry_share_warn']).sum())} of {len(usable)} pairs above {pct(th['asymmetry_share_warn'])}"
    )
    return {"status": status, "value": value, "evidence": evidence, "detail": detail}


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
    any_edge = pd.Series(False, index=log.case_ids)
    for m in masks.values():
        any_edge |= m.reindex(log.case_ids, fill_value=False).astype(bool)
    return {"status": status, "value": value, "evidence": evidence, "detail": detail, "slices": slices, "per_case": any_edge}


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
    evidence = (
        f"{int(censored.sum())} of {len(censored)} cases ({pct(share)}) lack {closure} and were active within {window} of the "
        f"window end {end.date()} (wise.right_censored with that window end)"
    )
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
    return {"status": status, "value": share, "evidence": evidence, "detail": detail, "censored": censored, "closure": closure}


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
    return {"status": status, "value": share, "evidence": evidence, "detail": detail, "replication": rep, "per_case": flagged}


# ----------------------------------------------------------------------------- window end
def _resolve_window_end(
    log: wise.EventLog, sent: Mapping[str, Any], window_end: Any, q: float, th: Mapping[str, float], notes: list[str]
) -> tuple[pd.Timestamp, str]:
    """The window end every check is computed against, and where it came from (module docstring)."""
    if window_end is not None:
        return pd.Timestamp(log._to_ts(window_end)), "explicit argument"
    if log.window is not None and log.window[1] is not None:
        return pd.Timestamp(log.window[1]), "explicit log window (EventLog(window=...))"
    lib_end = log.observation_window(q)[1]
    bulk_end = sent.get("bulk_end")
    if pd.isna(lib_end):
        fallback = bulk_end if bulk_end is not None else log.window_end
        return pd.Timestamp(fallback), "last timestamp (no case timestamps for a robust window)"
    gap = pd.Timedelta(days=float(th["sentinel_gap_days"]))
    if bulk_end is not None and lib_end > bulk_end + gap:
        notes.append(
            f"the robust observation window ends at {lib_end}, more than {th['sentinel_gap_days']:.0f} d beyond the bulk of the "
            f"timestamps ({bulk_end}); the bulk end is used as window end. Pass EventLog(window=...) to set the window explicitly."
        )
        return pd.Timestamp(
            bulk_end
        ), f"bulk of timestamps (3·MAD rule): the robust observation-window end {lib_end.date()} is a far-out date"
    return pd.Timestamp(lib_end), f"robust observation window (EventLog.observation_window, q = {q:g})"


# ----------------------------------------------------------------------------- caveat texts
def caveat_text(
    kind: str,
    share: float,
    *,
    items: str = "cases",
    window_end: pd.Timestamp | None = None,
    closure_label: str = "closure",
) -> str:
    """The plain sentence for a caveat kind and its share within a group."""
    when = f" ({window_end.date()})" if window_end is not None else ""
    p = pct(share)
    if kind == "censoring":
        return f"{p} of {items} still open at the end of the data{when}: late {closure_label} cannot be judged"
    if kind == "replication":
        return f"{p} of {items} carry copied postings (several events at one timestamp, as when a document-level posting is copied onto every item)"
    if kind == "duplicates":
        return f"{p} of {items} carry duplicate events (the same activity twice at one timestamp)"
    if kind == "sentinel_dates":
        return f"{p} of {items} carry a placeholder date far outside the observation window"
    if kind == "window_edge":
        return f"{p} of {items} started within the lag horizon of the window end{when}: the lag could not yet be met"
    raise NormError(f"unknown caveat kind {kind!r}; known: {[k for k, *_ in CAVEAT_KINDS]}")


def caveats_for_slice(
    report: ReadinessReport,
    where: Mapping[str, Any] | pd.Series | np.ndarray | None,
    *,
    items: str = "cases",
    closure_label: str = "closure",
    min_share: float = 0.0,
) -> list[Caveat]:
    """The data caveats that touch a group of cases, with shares and plain texts.

    ``where`` is ``{attribute: value}`` (AND) or a boolean mask over the
    cases of the log the report was built on. Each caveat carries the
    number of flagged cases in the group, the group size, the share, a
    status from the report's thresholds and a sentence that names the
    window end. Caveats with a share at or below ``min_share`` are left
    out (with the default, every caveat that touches at least one case is
    returned).
    """
    if report.case_flags is None or report.cases is None:
        raise NormError("the readiness report carries no per-case flags")
    mask = slice_mask(report.cases, where).reindex(report.case_flags.index, fill_value=False).to_numpy()
    n_group = int(mask.sum())
    th = report.summary["thresholds"]
    end = report.window_end
    out: list[Caveat] = []
    for kind, col, warn_key, fail_key in CAVEAT_KINDS:
        if col not in report.case_flags.columns:
            continue
        flags = report.case_flags[col].to_numpy(dtype=bool)
        n = int((flags & mask).sum())
        share = n / n_group if n_group else float("nan")
        if not n_group or share <= min_share:
            continue
        status = _status(share, float(th[warn_key]), float(th[fail_key]))
        out.append(
            Caveat(
                id=kind,
                n=n,
                n_group=n_group,
                share=float(share),
                status=status,
                text=caveat_text(kind, share, items=items, window_end=end, closure_label=closure_label),
                window_end=end,
            )
        )
    return out


def caveats_by(report: ReadinessReport, by: str | Sequence[str]) -> pd.DataFrame:
    """Caveat shares for every slice of a slicing at once: ``n_cases`` and one
    ``<kind>_share`` column per available caveat kind, indexed by ``by``."""
    if report.case_flags is None or report.cases is None:
        raise NormError("the readiness report carries no per-case flags")
    by_l = keys(by)
    frame = report.cases.reindex(report.case_flags.index)
    share_cols = []
    for kind, col, _w, _f in CAVEAT_KINDS:
        if col in report.case_flags.columns:
            frame[f"{kind}_share"] = report.case_flags[col].to_numpy(dtype=float)
            share_cols.append(f"{kind}_share")
    if any(c not in frame.columns for c in by_l):
        frame = frame.reset_index()
    missing = [c for c in by_l if c not in frame.columns]
    if missing:
        raise NormError(f"slice columns not in the case table: {missing}")
    g = frame.groupby(by_l, dropna=False, observed=True, sort=True)
    out = g.size().rename("n_cases").to_frame()
    for c in share_cols:
        out[c] = g[c].mean()
    out.attrs["window_end"] = report.summary.get("window_end")
    return out


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
    window_end: Any = None,
    window_q: float = 0.001,
    period: str = "M",
    reference_period: str | None = None,
    group_col: str | None = None,
    document_col: str | None = None,
    asymmetry_pairs: Sequence[tuple[str, str]] | None = None,
    k: int = 10,
    items: str = "cases",
    closure_label: str = "closure",
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
    window_end, window_q
        Override the window end, or the quantile of
        :meth:`wise.EventLog.observation_window` (the default source; see
        the module docstring for the resolution order).
    period, reference_period
        Period alias for the vocabulary and frequency drift, and an
        optional reference period for the vocabulary drift.
    group_col
        Grouping attribute for exposure sanity (default: the first
        low-cardinality case attribute).
    document_col
        Event column naming the governance unit (e.g. the purchasing
        document) for :func:`wise.cross_case_replication`; skipped when
        omitted.
    asymmetry_pairs
        ``(setting, releasing)`` label pairs for the logging-asymmetry
        check; detected from the labels when omitted.
    k
        Number of top slices inspected by the per-slice checks.
    items, closure_label
        Words used in the plain caveat sentences ("purchase order items",
        "clearing").
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
    notes: list[str] = []
    with warnings.catch_warnings(record=True) as wlist:
        warnings.simplefilter("always")
        checks: dict[str, dict[str, Any]] = {}
        sent = _sentinel_dates(log, th)
        checks["sentinel_dates"] = sent
        end, end_source = _resolve_window_end(log, sent, window_end, window_q, th, notes)
        checks["timestamp_concentration"] = _timestamp_concentration(log, th)
        checks["duplicate_events"] = _duplicate_events(log, th)
        checks["timestamp_precision"] = _timestamp_precision(log, norm, th)
        checks["vocabulary_drift"] = _vocabulary_drift(log, norm, period, reference_period, th)
        checks["frequency_drift"] = _frequency_drift(log, end, period, window, th)
        checks["logging_asymmetry"] = _logging_asymmetry(log, norm, asymmetry_pairs, th)
        checks["exposure_sanity"] = _exposure_sanity(log, group_col, th)
        checks["window_edge_share"] = _window_edge_share(log, norm, end, result, by_l, view, k, th)
        checks["right_censoring"] = _right_censoring(log, norm, end, closure, opened_by, window, result, by_l, view, gamma, k, th)
        checks["replication"] = _replication(log, result, by_l, view, gamma, k, document_col, th)
    caught.extend(str(w.message) for w in wlist)
    caught.extend(notes)

    labels = {
        "sentinel_dates": ("share of far-out timestamps", th["sentinel_share_warn"], th["sentinel_share_fail"]),
        "timestamp_concentration": ("share of events on the busiest timestamp", th["concentration_share_warn"], np.nan),
        "duplicate_events": (
            "share of events duplicating an earlier (case, activity, timestamp)",
            th["duplicate_share_warn"],
            th["duplicate_share_fail"],
        ),
        "timestamp_precision": (
            "largest minority precision share within an activity",
            th["precision_mix_low"],
            th["precision_mix_fail"],
        ),
        "vocabulary_drift": ("share of events under new labels (or max JSD)", th["drift_jsd_warn"], th["drift_label_share_fail"]),
        "frequency_drift": (
            "largest step of an activity's share of cases between periods",
            th["frequency_step_warn"],
            th["frequency_step_fail"],
        ),
        "logging_asymmetry": (
            "max share of cases with a release but no logged setting event",
            th["asymmetry_share_warn"],
            th["asymmetry_share_fail"],
        ),
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
                "window_end": end,
                "evidence": c["evidence"],
            }
        )
        if c.get("detail") is not None:
            evidence[name] = c["detail"]
        if c.get("slices") is not None:
            evidence[f"{name}__slices"] = c["slices"]
        if c.get("periods") is not None:
            evidence[f"{name}__periods"] = c["periods"]
    table = pd.DataFrame(rows).set_index("check")
    overall = _worst(*table["status"].tolist())

    # per-case flags behind the caveats
    flags: dict[str, pd.Series] = {}
    if checks["right_censoring"].get("censored") is not None:
        flags["censored"] = checks["right_censoring"]["censored"].reindex(log.case_ids, fill_value=False).astype(bool)
    if checks["replication"].get("per_case") is not None:
        flags["replicated"] = checks["replication"]["per_case"].reindex(log.case_ids, fill_value=False).astype(bool)
    if checks["duplicate_events"].get("per_case") is not None:
        flags["duplicate"] = checks["duplicate_events"]["per_case"]
    if sent.get("far_mask") is not None:
        flags["sentinel"] = _case_any(log, sent["far_mask"])
    if checks["window_edge_share"].get("per_case") is not None:
        flags["window_edge"] = checks["window_edge_share"]["per_case"]
    case_flags = pd.DataFrame(flags, index=log.case_ids)
    cases = log.cases[[c for c in log.case_attributes if c in log.cases.columns]].copy()

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
        slices["library_reading"] = slices["reading"]
        slices["caveat"] = ""
        if "censored_share" in slices.columns:
            heavy = slices["censored_share"].fillna(0.0) >= th["censored_share_fail"]
            for key in slices.index[heavy]:
                text = caveat_text(
                    "censoring",
                    float(slices.loc[key, "censored_share"]),
                    items=items,
                    window_end=end,
                    closure_label=closure_label,
                )
                slices.loc[key, "caveat"] = text
                lib = str(slices.loc[key, "library_reading"])
                slices.loc[key, "reading"] = text if lib == "stable signal" else f"{lib}; {text}"
        slices.attrs["window_end"] = str(end)

    counts = table["status"].value_counts().to_dict()
    summary: dict[str, Any] = {
        "status": overall,
        "n_fail": int(counts.get("fail", 0)),
        "n_warn": int(counts.get("warn", 0)),
        "n_pass": int(counts.get("pass", 0)),
        "n_skipped": int(counts.get("skipped", 0)),
        "failed": list(table.index[table["status"] == "fail"]),
        "warned": list(table.index[table["status"] == "warn"]),
        "window_end": end,
        "window_end_source": end_source,
        "window_end_used": str(end),
        "closure": checks["right_censoring"].get("closure"),
        "n_events": len(log.events),
        "n_cases": len(log),
        "case_flags": list(case_flags.columns),
        "thresholds": th,
        "library_warnings": caught,
        "runtime_s": time.perf_counter() - t0,
    }
    readings = [
        f"Readiness: {overall} — {summary['n_fail']} checks fail ({', '.join(summary['failed']) or 'none'}), "
        f"{summary['n_warn']} warn ({', '.join(summary['warned']) or 'none'}), {summary['n_pass']} pass, {summary['n_skipped']} skipped; "
        f"window end {end.date()} from the {end_source}. "
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
            "window_end": str(end),
            "window_end_source": end_source,
            "window_q": float(window_q),
            "period": period,
            "reference_period": reference_period,
            "group_col": group_col,
            "document_col": document_col,
            "asymmetry_pairs": [list(p) for p in asymmetry_pairs] if asymmetry_pairs is not None else None,
            "k": int(k),
            "thresholds": th,
        },
        log_fingerprint=log_fingerprint(log),
        norm_fingerprint=norm.fingerprint() if norm is not None else None,
        warnings=caught,
        runtime_s=summary["runtime_s"],
    )
    return ReadinessReport(
        table=table,
        summary=summary,
        record=rec,
        readings=tuple(readings),
        status=overall,
        evidence=evidence,
        slices=slices,
        case_flags=case_flags,
        cases=cases,
    )


__all__ = [
    "CAVEAT_KINDS",
    "DEFAULT_THRESHOLDS",
    "READINESS_VERSION",
    "SETTING_RELEASING_VERBS",
    "Caveat",
    "ReadinessReport",
    "activity_frequency_drift",
    "activity_pairs",
    "caveat_text",
    "caveats_by",
    "caveats_for_slice",
    "frequency_drift_summary",
    "logging_asymmetry",
    "readiness",
    "vocabulary_drift",
]
