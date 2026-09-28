"""Bounded, descriptive evidence from the prepared events of selected whole cases."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import pyarrow.parquet as pq

from wise_workbench.domain import NotFoundError, ValidationError

from .eda_insights import _category_expr, _quote, _rows

if TYPE_CHECKING:
    from wise_workbench.api.schema_models.eda import EDARequest
    from wise_workbench.domain import ColumnMapping

PAIR_RULE = (
    "Exactly one occurrence of each distinct endpoint activity per case; both timestamps known; "
    "end timestamp at or after start. Missing activities are classified first. Among cases with both activities, repeated endpoints are ambiguous and excluded, including lifecycle records. "
    "Elapsed calendar days; no business completion or active time is inferred."
)


def event_evidence(con, path: Path, mapping: ColumnMapping, request: EDARequest) -> dict[str, Any]:
    if not path.is_file():
        raise NotFoundError("Prepared event evidence is missing; rebuild the case table", code="eda.events_missing")
    schema = pq.read_schema(path)
    if not {mapping.case_id, mapping.activity, mapping.timestamp} <= set(schema.names):
        raise ValidationError("Prepared events lack mapped evidence columns", code="eda.events_schema")
    if request.traceCaseId is not None:
        found = con.execute(
            "SELECT count(*) FROM marked WHERE selected AND case_id = ?", [request.traceCaseId]
        ).fetchone()[0]
        if found != 1:
            raise NotFoundError("This case is outside the current selection", code="eda.trace_scope")
    con.read_parquet(str(path), file_row_number=True).create_view("event_source")
    activity = _category_expr(f"e.{_quote(mapping.activity)}", mapping)
    lifecycle = (
        f"CAST(e.{_quote(mapping.lifecycle)} AS VARCHAR)"
        if mapping.lifecycle is not None and mapping.lifecycle in schema.names
        else "NULL::VARCHAR"
    )
    resource = (
        f"CAST(e.{_quote(mapping.resource)} AS VARCHAR)"
        if mapping.resource is not None and mapping.resource in schema.names
        else "NULL::VARCHAR"
    )
    order = (
        f"e.{_quote(mapping.order)}"
        if mapping.order is not None and mapping.order in schema.names
        else "e.file_row_number"
    )
    con.execute(f"""CREATE TEMP TABLE evidence_events AS SELECT m.case_id, {activity} AS activity,
        e.{_quote(mapping.timestamp)} AS ts, {lifecycle} AS lifecycle, {resource} AS resource,
        {order} AS mapped_order, e.file_row_number AS source_row
        FROM event_source e JOIN marked m ON CAST(e.{_quote(mapping.case_id)} AS VARCHAR) = m.case_id
        WHERE m.selected""")
    eligible = con.execute("SELECT count(*) FROM marked WHERE selected").fetchone()[0]
    totals = _rows(
        con,
        """SELECT count(*) AS recordedEvents, count(DISTINCT case_id) AS casesWithEvents,
        count(*) FILTER (WHERE activity IS NULL) AS missingActivityEvents,
        count(*) FILTER (WHERE ts IS NULL) AS undatedEvents FROM evidence_events""",
    )[0]
    con.execute(f"""CREATE TEMP TABLE activity_domain AS
        SELECT {activity} AS activity, count(*) AS all_occurrences FROM event_source e
        JOIN marked m ON CAST(e.{_quote(mapping.case_id)} AS VARCHAR) = m.case_id
        GROUP BY activity""")
    con.execute("""CREATE TEMP TABLE activity_cases AS
        SELECT activity, case_id, count(*) AS n FROM evidence_events GROUP BY activity, case_id""")
    search = "contains(lower(coalesce(activity, 'Unknown / missing')), lower(?))"
    activity_total = con.execute(
        f"SELECT count(*) FROM activity_domain WHERE {search}", [request.activitySearch]
    ).fetchone()[0]
    activities = _rows(
        con,
        f"""SELECT activity, occurrences, cases, repeatedCases FROM (
        SELECT d.activity, CAST(coalesce(sum(c.n), 0) AS BIGINT) AS occurrences,
            count(c.case_id) AS cases, count(*) FILTER (WHERE c.n >= 2) AS repeatedCases, d.all_occurrences
        FROM activity_domain d LEFT JOIN activity_cases c ON d.activity IS NOT DISTINCT FROM c.activity
        GROUP BY d.activity, d.all_occurrences) WHERE {search}
        ORDER BY all_occurrences DESC, activity NULLS LAST LIMIT 40 OFFSET ?""",
        [request.activitySearch, (request.activityPage - 1) * 40],
    )
    for row in activities:
        row.update(
            zeroCases=eligible - row["cases"],
            presenceRate=row["cases"] / eligible if eligible else None,
            repetitionRate=row["repeatedCases"] / eligible if eligible else None,
        )
    endpoints = None
    if request.endpointStart is not None:
        observed = {
            row[0]
            for row in con.execute(
                "SELECT activity FROM activity_domain WHERE activity IN (?, ?)",
                [request.endpointStart, request.endpointEnd],
            ).fetchall()
        }
        if not {request.endpointStart, request.endpointEnd} <= observed:
            raise ValidationError(
                "Choose exact endpoint activity names present in the prepared log", code="eda.endpoint_activity"
            )
        con.execute(
            """CREATE TEMP TABLE endpoint_counts AS SELECT m.case_id,
            count(*) FILTER (WHERE e.activity = ?) AS starts,
            count(*) FILTER (WHERE e.activity = ?) AS ends,
            min(ts) FILTER (WHERE e.activity = ?) AS start_ts,
            min(ts) FILTER (WHERE e.activity = ?) AS end_ts
            FROM marked m LEFT JOIN evidence_events e ON m.case_id = e.case_id WHERE m.selected GROUP BY m.case_id""",
            [request.endpointStart, request.endpointEnd, request.endpointStart, request.endpointEnd],
        )
        con.execute("""CREATE TEMP TABLE endpoint_pairs AS SELECT *,
            CASE WHEN starts = 0 AND ends = 0 THEN 'neither'
                 WHEN starts > 0 AND ends = 0 THEN 'startOnly'
                 WHEN starts = 0 AND ends > 0 THEN 'endOnly'
                 WHEN starts > 1 OR ends > 1 THEN 'ambiguous'
                 WHEN start_ts IS NULL OR end_ts IS NULL THEN 'undatedEndpoint'
                 WHEN end_ts < start_ts THEN 'reversed' ELSE 'paired' END AS status
            FROM endpoint_counts""")
        counts = {
            row["status"]: row["n"]
            for row in _rows(con, "SELECT status, count(*) AS n FROM endpoint_pairs GROUP BY status")
        }
        duration = _rows(
            con,
            """SELECT median(epoch(end_ts - start_ts) / 86400.0) AS medianDays,
            quantile_cont(epoch(end_ts - start_ts) / 86400.0, .9) AS p90Days FROM endpoint_pairs WHERE status = 'paired'""",
        )[0]
        endpoints = {
            "startActivity": request.endpointStart,
            "endActivity": request.endpointEnd,
            "eligibleCases": eligible,
            "rule": PAIR_RULE,
            **duration,
            **{
                f"{key}Cases": counts.get(key, 0)
                for key in ("paired", "startOnly", "endOnly", "neither", "undatedEndpoint", "reversed", "ambiguous")
            },
        }
    trace = None
    if request.traceCaseId is not None:
        count = _rows(
            con,
            "SELECT count(*) AS total, count(*) FILTER (WHERE ts IS NULL) AS undated FROM evidence_events WHERE case_id = ?",
            [request.traceCaseId],
        )[0]
        events = _rows(
            con,
            """SELECT position, activity, CAST(ts AS VARCHAR) AS timestamp, lifecycle, resource,
            (ts IS NOT NULL AND tied > 1) AS timestampTied FROM (
                SELECT *, row_number() OVER (ORDER BY ts NULLS LAST, mapped_order NULLS LAST, source_row) AS position,
                    count(*) OVER (PARTITION BY ts) AS tied
                FROM evidence_events WHERE case_id = ?)
            ORDER BY position LIMIT 100 OFFSET ?""",
            [request.traceCaseId, (request.tracePage - 1) * 100],
        )
        pair = (
            _rows(
                con,
                "SELECT status, CASE WHEN status = 'paired' THEN epoch(end_ts - start_ts) / 86400.0 END AS days FROM endpoint_pairs WHERE case_id = ?",
                [request.traceCaseId],
            )[0]
            if endpoints
            else None
        )
        trace = {
            "caseId": request.traceCaseId,
            "page": request.tracePage,
            "pageSize": 100,
            "total": count["total"],
            "undatedEvents": count["undated"],
            "events": events,
            "endpointStatus": pair["status"] if pair else None,
            "endpointDays": pair["days"] if pair else None,
        }
    return {
        "eligibleCases": eligible,
        "recordedEvents": totals["recordedEvents"],
        "casesWithoutEvents": eligible - totals["casesWithEvents"],
        "missingActivityEvents": totals["missingActivityEvents"],
        "undatedEvents": totals["undatedEvents"],
        "activityPage": request.activityPage,
        "activityPageSize": 40,
        "totalActivities": activity_total,
        "activities": activities,
        "endpoints": endpoints,
        "trace": trace,
        "notes": [
            "Activity occurrences count prepared event rows; cases and repeated cases count distinct selected case IDs. Both rates use every selected case, including cases with zero occurrences. Repetition means at least two records, not verified rework.",
            "Activity domains come from all prepared cases, so an activity absent in the selection has zero occurrences. Activity search changes the displayed activity list only; it does not change eligible cases or the linked selection.",
            "Endpoint coverage partitions every selected case. Start-only/end-only cases have an unobserved endpoint and may reflect censoring, incomplete logging or a different route; censoring cannot be established from this log alone. Neither is not a zero duration.",
            "Traces are ordered by timestamp, mapped order when available, then prepared file row for stable ties. Equal timestamps do not establish business sequence. Undated records appear last and retain unknown chronology.",
        ],
    }
