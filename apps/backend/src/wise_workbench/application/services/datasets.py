"""Datasets: uploads and local files become dataset versions through the ``ingest`` job."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO

from wise_workbench.adapters.storage import sha256_file
from wise_workbench.domain import (
    DatasetStatus,
    DatasetVersion,
    Job,
    JobKind,
    NotFoundError,
    SourceKind,
    ValidationError,
)
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

_KINDS = {
    ".csv": SourceKind.CSV,
    ".txt": SourceKind.CSV,
    ".tsv": SourceKind.CSV,
    ".parquet": SourceKind.PARQUET,
    ".pq": SourceKind.PARQUET,
    ".xes": SourceKind.XES,
}


def _kind(filename: str) -> SourceKind:
    lower = filename.lower()
    if lower.endswith(".xes.gz"):
        return SourceKind.XES
    suffix = Path(lower).suffix
    if suffix not in _KINDS:
        raise ValidationError(
            f"unsupported file type {suffix!r}; upload CSV, Parquet or XES",
            code="dataset.kind",
            errors=[{"field": "file", "message": "unsupported type"}],
        )
    return _KINDS[suffix]


class DatasetService:
    def __init__(self, c: Container):
        self.c = c

    def upload(
        self, project_id: str, filename: str, stream: BinaryIO, name: str | None = None
    ) -> tuple[DatasetVersion, Job]:
        self.c.repos.get_project(project_id)
        kind = _kind(filename)
        dataset_id = new_id("ds")
        safe_name = Path(filename).name or "upload"
        dest = self.c.workspace.dataset_dir(project_id, dataset_id) / "source" / safe_name
        size, digest = self.c.workspace.store_upload(dest, stream)
        if size == 0:
            raise ValidationError(
                "the uploaded file is empty", code="dataset.empty", errors=[{"field": "file", "message": "empty"}]
            )
        if size > self.c.settings.max_upload_bytes:
            raise ValidationError("the uploaded file exceeds the size limit", code="dataset.too_large")
        return self._register(project_id, dataset_id, name or safe_name, kind, dest, digest)

    def ingest_path(self, project_id: str, path: Path, name: str | None = None) -> tuple[DatasetVersion, Job]:
        """Register a local file without copying it (desktop and CLI use)."""
        self.c.repos.get_project(project_id)
        path = Path(path).expanduser().resolve()
        if not path.exists():
            raise NotFoundError(f"file {path} not found", code="dataset.no_source")
        kind = _kind(path.name)
        digest = sha256_file(path)
        return self._register(project_id, new_id("ds"), name or path.name, kind, path, digest)

    def _register(
        self, project_id: str, dataset_id: str, name: str, kind: SourceKind, source: Path, digest: str
    ) -> tuple[DatasetVersion, Job]:
        dataset = DatasetVersion(
            id=dataset_id,
            project_id=project_id,
            name=name,
            status=DatasetStatus.INGESTING,
            source_kind=kind,
            source_path=str(source),
            content_hash=digest,
        )
        self.c.repos.add_dataset(dataset)
        job = self.c.queue.enqueue(
            str(JobKind.INGEST), {"projectId": project_id, "datasetId": dataset_id}, project_id=project_id
        )
        dataset = replace(dataset, job_id=job.id)
        self.c.repos.update_dataset(dataset)
        return dataset, job

    def get(self, project_id: str, dataset_id: str) -> DatasetVersion:
        d = self.c.repos.get_dataset(dataset_id)
        if d.project_id != project_id:
            raise NotFoundError(f"dataset {dataset_id!r} not found in project {project_id!r}", code="dataset.not_found")
        return d

    def list(self, project_id: str) -> list[DatasetVersion]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_datasets(project_id)

    def preview(self, project_id: str, dataset_id: str, rows: int = 50) -> dict[str, Any]:
        d = self.get(project_id, dataset_id)
        if d.status != DatasetStatus.READY:
            raise ValidationError(f"dataset {dataset_id} is {d.status}", code="dataset.not_ready")
        return self.c.engine.preview(self.c.workspace.dataset_dir(project_id, dataset_id), rows)
