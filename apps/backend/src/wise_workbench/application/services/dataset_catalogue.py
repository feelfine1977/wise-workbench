"""Read-only discovery of registered projects and explicitly linked local workspaces.

The listing is read-only; explicit selections use the regular ingestion job.
Listing only checks configured file metadata; it never reads event contents, starts jobs, probes servers or scans directories.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from wise_workbench.application.services.catalogue_context import CatalogueContext, public_log_context
from wise_workbench.application.services.datasets import _kind
from wise_workbench.domain import DatasetVersion, Job, NotFoundError, SourceKind
from wise_workbench.domain import ValidationError as DomainValidationError

if TYPE_CHECKING:
    from wise_workbench.container import Container


class WorkspaceLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    origin: str
    projectId: str = Field(pattern=r"^[a-zA-Z0-9_-]+$", max_length=160)
    description: str = Field(default="", max_length=500)

    @field_validator("origin")
    @classmethod
    def local_origin(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or any(c.isspace() or ord(c) < 32 for c in value)
            or "\\" in value
        ):
            raise ValueError("workspace origin must be an HTTP(S) loopback origin without credentials or a path")
        # Accessing port also rejects malformed/out-of-range ports.
        if parsed.port is not None and parsed.port == 0:
            raise ValueError("workspace port must be positive")
        return value.rstrip("/")


class LocalImportSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-zA-Z0-9_-]+$", max_length=160)
    name: str = Field(min_length=1, max_length=160)
    path: str = Field(min_length=1, max_length=4096)
    description: str = Field(default="", max_length=500)

    @field_validator("path")
    @classmethod
    def absolute_path(cls, value: str) -> str:
        if not Path(value).is_absolute():
            raise ValueError("local import paths must be absolute")
        return value


class WorkspaceLinksFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    workspaces: list[WorkspaceLink] = Field(default_factory=list, max_length=50)
    imports: list[LocalImportSpec] = Field(default_factory=list, max_length=100)

    @field_validator("imports")
    @classmethod
    def unique_imports(cls, entries: list[LocalImportSpec]) -> list[LocalImportSpec]:
        if len({entry.id for entry in entries}) != len(entries):
            raise ValueError("import IDs must be unique")
        return entries


class CatalogueDataset(BaseModel):
    id: str
    name: str
    status: str
    events: int | None
    error: str | None = None
    context: CatalogueContext | None = None


class CatalogueImport(LocalImportSpec):
    available: bool
    reason: str | None
    context: CatalogueContext | None = None
    dataset: CatalogueDataset | None = None


class CatalogueProject(BaseModel):
    id: str
    name: str
    process: str | None
    datasets: list[CatalogueDataset]


class DatasetCatalogue(BaseModel):
    projects: list[CatalogueProject]
    workspaces: list[WorkspaceLink]
    imports: list[CatalogueImport]
    warning: str | None = None


def dataset_catalogue(c: Container, project_id: str) -> DatasetCatalogue:
    c.projects.get(project_id)
    projects = [
        CatalogueProject(
            id=p.id,
            name=p.name,
            process=p.process,
            datasets=[catalogue_dataset(d) for d in c.datasets.list(p.id)],
        )
        for p in c.projects.list()
    ]
    registry, warning = read_registry(c.settings.workspace_path)
    current = c.datasets.list(project_id)
    imports = []
    for entry in registry.imports:
        checked = import_entry(entry, c.settings.max_upload_bytes)
        # Only current-project versions are selectable here. Never copy another project's data.
        matches = [d for d in current if d.source_path and same_source(d.source_path, entry.path)]
        if matches:
            checked.dataset = catalogue_dataset(max(matches, key=lambda d: d.created_at))
        imports.append(checked)
    return DatasetCatalogue(
        projects=projects,
        workspaces=registry.workspaces,
        imports=imports,
        warning=warning,
    )


def catalogue_dataset(dataset: DatasetVersion) -> CatalogueDataset:
    return CatalogueDataset(
        id=dataset.id,
        name=dataset.name,
        status=str(dataset.status),
        events=dataset.events,
        error=dataset.error,
        context=public_log_context(dataset.source_path or dataset.name),
    )


def same_source(a: str, b: str) -> bool:
    try:
        return Path(a).resolve() == Path(b).resolve()
    except (OSError, ValueError, RuntimeError):
        return False


def read_registry(workspace: Path) -> tuple[WorkspaceLinksFile, str | None]:
    path = workspace / "workspace-links.json"
    registry = WorkspaceLinksFile(version=1)
    warning = None
    try:
        # Bound both the read and parser input; a bad file must not hide current data.
        with path.open("rb") as stream:
            raw = stream.read(65_537)
        if len(raw) > 65_536:
            raise ValueError("catalogue exceeds 64 KiB")
        registry = WorkspaceLinksFile.model_validate_json(raw)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, ValidationError):
        warning = "The local catalogue could not be loaded. Check workspace-links.json; datasets in this workspace are still available."
    return registry, warning


def import_entry(entry: LocalImportSpec, max_bytes: int) -> CatalogueImport:
    path = Path(entry.path)
    reason = None
    try:
        if not path.is_file():
            reason = "File not available at the configured path."
        elif not 0 < path.stat().st_size <= max_bytes:
            reason = "File is empty or exceeds the server import size limit."
        else:
            kind = _kind(path.name)
            if kind == SourceKind.XES and importlib.util.find_spec("pm4py") is None:
                reason = (
                    "XES importer is not installed on this server. "
                    "Repair the backend environment with python -m pip install 'wise-workbench[xes]' "
                    "using the server's Python, then refresh the catalogue."
                )
    except DomainValidationError:
        reason = "Choose CSV, TSV, Parquet or XES (.xes or .xes.gz); prepare other archives separately."
    except (OSError, ValueError):
        reason = "File cannot be accessed by this server."
    return CatalogueImport(
        **entry.model_dump(),
        available=reason is None,
        reason=reason,
        context=public_log_context(entry.path),
    )


def import_catalogue_entry(c: Container, project_id: str, entry_id: str) -> tuple[str, Job]:
    c.projects.get(project_id)
    registry, warning = read_registry(c.settings.workspace_path)
    if warning:
        raise DomainValidationError(warning, code="catalogue.invalid")
    entry = next((entry for entry in registry.imports if entry.id == entry_id), None)
    if entry is None:
        raise NotFoundError("No configured import with that ID", code="catalogue.not_found")
    checked = import_entry(entry, c.settings.max_upload_bytes)
    if not checked.available:
        raise DomainValidationError(checked.reason or "Import unavailable", code="catalogue.unavailable")
    try:
        dataset, job = c.datasets.ingest_path(project_id, Path(entry.path), name=entry.name)
    except OSError as exc:
        raise DomainValidationError(
            "The configured source could not be read. Check its location and server file permissions, then refresh the catalogue.",
            code="catalogue.unavailable",
        ) from exc
    return dataset.id, job
