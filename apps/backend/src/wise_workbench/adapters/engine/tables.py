"""DataFrame → JSON-safe ``Table`` dicts and scalar coercion."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def jsonable(value: Any) -> Any:
    """Coerce numpy/pandas scalars to plain Python; NaN/NaT become ``None``."""
    if value is None:
        return None
    if isinstance(value, pd.Timestamp | np.datetime64):
        ts = pd.Timestamp(value)
        return None if pd.isna(ts) else ts.isoformat()
    if isinstance(value, pd.Timedelta | np.timedelta64):
        td = pd.Timedelta(value)
        return None if pd.isna(td) else td.total_seconds()
    if isinstance(value, np.bool_ | bool):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating | float):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(value, np.ndarray):
        return [jsonable(v) for v in value.tolist()]
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [jsonable(v) for v in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def table_from_frame(df: pd.DataFrame, *, index: bool = True, limit: int | None = None) -> dict[str, Any]:
    """``{"columns": [...], "rows": [[...]]}``; a named index becomes leading columns."""
    frame = df
    if index and any(n is not None for n in df.index.names):
        frame = df.reset_index()
    if limit is not None:
        frame = frame.head(limit)
    columns = [str(c) for c in frame.columns]
    rows = [[jsonable(v) for v in row] for row in frame.itertuples(index=False, name=None)]
    return {"columns": columns, "rows": rows}


def records_from_frame(df: pd.DataFrame, *, index: bool = True) -> list[dict[str, Any]]:
    frame = df.reset_index() if index and any(n is not None for n in df.index.names) else df
    return [{str(k): jsonable(v) for k, v in rec.items()} for rec in frame.to_dict(orient="records")]


def key_label(value: Any) -> str:
    v = jsonable(value)
    return "(missing)" if v is None else str(v)
