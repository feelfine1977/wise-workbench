"""Interpretable analytics on top of ``wise`` artefacts.

Every function takes ``wise`` objects (``EventLog``, ``Norm``,
``ScoreResult``, backlogs) and returns a frozen result with ``.table``
(DataFrame), ``.summary`` (dict), ``.record`` (provenance) and
``.readings`` (descriptive sentences). Nothing here estimates causal
effects; see ADR 0006.
"""

from ._version import __version__
from .contrast import SliceContrast, contrast_slice, raw_signals, signal_units
from .plain import KIND_RULE, comparison_sentence, comparisons, kind_reading, points_below, problem_kind, problem_kinds
from .provenance import AnalyticResult, Record, hash_frame, log_fingerprint, record
from .quality import (
    DEFAULT_THRESHOLDS,
    Caveat,
    ReadinessReport,
    activity_frequency_drift,
    caveats_by,
    caveats_for_slice,
    logging_asymmetry,
    readiness,
    vocabulary_drift,
)
from .subgroups import SubgroupTable, subgroups
from .synthetic import GroundTruth, Hotspot, generate, subsample_cases
from .uncertainty import STABILITY_RULE, BacklogUncertainty, RankStability, bootstrap_backlog, sensitivity_envelope
from .whatif import HeadroomTable, WhatIfResult, headroom, headroom_by, rescore_view, whatif_weights

__all__ = [
    "DEFAULT_THRESHOLDS",
    "KIND_RULE",
    "STABILITY_RULE",
    "AnalyticResult",
    "BacklogUncertainty",
    "Caveat",
    "GroundTruth",
    "HeadroomTable",
    "Hotspot",
    "RankStability",
    "ReadinessReport",
    "Record",
    "SliceContrast",
    "SubgroupTable",
    "WhatIfResult",
    "__version__",
    "activity_frequency_drift",
    "bootstrap_backlog",
    "caveats_by",
    "caveats_for_slice",
    "comparison_sentence",
    "comparisons",
    "contrast_slice",
    "generate",
    "hash_frame",
    "headroom",
    "headroom_by",
    "kind_reading",
    "log_fingerprint",
    "logging_asymmetry",
    "points_below",
    "problem_kind",
    "problem_kinds",
    "raw_signals",
    "readiness",
    "record",
    "rescore_view",
    "sensitivity_envelope",
    "signal_units",
    "subgroups",
    "subsample_cases",
    "vocabulary_drift",
    "whatif_weights",
]
