"""The analytics bridge: ``wise_analytics`` behind an adapter that tolerates a missing package.

Everything the backend takes from the analytics package passes through here:
the readiness gate (one window end, R1-02), the bootstrap stability badges,
the kind of problem, the comparison sentences, the caveats per group, and
the contrast, headroom and sub-group tables of one group. Results are
cached as Parquet under ``runs/<id>/analytics/<name>/<params_hash>.parquet``
with the provenance record next to them (``<params_hash>.json``); the
analytics manifest ``runs/<id>/analytics/manifest.json`` lists what exists.

When the package is not installed every function returns ``None`` (or an
empty table) and :func:`availability` says so, so that the API serves the
library's numbers with ``stability: "unknown"`` and no comparison sentence.
"""

from __future__ import annotations

import hashlib
import json
import time
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import wise

from wise_workbench.adapters.storage import Workspace, dumps_json
from wise_workbench.adapters.storage.parquet import read_frame, write_frame
from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import ColumnMapping

from .tables import jsonable

try:  # the package is optional at import time; ``availability`` reports it
    import wise_analytics as wa
except ImportError:  # pragma: no cover - exercised on machines without the package
    wa = None  # type: ignore[assignment]

ANALYTICS_DIR = "analytics"
MANIFEST = "manifest.json"
CAVEAT_KINDS = ("censoring", "replication", "duplicates", "sentinel_dates", "window_edge")
CARD_CAVEAT_MIN_SHARE = 0.01  # caveats below 1 % of a group's cases stay off the card


def _memoise_log_fingerprint() -> None:
    """Every analytic hashes the whole event log for its provenance record (1.8 s on 1.6 M events); the value is a
    pure function of the log, so it is computed once per live log object and reused (same record ids)."""
    if wa is None:
        return
    from wise_analytics import provenance

    original = getattr(provenance, "_log_fingerprint_uncached", None) or provenance.log_fingerprint
    cache: dict[int, tuple[Any, str]] = {}

    def memoised(log: wise.EventLog) -> str:
        key = id(log)
        hit = cache.get(key)
        if hit is not None and hit[0] is log:
            return hit[1]
        value = original(log)
        if len(cache) >= 8:
            cache.pop(next(iter(cache)))
        cache[key] = (log, value)
        return value

    provenance._log_fingerprint_uncached = original  # type: ignore[attr-defined]
    provenance.log_fingerprint = memoised  # type: ignore[assignment]


_memoise_log_fingerprint()


def availability() -> dict[str, Any]:
    """Whether the analytics package is importable, with its version."""
    if wa is None:
        return {"available": False, "version": None, "reason": "wise-analytics is not installed"}
    return {"available": True, "version": str(getattr(wa, "__version__", "?")), "reason": None}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def params_hash(name: str, params: dict[str, Any]) -> str:
    payload = json.dumps({"name": name, **jsonable(params)}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


# ---------------------------------------------------------------------------- gate helpers (one window end)
def gate_window_end(log: wise.EventLog) -> pd.Timestamp | None:
    """The window end the gate resolves for a log (the robust window unless its end is a far-out date)."""
    if wa is None:
        return None
    try:
        from wise_analytics import quality

        th = dict(quality.DEFAULT_THRESHOLDS)
        sent = quality._sentinel_dates(log, th)
        end, _source = quality._resolve_window_end(log, sent, None, 0.001, th, [])
        return pd.Timestamp(end)
    except Exception:
        return None


def gate_window_bounds(log: wise.EventLog) -> tuple[pd.Timestamp, pd.Timestamp] | None:
    """Both ends of the observation window by the gate's rule: the library's robust window, each end replaced by
    the bulk of the timestamps (3·MAD rule) when it is a far-out placeholder date."""
    if wa is None:
        return None
    try:
        from wise_analytics import quality

        th = dict(quality.DEFAULT_THRESHOLDS)
        sent = quality._sentinel_dates(log, th)
        end, _source = quality._resolve_window_end(log, sent, None, 0.001, th, [])
        start = pd.Timestamp(log.observation_window()[0])
        bulk_start = sent.get("bulk_start")
        gap = pd.Timedelta(days=float(th["sentinel_gap_days"]))
        if bulk_start is not None and pd.notna(start) and start < pd.Timestamp(bulk_start) - gap:
            start = pd.Timestamp(bulk_start)
        return start, pd.Timestamp(end)
    except Exception:
        return None


def gate_report(
    log: wise.EventLog,
    mapping: ColumnMapping,
    *,
    norm: wise.Norm | None = None,
    result: wise.ScoreResult | None = None,
    by: list[str] | None = None,
    view: str | None = None,
    gamma: float = 0.0,
    items: str = "cases",
    closure_label: str = "closure",
    k: int = 10,
) -> Any | None:
    """The readiness gate on a log (and, when given, a result and slicing); ``None`` without the package."""
    if wa is None:
        return None
    document = _document_column(log, mapping)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return wa.readiness(
            log,
            norm,
            result=result,
            by=by,
            view=view,
            gamma=gamma,
            closure=list(mapping.closure_activities) or None,
            window=mapping.censoring_window,
            document_col=document,
            k=k,
            items=items,
            closure_label=closure_label,
        )


def _document_column(log: wise.EventLog, mapping: ColumnMapping) -> str | None:
    """The attribute naming the governance unit (purchasing document): the first attribute that says so."""
    for attr in mapping.case_attributes:
        if "document" in attr.lower() and attr in log.events.columns:
            return attr
    return None


# ---------------------------------------------------------------------------- persistence
@dataclass
class Cached:
    name: str
    params_hash: str
    table: pd.DataFrame
    record: dict[str, Any]
    summary: dict[str, Any]

    @property
    def record_id(self) -> str | None:
        rid = self.record.get("record_id")
        return str(rid) if rid else None


class AnalyticsStore:
    """Parquet tables plus provenance under ``runs/<id>/analytics``."""

    def __init__(self, ws: Workspace, run_dir: Path):
        self.ws = ws
        self.root = run_dir / ANALYTICS_DIR

    def path(self, name: str, phash: str) -> Path:
        return self.root / name / f"{phash}.parquet"

    def exists(self, name: str, phash: str) -> bool:
        return self.path(name, phash).exists()

    def load(self, name: str, phash: str) -> Cached | None:
        path = self.path(name, phash)
        if not path.exists():
            return None
        meta_path = path.with_suffix(".json")
        meta = self.ws.read_json(meta_path) if meta_path.exists() else {}
        return Cached(
            name=name,
            params_hash=phash,
            table=read_frame(path),
            record=dict(meta.get("record") or {}),
            summary=dict(meta.get("summary") or {}),
        )

    def save(
        self,
        name: str,
        phash: str,
        table: pd.DataFrame,
        *,
        record: Any = None,
        summary: dict[str, Any] | None = None,
        readings: tuple[str, ...] | list[str] = (),
        params: dict[str, Any] | None = None,
    ) -> Cached:
        path = self.path(name, phash)
        plain = table.copy()
        plain.attrs = {}  # DataFrame.attrs (timestamps) are not Parquet metadata; the summary carries them
        write_frame(self.ws, path, plain, index=True)
        rec = record.to_dict() if record is not None and hasattr(record, "to_dict") else dict(record or {})
        meta = {
            "name": name,
            "paramsHash": phash,
            "params": jsonable(params or {}),
            "record": rec,
            "summary": jsonable(dict(summary or {})),
            "readings": list(readings),
            "writtenAt": _now(),
        }
        self.ws.write_json(path.with_suffix(".json"), meta)
        return Cached(name=name, params_hash=phash, table=table, record=rec, summary=dict(meta["summary"]))

    def manifest(self) -> dict[str, Any]:
        path = self.root / MANIFEST
        return dict(self.ws.read_json(path)) if path.exists() else {}

    def manifest_stamp(self) -> float | None:
        path = self.root / MANIFEST
        return path.stat().st_mtime if path.exists() else None

    def write_manifest(self, data: dict[str, Any]) -> None:
        self.ws.write_json(self.root / MANIFEST, data)


# ---------------------------------------------------------------------------- the analytics job
@dataclass(frozen=True)
class AnalyticsSettings:
    bootstrap_b: int = 200
    comparison_top: int = 12
    cluster_share: float = 0.20
    seed: int = 0


def _slice_key_columns(table: pd.DataFrame, attrs: list[str]) -> pd.DataFrame:
    """A table indexed by slice keys → the same with the keys as leading columns."""
    out = table.reset_index() if any(n is not None for n in table.index.names) else table.copy()
    if len(attrs) == 1 and "index" in out.columns and attrs[0] not in out.columns:
        out = out.rename(columns={"index": attrs[0]})
    return out


def run_analytics(
    ws: Workspace,
    run_dir: Path,
    *,
    result: wise.ScoreResult,
    log: wise.EventLog,
    mapping: ColumnMapping,
    norm: wise.Norm,
    views: list[str],
    slicings: list[tuple[str, list[str]]],
    gamma: float,
    min_cases: int,
    settings: AnalyticsSettings,
    case_noun: str,
    closure_label: str,
    progress: ProgressFn,
    labels: Callable[[str], str | None] | None = None,
) -> dict[str, Any]:
    """Compute and cache the run's analytics; returns the analytics manifest.

    Per slicing × view: ``bootstrap_backlog`` (a cluster bootstrap by document when the replicated share of cases
    exceeds ``cluster_share``), the comparison sentence of the top groups; per slicing: ``problem_kinds`` (one kind
    per group across views, primary = the run's first view) and the caveat shares; once: the readiness gate with
    the run's first slicing, whose window end every caveat sentence carries.
    """
    if wa is None:
        raise RuntimeError("wise-analytics is not installed")
    store = AnalyticsStore(ws, run_dir)
    started = _now()
    t0 = time.perf_counter()
    manifest: dict[str, Any] = store.manifest()
    records: dict[str, Any] = dict(manifest.get("records") or {})
    first_by = slicings[0][1] if slicings else None
    primary = views[0]
    progress(0.05, "readiness gate")
    gate = gate_report(
        log,
        mapping,
        norm=norm,
        result=result,
        by=first_by,
        view=primary,
        gamma=gamma,
        items=case_noun,
        closure_label=closure_label,
    )
    assert gate is not None
    window_end = gate.window_end
    gate_params = {"by": first_by, "view": primary, "gamma": gamma, "closure": list(mapping.closure_activities)}
    gate_hash = params_hash("readiness", gate_params)
    gate_table = gate.table.drop(columns=["evidence"]).copy()
    gate_table["evidence"] = gate.table["evidence"].astype(str)
    store.save(
        "readiness",
        gate_hash,
        gate_table,
        record=gate.record,
        summary={k: v for k, v in gate.summary.items() if k != "thresholds"}
        | {"thresholds": dict(gate.summary["thresholds"])},
        readings=gate.readings,
        params=gate_params,
    )
    if gate.slices is not None:
        store.save("validation", gate_hash, gate.slices, record=gate.record, params=gate_params)
    records["readiness"] = {"paramsHash": gate_hash, "recordId": gate.record.record_id, "status": gate.status}
    replicated_share = float(gate.table.loc["replication", "value"]) if "replication" in gate.table.index else 0.0
    if not np.isfinite(replicated_share):
        replicated_share = 0.0
    cluster = _document_column(log, mapping) if replicated_share > settings.cluster_share else None
    if cluster is not None and cluster not in result.cases.columns:
        cluster = None
    signals: pd.DataFrame | None = None
    n_steps = max(len(slicings) * (len(views) + 2), 1)
    step = 0
    # band columns of banded slicings live on the result's case table; the gate's copy gets them too
    for _sid, attrs in slicings:
        for a in attrs:
            if a in result.cases.columns and gate.cases is not None and a not in gate.cases.columns:
                gate.cases[a] = result.cases[a].reindex(gate.cases.index)
    for sid, attrs in slicings:
        # caveat shares per group, from the gate's per-case flags
        step += 1
        progress(0.1 + 0.85 * step / n_steps, f"caveats {sid}")
        try:
            cav = wa.caveats_by(gate, attrs)
            cav_hash = params_hash("caveats", {"by": attrs, "windowEnd": str(window_end)})
            store.save("caveats", cav_hash, cav, record=gate.record, params={"by": attrs, "windowEnd": str(window_end)})
            records[f"caveats:{sid}"] = {"paramsHash": cav_hash, "recordId": gate.record.record_id}
        except Exception as exc:  # a slicing whose attribute is not on the report's cases
            records[f"caveats:{sid}"] = {"error": str(exc)}
        # one kind of problem per group across views
        step += 1
        progress(0.1 + 0.85 * step / n_steps, f"kinds {sid}")
        try:
            kinds = wa.problem_kinds(result, attrs, gamma=gamma, views=views, primary=primary)
            kinds_params = {"by": attrs, "gamma": gamma, "views": views, "primary": primary}
            kinds_hash = params_hash("problem_kinds", kinds_params)
            store.save("problem_kinds", kinds_hash, kinds, params=kinds_params, summary={"rule": wa.KIND_RULE})
            records[f"problem_kinds:{sid}"] = {"paramsHash": kinds_hash, "recordId": None}
        except Exception as exc:
            records[f"problem_kinds:{sid}"] = {"error": str(exc)}
        for view in views:
            step += 1
            progress(0.1 + 0.85 * step / n_steps, f"stability {sid} × {view}")
            boot_params = {
                "by": attrs,
                "view": view,
                "gamma": gamma,
                "B": settings.bootstrap_b,
                "seed": settings.seed,
                "cluster": cluster,
                "min_cases": 1,
            }
            boot_hash = params_hash("bootstrap_backlog", boot_params)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    u = wa.bootstrap_backlog(
                        result,
                        attrs,
                        view,
                        gamma=gamma,
                        B=settings.bootstrap_b,
                        seed=settings.seed,
                        cluster=cluster,
                        min_cases=1,
                    )
                store.save(
                    "bootstrap_backlog",
                    boot_hash,
                    u.table,
                    record=u.record,
                    summary=dict(u.summary),
                    readings=u.readings,
                    params=boot_params,
                )
                records[f"bootstrap_backlog:{sid}:{view}"] = {
                    "paramsHash": boot_hash,
                    "recordId": u.record.record_id,
                    "cluster": cluster,
                    "badges": dict(u.summary.get("badges") or {}),
                }
                ranked = u.table[u.table["stable_PI"] > 0].head(settings.comparison_top)
            except Exception as exc:
                records[f"bootstrap_backlog:{sid}:{view}"] = {"error": str(exc)}
                ranked = pd.DataFrame()
            # comparison sentences for the top groups (contrast without intervals; signals computed once)
            if signals is None:
                try:
                    signals = wa.raw_signals(log, norm)
                except Exception:
                    signals = pd.DataFrame(index=result.cases.index)
            comp_params = {"by": attrs, "view": view, "top": settings.comparison_top, "items": case_noun}
            comp_hash = params_hash("comparisons", comp_params)
            rows = []
            for key in ranked.index:
                values = list(key) if isinstance(key, tuple) else [key]
                where = {a: v for a, v in zip(attrs, values)}
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        c = wa.contrast_slice(result, view, where, B=0, signals=signals, max_pairs=250_000)
                        table = wa.comparisons(c, top=1, items=case_noun, labels=_labels_for(c, labels), norm=norm)
                    sentence = wa.comparison_sentence(
                        c, top=1, items=case_noun, labels=_labels_for(c, labels), norm=norm
                    )
                    top = table.index[0] if len(table) else None
                    rows.append(
                        {
                            **where,
                            "comparison": sentence,
                            "comparison_kind": str(table["kind"].iloc[0]) if len(table) else None,
                            "comparison_constraint": top,
                            "share_of_gap": float(table["share_of_gap"].iloc[0]) if len(table) else np.nan,
                            "contrast_record_id": c.record.record_id,
                        }
                    )
                except Exception as exc:
                    rows.append(
                        {
                            **where,
                            "comparison": None,
                            "comparison_kind": None,
                            "comparison_constraint": None,
                            "share_of_gap": np.nan,
                            "contrast_record_id": None,
                            "error": str(exc),
                        }
                    )
            comp = (
                pd.DataFrame(
                    rows,
                    columns=[
                        *attrs,
                        "comparison",
                        "comparison_kind",
                        "comparison_constraint",
                        "share_of_gap",
                        "contrast_record_id",
                    ],
                )
                if rows
                else pd.DataFrame(
                    columns=[
                        *attrs,
                        "comparison",
                        "comparison_kind",
                        "comparison_constraint",
                        "share_of_gap",
                        "contrast_record_id",
                    ]
                )
            )
            store.save("comparisons", comp_hash, comp, params=comp_params)
            records[f"comparisons:{sid}:{view}"] = {"paramsHash": comp_hash, "recordId": None, "groups": len(comp)}
    manifest = {
        "status": "done",
        "startedAt": started,
        "finishedAt": _now(),
        "runtimeS": round(time.perf_counter() - t0, 3),
        "package": availability(),
        "windowEnd": jsonable(window_end),
        "windowEndSource": gate.summary.get("window_end_source"),
        "readinessStatus": gate.status,
        "cluster": cluster,
        "replicatedShare": replicated_share,
        "settings": {
            "B": settings.bootstrap_b,
            "comparisonTop": settings.comparison_top,
            "clusterShare": settings.cluster_share,
            "seed": settings.seed,
        },
        "records": records,
    }
    store.write_manifest(manifest)
    return manifest


def _labels_for(contrast: Any, labels: Callable[[str], str | None] | None) -> dict[str, str] | None:
    if labels is None:
        return None
    out: dict[str, str] = {}
    for cid in contrast.table.index:
        text = labels(str(cid))
        if text:
            out[str(cid)] = text
    return out or None


# ---------------------------------------------------------------------------- read side: backlog enrichment
def _key_frame(table: pd.DataFrame, attrs: list[str]) -> pd.DataFrame:
    """Index a cached table by the slice attributes as strings (``(missing)`` for nulls)."""
    frame = _slice_key_columns(table, attrs)
    missing = [a for a in attrs if a not in frame.columns]
    if missing:
        raise KeyError(missing)
    idx = pd.MultiIndex.from_arrays(
        [frame[a].map(lambda v: "(missing)" if pd.isna(v) else str(v)) for a in attrs], names=attrs
    )
    return frame.set_index(idx)


@dataclass
class BacklogAnalytics:
    """The cached analytics of one slicing × view, joined by slice key."""

    stability: pd.DataFrame | None
    kinds: pd.DataFrame | None
    comparisons: pd.DataFrame | None
    caveats: pd.DataFrame | None
    window_end: pd.Timestamp | None
    record_ids: dict[str, str]
    manifest: dict[str, Any]

    @property
    def available(self) -> bool:
        return self.stability is not None or self.kinds is not None


def load_backlog_analytics(
    ws: Workspace, run_dir: Path, slicing_id: str, attrs: list[str], view: str
) -> BacklogAnalytics | None:
    store = AnalyticsStore(ws, run_dir)
    manifest = store.manifest()
    records = manifest.get("records") or {}
    if not records:
        return None
    record_ids: dict[str, str] = {}

    def table(name: str, key: str) -> pd.DataFrame | None:
        rec = records.get(key)
        if not rec or not rec.get("paramsHash"):
            return None
        cached = store.load(name, str(rec["paramsHash"]))
        if cached is None:
            return None
        if rec.get("recordId"):
            record_ids[name] = str(rec["recordId"])
        try:
            return _key_frame(cached.table, attrs)
        except KeyError:
            return None

    rid = records.get("readiness", {}).get("recordId")
    if rid:
        record_ids["readiness"] = str(rid)
    end = manifest.get("windowEnd")
    return BacklogAnalytics(
        stability=table("bootstrap_backlog", f"bootstrap_backlog:{slicing_id}:{view}"),
        kinds=table("problem_kinds", f"problem_kinds:{slicing_id}"),
        comparisons=table("comparisons", f"comparisons:{slicing_id}:{view}"),
        caveats=table("caveats", f"caveats:{slicing_id}"),
        window_end=pd.Timestamp(end) if end else None,
        record_ids=record_ids,
        manifest=manifest,
    )


def caveat_texts(
    shares: dict[str, float],
    *,
    items: str,
    window_end: pd.Timestamp | None,
    closure_label: str,
    min_share: float = CARD_CAVEAT_MIN_SHARE,
) -> list[dict[str, Any]]:
    """``{id, share, text, status}`` for every caveat kind whose share in the group is above ``min_share``."""
    if wa is None:
        return []
    from wise_analytics import quality

    th = quality.DEFAULT_THRESHOLDS
    out = []
    for kind, _col, warn_key, fail_key in quality.CAVEAT_KINDS:
        share = shares.get(kind)
        if share is None or not np.isfinite(share) or share <= min_share:
            continue
        status = "fail" if share >= th[fail_key] else "warn" if share >= th[warn_key] else "pass"
        out.append(
            {
                "id": kind,
                "share": float(share),
                "status": status,
                "text": quality.caveat_text(
                    kind, float(share), items=items, window_end=window_end, closure_label=closure_label
                ),
                "window_end": str(window_end.date()) if window_end is not None else None,
            }
        )
    return out


def kind_reading(kind: str | None, *, items: str, plain_layer: str | None = None) -> str | None:
    if kind is None:
        return None
    if wa is not None:
        try:
            return str(wa.kind_reading(kind, items=items, plain_layer=plain_layer))
        except Exception:
            pass
    from wise_workbench.domain.readings import kind_reading as fallback

    return fallback(kind)


def points_below(mean_score: Any, global_mean: Any) -> str | None:
    try:
        m, g = float(mean_score), float(global_mean)
    except (TypeError, ValueError):
        return None
    if not (np.isfinite(m) and np.isfinite(g)):
        return None
    if wa is not None:
        return str(wa.points_below(m, g))
    d = (g - m) * 100
    word = "below" if d > 0 else "above"
    return f"{abs(d):.1f} points {word} the overall score of {g * 100:.1f}"


# ---------------------------------------------------------------------------- read side: one group
def slice_analytics(
    ws: Workspace,
    run_dir: Path,
    *,
    result: wise.ScoreResult,
    log: wise.EventLog | None,
    mapping: ColumnMapping,
    norm: wise.Norm,
    view: str,
    attrs: list[str],
    key: list[Any],
    gamma: float,
    case_noun: str,
    closure_label: str,
    subgroup_attributes: list[str],
    window_end: pd.Timestamp | None,
    censored: pd.Series | None,
    labels: Callable[[str], str | None] | None = None,
    bootstrap_b: int = 200,
) -> dict[str, Any] | None:
    """Contrast, headroom, sub-groups, caveats and the plain sentences of one group (cached on disk)."""
    if wa is None:
        return None
    store = AnalyticsStore(ws, run_dir)
    where = {a: (None if v == "(missing)" else v) for a, v in zip(attrs, key)}
    mask = _where_mask(result.cases, where)
    base = {"view": view, "by": attrs, "key": [jsonable(v) for v in key], "gamma": gamma}
    out: dict[str, Any] = {"record_ids": {}, "readings": []}

    # contrast with intervals
    c_params = {**base, "B": bootstrap_b}
    c_hash = params_hash("contrast_slice", c_params)
    cached = store.load("contrast_slice", c_hash)
    if cached is None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            signals = wa.raw_signals(log, norm) if log is not None else None
            c = wa.contrast_slice(result, view, mask, B=bootstrap_b, signals=signals)
        cached = store.save(
            "contrast_slice",
            c_hash,
            c.table,
            record=c.record,
            summary=dict(c.summary),
            readings=c.readings,
            params=c_params,
        )
        contrast_obj: Any = c
    else:
        contrast_obj = None
    out["contrast"] = cached.table
    out["contrast_summary"] = cached.summary
    if cached.record_id:
        out["record_ids"]["contrast_slice"] = cached.record_id
    out["readings"].extend(cached.summary.get("readings", []))

    # comparison sentence (needs the contrast object; recomputed without intervals when it came from the cache)
    try:
        if contrast_obj is None:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                signals = wa.raw_signals(log, norm) if log is not None else None
                contrast_obj = wa.contrast_slice(result, view, mask, B=0, signals=signals)
        lab = _labels_for(contrast_obj, labels)
        out["comparisons"] = wa.comparisons(contrast_obj, top=3, items=case_noun, labels=lab, norm=norm)
        out["comparison"] = wa.comparison_sentence(contrast_obj, top=1, items=case_noun, labels=lab, norm=norm)
    except Exception:
        out["comparisons"] = None
        out["comparison"] = None

    # headroom
    h_params = dict(base)
    h_hash = params_hash("headroom", h_params)
    cached = store.load("headroom", h_hash)
    if cached is None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            h = wa.headroom(result, view, mask, gamma=gamma)
        cached = store.save(
            "headroom", h_hash, h.table, record=h.record, summary=dict(h.summary), readings=h.readings, params=h_params
        )
    out["headroom"] = cached.table
    out["headroom_summary"] = cached.summary
    if cached.record_id:
        out["record_ids"]["headroom"] = cached.record_id

    # sub-groups
    attributes = [a for a in subgroup_attributes if a in result.cases.columns and a not in attrs]
    period = "Q" if getattr(result, "log", None) is not None or log is not None else None
    if getattr(result, "log", None) is None and log is not None:
        result.log = log
    s_params = {
        **base,
        "attributes": attributes,
        "period": period,
        "windowEnd": str(window_end) if window_end is not None else None,
    }
    s_hash = params_hash("subgroups", s_params)
    cached = store.load("subgroups", s_hash)
    if cached is None and (attributes or period):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                sg = wa.subgroups(
                    result,
                    mask,
                    attributes,
                    view=view,
                    period=period,
                    censored=censored,
                    closure=list(mapping.closure_activities) or None,
                    window=mapping.censoring_window,
                    window_end=window_end,
                    top=10,
                    items=case_noun,
                    closure_label=closure_label,
                )
            cached = store.save(
                "subgroups",
                s_hash,
                sg.table,
                record=sg.record,
                summary=dict(sg.summary),
                readings=sg.readings,
                params=s_params,
            )
        except Exception as exc:
            out["subgroups_error"] = str(exc)
            cached = None
    out["subgroups"] = cached.table if cached is not None else None
    if cached is not None and cached.record_id:
        out["record_ids"]["subgroups"] = cached.record_id
    return out


def _where_mask(cases: pd.DataFrame, where: dict[str, Any]) -> pd.Series:
    mask = pd.Series(True, index=cases.index)
    for attr, value in where.items():
        col = pd.Series(cases.index, index=cases.index) if attr == cases.index.name else cases[attr]
        mask &= col.isna() if value is None else (col.astype(str) == str(value))
    return mask


def slice_caveats(
    ws: Workspace,
    run_dir: Path,
    *,
    slicing_id: str,
    attrs: list[str],
    key: list[Any],
    items: str,
    closure_label: str,
) -> list[dict[str, Any]]:
    """The caveats of one group from the cached shares (``caveats_by``)."""
    ba = load_backlog_analytics(ws, run_dir, slicing_id, attrs, "")
    if ba is None or ba.caveats is None:
        return []
    idx: Any = tuple("(missing)" if v is None else str(v) for v in key)
    try:
        row = ba.caveats.loc[idx] if len(attrs) > 1 else ba.caveats.loc[idx[0]]
    except KeyError:
        return []
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0]
    shares = {k: float(row[f"{k}_share"]) for k in CAVEAT_KINDS if f"{k}_share" in row.index}
    return caveat_texts(shares, items=items, window_end=ba.window_end, closure_label=closure_label)


def manifest_json(ws: Workspace, run_dir: Path) -> dict[str, Any]:
    return AnalyticsStore(ws, run_dir).manifest()


def dumps(data: Any) -> str:
    return dumps_json(data)
