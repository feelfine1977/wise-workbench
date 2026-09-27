"""Immutable cohort artifacts. IDs stay server-side; metadata binds them to exact source bytes."""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from wise_workbench.domain import ColumnMapping, ConflictError, NotFoundError, ValidationError

from .workspace import sha256_file


def checksum(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


@lru_cache(maxsize=128)
def _file_checksum(path: str, stamp: tuple[int, ...]) -> str:
    return sha256_file(Path(path))


def file_checksum(path: Path) -> str:
    try:
        stat = path.stat()
        stamp = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        result = _file_checksum(str(path.resolve()), stamp)
        after = path.stat()
        if stamp != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ConflictError("The prepared source changed while reading it", code="selection.source_changed")
        return result
    except FileNotFoundError as exc:
        raise ConflictError(
            "The prepared source is missing; rebuild and save a new selection", code="selection.source_changed"
        ) from exc


def source_identity(directory: Path, mapping: ColumnMapping, content_hash: str | None) -> dict[str, Any]:
    return {
        "mappingId": mapping.id,
        "mappingChecksum": checksum(mapping.to_dict()),
        "datasetContentHash": content_hash,
        "casesChecksum": file_checksum(directory / "cases.parquet"),
        "eventsChecksum": file_checksum(directory / "events.parquet"),
    }


def selection_path(directory: Path, selection_id: str) -> Path:
    if not re.fullmatch(r"sel_[a-z0-9]{17,24}", selection_id):
        raise ValidationError("Invalid saved selection ID", code="selection.id")
    return directory / "selections" / f"{selection_id}.json"


def read_selection(directory: Path, mapping: ColumnMapping, selection_id: str) -> tuple[dict[str, Any], list[str]]:
    path = selection_path(directory, selection_id)
    try:
        record = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise NotFoundError("Saved selection not found for this case table", code="selection.not_found") from exc
    except (ValueError, UnicodeError) as exc:
        raise ConflictError("Saved selection artifact is corrupt", code="selection.corrupt") from exc
    try:
        metadata, members = record["metadata"], record["memberIds"]
        valid = (
            record["checksum"] == checksum({"metadata": metadata, "memberIds": members})
            and isinstance(members, list)
            and bool(members)
            and all(isinstance(item, str) for item in members)
            and len(set(members)) == len(members) == metadata["cases"]
            and checksum(members) == metadata["membershipChecksum"]
            and metadata["id"] == selection_id
            and metadata["semanticsVersion"] == "eda-v1"
        )
        if not valid:
            raise ValueError("invalid record")
        if (
            metadata["caseTableId"] != directory.name
            or metadata["projectId"] != directory.parent.parent.name
            or metadata["datasetId"] != mapping.dataset_id
        ):
            raise ConflictError("Saved selection belongs to a different source", code="selection.source_mismatch")
        current = source_identity(directory, mapping, metadata["source"]["datasetContentHash"])
        if metadata["source"] != current:
            raise ConflictError(
                "Prepared data or mapping changed; save a new selection", code="selection.source_changed"
            )
        return metadata, members
    except (KeyError, TypeError, ValueError) as exc:
        raise ConflictError("Saved selection artifact is corrupt", code="selection.corrupt") from exc
