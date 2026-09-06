"""Mappings: validated on a sample, then built into a case table by the ``build_cases`` job."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import case_noun as pack_case_noun
from wise_workbench.domain import (
    CaseTable,
    CaseTableStatus,
    ColumnMapping,
    DatasetStatus,
    Job,
    JobKind,
    NotFoundError,
    ValidationError,
)
from wise_workbench.ids import new_id
from wise_workbench.presets import suggest_mapping

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class MappingService:
    def __init__(self, c: Container):
        self.c = c

    def create(
        self, project_id: str, dataset_id: str, document: dict[str, Any]
    ) -> tuple[ColumnMapping, CaseTable, Job, dict[str, Any]]:
        dataset = self.c.datasets.get(project_id, dataset_id)
        if dataset.status != DatasetStatus.READY:
            raise ValidationError(
                f"dataset {dataset_id} is {dataset.status}; wait for the ingest job", code="dataset.not_ready"
            )
        if not document.get("caseNoun"):
            project = self.c.repos.get_project(project_id)
            noun = pack_case_noun(project.process)
            if noun:
                document = {**document, "caseNoun": noun}
        mapping = ColumnMapping.from_dict(new_id("map"), dataset_id, document)
        dataset_dir = self.c.workspace.dataset_dir(project_id, dataset_id)
        sample = self.c.engine.validate_mapping(dataset_dir, mapping, self.c.settings.mapping_sample_events)
        self.c.repos.add_mapping(mapping)
        table = CaseTable(
            id=new_id("ct"),
            project_id=project_id,
            dataset_id=dataset_id,
            mapping_id=mapping.id,
            status=CaseTableStatus.BUILDING,
        )
        self.c.repos.add_case_table(table)
        job = self.c.queue.enqueue(
            str(JobKind.BUILD_CASES),
            {"projectId": project_id, "datasetId": dataset_id, "mappingId": mapping.id, "caseTableId": table.id},
            project_id=project_id,
        )
        table = replace(table, job_id=job.id)
        self.c.repos.update_case_table(table)
        return mapping, table, job, sample

    def suggest(self, project_id: str, dataset_id: str) -> dict[str, Any]:
        """A mapping guessed from the dataset's column names (presets for known logs, patterns otherwise)."""
        dataset = self.c.datasets.get(project_id, dataset_id)
        if dataset.status != DatasetStatus.READY:
            raise ValidationError(
                f"dataset {dataset_id} is {dataset.status}; the column profile arrives with the ingest job",
                code="dataset.not_ready",
            )
        return suggest_mapping([c.name for c in dataset.columns])

    def get_mapping(self, mapping_id: str) -> ColumnMapping:
        return self.c.repos.get_mapping(mapping_id)

    def list_mappings(self, project_id: str, dataset_id: str) -> list[ColumnMapping]:
        self.c.datasets.get(project_id, dataset_id)
        return self.c.repos.list_mappings(dataset_id)

    def get_case_table(self, project_id: str, case_table_id: str) -> CaseTable:
        t = self.c.repos.get_case_table(case_table_id)
        if t.project_id != project_id:
            raise NotFoundError(
                f"case table {case_table_id!r} not found in project {project_id!r}", code="case_table.not_found"
            )
        return t

    def list_case_tables(self, project_id: str) -> list[CaseTable]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_case_tables(project_id)

    def flow_types(
        self, project_id: str, case_table_id: str, *, attribute: str | None, abstraction: float = 0.05
    ) -> dict[str, Any]:
        """The detected flow types of a case table with counts, one map each and a readiness headline (R2-O10)."""
        table = self.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        mapping = self.c.repos.get_mapping(table.mapping_id)
        project = self.c.repos.get_project(project_id)
        noun = (
            mapping.case_noun
            or (table.readiness.case_noun if table.readiness else None)
            or pack_case_noun(project.process)
        )
        out = self.c.engine.flow_types(
            self.c.workspace.case_table_dir(project_id, table.id),
            mapping,
            attribute=attribute,
            process=project.process,
            abstraction=abstraction,
            case_noun=noun,
        )
        return {"caseTableId": table.id, **out}
