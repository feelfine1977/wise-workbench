"""The analysis notebook: frozen snapshots per project, ordered, exported to Markdown with images."""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, Response, UploadFile, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep
from wise_workbench.domain import NotFoundError, ValidationError

router = APIRouter(prefix="/projects/{projectId}/notebook", tags=["notebook"])


def _payload(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    try:
        obj = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"payload is not valid JSON: {exc}", code="snapshot.payload") from exc
    if not isinstance(obj, dict):
        raise ValidationError("payload must be a JSON object", code="snapshot.payload")
    return obj


@router.get("", operation_id="getNotebook", response_model=schemas.Notebook)
def get_notebook(projectId: str, c: ContainerDep) -> schemas.Notebook:
    from wise_workbench.application.services.notebook import EXPORTERS

    return schemas.Notebook(
        projectId=projectId,
        snapshots=[schemas.Snapshot.from_domain(s) for s in c.notebook.list(projectId)],
        exportFormats=sorted(EXPORTERS),
    )


@router.post(
    "/snapshots",
    operation_id="createSnapshot",
    response_model=schemas.Snapshot,
    status_code=status.HTTP_201_CREATED,
    description=(
        "Freeze a screen: multipart with an optional PNG `image` and a JSON `payload` "
        "({title, note, context {run_id, slicing, view, filters, url, screen}, data, author}); "
        "the title may also come as a form field."
    ),
)
def create_snapshot(
    projectId: str,
    c: ContainerDep,
    image: Annotated[UploadFile | None, File()] = None,
    payload: Annotated[str | None, Form()] = None,
    title: Annotated[str | None, Form()] = None,
    note: Annotated[str | None, Form()] = None,
) -> schemas.Snapshot:
    body = _payload(payload)
    body_title = str(title or body.get("title") or "")
    snap = c.notebook.add(
        projectId,
        title=body_title,
        note=str(note if note is not None else body.get("note") or ""),
        context=dict(body.get("context") or {}),
        data=body.get("data"),
        author=body.get("author"),
        image=image.file if image is not None else None,
        image_name=image.filename if image is not None else None,
    )
    return schemas.Snapshot.from_domain(snap)


@router.post(
    "/reorder",
    operation_id="reorderSnapshots",
    response_model=schemas.Notebook,
    description="The snapshots in the given order; snapshots not listed keep their relative order after them.",
)
def reorder_snapshots(projectId: str, body: schemas.SnapshotOrder, c: ContainerDep) -> schemas.Notebook:
    from wise_workbench.application.services.notebook import EXPORTERS

    snaps = c.notebook.reorder(projectId, body.ids)
    return schemas.Notebook(
        projectId=projectId, snapshots=[schemas.Snapshot.from_domain(s) for s in snaps], exportFormats=sorted(EXPORTERS)
    )


@router.get(
    "/export",
    operation_id="exportNotebook",
    description="The notebook as a zip: `notebook.md` with the images under `images/` (format=markdown); PowerPoint arrives in cycle 4.",
    responses={200: {"content": {"application/zip": {}}, "description": "a zip file"}, 422: {"model": schemas.Problem}},
)
def export_notebook(projectId: str, c: ContainerDep, format: Literal["markdown", "pptx"] = "markdown") -> Response:
    data, media_type, name = c.notebook.export(projectId, format)
    return Response(
        content=data, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@router.get("/snapshots/{snapshotId}", operation_id="getSnapshot", response_model=schemas.Snapshot)
def get_snapshot(projectId: str, snapshotId: str, c: ContainerDep) -> schemas.Snapshot:
    return schemas.Snapshot.from_domain(c.notebook.get(projectId, snapshotId))


@router.get(
    "/snapshots/{snapshotId}/image",
    operation_id="getSnapshotImage",
    responses={200: {"content": {"image/png": {}}, "description": "the PNG"}, 404: {"model": schemas.Problem}},
)
def get_snapshot_image(projectId: str, snapshotId: str, c: ContainerDep) -> Response:
    snap = c.notebook.get(projectId, snapshotId)
    data = c.notebook.image_bytes(snap)
    if data is None:
        raise NotFoundError(f"snapshot {snapshotId!r} has no image", code="snapshot.no_image")
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.patch("/snapshots/{snapshotId}", operation_id="updateSnapshot", response_model=schemas.Snapshot)
def update_snapshot(projectId: str, snapshotId: str, body: schemas.SnapshotUpdate, c: ContainerDep) -> schemas.Snapshot:
    snap = c.notebook.update(
        projectId,
        snapshotId,
        title=body.title,
        note=body.note,
        context=body.context,
        data=body.data,
        author=body.author,
    )
    return schemas.Snapshot.from_domain(snap)


@router.put(
    "/snapshots/{snapshotId}/image",
    operation_id="replaceSnapshotImage",
    response_model=schemas.Snapshot,
    description="Replace the snapshot's PNG.",
)
def replace_snapshot_image(
    projectId: str, snapshotId: str, c: ContainerDep, image: Annotated[UploadFile, File()]
) -> schemas.Snapshot:
    snap = c.notebook.update(projectId, snapshotId, image=image.file, image_name=image.filename)
    return schemas.Snapshot.from_domain(snap)


@router.delete(
    "/snapshots/{snapshotId}",
    operation_id="deleteSnapshot",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_snapshot(projectId: str, snapshotId: str, c: ContainerDep) -> Response:
    c.notebook.delete(projectId, snapshotId)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
