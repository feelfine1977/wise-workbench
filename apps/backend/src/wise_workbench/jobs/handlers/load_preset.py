"""``load_preset``: a public log from a configured path → dataset, mapping, case table, norm version and a
scored run, in one job. Every step reuses what already exists in the project (same content hash, same
mapping, same norm fingerprint, same run parameters), so loading a preset twice is idempotent."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from wise_workbench.adapters.knowledge import translate_norm
from wise_workbench.adapters.storage import sha256_file
from wise_workbench.application.ports import ProgressFn
from wise_workbench.domain import (
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    ConflictError,
    DatasetStatus,
    DatasetVersion,
    NotFoundError,
    Run,
    RunParams,
    RunStatus,
    Slicing,
    SourceKind,
    slicing_id,
)
from wise_workbench.ids import new_id
from wise_workbench.jobs.worker import JobContext
from wise_workbench.presets import Preset, all_presets

from . import build_cases, ingest, score_run


def preset_paths(settings: Any, preset: Preset) -> tuple[Path, Path]:
    """The log file and the starting norm of a preset: from the settings (built-in) or resolved (pack presets)."""
    csv = (
        Path(getattr(settings, preset.csv_setting)) if preset.csv_setting else Path(preset.csv_path or "")
    ).expanduser()
    norm = (
        Path(getattr(settings, preset.norm_setting)) if preset.norm_setting else Path(preset.norm_path or "")
    ).expanduser()
    return csv, norm


def fit_mapping(doc: dict[str, Any], columns: set[str]) -> dict[str, Any]:
    """The preset mapping restricted to the columns the file has.

    A flow type whose rule reads a column the file does not carry cannot be assigned, and dropping it silently
    leaves a type in the pack that matches nothing and no one can explain (R3-15). Every dropped rule is kept as
    a note naming the type, the columns it needed and the ones the file has, so that the flow-type list can say
    why the fourth type is absent instead of showing three and no reason.
    """
    out = json.loads(json.dumps(doc))
    out["caseAttributes"] = [a for a in out.get("caseAttributes", []) if a in columns]
    for key in ("resource", "order", "eventId", "exposure", "lifecycle"):
        if out.get(key) and out[key] not in columns:
            out.pop(key, None)
    notes: list[dict[str, Any]] = list(out.get("flowTypingNotes") or [])
    rules = []
    for rule in out.get("flowTyping", []):
        needed = _rule_columns(rule.get("rule") or {})
        if needed <= columns or not columns:
            rules.append(rule)
        else:
            notes.append(
                {
                    "name": str(rule.get("name") or ""),
                    "reason": "missing_column",
                    "needs": sorted(needed - columns),
                    "text": (
                        f"The flow type {rule.get('name')!r} is not assigned on this log: its rule reads "
                        f"{', '.join(sorted(needed - columns))}, which the file does not carry."
                    ),
                }
            )
    out["flowTyping"] = rules
    # a prepared attribute whose source column the file does not carry is dropped, not failed
    prepared = []
    for spec in out.get("preparedAttributes", []):
        needed = _prepared_columns(spec)
        if not columns or needed <= columns:
            prepared.append(spec)
    out["preparedAttributes"] = prepared
    if columns:
        known = columns | {str(p["name"]) for p in prepared}
        kept = []
        for rule in out["flowTyping"]:
            needed = _rule_columns(rule.get("rule") or {})
            if needed <= known:
                kept.append(rule)
            elif not any(n.get("name") == rule.get("name") for n in notes):
                notes.append(
                    {
                        "name": str(rule.get("name") or ""),
                        "reason": "missing_column",
                        "needs": sorted(needed - known),
                        "text": (
                            f"The flow type {rule.get('name')!r} is not assigned on this log: its rule reads "
                            f"{', '.join(sorted(needed - known))}, which the file does not carry."
                        ),
                    }
                )
        out["flowTyping"] = kept
    out["flowTypingNotes"] = notes
    return out


# words a rule uses for itself; anything else with a list of values in the library's grammar is an attribute name
_RULE_WORDS = frozenset(
    {
        "a",
        "activity",
        "after",
        "all",
        "and",
        "any",
        "attr",
        "b",
        "before",
        "directly",
        "eq",
        "field",
        "has",
        "kind",
        "lacks",
        "max",
        "min",
        "name",
        "not",
        "note",
        "op",
        "or",
        "unit",
        "value",
        "in",
    }
)


def _rule_columns(rule: dict[str, Any]) -> set[str]:
    """The case-attribute columns a flow-typing rule reads, in either grammar.

    The canonical filter grammar names its column in ``field`` and lists the values it wants in ``in``; the
    library's applicability grammar writes the attribute name as the key (``{"Item Category": ["3-way"]}``).
    Reading ``in`` as a column name drops every attribute rule of a preset as *the file has no column "in"*,
    which is how the order-to-cash ``returns`` type came to match nothing (R3-15).
    """
    out: set[str] = set()
    if rule.get("attr"):
        out.add(str(rule["attr"]))
    if rule.get("kind") == "attribute" and rule.get("field"):
        out.add(str(rule["field"]))
    for key in ("all", "any", "and", "or"):
        for item in rule.get(key) or []:
            if isinstance(item, dict):
                out |= _rule_columns(item)
    if isinstance(rule.get("not"), dict):
        out |= _rule_columns(rule["not"])
    if "kind" not in rule:
        for attr, value in rule.items():
            if attr not in _RULE_WORDS and isinstance(value, list):
                out.add(str(attr))
    return out


def _prepared_columns(spec: dict[str, Any]) -> set[str]:
    """The columns a prepared attribute reads."""
    body = dict(spec.get("spec") or {})
    out: set[str] = set()
    if spec.get("kind") == "alias":
        out.add(str(body.get("from") or body.get("attribute") or ""))
        return {c for c in out if c}
    for side in ("minuend", "subtrahend"):
        part = body.get(side) or {}
        if isinstance(part, dict) and part.get("attribute"):
            out.add(str(part["attribute"]))
    if body.get("attribute"):
        out.add(str(body["attribute"]))
    return {c for c in out if c}


def _scaled(progress: ProgressFn, lo: float, hi: float, prefix: str) -> ProgressFn:
    def fn(fraction: float, message: str | None = None) -> None:
        progress(lo + (hi - lo) * max(0.0, min(float(fraction), 1.0)), f"{prefix}: {message}" if message else prefix)

    return fn


def _mapping_matches(existing: ColumnMapping, wanted: dict[str, Any]) -> bool:
    a = {k: v for k, v in existing.to_dict().items() if k != "note"}
    b = {
        k: v for k, v in ColumnMapping.from_dict("probe", existing.dataset_id, wanted).to_dict().items() if k != "note"
    }
    return a == b


def run(ctx: JobContext) -> str:
    return perform(ctx.container, ctx.payload["projectId"], ctx.payload["presetId"], ctx.progress)


def perform(c: Any, project_id: str, preset_id: str, progress: ProgressFn) -> str:
    try:
        preset = all_presets(c.settings)[preset_id]
    except KeyError:
        raise NotFoundError(f"unknown preset {preset_id!r}", code="preset.not_found") from None
    csv, norm_path = preset_paths(c.settings, preset)
    if not csv.exists():
        raise NotFoundError(f"the log file of preset {preset_id!r} is not at {csv}", code="preset.unavailable")
    if not norm_path.exists():
        raise NotFoundError(f"the norm file of preset {preset_id!r} is not at {norm_path}", code="preset.unavailable")
    c.repos.get_project(project_id)

    # 1. dataset: reuse by content hash, else register the file in place and ingest it
    progress(0.01, "hashing the log file")
    digest = sha256_file(csv)
    dataset = next(
        (d for d in c.repos.list_datasets(project_id) if d.content_hash == digest and d.status == DatasetStatus.READY),
        None,
    )
    if dataset is None:
        dataset = DatasetVersion(
            id=new_id("ds"),
            project_id=project_id,
            name=csv.name,
            status=DatasetStatus.INGESTING,
            source_kind=SourceKind.CSV,
            source_path=str(csv.resolve()),
            content_hash=digest,
        )
        c.repos.add_dataset(dataset)
        try:
            ingest.perform(c, dataset.id, _scaled(progress, 0.02, 0.5, "ingest"))
        except Exception as exc:
            c.repos.update_dataset(
                replace(c.repos.get_dataset(dataset.id), status=DatasetStatus.FAILED, error=str(exc))
            )
            raise
        dataset = c.repos.get_dataset(dataset.id)

    # 2. mapping and case table: reuse a ready table built with the same mapping
    columns = {col.name for col in dataset.columns}
    mapping_doc = fit_mapping(preset.mapping, columns)
    # The preset names what one case is ("purchase order items"); the mapping is what every screen reads it
    # from, so a preset loaded here must produce the same noun as the workspace it reproduces.
    if preset.case_noun and not mapping_doc.get("caseNoun"):
        mapping_doc["caseNoun"] = preset.case_noun
    table: CaseTable | None = None
    for cand in c.repos.list_case_tables(project_id):
        if cand.dataset_id != dataset.id or cand.status != CaseTableStatus.READY:
            continue
        if _mapping_matches(c.repos.get_mapping(cand.mapping_id), mapping_doc):
            table = cand
            break
    if table is None:
        mapping = ColumnMapping.from_dict(new_id("map"), dataset.id, mapping_doc)
        progress(0.51, "validating the mapping on a sample")
        c.engine.validate_mapping(
            c.workspace.dataset_dir(project_id, dataset.id), mapping, c.settings.mapping_sample_events
        )
        c.repos.add_mapping(mapping)
        table = CaseTable(
            id=new_id("ct"),
            project_id=project_id,
            dataset_id=dataset.id,
            mapping_id=mapping.id,
            status=CaseTableStatus.BUILDING,
        )
        c.repos.add_case_table(table)
        try:
            build_cases.perform(c, table.id, _scaled(progress, 0.52, 0.78, "case table"))
        except Exception as exc:
            c.repos.update_case_table(
                replace(c.repos.get_case_table(table.id), status=CaseTableStatus.FAILED, error=str(exc))
            )
            raise
        table = c.repos.get_case_table(table.id)

    # 3. norm version: the pack's template translated into this log's labels, reused by fingerprint
    progress(0.79, "norm version")
    doc = json.loads(norm_path.read_text(encoding="utf-8"))
    note = preset.norm_note
    if preset.label_pack:
        doc, untranslated = translate_norm(doc, preset.process, preset.label_pack)
        if untranslated:
            note += f"; {len(untranslated)} canonical activities have no label in this log ({untranslated[0]}, …)"
    _canonical, fingerprint = c.engine.validate_norm(doc)
    norm = next((n for n in c.repos.list_norm_versions(project_id) if n.fingerprint == fingerprint), None)
    if norm is None:
        norm = c.norms.create_version(project_id, doc, note=note)

    # 4. run: reuse identical parameters, else score in this job
    slicings = [Slicing(id=slicing_id(preset.slicing), attributes=tuple(preset.slicing))]
    for extra in preset.extra_slicings:
        if all(a in table.attributes for a in extra):
            slicings.append(Slicing(id=slicing_id(extra), attributes=tuple(extra)))
    # every view is scored (the view comparison needs at least two); the preset's view leads, so it is the default
    ordered = [preset.view, *[v for v in norm.view_names if v != preset.view]] if preset.view else norm.view_names
    views = tuple(v for v in ordered if v in norm.view_names)
    params = RunParams(
        case_table_id=table.id,
        norm_version_id=norm.id,
        views=views or tuple(norm.view_names),
        slicings=tuple(slicings),
        gamma=preset.gamma,
        min_cases=preset.min_cases,
        note=preset.run_note,
    )
    run_ = c.repos.find_run(project_id, params_hash=params.params_hash())
    if run_ is not None and run_.status == RunStatus.DONE:
        progress(1.0, f"reusing run {run_.id}")
        c.repos.set_latest_run(project_id, run_.id)
        return f"run:{run_.id}"
    if run_ is not None and run_.status in (RunStatus.QUEUED, RunStatus.RUNNING):
        raise ConflictError(f"run {run_.id} is already {run_.status}; wait for it to finish", code="preset.run_pending")
    if run_ is not None:
        run_ = c.repos.update_run(run_.transition(RunStatus.QUEUED, error=None))
    else:
        run_ = Run(id=new_id("run"), project_id=project_id, params=params, status=RunStatus.QUEUED)
        c.repos.add_run(run_)
    try:
        score_run.perform(c, run_.id, _scaled(progress, 0.8, 0.99, "scoring"))
    except Exception as exc:
        current = c.repos.get_run(run_.id)
        if not current.is_final:
            c.repos.update_run(current.transition(RunStatus.FAILED, error=str(exc)))
        raise
    progress(1.0, f"run {run_.id} done")
    return f"run:{run_.id}"


def on_final(ctx: JobContext, status: str, error: str | None) -> None:
    """Entities are marked failed where the step fails; nothing else to clean up."""
    return None
