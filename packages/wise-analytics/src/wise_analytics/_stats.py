"""Small, dependency-free statistics used by the analytics.

Everything here is a few lines of numpy: normal quantiles (from the
standard library), Wilson and Newcombe intervals for rates and their
differences, Jensen–Shannon divergence, Cliff's delta via ranks, the
Hodges–Lehmann shift, and paired empirical distribution functions.
"""

from __future__ import annotations

from statistics import NormalDist

import numpy as np
import pandas as pd


def z_for(ci: float) -> float:
    """Two-sided normal quantile for a central interval of level ``ci``."""
    if not 0.0 < ci < 1.0:
        raise ValueError(f"ci must be in (0, 1), got {ci!r}")
    return float(NormalDist().inv_cdf(0.5 + ci / 2.0))


def wilson_interval(x: float, n: float, z: float) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion ``x / n``."""
    if n <= 0:
        return (float("nan"), float("nan"))
    p = x / n
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2.0 * n)) / denom
    half = z * np.sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n)) / denom
    lo = 0.0 if x <= 0 else float(max(0.0, centre - half))
    hi = 1.0 if x >= n else float(min(1.0, centre + half))
    return (lo, hi)


def newcombe_interval(x1: float, n1: float, x2: float, n2: float, z: float) -> tuple[float, float]:
    """Newcombe's hybrid score interval for the risk difference ``x1/n1 − x2/n2``
    (method 10 of Newcombe 1998), built from the two Wilson intervals."""
    if n1 <= 0 or n2 <= 0:
        return (float("nan"), float("nan"))
    p1, p2 = x1 / n1, x2 / n2
    l1, u1 = wilson_interval(x1, n1, z)
    l2, u2 = wilson_interval(x2, n2, z)
    d = p1 - p2
    lo = d - np.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    hi = d + np.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    return (float(max(-1.0, lo)), float(min(1.0, hi)))


def jensen_shannon(p: np.ndarray, q: np.ndarray) -> float:
    """Jensen–Shannon divergence in bits between two frequency vectors
    (normalised internally; 0 = identical, 1 = disjoint support)."""
    p = np.asarray(p, dtype=float)
    q = np.asarray(q, dtype=float)
    if p.sum() <= 0 or q.sum() <= 0:
        return float("nan")
    p = p / p.sum()
    q = q / q.sum()
    m = 0.5 * (p + q)

    def kl(a: np.ndarray, b: np.ndarray) -> float:
        mask = a > 0
        return float(np.sum(a[mask] * np.log2(a[mask] / b[mask])))

    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    """Cliff's delta ``P(a > b) − P(a < b)`` from average ranks (exact, ties handled)."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    ranks = pd.Series(np.concatenate([a, b])).rank(method="average").to_numpy()
    u = ranks[: len(a)].sum() - len(a) * (len(a) + 1) / 2.0
    return float(2.0 * u / (len(a) * len(b)) - 1.0)


def hodges_lehmann(a: np.ndarray, b: np.ndarray, *, max_pairs: int = 4_000_000, rng: np.random.Generator | None = None) -> float:
    """Median of pairwise differences ``a_i − b_j`` (two-sample Hodges–Lehmann shift).

    Exact when ``len(a) · len(b) ≤ max_pairs``; otherwise both samples are
    subsampled (seeded) to keep the pair count within the budget.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    if len(a) * len(b) > max_pairs:
        rng = rng or np.random.default_rng(0)
        m = int(np.sqrt(max_pairs))
        if len(a) > m:
            a = rng.choice(a, size=m, replace=False)
        if len(b) > m:
            b = rng.choice(b, size=m, replace=False)
    return float(np.median(np.subtract.outer(a, b)))


def ecdf_pair(a: np.ndarray, b: np.ndarray, *, max_points: int = 512) -> pd.DataFrame:
    """Empirical distribution functions of two samples on a shared grid.

    Returns ``x, F_a, F_b`` (and the two sample sizes in ``attrs``). The
    grid is the union of observed values, thinned to ``max_points`` by
    quantiles when larger.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    a, b = np.sort(a[~np.isnan(a)]), np.sort(b[~np.isnan(b)])
    grid = np.unique(np.concatenate([a, b]))
    if len(grid) > max_points:
        grid = np.unique(np.quantile(grid, np.linspace(0.0, 1.0, max_points)))
    fa = np.searchsorted(a, grid, side="right") / len(a) if len(a) else np.full(len(grid), np.nan)
    fb = np.searchsorted(b, grid, side="right") / len(b) if len(b) else np.full(len(grid), np.nan)
    out = pd.DataFrame({"x": grid, "F_a": fa, "F_b": fb})
    out.attrs.update({"n_a": len(a), "n_b": len(b)})
    return out


def quantile(a: np.ndarray, q: float) -> float:
    a = np.asarray(a, dtype=float)
    a = a[~np.isnan(a)]
    return float(np.quantile(a, q)) if len(a) else float("nan")


__all__ = [
    "cliffs_delta",
    "ecdf_pair",
    "hodges_lehmann",
    "jensen_shannon",
    "newcombe_interval",
    "quantile",
    "wilson_interval",
    "z_for",
]
