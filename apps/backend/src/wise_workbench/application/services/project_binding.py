"""Explicit, write-once project dataset identity, shared by all server processes."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import ConflictError, DatasetStatus

if TYPE_CHECKING:
    from wise_workbench.container import Container


def _path(c: Container, project_id: str) -> Path:
    c.repos.get_project(project_id)
    return c.workspace.project_dir(project_id) / "dataset-binding.json"


def get_binding(c: Container, project_id: str) -> dict[str, Any]:
    """Read only: neither a dataset list nor a latest-run pointer establishes a binding."""
    path = _path(c, project_id)
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"projectId": project_id, "datasetId": None, "boundAt": None}
    except (OSError, ValueError) as exc:
        raise ConflictError(
            "The saved project dataset binding cannot be read. Restore it before continuing.",
            code="project.dataset_binding_invalid",
        ) from exc
    try:
        valid = (
            isinstance(saved, dict)
            and saved.get("version") == 1
            and saved.get("projectId") == project_id
            and isinstance(saved.get("datasetId"), str)
            and bool(saved["datasetId"])
            and isinstance(saved.get("boundAt"), str)
            and datetime.fromisoformat(saved["boundAt"]).tzinfo is not None
        )
    except ValueError:
        valid = False
    if not valid:
        raise ConflictError(
            "The saved project dataset binding is invalid. It cannot be replaced by a new selection.",
            code="project.dataset_binding_invalid",
        )
    # A missing or foreign dataset is never silently reinterpreted as an unbound project.
    c.datasets.get(project_id, saved["datasetId"])
    return {key: saved[key] for key in ("projectId", "datasetId", "boundAt")}


def bind_dataset(c: Container, project_id: str, dataset_id: str) -> dict[str, Any]:
    path = _path(c, project_id)
    dataset = c.datasets.get(project_id, dataset_id)
    existing = get_binding(c, project_id)
    if existing["datasetId"] is not None:
        return _same_binding(existing, dataset_id)
    if dataset.status != DatasetStatus.READY:
        raise ConflictError(
            "Wait for a successful dataset import before selecting it for this project.",
            code="project.dataset_not_ready",
        )
    saved = {"version": 1, "projectId": project_id, "datasetId": dataset_id, "boundAt": datetime.now(UTC).isoformat()}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".dataset-binding-", suffix=".tmp", dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(saved, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # Same-filesystem hard-link publication is atomic and cannot overwrite a competing winner.
            # Workspace.write_json uses replace(), which would permit a silent rebind here.
            os.link(temp, path)
        except FileExistsError:
            return _same_binding(get_binding(c, project_id), dataset_id)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temp.unlink(missing_ok=True)
    return {key: saved[key] for key in ("projectId", "datasetId", "boundAt")}


def _same_binding(binding: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    if binding["datasetId"] != dataset_id:
        raise ConflictError(
            "This project already has a fixed dataset. Create a new project to use another dataset.",
            code="project.dataset_already_bound",
        )
    return binding


def require_dataset_binding(c: Container, project_id: str, case_table_id: str) -> dict[str, Any]:
    """Guard NEW assessments; historical assessment reads must keep their original identities."""
    table = c.mappings.get_case_table(project_id, case_table_id)
    binding = get_binding(c, project_id)
    if binding["datasetId"] is None:
        raise ConflictError(
            "Select and confirm the project dataset before running an assessment.",
            code="project.dataset_binding_required",
        )
    if table.dataset_id != binding["datasetId"]:
        raise ConflictError(
            "This case table belongs to a different dataset than the project's fixed dataset.",
            code="project.dataset_binding_mismatch",
        )
    return binding
