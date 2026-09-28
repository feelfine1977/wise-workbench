"""Ports: what the application layer needs from adapters, as Protocols.

Nothing here mentions pandas, DuckDB or the library. The engine port speaks
in plain Python containers (``Table`` dicts) so that services and routers stay
free of dataframes.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

from wise_workbench.domain import (
    CaseTable,
    ColumnMapping,
    DatasetVersion,
    Decision,
    Job,
    NormVersion,
    Project,
    ReviewItem,
    Run,
    Slicing,
    Snapshot,
    ValidationError,
)

Table = dict[str, Any]  # {"columns": [...], "rows": [[...], ...]}
ProgressFn = Callable[[float, str], None]


class Repository(Protocol):
    def add_project(self, p: Project) -> Project: ...
    def get_project(self, project_id: str) -> Project: ...
    def list_projects(self) -> list[Project]: ...
    def set_latest_run(self, project_id: str, run_id: str) -> None: ...
    def add_dataset(self, d: DatasetVersion) -> DatasetVersion: ...
    def update_dataset(self, d: DatasetVersion) -> DatasetVersion: ...
    def get_dataset(self, dataset_id: str) -> DatasetVersion: ...
    def list_datasets(self, project_id: str) -> list[DatasetVersion]: ...
    def add_mapping(self, m: ColumnMapping) -> ColumnMapping: ...
    def get_mapping(self, mapping_id: str) -> ColumnMapping: ...
    def list_mappings(self, dataset_id: str) -> list[ColumnMapping]: ...
    def add_case_table(self, c: CaseTable) -> CaseTable: ...
    def update_case_table(self, c: CaseTable) -> CaseTable: ...
    def get_case_table(self, case_table_id: str) -> CaseTable: ...
    def list_case_tables(self, project_id: str) -> list[CaseTable]: ...
    def add_norm_version(self, n: NormVersion) -> NormVersion: ...
    def get_norm_version(self, norm_version_id: str) -> NormVersion: ...
    def list_norm_versions(self, project_id: str) -> list[NormVersion]: ...
    def next_norm_number(self, norm_id: str) -> int: ...
    def update_norm_status(self, n: NormVersion) -> NormVersion: ...
    def update_norm_validation(self, n: NormVersion) -> NormVersion: ...
    def add_decision(self, d: Decision) -> Decision: ...
    def get_decision(self, decision_id: str) -> Decision: ...
    def list_decisions(self, project_id: str, case_table_id: str | None = None) -> list[Decision]: ...
    def add_review_item(self, item: ReviewItem) -> ReviewItem: ...
    def update_review_item(self, item: ReviewItem) -> ReviewItem: ...
    def get_review_item(self, item_id: str) -> ReviewItem: ...
    def list_review_items(
        self,
        project_id: str,
        kind: str | None = None,
        run_id: str | None = None,
        slicing: str | None = None,
        slice_key: str | None = None,
    ) -> list[ReviewItem]: ...
    def delete_review_item(self, item_id: str) -> None: ...
    def add_snapshot(self, snap: Snapshot) -> Snapshot: ...
    def update_snapshot(self, snap: Snapshot) -> Snapshot: ...
    def get_snapshot(self, snapshot_id: str) -> Snapshot: ...
    def list_snapshots(self, project_id: str) -> list[Snapshot]: ...
    def delete_snapshot(self, snapshot_id: str) -> None: ...
    def set_snapshot_order(self, project_id: str, ordered_ids: list[str]) -> None: ...
    def add_run(self, r: Run) -> Run: ...
    def update_run(self, r: Run) -> Run: ...
    def get_run(self, run_id: str) -> Run: ...
    def list_runs(self, project_id: str) -> list[Run]: ...
    def find_run(
        self, project_id: str, *, params_hash: str | None = None, idempotency_key: str | None = None
    ) -> Run | None: ...
    def add_job(self, j: Job) -> Job: ...
    def save_job(self, j: Job) -> Job: ...
    def get_job(self, job_id: str) -> Job: ...
    def list_jobs(self, status: str | None = None, project_id: str | None = None, limit: int = 100) -> list[Job]: ...
    def update_job_fields(self, job_id: str, **fields: Any) -> None: ...
    def claim_job(self, worker_id: str, lease_seconds: float, now: datetime) -> Job | None: ...
    def heartbeat(self, job_id: str, worker_id: str, lease_seconds: float, now: datetime) -> bool: ...


class JobQueue(Protocol):
    def enqueue(self, job: Job) -> Job: ...
    def get(self, job_id: str) -> Job: ...
    def cancel(self, job_id: str) -> Job: ...
    def list(self, status: str | None = None, project_id: str | None = None) -> list[Job]: ...


class Storage(Protocol):
    root: Path

    def project_dir(self, project_id: str) -> Path: ...
    def dataset_dir(self, project_id: str, dataset_id: str) -> Path: ...
    def case_table_dir(self, project_id: str, case_table_id: str) -> Path: ...
    def norm_version_path(self, project_id: str, norm_id: str, version: int) -> Path: ...
    def run_dir(self, project_id: str, run_id: str) -> Path: ...
    def notebook_dir(self, project_id: str) -> Path: ...
    def write_json(self, path: Path, data: Any) -> Path: ...
    def write_text(self, path: Path, text: str) -> Path: ...
    def read_json(self, path: Path) -> Any: ...
    def store_upload(self, dest: Path, stream: Any, chunk_size: int = ...) -> tuple[int, str]: ...


class Engine(Protocol):
    """The engine adapter: the only place that runs the library."""

    def library_version(self) -> str: ...
    def validate_norm(self, document: dict[str, Any]) -> tuple[dict[str, Any], str]: ...
    def ingest(self, source: Path, kind: str, dest_dir: Path, progress: ProgressFn) -> dict[str, Any]: ...
    def profile(self, dataset_dir: Path) -> list[dict[str, Any]]: ...
    def preview(self, dataset_dir: Path, rows: int) -> Table: ...
    def validate_mapping(self, dataset_dir: Path, mapping: ColumnMapping, sample: int) -> dict[str, Any]: ...
    def build_case_table(
        self,
        dataset_dir: Path,
        mapping: ColumnMapping,
        dest_dir: Path,
        progress: ProgressFn,
        *,
        provenance: dict[str, Any] | None = None,
    ) -> dict[str, Any]: ...
    def check_norm(self, case_table_dir: Path, mapping: ColumnMapping, document: dict[str, Any]) -> dict[str, Any]: ...
    def norm_relevance(
        self, case_table_dir: Path, mapping: ColumnMapping, document: dict[str, Any], *, selection_id: str | None = None
    ) -> dict[str, Any]: ...
    def norm_signals(
        self,
        case_table_dir: Path,
        mapping: ColumnMapping,
        document: dict[str, Any],
        constraint_id: str,
        *,
        scale: str = "linear",
        selection_id: str | None = None,
    ) -> dict[str, Any]: ...
    def norm_preview(
        self,
        case_table_dir: Path,
        mapping: ColumnMapping,
        document: dict[str, Any],
        constraint_id: str,
        proposed: dict[str, Any],
        *,
        scale: str = "linear",
        selection_id: str | None = None,
    ) -> dict[str, Any]: ...
    def score_run(
        self,
        run: Run,
        case_table_dir: Path,
        mapping: ColumnMapping,
        document: dict[str, Any],
        dest_dir: Path,
        progress: ProgressFn,
        *,
        content_hash: str = "",
    ) -> dict[str, Any]: ...
    def summary(self, run: Run, ctx: RunContext) -> dict[str, Any]: ...
    def backlog(
        self, run: Run, ctx: RunContext, attributes: list[str], view: str | None, gamma: float | None, min_cases: int
    ) -> Any: ...
    def slice_detail(
        self, run: Run, ctx: RunContext, attributes: list[str], key: list[Any], view: str | None, drilldown: str | None
    ) -> dict[str, Any]: ...
    def driver_evidence(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str],
        key: list[Any],
        constraint_id: str,
        *,
        bands: list[dict[str, Any]],
        filter_obj: dict[str, Any] | None,
    ) -> dict[str, Any]: ...
    def review_selection(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str],
        key: list[Any],
        view: str,
        *,
        bands: list[dict[str, Any]],
        filter_obj: dict[str, Any],
    ) -> dict[str, Any]: ...
    def trace(self, run: Run, ctx: RunContext, case_id: str) -> dict[str, Any]: ...
    def investigation_questions(
        self,
        run: Run,
        ctx: RunContext,
        *,
        filter_obj: dict[str, Any] | None = None,
        family: str = "overview",
        activity: str | None = None,
        source: str | None = None,
        target: str | None = None,
        relation: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]: ...
    def variants(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str] | None,
        key: list[Any] | None,
        *,
        filter_obj: dict[str, Any] | None = None,
        bands: list[dict[str, Any]] | None = None,
        limit: int = 10,
        example_limit: int = 3,
    ) -> dict[str, Any]: ...
    def diagnostics(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str],
        view: str | None,
        *,
        bands: list[dict[str, Any]] | None = None,
    ) -> Table: ...
    def signals(
        self, run: Run, ctx: RunContext, constraint_id: str, attributes: list[str] | None, key: list[Any] | None
    ) -> dict[str, Any]: ...
    def flow(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str] | None,
        key: list[Any] | None,
        abstraction: float,
        *,
        process: str | None = None,
        filter_obj: dict[str, Any] | None = None,
        focus: str | None = None,
    ) -> dict[str, Any]: ...
    def activity_profile(self, run: Run, ctx: RunContext, activity: str, *, abstraction: float) -> dict[str, Any]: ...
    def uncalibrated(self, run: Run, ctx: RunContext) -> list[dict[str, Any]]: ...

    def readiness_report(self, run: Run, ctx: RunContext) -> dict[str, Any]: ...

    def transform_preview(
        self,
        case_table_dir: Path,
        mapping: ColumnMapping,
        scope: dict[str, Any] | None,
        transforms: list[dict[str, Any]],
    ) -> list[dict[str, Any]]: ...
    def resolved_window_end(self, ctx: RunContext) -> str | None: ...
    def flow_bpmn(self, run: Run, ctx: RunContext, *, scope: str, detail: float, process: str | None) -> Any: ...
    def facets(
        self,
        run: Run,
        ctx: RunContext,
        *,
        by: str,
        attribute: str | None,
        view: str | None,
        gamma: float | None,
        filter_obj: dict[str, Any] | None,
    ) -> dict[str, Any]: ...
    def kpis(
        self, run: Run, ctx: RunContext, *, view: str | None, gamma: float | None, filter_obj: dict[str, Any] | None
    ) -> dict[str, Any]: ...
    def read_events(self, dataset_dir: Path, mapping: ColumnMapping) -> Any: ...
    def norm_warnings(self, case_table_dir: Path, mapping: ColumnMapping, document: dict[str, Any]) -> list[str]: ...
    def preview_decision(
        self, case_table_dir: Path, mapping: ColumnMapping, kind: str, params: dict[str, Any]
    ) -> Any: ...
    def flow_types(
        self,
        case_table_dir: Path,
        mapping: ColumnMapping,
        *,
        attribute: str | None,
        process: str | None,
        abstraction: float,
        case_noun: str | None = None,
        selection_id: str | None = None,
    ) -> dict[str, Any]: ...
    def compare_flow_types(self, run: Run, ctx: RunContext, *, attribute: str | None) -> dict[str, Any]: ...
    def run_analytics(self, run: Run, ctx: RunContext, progress: ProgressFn) -> dict[str, Any]: ...
    def analytics_status(self, run: Run, ctx: RunContext) -> dict[str, Any]: ...
    def filter_preview(self, run: Run, ctx: RunContext, filter_obj: dict[str, Any] | None) -> dict[str, Any]: ...
    def slicing_options(self, run: Run, ctx: RunContext) -> dict[str, Any]: ...
    def slicing_preview(
        self, run: Run, ctx: RunContext, attributes: list[str], bands: list[dict[str, Any]], min_cases: int
    ) -> dict[str, Any]: ...


GROUPING_PREFIX = "group:"
MAX_GROUPING_TOKEN_LENGTH = 8192
GROUPING_ATTRIBUTES = ("start_month", "start_year", "recorded_span_days", "n_events")


def _finite_number(value: int | float) -> bool:
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_grouping_spec(value: Any) -> Slicing:
    """Typed, closed grouping grammar; the domain Slicing validates its semantics."""

    def invalid(message: str) -> None:
        raise ValidationError(message, code="run.grouping")

    if not isinstance(value, dict) or set(value) - {"attributes", "bands"}:
        invalid("a grouping contains only attributes and bands")
    attributes = value.get("attributes")
    if not isinstance(attributes, list) or any(
        not isinstance(a, str) or not a.strip() or len(a) > 256 or "\x00" in a for a in attributes
    ):
        invalid("grouping attributes must be nonempty column names, at most 256 characters each")
    bands = value.get("bands", [])
    if not isinstance(bands, list) or len(bands) > 3:
        invalid("grouping bands must be a list with at most one band per attribute")
    for band in bands:
        if not isinstance(band, dict) or set(band) - {"attribute", "method", "q", "cuts", "labels"}:
            invalid("a band contains only attribute, method, q, cuts and labels")
        if not isinstance(band.get("attribute"), str):
            invalid("a band must name its attribute")
        method = band.get("method", "quantile")
        if method not in ("quantile", "cuts"):
            invalid("band method must be quantile or cuts")
        if method == "quantile":
            if "cuts" in band or ("q" in band and (type(band["q"]) is not int or not 2 <= band["q"] <= 20)):
                invalid("quantile bands accept an integer q from 2 to 20, not cuts")
        else:
            cuts = band.get("cuts")
            if "q" in band or not isinstance(cuts, list) or not 1 <= len(cuts) <= 100:
                invalid("cut bands require 1 to 100 ascending numeric cuts, not q")
            if any(type(c) not in (int, float) or not _finite_number(c) for c in cuts):
                invalid("cut points must be finite numbers")
            if any(a >= b for a, b in pairwise(cuts)):
                invalid("cut points must be strictly increasing")
        if "labels" in band:
            labels = band["labels"]
            if (
                not isinstance(labels, list)
                or not labels
                or any(not isinstance(label, str) or not label.strip() or len(label) > 256 for label in labels)
            ):
                invalid("band labels must be nonempty strings of at most 256 characters")
            expected = band.get("q", 4) if method == "quantile" else len(band["cuts"]) + 1
            if len(labels) != expected or len(set(labels)) != len(labels):
                invalid("provide one distinct label per band")
    try:
        return Slicing(id="", attributes=tuple(attributes), bands=tuple(bands))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValidationError("invalid grouping specification", code="run.grouping") from exc


def grouping_slicing(token: str) -> Slicing | None:
    """Decode a self-contained selection, never evaluating expressions or code."""
    if not token.startswith(GROUPING_PREFIX):
        return None
    if len(token) > MAX_GROUPING_TOKEN_LENGTH:
        raise ValidationError("grouping token exceeds 8192 characters", code="run.grouping")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in pairs:
            if key in out:
                raise ValueError("duplicate object key")
            out[key] = value
        return out

    def invalid_constant(value: str) -> Any:
        raise ValueError(f"non-finite number {value}")

    try:
        spec = json.loads(
            token[len(GROUPING_PREFIX) :], object_pairs_hook=unique_object, parse_constant=invalid_constant
        )
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValidationError("grouping token must contain valid JSON", code="run.grouping") from exc
    return validate_grouping_spec(spec)


def grouping_token(attributes: list[str], bands: list[dict[str, Any]] | None = None) -> str:
    spec = validate_grouping_spec({"attributes": attributes, "bands": bands or []})
    token = GROUPING_PREFIX + json.dumps(
        {"attributes": list(spec.attributes), "bands": list(spec.bands)}, ensure_ascii=False, separators=(",", ":")
    )
    if len(token) > MAX_GROUPING_TOKEN_LENGTH:
        raise ValidationError("grouping token exceeds 8192 characters", code="run.grouping")
    return token


@dataclass(frozen=True)
class RunContext:
    """Everything the engine needs to locate a run's inputs and artefacts."""

    run_dir: Path
    case_table_dir: Path
    mapping: ColumnMapping
    document: dict[str, Any]
    views: tuple[str, ...]
    gamma: float
    min_cases: int
    slicings: tuple[tuple[str, tuple[str, ...]], ...] = ()
    bands: dict[str, tuple[dict[str, Any], ...]] = field(default_factory=dict)  # slicing id → band specs
    scope: dict[str, Any] | None = None  # the run's sub-log scope (flow type)
    transforms: tuple[dict[str, Any], ...] = ()  # a what-if scenario's transform layer (R3-27)
    window_end: str | None = None  # the one window end of the case table's readiness report
    case_noun: str = "cases"
    closure_label: str = "closure"
    process: str | None = None
    project_id: str | None = None
    run_id: str | None = None
    norm_warnings: tuple[str, ...] = ()
    analytics: dict[str, Any] = field(default_factory=dict)  # bootstrap B, comparison top, cluster share, seed

    def slicing_attributes(self, slicing: str) -> list[str]:
        """Resolve an inline grouping, saved slicing id, or comma-separated attributes."""
        inline = grouping_slicing(slicing)
        if inline is not None:
            return list(inline.attributes)
        for sid, attrs in self.slicings:
            if sid == slicing:
                return list(attrs)
        return [a.strip() for a in slicing.split(",") if a.strip()]

    def slicing_bands(self, slicing: str) -> list[dict[str, Any]]:
        """Bands travel inside inline tokens or belong to a saved slicing."""
        inline = grouping_slicing(slicing)
        if inline is not None:
            return [dict(b) for b in inline.bands]
        return [dict(b) for b in self.bands.get(slicing, ())]

    def slicing_id(self, attributes: list[str], bands: list[dict[str, Any]] | None = None) -> str | None:
        wanted_bands = [dict(b) for b in bands or []]
        for sid, attrs in self.slicings:
            if list(attrs) == list(attributes) and [dict(b) for b in self.bands.get(sid, ())] == wanted_bands:
                return sid
        return None
