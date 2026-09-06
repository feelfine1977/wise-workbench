"""Contrastive gap decomposition of a slice against the rest of the log.

The decomposition is an identity, not a model::

    μ̄ − μ_s = Σ_c [mean_s(π_c) − mean_Σ(π_c)] = Σ_λ [mean_s(Δ_λ) − mean_Σ(Δ_λ)]

with ``π_c = w̃_c ν_c`` the per-case effective penalties of
:meth:`wise.ScoreResult.penalties` (which already encode the scoring mode
and the applicability of every constraint). The bars of the waterfall
therefore sum to the gap exactly. Next to the exact terms the module adds
descriptive effect sizes: the violation-rate difference per constraint
with a Newcombe interval, and — where the constraint has a raw signal in
native units (days, counts, a relative difference) — medians, the
Hodges–Lehmann shift, Cliff's delta, the quantile shifts at Q50 and Q90
with a shift-vs-tail reading, and the paired empirical distribution
functions for the overlay chart.

:func:`raw_signals` computes those signals with the same log primitives
scoring uses (``count``, ``count_scoped``, ``first_after``, ``total``,
``attribute``); it carries no constraint semantics of its own.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.constraints import in_units
from wise.errors import NotScoredError

from ._common import bootstrap_weights, fmt, fmt_unit, pct, resolve_view, slice_label, slice_mask
from ._stats import cliffs_delta, ecdf_pair, hodges_lehmann, newcombe_interval, quantile, z_for
from .provenance import AnalyticResult, record, result_fingerprints

CONTRAST_VERSION = "1"

PATTERNS = ("whole distribution shifted", "tail shifted", "no material shift", "not available")


@dataclass(frozen=True)
class SliceContrast(AnalyticResult):
    """Waterfall by constraint (``table``), by layer (``layers``) and ECDF pairs (``ecdf``)."""

    view: str
    slice: str
    layers: pd.DataFrame
    ecdf: Mapping[str, pd.DataFrame]


# ----------------------------------------------------------------------------- raw signals
def signal_units(norm: wise.Norm) -> dict[str, str]:
    """Native unit of every constraint's raw signal."""
    units: dict[str, str] = {}
    for nc in norm.constraints:
        c = nc.constraint
        if isinstance(c, wise.Lag):
            units[nc.id] = c.unit
        elif isinstance(c, wise.Balance):
            units[nc.id] = "relative difference"
        elif isinstance(c, wise.Metric):
            units[nc.id] = c.attribute
        else:
            units[nc.id] = "count"
    return units


def _signal_scale(c: wise.Constraint) -> float:
    """The saturation width of a graded constraint in its native unit (0 when step-like)."""
    if isinstance(c, wise.Lag):
        return float(c.width)
    if isinstance(c, wise.Balance | wise.Metric):
        return float(c.width)
    if isinstance(c, wise.Singularity | wise.Precedence):
        return float(c.K)
    return 1.0


def raw_signals(log: wise.EventLog, norm: wise.Norm, constraints: Sequence[str] | None = None) -> pd.DataFrame:
    """Raw signal per case and constraint in native units (cases × constraints).

    Presence, exclusion and singularity give the (scoped) activity count;
    a lag gives the time from the activation to the response in the
    constraint's unit (NaN when an endpoint is undefined; for
    ``activation="each"`` the mean over activations); precedence gives the
    number of premature ``b`` events; balance the relative difference
    ``|tot_x − tot_y| / max(tot_x, tot_y, ε)``; metric the case attribute.
    Signals are not masked by applicability. Units are in ``attrs["units"]``.
    """
    wanted = list(constraints) if constraints is not None else norm.constraint_ids
    cols: dict[str, pd.Series] = {}
    for nc in norm.constraints:
        if nc.id not in wanted:
            continue
        c = nc.constraint
        if isinstance(c, wise.Presence):
            s = log.count(c.activity)
        elif isinstance(c, wise.Exclusion | wise.Singularity):
            s = log.count_scoped(c.activity, after=c.after, before=c.before) if (c.after or c.before) else log.count(c.activity)
        elif isinstance(c, wise.Lag):
            if c.activation == "each":
                pairs = log.activation_lags(c.a, c.b)
                lag = in_units(pairs["t_b"] - pairs["t_a"], c.unit)
                per_case = lag.groupby(pairs["code"].to_numpy()).mean() if len(pairs) else pd.Series(dtype=float)
                s = pd.Series(per_case.reindex(range(len(log))).to_numpy(), index=log.case_ids)
            else:
                t_a, t_b = log.first_after(c.a, c.b, activation=c.activation, response=c.response)
                lag = in_units(t_b - t_a, c.unit)
                s = lag.where(lag >= 0) if c.response == "first_overall" else lag
        elif isinstance(c, wise.Precedence):
            s = log.count_before(c.b, c.a)
        elif isinstance(c, wise.Balance):
            tot_x = log.total(c.attr_x, c.activities_x, agg=c.agg)
            tot_y = log.total(c.attr_y, c.activities_y, agg=c.agg)
            denom = np.maximum(np.maximum(tot_x.to_numpy(dtype=float), tot_y.to_numpy(dtype=float)), c.eps)
            s = pd.Series((tot_x - tot_y).abs().to_numpy(dtype=float) / denom, index=log.case_ids)
        elif isinstance(c, wise.Metric):
            s = log.attribute(c.attribute)
        else:  # pragma: no cover - the catalogue is closed
            raise TypeError(f"unsupported constraint {type(c).__name__}")
        cols[nc.id] = pd.Series(np.asarray(s, dtype=float), index=log.case_ids, name=nc.id)
    out = pd.DataFrame(cols, index=log.case_ids)
    out.attrs["units"] = {k: v for k, v in signal_units(norm).items() if k in out.columns}
    return out


# ----------------------------------------------------------------------------- contrast
def _pattern(q50: tuple[float, float], q90: tuple[float, float], tol: float) -> str:
    """Shift-vs-tail reading from the slice/rest quantile pairs ``q50 = (Q50_s, Q50_r)``, ``q90 = (Q90_s, Q90_r)``.

    Not material when both quantile shifts are within ``tol``. Otherwise the
    median shift is compared with the Q90 shift — on the log scale when all
    four quantiles are positive (so that a multiplicative slowdown of every
    case reads as a whole-distribution shift), additively otherwise: a
    median shift of at least half the Q90 shift is a shift of the whole
    distribution; a Q90 shift without a comparable median shift is a tail.
    """
    q50s, q50r = q50
    q90s, q90r = q90
    if not all(np.isfinite(v) for v in (q50s, q50r, q90s, q90r)):
        return "not available"
    d50, d90 = q50s - q50r, q90s - q90r
    if max(abs(d50), abs(d90)) <= tol:
        return "no material shift"
    if min(q50s, q50r, q90s, q90r) > 0:
        d50, d90 = np.log(q50s / q50r), np.log(q90s / q90r)
    if abs(d50) >= 0.5 * abs(d90):
        return "whole distribution shifted"
    return "tail shifted"


def contrast_slice(
    result: wise.ScoreResult,
    view: str | None = None,
    where: Mapping[str, Any] | pd.Series | np.ndarray | None = None,
    *,
    ci: float = 0.90,
    B: int = 200,
    seed: int = 0,
    signals: pd.DataFrame | None = None,
    max_pairs: int = 4_000_000,
    min_evaluated: int = 2,
) -> SliceContrast:
    """Exact gap decomposition of a slice with descriptive effect sizes.

    Parameters
    ----------
    result, view
        The score result and the view (``None`` when the norm has one view).
    where
        The slice: ``{attribute: value}`` (AND) or a boolean mask over cases.
    ci, B, seed
        Level and size of the case bootstrap behind the interval of every
        waterfall bar; ``B=0`` skips the intervals.
    signals
        Raw signals from :func:`raw_signals`; computed from ``result.log``
        when omitted (native-unit shifts are skipped when no log is attached).
    max_pairs
        Pair budget of the Hodges–Lehmann shift (subsampled beyond it).
    min_evaluated
        Minimum cases with a defined signal on each side for the shifts.

    Returns
    -------
    :class:`SliceContrast` — ``table`` per constraint (``delta`` sums to
    ``signed_gap`` in ``summary`` to 1e-9), ``layers`` per layer, ``ecdf``
    per constraint with a raw signal.
    """
    t0 = time.perf_counter()
    view = resolve_view(result, view)
    scored = result.scores[view].notna()
    in_slice = slice_mask(result.cases, where)
    mask_s = (in_slice & scored).to_numpy()
    mask_r = (~in_slice & scored).to_numpy()
    n_s, n_r, n_all = int(mask_s.sum()), int(mask_r.sum()), int(scored.sum())
    if n_s == 0:
        raise NotScoredError("the slice contains no scored case")
    warn: list[str] = []
    if n_r == 0:
        warn.append("the slice covers every scored case; contrasts against the rest are undefined")

    pen = result.penalties(view)
    P_all = pen.loc[scored.to_numpy()]
    in_s = mask_s[scored.to_numpy()]
    Pm = P_all.to_numpy(dtype=float)
    mean_s = Pm[in_s].mean(axis=0)
    mean_all = Pm.mean(axis=0)
    mean_r = Pm[~in_s].mean(axis=0) if n_r else np.full(Pm.shape[1], np.nan)
    delta = mean_s - mean_all
    delta_r = mean_s - mean_r
    S_all = result.scores[view][scored].to_numpy(dtype=float)
    mu_s, mu_all = float(S_all[in_s].mean()), float(S_all.mean())
    mu_r = float(S_all[~in_s].mean()) if n_r else float("nan")
    signed_gap = mu_all - mu_s
    decomposition_error = abs(float(delta.sum()) - signed_gap)

    # bootstrap intervals of the waterfall bars (case bootstrap over scored cases)
    lo = hi = np.full(Pm.shape[1], np.nan)
    if B > 0:
        rng = np.random.default_rng(seed)
        draws = []
        with np.errstate(divide="ignore", invalid="ignore"):
            for W in bootstrap_weights(rng, n_all, B):
                Ws = W * in_s[None, :]
                m_s = (Ws @ Pm) / Ws.sum(axis=1)[:, None]
                m_all = (W @ Pm) / W.sum(axis=1)[:, None]
                draws.append(m_s - m_all)
        arr = np.vstack(draws)
        q = np.nanpercentile(arr, [100 * (1 - ci) / 2, 100 * (1 - (1 - ci) / 2)], axis=0)
        lo, hi = q[0], q[1]

    z = z_for(ci)
    V = result.violations
    S_scope = result.in_scope
    if signals is None and result.log is not None:
        signals = raw_signals(result.log, result.norm)
    elif signals is None:
        warn.append("no event log attached to the result; native-unit shifts skipped")
    units = signal_units(result.norm)
    rng_hl = np.random.default_rng(seed)
    rows = []
    ecdfs: dict[str, pd.DataFrame] = {}
    for j, nc in enumerate(result.norm.constraints):
        cid = nc.id
        v = V[cid].to_numpy(dtype=float)
        ev = ~np.isnan(v)
        ev_s, ev_r = ev & mask_s, ev & mask_r
        x_s, x_r = float((v[ev_s] > 0).sum()), float((v[ev_r] > 0).sum())
        rate_s = x_s / ev_s.sum() if ev_s.sum() else np.nan
        rate_r = x_r / ev_r.sum() if ev_r.sum() else np.nan
        rd_lo, rd_hi = newcombe_interval(x_s, float(ev_s.sum()), x_r, float(ev_r.sum()), z)
        row: dict[str, Any] = {
            "constraint": cid,
            "layer": nc.layer,
            "type": nc.constraint.type,
            "description": nc.description,
            "mean_penalty_slice": float(mean_s[j]),
            "mean_penalty_all": float(mean_all[j]),
            "mean_penalty_rest": float(mean_r[j]),
            "delta": float(delta[j]),
            "delta_lo": float(lo[j]),
            "delta_hi": float(hi[j]),
            "delta_vs_rest": float(delta_r[j]),
            "share_of_gap": float(delta[j] / signed_gap) if signed_gap != 0 else np.nan,
            "n_evaluated_slice": int(ev_s.sum()),
            "n_evaluated_rest": int(ev_r.sum()),
            "share_evaluated_slice": float(ev_s.sum() / n_s),
            "share_evaluated_rest": float(ev_r.sum() / n_r) if n_r else np.nan,
            "share_in_scope_slice": float(S_scope[cid].to_numpy()[mask_s].mean()),
            "share_in_scope_rest": float(S_scope[cid].to_numpy()[mask_r].mean()) if n_r else np.nan,
            "rate_slice": rate_s,
            "rate_rest": rate_r,
            "risk_difference": rate_s - rate_r,
            "rd_lo": rd_lo,
            "rd_hi": rd_hi,
            "relative_risk": (rate_s / rate_r) if (rate_r and np.isfinite(rate_r) and rate_r > 0) else np.nan,
            "mean_violation_slice": float(v[ev_s].mean()) if ev_s.any() else np.nan,
            "mean_violation_rest": float(v[ev_r].mean()) if ev_r.any() else np.nan,
            "unit": units[cid],
            "median_slice": np.nan,
            "median_rest": np.nan,
            "hl_shift": np.nan,
            "cliffs_delta": np.nan,
            "q50_shift": np.nan,
            "q90_shift": np.nan,
            "share_undefined_slice": np.nan,
            "share_undefined_rest": np.nan,
            "pattern": "not available",
        }
        if signals is not None and cid in signals.columns:
            sig = signals[cid].reindex(result.cases.index).to_numpy(dtype=float)
            a = sig[mask_s]
            b = sig[mask_r]
            a_def, b_def = a[~np.isnan(a)], b[~np.isnan(b)]
            row["share_undefined_slice"] = float(np.isnan(a).mean())
            row["share_undefined_rest"] = float(np.isnan(b).mean()) if n_r else np.nan
            if len(a_def) >= min_evaluated and len(b_def) >= min_evaluated:
                q50 = (quantile(a_def, 0.5), quantile(b_def, 0.5))
                q90 = (quantile(a_def, 0.9), quantile(b_def, 0.9))
                q50s, q90s = q50[0] - q50[1], q90[0] - q90[1]
                width = _signal_scale(nc.constraint)
                pooled = np.concatenate([a_def, b_def])
                iqr = float(np.quantile(pooled, 0.75) - np.quantile(pooled, 0.25))
                tol = 0.05 * (width if width > 0 else (iqr if iqr > 0 else 1.0))
                row.update(
                    {
                        "median_slice": quantile(a_def, 0.5),
                        "median_rest": quantile(b_def, 0.5),
                        "hl_shift": hodges_lehmann(a_def, b_def, max_pairs=max_pairs, rng=rng_hl),
                        "cliffs_delta": cliffs_delta(a_def, b_def),
                        "q50_shift": q50s,
                        "q90_shift": q90s,
                        "pattern": _pattern(q50, q90, tol),
                    }
                )
                e = ecdf_pair(a_def, b_def).rename(columns={"F_a": "F_slice", "F_b": "F_rest"})
                e.attrs.update({"constraint": cid, "unit": units[cid], "n_slice": len(a_def), "n_rest": len(b_def)})
                ecdfs[cid] = e
        rows.append(row)
    table = (
        pd.DataFrame(rows).set_index("constraint").sort_values(["delta", "mean_penalty_slice"], ascending=False, kind="mergesort")
    )

    layers = (
        table.groupby("layer", sort=False)[
            ["mean_penalty_slice", "mean_penalty_all", "mean_penalty_rest", "delta", "delta_vs_rest"]
        ]
        .sum(min_count=1)
        .reindex(result.norm.layer_ids)
    )
    layers["share_of_gap"] = layers["delta"] / signed_gap if signed_gap != 0 else np.nan
    layers = layers.sort_values("delta", ascending=False, kind="mergesort")

    label = slice_label(where)
    top = table.index[0] if len(table) else None
    summary: dict[str, Any] = {
        "slice": label,
        "view": view,
        "n_slice": n_s,
        "n_rest": n_r,
        "n_scored": n_all,
        "mean_score_slice": mu_s,
        "mean_score_all": mu_all,
        "mean_score_rest": mu_r,
        "signed_gap": signed_gap,
        "gap": max(signed_gap, 0.0),
        "gap_vs_rest": mu_r - mu_s if n_r else np.nan,
        "decomposition_error": decomposition_error,
        "layer_decomposition_error": abs(float(layers["delta"].sum()) - signed_gap),
        "top_constraint": top,
        "top_layer": str(layers.index[0]) if len(layers) else None,
        "ci": float(ci),
        "B": int(B),
        "seed": int(seed),
        "pattern_top": str(table.loc[top, "pattern"]) if top is not None else None,
        "runtime_s": time.perf_counter() - t0,
    }
    readings = [
        f"Slice {label} (n = {n_s} scored cases; {n_r} elsewhere) has mean score {fmt(mu_s)} under {view} against a log mean of "
        f"{fmt(mu_all)}: an expectation shortfall of {fmt(signed_gap, 4)}"
        + (f" ({fmt(mu_r - mu_s, 4)} against the rest)" if n_r else "")
        + f". The decomposition by constraint sums to the gap (max error {decomposition_error:.1e})."
    ]
    for cid, row in table.head(3).iterrows():
        if row["delta"] <= 0:
            continue
        s = (
            f"{cid} ({row['description'] or row['type']}, layer {row['layer']}) carries {fmt(row['delta'], 4)} of the gap "
            f"({pct(row['share_of_gap'])}"
            + (f"; {pct(ci)} interval {fmt(row['delta_lo'], 4)}–{fmt(row['delta_hi'], 4)}" if B > 0 else "")
            + f"): violated in {pct(row['rate_slice'])} of {int(row['n_evaluated_slice'])} evaluated cases in the slice vs "
            f"{pct(row['rate_rest'])} elsewhere (risk difference {fmt(row['risk_difference'], 2)}, {pct(ci)} interval "
            f"{fmt(row['rd_lo'], 2)}–{fmt(row['rd_hi'], 2)})"
        )
        if row["pattern"] != "not available":
            s += (
                f"; median {fmt_unit(row['median_slice'])} {row['unit']} in the slice vs {fmt_unit(row['median_rest'])} elsewhere "
                f"(Hodges–Lehmann shift {fmt_unit(row['hl_shift'])}, Cliff's δ {fmt(row['cliffs_delta'], 2)}); {row['pattern']}"
            )
        if (
            abs(
                row["share_evaluated_slice"]
                - (row["share_evaluated_rest"] if np.isfinite(row["share_evaluated_rest"]) else row["share_evaluated_slice"])
            )
            > 0.1
        ):
            s += f"; note the constraint is evaluated for {pct(row['share_evaluated_slice'])} of slice cases vs {pct(row['share_evaluated_rest'])} elsewhere"
        readings.append(s + ".")
    lf, nf = result_fingerprints(result)
    rec = record(
        "contrast_slice",
        CONTRAST_VERSION,
        table=table,
        params={
            "view": view,
            "where": label,
            "ci": float(ci),
            "B": int(B),
            "seed": int(seed),
            "max_pairs": int(max_pairs),
            "min_evaluated": int(min_evaluated),
            "mode": result.mode,
        },
        log_fingerprint=lf,
        norm_fingerprint=nf,
        warnings=warn,
        runtime_s=summary["runtime_s"],
    )
    return SliceContrast(
        table=table, summary=summary, record=rec, readings=tuple(readings), view=view, slice=label, layers=layers, ecdf=ecdfs
    )


__all__ = ["CONTRAST_VERSION", "PATTERNS", "SliceContrast", "contrast_slice", "raw_signals", "signal_units"]
