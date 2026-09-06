"""Shared helpers: slice masks, slice labels, bootstrap weights, formatting."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NormError


def keys(by: str | Sequence[str]) -> list[str]:
    return [by] if isinstance(by, str) else list(by)


def resolve_view(result: wise.ScoreResult, view: str | None) -> str:
    if view is None:
        if len(result.views) != 1:
            raise NormError(f"specify view=...; available: {result.views}")
        return result.views[0]
    if view not in result.views:
        raise NormError(f"unknown view {view!r}; available: {result.views}")
    return view


def slice_mask(cases: pd.DataFrame, where: Mapping[str, Any] | pd.Series | np.ndarray | None) -> pd.Series:
    """Boolean mask over ``cases`` from ``{attribute: value}`` (AND of
    equalities; the case id is allowed) or from a boolean Series / array."""
    if where is None:
        return pd.Series(True, index=cases.index)
    if isinstance(where, Mapping):
        mask = pd.Series(True, index=cases.index)
        for k, v in where.items():
            if k in cases.columns:
                col = cases[k]
                mask &= col.isin(list(v)) if isinstance(v, list | tuple | set | frozenset) else (col == v)
            elif k == cases.index.name:
                mask &= pd.Series(cases.index == v, index=cases.index)
            else:
                raise NormError(f"unknown case attribute {k!r}; known: {list(cases.columns)}")
        return mask
    if isinstance(where, pd.Series):
        return where.reindex(cases.index, fill_value=False).astype(bool)
    arr = np.asarray(where, dtype=bool)
    if len(arr) != len(cases):
        raise NormError(f"boolean mask has {len(arr)} entries for {len(cases)} cases")
    return pd.Series(arr, index=cases.index)


def slice_label(where: Mapping[str, Any] | pd.Series | np.ndarray | None) -> str:
    if where is None:
        return "all cases"
    if isinstance(where, Mapping):
        return ", ".join(f"{k}={v}" for k, v in where.items())
    return "selected cases"


def index_label(key: Any, by: Sequence[str]) -> str:
    vals = key if isinstance(key, tuple) else (key,)
    return ", ".join(f"{k}={v}" for k, v in zip(by, vals))


def slice_codes(frame: pd.DataFrame, by: Sequence[str]) -> tuple[np.ndarray, pd.Index]:
    """Integer slice code per row of ``frame`` (sorted key order, NaN kept)
    and the index of slice keys in that order (matches ``prioritize``)."""
    g = frame.groupby(list(by), dropna=False, observed=True, sort=True)
    codes = g.ngroup().to_numpy()
    index = g.size().index
    return codes, index


def bootstrap_weights(
    rng: np.random.Generator,
    n: int,
    B: int,
    *,
    cluster: np.ndarray | None = None,
    chunk: int | None = None,
) -> Iterator[np.ndarray]:
    """Yield chunks of multinomial bootstrap weights (``b × n``).

    Case bootstrap: ``w ~ Multinomial(n, 1/n)``. Cluster bootstrap: weights
    are drawn per cluster (``Multinomial(n_clusters, 1/n_clusters)``) and
    every case inherits its cluster's weight, so cases that share a
    cluster are resampled together.
    """
    if n <= 0:
        return
    if chunk is None:
        chunk = max(1, min(B, int(10_000_000 // max(n, 1))))
    done = 0
    while done < B:
        b = min(chunk, B - done)
        if cluster is None:
            w = rng.multinomial(n, np.full(n, 1.0 / n), size=b).astype(float)
        else:
            m = int(cluster.max()) + 1
            wc = rng.multinomial(m, np.full(m, 1.0 / m), size=b).astype(float)
            w = wc[:, cluster]
        yield w
        done += b


def fmt(x: Any, digits: int = 3) -> str:
    """Compact number formatting for readings."""
    if x is None:
        return "n/a"
    try:
        v = float(x)
    except (TypeError, ValueError):
        return str(x)
    if not np.isfinite(v):
        return "n/a"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    if abs(v) >= 100:
        return f"{v:.1f}"
    return f"{v:.{digits}f}"


def fmt_unit(x: Any) -> str:
    """Native-unit formatting: two decimals below 10, one decimal below 1000, else integers."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return str(x)
    if not np.isfinite(v):
        return "n/a"
    if abs(v) < 10:
        return f"{v:.2f}"
    return fmt(v, 1)


def pct(x: Any) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "n/a"
    return "n/a" if not np.isfinite(v) else f"{100.0 * v:.0f} %"


__all__ = [
    "bootstrap_weights",
    "fmt",
    "fmt_unit",
    "index_label",
    "keys",
    "pct",
    "resolve_view",
    "slice_codes",
    "slice_label",
    "slice_mask",
]
