"""Bounded summaries of exact, complete activity sequences in the run's ordered log."""

from __future__ import annotations

import hashlib
import json
from statistics import median
from typing import Any

import pandas as pd
import wise


def process_variants(
    log: wise.EventLog, selected_ids: pd.Index, *, limit: int = 10, example_limit: int = 3
) -> dict[str, Any]:
    """Use EventLog's stable timestamp / mapped-order ordering without re-sorting or collapsing repeats.

    Selection comes from the scored frame, so zero-event cases remain in the denominator.
    Missing activity labels are retained as null steps. A duration is available only when
    every event has a timestamp; it describes the observed first-to-last span.
    """
    selected = {str(case_id) for case_id in selected_ids}
    events = log.events
    events = events.loc[
        events[log.case_col].astype(str).isin(selected), [log.case_col, log.activity_col, log.timestamp_col]
    ].copy()
    labels = events[log.activity_col].astype(str).astype(object)
    events[log.activity_col] = labels.where(events[log.activity_col].notna(), None)
    cases = events.groupby(log.case_col, sort=False, observed=True)
    sequences = cases[log.activity_col].agg(tuple)
    timestamps = cases[log.timestamp_col].agg(["min", "max", "count", "size"])
    durations = ((timestamps["max"] - timestamps["min"]).dt.total_seconds() / 3600).where(
        timestamps["count"] == timestamps["size"]
    )
    groups: dict[tuple[str | None, ...], dict[str, Any]] = {}
    for case_id, sequence, duration in zip(sequences.index, sequences, durations):
        row = groups.setdefault(sequence, {"count": 0, "durations": [], "examples": []})
        row["count"] += 1
        # Case ids are sorted as strings, independently of their dtype or source order.
        row["examples"] = sorted([*row["examples"], str(case_id)])[:example_limit]
        if pd.notna(duration):
            row["durations"].append(float(duration))

    def sequence_key(sequence: tuple[str | None, ...]) -> str:
        return json.dumps(sequence, ensure_ascii=False, separators=(",", ":"))

    ranked = sorted(groups.items(), key=lambda item: (-item[1]["count"], sequence_key(item[0])))[:limit]
    variants = [
        {
            "id": hashlib.sha256(sequence_key(sequence).encode()).hexdigest(),
            "activities": list(sequence),
            "count": row["count"],
            "share": row["count"] / len(selected),
            "medianDurationHours": median(row["durations"]) if row["durations"] else None,
            "durationCases": len(row["durations"]),
            "exampleCaseIds": row["examples"],
        }
        for sequence, row in ranked
    ]
    covered = sum(row["count"] for row in variants)
    tie = (
        f"mapped order column {log.order_col!r} (missing values first), then stable stored event order"
        if log.order_col
        else "stable stored event order"
    )
    return {
        "variants": variants,
        "totalSelectedCases": len(selected),
        "excludedZeroEventCases": len(selected) - len(sequences),
        "totalVariants": len(groups),
        "coveredCount": covered,
        "coverage": covered / len(selected) if selected else 0.0,
        "limit": limit,
        "exampleLimit": example_limit,
        "ordering": (
            f"Events follow timestamp order (missing timestamps last). Equal timestamps use {tie}. "
            "This recorded order does not establish business causality. Repeats and loops are retained."
        ),
        "durationDescription": (
            "Median observed first-to-last event span in hours, using cases with all timestamps present; "
            "descriptive elapsed time, not savings or active work time."
        ),
    }
