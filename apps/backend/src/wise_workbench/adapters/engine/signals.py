"""Raw constraint signals in native units for the distribution lens.

The signal is computed from the same library primitives scoring uses
(``count``, ``first_after``, ``total``, ``attribute``, ``count_before``); the
threshold and width come from the constraint's parameters.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.constraints import in_units


def raw_signal(log: wise.EventLog, nc: wise.NormConstraint) -> tuple[pd.Series, dict[str, Any]]:
    c = nc.constraint
    meta: dict[str, Any] = {"constraintId": nc.id, "type": c.type, "direction": "high"}
    if isinstance(c, wise.Presence):
        s = log.count(c.activity)
        meta.update(
            unit="events",
            threshold=float(c.m),
            width=None,
            direction="low",
            label=f"occurrences of {' | '.join(c.activity)}",
        )
    elif isinstance(c, wise.Exclusion):
        s = (
            log.count_scoped(c.activity, after=c.after, before=c.before)
            if (c.after or c.before)
            else log.count(c.activity)
        )
        meta.update(unit="events", threshold=0.0, width=0.0, label=f"occurrences of {' | '.join(c.activity)}")
    elif isinstance(c, wise.Singularity):
        s = (
            log.count_scoped(c.activity, after=c.after, before=c.before)
            if (c.after or c.before)
            else log.count(c.activity)
        )
        meta.update(
            unit="events", threshold=float(c.k), width=float(c.K), label=f"occurrences of {' | '.join(c.activity)}"
        )
    elif isinstance(c, wise.Lag):
        activation = c.activation if c.activation in ("first", "last") else "first"
        t_a, t_b = log.first_after(c.a, c.b, activation=activation, response=c.response)  # type: ignore[arg-type]
        s = in_units(t_b - t_a, c.unit)
        if c.response == "first_overall":
            s = s.where(s >= 0)
        meta.update(
            unit=c.unit,
            threshold=c.delta,
            width=float(c.width),
            label=f"time from {' | '.join(c.a)} to {' | '.join(c.b)} ({c.unit})",
            note="per-activation lags averaged in scoring; the lens shows the first activation"
            if c.activation == "each"
            else None,
        )
    elif isinstance(c, wise.Precedence):
        s = log.count_before(c.b, c.a)
        meta.update(
            unit="events",
            threshold=float(c.k),
            width=float(c.K),
            label=f"{' | '.join(c.b)} events before the first {' | '.join(c.a)}",
        )
    elif isinstance(c, wise.Balance):
        tot_x = log.total(c.attr_x, c.activities_x, agg=c.agg)
        tot_y = log.total(c.attr_y, c.activities_y, agg=c.agg)
        denom = np.maximum(np.maximum(tot_x.to_numpy(), tot_y.to_numpy()), c.eps)
        s = pd.Series((tot_x - tot_y).abs().to_numpy() / denom, index=log.case_ids)
        meta.update(
            unit="relative difference",
            threshold=float(c.tau),
            width=float(c.width),
            label=f"|{c.attr_x} − {c.attr_y}| / max",
        )
    elif isinstance(c, wise.Metric):
        s = log.attribute(c.attribute)
        meta.update(
            unit=c.attribute,
            threshold=float(c.threshold),
            width=float(c.width),
            direction=c.direction,
            label=c.attribute,
        )
    else:  # pragma: no cover - the catalogue is closed
        raise wise.NormError(f"unsupported constraint type {c.type!r}")
    return pd.Series(np.asarray(s, dtype=float), index=log.case_ids), meta


ROBUST_QUANTILES = (0.005, 0.995)


def _robust_range(x: np.ndarray, thr: float | None, sat: float | None) -> tuple[float, float]:
    """The 0.5–99.5 % quantile range, widened to include the threshold and the saturation point."""
    lo, hi = (float(v) for v in np.quantile(x, ROBUST_QUANTILES))
    for marker in (thr, sat):
        if marker is not None and np.isfinite(marker):
            lo, hi = min(lo, float(marker)), max(hi, float(marker))
    if hi <= lo:
        hi = lo + 1.0
    return lo, hi


def distribution(
    values: pd.Series,
    violations: pd.Series,
    meta: dict[str, Any],
    *,
    bins: int = 40,
    ecdf_points: int = 101,
    scale: str = "linear",
) -> dict[str, Any]:
    """Histogram, ECDF and summary statistics of a signal restricted to the given cases.

    Robust histograms (R1-09): the bins cover the 0.5–99.5 % quantile range (widened to the threshold δ and the
    saturation point δ + W), values beyond it are counted in a ``beyond`` bin, the two markers are returned and the
    share beyond δ is printed; ``scale="log"`` bins log10 of the positive values (the returned edges are in the
    signal's unit).
    """
    x = values.dropna().to_numpy(dtype=float)
    thr = meta.get("threshold")
    width = meta.get("width")
    direction = str(meta.get("direction") or "high")
    sat = (float(thr) + float(width)) if (thr is not None and width) else None
    if direction == "low" and thr is not None and width:
        sat = float(thr) - float(width)
    out: dict[str, Any] = {
        "unit": meta.get("unit"),
        "label": meta.get("label"),
        "constraintId": meta.get("constraintId"),
        "type": meta.get("type"),
        "direction": direction,
        "threshold": thr,
        "width": width,
        "saturation": sat,
        "scale": scale,
        "bins": [],
        "beyond": None,
        "below": None,
        "ecdf": [],
        "markers": [],
        "stats": {"n": len(x), "nCases": len(values)},
    }
    if meta.get("note"):
        out["note"] = meta["note"]
    if len(x) == 0:
        return out
    lo_all, hi_all = float(np.min(x)), float(np.max(x))
    lo, hi = _robust_range(x, thr, sat)
    integral = bool(np.all(np.mod(x, 1) == 0)) and (hi - lo) <= bins
    if scale == "log":
        positive = x[x > 0]
        if len(positive) == 0:
            scale = "linear"
            out["scale"] = "linear"
    if scale == "log":
        plo, phi = _robust_range(
            np.log10(x[x > 0]), np.log10(thr) if thr and thr > 0 else None, np.log10(sat) if sat and sat > 0 else None
        )
        edges = 10 ** np.linspace(plo, phi, bins + 1)
        inside = x[(x > 0) & (x >= edges[0]) & (x <= edges[-1])]
        counts, edges = np.histogram(inside, bins=edges)
        lo, hi = float(edges[0]), float(edges[-1])
    elif integral:
        edges = np.arange(np.floor(lo), np.floor(hi) + 2) - 0.5
        counts, edges = np.histogram(x[(x >= edges[0]) & (x <= edges[-1])], bins=edges)
    else:
        edges = np.linspace(lo, hi, bins + 1)
        counts, edges = np.histogram(x[(x >= lo) & (x <= hi)], bins=edges)
    out["bins"] = [{"x0": float(edges[i]), "x1": float(edges[i + 1]), "n": int(counts[i])} for i in range(len(counts))]
    n_beyond = int(np.sum(x > float(edges[-1])))
    n_below = int(np.sum(x < float(edges[0])))
    if n_beyond:
        out["beyond"] = {"x0": float(edges[-1]), "x1": hi_all, "n": n_beyond, "share": n_beyond / len(x)}
    if n_below:
        out["below"] = {"x0": lo_all, "x1": float(edges[0]), "n": n_below, "share": n_below / len(x)}
    qs = np.linspace(0, 1, ecdf_points)
    xs = np.quantile(x, qs)
    out["ecdf"] = [[float(a), float(b)] for a, b in zip(xs, qs)]
    v = violations.reindex(values.index)
    evaluated = v.notna()
    stats = out["stats"]
    stats.update(
        {
            "mean": float(np.mean(x)),
            "median": float(np.median(x)),
            "p90": float(np.quantile(x, 0.9)),
            "p95": float(np.quantile(x, 0.95)),
            "min": lo_all,
            "max": hi_all,
            "rangeLow": lo,
            "rangeHigh": hi,
            "shareViolated": float((v[evaluated] > 0).mean()) if evaluated.any() else None,
            "meanViolation": float(v[evaluated].mean()) if evaluated.any() else None,
        }
    )
    unit = str(meta.get("unit") or "")
    unit_word = {"D": "days", "h": "hours", "W": "weeks", "min": "minutes", "events": "events"}.get(unit, unit)
    if thr is not None:
        t = float(thr)
        beyond = float(np.mean(x < t)) if direction == "low" else float(np.mean(x > t))
        stats["shareAboveThreshold"] = float(np.mean(x > t))
        stats["ecdfAtThreshold"] = float(np.mean(x <= t))
        stats["shareBeyondThreshold"] = beyond
        word = "below" if direction == "low" else "beyond"
        stats["shareBeyondThresholdText"] = f"{beyond * 100:.0f} % {word} {t:g} {unit_word}".rstrip()
        out["markers"].append({"id": "threshold", "x": t, "label": f"δ = {t:g} {unit_word}".rstrip()})
        if sat is not None:
            stats["shareBeyondSaturation"] = float(np.mean(x < sat)) if direction == "low" else float(np.mean(x > sat))
            out["markers"].append(
                {"id": "saturation", "x": float(sat), "label": f"δ + W = {sat:g} {unit_word}".rstrip()}
            )
    return out
