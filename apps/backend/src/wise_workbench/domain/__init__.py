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
from .decision import DECISION_KINDS, Decision, DecisionPreview, validate_decision
from .errors import ConflictError, DomainError, InvalidTransitionError, NotFoundError, ValidationError
from .job import FINAL_STATUSES, Job, JobKind, JobStatus
from .mapping import FLOW_TYPE_ATTRIBUTE, HEADER_EVENT_COUNT, ColumnMapping, FlowTypingRule
from .norm import NormStatus, NormVersion
from .notebook import Snapshot
from .project import Project, utcnow
from .run import Run, RunManifest, RunParams, RunStatus, Slicing, slicing_id, validate_scope

__all__ = [
    "DECISION_KINDS",
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
    "Decision",
    "DecisionPreview",
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
    "Snapshot",
    "SourceKind",
    "ValidationError",
    "slicing_id",
    "utcnow",
    "validate_decision",
    "validate_scope",
]
