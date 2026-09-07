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
    DECISION_STATE_FIELD,
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    ConflictError,
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
        rules = params.get("rules") or doc.get("flowTyping") or []
        doc["flowTyping"] = [{"name": str(r["name"]), "rule": dict(r["rule"])} for r in rules]
        doc["flowTypeDefault"] = str(params.get("default") or doc.get("flowTypeDefault") or "other")
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

    # ------------------------------------------------------------- the lineage (R3-O3)
    def lineage(self, project_id: str, case_table_id: str) -> list[CaseTable]:
        """The chain of case tables from the one given to the current head, oldest first.

        Every apply creates a child mapping and a new case table. A reader who takes a second decision is still
        looking at the screen of the first table, so an apply that started from the given table would drop the
        first decision (the owner's "after deduplicating, the earlier decision was no longer selected"). The chain
        is walked forward here and the decision is applied to its head, so decisions accumulate.
        """
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        by_parent: dict[str, list[ColumnMapping]] = {}
        for m in self.c.repos.list_mappings(table.dataset_id):
            if m.parent_id:
                by_parent.setdefault(m.parent_id, []).append(m)
        tables_by_mapping: dict[str, list[CaseTable]] = {}
        for t in self.c.repos.list_case_tables(project_id):
            if t.mapping_id:
                tables_by_mapping.setdefault(t.mapping_id, []).append(t)
        chain = [table]
        seen = {table.mapping_id}
        current = table.mapping_id
        while current:
            children = sorted(by_parent.get(current, []), key=lambda m: (m.created_at, m.id))
            nxt = None
            for child in reversed(children):
                if child.id in seen:
                    continue
                ready = [t for t in tables_by_mapping.get(child.id, []) if t.status == CaseTableStatus.READY]
                candidates = ready or tables_by_mapping.get(child.id, [])
                if candidates:
                    nxt = (child, sorted(candidates, key=lambda t: (t.created_at, t.id))[-1])
                    break
            if nxt is None:
                break
            seen.add(nxt[0].id)
            chain.append(nxt[1])
            current = nxt[0].id
        return chain

    def head(self, project_id: str, case_table_id: str) -> CaseTable:
        """The newest usable case table of the lineage; decisions are applied there."""
        chain = self.lineage(project_id, case_table_id)
        for t in reversed(chain):
            if t.status == CaseTableStatus.READY:
                return t
        return chain[-1]

    def preview(self, project_id: str, case_table_id: str, kind: str, params: dict[str, Any] | None) -> dict[str, Any]:
        head = self.head(project_id, case_table_id)
        table, mapping = self._table(project_id, head.id)
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
            "requestedCaseTableId": case_table_id,
            "appliedDecisions": [dict(d) for d in mapping.decisions],
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
        head = self.head(project_id, case_table_id)
        table, mapping = self._table(project_id, head.id)
        clean = validate_decision(kind, params)
        preview: DecisionPreview = self.c.engine.preview_decision(
            self.c.workspace.case_table_dir(project_id, table.id), mapping, kind, clean
        )
        if kind == "flow_type_assignment" and preview.detail.get("alreadyTyped"):
            raise ConflictError(
                str(preview.detail.get("message") or "the mapping already types the flows"),
                code="decision.already_typed",
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

    # ------------------------------------------------------------- decide again (R3-O1)
    def item_decisions(self, project_id: str, case_table_id: str) -> dict[str, Any]:
        """Per readiness item: the full option set, the decision in force with its option marked, and the history.

        A decision never removes the options of its item: the reader can decide again, and doing so creates the
        next mapping version rather than editing the one in force.
        """
        chain = self.lineage(project_id, case_table_id)
        head = chain[-1]
        for t in reversed(chain):
            if t.status == CaseTableStatus.READY:
                head = t
                break
        mapping = self.c.repos.get_mapping(head.mapping_id) if head.mapping_id else None
        doc = mapping.to_dict() if mapping is not None else {}
        chain_ids = [t.id for t in chain]
        history: dict[str, list[dict[str, Any]]] = {}
        for d in self.c.repos.list_decisions(project_id):
            if d.case_table_id in chain_ids or d.result_case_table_id in chain_ids:
                history.setdefault(d.readiness_item, []).append(d.to_dict())
        for entries in history.values():
            entries.sort(key=lambda e: str(e["createdAt"]), reverse=True)
        items: list[dict[str, Any]] = []
        for kind, spec in DECISION_KINDS.items():
            applied = [d for d in (doc.get("decisions") or []) if d.get("kind") == kind]
            state_field = DECISION_STATE_FIELD.get(kind)
            current_value = doc.get(state_field) if state_field else None
            options = dict(spec.get("options") or {})
            entries = history.get(str(spec["item"]), [])
            items.append(
                {
                    "readinessItem": spec["item"],
                    "kind": kind,
                    "label": spec["label"],
                    "params": list(spec["params"]),
                    "options": options,
                    "selected": (applied[-1].get("params") if applied else None),
                    "currentValue": current_value,
                    "decided": bool(applied),
                    "canDecideAgain": True,
                    "note": spec.get("note"),
                    "history": [e for e in entries if e.get("kind") == kind],
                }
            )
        return {
            "caseTableId": head.id,
            "requestedCaseTableId": case_table_id,
            "mappingId": head.mapping_id,
            "version": mapping.version if mapping is not None else 0,
            "lineage": [
                {"caseTableId": t.id, "mappingId": t.mapping_id, "status": str(t.status), "cases": t.cases}
                for t in chain
            ],
            "items": items,
        }

    def list(self, project_id: str, case_table_id: str | None = None) -> list[Decision]:
        """The project's decisions; with a case table, every decision of its lineage (R3-O3), oldest first."""
        self.c.repos.get_project(project_id)
        if case_table_id is None:
            return self.c.repos.list_decisions(project_id)
        chain = {t.id for t in self.lineage(project_id, case_table_id)}
        return [
            d
            for d in self.c.repos.list_decisions(project_id)
            if d.case_table_id in chain or d.result_case_table_id in chain
        ]

    def get(self, project_id: str, decision_id: str) -> Decision:
        d = self.c.repos.get_decision(decision_id)
        if d.project_id != project_id:
            raise NotFoundError(
                f"decision {decision_id!r} not found in project {project_id!r}", code="decision.not_found"
            )
        return d
