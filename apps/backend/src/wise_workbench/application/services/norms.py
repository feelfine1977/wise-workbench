"""Norm versions: immutable library documents with fingerprint, lineage and a note."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import guidance_complete
from wise_workbench.domain import CaseTableStatus, NormStatus, NormVersion, NotFoundError, ValidationError
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class NormService:
    def __init__(self, c: Container):
        self.c = c

    def create_version(
        self,
        project_id: str,
        document: dict[str, Any],
        note: str,
        parent_id: str | None = None,
        author: str | None = None,
    ) -> NormVersion:
        self.c.repos.get_project(project_id)
        if not isinstance(document, dict):
            raise ValidationError("norm must be a JSON object", code="norm.invalid")
        canonical, fingerprint = self.c.engine.validate_norm(document)
        parent: NormVersion | None = None
        if parent_id:
            parent = self.c.repos.get_norm_version(parent_id)
            if parent.project_id != project_id:
                raise NotFoundError(f"parent norm version {parent_id!r} not found in project", code="norm.not_found")
        norm_id = parent.norm_id if parent else new_id("norm")
        number = self.c.repos.next_norm_number(norm_id)
        version = NormVersion(
            id=new_id("nv"),
            project_id=project_id,
            norm_id=norm_id,
            version=number,
            fingerprint=fingerprint,
            document=canonical,
            status=NormStatus.DRAFT,
            note=note or "",
            author=author,
            parent_id=parent.id if parent else None,
            validation=(),
        )
        path = self.c.workspace.norm_version_path(project_id, norm_id, number)
        self.c.workspace.write_text(path, self.c.engine.norm_text(document))
        saved = self.c.repos.add_norm_version(version)
        # R1-08: warnings from Norm.check against the project's latest ready case table, when there is one
        tables = [t for t in self.c.repos.list_case_tables(project_id) if t.status == CaseTableStatus.READY]
        if tables:
            saved = self.refresh_warnings(saved, tables[-1].id)
        return saved

    def refresh_warnings(self, n: NormVersion, case_table_id: str) -> NormVersion:
        table = self.c.repos.get_case_table(case_table_id)
        mapping = self.c.repos.get_mapping(table.mapping_id)
        warnings = self.c.engine.norm_warnings(
            self.c.workspace.case_table_dir(n.project_id, table.id), mapping, n.document
        )
        updated = replace(n, validation=tuple(warnings))
        return self.c.repos.update_norm_validation(updated)

    def guidance_complete(self, n: NormVersion) -> bool:
        process = self.c.repos.get_project(n.project_id).process
        return guidance_complete(process, n.document)

    def get(self, project_id: str, norm_version_id: str) -> NormVersion:
        n = self.c.repos.get_norm_version(norm_version_id)
        if n.project_id != project_id:
            raise NotFoundError(
                f"norm version {norm_version_id!r} not found in project {project_id!r}", code="norm.not_found"
            )
        return n

    def list(self, project_id: str) -> list[NormVersion]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_norm_versions(project_id)

    def set_status(self, project_id: str, norm_version_id: str, status: NormStatus) -> NormVersion:
        n = self.get(project_id, norm_version_id).with_status(status)
        return self.c.repos.update_norm_status(n)

    def check(self, project_id: str, norm_version_id: str, case_table_id: str) -> dict[str, Any]:
        n = self.get(project_id, norm_version_id)
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        mapping = self.c.repos.get_mapping(table.mapping_id)
        out = self.c.engine.check_norm(self.c.workspace.case_table_dir(project_id, case_table_id), mapping, n.document)
        self.c.repos.update_norm_validation(replace(n, validation=tuple(str(i) for i in out.get("issues", []))))
        out["warnings"] = list(out.get("issues", []))
        return out
