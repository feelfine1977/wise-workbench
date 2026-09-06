"""Headroom under the norm and weight what-ifs from cached violations.

Headroom answers "how much of this slice's priority is attributable to
constraint ``c`` *under the norm*": if every violation of ``c`` in the
slice were removed, with everything else — applicability, effective
weights, the baseline ``μ̄`` — held fixed, the slice mean would rise by
exactly ``mean_s(π_c)`` (the mean effective penalty of ``c`` in the slice)
and the Priority Index would fall by ``min(PI_s, v_s · mean_s(π_c))``.
The quantity is exact and additive over constraints
(``Σ_c mean_s(π_c) = 1 − μ_s``); it is not a prediction of what an
intervention would achieve.

:func:`rescore_view` recomputes case scores for another view (or another
violation matrix with the same evaluability pattern) from the cached
``V`` with the library's own effective-weight rule, so weight what-ifs do
not re-evaluate any constraint.
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

from ._common import fmt, index_label, keys, pct, resolve_view, slice_label, slice_mask
from .provenance import AnalyticResult, record, result_fingerprints

HEADROOM_VERSION = "1"
WHATIF_VERSION = "1"


@dataclass(frozen=True)
class HeadroomTable(AnalyticResult):
    """Headroom per constraint for one slice (``table``) with the slice facts in ``summary``."""

    view: str


@dataclass(frozen=True)
class WhatIfResult(AnalyticResult):
    """Backlog before and after a change of view weights (``table`` per slice)."""

    view: str
    frame: pd.DataFrame


# ----------------------------------------------------------------------------- rescoring
def _as_view(result: wise.ScoreResult, weights: wise.View | Mapping[str, float] | str, name: str | None) -> wise.View:
    norm = result.norm
    if isinstance(weights, wise.View):
        return (
            weights if name is None else wise.View(name, weights.layer_weights, weights.constraint_weights, weights.description)
        )
    if isinstance(weights, str):
        v = norm.get_view(weights)
        return v if name is None else wise.View(name, v.layer_weights, v.constraint_weights, v.description)
    w = {str(k): float(v) for k, v in dict(weights).items()}
    cids, lids = set(norm.constraint_ids), set(norm.layer_ids)
    if set(w) <= cids:
        return wise.View(name or "whatif", constraint_weights=w)
    if set(w) <= lids:
        return wise.View(name or "whatif", layer_weights=w)
    raise NormError(f"weights must map constraint ids {sorted(cids)} or layer ids {sorted(lids)}; got {sorted(w)}")


def rescore_view(
    result: wise.ScoreResult,
    weights: wise.View | Mapping[str, float] | str,
    *,
    name: str | None = None,
    violations: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Per-case frame ``[case attributes, score, contrib__<layer>]`` for a view
    computed from the cached violation matrix.

    ``weights`` is a :class:`wise.View`, a mapping of constraint (or layer)
    weights, or the name of an existing view. ``violations`` may replace
    ``result.violations`` when it has the same evaluability (NaN) pattern —
    e.g. after re-evaluating one constraint with other thresholds. The
    effective weights come from :meth:`wise.ScoreResult.effective_weights`
    on a result assembled around the new view, so the library's scoring
    mode and applicability rules apply unchanged.
    """
    view = _as_view(result, weights, name)
    norm2 = result.norm.replace(views=(*(v for v in result.norm.views if v.name != view.name), view))
    V = (
        result.violations
        if violations is None
        else violations.reindex(index=result.violations.index, columns=result.violations.columns)
    )
    w = norm2.weight_vector(view.name).to_numpy(dtype=float)
    shell = wise.ScoreResult(
        norm=norm2,
        cases=result.cases,
        violations=V,
        in_scope=result.in_scope,
        scores=pd.DataFrame(index=V.index),
        contributions={},
        mode=result.mode,
        norm_fingerprint=norm2.fingerprint(),
        _weights={view.name: w},
    )
    w_eff = shell.effective_weights(view.name).to_numpy(dtype=float)
    penalty = w_eff * V.fillna(0.0).to_numpy(dtype=float)
    unscored = w_eff.sum(axis=1) <= 0.0
    s = 1.0 - penalty.sum(axis=1)
    s[unscored] = np.nan
    cids = list(V.columns)
    onehot = np.array([[1.0 if norm2.layer_of[cid] == layer else 0.0 for layer in norm2.layer_ids] for cid in cids])
    contrib = penalty @ onehot
    contrib[unscored, :] = np.nan
    extra = pd.DataFrame(contrib, index=V.index, columns=[f"contrib__{layer}" for layer in norm2.layer_ids])
    extra.insert(0, "score", s)
    out = pd.concat([result.cases, extra], axis=1)
    out.attrs.update({"view": view.name, "mode": result.mode})
    return out


# ----------------------------------------------------------------------------- headroom
def _volume(frame: pd.DataFrame, volume: str) -> np.ndarray:
    if volume == "cases":
        return np.ones(len(frame))
    col = "exposure" if volume == "exposure" else volume
    if col not in frame.columns:
        raise NormError(f"volume column {col!r} not in frame")
    return frame[col].to_numpy(dtype=float)


def headroom(
    result: wise.ScoreResult,
    view: str | None = None,
    where: Mapping[str, Any] | pd.Series | np.ndarray | None = None,
    *,
    gamma: float = 0.0,
    volume: str = "cases",
    baseline: float | None = None,
) -> HeadroomTable:
    """Exact score gain per constraint if its violations in the slice were removed.

    Parameters
    ----------
    result, view
        The score result and view (``None`` when the norm has one view).
    where
        The slice: ``{attribute: value}`` or a boolean mask over cases.
    gamma, volume, baseline
        As in :func:`wise.prioritize`; the baseline defaults to the global
        mean over scored cases and is held fixed in the what-if.

    Returns
    -------
    :class:`HeadroomTable` — one row per constraint with ``mean_penalty``
    (= ``headroom_score``, the exact rise of the slice mean),
    ``headroom_PI`` (``v_s · mean_s(π_c)``), ``stable_PI_after``,
    ``PI_reduction`` and ``share_of_PI``, plus the violation facts.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    frame = result.frame(view)
    scored = frame["score"].notna()
    mask = slice_mask(result.cases, where) & scored
    n_s = int(mask.sum())
    if n_s == 0:
        raise NotScoredError("the slice contains no scored case")
    mu_bar = float(frame.loc[scored, "score"].mean()) if baseline is None else float(baseline)
    mu_s = float(frame.loc[mask, "score"].mean())
    v = _volume(frame, volume)
    v_s = float(v[mask.to_numpy()].sum())
    shrink = n_s / (n_s + float(gamma)) if gamma > 0 else 1.0
    gap = max(mu_bar - mu_s, 0.0)
    PI = v_s * gap
    stable_gap = shrink * gap
    stable_PI = v_s * stable_gap

    pen = result.penalties(view)[mask]
    V = result.violations[mask]
    S = result.in_scope[mask]
    rows = []
    for nc in result.norm.constraints:
        mean_pen = float(pen[nc.id].mean())
        H = v_s * mean_pen
        gap_after = max(mu_bar - (mu_s + mean_pen), 0.0)
        stable_PI_after = v_s * shrink * gap_after
        ev = V[nc.id].notna()
        rows.append(
            {
                "constraint": nc.id,
                "layer": nc.layer,
                "type": nc.constraint.type,
                "description": nc.description,
                "mean_penalty": mean_pen,
                "headroom_score": mean_pen,
                "headroom_PI": H,
                "stable_PI_after": stable_PI_after,
                "PI_reduction": stable_PI - stable_PI_after,
                "share_of_PI": (stable_PI - stable_PI_after) / stable_PI if stable_PI > 0 else np.nan,
                "n_evaluated": int(ev.sum()),
                "share_in_scope": float(S[nc.id].mean()),
                "share_evaluated": float(ev.mean()),
                "share_violated": float((V[nc.id][ev] > 0).mean()) if ev.any() else np.nan,
                "mean_violation": float(V[nc.id][ev].mean()) if ev.any() else np.nan,
            }
        )
    table = (
        pd.DataFrame(rows)
        .set_index("constraint")
        .sort_values(["headroom_score", "share_violated"], ascending=False, kind="mergesort")
    )
    sum_headroom = float(table["headroom_score"].sum())
    identity_error = abs(sum_headroom - (1.0 - mu_s))
    label = slice_label(where)
    summary: dict[str, Any] = {
        "slice": label,
        "view": view,
        "n_slice": n_s,
        "n_scored": int(scored.sum()),
        "mean_score": mu_s,
        "global_mean": mu_bar,
        "baseline": "fixed" if baseline is not None else "global mean (held fixed)",
        "gap": gap,
        "PI": PI,
        "stable_gap": stable_gap,
        "stable_PI": stable_PI,
        "gamma": float(gamma),
        "volume": volume,
        "volume_s": v_s,
        "sum_headroom_score": sum_headroom,
        "one_minus_mean": 1.0 - mu_s,
        "identity_error": identity_error,
        "top_constraint": str(table.index[0]) if len(table) else None,
    }
    readings = [
        f"Slice {label} (n = {n_s} scored cases) has mean score {fmt(mu_s)} under {view} against a baseline of {fmt(mu_bar)}; "
        f"stabilised PI {fmt(stable_PI)} (γ = {fmt(gamma, 1)}). Headroom is exact under the norm with the baseline held fixed; "
        f"per-constraint headroom sums to 1 − μ_s = {fmt(1.0 - mu_s)} (identity error {identity_error:.1e})."
    ]
    for cid, row in table.head(3).iterrows():
        if row["headroom_score"] <= 0:
            continue
        readings.append(
            f"Under the norm, if every violation of {cid} ({row['description'] or row['type']}) in slice {label} were removed, "
            f"the slice mean would rise by {fmt(row['headroom_score'])} ({fmt(mu_s)} → {fmt(mu_s + row['headroom_score'])}) "
            f"and its stabilised PI would fall by at most {pct(row['share_of_PI'])} "
            f"({fmt(stable_PI)} → {fmt(row['stable_PI_after'])}); {cid} is violated in {pct(row['share_violated'])} of "
            f"{int(row['n_evaluated'])} evaluated cases."
        )
    lf, nf = result_fingerprints(result)
    rec = record(
        "headroom",
        HEADROOM_VERSION,
        table=table,
        params={
            "view": view,
            "where": slice_label(where),
            "gamma": float(gamma),
            "volume": volume,
            "baseline": baseline,
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        runtime_s=time.perf_counter() - t0,
    )
    return HeadroomTable(table=table, summary=summary, record=rec, readings=tuple(readings), view=view)


def headroom_by(
    result: wise.ScoreResult,
    by: str | Sequence[str],
    view: str | None = None,
    *,
    gamma: float = 0.0,
    volume: str = "cases",
    baseline: float | None = None,
) -> pd.DataFrame:
    """Headroom for every slice of a backlog at once: a long table indexed by
    ``(*by, constraint)`` with ``mean_penalty``, ``headroom_PI``,
    ``stable_PI``, ``stable_PI_after`` and ``PI_reduction``."""
    view = resolve_view(result, view)
    by = keys(by)
    backlog = wise.prioritize(result, by, view=view, gamma=gamma, volume=volume, baseline=baseline)
    frame = result.frame(view)
    if any(c not in frame.columns for c in by):
        frame = frame.reset_index()
    scored = frame["score"].notna().to_numpy()
    pen = result.penalties(view)[scored]
    pen_by = (
        pen.assign(**{c: frame.loc[scored, c].to_numpy() for c in by}).groupby(by, dropna=False, observed=True, sort=True).mean()
    )
    long = pen_by.stack().rename("mean_penalty").to_frame()
    long.index = long.index.set_names([*by, "constraint"])
    keys_only = long.index.droplevel("constraint")
    b = backlog.reindex(keys_only)
    n = b["n_cases"].to_numpy(dtype=float)
    shrink = n / (n + float(gamma)) if gamma > 0 else np.ones(len(n))
    mu_bar = float(backlog.attrs["baseline"])
    long["stable_PI"] = b["stable_PI"].to_numpy()
    gap_after = np.clip(mu_bar - (b["mean_score"].to_numpy() + long["mean_penalty"].to_numpy()), 0.0, None)
    long["headroom_PI"] = b["volume"].to_numpy() * long["mean_penalty"].to_numpy()
    long["stable_PI_after"] = b["volume"].to_numpy() * shrink * gap_after
    long["PI_reduction"] = long["stable_PI"] - long["stable_PI_after"]
    long.attrs.update({"view": view, "gamma": float(gamma), "baseline": mu_bar, "volume": volume, "by": by})
    return long


# ----------------------------------------------------------------------------- weight what-if
def whatif_weights(
    result: wise.ScoreResult,
    weights: wise.View | Mapping[str, float] | str,
    by: str | Sequence[str],
    view: str | None = None,
    *,
    gamma: float = 0.0,
    volume: str = "cases",
    baseline: float | None = None,
    k: int = 10,
    name: str | None = None,
) -> WhatIfResult:
    """The backlog under another weighting of the same constraints, from cached violations.

    ``view`` is the reference view; ``weights`` the alternative (a
    :class:`wise.View`, a mapping of constraint or layer weights, or a view
    name). Returns per slice the rank, stabilised gap and PI before and
    after, and in ``summary`` the top-``k`` Jaccard overlap and the change
    of the global mean.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    by = keys(by)
    before = wise.prioritize(result, by, view=view, gamma=gamma, volume=volume, baseline=baseline)
    frame = rescore_view(result, weights, name=name)
    after_frame = frame.reset_index() if any(c not in frame.columns for c in by) else frame
    after = wise.prioritize(after_frame, by, gamma=gamma, volume=volume, baseline=baseline, score_col="score")
    cols = ["n_cases", "mean_score", "stable_gap", "stable_PI"]
    b = before[cols].copy()
    b["rank"] = np.arange(1, len(b) + 1)
    a = after[cols].copy()
    a["rank"] = np.arange(1, len(a) + 1)
    table = b.add_suffix("_before").join(a.add_suffix("_after"), how="outer")
    table["rank_shift"] = table["rank_before"] - table["rank_after"]
    table = table.sort_values(["stable_PI_after", "n_cases_after"], ascending=[False, False], kind="mergesort")
    overlap = wise.top_k_overlap(before, after, k=k)
    view_name = str(frame.attrs["view"])
    mean_before = float(before.attrs["baseline"])
    mean_after = float(after.attrs["baseline"])
    summary: dict[str, Any] = {
        "view_before": view,
        "view_after": view_name,
        "by": by,
        "gamma": float(gamma),
        "volume": volume,
        "k": int(k),
        "top_k_overlap": overlap,
        "global_mean_before": mean_before,
        "global_mean_after": mean_after,
        "n_slices": len(table),
        "n_rank_changes": int((table["rank_shift"].fillna(0) != 0).sum()),
        "weights_before": dict(result.norm.raw_weights(view)),
        "weights_after": dict(_as_view(result, weights, name).weights),
    }
    readings = [
        f"Under the norm, re-weighting {view} to {view_name} moves the global mean from {fmt(mean_before)} to {fmt(mean_after)}; "
        f"the top-{k} sets of the two backlogs overlap with Jaccard {fmt(overlap, 2)} and {summary['n_rank_changes']} of "
        f"{summary['n_slices']} slices change rank. Applicability and violations are unchanged; only the weights differ."
    ]
    for key, row in table.head(3).iterrows():
        readings.append(
            f"Slice {index_label(key, by)}: rank {int(row['rank_before']) if pd.notna(row['rank_before']) else 'n/a'} → "
            f"{int(row['rank_after']) if pd.notna(row['rank_after']) else 'n/a'}, stabilised PI {fmt(row['stable_PI_before'])} → "
            f"{fmt(row['stable_PI_after'])}."
        )
    lf, nf = result_fingerprints(result)
    rec = record(
        "whatif_weights",
        WHATIF_VERSION,
        table=table,
        params={
            "view": view,
            "weights": summary["weights_after"],
            "by": by,
            "gamma": float(gamma),
            "volume": volume,
            "baseline": baseline,
            "k": int(k),
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        runtime_s=time.perf_counter() - t0,
    )
    return WhatIfResult(table=table, summary=summary, record=rec, readings=tuple(readings), view=view_name, frame=frame)


__all__ = [
    "HEADROOM_VERSION",
    "WHATIF_VERSION",
    "HeadroomTable",
    "WhatIfResult",
    "headroom",
    "headroom_by",
    "rescore_view",
    "whatif_weights",
]
