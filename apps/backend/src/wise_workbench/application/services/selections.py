"""Save/read exact EDA cohorts without changing source data or a historical run."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import duckdb
import pyarrow as pa

from wise_workbench.adapters.storage.selections import checksum, read_selection, selection_path, source_identity
from wise_workbench.api.schema_models.eda import EDARequest
from wise_workbench.api.schema_models.selections import SavedSelectionCreate
from wise_workbench.domain import CaseTableStatus, ConflictError, ValidationError
from wise_workbench.ids import new_id

from .eda import _quote, aggregate_eda

if TYPE_CHECKING:
    from wise_workbench.container import Container


def selection_context(c: Container, project_id: str, table_id: str):
    table = c.mappings.get_case_table(project_id, table_id)
    if table.status != CaseTableStatus.READY:
        raise ValidationError("Wait for the case table build before saving a selection", code="case_table.not_ready")
    mapping = c.mappings.get_mapping(table.mapping_id)
    dataset = c.repos.get_dataset(table.dataset_id)
    if dataset.project_id != project_id or mapping.dataset_id != table.dataset_id:
        raise ConflictError("Case table source identity does not match", code="selection.source_mismatch")
    return table, mapping, dataset, c.workspace.case_table_dir(project_id, table_id)


def get_selection(c: Container, project_id: str, table_id: str, selection_id: str) -> dict[str, Any]:
    _table, mapping, dataset, directory = selection_context(c, project_id, table_id)
    metadata, _members = read_selection(directory, mapping, selection_id)
    if metadata["source"]["datasetContentHash"] != dataset.content_hash:
        raise ConflictError("Dataset identity changed; save a new selection", code="selection.source_changed")
    return metadata


def list_selections(c: Container, project_id: str, table_id: str) -> list[dict[str, Any]]:
    _table, _mapping, _dataset, directory = selection_context(c, project_id, table_id)
    return [
        get_selection(c, project_id, table_id, path.stem)
        for path in sorted((directory / "selections").glob("sel_*.json"))
    ]


def create_selection(c: Container, project_id: str, table_id: str, body: SavedSelectionCreate) -> dict[str, Any]:
    table, mapping, dataset, directory = selection_context(c, project_id, table_id)
    if body.datasetId != table.dataset_id:
        raise ConflictError("The selected dataset does not own this case table", code="selection.source_mismatch")
    before = source_identity(directory, mapping, dataset.content_hash)
    selection = body.selection.model_dump(by_alias=True, exclude_none=True) if body.selection is not None else {}
    resolved = aggregate_eda(
        directory / "cases.parquet",
        mapping,
        EDARequest(
            datasetId=body.datasetId,
            attribute=body.attribute,
            selection=json.dumps(selection) if selection is not None else None,
        ),
        members_only=True,
    )
    members = resolved["memberIds"]
    if not members:
        raise ValidationError(
            "This selection contains no cases; change its filters before saving", code="selection.empty"
        )
    with duckdb.connect(":memory:") as con:
        con.read_parquet(str(directory / "events.parquet")).create_view("events")
        con.register("members", pa.table({"id": members}))
        absent = con.execute(
            f"SELECT count(*) FROM members m WHERE NOT EXISTS (SELECT 1 FROM events e WHERE CAST(e.{_quote(mapping.case_id)} AS VARCHAR) = m.id)"
        ).fetchone()[0]
        if absent:
            raise ValidationError("Selected cases are absent from the prepared event log", code="selection.case_ids")
    if before != source_identity(directory, mapping, dataset.content_hash):
        raise ConflictError("Prepared source changed while saving; try again", code="selection.source_changed")
    metadata = {
        "id": new_id("sel"),
        "name": body.name,
        "projectId": project_id,
        "datasetId": table.dataset_id,
        "caseTableId": table.id,
        "cases": len(members),
        "createdAt": datetime.now(UTC).isoformat(),
        "attribute": resolved["attribute"],
        "selection": selection,
        "membershipChecksum": checksum(members),
        "source": before,
        "semanticsVersion": "eda-v1",
    }
    record = {"metadata": metadata, "memberIds": members}
    # Unique IDs and atomic publication; no update/delete route can change membership.
    path = selection_path(directory, metadata["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    # Publish a complete single artifact with a no-overwrite hard link, so even a
    # colliding ID can never alter a cohort referenced by historical runs.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, suffix=".tmp") as staged:
        json.dump({**record, "checksum": checksum(record)}, staged, ensure_ascii=False)
        staged.flush()
        os.fsync(staged.fileno())
        try:
            os.link(staged.name, path)
        except FileExistsError as exc:
            raise ConflictError("Saved selection ID already exists; try again", code="selection.exists") from exc
    return metadata
