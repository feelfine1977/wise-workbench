"""Provenance records and the common result shape.

Every analytic returns a frozen dataclass derived from
:class:`AnalyticResult` with four parts:

* ``table`` — the numbers as a DataFrame (one row per slice, constraint,
  or check),
* ``summary`` — scalar facts as a plain dict (support, parameters, identity
  checks),
* ``record`` — a :class:`Record` naming the analytic, its version, the
  ``wise`` version, the fingerprints of the log and the norm, the
  parameters, the hash of the table, and any warnings,
* ``readings`` — template sentences in the descriptive vocabulary of
  :mod:`wise_analytics.vocabulary`.

Records are pure functions of their inputs: the same log, norm and
parameters give the same ``record_id``. Timing is stored beside the record
(``runtime_s``) but never enters the id, so records stay reproducible
bit-for-bit.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

import numpy as np
import pandas as pd
import wise

from ._version import __version__


# ----------------------------------------------------------------------------- hashing
def _jsonable(obj: Any) -> Any:
    if isinstance(obj, Mapping):
        return {str(k): _jsonable(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, list | tuple | set | frozenset):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return [_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, pd.Timestamp | pd.Timedelta):
        return str(obj)
    if isinstance(obj, pd.Series):
        return {"series": _jsonable(obj.to_dict())}
    if isinstance(obj, float) and not np.isfinite(obj):
        return str(obj)
    if isinstance(obj, str | int | float | bool) or obj is None:
        return obj
    return repr(obj)


def canonical_json(obj: Any) -> str:
    """Deterministic JSON text (sorted keys, no whitespace) of a parameter mapping."""
    return json.dumps(_jsonable(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_frame(df: pd.DataFrame) -> str:
    """Content hash of a DataFrame: index, column names, dtypes and values.

    Uses :func:`pandas.util.hash_pandas_object`, whose per-row hashes are
    deterministic across processes; floats hash by their exact bits.
    """
    header = canonical_json(
        {
            "columns": [str(c) for c in df.columns],
            "dtypes": [str(t) for t in df.dtypes],
            "index_names": [str(n) for n in df.index.names],
            "shape": list(df.shape),
        }
    )
    h = hashlib.sha256(header.encode("utf-8"))
    if len(df):
        body = df.reset_index(drop=False) if df.index.names != [None] else df
        rows = pd.util.hash_pandas_object(body.astype(object) if body.empty else body, index=True).to_numpy(dtype=np.uint64)
        h.update(rows.tobytes())
    return h.hexdigest()


def log_fingerprint(log: wise.EventLog) -> str:
    """Content fingerprint of an :class:`wise.EventLog`.

    Hashes the core event columns (case, activity, timestamp), the declared
    case attributes and the exposure column, plus the column mapping, the
    explicit window and the event count. Two logs built from the same rows
    with the same mapping share a fingerprint; a different attribute list
    or window gives a different one.
    """
    cols = [log.case_col, log.activity_col, log.timestamp_col, *log.case_attributes]
    if log.exposure_col is not None:
        cols.append(log.exposure_col)
    if log.event_id_col is not None:
        cols.append(log.event_id_col)
    cols = [c for c in dict.fromkeys(cols) if c in log.events.columns]
    header = canonical_json(
        {
            "case_col": log.case_col,
            "activity_col": log.activity_col,
            "timestamp_col": log.timestamp_col,
            "case_attributes": list(log.case_attributes),
            "exposure_col": log.exposure_col,
            "window": [str(w) for w in log.window] if log.window else None,
            "n_events": len(log.events),
            "n_cases": len(log),
        }
    )
    h = hashlib.sha256(header.encode("utf-8"))
    ev = log.events[cols]
    rows = pd.util.hash_pandas_object(ev, index=False).to_numpy(dtype=np.uint64)
    h.update(rows.tobytes())
    return h.hexdigest()


def result_fingerprints(result: wise.ScoreResult) -> tuple[str | None, str]:
    """``(log_fingerprint, norm_fingerprint)`` of a score result; the log
    fingerprint is ``None`` when no log is attached."""
    lf = log_fingerprint(result.log) if result.log is not None else None
    nf = result.norm_fingerprint or result.norm.fingerprint()
    return lf, nf


# ----------------------------------------------------------------------------- record
@dataclass(frozen=True)
class Record:
    """Provenance of one analytic result (append-only, reproducible).

    ``record_id`` is the SHA-256 of the canonical JSON of every field
    except ``runtime_s`` and ``record_id`` itself.
    """

    analytic: str
    version: str
    wise_version: str
    package_version: str
    log_fingerprint: str | None
    norm_fingerprint: str | None
    params: Mapping[str, Any]
    output_hash: str
    warnings: tuple[str, ...] = ()
    runtime_s: float | None = None
    record_id: str = field(default="", compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "params", MappingProxyType(dict(self.params)))
        object.__setattr__(self, "warnings", tuple(str(w) for w in self.warnings))
        object.__setattr__(self, "record_id", sha256_text(canonical_json(self._identity())))

    def _identity(self) -> dict[str, Any]:
        return {
            "analytic": self.analytic,
            "version": self.version,
            "wise_version": self.wise_version,
            "package_version": self.package_version,
            "log_fingerprint": self.log_fingerprint,
            "norm_fingerprint": self.norm_fingerprint,
            "params": dict(self.params),
            "output_hash": self.output_hash,
            "warnings": list(self.warnings),
        }

    def to_dict(self) -> dict[str, Any]:
        d = self._identity()
        d["runtime_s"] = self.runtime_s
        d["record_id"] = self.record_id
        return _jsonable(d)

    def to_json(self, indent: int | None = None) -> str:
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True, ensure_ascii=False)

    def cite(self) -> str:
        """Short citation for generated text: ``analytic@version#id[:12]``."""
        return f"{self.analytic}@{self.version}#{self.record_id[:12]}"


def record(
    analytic: str,
    version: str,
    *,
    table: pd.DataFrame,
    params: Mapping[str, Any],
    log_fingerprint: str | None = None,
    norm_fingerprint: str | None = None,
    warnings: tuple[str, ...] | list[str] = (),
    runtime_s: float | None = None,
) -> Record:
    """Build a :class:`Record` for ``table`` produced by ``analytic``."""
    return Record(
        analytic=analytic,
        version=version,
        wise_version=wise.__version__,
        package_version=__version__,
        log_fingerprint=log_fingerprint,
        norm_fingerprint=norm_fingerprint,
        params=dict(params),
        output_hash=hash_frame(table),
        warnings=tuple(warnings),
        runtime_s=runtime_s,
    )


@dataclass(frozen=True)
class AnalyticResult:
    """Common shape of every analytic result (see the module docstring)."""

    table: pd.DataFrame
    summary: Mapping[str, Any]
    record: Record
    readings: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "summary", MappingProxyType(dict(self.summary)))
        object.__setattr__(self, "readings", tuple(self.readings))

    def __repr__(self) -> str:
        return f"{type(self).__name__}(table={self.table.shape}, record={self.record.cite()}, readings={len(self.readings)})"


__all__ = [
    "AnalyticResult",
    "Record",
    "canonical_json",
    "hash_frame",
    "log_fingerprint",
    "record",
    "result_fingerprints",
    "sha256_text",
]
