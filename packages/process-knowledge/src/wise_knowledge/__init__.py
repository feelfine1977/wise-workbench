"""Curated process knowledge for WISE Workbench.

The package reads the YAML/JSON resources shipped under ``wise_knowledge/data``
(one folder per process), validates them against the JSON Schemas in
``schema/``, returns typed dataclasses, builds the knowledge graph as node and
edge tables, and matches log activity labels to canonical activities.
"""

from __future__ import annotations

from .flow import stage_lanes
from .graph import KnowledgeGraph, build_graph
from .guidance import Hub, build_hub, embed_guidance, render_page, template_guidance
from .loaders import load_datasets, load_mapping, load_pack, load_preset
from .matching import Candidate, Matcher, MatchKey, ObservedActivity, normalise_label
from .models import (
    Activity,
    Dataset,
    DatasetRegistry,
    FailureMode,
    GlossaryTerm,
    Guidance,
    Kpi,
    LabelEntry,
    LabelPack,
    Pack,
    Playbook,
    Preset,
    Role,
    SliceKey,
    SlicingGuide,
    Stage,
    StageModel,
    TemplateEntry,
    Variant,
    WisePattern,
)
from .paths import available_packs, knowledge_root, pack_dir
from .schema import ValidationIssue, validate_datasets, validate_pack

__version__ = "0.1.0"

__all__ = [
    "Activity",
    "Candidate",
    "Dataset",
    "DatasetRegistry",
    "FailureMode",
    "GlossaryTerm",
    "Guidance",
    "Hub",
    "KnowledgeGraph",
    "Kpi",
    "LabelEntry",
    "LabelPack",
    "MatchKey",
    "Matcher",
    "ObservedActivity",
    "Pack",
    "Playbook",
    "Preset",
    "Role",
    "SliceKey",
    "SlicingGuide",
    "Stage",
    "StageModel",
    "TemplateEntry",
    "ValidationIssue",
    "Variant",
    "WisePattern",
    "__version__",
    "available_packs",
    "build_graph",
    "build_hub",
    "embed_guidance",
    "knowledge_root",
    "load_datasets",
    "load_mapping",
    "load_pack",
    "load_preset",
    "normalise_label",
    "pack_dir",
    "render_page",
    "stage_lanes",
    "template_guidance",
    "validate_datasets",
    "validate_pack",
]
