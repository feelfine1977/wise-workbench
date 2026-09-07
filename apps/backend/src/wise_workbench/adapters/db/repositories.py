"""Repositories: domain objects in, domain objects out. Rows never leave this module."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from wise_workbench.domain import (
    ActivityCount,
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    ColumnProfile,
    DatasetStatus,
    DatasetVersion,
    Decision,
    DecisionPreview,
    Job,
    JobStatus,
    NormStatus,
    NormVersion,
    NotFoundError,
    Project,
    Readiness,
    ReviewItem,
    ReviewKind,
    Run,
    RunManifest,
    RunParams,
    RunStatus,
    Snapshot,
    SourceKind,
)

from .models import (
    CaseTableRow,
    DatasetRow,
    DecisionRow,
    JobRow,
    MappingRow,
    NormVersionRow,
    ProjectRow,
    ReviewItemRow,
    RunRow,
    SnapshotRow,
)
from .session import Database


# ----------------------------------------------------------------------------- converters
def _project(row: ProjectRow) -> Project:
    return Project(
        id=row.id,
        name=row.name,
        process=row.process,
        question=row.question,
        latest_run_id=row.latest_run_id,
        created_at=row.created_at,
    )


def _dataset(row: DatasetRow) -> DatasetVersion:
    return DatasetVersion(
        id=row.id,
        project_id=row.project_id,
        name=row.name,
        status=DatasetStatus(row.status),
        source_kind=SourceKind(row.source_kind),
        source_path=row.source_path,
        content_hash=row.content_hash,
        events=row.events,
        columns=tuple(ColumnProfile.from_dict(c) for c in (row.columns or [])),
        error=row.error,
        job_id=row.job_id,
        created_at=row.created_at,
    )


def _mapping(row: MappingRow) -> ColumnMapping:
    return ColumnMapping.from_dict(row.id, row.dataset_id, row.document, created_at=row.created_at)


def _case_table(row: CaseTableRow) -> CaseTable:
    return CaseTable(
        id=row.id,
        project_id=row.project_id,
        dataset_id=row.dataset_id,
        mapping_id=row.mapping_id,
        status=CaseTableStatus(row.status),
        cases=row.cases,
        events=row.events,
        readiness=Readiness.from_dict(row.readiness) if row.readiness else None,
        activities=tuple(
            ActivityCount(str(a["label"]), int(a["events"]), int(a["cases"])) for a in (row.activities or [])
        ),
        attributes=tuple(row.attributes or []),
        error=row.error,
        job_id=row.job_id,
        created_at=row.created_at,
    )


def _norm_version(row: NormVersionRow) -> NormVersion:
    return NormVersion(
        id=row.id,
        project_id=row.project_id,
        norm_id=row.norm_id,
        version=row.version,
        fingerprint=row.fingerprint,
        document=dict(row.document),
        status=NormStatus(row.status),
        note=row.note or "",
        author=row.author,
        parent_id=row.parent_id,
        validation=tuple(row.validation or []),
        created_at=row.created_at,
    )


def _run(row: RunRow) -> Run:
    return Run(
        id=row.id,
        project_id=row.project_id,
        params=RunParams.from_dict(row.params),
        status=RunStatus(row.status),
        params_hash=row.params_hash,
        job_id=row.job_id,
        idempotency_key=row.idempotency_key,
        manifest=RunManifest.from_dict(row.manifest) if row.manifest else None,
        error=row.error,
        created_at=row.created_at,
    )


def _job(row: JobRow) -> Job:
    return Job(
        id=row.id,
        kind=str(row.kind),
        payload=dict(row.payload),
        project_id=row.project_id,
        status=JobStatus(row.status),
        progress=float(row.progress or 0.0),
        message=row.message,
        attempts=int(row.attempts or 0),
        max_attempts=int(row.max_attempts or 3),
        lease_until=row.lease_until,
        heartbeat_at=row.heartbeat_at,
        worker_id=row.worker_id,
        cancel_requested=bool(row.cancel_requested),
        result_ref=row.result_ref,
        error=row.error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        started_at=row.started_at,
        finished_at=row.finished_at,
    )


def _review(row: ReviewItemRow) -> ReviewItem:
    return ReviewItem(
        id=row.id,
        project_id=row.project_id,
        kind=ReviewKind(row.kind),
        status=row.status,
        title=row.title or "",
        run_id=row.run_id,
        slicing=row.slicing,
        slice_key=row.slice_key,
        view=row.view,
        body=dict(row.body or {}),
        author=row.author,
        note=row.note,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _decision(row: DecisionRow) -> Decision:
    pv = dict(row.preview or {})
    return Decision(
        id=row.id,
        project_id=row.project_id,
        case_table_id=row.case_table_id,
        kind=row.kind,
        params=dict(row.params or {}),
        readiness_item=row.readiness_item,
        version=int(row.version or 1),
        mapping_id=row.mapping_id,
        result_case_table_id=row.result_case_table_id,
        preview=DecisionPreview(
            cases=int(pv.get("cases", 0)),
            events=int(pv.get("events", 0)),
            total_cases=int(pv.get("totalCases", 0)),
            total_events=int(pv.get("totalEvents", 0)),
            detail=dict(pv.get("detail") or {}),
        ),
        author=row.author,
        note=row.note,
        created_at=row.created_at,
    )


def _snapshot(row: SnapshotRow) -> Snapshot:
    return Snapshot(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        note=row.note or "",
        context=dict(row.context or {}),
        data=row.data,
        image_path=row.image_path,
        order=int(row.order or 0),
        author=row.author,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _job_fields(job: Job) -> dict[str, Any]:
    return {
        "kind": str(job.kind),
        "payload": dict(job.payload),
        "project_id": job.project_id,
        "status": str(job.status),
        "progress": job.progress,
        "message": job.message,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "lease_until": job.lease_until,
        "heartbeat_at": job.heartbeat_at,
        "worker_id": job.worker_id,
        "cancel_requested": job.cancel_requested,
        "result_ref": job.result_ref,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


# ----------------------------------------------------------------------------- repositories
class Repositories:
    """All repositories share one:class:`Database`; each call is its own transaction."""

    def __init__(self, db: Database):
        self.db = db

    # ---- projects
    def add_project(self, p: Project) -> Project:
        with self.db.session() as s:
            s.add(
                ProjectRow(
                    id=p.id,
                    name=p.name,
                    process=p.process,
                    question=p.question,
                    latest_run_id=p.latest_run_id,
                    created_at=p.created_at,
                )
            )
        return p

    def get_project(self, project_id: str) -> Project:
        with self.db.session() as s:
            row = s.get(ProjectRow, project_id)
            if row is None:
                raise NotFoundError(f"project {project_id!r} not found", code="project.not_found")
            return _project(row)

    def list_projects(self) -> list[Project]:
        with self.db.session() as s:
            return [_project(r) for r in s.scalars(select(ProjectRow).order_by(ProjectRow.created_at)).all()]

    def set_latest_run(self, project_id: str, run_id: str) -> None:
        with self.db.session() as s:
            row = s.get(ProjectRow, project_id)
            if row is not None:
                row.latest_run_id = run_id

    # ---- datasets
    def add_dataset(self, d: DatasetVersion) -> DatasetVersion:
        with self.db.session() as s:
            s.add(
                DatasetRow(
                    id=d.id,
                    project_id=d.project_id,
                    name=d.name,
                    status=str(d.status),
                    source_kind=str(d.source_kind),
                    source_path=d.source_path,
                    content_hash=d.content_hash,
                    events=d.events,
                    columns=[c.to_dict() for c in d.columns],
                    error=d.error,
                    job_id=d.job_id,
                    created_at=d.created_at,
                )
            )
        return d

    def update_dataset(self, d: DatasetVersion) -> DatasetVersion:
        with self.db.session() as s:
            row = s.get(DatasetRow, d.id)
            if row is None:
                raise NotFoundError(f"dataset {d.id!r} not found", code="dataset.not_found")
            row.status = str(d.status)
            row.content_hash = d.content_hash
            row.events = d.events
            row.columns = [c.to_dict() for c in d.columns]
            row.error = d.error
            row.job_id = d.job_id
        return d

    def get_dataset(self, dataset_id: str) -> DatasetVersion:
        with self.db.session() as s:
            row = s.get(DatasetRow, dataset_id)
            if row is None:
                raise NotFoundError(f"dataset {dataset_id!r} not found", code="dataset.not_found")
            return _dataset(row)

    def list_datasets(self, project_id: str) -> list[DatasetVersion]:
        with self.db.session() as s:
            rows = s.scalars(
                select(DatasetRow).where(DatasetRow.project_id == project_id).order_by(DatasetRow.created_at)
            ).all()
            return [_dataset(r) for r in rows]

    # ---- mappings
    def add_mapping(self, m: ColumnMapping) -> ColumnMapping:
        with self.db.session() as s:
            s.add(MappingRow(id=m.id, dataset_id=m.dataset_id, document=m.to_dict(), created_at=m.created_at))
        return m

    def get_mapping(self, mapping_id: str) -> ColumnMapping:
        with self.db.session() as s:
            row = s.get(MappingRow, mapping_id)
            if row is None:
                raise NotFoundError(f"mapping {mapping_id!r} not found", code="mapping.not_found")
            return _mapping(row)

    def list_mappings(self, dataset_id: str) -> list[ColumnMapping]:
        with self.db.session() as s:
            rows = s.scalars(
                select(MappingRow).where(MappingRow.dataset_id == dataset_id).order_by(MappingRow.created_at)
            ).all()
            return [_mapping(r) for r in rows]

    # ---- case tables
    def add_case_table(self, c: CaseTable) -> CaseTable:
        with self.db.session() as s:
            s.add(
                CaseTableRow(
                    id=c.id,
                    project_id=c.project_id,
                    dataset_id=c.dataset_id,
                    mapping_id=c.mapping_id,
                    status=str(c.status),
                    cases=c.cases,
                    events=c.events,
                    readiness=c.readiness.to_dict() if c.readiness else None,
                    activities=[{"label": a.label, "events": a.events, "cases": a.cases} for a in c.activities],
                    attributes=list(c.attributes),
                    error=c.error,
                    job_id=c.job_id,
                    created_at=c.created_at,
                )
            )
        return c

    def update_case_table(self, c: CaseTable) -> CaseTable:
        with self.db.session() as s:
            row = s.get(CaseTableRow, c.id)
            if row is None:
                raise NotFoundError(f"case table {c.id!r} not found", code="case_table.not_found")
            row.status = str(c.status)
            row.cases = c.cases
            row.events = c.events
            row.readiness = c.readiness.to_dict() if c.readiness else None
            row.activities = [{"label": a.label, "events": a.events, "cases": a.cases} for a in c.activities]
            row.attributes = list(c.attributes)
            row.error = c.error
            row.job_id = c.job_id
        return c

    def get_case_table(self, case_table_id: str) -> CaseTable:
        with self.db.session() as s:
            row = s.get(CaseTableRow, case_table_id)
            if row is None:
                raise NotFoundError(f"case table {case_table_id!r} not found", code="case_table.not_found")
            return _case_table(row)

    def list_case_tables(self, project_id: str) -> list[CaseTable]:
        with self.db.session() as s:
            rows = s.scalars(
                select(CaseTableRow).where(CaseTableRow.project_id == project_id).order_by(CaseTableRow.created_at)
            ).all()
            return [_case_table(r) for r in rows]

    # ---- norm versions
    def add_norm_version(self, n: NormVersion) -> NormVersion:
        with self.db.session() as s:
            s.add(
                NormVersionRow(
                    id=n.id,
                    project_id=n.project_id,
                    norm_id=n.norm_id,
                    version=n.version,
                    fingerprint=n.fingerprint,
                    document=n.document,
                    status=str(n.status),
                    note=n.note,
                    author=n.author,
                    parent_id=n.parent_id,
                    validation=list(n.validation),
                    created_at=n.created_at,
                )
            )
        return n

    def get_norm_version(self, norm_version_id: str) -> NormVersion:
        with self.db.session() as s:
            row = s.get(NormVersionRow, norm_version_id)
            if row is None:
                raise NotFoundError(f"norm version {norm_version_id!r} not found", code="norm.not_found")
            return _norm_version(row)

    def list_norm_versions(self, project_id: str) -> list[NormVersion]:
        with self.db.session() as s:
            rows = s.scalars(
                select(NormVersionRow)
                .where(NormVersionRow.project_id == project_id)
                .order_by(NormVersionRow.created_at)
            ).all()
            return [_norm_version(r) for r in rows]

    def next_norm_number(self, norm_id: str) -> int:
        with self.db.session() as s:
            rows = s.scalars(select(NormVersionRow.version).where(NormVersionRow.norm_id == norm_id)).all()
            return (max(rows) + 1) if rows else 1

    def update_norm_status(self, n: NormVersion) -> NormVersion:
        with self.db.session() as s:
            row = s.get(NormVersionRow, n.id)
            if row is None:
                raise NotFoundError(f"norm version {n.id!r} not found", code="norm.not_found")
            row.status = str(n.status)
        return n

    def update_norm_validation(self, n: NormVersion) -> NormVersion:
        with self.db.session() as s:
            row = s.get(NormVersionRow, n.id)
            if row is None:
                raise NotFoundError(f"norm version {n.id!r} not found", code="norm.not_found")
            row.validation = list(n.validation)
        return n

    # ---- decisions
    def add_decision(self, d: Decision) -> Decision:
        with self.db.session() as s:
            s.add(
                DecisionRow(
                    id=d.id,
                    project_id=d.project_id,
                    case_table_id=d.case_table_id,
                    kind=d.kind,
                    params=dict(d.params),
                    readiness_item=d.readiness_item,
                    version=d.version,
                    mapping_id=d.mapping_id,
                    result_case_table_id=d.result_case_table_id,
                    preview=d.preview.to_dict(),
                    author=d.author,
                    note=d.note,
                    created_at=d.created_at,
                )
            )
        return d

    def get_decision(self, decision_id: str) -> Decision:
        with self.db.session() as s:
            row = s.get(DecisionRow, decision_id)
            if row is None:
                raise NotFoundError(f"decision {decision_id!r} not found", code="decision.not_found")
            return _decision(row)

    def list_decisions(self, project_id: str, case_table_id: str | None = None) -> list[Decision]:
        with self.db.session() as s:
            stmt = select(DecisionRow).where(DecisionRow.project_id == project_id)
            if case_table_id is not None:
                stmt = stmt.where(
                    (DecisionRow.case_table_id == case_table_id) | (DecisionRow.result_case_table_id == case_table_id)
                )
            rows = s.scalars(stmt.order_by(DecisionRow.created_at)).all()
            return [_decision(r) for r in rows]

    # ---- review records (hypotheses, gates, findings, actions)
    def add_review_item(self, item: ReviewItem) -> ReviewItem:
        with self.db.session() as s:
            s.add(
                ReviewItemRow(
                    id=item.id,
                    project_id=item.project_id,
                    kind=str(item.kind),
                    status=item.status,
                    title=item.title,
                    run_id=item.run_id,
                    slicing=item.slicing,
                    slice_key=item.slice_key,
                    view=item.view,
                    body=dict(item.body),
                    author=item.author,
                    note=item.note,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def update_review_item(self, item: ReviewItem) -> ReviewItem:
        with self.db.session() as s:
            row = s.get(ReviewItemRow, item.id)
            if row is None:
                raise NotFoundError(f"review item {item.id!r} not found", code="review.not_found")
            row.status = item.status
            row.title = item.title
            row.body = dict(item.body)
            row.note = item.note
            row.author = item.author
            row.updated_at = item.updated_at
        return item

    def get_review_item(self, item_id: str) -> ReviewItem:
        with self.db.session() as s:
            row = s.get(ReviewItemRow, item_id)
            if row is None:
                raise NotFoundError(f"review item {item_id!r} not found", code="review.not_found")
            return _review(row)

    def list_review_items(
        self,
        project_id: str,
        kind: str | None = None,
        run_id: str | None = None,
        slicing: str | None = None,
        slice_key: str | None = None,
    ) -> list[ReviewItem]:
        with self.db.session() as s:
            stmt = select(ReviewItemRow).where(ReviewItemRow.project_id == project_id)
            if kind is not None:
                stmt = stmt.where(ReviewItemRow.kind == kind)
            if run_id is not None:
                stmt = stmt.where(ReviewItemRow.run_id == run_id)
            if slicing is not None:
                stmt = stmt.where(ReviewItemRow.slicing == slicing)
            if slice_key is not None:
                stmt = stmt.where(ReviewItemRow.slice_key == slice_key)
            rows = s.scalars(stmt.order_by(ReviewItemRow.created_at)).all()
            return [_review(r) for r in rows]

    def delete_review_item(self, item_id: str) -> None:
        with self.db.session() as s:
            row = s.get(ReviewItemRow, item_id)
            if row is None:
                raise NotFoundError(f"review item {item_id!r} not found", code="review.not_found")
            s.delete(row)

    # ---- notebook snapshots
    def add_snapshot(self, snap: Snapshot) -> Snapshot:
        with self.db.session() as s:
            s.add(
                SnapshotRow(
                    id=snap.id,
                    project_id=snap.project_id,
                    title=snap.title,
                    note=snap.note,
                    context=dict(snap.context),
                    data=snap.data,
                    image_path=snap.image_path,
                    order=snap.order,
                    author=snap.author,
                    created_at=snap.created_at,
                    updated_at=snap.updated_at,
                )
            )
        return snap

    def update_snapshot(self, snap: Snapshot) -> Snapshot:
        with self.db.session() as s:
            row = s.get(SnapshotRow, snap.id)
            if row is None:
                raise NotFoundError(f"snapshot {snap.id!r} not found", code="snapshot.not_found")
            row.title = snap.title
            row.note = snap.note
            row.context = dict(snap.context)
            row.data = snap.data
            row.image_path = snap.image_path
            row.order = snap.order
            row.author = snap.author
            row.updated_at = snap.updated_at
        return snap

    def get_snapshot(self, snapshot_id: str) -> Snapshot:
        with self.db.session() as s:
            row = s.get(SnapshotRow, snapshot_id)
            if row is None:
                raise NotFoundError(f"snapshot {snapshot_id!r} not found", code="snapshot.not_found")
            return _snapshot(row)

    def list_snapshots(self, project_id: str) -> list[Snapshot]:
        with self.db.session() as s:
            rows = s.scalars(
                select(SnapshotRow)
                .where(SnapshotRow.project_id == project_id)
                .order_by(SnapshotRow.order, SnapshotRow.created_at)
            ).all()
            return [_snapshot(r) for r in rows]

    def delete_snapshot(self, snapshot_id: str) -> None:
        with self.db.session() as s:
            row = s.get(SnapshotRow, snapshot_id)
            if row is None:
                raise NotFoundError(f"snapshot {snapshot_id!r} not found", code="snapshot.not_found")
            s.delete(row)

    def set_snapshot_order(self, project_id: str, ordered_ids: list[str]) -> None:
        with self.db.session() as s:
            rows = s.scalars(select(SnapshotRow).where(SnapshotRow.project_id == project_id)).all()
            position = {sid: i for i, sid in enumerate(ordered_ids)}
            tail = len(ordered_ids)
            for row in sorted(rows, key=lambda r: (r.order, r.created_at)):
                if row.id in position:
                    row.order = position[row.id]
                else:
                    row.order = tail
                    tail += 1

    # ---- runs
    def add_run(self, r: Run) -> Run:
        with self.db.session() as s:
            s.add(
                RunRow(
                    id=r.id,
                    project_id=r.project_id,
                    case_table_id=r.params.case_table_id,
                    norm_version_id=r.params.norm_version_id,
                    params=r.params.to_dict(),
                    params_hash=r.params_hash,
                    status=str(r.status),
                    job_id=r.job_id,
                    idempotency_key=r.idempotency_key,
                    manifest=r.manifest.to_dict() if r.manifest else None,
                    error=r.error,
                    created_at=r.created_at,
                )
            )
        return r

    def update_run(self, r: Run) -> Run:
        with self.db.session() as s:
            row = s.get(RunRow, r.id)
            if row is None:
                raise NotFoundError(f"run {r.id!r} not found", code="run.not_found")
            row.status = str(r.status)
            row.job_id = r.job_id
            row.manifest = r.manifest.to_dict() if r.manifest else None
            row.error = r.error
        return r

    def get_run(self, run_id: str) -> Run:
        with self.db.session() as s:
            row = s.get(RunRow, run_id)
            if row is None:
                raise NotFoundError(f"run {run_id!r} not found", code="run.not_found")
            return _run(row)

    def list_runs(self, project_id: str) -> list[Run]:
        with self.db.session() as s:
            rows = s.scalars(select(RunRow).where(RunRow.project_id == project_id).order_by(RunRow.created_at)).all()
            return [_run(r) for r in rows]

    def find_run(
        self, project_id: str, *, params_hash: str | None = None, idempotency_key: str | None = None
    ) -> Run | None:
        with self.db.session() as s:
            stmt = select(RunRow).where(RunRow.project_id == project_id)
            if idempotency_key is not None:
                stmt = stmt.where(RunRow.idempotency_key == idempotency_key)
            elif params_hash is not None:
                stmt = stmt.where(RunRow.params_hash == params_hash, RunRow.status.notin_(["failed", "cancelled"]))
            else:
                return None
            row = s.scalars(stmt.order_by(RunRow.created_at.desc())).first()
            return _run(row) if row else None

    # ---- jobs
    def add_job(self, j: Job) -> Job:
        with self.db.session() as s:
            s.add(JobRow(id=j.id, **_job_fields(j)))
        return j

    def save_job(self, j: Job) -> Job:
        with self.db.session() as s:
            row = s.get(JobRow, j.id)
            if row is None:
                raise NotFoundError(f"job {j.id!r} not found", code="job.not_found")
            for k, v in _job_fields(j).items():
                setattr(row, k, v)
        return j

    def get_job(self, job_id: str) -> Job:
        with self.db.session() as s:
            row = s.get(JobRow, job_id)
            if row is None:
                raise NotFoundError(f"job {job_id!r} not found", code="job.not_found")
            return _job(row)

    def list_jobs(self, status: str | None = None, project_id: str | None = None, limit: int = 100) -> list[Job]:
        with self.db.session() as s:
            stmt = select(JobRow)
            if status:
                stmt = stmt.where(JobRow.status == status)
            if project_id:
                stmt = stmt.where(JobRow.project_id == project_id)
            rows = s.scalars(stmt.order_by(JobRow.created_at.desc()).limit(limit)).all()
            return [_job(r) for r in rows]

    def update_job_fields(self, job_id: str, **fields: Any) -> None:
        with self.db.session() as s:
            row = s.get(JobRow, job_id)
            if row is None:
                raise NotFoundError(f"job {job_id!r} not found", code="job.not_found")
            for k, v in fields.items():
                setattr(row, k, v)

    def claim_job(self, worker_id: str, lease_seconds: float, now: datetime) -> Job | None:
        """Take the oldest claimable job: queued, or running with an expired lease.

        SQLite: ``BEGIN IMMEDIATE`` serialises claimers. Postgres: ``FOR UPDATE SKIP LOCKED``.
        """
        from datetime import timedelta

        lease_until = now + timedelta(seconds=lease_seconds)
        if self.db.is_sqlite:
            raw = self.db.engine.raw_connection()
            try:
                cur = raw.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute(
                    "SELECT id, attempts, started_at FROM jobs WHERE cancel_requested = 0 AND "
                    "(status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < ?))) "
                    "ORDER BY created_at LIMIT 1",
                    (now,),
                )
                found = cur.fetchone()
                if found is None:
                    cur.execute("COMMIT")
                    return None
                job_id, attempts, _started_at = found
                cur.execute(
                    "UPDATE jobs SET status = 'running', worker_id = ?, attempts = ?, lease_until = ?, heartbeat_at = ?, "
                    "started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
                    (worker_id, int(attempts or 0) + 1, lease_until, now, now, now, job_id),
                )
                cur.execute("COMMIT")
                cur.close()
            except Exception:
                try:
                    raw.rollback()
                finally:
                    raw.close()
                raise
            else:
                raw.close()
            return self.get_job(str(job_id))
        with self.db.session() as s:
            stmt = (
                select(JobRow)
                .where(
                    JobRow.cancel_requested.is_(False),
                    (JobRow.status == "queued")
                    | ((JobRow.status == "running") & ((JobRow.lease_until.is_(None)) | (JobRow.lease_until < now))),
                )
                .order_by(JobRow.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            row = s.scalars(stmt).first()
            if row is None:
                return None
            row.status = "running"
            row.worker_id = worker_id
            row.attempts = int(row.attempts or 0) + 1
            row.lease_until = lease_until
            row.heartbeat_at = now
            row.started_at = row.started_at or now
            row.updated_at = now
            s.flush()
            return _job(row)

    def heartbeat(self, job_id: str, worker_id: str, lease_seconds: float, now: datetime) -> bool:
        """Extend the lease if this worker still owns the job. Returns the cancel flag."""
        from datetime import timedelta

        with self.db.session() as s:
            row = s.get(JobRow, job_id)
            if row is None or row.worker_id != worker_id or row.status != "running":
                return True
            row.lease_until = now + timedelta(seconds=lease_seconds)
            row.heartbeat_at = now
            row.updated_at = now
            return bool(row.cancel_requested)


def _session_of(repos: Repositories) -> Session:  # pragma: no cover - helper for ad-hoc scripts
    return repos.db._factory()
