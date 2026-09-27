"""Read-only process templates for the project's fixed dataset; never load a preset."""

from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import _load, label_map, translate_norm
from wise_workbench.application.services.project_binding import get_binding
from wise_workbench.domain import CaseTableStatus, ConflictError, NotFoundError, ValidationError, thresholds_of
from wise_workbench.jobs.handlers.load_preset import preset_paths
from wise_workbench.presets import all_presets

if TYPE_CHECKING:
    from wise_workbench.container import Container


def template_sources(c: Container, process: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    """Use the actual pack index and configured standalone norm paths, independent of log availability."""
    loaded = _load(process) if process else None
    sources: list[dict[str, Any]] = []
    mappings: list[str] = []
    if loaded:
        pack, _matcher, validated = loaded
        mappings = sorted(str(key) for key in pack.mappings)
        for entry in pack.templates:
            sources.append(
                {
                    "id": str(entry.id),
                    "name": entry.name,
                    "description": entry.description,
                    "source": "process_pack",
                    "path": entry.path,
                    "activityLabels": entry.activity_labels,
                    "notes": entry.notes,
                    "packValidated": validated,
                }
            )
    for preset in all_presets(c.settings).values():
        if preset.process != process or preset.source != "builtin":
            continue
        _log, norm = preset_paths(c.settings, preset)
        sources.append(
            {
                "id": f"preset:{preset.id}",
                "name": f"{preset.name} norm",
                "description": preset.norm_note,
                "source": "configured_norm",
                "path": norm,
                "activityLabels": "log_labels",
                "notes": preset.note or "",
                "packValidated": True,
            }
        )
    return sources, mappings


def list_norm_templates(
    c: Container, project_id: str, case_table_id: str, *, label_pack: str | None = None, template_id: str | None = None
) -> dict[str, Any]:
    project = c.repos.get_project(project_id)
    table = c.mappings.get_case_table(project_id, case_table_id)
    binding = get_binding(c, project_id)
    if binding["datasetId"] is not None and binding["datasetId"] != table.dataset_id:
        raise ConflictError(
            "The selected case table differs from the project dataset.", code="project.dataset_binding_mismatch"
        )
    if table.status != CaseTableStatus.READY:
        raise ValidationError(
            "Prepare the selected case table before previewing templates.", code="case_table.not_ready"
        )
    c.datasets.get(project_id, table.dataset_id)
    mapping = c.repos.get_mapping(table.mapping_id)
    if mapping.dataset_id != table.dataset_id:
        raise ValidationError("Case table mapping does not match its dataset.", code="case_table.mapping_mismatch")
    sources, mapping_names = template_sources(c, project.process)
    if label_pack is not None and label_pack not in mapping_names:
        raise ValidationError(
            "Choose a curated label pack from this project's process.", code="norm.template_label_pack"
        )
    if template_id is not None and template_id not in {source["id"] for source in sources}:
        raise NotFoundError("Template not found in this project’s process.", code="norm.template_not_found")
    # Already stored during preparation: catalogue reads never load the event table.
    labels = {row.label for row in table.activities}
    choices = []
    for name in mapping_names:
        target_labels = {label for group in label_map(project.process, name).values() for label in group}
        choices.append({"id": name, "observedLabels": len(labels & target_labels), "totalLabels": len(target_labels)})
    templates = []
    for source in sources:
        item: dict[str, Any] = {key: source[key] for key in ("id", "name", "description", "source", "activityLabels")}
        item.update(
            available=False,
            reason=None,
            norm=None,
            warnings=[],
            constraints=[],
            pendingConstraintIds=[],
            documentHash=None,
        )
        path = source["path"]
        if path is None or not Path(path).is_file():
            item["reason"] = "The configured norm document is unavailable."
            templates.append(item)
            continue
        if source["id"] != template_id:
            item["available"] = True
            templates.append(item)
            continue
        try:
            document = json.loads(Path(path).read_text(encoding="utf-8"))
            if not isinstance(document, dict):
                raise ValueError("Expected a norm object")
            document = deepcopy(document)
            untranslated: list[str] = []
            translated = source["activityLabels"] == "canonical_ids" and label_pack is not None
            if translated and label_pack is not None:
                document, untranslated = translate_norm(document, project.process, label_pack)
            canonical, _fingerprint = c.engine.validate_norm(document)
            metadata = canonical.setdefault("metadata", {})
            # A published source's decisions belong to that source, not this new project draft.
            metadata.pop("calibration", None)
            metadata.pop("not_applicable", None)
            pending = sorted(thresholds_of(canonical))
            metadata["calibration_pending"] = pending
            meta = metadata.setdefault("meta", {})
            source_calibration = meta.get("calibration")
            meta["calibration"] = "uncalibrated"
            meta["uncalibrated_parameters"] = pending
            metadata["template_import"] = {
                "templateId": source["id"],
                "process": project.process,
                "caseTableId": case_table_id,
                "datasetId": table.dataset_id,
                "labelPack": label_pack if translated else None,
                "binding": "explicit_curated_labels" if translated else "source_labels",
                "sourceCalibration": source_calibration,
            }
            if translated and label_pack is not None:
                meta["activity_labels"] = "log_labels"
            warnings = [source["notes"]] if source["notes"] else []
            if not source["packValidated"]:
                warnings.append("The process pack has validation issues; review the source guidance.")
            if source["activityLabels"] == "canonical_ids" and not translated:
                warnings.append(
                    "Canonical activity IDs are retained. Choose a curated label pack explicitly or edit labels after import."
                )
            if untranslated:
                warnings.append("No curated label for: " + ", ".join(untranslated))
            coverage = c.engine.norm_relevance(
                c.workspace.case_table_dir(project_id, case_table_id), mapping, canonical
            )
            # Priority is only a preview/navigation aid; retain every rule, scope and weight in the document.
            rows = []
            definitions = {str(rule["id"]): rule for rule in canonical.get("constraints", [])}
            for row in coverage["constraints"]:
                rule = definitions[row["id"]]
                low = bool(row["missingActivities"] or row["issues"] or row["casesInScope"] in (None, 0))
                rows.append(
                    {
                        **row,
                        "layer": str(rule["layer"]),
                        "type": str(rule["type"]),
                        "description": str(rule.get("description") or rule["id"]),
                        "priority": "low" if low else "normal",
                    }
                )
            rows.sort(key=lambda row: row["priority"] == "low")
            item.update(
                available=True,
                norm=canonical,
                warnings=warnings,
                constraints=rows,
                pendingConstraintIds=pending,
                documentHash=sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest(),
            )
        except (OSError, ValueError, TypeError, KeyError, ValidationError) as exc:
            item["reason"] = "The template could not be read, validated or previewed: " + str(exc)
        templates.append(item)
    return {
        "projectId": project_id,
        "process": project.process,
        "caseTableId": case_table_id,
        "datasetId": table.dataset_id,
        "labelPack": label_pack,
        "cases": table.cases,
        "labelPacks": choices,
        "templates": templates,
        "templateId": template_id,
    }
