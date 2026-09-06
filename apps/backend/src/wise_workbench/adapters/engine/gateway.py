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
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa
import wise

from wise_workbench import __version__ as workbench_version
from wise_workbench.adapters.knowledge import stage_model
from wise_workbench.adapters.storage import Workspace, duck
from wise_workbench.adapters.storage.parquet import read_frame, read_table, write_frame
from wise_workbench.application.ports import ProgressFn, RunContext, Table
from wise_workbench.domain import ColumnMapping, NotFoundError, Run, ValidationError
from wise_workbench.domain.readings import backlog_reading, hotspot_of, kind_of, kind_reading, slice_reading

from . import compat
from .cache import LRUCache
from .flow import build_flow_graph, violation_shares
from .logs import (
    activity_inventory,
    apply_flow_typing,
    apply_mapping_recipes,
    build_log,
    censored_flags,
    flow_type_counts,
    readiness_report,
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
    ) -> tuple[list[dict[str, Any]], int]:
        if kind and not hotspot_type:
            hotspot_type = hotspot_of(kind)
        filters = {"hotspot_type": hotspot_type, "dominant_layer": layer}
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
        apply_mapping_recipes(log, mapping)
        progress(0.45, "data-readiness report")
        readiness = readiness_report(log, mapping)
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
        log = self._load_log(case_table_dir, mapping)
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
        censored = censored_flags(log, mapping)
        n_steps = max(len(run.params.slicings) * len(views), 1)
        step = 0
        summary_extra: dict[str, Any] = {"concentration": {}, "agreement": {}}
        for s in run.params.slicings:
            attrs = list(s.attributes)
            for view in views:
                step += 1
                progress(0.35 + 0.5 * step / n_steps, f"backlog {s.id} × {view}")
                backlog = self._compute_backlog(
                    frame, attrs, view, gamma, min_cases, norm=norm, violations=result.violations
                )
                self._backlogs.put((run.id, tuple(attrs), view, gamma, min_cases), backlog)
                persist(_artefact_name("backlogs", s.id, view), backlog.table.to_pandas(), index=False)
                drivers = wise.layer_drivers(_view_frame(frame, view), attrs)
                persist(_artefact_name("drivers", s.id, view), drivers)
                validation = wise.validation_table(
                    result, view, attrs, censored=censored, replication=replication, gamma=gamma
                )
                self._validation.put((run.id, tuple(attrs), view, gamma), validation)
                persist(_artefact_name("diagnostics/validation", s.id, view), validation)
                conc = wise.concentration(backlog_frame_for_concentration(backlog))
                summary_extra["concentration"].setdefault(s.id, {})[view] = table_from_frame(conc)
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
    def _get_result(self, run: Run, ctx: RunContext) -> wise.ScoreResult:
        hit = self._results.get(run.id)
        if hit is not None:
            return hit
        with self._lock:
            hit = self._results.get(run.id)
            if hit is not None:
                return hit
            log = self._load_log(ctx.case_table_dir, ctx.mapping)
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
    ) -> BacklogResult:
        vf = _label_missing_keys(_view_frame(frame, view), attrs)
        try:
            bl = wise.prioritize(vf, attrs, gamma=gamma, min_cases=1, z=Z_LOWER)
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
            table=table, attributes=attrs, view=view, gamma=gamma, min_cases=min_cases, global_mean=global_mean
        )

    def backlog(
        self, run: Run, ctx: RunContext, attributes: list[str], view: str | None, gamma: float | None, min_cases: int
    ) -> BacklogResult:
        view = view or (ctx.views[0] if ctx.views else self._first_view(ctx))
        gamma = ctx.gamma if gamma is None else float(gamma)
        key = (run.id, tuple(attributes), view, gamma, int(min_cases))
        hit = self._backlogs.get(key)
        if hit is not None:
            return hit
        sid = ctx.slicing_id(attributes)
        if sid is not None and gamma == ctx.gamma and int(min_cases) == ctx.min_cases:
            path = ctx.run_dir / _artefact_name("backlogs", sid, view)
            if path.exists():
                table = read_table(path)
                # artefacts written before the plain-language fields existed are recomputed from the frame
                if "kind" in table.column_names:
                    global_mean = None
                    if "global_mean" in table.column_names and table.num_rows:
                        global_mean = float(table.column("global_mean")[0].as_py())
                    return self._backlogs.put(
                        key, BacklogResult(table, list(attributes), view, gamma, int(min_cases), global_mean)
                    )
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
        return self._backlogs.put(
            key,
            self._compute_backlog(
                frame, list(attributes), view, gamma, int(min_cases), norm=norm, violations=violations
            ),
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
    ) -> dict[str, Any]:
        view = view or (ctx.views[0] if ctx.views else self._first_view(ctx))
        backlog = self.backlog(run, ctx, attributes, view, None, 1)
        row = backlog.find(key)
        if row is None:
            raise NotFoundError(f"slice {key} not found in slicing {attributes}", code="slice.not_found")
        result = self._get_result(run, ctx)
        mask = _slice_mask(result.cases, attributes, key)
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
        validation = self._validation_table(run, ctx, result, attributes, view)
        vpos = _locate(validation, attributes, key)
        validation_row = (
            {k: jsonable(v) for k, v in validation.iloc[vpos].to_dict().items()} if vpos is not None else {}
        )
        worst = result.worst_cases(view, n=20, where=mask)
        viol = result.violations.loc[worst.index]
        worst_cases = []
        for (cid, score), (_, v) in zip(worst["score"].items(), viol.iterrows()):
            worst_cases.append(
                {"caseId": str(cid), "score": jsonable(score), "violated": [str(c) for c in v.index[v.fillna(0) > 0]]}
            )
        label = " × ".join(key_label(v) for v in key)
        reading = slice_reading(row, drivers_records, view, backlog.gamma, label)
        headroom: Table = {
            "columns": ["layer", "headroom", "note"],
            "rows": [[layer, None, "headroom is computed by wise-analytics (increment 1)"] for layer in layer_ids],
        }
        return {
            "row": row,
            "reading": reading,
            "drivers": table_from_frame(drivers_df),
            "layers": layers,
            "penaltyMass": penalty,
            "penaltyMassBy": drill,
            "validation": validation_row,
            "worstCases": worst_cases,
            "headroom": headroom,
            "params": {"view": view, "gamma": backlog.gamma, "slicing": attributes, "key": key},
        }

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
        self, run: Run, ctx: RunContext, constraint_id: str, attributes: list[str] | None, key: list[Any] | None
    ) -> dict[str, Any]:
        result = self._get_result(run, ctx)
        try:
            nc = result.norm.get_constraint(constraint_id)
        except wise.NormError as exc:
            raise NotFoundError(str(exc), code="constraint.not_found") from exc
        log = result.log or self._load_log(ctx.case_table_dir, ctx.mapping)
        values, meta = raw_signal(log, nc)
        mask = result.in_scope[nc.id].reindex(values.index).fillna(False).astype(bool)
        if attributes and key is not None:
            mask &= _slice_mask(result.cases, attributes, key).reindex(values.index).fillna(False).astype(bool)
        out = distribution(values[mask], result.violations[nc.id], meta)
        out["slice"] = {"slicing": attributes, "key": key} if attributes else None
        out["casesInScope"] = int(mask.sum())
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
    ) -> dict[str, Any]:
        mapping = ctx.mapping
        norm = _norm_from(ctx.document)
        case_ids: pa.Table | None = None
        violations: pd.DataFrame
        if attributes and key is not None:
            frame = self._get_frame(run, ctx)
            mask = _slice_mask(frame, attributes, key)
            ids = [str(i) for i in frame.index[mask.to_numpy()]]
            if not ids:
                raise NotFoundError(f"slice {key} has no cases", code="slice.not_found")
            case_ids = pa.table({"case_id": pa.array(ids, type=pa.string())})
            violations = read_frame(ctx.run_dir / "violations.parquet", index=mapping.case_id)
            violations = violations[violations.index.astype(str).isin(set(ids))]
        else:
            violations = read_frame(ctx.run_dir / "violations.parquet", index=mapping.case_id)
        dfg = duck.directly_follows(
            self.ws,
            ctx.case_table_dir / "events.parquet",
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
        }
        stages = stage_model(process, [str(n["label"]) for n in dfg["nodes"]])
        return build_flow_graph(
            dfg, norm, violation_shares(violations), abstraction=abstraction, meta=meta, stages=stages
        )


# ---------------------------------------------------------------------------- helpers
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
