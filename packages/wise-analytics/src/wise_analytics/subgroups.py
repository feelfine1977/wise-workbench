"""Sub-groups inside a group: penalty mass by attribute value.

The reason screen's sub-group block (RG-8, R1-28) answers "where inside
this group does the shortfall sit": by flow type, item type, vendor,
start quarter. :func:`subgroups` computes, for one slice and one view, the
library's penalty mass (:func:`wise.penalty_mass`: the sum of ``1 − S``
over the slice's scored cases) by the values of each requested attribute,
with the share, the cumulative share and the rank of every value, and how
many values carry 80 % of the mass.

A period attribute derived from the case start (``period="Q"`` gives the
start quarter) carries a **censoring caveat**: cases that started shortly
before the window end have not had time to reach later steps, and open
lags are skipped, not penalised, so the mean penalty of the last periods
is not comparable with earlier ones. The caveat is printed for every period
whose censored share reaches ``caveat_share`` or which ends within the
censoring ``window`` of the window end — the same window end and the same
:func:`wise.right_censored` definition as the readiness gate.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NormError, NotScoredError

from ._common import fmt, pct, resolve_view, slice_label, slice_mask
from .provenance import AnalyticResult, record, result_fingerprints

SUBGROUPS_VERSION = "1"


@dataclass(frozen=True)
class SubgroupTable(AnalyticResult):
    """Penalty mass by attribute value inside one slice (``table`` indexed by ``(attribute, value)``)."""

    view: str
    slice: str
    attributes: tuple[str, ...]


def _naive(ts: pd.Series) -> pd.DatetimeIndex:
    idx = pd.DatetimeIndex(ts)
    return idx.tz_convert("UTC").tz_localize(None) if idx.tz is not None else idx


def _mass_by(values: pd.Series, penalty: np.ndarray) -> pd.DataFrame:
    """The library's penalty-mass table for one grouping (same formula and order as :func:`wise.penalty_mass`)."""
    d = pd.DataFrame({"value": values.to_numpy(), "_penalty": penalty})
    g = d.groupby("value", dropna=False, observed=True, sort=True)
    out = pd.DataFrame({"n_cases": g.size(), "penalty_mass": g["_penalty"].sum(), "mean_penalty": g["_penalty"].mean()})
    out = out.sort_index().sort_values(["penalty_mass", "n_cases"], ascending=False, kind="mergesort")
    total = float(out["penalty_mass"].sum())
    out["share"] = out["penalty_mass"] / total if total > 0 else 0.0
    out["cum_share"] = out["share"].cumsum()
    out["rank"] = np.arange(1, len(out) + 1)
    return out


def _values_for(cum_share: pd.Series, target: float) -> int:
    arr = cum_share.to_numpy(dtype=float)
    if len(arr) == 0 or not np.isfinite(arr).any():
        return 0
    return min(int(np.searchsorted(arr, target - 1e-12)) + 1, len(arr))


def subgroups(
    result: wise.ScoreResult,
    where: Mapping[str, Any] | pd.Series | np.ndarray | None,
    attributes: str | Sequence[str],
    *,
    view: str | None = None,
    period: str | None = None,
    censored: pd.Series | None = None,
    closure: str | Sequence[str] | None = None,
    opened_by: str | Sequence[str] | None = None,
    window: str | pd.Timedelta = "60D",
    window_end: Any = None,
    caveat_share: float = 0.20,
    top: int | None = None,
    items: str = "cases",
    closure_label: str = "closure",
) -> SubgroupTable:
    """Penalty mass by attribute value inside a slice.

    Parameters
    ----------
    result, view
        The score result and view (``None`` when the norm has one view).
    where
        The slice: ``{attribute: value}`` (AND) or a boolean mask over cases.
    attributes
        Case attributes to break the slice down by (each must be a column
        of ``result.cases``).
    period
        A pandas period alias (``"Q"``, ``"M"``) adds a start-period
        attribute ``start_<period>`` derived from the first timestamp of
        every case (needs the log attached to the result).
    censored, closure, opened_by, window, window_end
        The per-case censoring flags for the period caveat: pass the
        ``censored`` column of a readiness report's ``case_flags``, or the
        closure activities so that :func:`wise.right_censored` is applied
        with ``window_end`` (default: the log's explicit window, else the
        robust observation-window end).
    caveat_share
        Censored share of a period from which its caveat is printed.
    top
        Keep at most ``top`` values per attribute (shares stay relative
        to the whole mass; ``n_values`` in the summary counts all of them).
    items, closure_label
        Words for the plain caveat sentence.

    Returns
    -------
    :class:`SubgroupTable` — ``table`` indexed by ``(attribute, value)`` with
    ``n_cases``, ``penalty_mass``, ``mean_penalty``, ``share``,
    ``cum_share``, ``rank``, ``censored_share``, ``partial_period`` and
    ``caveat``; ``summary`` per attribute the number of values and how
    many carry 80 % of the mass; ``readings`` one sentence per attribute
    and one per period caveat.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    attrs = [attributes] if isinstance(attributes, str) else list(attributes)
    scores = result.scores[view]
    scored = scores.notna()
    mask = slice_mask(result.cases, where) & scored
    n_s = int(mask.sum())
    if n_s == 0:
        raise NotScoredError("the slice contains no scored case")
    missing = [a for a in attrs if a not in result.cases.columns]
    if missing:
        raise NormError(f"unknown case attributes {missing}; known: {list(result.cases.columns)}")
    penalty = 1.0 - scores[mask].to_numpy(dtype=float)
    label = slice_label(where)
    warn: list[str] = []

    parts: dict[str, pd.DataFrame] = {}
    for a in attrs:
        pm = wise.penalty_mass(result, view, by=a, where=mask)
        pm.index = pm.index.rename("value")
        parts[a] = pm

    end: pd.Timestamp | None = None
    period_attr: str | None = None
    if period is not None:
        log = result.log
        if log is None:
            raise NormError("period sub-groups need the event log attached to the result")
        starts = _naive(log.cases["first_ts"]).to_series(index=log.case_ids)
        per = starts.dt.to_period(period).astype(str).reindex(result.cases.index)
        period_attr = f"start_{period}"
        pm = _mass_by(per[mask], penalty)
        pm.index = pm.index.rename("value")
        if window_end is not None:
            end = pd.Timestamp(log._to_ts(window_end))
        elif log.window is not None and log.window[1] is not None:
            end = pd.Timestamp(log.window[1])
        else:
            end = pd.Timestamp(log.observation_window()[1])
        end_naive = _naive(pd.Series([end]))[0]
        win = pd.Timedelta(window)
        flags: pd.Series | None = None
        if censored is not None:
            flags = censored.reindex(result.cases.index, fill_value=False).astype(bool)
        elif closure is not None:
            flags = wise.right_censored(log, closure, window=win, opened_by=opened_by, window_end=end).reindex(
                result.cases.index, fill_value=False
            )
        else:
            warn.append("no censoring flags or closure activities given; the period caveat rests on the window edge alone")
        cs = pd.Series(np.nan, index=pm.index, dtype=float)
        if flags is not None:
            cs = (
                pd.Series(flags[mask].to_numpy(dtype=float), index=per[mask].to_numpy()).groupby(level=0).mean().reindex(pm.index)
            )
        pm["censored_share"] = cs
        pm["partial_period"] = [bool(pd.Period(str(v), freq=period).end_time > end_naive - win) for v in pm.index]
        texts = []
        for _v, row in pm.iterrows():
            heavy = bool(np.isfinite(row["censored_share"]) and row["censored_share"] >= caveat_share)
            if heavy:
                texts.append(
                    f"{pct(row['censored_share'])} of its {items} still open at the end of the data ({end.date()}); open lags are "
                    f"skipped, not penalised, so its mean penalty is not comparable with earlier periods (late {closure_label} cannot be judged)"
                )
            elif row["partial_period"]:
                texts.append(
                    f"the period ends within {window} of the window end ({end.date()}): its {items} may not have reached later steps, "
                    "so its mean penalty is not comparable with earlier periods"
                )
            else:
                texts.append("")
        pm["caveat"] = texts
        parts[period_attr] = pm

    frames = []
    for a, pm in parts.items():
        f = pm.copy()
        if "censored_share" not in f.columns:
            f["censored_share"] = np.nan
            f["partial_period"] = False
            f["caveat"] = ""
        if top is not None:
            f = f.head(int(top))
        f.insert(0, "attribute", a)
        frames.append(f.reset_index())
    table = pd.concat(frames, ignore_index=True).set_index(["attribute", "value"])
    table = table[
        ["n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "rank", "censored_share", "partial_period", "caveat"]
    ]

    per_attr: dict[str, dict[str, Any]] = {}
    readings = []
    total_mass = float(penalty.sum())
    for a, pm in parts.items():
        k80 = _values_for(pm["cum_share"], 0.8)
        topv = pm.index[0] if len(pm) else None
        per_attr[a] = {
            "n_values": len(pm),
            "values_for_80pct": k80,
            "top_value": topv,
            "top_share": float(pm["share"].iloc[0]) if len(pm) else np.nan,
            "top_n_cases": int(pm["n_cases"].iloc[0]) if len(pm) else 0,
            "n_caveats": int((pm["caveat"] != "").sum()) if "caveat" in pm.columns else 0,
        }
        if len(pm):
            readings.append(
                f"Inside {label} under {view}, {a} = {topv} carries {pct(pm['share'].iloc[0])} of the penalty mass "
                f"({int(pm['n_cases'].iloc[0])} of {n_s} {items}, mean penalty {fmt(pm['mean_penalty'].iloc[0])}); "
                f"{k80} of {len(pm)} values carry 80 %."
            )
        if "caveat" in pm.columns:
            for v, row in pm[pm["caveat"] != ""].iterrows():
                readings.append(
                    f"{a} = {v} (n = {int(row['n_cases'])}, mean penalty {fmt(row['mean_penalty'])}): {row['caveat']}."
                )
    summary: dict[str, Any] = {
        "slice": label,
        "view": view,
        "n_slice": n_s,
        "penalty_mass": total_mass,
        "mean_penalty": total_mass / n_s,
        "attributes": list(parts),
        "period_attribute": period_attr,
        "window_end": end,
        "window": str(window),
        "caveat_share": float(caveat_share),
        "per_attribute": per_attr,
        "runtime_s": time.perf_counter() - t0,
    }
    lf, nf = result_fingerprints(result)
    rec = record(
        "subgroups",
        SUBGROUPS_VERSION,
        table=table,
        params={
            "view": view,
            "where": label,
            "attributes": attrs,
            "period": period,
            "closure": list(closure) if isinstance(closure, list | tuple) else closure,
            "opened_by": opened_by,
            "window": str(window),
            "window_end": str(end) if end is not None else None,
            "caveat_share": float(caveat_share),
            "top": top,
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        warnings=warn,
        runtime_s=summary["runtime_s"],
    )
    return SubgroupTable(
        table=table, summary=summary, record=rec, readings=tuple(readings), view=view, slice=label, attributes=tuple(parts)
    )


__all__ = ["SUBGROUPS_VERSION", "SubgroupTable", "subgroups"]
