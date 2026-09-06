"""The engine adapter: the only module that calls ``wise``.

It converts stored artefacts to library objects, runs scoring and
prioritisation, persists the results as Parquet/JSON, and answers the
drill-down queries of the API. Live ``ScoreResult`` objects are kept in a
per-process LRU keyed by run id; a cold request re-scores from the case
table.
"""

from __future__ import annotations

import hashlib
import json
import threading
import warnings
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa
import wise

from wise_workbench import __version__ as workbench_version
from wise_workbench.adapters.knowledge import GuidanceRef, guidance_ref, stage_model
from wise_workbench.adapters.storage import Workspace, duck
from wise_workbench.adapters.storage.parquet import read_frame, read_table, write_frame
from wise_workbench.application.ports import ProgressFn, RunContext, Table
from wise_workbench.domain import ColumnMapping, DecisionPreview, NotFoundError, Run, ValidationError
from wise_workbench.domain.readings import backlog_reading, hotspot_of, kind_of, kind_reading, slice_reading

from . import analytics as an
from . import compat
from .bands import apply_bands, band_summary, effective_attributes
from .cache import LRUCache
from .filters import filter_masks, filter_preview
from .flow import _node_id, build_flow_graph, violation_shares
from .logs import (
    activity_inventory,
    apply_case_decisions,
    apply_flow_typing,
    apply_mapping_recipes,
    build_log,
    censored_flags,
    flow_type_column,
    flow_type_counts,
    preview_decision,
    readiness_report,
    resolve_window_end,
    scope_mask,
    sublog,
    typed_events,
)
from .signals import distribution, raw_signal
from .tables import jsonable, key_label, records_from_frame, table_from_frame

Z_LOWER = 1.96
HOTSPOT_TOP = 12


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _artefact_name(prefix: str, slicing_id: str, view: str | None = None) -> str:
    safe = slicing_id.replace("/", "_")
    return f"{prefix}/{safe}__{view}.parquet" if view else f"{prefix}/{safe}.parquet"


def slice_key(values: list[Any]) -> str:
    return json.dumps([jsonable(v) for v in values], ensure_ascii=False)


def parse_slice_key(key: str, n_attributes: int) -> list[Any]:
    """Accept a JSON array or, for single-attribute slicings, a bare value."""
    try:
        parsed = json.loads(key)
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, list) and len(parsed) == n_attributes:
        return parsed
    if n_attributes == 1:
        return [None if key == "(missing)" else key]
    raise ValidationError(f"slice key {key!r} must be a JSON array with {n_attributes} value(s)", code="slice.key")


def _norm_from(document: dict[str, Any]) -> wise.Norm:
    compat.check_schema_version(document)
    try:
        return wise.Norm.from_dict(document)
    except wise.NormError as exc:
        raise ValidationError(str(exc), code="norm.invalid") from exc


@dataclass
class BacklogResult:
    """A computed backlog: an Arrow table plus its parameters. Paged server-side by DuckDB."""

    table: pa.Table
    attributes: list[str]
    view: str
    gamma: float
    min_cases: int
    global_mean: float | None
    bands: list[dict[str, Any]] = field(default_factory=list)
    scope: dict[str, Any] | None = None  # drill-in or filter restriction
    analytics: dict[str, Any] = field(default_factory=dict)  # record ids, window end, availability
    enriched: bool = False

    @property
    def max_stable_pi(self) -> float | None:
        if "stable_PI" not in self.table.column_names or not self.table.num_rows:
            return None
        value = pa.compute.max(self.table.column("stable_PI")).as_py()
        return None if value is None else float(value)

    def page(
        self,
        *,
        sort: str,
        page: int,
        page_size: int,
        hotspot_type: str | None,
        layer: str | None,
        search: str | None,
        min_cases: int | None = None,
        kind: str | None = None,
        stability: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        filters: dict[str, Any] = {"hotspot_type": hotspot_type, "dominant_layer": layer}
        if kind:
            if "kind" in self.table.column_names:
                filters["kind"] = kind
            else:
                filters["hotspot_type"] = hotspot_type or hotspot_of(kind)
        if stability:
            filters["stability"] = stability
        try:
            rows, total = duck.page_table(
                self.table,
                sort=sort,
                page=page,
                page_size=page_size,
                filters=filters,
                search=search,
                search_columns=[*self.attributes, "key"],
                min_cases=min_cases,
            )
        except ValueError as exc:
            raise ValidationError(str(exc), code="backlog.sort") from exc
        return [self._row(r) for r in rows.to_pylist()], total

    def _row(self, r: dict[str, Any]) -> dict[str, Any]:
        out = {k: jsonable(v) for k, v in r.items()}
        out["keys"] = {a: key_label(r.get(a)) for a in self.attributes}
        raw = out.pop("caveats_json", None)
        try:
            out["caveats"] = json.loads(raw) if raw else []
        except (TypeError, ValueError):
            out["caveats"] = []
        return out

    def find(self, key: list[Any]) -> dict[str, Any] | None:
        for r in self.table.to_pylist():
            if all(key_label(r.get(a)) == key_label(k) for a, k in zip(self.attributes, key)):
                return self._row(r)
        return None


class EngineAdapter:
    """Implements :class:`wise_workbench.application.ports.Engine`."""

    def __init__(self, ws: Workspace, *, cache_size: int = 4, sample_events: int = 200_000):
        compat.check_library_version()
        self.ws = ws
        self.sample_events = sample_events
        self._results: LRUCache[wise.ScoreResult] = LRUCache(cache_size)
        self._logs: LRUCache[wise.EventLog] = LRUCache(max(cache_size, 2))
        self._frames: LRUCache[pd.DataFrame] = LRUCache(max(cache_size, 2))
        self._backlogs: LRUCache[BacklogResult] = LRUCache(64)
        self._validation: LRUCache[pd.DataFrame] = LRUCache(16)
        self._violation_frames: LRUCache[pd.DataFrame] = LRUCache(max(cache_size, 2))
        self._global_drivers: LRUCache[pd.DataFrame] = LRUCache(16)
        self._sublogs: LRUCache[wise.EventLog] = LRUCache(max(cache_size, 2))
        self._flow_types: LRUCache[dict[str, Any]] = LRUCache(8)
        self._guidance: dict[tuple[str | None, str, str, str], GuidanceRef] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ versions, norms
    def library_version(self) -> str:
        return compat.library_version()

    def validate_norm(self, document: dict[str, Any]) -> tuple[dict[str, Any], str]:
        norm = _norm_from(document)
        return norm.to_dict(), norm.fingerprint()

    def norm_text(self, document: dict[str, Any]) -> str:
        return _norm_from(document).dumps()

    # ------------------------------------------------------------------ ingest
    def ingest(self, source: Path, kind: str, dest_dir: Path, progress: ProgressFn) -> dict[str, Any]:
        dest = dest_dir / "events.parquet"
        progress(0.05, "reading the source file")
        if kind == "csv":
            try:
                info = duck.csv_to_parquet(self.ws, source, dest)
            except ValueError as exc:
                raise ValidationError(str(exc), code="dataset.unreadable") from exc
        elif kind == "parquet":
            info = duck.parquet_copy(self.ws, source, dest)
        elif kind == "xes":
            info = self._ingest_xes(source, dest)
        else:
            raise ValidationError(f"unsupported source kind {kind!r}", code="dataset.kind")
        progress(0.6, "profiling columns")
        profiles = duck.profile_columns(self.ws, dest)
        schema = {"columns": profiles, "events": info["rows"], "encoding": info.get("encoding"), "sourceKind": kind}
        self.ws.write_json(dest_dir / "schema.json", schema)
        progress(0.95, "writing manifest")
        return {"events": info["rows"], "columns": profiles, "encoding": info.get("encoding")}

    def _ingest_xes(self, source: Path, dest: Path) -> dict[str, Any]:
        try:
            import pm4py  # type: ignore[import-not-found]
        except ImportError as exc:
            raise ValidationError(
                "XES import needs the optional pm4py package: pip install 'wise-workbench[xes]'",
                code="dataset.xes_unavailable",
            ) from exc
        df = pm4py.read_xes(str(source))
        df.columns = [str(c).strip() for c in df.columns]
        write_frame(self.ws, dest, df, index=False)
        return {"rows": len(df), "columns": list(df.columns), "encoding": None}

    def profile(self, dataset_dir: Path) -> list[dict[str, Any]]:
        schema = self.ws.read_json(dataset_dir / "schema.json")
        return list(schema.get("columns", []))

    def preview(self, dataset_dir: Path, rows: int) -> Table:
        columns, data = duck.preview(self.ws, dataset_dir / "events.parquet", rows)
        return {"columns": columns, "rows": [[jsonable(v) for v in r] for r in data]}

    def read_events(self, dataset_dir: Path, mapping: ColumnMapping) -> pd.DataFrame:
        return read_frame(dataset_dir / "events.parquet")

    # ------------------------------------------------------------------ mapping, case tables
    def validate_mapping(self, dataset_dir: Path, mapping: ColumnMapping, sample: int) -> dict[str, Any]:
        columns = [c["name"] for c in self.profile(dataset_dir)]
        mapping.check_columns(columns)
        tbl = duck.sample_events(self.ws, dataset_dir / "events.parquet", sample)
        df = tbl.to_pandas()
        log = build_log(df, mapping)
        if len(df) and log.n_missing_timestamps == len(log.events):
            raise ValidationError(
                f"no timestamp in the sample parses with format {mapping.timestamp_format!r}",
                code="mapping.timestamp_format",
                errors=[{"field": "timestampFormat", "message": "no value parses"}],
            )
        apply_flow_typing(log, mapping)
        apply_mapping_recipes(log, mapping)
        return {
            "sampleEvents": len(log.events),
            "cases": len(log),
            "activities": len(log.activity_labels),
            "missingTimestamps": int(log.n_missing_timestamps),
            "flowTypes": flow_type_counts(log),
        }

    def build_case_table(
        self,
        dataset_dir: Path,
        mapping: ColumnMapping,
        dest_dir: Path,
        progress: ProgressFn,
        *,
        provenance: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        progress(0.05, "reading events")
        df = read_frame(dataset_dir / "events.parquet")
        progress(0.2, "building the event log")
        log = build_log(df, mapping)
        del df
        apply_flow_typing(log, mapping)
        log, removed = apply_case_decisions(log, mapping)
        if removed:
            apply_flow_typing(log, mapping)
        apply_mapping_recipes(log, mapping)
        progress(0.45, "data-readiness report")
        readiness = readiness_report(log, mapping, case_noun=(provenance or {}).get("caseNoun"))
        progress(0.65, "writing the case table")
        artefacts: dict[str, dict[str, Any]] = {}
        cases_path = write_frame(self.ws, dest_dir / "cases.parquet", log.cases, index=True)
        artefacts["cases.parquet"] = {"rows": len(log), "sha256": _sha256(cases_path)}
        progress(0.8, "writing typed events")
        ev = typed_events(log, mapping)
        events_path = write_frame(self.ws, dest_dir / "events.parquet", ev, index=False)
        artefacts["events.parquet"] = {"rows": len(ev), "sha256": _sha256(events_path)}
        del ev
        activities = activity_inventory(log)
        self.ws.write_json(dest_dir / "activities.json", activities)
        self.ws.write_json(dest_dir / "quality.json", readiness.to_dict())
        attributes = [str(c) for c in log.cases.columns]
        manifest = {
            "cases": len(log),
            "events": len(log.events),
            "attributes": attributes,
            "activities": len(activities),
            "mapping": mapping.to_dict(),
            "wiseVersion": self.library_version(),
            "workbenchVersion": workbench_version,
            "writtenAt": _now(),
            "artefacts": artefacts,
            "windowEnd": readiness.window_end,
            "decisions": [dict(d) for d in mapping.decisions],
            "casesRemovedByDecisions": removed,
            **(provenance or {}),
        }
        progress(0.97, "writing manifest")
        self.ws.write_json(dest_dir / "manifest.json", manifest)
        self._logs.put(str(dest_dir), log)
        return {
            "cases": len(log),
            "events": len(log.events),
            "readiness": readiness,
            "activities": activities,
            "attributes": attributes,
        }

    def _load_log(self, case_table_dir: Path, mapping: ColumnMapping) -> wise.EventLog:
        key = str(case_table_dir)
        hit = self._logs.get(key)
        if hit is not None:
            return hit
        with self._lock:
            hit = self._logs.get(key)
            if hit is not None:
                return hit
            path = case_table_dir / "events.parquet"
            if not path.exists():
                raise NotFoundError(
                    f"case table artefacts missing under {case_table_dir}", code="case_table.artefacts_missing"
                )
            df = read_frame(path)
            log = build_log(df, mapping, typed=True)
            del df
            apply_mapping_recipes(log, mapping)
            return self._logs.put(key, log)

    def check_norm(self, case_table_dir: Path, mapping: ColumnMapping, document: dict[str, Any]) -> dict[str, Any]:
        norm = _norm_from(document)
        log = self._load_log(case_table_dir, mapping)
        issues = norm.check(log)
        try:
            if norm.derived_attributes:
                log.derive(norm.derived_attributes, overwrite=False)
        except (wise.NormError, wise.LogSchemaError) as exc:
            issues.append(f"derived attributes: {exc}")
        labels = set(log.activity_labels)
        constraints = []
        for nc in norm.constraints:
            missing = sorted({a for a in nc.constraint.activities() if a not in labels})
            in_scope = int(nc.applies_to(log.cases, log).sum()) if nc.applicability else len(log)
            try:
                evaluated = int(wise.evaluate_constraint(log, nc).notna().sum())
            except (wise.NormError, wise.LogSchemaError) as exc:
                evaluated = 0
                issues.append(f"constraint {nc.id!r}: {exc}")
            constraints.append(
                {
                    "id": nc.id,
                    "layer": nc.layer,
                    "type": nc.constraint.type,
                    "activitiesMissing": missing,
                    "casesInScope": in_scope,
                    "casesEvaluated": evaluated,
                }
            )
        return {"constraints": constraints, "issues": issues, "cases": len(log), "fingerprint": norm.fingerprint()}

    def norm_warnings(self, case_table_dir: Path, mapping: ColumnMapping, document: dict[str, Any]) -> list[str]:
        """``Norm.check``: activities and attributes the norm names that never occur in the case table (R1-08)."""
        norm = _norm_from(document)
        log = self._load_log(case_table_dir, mapping)
        return [str(w) for w in norm.check(log)]

    def preview_decision(
        self, case_table_dir: Path, mapping: ColumnMapping, kind: str, params: dict[str, Any]
    ) -> DecisionPreview:
        log = self._load_log(case_table_dir, mapping)
        return preview_decision(log, mapping, kind, params)

    def case_table_window_end(self, case_table_dir: Path) -> str | None:
        path = case_table_dir / "quality.json"
        if path.exists():
            end = self.ws.read_json(path).get("windowEnd")
            return str(end) if end else None
        return None

    # ------------------------------------------------------------------ runs
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
    ) -> dict[str, Any]:
        started = _now()
        norm = _norm_from(document)
        progress(0.05, "loading the event log")
        log = self._scoped_log(case_table_dir, mapping, run.params.scope)
        norm_warnings = [str(w) for w in norm.check(log)]
        window_end = self.case_table_window_end(case_table_dir) or jsonable(resolve_window_end(log))
        views = list(run.params.views) or norm.view_names
        for v in views:
            if v not in norm.view_names:
                raise ValidationError(f"view {v!r} is not in the norm; available: {norm.view_names}", code="run.view")
        for s in run.params.slicings:
            missing = [
                a
                for a in s.attributes
                if a not in log.cases.columns and a not in {r["name"] for r in norm.derived_attributes}
            ]
            if missing:
                raise ValidationError(
                    f"slicing {s.id!r} uses attributes that are not in the case table: {missing}",
                    code="run.slicing_attribute",
                    errors=[{"field": "slicings", "message": f"unknown attribute {m}"} for m in missing],
                )
        progress(0.15, "scoring cases")
        with self._lock:
            try:
                result = wise.score(log, norm, views)
            except (wise.NormError, wise.LogSchemaError) as exc:
                raise ValidationError(str(exc), code="run.score") from exc
            self._results.put(run.id, result)
        artefacts: dict[str, dict[str, Any]] = {}

        def persist(name: str, df: pd.DataFrame, index: bool = True) -> None:
            path = write_frame(self.ws, dest_dir / name, df, index=index)
            artefacts[name] = {"rows": len(df), "sha256": _sha256(path)}

        progress(0.35, "writing per-case frames")
        frame = result.frame(None)
        persist("frame.parquet", frame)
        persist("violations.parquet", result.violations)
        persist("in_scope.parquet", result.in_scope)
        self._frames.put(run.id, frame)
        gamma, min_cases = run.params.gamma, run.params.min_cases
        replication = wise.event_replication(log)
        censored = censored_flags(log, mapping, window_end=window_end)
        n_steps = max(len(run.params.slicings) * len(views), 1)
        step = 0
        summary_extra: dict[str, Any] = {"concentration": {}, "agreement": {}}
        for s in run.params.slicings:
            bands = [dict(b) for b in s.bands]
            attrs = effective_attributes(list(s.attributes), bands)
            frame_s = apply_bands(frame, bands) if bands else frame
            for view in views:
                step += 1
                progress(0.35 + 0.5 * step / n_steps, f"backlog {s.id} × {view}")
                backlog = self._compute_backlog(
                    frame_s, attrs, view, gamma, min_cases, norm=norm, violations=result.violations, bands=bands
                )
                self._backlogs.put((run.id, s.id, view, gamma, min_cases, None, None), backlog)
                persist(_artefact_name("backlogs", s.id, view), backlog.table.to_pandas(), index=False)
                drivers = wise.layer_drivers(_view_frame(frame_s, view), attrs)
                persist(_artefact_name("drivers", s.id, view), drivers)
                if not bands:
                    validation = wise.validation_table(
                        result, view, attrs, censored=censored, replication=replication, gamma=gamma
                    )
                    self._validation.put((run.id, tuple(attrs), view, gamma), validation)
                    persist(_artefact_name("diagnostics/validation", s.id, view), validation)
                conc = wise.concentration(backlog_frame_for_concentration(backlog))
                summary_extra["concentration"].setdefault(s.id, {})[view] = table_from_frame(conc)
            if not bands:
                agreement = wise.view_agreement(result, attrs, k=20, gamma=gamma)
                persist(_artefact_name("diagnostics/agreement", s.id), agreement)
                summary_extra["agreement"][s.id] = table_from_frame(agreement)
        progress(0.9, "writing summary")
        summary = self._summary_dict(result)
        summary.update(summary_extra)
        self.ws.write_json(dest_dir / "summary.json", summary)
        manifest = {
            "normFingerprint": result.norm_fingerprint,
            "contentHash": content_hash,
            "mappingId": mapping.id,
            "paramsHash": run.params_hash,
            "wiseVersion": self.library_version(),
            "workbenchVersion": workbench_version,
            "startedAt": started,
            "finishedAt": _now(),
            "artefacts": artefacts,
            "views": views,
            "slicings": [s.to_dict() for s in run.params.slicings],
            "gamma": gamma,
            "minCases": min_cases,
            "cases": len(result.scores),
            "scoringMode": result.mode,
            "scope": dict(run.params.scope) if run.params.scope else None,
            "windowEnd": window_end,
            "normWarnings": norm_warnings,
        }
        progress(0.98, "writing manifest")
        self.ws.write_json(dest_dir / "manifest.json", manifest)
        return manifest

    def _summary_dict(self, result: wise.ScoreResult) -> dict[str, Any]:
        summary = result.summary()
        layers = summary[[c for c in summary.columns if c.startswith("contrib__")]].rename(
            columns=lambda c: c[len("contrib__") :]
        )
        return {
            "means": {str(v): jsonable(summary.loc[v, "mean_score"]) for v in summary.index},
            "scored": {str(v): int(summary.loc[v, "n_scored"]) for v in summary.index},
            "density": {
                "evaluated": result.applicability_density(scope=False),
                "inScope": result.applicability_density(scope=True),
            },
            "layers": table_from_frame(layers),
            "cases": len(result.scores),
            "views": list(result.views),
        }

    # ------------------------------------------------------------------ live objects
    def _scoped_log(self, case_table_dir: Path, mapping: ColumnMapping, scope: dict[str, Any] | None) -> wise.EventLog:
        """The case table's log, restricted to the run's scope (a flow type) when it has one."""
        log = self._load_log(case_table_dir, mapping)
        if not scope:
            return log
        key = (str(case_table_dir), json.dumps(scope, sort_keys=True))
        hit = self._sublogs.get(key)
        if hit is not None:
            return hit
        with self._lock:
            hit = self._sublogs.get(key)
            if hit is not None:
                return hit
            mask = scope_mask(log, scope)
            assert mask is not None
            return self._sublogs.put(key, sublog(log, mapping, mask))

    def _run_log(self, ctx: RunContext) -> wise.EventLog:
        return self._scoped_log(ctx.case_table_dir, ctx.mapping, ctx.scope)

    def _get_result(self, run: Run, ctx: RunContext) -> wise.ScoreResult:
        hit = self._results.get(run.id)
        if hit is not None:
            return hit
        with self._lock:
            hit = self._results.get(run.id)
            if hit is not None:
                return hit
            log = self._run_log(ctx)
            norm = _norm_from(ctx.document)
            result = wise.score(log, norm, list(ctx.views) or None)
            return self._results.put(run.id, result)

    def _get_frame(self, run: Run, ctx: RunContext) -> pd.DataFrame:
        hit = self._frames.get(run.id)
        if hit is not None:
            return hit
        path = ctx.run_dir / "frame.parquet"
        if path.exists():
            frame = read_frame(path, index=ctx.mapping.case_id)
            return self._frames.put(run.id, frame)
        return self._frames.put(run.id, self._get_result(run, ctx).frame(None))

    def _get_violations(self, run: Run, ctx: RunContext) -> pd.DataFrame:
        hit = self._violation_frames.get(run.id)
        if hit is not None:
            return hit
        live = self._results.get(run.id)
        if live is not None:
            return self._violation_frames.put(run.id, live.violations)
        path = ctx.run_dir / "violations.parquet"
        if path.exists():
            return self._violation_frames.put(run.id, read_frame(path, index=ctx.mapping.case_id))
        return self._violation_frames.put(run.id, self._get_result(run, ctx).violations)

    def is_cached(self, run_id: str) -> bool:
        return run_id in self._results

    # ------------------------------------------------------------------ backlog
    def _compute_backlog(
        self,
        frame: pd.DataFrame,
        attrs: list[str],
        view: str,
        gamma: float,
        min_cases: int,
        *,
        norm: wise.Norm | None = None,
        violations: pd.DataFrame | None = None,
        bands: list[dict[str, Any]] | None = None,
        baseline: float | None = None,
        scope: dict[str, Any] | None = None,
    ) -> BacklogResult:
        vf = _label_missing_keys(_view_frame(frame, view), attrs)
        try:
            bl = wise.prioritize(vf, attrs, gamma=gamma, min_cases=1, z=Z_LOWER, baseline=baseline)
            drivers = wise.layer_drivers(vf, attrs)
        except wise.NotScoredError as exc:
            raise ValidationError(str(exc), code="backlog.unscored") from exc
        except wise.NormError as exc:
            raise ValidationError(str(exc), code="backlog.params") from exc
        bl = bl[bl["n_cases"] >= int(min_cases)].copy()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", pd.errors.PerformanceWarning)
            hot = wise.hotspot_table(bl, top=HOTSPOT_TOP, drivers=drivers)
        bl["hotspot_type"] = hot["hotspot"].reindex(bl.index)
        bl["dominant_layer"] = drivers["dominant_layer"].reindex(bl.index)
        bl["rank"] = np.arange(1, len(bl) + 1)
        bl["stability"] = "unknown"
        bl["n_ranked"] = len(bl)
        out = bl.reset_index()
        keys = [list(t) for t in out[attrs].itertuples(index=False, name=None)]
        out["key"] = [slice_key(k) for k in keys]
        out["hotspot_type"] = out["hotspot_type"].astype(object).where(out["hotspot_type"].notna(), None)
        out["dominant_layer"] = out["dominant_layer"].astype(object).where(out["dominant_layer"].notna(), None)
        # plain-language fields: kind of problem, most-missed expectation area and the expectation missed most in it
        out["kind"] = [kind_of(h) for h in out["hotspot_type"]]
        out["kind_reading"] = [kind_reading(k) for k in out["kind"]]
        layer_names = _layer_names(norm)
        out["dominant_layer_name"] = [
            layer_names.get(str(layer), str(layer)) if layer else None for layer in out["dominant_layer"]
        ]
        top = _top_constraints(vf, attrs, keys, list(out["dominant_layer"]), norm, violations)
        out["top_constraint"] = [t[0] for t in top]
        out["top_constraint_description"] = [t[1] for t in top]
        out["top_constraint_share"] = [t[2] for t in top]
        labels = [" × ".join(key_label(v) for v in k) for k in keys]
        readings = []
        for label, rec in zip(labels, out.to_dict(orient="records")):
            readings.append(backlog_reading({str(k): jsonable(v) for k, v in rec.items()}, view, gamma, label))
        out["reading"] = readings
        for col in ("top_constraint", "top_constraint_description", "kind", "kind_reading", "dominant_layer_name"):
            out[col] = out[col].astype(object).where(out[col].notna(), None)
        out["top_constraint_share"] = pd.to_numeric(out["top_constraint_share"], errors="coerce")
        table = pa.Table.from_pandas(out, preserve_index=False)
        global_mean = float(bl.attrs.get("baseline", np.nan)) if len(bl) or "baseline" in bl.attrs else None
        return BacklogResult(
            table=table,
            attributes=attrs,
            view=view,
            gamma=gamma,
            min_cases=min_cases,
            global_mean=global_mean,
            bands=list(bands or []),
            scope=scope,
        )

    def backlog(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str],
        view: str | None,
        gamma: float | None,
        min_cases: int,
        *,
        bands: list[dict[str, Any]] | None = None,
        drill: dict[str, Any] | None = None,
        filter_obj: dict[str, Any] | None = None,
    ) -> BacklogResult:
        """The backlog of a slicing (run slicing or ad hoc; banded numeric attributes; ``drill`` restricts the cases
        to one group of a coarser slicing, ``filter_obj`` to the canonical filter), enriched with the cached
        analytics (stability, kind, comparison, caveats) when the analytics job has run."""
        view = view or (ctx.views[0] if ctx.views else self._first_view(ctx))
        gamma = ctx.gamma if gamma is None else float(gamma)
        bands = [dict(b) for b in bands or []]
        sid = ctx.slicing_id(list(attributes), bands)
        cache_id = sid or json.dumps([list(attributes), bands], sort_keys=True)
        scope_key = (
            json.dumps({"drill": drill, "filter": filter_obj}, sort_keys=True, default=str)
            if (drill or filter_obj)
            else None
        )
        stamp = an.AnalyticsStore(self.ws, ctx.run_dir).manifest_stamp()
        key = (run.id, cache_id, view, gamma, int(min_cases), scope_key, stamp)
        hit = self._backlogs.get(key)
        if hit is not None:
            return hit
        base: BacklogResult | None = None
        eff = effective_attributes(list(attributes), bands)
        if sid is not None and gamma == ctx.gamma and int(min_cases) == ctx.min_cases and scope_key is None:
            path = ctx.run_dir / _artefact_name("backlogs", sid, view)
            if path.exists():
                table = read_table(path)
                # artefacts written before the plain-language fields existed are recomputed from the frame
                if "kind" in table.column_names:
                    global_mean = None
                    if "global_mean" in table.column_names and table.num_rows:
                        global_mean = float(table.column("global_mean")[0].as_py())
                    base = BacklogResult(table, eff, view, gamma, int(min_cases), global_mean, bands=bands)
        if base is None:
            frame = self._get_frame(run, ctx)
            missing = [a for a in attributes if a not in frame.columns and a != frame.index.name]
            if missing:
                raise ValidationError(f"unknown slice attributes {missing}", code="backlog.attribute")
            if view not in _views_in(frame):
                raise ValidationError(
                    f"view {view!r} is not part of this run; available: {_views_in(frame)}", code="backlog.view"
                )
            norm = _norm_from(ctx.document)
            violations = self._get_violations(run, ctx)
            frame_b = apply_bands(frame, bands) if bands else frame
            baseline: float | None = None
            scope: dict[str, Any] | None = None
            if drill or filter_obj:
                score_col = f"score__{view}"
                baseline = float(frame_b[score_col].mean())
                mask = pd.Series(True, index=frame_b.index)
                scope = {}
                if drill:
                    d_bands = [dict(b) for b in drill.get("bands") or []]
                    d_attrs = effective_attributes(list(drill["attributes"]), d_bands)
                    d_frame = apply_bands(frame_b, d_bands) if d_bands else frame_b
                    mask &= _slice_mask(d_frame, d_attrs, list(drill["key"]))
                    scope["drill"] = {
                        "slicing": drill.get("id") or ",".join(d_attrs),
                        "attributes": d_attrs,
                        "key": list(drill["key"]),
                    }
                if filter_obj:
                    fmask, _parts = filter_masks(self._run_log(ctx), filter_obj, censored=self._censored(ctx))
                    mask &= fmask.reindex(frame_b.index, fill_value=False).astype(bool)
                    scope["filter"] = filter_obj
                frame_b = frame_b[mask.to_numpy()]
                scope["cases"] = len(frame_b)
                if frame_b.empty:
                    raise NotFoundError("the drill-in or filter selects no case", code="backlog.empty_scope")
            base = self._compute_backlog(
                frame_b,
                eff,
                view,
                gamma,
                int(min_cases),
                norm=norm,
                violations=violations,
                bands=bands,
                baseline=baseline,
                scope=scope,
            )
        return self._backlogs.put(key, self._enrich_backlog(base, run, ctx, sid))

    def _censored(self, ctx: RunContext) -> pd.Series | None:
        return censored_flags(self._run_log(ctx), ctx.mapping, window_end=ctx.window_end)

    def _guidance_for(self, ctx: RunContext, kind: str, entry_id: str) -> GuidanceRef:
        key = (ctx.process, kind, entry_id, str(ctx.document.get("name")))
        hit = self._guidance.get(key)
        if hit is None:
            hit = guidance_ref(ctx.process, kind, entry_id, document=ctx.document)
            self._guidance[key] = hit
        return hit

    def _warned_constraints(self, ctx: RunContext) -> dict[str, str]:
        """Constraint id → warning text for the norm warnings of the run (activities that never occur)."""
        out: dict[str, str] = {}
        for w in ctx.norm_warnings:
            if w.startswith("constraint '"):
                cid = w.split("'", 2)[1]
                out.setdefault(cid, w)
        return out

    def _enrich_backlog(self, base: BacklogResult, run: Run, ctx: RunContext, sid: str | None) -> BacklogResult:
        """Add the cycle 2 plain fields to every row: stability, kind, kind_reading, comparison, caveats,
        plain_layer, layer_missed_label, case_noun, points_below, reading_plain."""
        df = base.table.to_pandas()
        attrs = base.attributes
        noun = ctx.case_noun
        ba = an.load_backlog_analytics(self.ws, ctx.run_dir, sid, attrs, base.view) if sid else None
        window_end = pd.Timestamp(ctx.window_end) if ctx.window_end else None
        if ba is not None and ba.window_end is not None:
            window_end = ba.window_end
        norm = _norm_from(ctx.document)
        by_layer: dict[str, list[str]] = {}
        for nc in norm.constraints:
            by_layer.setdefault(str(nc.layer), []).append(nc.id)
        warned = self._warned_constraints(ctx)
        keys = (
            [tuple(key_label(v) for v in (r[a] for a in attrs)) for r in df[attrs].to_dict("records")]
            if len(df)
            else []
        )
        idx_keys: list[Any] = [k if len(attrs) > 1 else k[0] for k in keys]

        def lookup(table: pd.DataFrame | None, col: str) -> list[Any]:
            if table is None or col not in table.columns:
                return [None] * len(df)
            series = table[col]
            series = series[~series.index.duplicated(keep="first")]
            out = []
            for k in idx_keys:
                try:
                    out.append(jsonable(series.loc[k]))
                except KeyError:
                    out.append(None)
            return out

        use_stability = base.scope is None
        stability = lookup(ba.stability if (ba and use_stability) else None, "stability")
        df["stability"] = [s_ or "unknown" for s_ in stability]
        df["stability_reason"] = lookup(ba.stability if (ba and use_stability) else None, "stability_reason")
        for col in ("rank_lo", "rank_hi", "stable_PI_lo", "stable_PI_hi", "stable_gap_lo", "stable_gap_hi"):
            df[col] = lookup(ba.stability if (ba and use_stability) else None, col)
        p_col = None
        if ba is not None and ba.stability is not None:
            p_cols = [c for c in ba.stability.columns if c.startswith("p_top")]
            p_col = sorted(p_cols, key=lambda c: int(c[5:]))[-1] if p_cols else None
        df["p_top"] = lookup(ba.stability if (ba and use_stability and p_col) else None, p_col or "")
        kinds = lookup(ba.kinds if ba else None, "kind")
        df["kind"] = [
            k if k in ("acute", "systematic", "widespread") else (None if k == "none" else kind_of(h))
            for k, h in zip(kinds, df["hotspot_type"])
        ]
        df["kind_source"] = [
            "analytics" if k in ("acute", "systematic", "widespread", "none") else ("library" if h else None)
            for k, h in zip(kinds, df["hotspot_type"])
        ]
        plain_layers, missed_labels = [], []
        for layer in df["dominant_layer"]:
            ref = self._guidance_for(ctx, "layer", str(layer)) if layer else None
            plain_layers.append(ref.plain_name if ref and ref.plain_name else None)
            missed_labels.append(ref.missed_label if ref else None)
        df["plain_layer"] = [p_ or _text(n_) for p_, n_ in zip(plain_layers, df["dominant_layer_name"])]
        df["layer_missed_label"] = missed_labels
        df["kind_reading"] = [
            an.kind_reading(k, items=noun, plain_layer=(m_ or p_) if k == "systematic" else None) if k else None
            for k, p_, m_ in zip(df["kind"], map(_text, df["plain_layer"]), map(_text, df["layer_missed_label"]))
        ]
        df["case_noun"] = noun
        df["points_below"] = [an.points_below(m, g) for m, g in zip(df["mean_score"], df["global_mean"])]
        df["comparison"] = lookup(ba.comparisons if ba else None, "comparison")
        df["comparison_kind"] = lookup(ba.comparisons if ba else None, "comparison_kind")
        top_plain = []
        for cid in df["top_constraint"]:
            ref = self._guidance_for(ctx, "constraint", str(cid)) if cid else None
            top_plain.append(ref.plain_name if ref else None)
        df["top_constraint_plain"] = top_plain
        caveats_json = []
        share_cols = {k: f"{k}_share" for k in an.CAVEAT_KINDS}
        for i, k in enumerate(idx_keys):
            shares: dict[str, float] = {}
            if ba is not None and ba.caveats is not None:
                try:
                    row = ba.caveats.loc[k]
                    if isinstance(row, pd.DataFrame):
                        row = row.iloc[0]
                    shares = {kind: float(row[col]) for kind, col in share_cols.items() if col in row.index}
                except KeyError:
                    shares = {}
            items = an.caveat_texts(shares, items=noun, window_end=window_end, closure_label=ctx.closure_label)
            layer = df["dominant_layer"].iloc[i]
            for cid in by_layer.get(str(layer), []) if layer else []:
                if cid in warned:
                    items.append(
                        {
                            "id": "norm_warning",
                            "share": None,
                            "status": "warn",
                            "text": f"{warned[cid]}; this expectation is never missed for that reason.",
                            "window_end": None,
                        }
                    )
            caveats_json.append(json.dumps(items, ensure_ascii=False))
        df["caveats_json"] = caveats_json
        df["n_caveats"] = [len(json.loads(c)) for c in caveats_json]
        readings = []
        for rec in df.to_dict("records"):
            readings.append(_plain_reading(rec, attrs, noun))
        df["reading_plain"] = readings
        for col in (
            "stability_reason",
            "kind",
            "kind_source",
            "kind_reading",
            "plain_layer",
            "layer_missed_label",
            "comparison",
            "comparison_kind",
            "top_constraint_plain",
            "points_below",
        ):
            df[col] = df[col].astype(object).where(df[col].notna(), None)
        analytics_info = {
            "available": bool(ba is not None and ba.available),
            "package": an.availability(),
            "recordIds": dict(ba.record_ids) if ba else {},
            "windowEnd": jsonable(window_end),
            "stabilityApplies": use_stability,
        }
        return BacklogResult(
            table=pa.Table.from_pandas(df, preserve_index=False),
            attributes=attrs,
            view=base.view,
            gamma=base.gamma,
            min_cases=base.min_cases,
            global_mean=base.global_mean,
            bands=base.bands,
            scope=base.scope,
            analytics=analytics_info,
            enriched=True,
        )

    def _first_view(self, ctx: RunContext) -> str:
        views = [str(v["name"]) for v in ctx.document.get("views", [])]
        if not views:
            raise ValidationError("the norm has no views", code="norm.invalid")
        return views[0]

    # ------------------------------------------------------------------ slice detail
    def slice_detail(
        self,
        run: Run,
        ctx: RunContext,
        attributes: list[str],
        key: list[Any],
        view: str | None,
        drilldown: str | None,
        *,
        bands: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        view = view or (ctx.views[0] if ctx.views else self._first_view(ctx))
        bands = [dict(b) for b in bands or []]
        backlog = self.backlog(run, ctx, attributes, view, None, 1, bands=bands)
        row = backlog.find(key)
        if row is None:
            raise NotFoundError(f"slice {key} not found in slicing {attributes}", code="slice.not_found")
        result = self._get_result(run, ctx)
        given = list(attributes)
        attributes = effective_attributes(given, bands)
        cases_b = apply_bands(result.cases, bands, reference=self._get_frame(run, ctx)) if bands else result.cases
        mask = _slice_mask(cases_b, attributes, key)
        drivers_df = wise.constraint_drivers(result, view, where=mask).copy()
        # contribution of each expectation to the group's shortfall: its mean effective penalty in the group
        # minus the same in the whole log; the contributions sum to the gap (layer_balanced scoring)
        global_df = self._global_constraint_drivers(run, ctx, result, view)
        gap = float(row.get("gap") or 0.0)
        delta_penalty = drivers_df["mean_penalty"] - global_df["mean_penalty"].reindex(drivers_df.index)
        drivers_df["delta_gap"] = delta_penalty
        drivers_df["share_of_shortfall"] = (delta_penalty / gap) if gap > 0 else delta_penalty * np.nan
        drivers_df = drivers_df.sort_values("delta_gap", ascending=False, kind="mergesort")
        drivers_records = records_from_frame(drivers_df)
        frame = self._get_frame(run, ctx)
        frame = apply_bands(frame, bands) if bands else frame
        vf = _view_frame(frame, view)
        ld = wise.layer_drivers(vf, attributes)
        layer_rows = []
        pos = _locate(ld, attributes, key)
        layer_ids = list(result.norm.layer_ids)
        if pos is not None:
            rec = ld.iloc[pos]
            for layer in layer_ids:
                delta = float(rec.get(f"{layer}__delta", np.nan))
                mean = float(rec.get(layer, np.nan))
                layer_rows.append([layer, jsonable(mean), jsonable(mean - delta), jsonable(delta)])
        layers: Table = {"columns": ["layer", "slice_mean", "global_mean", "delta"], "rows": layer_rows}
        drill = drilldown or _default_drilldown(ctx.document, result.cases.columns, attributes)
        penalty: Table = {"columns": [], "rows": []}
        if drill and drill in result.cases.columns:
            try:
                pm = wise.penalty_mass(result, view, drill, where=mask)
                penalty = table_from_frame(pm, limit=50)
                if penalty["columns"] and penalty["columns"][0] == drill:
                    penalty["columns"] = ["key", *penalty["columns"][1:]]
            except wise.NotScoredError:
                penalty = {
                    "columns": ["key", "n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "rank"],
                    "rows": [],
                }
        validation_row: dict[str, Any] = {}
        if not bands:
            validation = self._validation_table(run, ctx, result, attributes, view)
            vpos = _locate(validation, attributes, key)
            if vpos is not None:
                validation_row = {str(k): jsonable(v) for k, v in validation.iloc[vpos].to_dict().items()}
        worst = result.worst_cases(view, n=20, where=mask)
        viol = result.violations.loc[worst.index]
        worst_cases = []
        for (cid, score), (_, v) in zip(worst["score"].items(), viol.iterrows()):
            worst_cases.append(
                {"caseId": str(cid), "score": jsonable(score), "violated": [str(c) for c in v.index[v.fillna(0) > 0]]}
            )
        label = " × ".join(key_label(v) for v in key)
        reading = slice_reading(row, drivers_records, view, backlog.gamma, label)
        extra = self._slice_analytics(run, ctx, result, given, key, view, row, mask, drivers_df, bands=bands)
        return {
            "row": row,
            "reading": reading,
            "drivers": table_from_frame(drivers_df),
            "layers": layers,
            "penaltyMass": penalty,
            "penaltyMassBy": drill,
            "validation": validation_row,
            "worstCases": worst_cases,
            "params": {
                "view": view,
                "gamma": backlog.gamma,
                "slicing": given,
                "attributes": attributes,
                "key": key,
                "bands": bands,
                "window_end": jsonable(ctx.window_end),
                "case_noun": ctx.case_noun,
                "scope": ctx.scope,
                "analytics_record_ids": extra.get("record_ids", {}),
            },
            **{k: v for k, v in extra.items() if k != "record_ids"},
        }

    def _slice_analytics(
        self,
        run: Run,
        ctx: RunContext,
        result: wise.ScoreResult,
        attributes: list[str],
        key: list[Any],
        view: str,
        row: dict[str, Any],
        mask: pd.Series,
        drivers_df: pd.DataFrame,
        *,
        bands: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Contrast, headroom, sub-groups, caveats, guidance references and the plain reading of one group."""
        noun = ctx.case_noun
        norm = result.norm
        window_end = pd.Timestamp(ctx.window_end) if ctx.window_end else None
        sid = ctx.slicing_id(attributes, bands)
        attributes = effective_attributes(attributes, bands)
        # caveats: cached shares from the analytics job, else computed here with the same definitions
        caveats: list[dict[str, Any]] = []
        if sid:
            caveats = an.slice_caveats(
                self.ws,
                ctx.run_dir,
                slicing_id=sid,
                attrs=attributes,
                key=key,
                items=noun,
                closure_label=ctx.closure_label,
            )
        if not caveats:
            caveats = self._direct_caveats(ctx, mask, window_end)
        warned = self._warned_constraints(ctx)
        layer = row.get("dominant_layer")
        for nc in norm.constraints:
            if str(nc.layer) == str(layer) and nc.id in warned:
                caveats.append(
                    {
                        "id": "norm_warning",
                        "share": None,
                        "status": "warn",
                        "text": f"{warned[nc.id]}; this expectation is never missed for that reason.",
                        "window_end": None,
                    }
                )
        guidance_refs: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        def add_ref(kind: str, entry_id: Any) -> None:
            if not entry_id or (kind, str(entry_id)) in seen:
                return
            seen.add((kind, str(entry_id)))
            ref = self._guidance_for(ctx, kind, str(entry_id))
            guidance_refs.append(
                {
                    "kind": kind,
                    "id": str(entry_id),
                    "plain_name": ref.plain_name,
                    "missed_label": ref.missed_label,
                    "hub_node": ref.hub_node,
                }
            )

        add_ref("layer", layer)
        for cid in list(drivers_df.index[:3]):
            add_ref("constraint", cid)
        analytics_out: dict[str, Any] = {}
        record_ids: dict[str, str] = {}
        contrast: Table = {"columns": [], "rows": []}
        headroom: Table = {
            "columns": ["layer", "headroom", "note"],
            "rows": [[lid, None, "not available: wise-analytics is not installed"] for lid in norm.layer_ids],
        }
        subgroups: Table = {"columns": [], "rows": []}
        comparison: str | None = row.get("comparison")
        comparisons: Table = {"columns": [], "rows": []}
        if an.availability()["available"]:
            self._ensure_band_columns(run, ctx, result, bands)
            log = result.log or self._run_log(ctx)
            censored = self._censored(ctx)
            drill_keys = [str(k) for k in (ctx.document.get("metadata") or {}).get("drilldown_keys") or []]
            sub_attrs = [a for a in [*drill_keys, "flow_type"] if a in result.cases.columns and a not in attributes]
            if not sub_attrs:
                sub_attrs = [
                    str(c)
                    for c in result.cases.columns
                    if c not in ("n_events", "first_ts", "last_ts", "exposure")
                    and c not in attributes
                    and result.cases[c].nunique() <= 500
                ][:2]
            try:
                analytics_out = (
                    an.slice_analytics(
                        self.ws,
                        ctx.run_dir,
                        result=result,
                        log=log,
                        mapping=ctx.mapping,
                        norm=norm,
                        view=view,
                        attrs=attributes,
                        key=key,
                        gamma=ctx.gamma,
                        case_noun=noun,
                        closure_label=ctx.closure_label,
                        subgroup_attributes=sub_attrs,
                        window_end=window_end,
                        censored=censored,
                        labels=lambda cid: self._guidance_for(ctx, "constraint", cid).plain_name,
                        bootstrap_b=int(ctx.analytics.get("bootstrap_b", 200)),
                    )
                    or {}
                )
            except (wise.NotScoredError, wise.NormError) as exc:
                analytics_out = {"error": str(exc)}
            record_ids = dict(analytics_out.get("record_ids") or {})
            ct = analytics_out.get("contrast")
            if ct is not None:
                contrast = _contrast_table(ct, lambda cid: self._guidance_for(ctx, "constraint", cid))
            ht = analytics_out.get("headroom")
            if ht is not None:
                headroom = _headroom_table(ht, lambda cid: self._guidance_for(ctx, "constraint", cid))
            st = analytics_out.get("subgroups")
            if st is not None:
                subgroups = _subgroups_table(st)
            if analytics_out.get("comparison"):
                comparison = str(analytics_out["comparison"])
            cp = analytics_out.get("comparisons")
            if cp is not None:
                comparisons = table_from_frame(cp)
        kind = row.get("kind")
        plain_layer = row.get("plain_layer") or row.get("dominant_layer_name")
        parts = [f"{' × '.join(key_label(v) for v in key)}: {int(row.get('n_cases') or 0):,} {noun}"]
        pb = row.get("points_below") or an.points_below(row.get("mean_score"), row.get("global_mean"))
        if pb:
            parts[0] += f", {pb}"
        if kind:
            parts.append(str(row.get("kind_reading") or an.kind_reading(kind, items=noun)))
        if plain_layer and not (kind == "systematic" and plain_layer in parts[-1]):
            parts.append(f"most often missed: {plain_layer}")
        reading_plain = "; ".join(parts) + "."
        if comparison:
            reading_plain += f" {comparison}"
        if caveats:
            reading_plain += f" Caveat: {caveats[0]['text']}."
        return {
            "contrast": contrast,
            "headroom": headroom,
            "caveats": caveats,
            "subgroups": subgroups,
            "guidance_refs": guidance_refs,
            "reading_plain": reading_plain,
            "comparison": comparison,
            "comparisons": comparisons,
            "analytics": {
                "available": an.availability()["available"],
                "recordIds": record_ids,
                "readings": list(analytics_out.get("readings") or []),
                "error": analytics_out.get("error") or analytics_out.get("subgroups_error"),
            },
            "record_ids": record_ids,
        }

    def _direct_caveats(
        self, ctx: RunContext, mask: pd.Series, window_end: pd.Timestamp | None
    ) -> list[dict[str, Any]]:
        """Censoring, replication and duplicate shares of a group computed from the log (same definitions)."""
        log = self._run_log(ctx)
        m = mask.reindex(log.case_ids, fill_value=False).to_numpy(dtype=bool)
        n = int(m.sum())
        if n == 0:
            return []
        shares: dict[str, float] = {}
        censored = censored_flags(log, ctx.mapping, window_end=window_end)
        if censored is not None:
            shares["censoring"] = float(censored.to_numpy(dtype=bool)[m].mean())
        rep = wise.event_replication(log)
        shares["replication"] = float((rep["replication_ratio"] > 2.0).to_numpy()[m].mean())
        dup = log.events.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col]).to_numpy()
        per_case = np.bincount(log._codes[dup], minlength=len(log)) > 0
        shares["duplicates"] = float(per_case[m].mean())
        return an.caveat_texts(shares, items=ctx.case_noun, window_end=window_end, closure_label=ctx.closure_label)

    def _global_constraint_drivers(
        self, run: Run, ctx: RunContext, result: wise.ScoreResult, view: str
    ) -> pd.DataFrame:
        key = (run.id, view)
        hit = self._global_drivers.get(key)
        if hit is not None:
            return hit
        return self._global_drivers.put(key, wise.constraint_drivers(result, view))

    def _validation_table(
        self, run: Run, ctx: RunContext, result: wise.ScoreResult, attributes: list[str], view: str
    ) -> pd.DataFrame:
        key = (run.id, tuple(attributes), view, ctx.gamma)
        hit = self._validation.get(key)
        if hit is not None:
            return hit
        sid = ctx.slicing_id(attributes)
        if sid is not None:
            path = ctx.run_dir / _artefact_name("diagnostics/validation", sid, view)
            if path.exists():
                return self._validation.put(key, read_frame(path, index=list(attributes)))
        log = result.log or self._load_log(ctx.case_table_dir, ctx.mapping)
        table = wise.validation_table(
            result,
            view,
            attributes,
            censored=censored_flags(log, ctx.mapping),
            replication=wise.event_replication(log),
            gamma=ctx.gamma,
        )
        return self._validation.put(key, table)

    def diagnostics(self, run: Run, ctx: RunContext, attributes: list[str], view: str | None) -> Table:
        view = view or (ctx.views[0] if ctx.views else self._first_view(ctx))
        sid = ctx.slicing_id(attributes)
        if sid is not None:
            path = ctx.run_dir / _artefact_name("diagnostics/validation", sid, view)
            if path.exists():
                return table_from_frame(read_frame(path), index=False)
        result = self._get_result(run, ctx)
        return table_from_frame(self._validation_table(run, ctx, result, attributes, view))

    # ------------------------------------------------------------------ summary
    def summary(self, run: Run, ctx: RunContext) -> dict[str, Any]:
        path = ctx.run_dir / "summary.json"
        if path.exists():
            return dict(self.ws.read_json(path))
        result = self._get_result(run, ctx)
        return self._summary_dict(result)

    # ------------------------------------------------------------------ trace
    def trace(self, run: Run, ctx: RunContext, case_id: str) -> dict[str, Any]:
        mapping = ctx.mapping
        events = duck.trace_events(self.ws, ctx.case_table_dir / "events.parquet", mapping.case_id, case_id).to_pandas()
        if events.empty:
            raise NotFoundError(f"case {case_id!r} not found", code="case.not_found")
        frame_rows = duck.trace_events(self.ws, ctx.run_dir / "frame.parquet", mapping.case_id, case_id).to_pandas()
        viol_rows = duck.trace_events(self.ws, ctx.run_dir / "violations.parquet", mapping.case_id, case_id).to_pandas()
        norm = _norm_from(ctx.document)
        violated: dict[str, list[str]] = {}
        violations: dict[str, Any] = {}
        if not viol_rows.empty:
            v = viol_rows.iloc[0]
            for nc in norm.constraints:
                value = v.get(nc.id)
                violations[nc.id] = jsonable(value)
                if value is not None and not pd.isna(value) and float(value) > 0:
                    for a in nc.constraint.activities():
                        violated.setdefault(a, []).append(nc.id)
        attributes: dict[str, Any] = {}
        scores: dict[str, Any] = {}
        if not frame_rows.empty:
            rec = frame_rows.iloc[0]
            for col, value in rec.items():
                col = str(col)
                if col.startswith("score__"):
                    scores[col[len("score__") :]] = jsonable(value)
                elif not col.startswith("contrib__") and col != mapping.case_id:
                    attributes[col] = jsonable(value)
        out_events = []
        sort_cols = [mapping.timestamp] + ([mapping.order] if mapping.order and mapping.order in events.columns else [])
        events = events.sort_values(sort_cols, kind="mergesort")
        for _, e in events.iterrows():
            act = e.get(mapping.activity)
            out_events.append(
                {
                    "activity": None if pd.isna(act) else str(act),
                    "canonicalId": None,
                    "timestamp": jsonable(e.get(mapping.timestamp)),
                    "resource": jsonable(e.get(mapping.resource)) if mapping.resource else None,
                    "lifecycle": jsonable(e.get(mapping.lifecycle)) if mapping.lifecycle else None,
                    "violates": list(violated.get(str(act), [])) if not pd.isna(act) else [],
                    "attributes": {
                        str(k): jsonable(v)
                        for k, v in e.items()
                        if k not in (mapping.case_id, mapping.activity, mapping.timestamp)
                    },
                }
            )
        return {
            "caseId": case_id,
            "attributes": attributes,
            "scores": scores,
            "violations": violations,
            "events": out_events,
        }

    # ------------------------------------------------------------------ signals
    def signals(
        self,
        run: Run,
        ctx: RunContext,
        constraint_id: str,
        attributes: list[str] | None,
        key: list[Any] | None,
        *,
        filter_obj: dict[str, Any] | None = None,
        scale: str = "linear",
        bands: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        result = self._get_result(run, ctx)
        try:
            nc = result.norm.get_constraint(constraint_id)
        except wise.NormError as exc:
            raise NotFoundError(str(exc), code="constraint.not_found") from exc
        log = result.log or self._run_log(ctx)
        values, meta = raw_signal(log, nc)
        mask = result.in_scope[nc.id].reindex(values.index).fillna(False).astype(bool)
        if attributes and key is not None:
            cases_b = (
                apply_bands(result.cases, list(bands or []), reference=self._get_frame(run, ctx))
                if bands
                else result.cases
            )
            mask &= _slice_mask(cases_b, attributes, key).reindex(values.index).fillna(False).astype(bool)
        if filter_obj:
            fmask, _parts = filter_masks(log, filter_obj, censored=self._censored(ctx))
            mask &= fmask.reindex(values.index).fillna(False).astype(bool)
        out = distribution(values[mask], result.violations[nc.id], meta, scale=scale)
        out["slice"] = {"slicing": attributes, "key": key} if attributes else None
        out["casesInScope"] = int(mask.sum())
        out["windowEnd"] = jsonable(ctx.window_end)
        out["filter"] = filter_obj
        return out

    # ------------------------------------------------------------------ flow
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
        bands: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """The process map of the run (its scope), one group, or the cases of a filter; ``focus`` adds the incoming
        and outgoing paths of one activity (node id or label)."""
        mapping = ctx.mapping
        norm = _norm_from(ctx.document)
        violations = self._get_violations(run, ctx)
        frame = self._get_frame(run, ctx)
        mask = pd.Series(True, index=frame.index)
        restricted = ctx.scope is not None
        if attributes and key is not None:
            frame_b = apply_bands(frame, list(bands or [])) if bands else frame
            mask &= _slice_mask(frame_b, effective_attributes(list(attributes), list(bands or [])), key)
            restricted = True
        filter_cases: dict[str, int] | None = None
        if filter_obj:
            fmask, _parts = filter_masks(self._run_log(ctx), filter_obj, censored=self._censored(ctx))
            fmask = fmask.reindex(frame.index, fill_value=False).astype(bool)
            filter_cases = {"cases_in": int((mask & fmask).sum()), "cases_out": int((mask & ~fmask).sum())}
            mask &= fmask
            restricted = True
        case_ids: pa.Table | None = None
        if restricted:
            ids = [str(i) for i in frame.index[mask.to_numpy()]]
            if not ids:
                raise NotFoundError("no case matches the slice, scope or filter", code="slice.not_found")
            case_ids = pa.table({"case_id": pa.array(ids, type=pa.string())})
            violations = violations[violations.index.astype(str).isin(set(ids))]
        events_path = ctx.case_table_dir / "events.parquet"
        dfg = duck.directly_follows(
            self.ws,
            events_path,
            case_col=mapping.case_id,
            activity_col=mapping.activity,
            timestamp_col=mapping.timestamp,
            order_col=mapping.order,
            case_ids=case_ids,
        )
        meta = {
            "runId": run.id,
            "slicing": attributes,
            "sliceKey": key,
            "normFingerprint": norm.fingerprint(),
            "process": process,
            "scope": ctx.scope,
            "filter": filter_obj,
            "filterCases": filter_cases,
            "focus": None,
            "caseNoun": ctx.case_noun,
        }
        stages = stage_model(process, [str(n["label"]) for n in dfg["nodes"]])
        graph = build_flow_graph(
            dfg, norm, violation_shares(violations), abstraction=abstraction, meta=meta, stages=stages
        )
        if focus:
            labels = {str(n["label"]): str(n["label"]) for n in dfg["nodes"]}
            by_id = {_node_id(label): label for label in labels}
            by_id.update({n["id"]: n["label"] for n in graph["nodes"] if n["kind"] == "activity"})
            label = by_id.get(focus, focus if focus in labels else None)
            if label is None:
                raise NotFoundError(f"activity {focus!r} is not on the map", code="flow.focus_not_found")
            any_violation = (violations.fillna(0) > 0).any(axis=1)
            violated = pa.table(
                {
                    "case_id": pa.array([str(i) for i in any_violation.index], type=pa.string()),
                    "violated": pa.array(any_violation.to_numpy(dtype=bool)),
                }
            )
            paths = duck.focus_paths(
                self.ws,
                events_path,
                case_col=mapping.case_id,
                activity_col=mapping.activity,
                timestamp_col=mapping.timestamp,
                order_col=mapping.order,
                focus=label,
                case_ids=case_ids,
                violated=violated,
            )
            ids_of = {n["label"]: n["id"] for n in graph["nodes"] if n["kind"] == "activity"}
            for p in paths["incoming"]:
                p["node"] = ids_of.get(p["from"], _node_id(p["from"]))
            for p in paths["outgoing"]:
                p["node"] = ids_of.get(p["to"], _node_id(p["to"]))
            graph["paths"] = {"incoming": paths["incoming"], "outgoing": paths["outgoing"]}
            graph["meta"]["focus"] = {
                "id": ids_of.get(label, _node_id(label)),
                "label": label,
                "cases": paths["cases"],
                "events": paths["events"],
            }
        return graph

    # ------------------------------------------------------------------ flow types (R2-O10)
    def flow_types(
        self,
        case_table_dir: Path,
        mapping: ColumnMapping,
        *,
        attribute: str | None,
        process: str | None,
        abstraction: float = 0.05,
        case_noun: str | None = None,
    ) -> dict[str, Any]:
        """The detected flow types of a case table with counts, a map each (stage groups, no expectations) and a
        readiness headline per type, computed with the one window end."""
        key = (str(case_table_dir), attribute, process, abstraction)
        noun = case_noun or mapping.noun
        hit = self._flow_types.get(key)
        if hit is not None:
            return hit
        log = self._load_log(case_table_dir, mapping)
        name, column = flow_type_column(log, attribute)
        window_end = self.case_table_window_end(case_table_dir)
        end = pd.Timestamp(window_end) if window_end else resolve_window_end(log)
        censored = censored_flags(log, mapping, window_end=end)
        rep = wise.event_replication(log)
        replicated = (rep["replication_ratio"] > 2.0).reindex(log.case_ids, fill_value=False)
        counts = column.value_counts(dropna=False)
        n_cases = len(log)
        events_path = case_table_dir / "events.parquet"
        types = []
        for value, n in counts.items():
            m = (column == value).to_numpy(dtype=bool)
            ids = [str(i) for i in log.case_ids[m]]
            case_ids = pa.table({"case_id": pa.array(ids, type=pa.string())})
            dfg = duck.directly_follows(
                self.ws,
                events_path,
                case_col=mapping.case_id,
                activity_col=mapping.activity,
                timestamp_col=mapping.timestamp,
                order_col=mapping.order,
                case_ids=case_ids,
            )
            stages = stage_model(process, [str(x["label"]) for x in dfg["nodes"]])
            graph = build_flow_graph(
                dfg,
                None,
                {},
                abstraction=abstraction,
                meta={"flowType": str(value), "attribute": name, "process": process, "caseNoun": noun},
                stages=stages,
            )
            n_events = int(log.cases.loc[m, "n_events"].sum())
            censored_share = float(censored.to_numpy(dtype=bool)[m].mean()) if censored is not None else None
            replicated_share = float(replicated.to_numpy(dtype=bool)[m].mean())
            duration = (log.cases.loc[m, "last_ts"] - log.cases.loc[m, "first_ts"]).dt.total_seconds() / 86400.0
            median_days = float(duration.median()) if len(duration) else None
            headline = f"{int(n):,} {noun} ({int(n) / max(n_cases, 1):.0%}), {n_events:,} events, {len(dfg['nodes'])} activities"
            if median_days is not None and np.isfinite(median_days):
                headline += f", median {median_days:.0f} days from first to last event"
            if censored_share is not None:
                headline += f"; {censored_share:.0%} still open at the end of the data ({end.date()})"
            if replicated_share >= 0.05:
                headline += f"; {replicated_share:.0%} carry copied postings"
            types.append(
                {
                    "name": str(value),
                    "cases": int(n),
                    "share": int(n) / max(n_cases, 1),
                    "events": n_events,
                    "activities": len(dfg["nodes"]),
                    "map": graph,
                    "readiness": {
                        "censoredShare": censored_share,
                        "replicatedShare": replicated_share,
                        "medianDurationDays": median_days,
                        "windowEnd": jsonable(end),
                        "headline": headline + ".",
                    },
                    "scope": {"flow_type": str(value), "attribute": name}
                    if name == "flow_type"
                    else {"attribute": name, "value": str(value)},
                }
            )
        out = {
            "attribute": name,
            "source": "mapping" if (name == "flow_type" and mapping.flow_typing) else "attribute",
            "cases": n_cases,
            "windowEnd": jsonable(end),
            "caseNoun": noun,
            "types": types,
        }
        return self._flow_types.put(key, out)

    def compare_flow_types(self, run: Run, ctx: RunContext, *, attribute: str | None) -> dict[str, Any]:
        """Per flow type, side by side: cases, mean score and shortfall per view, the most-missed expectation and
        the top groups of the run's first slicing (baseline: the overall score), for a run without scope."""
        if ctx.scope:
            raise ValidationError(
                "this run is already scoped to one flow type; compare from the unscoped run", code="run.scoped"
            )
        result = self._get_result(run, ctx)
        log = result.log or self._run_log(ctx)
        name, column = flow_type_column(log, attribute)
        frame = self._get_frame(run, ctx)
        column = column.reindex(frame.index)
        views = list(ctx.views) or _views_in(frame)
        censored = self._censored(ctx)
        norm = result.norm
        overall = {v: float(frame[f"score__{v}"].mean()) for v in views}
        first = ctx.slicings[0] if ctx.slicings else None
        out_types = []
        for value, n in column.value_counts(dropna=False).items():
            m = (column == value).to_numpy(dtype=bool)
            sub = frame[m]
            per_view = {}
            for v in views:
                mean = float(sub[f"score__{v}"].mean())
                per_view[v] = {
                    "mean_score": mean,
                    "gap": max(overall[v] - mean, 0.0),
                    "points_below": an.points_below(mean, overall[v]),
                }
            viol = result.violations.reindex(frame.index)[m]
            rates = {c: float((viol[c][viol[c].notna()] > 0).mean()) for c in viol.columns if viol[c].notna().any()}
            top_c = max(rates, key=lambda c: rates[c]) if rates else None
            top_groups: list[dict[str, Any]] = []
            if first is not None and len(sub):
                bands = ctx.slicing_bands(first[0])
                attrs = effective_attributes(list(first[1]), bands)
                sub_b = apply_bands(sub, bands, reference=frame) if bands else sub
                try:
                    bl = self._compute_backlog(
                        sub_b,
                        attrs,
                        views[0],
                        ctx.gamma,
                        1,
                        norm=norm,
                        violations=result.violations,
                        bands=bands,
                        baseline=overall[views[0]],
                    )
                    rows, _total = bl.page(
                        sort="-stable_PI", page=1, page_size=3, hotspot_type=None, layer=None, search=None
                    )
                    top_groups = [
                        {
                            "key": r["key"],
                            "keys": r["keys"],
                            "n_cases": r["n_cases"],
                            "stable_PI": r["stable_PI"],
                            "gap": r["gap"],
                            "kind": r.get("kind"),
                            "reading": r.get("reading"),
                        }
                        for r in rows
                    ]
                except ValidationError:
                    top_groups = []
            desc = str(norm.get_constraint(top_c).description or top_c) if top_c else None
            plain = self._guidance_for(ctx, "constraint", top_c).plain_name if top_c else None
            out_types.append(
                {
                    "name": str(value),
                    "cases": int(n),
                    "share": int(n) / max(len(frame), 1),
                    "views": per_view,
                    "mostMissed": {
                        "constraint": top_c,
                        "description": desc,
                        "plain_name": plain,
                        "share": rates.get(top_c) if top_c else None,
                    },
                    "censoredShare": float(
                        censored.reindex(frame.index, fill_value=False).to_numpy(dtype=bool)[m].mean()
                    )
                    if censored is not None
                    else None,
                    "topGroups": top_groups,
                    "scope": {"flow_type": str(value), "attribute": name}
                    if name == "flow_type"
                    else {"attribute": name, "value": str(value)},
                }
            )
        return {
            "attribute": name,
            "views": views,
            "overall": {v: {"mean_score": overall[v], "cases": len(frame)} for v in views},
            "windowEnd": jsonable(ctx.window_end),
            "caseNoun": ctx.case_noun,
            "slicing": first[0] if first else None,
            "types": out_types,
        }

    # ------------------------------------------------------------------ analytics job
    def _ensure_band_columns(
        self, run: Run, ctx: RunContext, result: wise.ScoreResult, bands: list[dict[str, Any]]
    ) -> None:
        """Band columns of banded slicings on the live result's case table (the analytics group by them)."""
        if not bands:
            return
        frame = self._get_frame(run, ctx)
        banded = apply_bands(result.cases, bands, reference=frame)
        for col in effective_attributes([str(b["attribute"]) for b in bands], bands):
            if col not in result.cases.columns:
                result.cases[col] = banded[col]

    def run_analytics(self, run: Run, ctx: RunContext, progress: ProgressFn) -> dict[str, Any]:
        if not an.availability()["available"]:
            raise ValidationError(
                "wise-analytics is not installed; install it to compute stability and comparisons",
                code="analytics.unavailable",
            )
        result = self._get_result(run, ctx)
        log = result.log or self._run_log(ctx)
        for sid, _attrs in ctx.slicings:
            self._ensure_band_columns(run, ctx, result, ctx.slicing_bands(sid))
        settings = an.AnalyticsSettings(
            bootstrap_b=int(ctx.analytics.get("bootstrap_b", 200)),
            comparison_top=int(ctx.analytics.get("comparison_top", 12)),
            cluster_share=float(ctx.analytics.get("cluster_share", 0.2)),
            seed=int(ctx.analytics.get("seed", 0)),
        )
        manifest = an.run_analytics(
            self.ws,
            ctx.run_dir,
            result=result,
            log=log,
            mapping=ctx.mapping,
            norm=result.norm,
            views=list(ctx.views) or result.views,
            slicings=[(sid, effective_attributes(list(attrs), ctx.slicing_bands(sid))) for sid, attrs in ctx.slicings],
            gamma=ctx.gamma,
            min_cases=ctx.min_cases,
            settings=settings,
            case_noun=ctx.case_noun,
            closure_label=ctx.closure_label,
            progress=progress,
            labels=lambda cid: self._guidance_for(ctx, "constraint", cid).plain_name,
        )
        return manifest

    def analytics_status(self, run: Run, ctx: RunContext) -> dict[str, Any]:
        manifest = an.manifest_json(self.ws, ctx.run_dir)
        return {"package": an.availability(), "status": manifest.get("status", "not_computed"), "manifest": manifest}

    # ------------------------------------------------------------------ previews (filters, slice designer)
    def filter_preview(self, run: Run, ctx: RunContext, filter_obj: dict[str, Any] | None) -> dict[str, Any]:
        result = self._get_result(run, ctx)
        log = result.log or self._run_log(ctx)
        return filter_preview(log, filter_obj, censored=self._censored(ctx), in_scope=result.in_scope)

    def slicing_preview(
        self, run: Run, ctx: RunContext, attributes: list[str], bands: list[dict[str, Any]], min_cases: int
    ) -> dict[str, Any]:
        """Group counts and sizes of a slicing before it is run (the slice designer)."""
        frame = self._get_frame(run, ctx)
        missing = [a for a in attributes if a not in frame.columns]
        if missing:
            raise ValidationError(f"unknown slice attributes {missing}", code="backlog.attribute")
        frame_b = apply_bands(frame, bands) if bands else frame
        eff = effective_attributes(attributes, bands)
        keyed = _label_missing_keys(frame_b, eff)
        sizes = keyed.groupby(eff, dropna=False, observed=True).size().sort_values(ascending=False)
        n = len(sizes)
        arr = sizes.to_numpy(dtype=float)
        largest = [
            {"key": slice_key(list(k) if isinstance(k, tuple) else [k]), "n_cases": int(v)}
            for k, v in sizes.head(10).items()
        ]
        return {
            "attributes": attributes,
            "effectiveAttributes": eff,
            "bands": [band_summary(frame, b) for b in bands],
            "groups": n,
            "cases": len(frame),
            "belowMinCases": int((arr < min_cases).sum()),
            "minCases": int(min_cases),
            "sizes": {
                "min": int(arr.min()) if n else 0,
                "median": float(np.median(arr)) if n else 0.0,
                "p90": float(np.quantile(arr, 0.9)) if n else 0.0,
                "max": int(arr.max()) if n else 0,
            },
            "largest": largest,
        }


# ---------------------------------------------------------------------------- helpers
def _text(value: Any) -> str | None:
    """A string, or ``None`` for None / NaN."""
    v = jsonable(value)
    return None if v is None else str(v)


def _plain_reading(rec: dict[str, Any], attrs: list[str], noun: str) -> str:
    """The one-sentence card reading of a group (at most three numbers: cases, how far below, confidence)."""
    label = " × ".join(key_label(rec.get(a)) for a in attrs)
    n = int(rec.get("n_cases") or 0)
    pb = rec.get("points_below") or ""
    stability = rec.get("stability") or "unknown"
    confidence = {
        "stable": "high confidence",
        "fragile": "medium confidence",
        "insufficient_support": "not enough cases to be sure",
        "unknown": "confidence not computed",
    }.get(str(stability), "confidence not computed")
    head = f"{label}: {n:,} {noun}"
    if pb:
        head += f", {pb}"
    parts = [head + f" ({confidence})"]
    if rec.get("kind_reading"):
        parts.append(str(rec["kind_reading"]))
    if rec.get("plain_layer") and str(rec["plain_layer"]) not in parts[-1]:
        parts.append(f"most often missed: {rec['plain_layer']}")
    text = "; ".join(parts) + "."
    if rec.get("comparison"):
        text += f" {rec['comparison']}"
    return text


def _contrast_table(ct: pd.DataFrame, ref: Any) -> Table:
    """The contract's contrast table: plain description with threshold, shares missed here and elsewhere, the risk
    difference with its interval, real-unit medians, the shift, the share of the shortfall."""
    rows = []
    frame = ct.reset_index() if ct.index.name else ct
    for r in frame.to_dict("records"):
        cid = str(r.get("constraint"))
        g = ref(cid)
        rows.append(
            [
                cid,
                g.plain_name or r.get("description") or cid,
                r.get("description"),
                r.get("layer"),
                r.get("type"),
                jsonable(r.get("rate_slice")),
                jsonable(r.get("rate_rest")),
                jsonable(r.get("risk_difference")),
                jsonable(r.get("rd_lo")),
                jsonable(r.get("rd_hi")),
                jsonable(r.get("median_slice")),
                jsonable(r.get("median_rest")),
                jsonable(r.get("hl_shift")),
                r.get("unit"),
                r.get("pattern"),
                jsonable(r.get("share_of_gap")),
                jsonable(r.get("delta")),
                jsonable(r.get("delta_lo")),
                jsonable(r.get("delta_hi")),
                jsonable(r.get("n_evaluated_slice")),
                jsonable(r.get("n_evaluated_rest")),
            ]
        )
    return {
        "columns": [
            "constraint",
            "plain",
            "description",
            "layer",
            "type",
            "share_missed_group",
            "share_missed_elsewhere",
            "risk_difference",
            "rd_lo",
            "rd_hi",
            "median_group",
            "median_elsewhere",
            "shift",
            "unit",
            "pattern",
            "share_of_shortfall",
            "delta",
            "delta_lo",
            "delta_hi",
            "n_evaluated_group",
            "n_evaluated_elsewhere",
        ],
        "rows": rows,
    }


def _headroom_table(ht: pd.DataFrame, ref: Any) -> Table:
    rows = []
    frame = ht.reset_index() if ht.index.name else ht
    for r in frame.to_dict("records"):
        cid = str(r.get("constraint"))
        g = ref(cid)
        mean_pen = r.get("mean_penalty")
        share = r.get("share_of_PI")
        rows.append(
            [
                cid,
                g.plain_name or r.get("description") or cid,
                r.get("description"),
                r.get("layer"),
                jsonable(float(mean_pen) * 100.0) if mean_pen is not None and np.isfinite(float(mean_pen)) else None,
                jsonable(float(share) * 100.0) if share is not None and np.isfinite(float(share)) else None,
                jsonable(r.get("stable_PI_after")),
                jsonable(r.get("PI_reduction")),
                jsonable(r.get("share_violated")),
                jsonable(r.get("n_evaluated")),
            ]
        )
    return {
        "columns": [
            "constraint",
            "plain",
            "description",
            "layer",
            "gain_points",
            "gain_percent",
            "stable_PI_after",
            "PI_reduction",
            "share_violated",
            "n_evaluated",
        ],
        "rows": rows,
    }


def _subgroups_table(st: pd.DataFrame) -> Table:
    frame = st.reset_index()
    rows = []
    for r in frame.to_dict("records"):
        rows.append(
            [
                str(r.get("attribute")),
                key_label(r.get("value")),
                jsonable(r.get("n_cases")),
                jsonable(r.get("share")),
                jsonable(r.get("penalty_mass")),
                jsonable(r.get("mean_penalty")),
                jsonable(r.get("rank")),
                jsonable(r.get("censored_share")),
                str(r.get("caveat") or ""),
            ]
        )
    return {
        "columns": [
            "attribute",
            "value",
            "cases",
            "share",
            "penalty_mass",
            "mean_penalty",
            "rank",
            "censored_share",
            "caveat",
        ],
        "rows": rows,
    }


def _layer_names(norm: wise.Norm | None) -> dict[str, str]:
    if norm is None:
        return {}
    return {str(layer.id): str(layer.name or layer.id) for layer in norm.layers}


def _top_constraints(
    vf: pd.DataFrame,
    attrs: list[str],
    keys: list[list[Any]],
    dominant_layers: list[Any],
    norm: wise.Norm | None,
    violations: pd.DataFrame | None,
) -> list[tuple[str | None, str | None, float | None]]:
    """Per group: the expectation of its most-missed area with the highest share of cases missing it.

    The share is computed from the library's violation table (a violation > 0 counts as missed, only
    evaluated cases count). Without a norm or violations every entry is empty.
    """
    empty: tuple[str | None, str | None, float | None] = (None, None, None)
    if norm is None or violations is None or not len(vf) or not keys:
        return [empty] * len(keys)
    ids = [nc.id for nc in norm.constraints if nc.id in violations.columns]
    if not ids:
        return [empty] * len(keys)
    v = violations.reindex(vf.index)[ids]
    groups = [vf[a] if a in vf.columns else pd.Series(vf.index, index=vf.index, name=a) for a in attrs]
    hit = (v > 0).groupby(groups, observed=True).sum()
    seen = v.notna().groupby(groups, observed=True).sum()
    share = hit / seen.where(seen > 0)
    by_layer: dict[str, list[str]] = {}
    descriptions: dict[str, str] = {}
    for nc in norm.constraints:
        by_layer.setdefault(str(nc.layer), []).append(nc.id)
        descriptions[nc.id] = str(nc.description or nc.id)
    out: list[tuple[str | None, str | None, float | None]] = []
    for key, layer in zip(keys, dominant_layers):
        idx: Any = tuple(key) if len(key) > 1 else key[0]
        try:
            row = share.loc[idx]
        except KeyError:
            out.append(empty)
            continue
        if isinstance(row, pd.DataFrame):
            row = row.iloc[0]
        candidates = by_layer.get(str(layer), []) if layer else ids
        cand = row[[c for c in candidates if c in row.index]].dropna()
        if cand.empty:
            out.append(empty)
            continue
        best = str(cand.idxmax())
        out.append((best, descriptions.get(best, best), float(cand[best])))
    return out


def _label_missing_keys(frame: pd.DataFrame, attrs: list[str], label: str = "(missing)") -> pd.DataFrame:
    """Null slice keys become a labelled group so that library indexing by key works (same membership)."""
    out = frame
    for attr in attrs:
        if attr in out.columns and out[attr].isna().any():
            if out is frame:
                out = out.copy()
            out[attr] = out[attr].astype(object).where(out[attr].notna(), label)
    return out


def _views_in(frame: pd.DataFrame) -> list[str]:
    return [c[len("score__") :] for c in frame.columns if str(c).startswith("score__")]


def _view_frame(frame: pd.DataFrame, view: str) -> pd.DataFrame:
    """One view's ``score`` and ``contrib__<layer>`` columns next to the case attributes."""
    score_col = f"score__{view}"
    if score_col not in frame.columns:
        raise ValidationError(
            f"view {view!r} is not part of this run; available: {_views_in(frame)}", code="backlog.view"
        )
    prefix = f"contrib__{view}__"
    keep = [c for c in frame.columns if not str(c).startswith(("score__", "contrib__"))]
    out = frame[keep].copy()
    out["score"] = frame[score_col]
    for c in frame.columns:
        if str(c).startswith(prefix):
            out[f"contrib__{str(c)[len(prefix) :]}"] = frame[c]
    return out


def _slice_mask(cases: pd.DataFrame, attributes: list[str], key: list[Any]) -> pd.Series:
    mask = pd.Series(True, index=cases.index)
    for attr, value in zip(attributes, key):
        if attr == cases.index.name:
            col = pd.Series(cases.index, index=cases.index)
        elif attr in cases.columns:
            col = cases[attr]
        else:
            raise ValidationError(f"unknown slice attribute {attr!r}", code="slice.attribute")
        if value is None or value == "(missing)":
            mask &= col.isna()
        else:
            mask &= col.astype(str) == str(value)
    return mask


def _locate(table: pd.DataFrame, attributes: list[str], key: list[Any]) -> int | None:
    if table.empty:
        return None
    idx = table.index.to_frame(index=False)
    idx.columns = list(attributes) if len(idx.columns) == len(attributes) else idx.columns
    mask = np.ones(len(idx), dtype=bool)
    for attr, value in zip(attributes, key):
        col = idx[attr] if attr in idx.columns else idx.iloc[:, 0]
        if value is None or value == "(missing)":
            mask &= col.isna().to_numpy()
        else:
            mask &= (col.astype(str) == str(value)).to_numpy()
    hits = np.flatnonzero(mask)
    return int(hits[0]) if len(hits) else None


def _default_drilldown(document: dict[str, Any], columns: Any, attributes: list[str]) -> str | None:
    meta = document.get("metadata") or {}
    for cand in list(meta.get("drilldown_keys") or []):
        if cand in columns and cand not in attributes:
            return str(cand)
    for cand in columns:
        c = str(cand)
        if (
            c in attributes
            or c in ("n_events", "first_ts", "last_ts", "exposure")
            or c.startswith(("score", "contrib__"))
        ):
            continue
        if pd.api.types.is_numeric_dtype(
            pd.Series(dtype=object)
        ):  # pragma: no cover - placeholder for future typed checks
            continue
        return c
    return None


def backlog_frame_for_concentration(backlog: BacklogResult) -> pd.DataFrame:
    df = backlog.table.to_pandas()
    return df[["stable_PI", "n_cases"]] if "stable_PI" in df.columns else pd.DataFrame({"stable_PI": [], "n_cases": []})
