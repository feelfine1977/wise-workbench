"""Interpretable analytics on top of ``wise`` artefacts.

Every function takes ``wise`` objects (``EventLog``, ``Norm``,
``ScoreResult``, backlogs) and returns a frozen result with ``.table``
(DataFrame), ``.summary`` (dict), ``.record`` (provenance) and
``.readings`` (descriptive sentences). Nothing here estimates causal
effects; see ADR 0006.
"""

from ._version import __version__
from .contrast import SliceContrast, contrast_slice, raw_signals, signal_units
from .provenance import AnalyticResult, Record, hash_frame, log_fingerprint, record
from .quality import DEFAULT_THRESHOLDS, ReadinessReport, readiness, vocabulary_drift
from .synthetic import GroundTruth, Hotspot, generate, subsample_cases
from .uncertainty import STABILITY_RULE, BacklogUncertainty, RankStability, bootstrap_backlog, sensitivity_envelope
from .whatif import HeadroomTable, WhatIfResult, headroom, headroom_by, rescore_view, whatif_weights

__all__ = [
    "DEFAULT_THRESHOLDS",
    "STABILITY_RULE",
    "AnalyticResult",
    "BacklogUncertainty",
    "GroundTruth",
    "HeadroomTable",
    "Hotspot",
    "RankStability",
    "ReadinessReport",
    "Record",
    "SliceContrast",
    "WhatIfResult",
    "__version__",
    "bootstrap_backlog",
    "contrast_slice",
    "generate",
    "hash_frame",
    "headroom",
    "headroom_by",
    "log_fingerprint",
    "raw_signals",
    "readiness",
    "record",
    "rescore_view",
    "sensitivity_envelope",
    "signal_units",
    "subsample_cases",
    "vocabulary_drift",
    "whatif_weights",
]
