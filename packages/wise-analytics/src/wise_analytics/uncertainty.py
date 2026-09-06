"""Uncertainty of the backlog: case bootstrap and a sensitivity envelope.

:func:`bootstrap_backlog` resamples cases (or clusters of cases) with
multinomial weights and recomputes, per replicate, the slice means, the
baseline, the gaps, the stabilised Priority Index and the ranks. It
reports percentile intervals, rank intervals, ``P(top-k)`` and a
stability badge per slice. The point estimates are those of
:func:`wise.prioritize`; nothing is re-scored.

:func:`sensitivity_envelope` re-ranks the backlog under a grid of
settings — the shrinkage constant ``γ``, scaled thresholds of every graded
constraint (one column re-evaluated with :func:`wise.evaluate_constraint`,
scores recomputed from the cached violations), and jittered view weights —
and reports how often each slice stays in the top-``k``. The envelope is a
set of settings, not a probability distribution.
"""

from __future__ import annotations

import dataclasses
import time
import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NormError, NotScoredError

from ._common import bootstrap_weights, fmt, index_label, keys, pct, resolve_view, slice_codes
from .provenance import AnalyticResult, record, result_fingerprints
from .whatif import rescore_view

BOOTSTRAP_VERSION = "1"
ENVELOPE_VERSION = "1"

STABILITY_RULE = (
    "Badge per slice, relative to the largest k reported (default 10): "
    "'insufficient_support' when the slice has fewer than min_support scored cases (insufficient support); otherwise let "
    "p = P(top-k) when the point estimate ranks the slice inside the top-k with positive stable PI, and "
    "p = 1 − P(top-k) when it ranks outside — the bootstrap share of replicates in which the slice keeps the "
    "position the point estimate gives it. 'stable' when p ≥ 0.8, 'fragile' when 0.5 ≤ p < 0.8, 'insufficient_support' when p < 0.5."
)


@dataclass(frozen=True)
class BacklogUncertainty(AnalyticResult):
    """Bootstrap intervals, rank intervals, ``P(top-k)`` and badges per slice."""

    view: str
    by: tuple[str, ...]
    draws: pd.DataFrame

    def stability_rule(self) -> str:
        return STABILITY_RULE


@dataclass(frozen=True)
class RankStability(AnalyticResult):
    """Rank range and top-``k`` membership of every slice across settings."""

    view: str
    by: tuple[str, ...]
    settings: pd.DataFrame


def _score_frame(result: wise.ScoreResult, view: str, by: Sequence[str]) -> pd.DataFrame:
    frame = result.frame(view)
    if any(c not in frame.columns for c in by):
        frame = frame.reset_index()
    missing = [c for c in by if c not in frame.columns]
    if missing:
        raise NormError(f"slice columns not in frame: {missing}")
    return frame


def _volume_values(frame: pd.DataFrame, volume: str) -> np.ndarray | None:
    if volume == "cases":
        return None
    col = "exposure" if volume == "exposure" else volume
    if col not in frame.columns:
        raise NormError(f"volume column {col!r} not in frame")
    return frame[col].to_numpy(dtype=float)


def _ranks(stable_PI: np.ndarray, cnt: np.ndarray) -> np.ndarray:
    """1-based rank per slice for each replicate row: stable PI desc, count desc, key order."""
    B, G = stable_PI.shape
    key = np.where(np.isnan(stable_PI), -np.inf, stable_PI)
    ranks = np.empty((B, G), dtype=np.int64)
    pos = np.arange(G)
    for r in range(B):
        order = np.lexsort((pos, -np.nan_to_num(cnt[r]), -key[r]))
        ranks[r, order] = np.arange(1, G + 1)
    return ranks


def bootstrap_backlog(
    result: wise.ScoreResult,
    by: str | Sequence[str],
    view: str | None = None,
    *,
    gamma: float = 0.0,
    volume: str = "cases",
    baseline: float | None = None,
    B: int = 200,
    cluster: str | None = None,
    k: int | Sequence[int] = (5, 10),
    seed: int = 0,
    ci: float = 0.90,
    min_support: int = 10,
    min_cases: int = 1,
) -> BacklogUncertainty:
    """Case (or cluster) bootstrap of a backlog.

    Parameters
    ----------
    result, by, view, gamma, volume, baseline, min_cases
        As in :func:`wise.prioritize`. With ``baseline=None`` the global
        mean is recomputed in every replicate; a fixed baseline is kept.
    B, seed
        Number of replicates and random seed (deterministic).
    cluster
        Case attribute naming the cluster (e.g. the purchasing document):
        cases of one cluster are resampled together.
    k
        Cutoffs for ``P(top-k)``; the badge uses the largest.
    ci
        Level of the central percentile intervals (0.90 → q05/q95).
    min_support
        Slices with fewer scored cases are badged ``insufficient_support``.

    Returns
    -------
    :class:`BacklogUncertainty` whose ``table`` (indexed like the backlog)
    holds the point estimates, ``rank``, the interval bounds
    ``<metric>_lo`` / ``<metric>_hi`` for ``gap``, ``stable_gap``, ``PI``
    and ``stable_PI``, ``rank_lo`` / ``rank_hi``, ``p_top<k>`` per cutoff,
    ``stability`` and ``stability_reason``; ``draws`` keeps the per-replicate
    stabilised PI (replicates × slices) for charts.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    by = keys(by)
    ks = tuple(sorted({int(x) for x in ([k] if isinstance(k, int) else k)}))
    if not ks or min(ks) < 1:
        raise NormError("k must contain positive integers")
    if B < 1:
        raise NormError("B must be >= 1")
    gamma = float(gamma)
    point = wise.prioritize(result, by, view=view, gamma=gamma, volume=volume, baseline=baseline, min_cases=min_cases)
    frame = _score_frame(result, view, by)
    d = frame[frame["score"].notna()]
    n = len(d)
    if n == 0:
        raise NotScoredError("no scored cases to bootstrap")
    S = d["score"].to_numpy(dtype=float)
    E = _volume_values(d, volume)
    codes, index = slice_codes(d, by)
    len(index)
    order = np.argsort(codes, kind="stable")
    sorted_codes = codes[order]
    starts = np.flatnonzero(np.r_[True, sorted_codes[1:] != sorted_codes[:-1]])
    S_sorted = S[order]
    E_sorted = E[order] if E is not None else None
    cluster_codes: np.ndarray | None = None
    if cluster is not None:
        if cluster in d.columns:
            cluster_codes = pd.factorize(d[cluster], use_na_sentinel=False)[0].astype(np.int64)
        elif cluster == d.index.name:
            cluster_codes = np.arange(n, dtype=np.int64)
        else:
            raise NormError(f"cluster attribute {cluster!r} not in the case table")

    rng = np.random.default_rng(seed)
    gaps, sgaps, pis, spis, ranks = [], [], [], [], []
    with np.errstate(divide="ignore", invalid="ignore"):
        for W in bootstrap_weights(rng, n, B, cluster=cluster_codes):
            Ws = W[:, order]
            cnt = np.add.reduceat(Ws, starts, axis=1)
            ssum = np.add.reduceat(Ws * S_sorted[None, :], starts, axis=1)
            mu_s = np.where(cnt > 0, ssum / np.where(cnt > 0, cnt, 1.0), np.nan)
            mu_bar = np.full(W.shape[0], float(baseline)) if baseline is not None else (W @ S) / W.sum(axis=1)
            vol = cnt if E_sorted is None else np.add.reduceat(Ws * E_sorted[None, :], starts, axis=1)
            gap = np.clip(mu_bar[:, None] - mu_s, 0.0, None)
            shrink = cnt / (cnt + gamma) if gamma > 0 else np.ones_like(cnt)
            sgap = shrink * gap
            gaps.append(gap)
            sgaps.append(sgap)
            pis.append(vol * gap)
            spi = vol * sgap
            spis.append(spi)
            ranks.append(_ranks(spi, cnt))
    gap_b = np.vstack(gaps)
    sgap_b = np.vstack(sgaps)
    pi_b = np.vstack(pis)
    spi_b = np.vstack(spis)
    rank_b = np.vstack(ranks).astype(float)

    lo_q, hi_q = 100.0 * (1.0 - ci) / 2.0, 100.0 * (1.0 - (1.0 - ci) / 2.0)
    stats = pd.DataFrame(index=index)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for name, arr in (("gap", gap_b), ("stable_gap", sgap_b), ("PI", pi_b), ("stable_PI", spi_b)):
            q = np.nanpercentile(arr, [lo_q, hi_q], axis=0)
            stats[f"{name}_lo"], stats[f"{name}_hi"] = q[0], q[1]
        q = np.nanpercentile(rank_b, [lo_q, hi_q], axis=0)
        stats["rank_lo"], stats["rank_hi"] = q[0], q[1]
    for kk in ks:
        stats[f"p_top{kk}"] = np.mean((rank_b <= kk) & (np.nan_to_num(spi_b) > 0), axis=0)
    stats["n_draws_present"] = np.sum(~np.isnan(gap_b), axis=0)

    cols = [
        c
        for c in ["n_cases", "volume", "exposure", "mean_score", "gap", "stable_gap", "PI", "stable_PI", "global_mean"]
        if c in point.columns
    ]
    table = point[cols].copy()
    table["rank"] = np.arange(1, len(table) + 1)
    table = table.join(stats.reindex(table.index))

    k_badge = max(ks)
    p_in = table[f"p_top{k_badge}"].to_numpy(dtype=float)
    in_top = (table["rank"].to_numpy() <= k_badge) & (table["stable_PI"].to_numpy() > 0)
    p_stay = np.where(in_top, p_in, 1.0 - p_in)
    n_cases = table["n_cases"].to_numpy()
    badge = np.where(p_stay >= 0.8, "stable", np.where(p_stay >= 0.5, "fragile", "insufficient_support")).astype(object)
    reason = np.array(
        [f"P(stays {'in' if t else 'out of'} top-{k_badge}) = {p:.2f}" for t, p in zip(in_top, p_stay)],
        dtype=object,
    )
    low = n_cases < int(min_support)
    badge[low] = "insufficient_support"
    reason[low] = [f"insufficient support: n = {int(c)} < {int(min_support)}" for c in n_cases[low]]
    table["stability"] = badge
    table["stability_reason"] = reason

    counts = table["stability"].value_counts().to_dict()
    runtime = time.perf_counter() - t0
    summary: dict[str, Any] = {
        "view": view,
        "by": by,
        "gamma": gamma,
        "volume": volume,
        "baseline": "fixed" if baseline is not None else "recomputed per replicate",
        "baseline_value": float(point.attrs["baseline"]),
        "B": int(B),
        "seed": int(seed),
        "ci": float(ci),
        "cluster": cluster,
        "n_clusters": int(cluster_codes.max()) + 1 if cluster_codes is not None else None,
        "k": list(ks),
        "k_badge": k_badge,
        "min_support": int(min_support),
        "n_scored": n,
        "n_slices": len(table),
        "badges": {b: int(counts.get(b, 0)) for b in ("stable", "fragile", "insufficient_support")},
        "rule": STABILITY_RULE,
        "runtime_s": runtime,
    }
    readings = [
        f"Backlog by {', '.join(by)} under {view}: {len(table)} slices from {n} scored cases; case bootstrap with B = {B}"
        f"{f' (clusters: {cluster})' if cluster else ''}, {pct(ci)} percentile intervals, baseline {summary['baseline']}. "
        f"Badges: {counts.get('stable', 0)} stable, {counts.get('fragile', 0)} fragile, {counts.get('insufficient_support', 0)} insufficient support "
        f"(rule: see stability_rule())."
    ]
    for key, row in table.head(k_badge).iterrows():
        if row["stable_PI"] <= 0:
            continue
        readings.append(
            f"Slice {index_label(key, by)} ranks #{int(row['rank'])} ({pct(ci)} rank range {int(row['rank_lo'])}–{int(row['rank_hi'])}, "
            f"P(top-{k_badge}) = {row[f'p_top{k_badge}']:.2f}, {row['stability']}): stabilised gap {fmt(row['stable_gap'], 4)} "
            f"({pct(ci)} interval {fmt(row['stable_gap_lo'], 4)}–{fmt(row['stable_gap_hi'], 4)}), stabilised PI {fmt(row['stable_PI'])} "
            f"({fmt(row['stable_PI_lo'])}–{fmt(row['stable_PI_hi'])}), n = {int(row['n_cases'])}."
        )
    warn = []
    if int(low.sum()):
        warn.append(f"{int(low.sum())} slices have fewer than {min_support} scored cases (badged insufficient support)")
    if cluster is None:
        warn.append(
            "case bootstrap assumes cases are exchangeable; pass cluster=<document attribute> when cases nest in documents"
        )
    lf, nf = result_fingerprints(result)
    rec = record(
        "bootstrap_backlog",
        BOOTSTRAP_VERSION,
        table=table,
        params={
            "by": by,
            "view": view,
            "gamma": gamma,
            "volume": volume,
            "baseline": baseline,
            "B": int(B),
            "cluster": cluster,
            "k": list(ks),
            "seed": int(seed),
            "ci": float(ci),
            "min_support": int(min_support),
            "min_cases": int(min_cases),
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        warnings=warn,
        runtime_s=runtime,
    )
    draws = pd.DataFrame(spi_b, columns=index).reindex(columns=table.index)
    draws.index.name = "replicate"
    return BacklogUncertainty(
        table=table, summary=summary, record=rec, readings=tuple(readings), view=view, by=tuple(by), draws=draws
    )


# ----------------------------------------------------------------------------- envelope
def _scaled(c: wise.Constraint, f: float) -> wise.Constraint | None:
    """A copy of a graded constraint with its threshold and width scaled by ``f``; ``None`` if not graded."""
    if isinstance(c, wise.Lag):
        if c.delta is None:
            return None
        return dataclasses.replace(c, delta=c.delta * f, width=c.width * f)
    if isinstance(c, wise.Balance):
        return dataclasses.replace(c, tau=min(1.0, c.tau * f), width=c.width * f)
    if isinstance(c, wise.Singularity | wise.Precedence):
        return dataclasses.replace(c, k=max(0, round(c.k * f)), K=c.K * f)
    if isinstance(c, wise.Metric):
        return dataclasses.replace(c, threshold=c.threshold * f, width=c.width * f)
    return None


def _backlog_from_violations(
    result: wise.ScoreResult, view: str, V: pd.DataFrame, by: Sequence[str], gamma: float, volume: str, baseline: float | None
) -> pd.DataFrame:
    w_eff = result.effective_weights(view).to_numpy(dtype=float)
    penalty = w_eff * V.fillna(0.0).to_numpy(dtype=float)
    s = 1.0 - penalty.sum(axis=1)
    s[result.scores[view].isna().to_numpy()] = np.nan
    frame = result.cases.copy()
    frame["score"] = s
    if any(c not in frame.columns for c in by):
        frame = frame.reset_index()
    return wise.prioritize(frame, list(by), gamma=gamma, volume=volume, baseline=baseline, score_col="score")


def sensitivity_envelope(
    result: wise.ScoreResult,
    by: str | Sequence[str],
    view: str | None = None,
    *,
    gamma: float = 0.0,
    gamma_grid: Sequence[float] | None = None,
    scale: Sequence[float] = (0.8, 1.25),
    weight_jitter: float = 0.10,
    n_jitter: int = 3,
    k: int = 10,
    seed: int = 0,
    volume: str = "cases",
    baseline: float | None = None,
) -> RankStability:
    """Rank stability of the backlog under a grid of settings.

    Settings: the reference (``gamma``); each value of ``gamma_grid``
    (default ``{0, γ/2, 2γ, γ̂}`` with ``γ̂`` from :func:`wise.estimate_gamma`
    when finite); every graded constraint with threshold and width scaled
    by each factor in ``scale`` (needs the log attached to ``result``);
    ``n_jitter`` draws of view weights multiplied by ``1 + U(−j, j)``.

    Returns :class:`RankStability`: per slice the reference rank, the rank
    range across settings, the number of settings in which it is in the
    top-``k`` (``topk_settings`` of ``n_settings``) and ``always_topk``;
    ``settings`` lists every setting with its top-``k`` Jaccard overlap
    with the reference.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    by = keys(by)
    gamma = float(gamma)
    warn: list[str] = []
    settings: list[tuple[str, str, Any, pd.DataFrame]] = []
    ref = wise.prioritize(result, by, view=view, gamma=gamma, volume=volume, baseline=baseline)
    settings.append(("reference", "reference", gamma, ref))

    grid: list[float] = list(gamma_grid) if gamma_grid is not None else [0.0, gamma / 2.0, 2.0 * gamma]
    if gamma_grid is None:
        try:
            g_hat = wise.estimate_gamma(result, by, view=view)
            if np.isfinite(g_hat):
                grid.append(float(g_hat))
            else:
                warn.append("estimate_gamma is infinite (slices do not differ beyond noise); omitted from the grid")
        except NotScoredError as exc:
            warn.append(f"estimate_gamma skipped: {exc}")
    for g in dict.fromkeys(round(float(x), 6) for x in grid):
        if g == round(gamma, 6) or g < 0:
            continue
        settings.append(
            (f"gamma={g:g}", "gamma", g, wise.prioritize(result, by, view=view, gamma=g, volume=volume, baseline=baseline))
        )

    if result.log is None:
        warn.append("no event log attached to the result; threshold settings skipped")
    else:
        for nc in result.norm.constraints:
            for f in scale:
                c2 = _scaled(nc.constraint, float(f))
                if c2 is None:
                    continue
                v2 = wise.evaluate_constraint(result.log, nc.replace(constraint=c2))
                v0 = result.violations[nc.id]
                v2 = v2.reindex(v0.index).where(v0.notna())
                v2 = v2.where(v2.notna(), v0)
                V = result.violations.copy()
                V[nc.id] = v2
                settings.append(
                    (
                        f"{nc.id}×{f:g}",
                        "threshold",
                        {"constraint": nc.id, "factor": float(f)},
                        _backlog_from_violations(result, view, V, by, gamma, volume, baseline),
                    )
                )

    rng = np.random.default_rng(seed)
    w0 = result.norm.weight_vector(view)
    for i in range(int(n_jitter)):
        jitter = 1.0 + rng.uniform(-weight_jitter, weight_jitter, size=len(w0))
        w = {cid: float(max(0.0, x)) for cid, x in zip(w0.index, w0.to_numpy(dtype=float) * jitter)}
        frame = rescore_view(result, w, name=f"{view}~jitter{i + 1}")
        if any(c not in frame.columns for c in by):
            frame = frame.reset_index()
        settings.append(
            (
                f"weights~{i + 1}",
                "weights",
                {"jitter": float(weight_jitter), "draw": i + 1},
                wise.prioritize(frame, by, gamma=gamma, volume=volume, baseline=baseline, score_col="score"),
            )
        )

    rank_cols: dict[str, pd.Series] = {}
    top_cols: dict[str, pd.Series] = {}
    rows = []
    for name, kind, value, bl in settings:
        rank = pd.Series(np.arange(1, len(bl) + 1), index=bl.index, dtype=float).reindex(ref.index)
        top = ((rank <= k) & (bl["stable_PI"].reindex(ref.index) > 0)).fillna(False).astype(bool)
        rank_cols[name] = rank
        top_cols[name] = top
        rows.append(
            {
                "setting": name,
                "kind": kind,
                "value": value,
                "top_k_overlap": wise.top_k_overlap(ref, bl, k=k),
                "n_topk": int(top.sum()),
            }
        )
    ranks_df = pd.DataFrame(rank_cols)
    tops_df = pd.DataFrame(top_cols)
    table = ref[["n_cases", "stable_gap", "stable_PI"]].copy()
    table["rank_ref"] = np.arange(1, len(table) + 1)
    table["rank_min"] = ranks_df.min(axis=1)
    table["rank_max"] = ranks_df.max(axis=1)
    table["topk_settings"] = tops_df.sum(axis=1).astype(int)
    table["n_settings"] = len(settings)
    table["always_topk"] = table["topk_settings"] == len(settings)
    table["never_topk"] = table["topk_settings"] == 0
    settings_df = pd.DataFrame(rows).set_index("setting")

    n_always = int(table["always_topk"].sum())
    n_ref_top = int(tops_df["reference"].sum())
    summary: dict[str, Any] = {
        "view": view,
        "by": by,
        "gamma": gamma,
        "k": int(k),
        "n_settings": len(settings),
        "settings": list(settings_df.index),
        "min_top_k_overlap": float(settings_df["top_k_overlap"].min()) if len(settings_df) else np.nan,
        "n_topk_reference": n_ref_top,
        "n_always_topk": n_always,
        "runtime_s": time.perf_counter() - t0,
    }
    readings = [
        f"Sensitivity envelope for the backlog by {', '.join(by)} under {view}: {len(settings)} settings "
        f"({(settings_df['kind'] == 'gamma').sum()} γ values, {(settings_df['kind'] == 'threshold').sum()} threshold scalings, "
        f"{(settings_df['kind'] == 'weights').sum()} weight jitters). {n_always} of the {n_ref_top} reference top-{k} slices stay in the "
        f"top-{k} under every setting; the lowest top-{k} Jaccard overlap with the reference is {fmt(summary['min_top_k_overlap'], 2)}. "
        "The envelope is a set of settings, not a probability."
    ]
    for key, row in table.head(k).iterrows():
        if row["stable_PI"] <= 0:
            continue
        readings.append(
            f"Slice {index_label(key, by)}: reference rank {int(row['rank_ref'])}, rank range {int(row['rank_min'])}–{int(row['rank_max'])}, "
            f"top-{k} under {int(row['topk_settings'])}/{int(row['n_settings'])} settings."
        )
    lf, nf = result_fingerprints(result)
    rec = record(
        "sensitivity_envelope",
        ENVELOPE_VERSION,
        table=table,
        params={
            "by": by,
            "view": view,
            "gamma": gamma,
            "gamma_grid": list(gamma_grid) if gamma_grid is not None else None,
            "scale": list(scale),
            "weight_jitter": float(weight_jitter),
            "n_jitter": int(n_jitter),
            "k": int(k),
            "seed": int(seed),
            "volume": volume,
            "baseline": baseline,
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        warnings=warn,
        runtime_s=summary["runtime_s"],
    )
    return RankStability(
        table=table, summary=summary, record=rec, readings=tuple(readings), view=view, by=tuple(by), settings=settings_df
    )


__all__ = [
    "BOOTSTRAP_VERSION",
    "ENVELOPE_VERSION",
    "STABILITY_RULE",
    "BacklogUncertainty",
    "RankStability",
    "bootstrap_backlog",
    "sensitivity_envelope",
]
