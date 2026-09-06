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


def distribution(
    values: pd.Series, violations: pd.Series, meta: dict[str, Any], *, bins: int = 40, ecdf_points: int = 101
) -> dict[str, Any]:
    """Histogram, ECDF and summary statistics of a signal restricted to the given cases."""
    x = values.dropna().to_numpy(dtype=float)
    out: dict[str, Any] = {
        "unit": meta.get("unit"),
        "label": meta.get("label"),
        "constraintId": meta.get("constraintId"),
        "type": meta.get("type"),
        "direction": meta.get("direction"),
        "threshold": meta.get("threshold"),
        "width": meta.get("width"),
        "bins": [],
        "ecdf": [],
        "stats": {"n": len(x), "nCases": len(values)},
    }
    if meta.get("note"):
        out["note"] = meta["note"]
    if len(x) == 0:
        return out
    lo, hi = float(np.min(x)), float(np.max(x))
    integral = bool(np.all(np.mod(x, 1) == 0)) and (hi - lo) <= bins
    if integral:
        edges = np.arange(np.floor(lo), np.floor(hi) + 2) - 0.5
    elif hi == lo:
        edges = np.array([lo - 0.5, hi + 0.5])
    else:
        edges = np.linspace(lo, hi, bins + 1)
    counts, edges = np.histogram(x, bins=edges)
    out["bins"] = [{"x0": float(edges[i]), "x1": float(edges[i + 1]), "n": int(counts[i])} for i in range(len(counts))]
    qs = np.linspace(0, 1, ecdf_points)
    xs = np.quantile(x, qs)
    out["ecdf"] = [[float(a), float(b)] for a, b in zip(xs, qs)]
    thr = meta.get("threshold")
    v = violations.reindex(values.index)
    evaluated = v.notna()
    stats = out["stats"]
    stats.update(
        {
            "mean": float(np.mean(x)),
            "median": float(np.median(x)),
            "p90": float(np.quantile(x, 0.9)),
            "p95": float(np.quantile(x, 0.95)),
            "min": lo,
            "max": hi,
            "shareViolated": float((v[evaluated] > 0).mean()) if evaluated.any() else None,
            "meanViolation": float(v[evaluated].mean()) if evaluated.any() else None,
        }
    )
    if thr is not None:
        stats["shareAboveThreshold"] = float(np.mean(x > float(thr)))
        stats["ecdfAtThreshold"] = float(np.mean(x <= float(thr)))
    return out
