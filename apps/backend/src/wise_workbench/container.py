"""Wiring: settings → workspace, database, repositories, engine, queue, services."""

from __future__ import annotations

from functools import cached_property

from wise_workbench.adapters.db import Database, Repositories, upgrade
from wise_workbench.adapters.engine import EngineAdapter
from wise_workbench.adapters.storage import Workspace
from wise_workbench.jobs.queue import JobQueue
from wise_workbench.logging import configure_logging
from wise_workbench.settings import Settings, load_settings


class Container:
    def __init__(self, settings: Settings | None = None, *, migrate: bool = True):
        self.settings = settings or load_settings()
        configure_logging(self.settings.log_format, self.settings.log_level)
        self.workspace = Workspace(self.settings.workspace_path)
        url = self.settings.resolved_database_url
        if migrate:
            upgrade(url)
        self.db = Database(url)
        self.repos = Repositories(self.db)
        self.engine = EngineAdapter(
            self.workspace, cache_size=self.settings.score_cache_size, sample_events=self.settings.mapping_sample_events
        )
        self.queue = JobQueue(self.repos, self.settings)

    @cached_property
    def projects(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.projects import ProjectService

        return ProjectService(self)

    @cached_property
    def datasets(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.datasets import DatasetService

        return DatasetService(self)

    @cached_property
    def mappings(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.mappings import MappingService

        return MappingService(self)

    @cached_property
    def norms(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.norms import NormService

        return NormService(self)

    @cached_property
    def runs(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.runs import RunService

        return RunService(self)

    @cached_property
    def presets(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.presets import PresetService

        return PresetService(self)

    @cached_property
    def jobs(self):  # type: ignore[no-untyped-def]
        from wise_workbench.application.services.jobs import JobService

        return JobService(self)

    def close(self) -> None:
        self.db.dispose()
