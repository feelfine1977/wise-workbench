"""Decisions on data caveats (R2-O1): preview, apply as a versioned mapping decision, rebuild the case table.

Applying a decision never edits an existing mapping or case table: it creates a child mapping (parent id, the
decision appended, the field-level effect folded in) and a new case table built from it by the ``build_cases``
job, whose readiness report is the re-evaluation.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Any

from wise_workbench.domain import (
    DECISION_KINDS,
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    Decision,
    DecisionPreview,
    Job,
    JobKind,
    NotFoundError,
    ValidationError,
    validate_decision,
)
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


def fold_decision(mapping: ColumnMapping, kind: str, params: dict[str, Any], decision_id: str) -> dict[str, Any]:
    """The child mapping document: the decision appended and its field-level effect applied."""
    doc = mapping.to_dict()
    doc["decisions"] = [*doc.get("decisions", []), {"id": decision_id, "kind": kind, "params": dict(params)}]
    if kind == "collapse_duplicates":
        doc["dedupe"] = True
    elif kind == "day_precision":
        doc["dayPrecisionActivities"] = sorted(set(doc.get("dayPrecisionActivities", [])) | set(params["activities"]))
    elif kind == "header_events":
        doc["headerEvents"] = list(dict.fromkeys([*doc.get("headerEvents", []), *params["activities"]]))
    elif kind == "open_cases":
        doc["openCases"] = params["handling"]
        if params.get("closure"):
            doc["closureActivities"] = [str(a) for a in params["closure"]]
        doc["censoringWindow"] = str(params.get("window") or doc.get("censoringWindow") or "60D")
    elif kind == "zero_exposure":
        doc["zeroExposure"] = params["handling"]
    elif kind == "flow_type_assignment":
        doc["flowTyping"] = [{"name": str(r["name"]), "rule": dict(r["rule"])} for r in params["rules"]]
        doc["flowTypeDefault"] = str(params.get("default") or "other")
    return doc


class DecisionService:
    def __init__(self, c: Container):
        self.c = c

    def kinds(self) -> list[dict[str, Any]]:
        return [{"kind": k, **spec} for k, spec in DECISION_KINDS.items()]

    def _table(self, project_id: str, case_table_id: str) -> tuple[CaseTable, ColumnMapping]:
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        return table, self.c.repos.get_mapping(table.mapping_id)

    def preview(self, project_id: str, case_table_id: str, kind: str, params: dict[str, Any] | None) -> dict[str, Any]:
        table, mapping = self._table(project_id, case_table_id)
        clean = validate_decision(kind, params)
        preview: DecisionPreview = self.c.engine.preview_decision(
            self.c.workspace.case_table_dir(project_id, table.id), mapping, kind, clean
        )
        return {
            "kind": kind,
            "params": clean,
            "readinessItem": DECISION_KINDS[kind]["item"],
            "label": DECISION_KINDS[kind]["label"],
            "preview": preview.to_dict(),
            "caseTableId": table.id,
            "version": mapping.version + 1,
        }

    def apply(
        self,
        project_id: str,
        case_table_id: str,
        kind: str,
        params: dict[str, Any] | None,
        *,
        author: str | None = None,
        note: str | None = None,
    ) -> tuple[Decision, CaseTable, Job]:
        table, mapping = self._table(project_id, case_table_id)
        clean = validate_decision(kind, params)
        preview: DecisionPreview = self.c.engine.preview_decision(
            self.c.workspace.case_table_dir(project_id, table.id), mapping, kind, clean
        )
        decision_id = new_id("dec")
        doc = fold_decision(mapping, kind, clean, decision_id)
        doc["parentId"] = mapping.id
        child = ColumnMapping.from_dict(new_id("map"), mapping.dataset_id, doc)
        self.c.repos.add_mapping(child)
        new_table = CaseTable(
            id=new_id("ct"),
            project_id=project_id,
            dataset_id=table.dataset_id,
            mapping_id=child.id,
            status=CaseTableStatus.BUILDING,
        )
        self.c.repos.add_case_table(new_table)
        job = self.c.queue.enqueue(
            str(JobKind.BUILD_CASES),
            {
                "projectId": project_id,
                "datasetId": table.dataset_id,
                "mappingId": child.id,
                "caseTableId": new_table.id,
                "decisionId": decision_id,
            },
            project_id=project_id,
        )
        new_table = replace(new_table, job_id=job.id)
        self.c.repos.update_case_table(new_table)
        decision = Decision(
            id=decision_id,
            project_id=project_id,
            case_table_id=table.id,
            kind=kind,
            params=clean,
            readiness_item=DECISION_KINDS[kind]["item"],
            version=child.version,
            mapping_id=child.id,
            result_case_table_id=new_table.id,
            preview=preview,
            author=author,
            note=note,
        )
        self.c.repos.add_decision(decision)
        return decision, new_table, job

    def list(self, project_id: str, case_table_id: str | None = None) -> list[Decision]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_decisions(project_id, case_table_id)

    def get(self, project_id: str, decision_id: str) -> Decision:
        d = self.c.repos.get_decision(decision_id)
        if d.project_id != project_id:
            raise NotFoundError(
                f"decision {decision_id!r} not found in project {project_id!r}", code="decision.not_found"
            )
        return d
