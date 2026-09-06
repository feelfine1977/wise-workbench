"""Parquet (zstd) round-trips through pyarrow, written atomically."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .workspace import Workspace


def write_table(ws: Workspace, path: Path, table: pa.Table, row_group_size: int = 256_000) -> Path:
    with ws.staging(path) as tmp:
        pq.write_table(table, tmp, compression="zstd", row_group_size=row_group_size)
    return path


def write_frame(ws: Workspace, path: Path, df: pd.DataFrame, *, index: bool = True) -> Path:
    """Write a DataFrame; the index is kept as columns when ``index`` is set (default)."""
    frame = df.reset_index() if index and _has_named_index(df) else df
    table = pa.Table.from_pandas(frame, preserve_index=False)
    return write_table(ws, path, table)


def _has_named_index(df: pd.DataFrame) -> bool:
    names = [n for n in df.index.names if n is not None]
    return bool(names)


def read_table(path: Path, columns: list[str] | None = None) -> pa.Table:
    return pq.read_table(path, columns=columns)


def read_frame(path: Path, columns: list[str] | None = None, index: str | list[str] | None = None) -> pd.DataFrame:
    df = read_table(path, columns=columns).to_pandas(self_destruct=True, split_blocks=True)
    if index is not None:
        df = df.set_index(index)
    return df


def parquet_metadata(path: Path) -> dict[str, Any]:
    meta = pq.read_metadata(path)
    return {"rows": meta.num_rows, "columns": meta.num_columns, "row_groups": meta.num_row_groups}
