"""DuckDB queries over the workspace's Parquet files and in-memory Arrow tables.

Used for CSV/Parquet ingest, column profiling, server-side backlog paging,
trace lookups and directly-follows aggregation. The library is never
touched here.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa

from .workspace import Workspace

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_ :.()\-/%]*$")


def q(name: str) -> str:
    """Quote an identifier for DuckDB."""
    return '"' + str(name).replace('"', '""') + '"'


def connect(ws: Workspace | None = None) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(database=":memory:")
    if ws is not None:
        con.execute(f"SET temp_directory = '{ws.cache_dir.as_posix()}'")
    con.execute("SET threads = 4")
    return con


# -------------------------------------------------------------------- ingest
def _csv_columns(con: duckdb.DuckDBPyConnection, path: Path, encoding: str) -> list[str]:
    rel = con.sql(
        f"SELECT * FROM read_csv({_lit(path)}, header=true, all_varchar=true, encoding={_lit(encoding)}, sample_size=-1) LIMIT 0"
    )
    return list(rel.columns)


def _lit(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def csv_to_parquet(ws: Workspace, source: Path, dest: Path) -> dict[str, Any]:
    """Convert a CSV to ``events.parquet`` with every column as text.

    Typing (timestamps, numbers) happens at mapping time, so nothing is
    guessed here. Column names are stripped of surrounding whitespace.
    Returns the column list, row count and the encoding that worked.
    """
    last_error: Exception | None = None
    # A failed attempt can invalidate the connection, so every encoding gets a fresh one.
    for encoding in ("utf-8", "cp1252"):
        con = connect(ws)
        try:
            columns = _csv_columns(con, source, encoding)
            renames = ", ".join(f"{q(c)} AS {q(c.strip())}" for c in columns)
            with ws.staging(dest) as tmp:
                con.execute(
                    f"COPY (SELECT {renames} FROM read_csv({_lit(source)}, header=true, all_varchar=true, "
                    f"encoding={_lit(encoding)}, sample_size=-1)) TO {_lit(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD)"
                )
            rows = con.execute(f"SELECT count(*) FROM read_parquet({_lit(dest)})").fetchone()
            return {"columns": [c.strip() for c in columns], "rows": int(rows[0]) if rows else 0, "encoding": encoding}
        except duckdb.Error as exc:  # try the next encoding
            last_error = exc
            continue
        finally:
            con.close()
    raise ValueError(f"cannot read CSV {source.name}: {last_error}")


def parquet_copy(ws: Workspace, source: Path, dest: Path) -> dict[str, Any]:
    con = connect(ws)
    columns = list(con.sql(f"SELECT * FROM read_parquet({_lit(source)}) LIMIT 0").columns)
    renames = ", ".join(f"{q(c)} AS {q(c.strip())}" for c in columns)
    with ws.staging(dest) as tmp:
        con.execute(
            f"COPY (SELECT {renames} FROM read_parquet({_lit(source)})) TO {_lit(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    rows = con.execute(f"SELECT count(*) FROM read_parquet({_lit(dest)})").fetchone()
    return {"columns": [c.strip() for c in columns], "rows": int(rows[0]) if rows else 0, "encoding": None}


def profile_columns(ws: Workspace, parquet: Path, sample: int = 5) -> list[dict[str, Any]]:
    """Per column: storage type, null share, distinct count (approximate on big files), sample values, a type guess."""
    con = connect(ws)
    rel = con.sql(f"SELECT * FROM read_parquet({_lit(parquet)})")
    columns = list(rel.columns)
    dtypes = [str(t) for t in rel.types]
    total = con.execute(f"SELECT count(*) FROM read_parquet({_lit(parquet)})").fetchone()
    n = int(total[0]) if total else 0
    out: list[dict[str, Any]] = []
    for col, dtype in zip(columns, dtypes):
        c = q(col)
        stats = con.execute(
            f"SELECT count(*) FILTER (WHERE {c} IS NULL OR CAST({c} AS VARCHAR) = ''), "
            f"approx_count_distinct({c}), "
            f"count(*) FILTER (WHERE TRY_CAST({c} AS DOUBLE) IS NOT NULL), "
            f"count(*) FILTER (WHERE TRY_CAST({c} AS TIMESTAMP) IS NOT NULL) "
            f"FROM read_parquet({_lit(parquet)})"
        ).fetchone()
        nulls, distinct, numeric, timestamps = (int(v) for v in (stats or (0, 0, 0, 0)))
        samples = con.execute(
            f"SELECT DISTINCT CAST({c} AS VARCHAR) FROM read_parquet({_lit(parquet)}) WHERE {c} IS NOT NULL LIMIT {int(sample)}"
        ).fetchall()
        non_null = max(n - nulls, 1)
        guess = "string"
        if dtype.upper().startswith(("TIMESTAMP", "DATE")):
            guess = "timestamp"
        elif dtype.upper() in ("DOUBLE", "FLOAT", "BIGINT", "INTEGER", "HUGEINT", "DECIMAL", "SMALLINT", "TINYINT"):
            guess = "number"
        elif timestamps / non_null > 0.95 and n - nulls > 0:
            guess = "timestamp"
        elif numeric / non_null > 0.95 and n - nulls > 0:
            guess = "number"
        out.append(
            {
                "name": col,
                "dtype": guess,
                "storage": dtype,
                "nulls": nulls / n if n else 0.0,
                "distinct": distinct,
                "sample": [s[0] for s in samples],
            }
        )
    return out


def preview(ws: Workspace, parquet: Path, rows: int = 50) -> tuple[list[str], list[list[Any]]]:
    con = connect(ws)
    rel = con.sql(f"SELECT * FROM read_parquet({_lit(parquet)}) LIMIT {int(rows)}")
    return list(rel.columns), [list(r) for r in rel.fetchall()]


def sample_events(ws: Workspace, parquet: Path, limit: int) -> pa.Table:
    con = connect(ws)
    return con.execute(f"SELECT * FROM read_parquet({_lit(parquet)}) LIMIT {int(limit)}").fetch_arrow_table()


# -------------------------------------------------------------------- backlog paging
_SORTABLE = re.compile(r"^-?[A-Za-z_][A-Za-z0-9_]*$")


def page_table(
    table: pa.Table,
    *,
    sort: str = "-PI",
    page: int = 1,
    page_size: int = 50,
    filters: dict[str, Any] | None = None,
    search: str | None = None,
    search_columns: list[str] | None = None,
    min_cases: int | None = None,
) -> tuple[pa.Table, int]:
    """Filter, sort and page an Arrow table server-side. Returns ``(page, total)``."""
    con = connect()
    con.register("t", table)
    where: list[str] = []
    params: list[Any] = []
    cols = set(table.column_names)
    for col, value in (filters or {}).items():
        if col in cols and value is not None:
            where.append(f"{q(col)} = ?")
            params.append(value)
    if min_cases is not None and "n_cases" in cols:
        where.append("n_cases >= ?")
        params.append(int(min_cases))
    if search and search_columns:
        pieces = [f"lower(CAST({q(c)} AS VARCHAR)) LIKE ?" for c in search_columns if c in cols]
        if pieces:
            where.append("(" + " OR ".join(pieces) + ")")
            params.extend([f"%{search.lower()}%"] * len(pieces))
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total_row = con.execute(f"SELECT count(*) FROM t{clause}", params).fetchone()
    total = int(total_row[0]) if total_row else 0
    order = "ORDER BY "
    if not _SORTABLE.match(sort or ""):
        raise ValueError(f"invalid sort {sort!r}")
    desc = sort.startswith("-")
    col = sort.lstrip("-")
    if col not in cols:
        raise ValueError(f"cannot sort by {col!r}")
    order += f"{q(col)} {'DESC' if desc else 'ASC'} NULLS LAST"
    if col != "rank" and "rank" in cols:
        order += ", rank ASC"
    offset = max(page - 1, 0) * page_size
    result = con.execute(
        f"SELECT * FROM t{clause} {order} LIMIT {int(page_size)} OFFSET {int(offset)}", params
    ).fetch_arrow_table()
    return result, total


# -------------------------------------------------------------------- traces
def trace_events(ws: Workspace, events_parquet: Path, case_col: str, case_id: str) -> pa.Table:
    con = connect(ws)
    return con.execute(
        f"SELECT * FROM read_parquet({_lit(events_parquet)}) WHERE CAST({q(case_col)} AS VARCHAR) = ?", [case_id]
    ).fetch_arrow_table()


# -------------------------------------------------------------------- directly-follows
def directly_follows(
    ws: Workspace,
    events_parquet: Path,
    *,
    case_col: str,
    activity_col: str,
    timestamp_col: str,
    order_col: str | None = None,
    case_ids: pa.Table | None = None,
) -> dict[str, Any]:
    """Nodes, edges and start/end counts of the directly-follows graph.

    ``case_ids`` (an Arrow table with one column ``case_id``) restricts the
    graph to a slice.
    """
    con = connect(ws)
    src = f"read_parquet({_lit(events_parquet)})"
    join = ""
    if case_ids is not None:
        con.register("slice_cases", case_ids)
        join = f" WHERE CAST(e.{q(case_col)} AS VARCHAR) IN (SELECT CAST(case_id AS VARCHAR) FROM slice_cases)"
    order_by = f"e.{q(timestamp_col)}" + (f", e.{q(order_col)}" if order_col else "")
    con.execute(
        f"CREATE TEMP TABLE seq AS SELECT e.{q(case_col)} AS c, e.{q(activity_col)} AS a, e.{q(timestamp_col)} AS ts, "
        f"lead(e.{q(activity_col)}) OVER (PARTITION BY e.{q(case_col)} ORDER BY {order_by}) AS nxt, "
        f"lead(e.{q(timestamp_col)}) OVER (PARTITION BY e.{q(case_col)} ORDER BY {order_by}) AS nxt_ts, "
        f"row_number() OVER (PARTITION BY e.{q(case_col)} ORDER BY {order_by}) AS pos "
        f"FROM {src} e{join}"
    )
    n_cases_row = con.execute("SELECT count(DISTINCT c), count(*) FROM seq").fetchone()
    n_cases, n_events = (int(n_cases_row[0]), int(n_cases_row[1])) if n_cases_row else (0, 0)
    nodes = con.execute(
        "SELECT a, count(*) AS events, count(DISTINCT c) AS cases FROM seq WHERE a IS NOT NULL GROUP BY a"
    ).fetchall()
    edges = con.execute(
        "SELECT a, nxt, count(*) AS n, count(DISTINCT c) AS cases, "
        "quantile_cont(epoch(nxt_ts) - epoch(ts), 0.5) / 3600.0 AS median_hours "
        "FROM seq WHERE nxt IS NOT NULL AND a IS NOT NULL GROUP BY a, nxt"
    ).fetchall()
    starts = con.execute("SELECT a, count(*) FROM seq WHERE pos = 1 AND a IS NOT NULL GROUP BY a").fetchall()
    ends = con.execute("SELECT a, count(*) FROM seq WHERE nxt IS NULL AND a IS NOT NULL GROUP BY a").fetchall()
    con.execute("DROP TABLE seq")
    return {
        "cases": n_cases,
        "events": n_events,
        "nodes": [{"label": str(r[0]), "events": int(r[1]), "cases": int(r[2])} for r in nodes],
        "edges": [
            {
                "source": str(r[0]),
                "target": str(r[1]),
                "count": int(r[2]),
                "cases": int(r[3]),
                "median_hours": float(r[4]) if r[4] is not None else None,
            }
            for r in edges
        ],
        "starts": {str(r[0]): int(r[1]) for r in starts},
        "ends": {str(r[0]): int(r[1]) for r in ends},
    }


# -------------------------------------------------------------------- focus: incoming and outgoing paths
def focus_paths(
    ws: Workspace,
    events_parquet: Path,
    *,
    case_col: str,
    activity_col: str,
    timestamp_col: str,
    focus: str,
    order_col: str | None = None,
    case_ids: pa.Table | None = None,
    violated: pa.Table | None = None,
) -> dict[str, Any]:
    """Incoming and outgoing directly-follows paths of one activity: count, cases, median lag (hours) and the share of
    the cases on the path that violate at least one expectation (``violated``: an Arrow table ``case_id, violated``)."""
    con = connect(ws)
    src = f"read_parquet({_lit(events_parquet)})"
    join = ""
    if case_ids is not None:
        con.register("slice_cases", case_ids)
        join = f" WHERE CAST(e.{q(case_col)} AS VARCHAR) IN (SELECT CAST(case_id AS VARCHAR) FROM slice_cases)"
    order_by = f"e.{q(timestamp_col)}" + (f", e.{q(order_col)}" if order_col else "")
    con.execute(
        f"CREATE TEMP TABLE seq AS SELECT CAST(e.{q(case_col)} AS VARCHAR) AS c, e.{q(activity_col)} AS a, e.{q(timestamp_col)} AS ts, "
        f"lead(e.{q(activity_col)}) OVER (PARTITION BY e.{q(case_col)} ORDER BY {order_by}) AS nxt, "
        f"lead(e.{q(timestamp_col)}) OVER (PARTITION BY e.{q(case_col)} ORDER BY {order_by}) AS nxt_ts "
        f"FROM {src} e{join}"
    )
    if violated is not None:
        con.register("viol", violated)
        con.execute("CREATE TEMP TABLE v AS SELECT CAST(case_id AS VARCHAR) AS c, violated FROM viol")
    else:
        con.execute("CREATE TEMP TABLE v AS SELECT c, false AS violated FROM seq WHERE false")
    incoming = con.execute(
        "SELECT s.a, count(*) AS n, count(DISTINCT s.c) AS cases, "
        "quantile_cont(epoch(s.nxt_ts) - epoch(s.ts), 0.5) / 3600.0 AS median_hours, "
        "count(DISTINCT s.c) FILTER (WHERE v.violated) AS violated_cases "
        "FROM seq s LEFT JOIN v ON v.c = s.c WHERE s.nxt = ? AND s.a IS NOT NULL GROUP BY s.a ORDER BY n DESC",
        [focus],
    ).fetchall()
    outgoing = con.execute(
        "SELECT s.nxt, count(*) AS n, count(DISTINCT s.c) AS cases, "
        "quantile_cont(epoch(s.nxt_ts) - epoch(s.ts), 0.5) / 3600.0 AS median_hours, "
        "count(DISTINCT s.c) FILTER (WHERE v.violated) AS violated_cases "
        "FROM seq s LEFT JOIN v ON v.c = s.c WHERE s.a = ? AND s.nxt IS NOT NULL GROUP BY s.nxt ORDER BY n DESC",
        [focus],
    ).fetchall()
    total = con.execute("SELECT count(DISTINCT c), count(*) FROM seq WHERE a = ?", [focus]).fetchone()
    con.execute("DROP TABLE seq")
    con.execute("DROP TABLE v")

    def rows(data: list[Any], key: str) -> list[dict[str, Any]]:
        return [
            {
                key: str(r[0]),
                "count": int(r[1]),
                "cases": int(r[2]),
                "median_lag": float(r[3]) if r[3] is not None else None,
                "violation_share": (int(r[4]) / int(r[2])) if r[2] else None,
            }
            for r in data
        ]

    return {
        "activity": focus,
        "cases": int(total[0]) if total else 0,
        "events": int(total[1]) if total else 0,
        "incoming": rows(incoming, "from"),
        "outgoing": rows(outgoing, "to"),
    }
