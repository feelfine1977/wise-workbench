"""Storage adapter: atomic writes, Parquet round-trips, DuckDB ingest/profile/paging."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pytest

from wise_workbench.adapters.storage import Workspace, duck, sha256_file
from wise_workbench.adapters.storage.parquet import read_frame, write_frame


def test_workspace_layout_and_marker(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    assert (ws.root / "projects").is_dir() and (ws.root / "cache").is_dir() and (ws.root / "tmp").is_dir()
    assert json.loads((ws.root / "workspace.json").read_text())["format_version"] == 1
    assert ws.norm_version_path("p", "n", 3) == ws.root / "projects" / "p" / "norms" / "n" / "v003.json"
    assert ws.run_dir("p", "r") == ws.root / "projects" / "p" / "runs" / "r"


def test_atomic_write_leaves_nothing_behind_on_failure(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    target = ws.project_dir("p") / "manifest.json"
    with pytest.raises(RuntimeError), ws.staging(target) as tmp:
        tmp.write_text("partial")
        raise RuntimeError("crash while writing")
    assert not target.exists()
    assert list(target.parent.glob(".manifest.json.*")) == []
    ws.write_json(target, {"ok": True})
    assert ws.read_json(target) == {"ok": True}


def test_upload_hash_matches_file_hash(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    src = tmp_path / "src.bin"
    src.write_bytes(b"x" * 10_000)
    dest = ws.dataset_dir("p", "d") / "source" / "src.bin"
    with src.open("rb") as fh:
        size, digest = ws.store_upload(dest, fh, chunk_size=1024)
    assert size == 10_000 and digest == sha256_file(src) == sha256_file(dest)


def test_parquet_round_trip_keeps_index_and_timestamps(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    df = pd.DataFrame(
        {"n": [1, 2], "when": pd.to_datetime(["2024-01-01", "2024-02-01"]), "label": ["a", None]},
        index=pd.Index(["c1", "c2"], name="case"),
    )
    path = write_frame(ws, ws.run_dir("p", "r") / "frame.parquet", df)
    back = read_frame(path, index="case")
    pd.testing.assert_frame_equal(back, df, check_dtype=False)
    assert list(read_frame(path).columns) == ["case", "n", "when", "label"]


def test_csv_ingest_strips_headers_and_handles_latin1(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    csv = tmp_path / "log.csv"
    csv.write_bytes(
        '"case ","activity","time","amount"\n"c1","Récéption",2024-01-01 10:00:00,1.5\n"c2","B",2024-01-02 11:00:00,\n'.encode(
            "latin-1"
        )
    )
    dest = ws.dataset_dir("p", "d") / "events.parquet"
    info = duck.csv_to_parquet(ws, csv, dest)
    assert info["rows"] == 2 and info["columns"] == ["case", "activity", "time", "amount"]
    profiles = {p["name"]: p for p in duck.profile_columns(ws, dest)}
    assert profiles["time"]["dtype"] == "timestamp"
    assert profiles["amount"]["dtype"] == "number" and profiles["amount"]["nulls"] == 0.5
    assert profiles["case"]["distinct"] == 2
    columns, rows = duck.preview(ws, dest, rows=1)
    assert columns == ["case", "activity", "time", "amount"] and rows[0][1] == "Récéption"


def test_page_table_sorts_filters_and_pages() -> None:
    table = pa.table(
        {
            "key": ['["a"]', '["b"]', '["c"]', '["d"]'],
            "company": ["a", "b", "c", "d"],
            "n_cases": [10, 40, 5, 30],
            "PI": [1.0, 4.0, 0.5, 3.0],
            "rank": [3, 1, 4, 2],
            "hotspot_type": ["mechanism", "reservoir", None, "severity"],
        }
    )
    page, total = duck.page_table(table, sort="-PI", page=1, page_size=2)
    assert total == 4 and page.column("company").to_pylist() == ["b", "d"]
    page, total = duck.page_table(table, sort="n_cases", page=2, page_size=2, min_cases=6)
    assert total == 3 and page.column("company").to_pylist() == ["b"]
    page, total = duck.page_table(table, sort="-PI", page=1, page_size=10, filters={"hotspot_type": "severity"})
    assert total == 1 and page.column("company").to_pylist() == ["d"]
    page, total = duck.page_table(table, sort="-PI", page=1, page_size=10, search="B", search_columns=["company"])
    assert total == 1
    with pytest.raises(ValueError):
        duck.page_table(table, sort="nope", page=1, page_size=10)
    with pytest.raises(ValueError):
        duck.page_table(table, sort="PI; DROP TABLE t", page=1, page_size=10)


def test_directly_follows_counts_edges_and_starts(tmp_path: Path) -> None:
    ws = Workspace(tmp_path / "ws")
    events = pd.DataFrame(
        {
            "case": ["1", "1", "1", "2", "2"],
            "activity": ["A", "B", "C", "A", "C"],
            "time": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-01", "2024-01-05"]),
        }
    )
    path = write_frame(ws, ws.case_table_dir("p", "c") / "events.parquet", events, index=False)
    dfg = duck.directly_follows(ws, path, case_col="case", activity_col="activity", timestamp_col="time")
    assert dfg["cases"] == 2 and dfg["events"] == 5
    edges = {(e["source"], e["target"]): e for e in dfg["edges"]}
    assert edges[("A", "B")]["count"] == 1 and edges[("A", "C")]["median_hours"] == 96.0
    assert dfg["starts"] == {"A": 2} and dfg["ends"] == {"C": 2}
    sliced = duck.directly_follows(
        ws, path, case_col="case", activity_col="activity", timestamp_col="time", case_ids=pa.table({"case_id": ["2"]})
    )
    assert sliced["cases"] == 1 and len(sliced["edges"]) == 1
