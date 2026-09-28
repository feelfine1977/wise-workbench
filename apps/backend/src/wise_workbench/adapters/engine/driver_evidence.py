"""Observed endpoint rows and unambiguous case durations, independent of scoring policy."""

import json
from typing import Any, cast

import pandas as pd
import wise


def solution_card_metadata(process: str | None, constraint: dict[str, Any]) -> dict[str, Any] | None:
    """Bind a curated recipe only while the saved rule retains its endpoint meaning.

    IDs survive edits. Exact curated mappings may resolve raw labels to canonical
    activities; fuzzy guesses must never preserve a specialised business claim.
    """
    from wise_knowledge.solution_cards import load_solution_cards, solution_card_for

    catalogue = load_solution_cards()
    selected = solution_card_for(process, constraint, catalogue=catalogue)
    if selected is None:
        return None
    recipe = next(card for card in catalogue["cards"] if card["id"] == selected["id"])
    if "constraintIds" not in recipe["match"] or _template_endpoints_match(process, constraint):
        return selected
    generic = {**catalogue, "cards": [card for card in catalogue["cards"] if "constraintIds" not in card["match"]]}
    return solution_card_for(process, constraint, catalogue=generic)


def _template_endpoints_match(process: str | None, constraint: dict[str, Any]) -> bool:
    from wise_knowledge import available_packs

    from wise_workbench.adapters.knowledge import _load

    if process not in available_packs():
        return False
    # Reuse the bridge's bounded set of installed packs, including its validation
    # status. A partially edited or invalid pack must not authorize a special title.
    loaded = _load(str(process))
    if loaded is None or not loaded[2]:
        return False
    pack = loaded[0]
    bindings: dict[str, set[str]] = {activity.id: {activity.id} for activity in pack.activities}
    entries = [entry for mapping in pack.mappings.values() for entry in mapping.entries]
    entries.extend(entry for labels in pack.label_packs.values() for entry in labels.labels)
    for entry in entries:
        # Conditional label definitions need more context than an endpoint label.
        if any((entry.lifecycle, entry.document_type, entry.subprocess, entry.tcode)):
            continue
        bindings.setdefault(entry.label, set()).add(entry.activity)

    def labels(value: Any) -> set[str]:
        return {value} if isinstance(value, str) else set(value or [])

    def same_meaning(actual: Any, expected: Any) -> bool:
        actual_labels, expected_labels = labels(actual), labels(expected)
        if actual_labels == expected_labels:
            return True
        if any(len(bindings.get(label, set())) != 1 for label in actual_labels | expected_labels):
            return False
        return {next(iter(bindings[label])) for label in actual_labels} == {
            next(iter(bindings[label])) for label in expected_labels
        }

    for template in pack.templates:
        if template.path is None or not template.path.is_file():
            continue
        try:
            document = json.loads(template.path.read_text())
        except (OSError, ValueError):
            continue
        for reference in document.get("constraints", []):
            if reference.get("id") != constraint.get("id") or reference.get("type") != constraint.get("type"):
                continue
            if all(
                same_meaning(constraint.get("params", {}).get(key), reference.get("params", {}).get(key))
                for key in ("a", "b", "activity", "after", "before", "activities_x", "activities_y")
            ):
                return True
    return False


def temporal_evidence(
    log: wise.EventLog, selected_ids: pd.Index, constraint: wise.NormConstraint, header_labels: tuple[str, ...]
) -> dict[str, Any]:
    events = log.events.loc[
        log.events[log.case_col].isin(selected_ids), [log.case_col, log.activity_col, log.timestamp_col]
    ]
    caveats = [
        "Population: every selected case in the run, group and optional filter; rule applicability is not applied. The view is context only.",
        "These descriptive counts and unique-endpoint durations do not reproduce norm scoring pairs or scored violation percentages.",
        "Day buckets count recorded event rows and distinct cases, not payments, invoices or payment-batch sizes. A case can occur in several buckets.",
        "Day counts are not calendar-exposure adjusted: day 31 has fewer opportunities. Monthly representation alone does not establish payment-run scheduling.",
        "Elapsed duration is not work time, savings or evidence of causality. No overdue, discount or goodwill conclusion is inferred.",
    ]
    result: dict[str, Any] = {
        "status": "available",
        "reason": None,
        "selectedEvents": len(events),
        "activityCoverage": None,
        "endpoints": None,
        "endDayOfMonth": None,
        "duration": None,
        "dueDate": {
            "status": "unavailable",
            "reason": "A validated invoice payment due-date mapping and item-to-invoice linkage are not available. Delivery dates and norm thresholds cannot substitute for invoice payment due dates.",
        },
        "caveats": caveats,
    }
    c = constraint.constraint
    coverage_labels = (
        c.b
        if isinstance(c, (wise.Lag, wise.Precedence))
        else c.activity
        if isinstance(c, (wise.Presence, wise.Exclusion, wise.Singularity))
        else None
    )
    if coverage_labels is not None:
        rows = events.loc[events[log.activity_col].isin(coverage_labels)]
        counts = rows.groupby(log.case_col, observed=True).size().reindex(selected_ids, fill_value=0)
        result["activityCoverage"] = {
            "labels": list(coverage_labels),
            "observedLabels": sorted(str(v) for v in rows[log.activity_col].dropna().unique()),
            "mappedHeaderLabels": [label for label in coverage_labels if label in header_labels],
            "eventCount": len(rows),
            "caseCount": int((counts > 0).sum()),
            "missingTimestampEvents": int(rows[log.timestamp_col].isna().sum()),
            "selectedCases": len(selected_ids),
            "casesWithActivity": int((counts > 0).sum()),
            "casesWithoutActivity": int((counts == 0).sum()),
            "singleOccurrenceCases": int((counts == 1).sum()),
            "repeatedOccurrenceCases": int((counts > 1).sum()),
        }
        caveats.append(
            "Activity coverage counts all rows matching the declared labels within selected cases; norm applicability, thresholds and before/after anchors are not applied. Absence is not proof a business activity never happened."
        )
        if result["activityCoverage"]["mappedHeaderLabels"]:
            caveats.append(
                "Mapped header activities may be replicated across item traces. Recorded rows and distinct items are not distinct business transactions."
            )
    if not isinstance(c, (wise.Lag, wise.Precedence)):
        if coverage_labels is None:
            result.update(
                status="unavailable", reason="No supported evidence recipe is available for this expectation type."
            )
        elif not len(selected_ids):
            result.update(status="unavailable", reason="No cases remain in this exact group and filter within the run.")
        return result
    endpoint_frames = []
    endpoints = {}
    for role, labels in (("start", c.a), ("end", c.b)):
        rows = events.loc[events[log.activity_col].isin(labels)]
        endpoint_frames.append(rows)
        endpoints[role] = {
            "labels": list(labels),
            "observedLabels": sorted(str(v) for v in rows[log.activity_col].dropna().unique()),
            "mappedHeaderLabels": [label for label in labels if label in header_labels],
            "eventCount": len(rows),
            "caseCount": int(rows[log.case_col].nunique()),
            "missingTimestampEvents": int(rows[log.timestamp_col].isna().sum()),
        }
    result["endpoints"] = endpoints
    if endpoints["start"]["mappedHeaderLabels"] and not endpoints["end"]["mappedHeaderLabels"]:
        caveats.append(
            "Mapped header activities may be replicated across item traces. Recorded rows and distinct items are not distinct business transactions."
        )
    start, end = endpoint_frames
    dated = end.loc[end[log.timestamp_col].notna()].copy()
    dated["_day"] = dated[log.timestamp_col].dt.day
    dated["_month"] = dated[log.timestamp_col].dt.strftime("%Y-%m")
    day_groups = dated.groupby("_day", observed=True).agg(
        eventCount=(log.case_col, "size"), caseCount=(log.case_col, "nunique"), monthsPresent=("_month", "nunique")
    )
    buckets = [
        {
            "day": day,
            **{
                k: int(cast(Any, day_groups.loc[day, k])) if day in day_groups.index else 0
                for k in ("eventCount", "caseCount", "monthsPresent")
            },
        }
        for day in range(1, 32)
    ]
    timezone = getattr(events[log.timestamp_col].dtype, "tz", None)
    result["endDayOfMonth"] = {
        "buckets": buckets,
        "eventCount": len(end),
        "caseCount": endpoints["end"]["caseCount"],
        "datedEventCount": len(dated),
        "datedCaseCount": int(dated[log.case_col].nunique()),
        "missingTimestampEvents": endpoints["end"]["missingTimestampEvents"],
        "firstTimestamp": dated[log.timestamp_col].min().isoformat() if len(dated) else None,
        "lastTimestamp": dated[log.timestamp_col].max().isoformat() if len(dated) else None,
        "representedMonths": int(dated["_month"].nunique()),
        "topDay": max(buckets, key=lambda row: row["eventCount"]) if len(dated) else None,
        "timezone": str(timezone) if timezone is not None else None,
        "calendarExposureAdjusted": False,
    }
    if timezone is None:
        caveats.append("Source timestamps have no established timezone; calendar days use their stored clock values.")

    if set(c.a) & set(c.b):
        caveats.append(
            "Start and end activity labels overlap, so one record could act as both endpoints. Duration evidence is unavailable without a distinct-event pairing rule."
        )
        if not len(selected_ids):
            result.update(status="unavailable", reason="No cases remain in this exact group and filter within the run.")
        return result

    def grouped(rows: pd.DataFrame) -> pd.DataFrame:
        return (
            rows.groupby(log.case_col, observed=True)[log.timestamp_col]
            .agg(["size", "min", "max"])
            .reindex(selected_ids)
        )

    a, b = grouped(start), grouped(end)
    na, nb = a["size"].fillna(0), b["size"].fillna(0)
    both = (na > 0) & (nb > 0)
    unique = (na == 1) & (nb == 1)
    known = a["min"].notna() & b["min"].notna()
    delta = (b["min"] - a["min"]).dt.total_seconds() / 86400
    valid_unique = unique & known
    ordered, tied, reversed_ = valid_unique & (delta > 0), valid_unique & (delta == 0), valid_unique & (delta < 0)
    pairs = delta[ordered | tied]
    partitions = {
        "neitherEndpointCases": int(((na == 0) & (nb == 0)).sum()),
        "missingStartOnlyCases": int(((na == 0) & (nb > 0)).sum()),
        "missingEndOnlyCases": int(((na > 0) & (nb == 0)).sum()),
        "repeatedEndpointCases": int((both & ((na > 1) | (nb > 1))).sum()),
        "missingTimestampCases": int((unique & ~known).sum()),
        "reversedCases": int(reversed_.sum()),
        "tiedCases": int(tied.sum()),
        "orderedCases": int(ordered.sum()),
    }
    result["duration"] = {
        "status": "available" if len(pairs) else "unavailable",
        "reason": None if len(pairs) else "No cases have exactly one dated start and end in nonnegative order.",
        "pairing": "unique_endpoints",
        "unit": "days",
        "pairedCases": len(pairs),
        "median": float(pairs.median()) if len(pairs) else None,
        "p90": float(pairs.quantile(0.9)) if len(pairs) else None,
        "partitions": partitions,
        "ordering": {
            "casesWithKnownEndpointTimes": int(known.sum()),
            "firstEndBeforeFirstStartCases": int((known & (b["min"] < a["min"])).sum()),
            "allDatedEndsBeforeFirstStartCases": int((known & (b["max"] < a["min"])).sum()),
        },
    }
    caveats.append(
        "Duration partitions are exclusive: missing endpoints first, then repeated endpoints among cases with both, then missing timestamps, reversed, tied and ordered unique pairs. Ties contribute zero days; repeats and reversed pairs are excluded from median/p90."
    )
    caveats.append(
        "Ordering diagnostics include repeated endpoints and compare dated first/last occurrences only; an undated event cannot establish order."
    )
    if not len(selected_ids):
        result.update(status="unavailable", reason="No cases remain in this exact group and filter within the run.")
    return result
