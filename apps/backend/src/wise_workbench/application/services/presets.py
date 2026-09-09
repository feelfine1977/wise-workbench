"""Presets: public logs with a known mapping and norm, loaded in one job."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wise_workbench.domain import Job, JobKind, JobStatus, NotFoundError, ValidationError
from wise_workbench.jobs.handlers.load_preset import fit_mapping, preset_paths
from wise_workbench.presets import all_presets

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class PresetService:
    def __init__(self, c: Container):
        self.c = c

    def list(self, project_id: str) -> list[dict[str, Any]]:
        self.c.repos.get_project(project_id)
        out = []
        for preset in all_presets(self.c.settings).values():
            csv, norm = preset_paths(self.c.settings, preset)
            out.append(
                {
                    "id": preset.id,
                    "name": preset.name,
                    "description": preset.description,
                    "available": csv is not None and csv.is_file() and norm is not None and norm.is_file(),
                    "source": str(csv) if csv is not None else "not configured",
                    "norm": str(norm) if norm is not None else "not configured",
                    "mapping": fit_mapping(preset.mapping, set())
                    | {"caseAttributes": list(preset.mapping["caseAttributes"])},
                    "slicing": list(preset.slicing),
                    "view": preset.view,
                    "gamma": preset.gamma,
                    "minCases": preset.min_cases,
                    "process": preset.process,
                    "kind": preset.source,
                    "caseNoun": preset.case_noun,
                    "labelPack": preset.label_pack,
                    "pitfalls": list(preset.pitfalls),
                    "extraSlicings": [list(x) for x in preset.extra_slicings],
                    "note": preset.note,
                }
            )
        return out

    def load(self, project_id: str, preset_id: str) -> Job:
        self.c.repos.get_project(project_id)
        known = all_presets(self.c.settings)
        preset = known.get(preset_id)
        if preset is None:
            raise NotFoundError(f"unknown preset {preset_id!r}; known: {sorted(known)}", code="preset.not_found")
        csv, norm = preset_paths(self.c.settings, preset)
        missing = [str(p) if p is not None else "not configured" for p in (csv, norm) if p is None or not p.is_file()]
        if missing:
            raise ValidationError(
                f"preset {preset_id!r} is not available on this machine; missing: {missing}",
                code="preset.unavailable",
                errors=[{"field": "path", "message": m} for m in missing],
            )
        for status in (JobStatus.QUEUED, JobStatus.RUNNING):
            for job in self.c.queue.list(status=str(status), project_id=project_id):
                if job.kind == str(JobKind.LOAD_PRESET) and job.payload.get("presetId") == preset_id:
                    return job
        return self.c.queue.enqueue(
            str(JobKind.LOAD_PRESET), {"projectId": project_id, "presetId": preset_id}, project_id=project_id
        )
