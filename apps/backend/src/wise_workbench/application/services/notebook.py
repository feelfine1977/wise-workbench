"""The analysis notebook: snapshots of analysis screens per project, ordered, exported to Markdown (with images).

PowerPoint export (cycle 4) plugs into :data:`EXPORTERS`; a format without an exporter answers 422 with the
formats that exist.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, BinaryIO

from wise_workbench.domain import NotFoundError, Snapshot, ValidationError
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

MAX_IMAGE_BYTES = 25 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

Exporter = Callable[["NotebookService", str, list[Snapshot]], tuple[bytes, str, str]]


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "snapshot"


def export_markdown(service: NotebookService, project_id: str, snapshots: list[Snapshot]) -> tuple[bytes, str, str]:
    """A zip with ``notebook.md`` and the images under ``images/``; returns ``(bytes, media type, file name)``."""
    project = service.c.repos.get_project(project_id)
    lines = [
        f"# {project.name} — analysis notebook",
        "",
        f"Exported {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')} UTC.",
        "",
    ]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, snap in enumerate(snapshots, start=1):
            lines.append(f"## {i}. {snap.title}")
            lines.append("")
            image = service.image_bytes(snap)
            if image is not None:
                name = f"images/{i:02d}-{_slug(snap.title)}.png"
                zf.writestr(name, image)
                lines.append(f"![{snap.title}]({name})")
                lines.append("")
            if snap.note:
                lines.append(snap.note.strip())
                lines.append("")
            context = {k: v for k, v in snap.context.items() if v not in (None, "", [], {})}
            if context:
                lines.append(
                    "Context: "
                    + "; ".join(
                        f"{k} = {json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v}"
                        for k, v in context.items()
                    )
                )
                lines.append("")
            if snap.data is not None:
                data_name = f"data/{i:02d}-{_slug(snap.title)}.json"
                zf.writestr(data_name, json.dumps(snap.data, indent=2, ensure_ascii=False))
                lines.append(f"Data: `{data_name}`")
                lines.append("")
            author = snap.author or "unknown author"
            lines.append(f"*Frozen {snap.created_at.strftime('%Y-%m-%d %H:%M')} by {author}.*")
            lines.append("")
        zf.writestr("notebook.md", "\n".join(lines))
    return buffer.getvalue(), "application/zip", f"{_slug(project.name)}-notebook.zip"


EXPORTERS: dict[str, Exporter] = {"markdown": export_markdown}
# "pptx": one slide per snapshot (title, image, note, context footer) is not available yet (python-pptx).


class NotebookService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- write
    def add(
        self,
        project_id: str,
        *,
        title: str,
        note: str = "",
        context: dict[str, Any] | None = None,
        data: Any = None,
        author: str | None = None,
        image: BinaryIO | None = None,
        image_name: str | None = None,
    ) -> Snapshot:
        self.c.repos.get_project(project_id)
        existing = self.c.repos.list_snapshots(project_id)
        snap = Snapshot(
            id=new_id("snap"),
            project_id=project_id,
            title=title.strip(),
            note=note or "",
            context=dict(context or {}),
            data=data,
            order=len(existing),
            author=author,
        )
        if image is not None:
            snap = snap.edited(image_path=self._store_image(project_id, snap.id, image, image_name))
        return self.c.repos.add_snapshot(snap)

    def _store_image(self, project_id: str, snapshot_id: str, stream: BinaryIO, name: str | None) -> str:
        head = stream.read(8)
        if head != PNG_MAGIC:
            raise ValidationError(
                "the snapshot image must be a PNG file",
                code="snapshot.image",
                errors=[{"field": "image", "message": "not a PNG"}],
            )
        stream.seek(0)
        dest = self.c.workspace.notebook_dir(project_id) / f"{snapshot_id}.png"
        size, _digest = self.c.workspace.store_upload(dest, stream)
        if size > MAX_IMAGE_BYTES:
            dest.unlink(missing_ok=True)
            raise ValidationError("the snapshot image is larger than 25 MB", code="snapshot.image_too_large")
        return str(dest.relative_to(self.c.workspace.root))

    def update(
        self,
        project_id: str,
        snapshot_id: str,
        *,
        title: str | None = None,
        note: str | None = None,
        context: dict[str, Any] | None = None,
        data: Any = None,
        author: str | None = None,
        image: BinaryIO | None = None,
        image_name: str | None = None,
    ) -> Snapshot:
        snap = self.get(project_id, snapshot_id)
        changes: dict[str, Any] = {}
        if title is not None:
            changes["title"] = title.strip()
        if note is not None:
            changes["note"] = note
        if context is not None:
            changes["context"] = dict(context)
        if data is not None:
            changes["data"] = data
        if author is not None:
            changes["author"] = author
        if image is not None:
            changes["image_path"] = self._store_image(project_id, snap.id, image, image_name)
        return self.c.repos.update_snapshot(snap.edited(**changes))

    def delete(self, project_id: str, snapshot_id: str) -> None:
        snap = self.get(project_id, snapshot_id)
        if snap.image_path:
            (self.c.workspace.root / snap.image_path).unlink(missing_ok=True)
        self.c.repos.delete_snapshot(snap.id)
        remaining = [s.id for s in self.c.repos.list_snapshots(project_id)]
        self.c.repos.set_snapshot_order(project_id, remaining)

    def reorder(self, project_id: str, ordered_ids: list[str]) -> list[Snapshot]:
        known = {s.id for s in self.c.repos.list_snapshots(project_id)}
        unknown = [i for i in ordered_ids if i not in known]
        if unknown:
            raise NotFoundError(f"snapshots not in this notebook: {unknown}", code="snapshot.not_found")
        if len(set(ordered_ids)) != len(ordered_ids):
            raise ValidationError("every snapshot id once", code="snapshot.order")
        self.c.repos.set_snapshot_order(project_id, ordered_ids)
        return self.list(project_id)

    # ------------------------------------------------------------- read
    def get(self, project_id: str, snapshot_id: str) -> Snapshot:
        snap = self.c.repos.get_snapshot(snapshot_id)
        if snap.project_id != project_id:
            raise NotFoundError(
                f"snapshot {snapshot_id!r} not found in project {project_id!r}", code="snapshot.not_found"
            )
        return snap

    def list(self, project_id: str) -> list[Snapshot]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_snapshots(project_id)

    def image_bytes(self, snap: Snapshot) -> bytes | None:
        if not snap.image_path:
            return None
        path = self.c.workspace.root / snap.image_path
        return path.read_bytes() if path.exists() else None

    def export(self, project_id: str, fmt: str) -> tuple[bytes, str, str]:
        exporter = EXPORTERS.get(fmt)
        if exporter is None:
            raise ValidationError(
                f"export format {fmt!r} is not available; formats: {sorted(EXPORTERS)} (PowerPoint is not available yet)",
                code="notebook.format",
            )
        return exporter(self, project_id, self.list(project_id))
