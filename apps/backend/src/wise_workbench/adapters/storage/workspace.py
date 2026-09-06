"""Workspace layout, atomic file writes and content hashing.

Layout::

    <workspace>/
      workbench.db
      projects/<project_id>/
        datasets/<dataset_id>/       source/<file>  events.parquet  schema.json  manifest.json
        case_tables/<case_table_id>/ cases.parquet  events.parquet  quality.json  activities.json  manifest.json
        norms/<norm_id>/vNNN.json
        runs/<run_id>/               frame.parquet violations.parquet in_scope.parquet summary.json
                                     backlogs/  drivers/  diagnostics/  analytics/<name>/<params_hash>.parquet  manifest.json
        notebook/<snapshot_id>.png   images of the analysis notebook
      cache/                         disposable
      tmp/                           staging area for atomic writes
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, BinaryIO

FORMAT_VERSION = 1


def _json_default(obj: Any) -> Any:
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "item"):
        return obj.item()
    if isinstance(obj, set | frozenset | tuple):
        return list(obj)
    raise TypeError(f"object of type {type(obj).__name__} is not JSON serialisable")


def dumps_json(data: Any, indent: int | None = 2) -> str:
    return json.dumps(data, indent=indent, ensure_ascii=False, default=_json_default, sort_keys=False)


class Workspace:
    """Paths inside the workspace plus atomic write helpers."""

    def __init__(self, root: Path):
        self.root = Path(root)
        (self.root / "projects").mkdir(parents=True, exist_ok=True)
        (self.root / "cache").mkdir(parents=True, exist_ok=True)
        (self.root / "tmp").mkdir(parents=True, exist_ok=True)
        marker = self.root / "workspace.json"
        if not marker.exists():
            self.write_json(marker, {"format_version": FORMAT_VERSION})

    # ----------------------------------------------------------------- paths
    def project_dir(self, project_id: str) -> Path:
        return self.root / "projects" / project_id

    def dataset_dir(self, project_id: str, dataset_id: str) -> Path:
        return self.project_dir(project_id) / "datasets" / dataset_id

    def case_table_dir(self, project_id: str, case_table_id: str) -> Path:
        return self.project_dir(project_id) / "case_tables" / case_table_id

    def norm_dir(self, project_id: str, norm_id: str) -> Path:
        return self.project_dir(project_id) / "norms" / norm_id

    def norm_version_path(self, project_id: str, norm_id: str, version: int) -> Path:
        return self.norm_dir(project_id, norm_id) / f"v{version:03d}.json"

    def run_dir(self, project_id: str, run_id: str) -> Path:
        return self.project_dir(project_id) / "runs" / run_id

    def notebook_dir(self, project_id: str) -> Path:
        """Images of the analysis notebook's snapshots."""
        return self.project_dir(project_id) / "notebook"

    @property
    def cache_dir(self) -> Path:
        return self.root / "cache"

    @property
    def tmp_dir(self) -> Path:
        return self.root / "tmp"

    # --------------------------------------------------------------- writing
    @contextmanager
    def staging(self, final: Path) -> Iterator[Path]:
        """Yield a temporary path next to ``final``; rename atomically on success."""
        final.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{final.name}.", suffix=".tmp", dir=final.parent)
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            yield tmp
            os.replace(tmp, final)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def write_json(self, path: Path, data: Any) -> Path:
        with self.staging(path) as tmp:
            tmp.write_text(dumps_json(data), encoding="utf-8")
        return path

    def write_text(self, path: Path, text: str) -> Path:
        with self.staging(path) as tmp:
            tmp.write_text(text, encoding="utf-8")
        return path

    def read_json(self, path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    def store_upload(self, dest: Path, stream: BinaryIO, chunk_size: int = 4 * 1024 * 1024) -> tuple[int, str]:
        """Copy a stream to ``dest`` atomically; return ``(size, sha256)``."""
        digest = hashlib.sha256()
        size = 0
        with self.staging(dest) as tmp, tmp.open("wb") as out:
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        return size, digest.hexdigest()

    def remove_tree(self, path: Path) -> None:
        if path.exists():
            shutil.rmtree(path)


def sha256_file(path: Path, chunk_size: int = 4 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()
