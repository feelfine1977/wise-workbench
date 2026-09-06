"""``ingest``: source file → ``events.parquet`` + column profile; the dataset becomes ``ready``."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import ColumnProfile, DatasetStatus, NotFoundError
from wise_workbench.jobs.worker import JobContext

SOURCE_KINDS = {
    ".csv": "csv",
    ".txt": "csv",
    ".tsv": "csv",
    ".parquet": "parquet",
    ".pq": "parquet",
    ".xes": "xes",
    ".gz": "xes",
}


def source_kind(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".xes.gz"):
        return "xes"
    return SOURCE_KINDS.get(path.suffix.lower(), "csv")


def run(ctx: JobContext) -> str:
    return perform(ctx.container, ctx.payload["datasetId"], ctx.progress)


def perform(c: Any, dataset_id: str, progress: ProgressFn) -> str:
    """Ingest one dataset version; shared by the ``ingest`` job and the preset job."""
    dataset = c.repos.get_dataset(dataset_id)
    if not dataset.source_path:
        raise NotFoundError(f"dataset {dataset.id} has no source file", code="dataset.no_source")
    source = Path(dataset.source_path)
    if not source.exists():
        raise NotFoundError(f"source file {source} is missing", code="dataset.no_source")
    dest = c.workspace.dataset_dir(dataset.project_id, dataset.id)
    dest.mkdir(parents=True, exist_ok=True)
    info = c.engine.ingest(source, source_kind(source), dest, progress)
    manifest = {
        "datasetId": dataset.id,
        "name": dataset.name,
        "sourceName": source.name,
        "sourceKind": source_kind(source),
        "contentHash": dataset.content_hash,
        "events": info["events"],
        "columns": [p["name"] for p in info["columns"]],
        "encoding": info.get("encoding"),
        "writtenAt": datetime.now(UTC).isoformat(),
    }
    c.workspace.write_json(dest / "manifest.json", manifest)
    updated = replace(
        dataset,
        status=DatasetStatus.READY,
        events=int(info["events"]),
        columns=tuple(ColumnProfile.from_dict(p) for p in info["columns"]),
        error=None,
    )
    c.repos.update_dataset(updated)
    return f"dataset:{dataset.id}"


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    c = ctx.container
    dataset = c.repos.get_dataset(ctx.payload["datasetId"])
    if dataset.status == DatasetStatus.INGESTING:
        c.repos.update_dataset(replace(dataset, status=DatasetStatus.FAILED, error=error or status))
