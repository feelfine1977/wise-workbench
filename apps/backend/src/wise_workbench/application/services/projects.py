"""Projects."""

from __future__ import annotations

from typing import TYPE_CHECKING

from wise_workbench.domain import Project
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class ProjectService:
    def __init__(self, c: Container):
        self.c = c

    def create(self, name: str, process: str | None = None, question: str | None = None) -> Project:
        project = Project(id=new_id("prj"), name=name.strip(), process=process or None, question=question or None)
        self.c.repos.add_project(project)
        self.c.workspace.project_dir(project.id).mkdir(parents=True, exist_ok=True)
        return project

    def get(self, project_id: str) -> Project:
        return self.c.repos.get_project(project_id)

    def list(self) -> list[Project]:
        return self.c.repos.list_projects()
