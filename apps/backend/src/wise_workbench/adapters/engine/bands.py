"""Banded numeric attributes for the slice designer (R2-O2): quantile bands or explicit cut points.

A band spec ``{"attribute", "method": "quantile" | "cuts", "q" | "cuts", "labels"?}`` turns a numeric case
attribute into an ordered label column with the same name, so that the library groups by the label and the slice
keys stay the real column name plus a readable band ("< 1.2k", "1.2k – 8.5k", "≥ 8.5k").
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from wise_workbench.domain import ValidationError

MISSING = "(missing)"
RESERVED = {"exposure", "n_events", "first_ts", "last_ts", "score"}


def band_column(attribute: str) -> str:
    """The column that holds the band labels: the attribute itself, or ``<attribute> band`` for the library's
    reserved numeric columns (``exposure``, ``n_events``), which must stay numeric for volumes and counts."""
    return f"{attribute} band" if attribute in RESERVED else attribute


def effective_attributes(attributes: list[str], bands: list[dict[str, Any]]) -> list[str]:
    """The slicing's attribute names as they appear in banded frames and in slice keys."""
    banded = {str(b["attribute"]) for b in bands}
    return [band_column(a) if a in banded else a for a in attributes]


def _fmt(x: float) -> str:
    if not np.isfinite(x):
        return "∞" if x > 0 else "-∞"
    a = abs(x)
    if a >= 1e6:
        return f"{x / 1e6:.3g}M"
    if a >= 1e3:
        return f"{x / 1e3:.3g}k"
    if a == int(a):
        return f"{int(x)}"
    return f"{x:.3g}"


def band_edges(values: pd.Series, band: dict[str, Any]) -> tuple[list[float], list[str]]:
    """Ascending edges (first ``-inf``, last ``+inf``) and one label per band."""
    num = pd.to_numeric(values, errors="coerce")
    method = str(band.get("method") or "quantile")
    if method == "quantile":
        q = int(band.get("q") or 4)
        finite = num.dropna().to_numpy(dtype=float)
        if len(finite) == 0:
            raise ValidationError(
                f"attribute {band.get('attribute')!r} has no numeric values to band", code="run.band_values"
            )
        inner = np.unique(np.quantile(finite, np.linspace(0, 1, q + 1)[1:-1]))
        lo, hi = float(finite.min()), float(finite.max())
        edges = [-np.inf, *[float(e) for e in inner if lo < e <= hi and e != lo], np.inf]
        if len(edges) > 2 and edges[-2] >= hi:
            edges.pop(-2)
    else:
        cuts = [float(c) for c in band.get("cuts") or []]
        edges = [-np.inf, *cuts, np.inf]
    labels: list[str] = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        if lo == -np.inf and hi == np.inf:
            labels.append("all")
        elif lo == -np.inf:
            labels.append(f"< {_fmt(hi)}")
        elif hi == np.inf:
            labels.append(f"≥ {_fmt(lo)}")
        else:
            labels.append(f"{_fmt(lo)} – {_fmt(hi)}")
    custom = band.get("labels")
    if custom and len(custom) == len(labels):
        labels = [str(x) for x in custom]
    return edges, labels


def band_values(values: pd.Series, band: dict[str, Any], reference: pd.Series | None = None) -> pd.Series:
    """The band label of every value (``(missing)`` for nulls); edges come from ``reference`` when given."""
    edges, labels = band_edges(reference if reference is not None else values, band)
    num = pd.to_numeric(values, errors="coerce")
    codes = np.searchsorted(np.asarray(edges[1:-1], dtype=float), num.to_numpy(dtype=float), side="right")
    out = pd.Series([labels[int(c)] for c in codes], index=values.index, dtype=object)
    out[num.isna()] = MISSING
    return out


def apply_bands(
    frame: pd.DataFrame, bands: list[dict[str, Any]], reference: pd.DataFrame | None = None
) -> pd.DataFrame:
    """A copy of ``frame`` where every banded attribute holds its band label."""
    if not bands:
        return frame
    out = frame.copy()
    for band in bands:
        attr = str(band["attribute"])
        if attr not in out.columns:
            raise ValidationError(f"band attribute {attr!r} is not a case attribute", code="run.band_attribute")
        ref = reference[attr] if reference is not None and attr in reference.columns else None
        out[band_column(attr)] = band_values(out[attr], band, reference=ref)
    return out


def band_summary(frame: pd.DataFrame, band: dict[str, Any]) -> dict[str, Any]:
    attr = str(band["attribute"])
    if attr not in frame.columns:
        raise ValidationError(f"band attribute {attr!r} is not a case attribute", code="run.band_attribute")
    edges, labels = band_edges(frame[attr], band)
    values = band_values(frame[attr], band)
    counts = values.value_counts()
    return {
        "attribute": attr,
        "method": str(band.get("method") or "quantile"),
        "edges": [None if not np.isfinite(e) else float(e) for e in edges],
        "labels": labels,
        "counts": [int(counts.get(label, 0)) for label in labels],
        "missing": int(counts.get(MISSING, 0)),
    }
