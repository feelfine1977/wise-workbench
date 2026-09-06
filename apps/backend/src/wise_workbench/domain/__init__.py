"""Entities, value objects, state machines and invariants. Pure Python: no I/O, no library imports."""

from .case_table import (
    ActivityCount,
    CaseTable,
    CaseTableStatus,
    Readiness,
    ReadinessItem,
    ReadinessLevel,
    ReadinessStatus,
)
from .dataset import ColumnProfile, DatasetStatus, DatasetVersion, SourceKind
from .errors import ConflictError, DomainError, InvalidTransitionError, NotFoundError, ValidationError
from .job import FINAL_STATUSES, Job, JobKind, JobStatus
from .mapping import FLOW_TYPE_ATTRIBUTE, HEADER_EVENT_COUNT, ColumnMapping, FlowTypingRule
from .norm import NormStatus, NormVersion
from .project import Project, utcnow
from .run import Run, RunManifest, RunParams, RunStatus, Slicing, slicing_id

__all__ = [
    "FINAL_STATUSES",
    "FLOW_TYPE_ATTRIBUTE",
    "HEADER_EVENT_COUNT",
    "ActivityCount",
    "CaseTable",
    "CaseTableStatus",
    "ColumnMapping",
    "ColumnProfile",
    "ConflictError",
    "DatasetStatus",
    "DatasetVersion",
    "DomainError",
    "FlowTypingRule",
    "InvalidTransitionError",
    "Job",
    "JobKind",
    "JobStatus",
    "NormStatus",
    "NormVersion",
    "NotFoundError",
    "Project",
    "Readiness",
    "ReadinessItem",
    "ReadinessLevel",
    "ReadinessStatus",
    "Run",
    "RunManifest",
    "RunParams",
    "RunStatus",
    "Slicing",
    "SourceKind",
    "ValidationError",
    "slicing_id",
    "utcnow",
]
