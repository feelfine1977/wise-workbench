"""Read-only linked EDA over prepared cases, with opt-in prepared event evidence.

DuckDB performs projection, selection, aggregation and pagination on the server. The
same selected flag feeds every view. Domains are anchored to the whole case table,
so clicking a bar never moves its boundary or changes what 'Other' means.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import TYPE_CHECKING, Any

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from wise_workbench.adapters.engine.cache import LRUCache
from wise_workbench.adapters.engine.filters import parse_filter
from wise_workbench.api.schema_models.eda import EDARequest, EDASelection
from wise_workbench.domain import CaseTableStatus, NotFoundError, ValidationError

from .eda_insights import (
    CategoryDomain,
    _category_expr,
    _quote,
    _rows,
    _text,
    aggregate_insights,
    choose_comparison,
    hierarchy_counts,
    parse_selection,
    prepare_domains,
    selection_extensions,
    validate_field,
    value_page,
)

if TYPE_CHECKING:
    from wise_workbench.container import Container
    from wise_workbench.domain import ColumnMapping

_ANSWERS: LRUCache[dict[str, Any]] = LRUCache(64)
MAX_ATTRIBUTES = 128
MAX_PERIODS = 120
# Fixed interpretable day ranges conserve zero, boundaries and the unbounded tail.
SPAN_CUTS = (0.0, 1.0, 3.0, 7.0, 14.0, 30.0, 60.0, 90.0, 180.0, 365.0)


def _iso(value: Any) -> str | None:
    return None if value is None or pd.isna(value) else pd.Timestamp(value).isoformat()


def _selection(
    request: EDARequest,
    attributes: dict[str, str],
    category_keys: set[str],
    selection: EDASelection,
    domains: dict[str, CategoryDomain],
    mapping: ColumnMapping,
    schema: pa.Schema,
) -> tuple[str, list[Any]]:
    predicates: list[str] = []
    values: list[Any] = []
    parsed = parse_filter(request.filter)
    for clause in (parsed or {}).get("and", []):
        kind = clause["kind"]
        if kind == "time":
            field = clause.get("field", "case_start")
            column = "first_recorded" if field in ("case_start", "first_ts", "start") else "last_recorded"
            for bound, operator in (("from", ">="), ("to", "<=")):
                if bound in clause:
                    predicates.append(f"epoch_ns({column}) {operator} ?")
                    # Timestamp.value normalizes offset timestamps to UTC; naive
                    # timestamps retain the mapped clock convention, as in filters.py.
                    values.append(pd.Timestamp(clause[bound]).value)
        elif kind == "attribute":
            field = clause["field"]
            if field not in attributes:
                raise ValidationError(f"Unknown EDA case attribute {field!r}", code="filter.attribute")
            column = attributes[field]
            if "eq" in clause:
                predicates.append(f"({_text(column)}) = ?")
                values.append(str(clause["eq"]))
            elif "in" in clause:
                wanted = [str(x) for x in clause["in"]]
                placeholders = ",".join("?" for _ in wanted)
                pred = f"({_text(column)}) IN ({placeholders})"
                if any(x in ("(missing)", "") for x in wanted):
                    pred = f"({pred} OR {column} IS NULL)"
                predicates.append(pred)
                values.extend(wanted)
            else:
                for bound, operator in (("min", ">="), ("max", "<=")):
                    if clause.get(bound) is not None:
                        number = f"CASE WHEN ({_category_expr(column, mapping)}) IS NULL THEN NULL ELSE TRY_CAST({column} AS DOUBLE) END"
                        predicates.append(f"({number}) {operator} ?")
                        values.append(clause[bound])
        else:
            raise ValidationError(
                "Pre-norm EDA supports case attribute and case-start/end time filters only.", code="filter.unsupported"
            )
    if request.categoryMode:
        if not attributes:
            raise ValidationError("There is no category attribute to filter", code="filter.attribute")
        predicates.append("category IS NULL" if request.categoryMode == "missing" else "category_key = 'other'")
    if request.timeMissing:
        predicates.append("first_recorded IS NULL")
    if request.spanMissing:
        predicates.append("span_days IS NULL")
    for value, operator in ((request.spanMin, ">="), (request.spanMax, "<")):
        if value is not None:
            predicates.append(f"span_days {operator} ?")
            values.append(value)
    if request.selection is not None:
        if selection.categoryKeys is not None:
            if not attributes or not set(selection.categoryKeys) <= category_keys:
                raise ValidationError(
                    "Select category keys returned for this case table and attribute.", code="eda.category"
                )
            predicates.append("category_key IN (" + ",".join("?" for _ in selection.categoryKeys) + ")")
            values.extend(selection.categoryKeys)
        time_choices = ["first_recorded IS NULL"] if selection.timeMissing else []
        for period in selection.timeRanges or []:
            bounds: list[str] = []
            stamps: list[int] = []
            for time_value, operator in ((period.from_, ">="), (period.before, "<")):
                if time_value is not None:
                    try:
                        stamp = pd.Timestamp(time_value)
                        if pd.isna(stamp):
                            raise ValueError("Missing timestamp")
                        stamps.append(stamp.value)
                    except (ValueError, TypeError, OverflowError) as exc:
                        raise ValidationError(
                            "Use valid ISO timestamps for the first-recorded range.", code="eda.time_range"
                        ) from exc
                    bounds.append(f"epoch_ns(first_recorded) {operator} ?")
            if not bounds or (len(stamps) == 2 and stamps[0] >= stamps[1]):
                raise ValidationError(
                    "A time range needs a bound, with from before its exclusive end.", code="eda.time_range"
                )
            time_choices.append("(" + " AND ".join(bounds) + ")")
            values.extend(stamps)
        if time_choices:
            predicates.append(" OR ".join(time_choices))
        span_choices = ["span_days IS NULL"] if selection.spanMissing else []
        for span in selection.spanRanges or []:
            bounds = []
            for value, operator in ((span.min, ">="), (span.max, "<")):
                if value is not None:
                    bounds.append(f"span_days {operator} ?")
                    values.append(value)
            span_choices.append("(" + " AND ".join(bounds) + ")")
        if span_choices:
            predicates.append(" OR ".join(span_choices))
    extra_predicates, extra_values = selection_extensions(selection, domains, attributes, schema, mapping)
    predicates.extend(extra_predicates)
    values.extend(extra_values)
    return " AND ".join(f"({p})" for p in predicates) or "TRUE", values


def _month_start(index: int) -> pd.Timestamp:
    year, month = divmod(index, 12)
    return pd.Timestamp(year=year, month=month + 1, day=1)


def aggregate_eda(
    path: Path, mapping: ColumnMapping, request: EDARequest, *, members_only: bool = False
) -> dict[str, Any]:
    """Pure read of one prepared case table; also usable in read-only fixture checks."""
    schema = pq.read_schema(path)
    metadata = json.loads((schema.metadata or {}).get(b"pandas", b"{}"))
    indices = metadata.get("index_columns", [])
    case_id = next((name for name in indices if isinstance(name, str)), mapping.case_id)
    required = {case_id, "n_events", "first_ts", "last_ts"}
    if not required <= set(schema.names):
        raise ValidationError(
            "This case table is missing its exploration columns; rebuild its mapping.", code="eda.schema"
        )
    available = [
        f.name
        for f in schema
        if f.name not in required | {"exposure", "score"}
        and not (pa.types.is_nested(f.type) or pa.types.is_binary(f.type))
    ]
    attributes = available[:MAX_ATTRIBUTES]
    selection = parse_selection(request.selection)
    selected_facets = [*(selection.facets or []), *(f for branch in selection.jointAny or [] for f in branch.facets)]
    for field in [
        *(facet.field for facet in selected_facets),
        *(facet.field for facet in selection.numericFacets or []),
    ]:
        validate_field(field, available)
    for field in [*(request.hierarchyFields or []), *([request.valueField] if request.valueField else [])]:
        validate_field(field, available)
    if request.compareAttribute is not None:
        validate_field(request.compareAttribute, available)
    attribute = request.attribute
    if attribute is not None and attribute not in available:
        raise ValidationError(f"Unknown EDA category attribute {attribute!r}", code="filter.attribute")
    if attribute is None:
        attribute = "flow_type" if "flow_type" in attributes else next(iter(attributes), None)
    # The picker/profile cap never silently drops an explicitly referenced field.
    referenced = [
        *(facet.field for facet in selected_facets),
        *(facet.field for facet in selection.numericFacets or []),
    ]
    referenced.extend(request.hierarchyFields or [])
    if request.valueField:
        referenced.append(request.valueField)
    referenced.extend(name for name in (attribute, request.compareAttribute) if name is not None)
    referenced.extend(
        clause["field"]
        for clause in (parse_filter(request.filter) or {}).get("and", [])
        if clause["kind"] == "attribute" and clause["field"] in available
    )
    aliases = {name: f"a{i}" for i, name in enumerate(dict.fromkeys([*attributes, *referenced]))}
    projections = [f"{_quote(name)} AS {alias}" for name, alias in aliases.items()]
    with duckdb.connect(":memory:", config={"threads": 2}) as con:
        # Aggregation never writes workspace artifacts; event reads are explicitly opt-in.
        con.execute("SET TimeZone='UTC'")
        con.execute("SET temp_directory=''")
        con.read_parquet(str(path)).create_view("source")
        con.execute(f"""CREATE TEMP VIEW prepared AS SELECT
            CAST({_quote(case_id)} AS VARCHAR) AS case_id,
            CAST(n_events AS BIGINT) AS events,
            first_ts AS first_recorded, last_ts AS last_recorded,
            CASE WHEN first_ts IS NOT NULL AND last_ts >= first_ts
                 THEN epoch(last_ts - first_ts) / 86400.0 END AS span_days
            {"," if projections else ""} {",".join(projections)} FROM source""")
        comparison = request.compareAttribute
        if request.insight and not members_only and comparison is None:
            comparison = choose_comparison(con, {name: aliases[name] for name in attributes}, attribute, mapping)
        fields = [name for name in (attribute, comparison if request.insight else None) if name is not None]
        fields.extend(facet.field for facet in selected_facets)
        fields.extend(request.hierarchyFields or [])
        if request.valueField:
            fields.append(request.valueField)
        domains = prepare_domains(con, aliases, fields, attribute, mapping)
        category_keys = {row["category_key"] for row in _rows(con, "SELECT DISTINCT category_key FROM categorized")}
        predicate, values = _selection(request, aliases, category_keys, selection, domains, mapping, schema)
        # Materialize only case-level data once, keeping all chart queries consistent.
        con.execute(
            f"CREATE TEMP TABLE marked AS SELECT *, coalesce({predicate}, FALSE) AS selected FROM categorized", values
        )
        if members_only:
            # Resolve the entire cohort through the same predicate as all EDA views,
            # independently of the detail page. Never persist truncated detail IDs.
            membership_counts = con.execute("SELECT count(*), count(DISTINCT case_id) FROM marked").fetchone()
            assert membership_counts is not None  # An aggregate without GROUP BY always returns one row.
            total, unique = membership_counts
            ids = [
                row[0] for row in con.execute("SELECT case_id FROM marked WHERE selected ORDER BY case_id").fetchall()
            ]
            if total != unique:
                raise ValidationError("Case IDs must be unique and non-null", code="selection.case_ids")
            return {"attribute": attribute, "memberIds": ids}
        totals = _rows(
            con,
            """SELECT count(*) AS cases_total, count(*) FILTER (WHERE selected) AS cases_selected,
            coalesce(sum(events), 0) AS events_total, coalesce(sum(events) FILTER (WHERE selected), 0) AS events_selected,
            count(span_days) FILTER (WHERE selected) AS known,
            count(*) FILTER (WHERE selected AND span_days IS NULL) AS unknown_span,
            count(*) FILTER (WHERE selected AND first_recorded IS NULL) AS unknown_start,
            median(span_days) FILTER (WHERE selected) AS median,
            quantile_cont(span_days, .9) FILTER (WHERE selected) AS p90,
            CAST(min(first_recorded) FILTER (WHERE selected) AS VARCHAR) AS first,
            CAST(max(last_recorded) FILTER (WHERE selected) AS VARCHAR) AS last,
            CAST(min(first_recorded) AS VARCHAR) AS global_first, CAST(max(first_recorded) AS VARCHAR) AS global_last
            FROM marked""",
        )[0]
        categories = (
            _rows(
                con,
                """SELECT m.category_key AS key, t.category AS value,
            count(*) AS total, count(*) FILTER (WHERE selected) AS selected
            FROM marked m LEFT JOIN top_categories t ON m.category_key = t.key
            GROUP BY m.category_key, t.category ORDER BY total DESC, key""",
            )
            if attribute
            else []
        )
        for row in categories:
            row["kind"] = "value" if row["value"] is not None else row["key"]
            row["label"] = (
                row["value"]
                if row["value"] is not None
                else {"missing": "Unknown / missing", "other": "Other categories"}[row["key"]]
            )

        periods: list[dict[str, Any]] = []
        stride = 1
        omitted_empty_months = 0
        if totals["global_first"] is not None:
            first, last = pd.Timestamp(totals["global_first"]), pd.Timestamp(totals["global_last"])
            first_month, last_month = first.year * 12 + first.month - 1, last.year * 12 + last.month - 1
            calendar_months = last_month - first_month + 1
            # Count whole-population occupied months before choosing resolution.
            # A single old timestamp must not coarsen the useful monthly pattern.
            # The extra row detects overflow without transferring an unbounded domain.
            monthly = _rows(
                con,
                f"""SELECT CAST(year(first_recorded) * 12 + month(first_recorded) - 1 AS INTEGER) AS month,
                    count(*) AS total, count(*) FILTER (WHERE selected) AS selected
                    FROM marked WHERE first_recorded IS NOT NULL GROUP BY month
                    ORDER BY month LIMIT {MAX_PERIODS + 1}""",
            )
            if len(monthly) <= MAX_PERIODS:
                counts = {row["month"]: row for row in monthly}
                if calendar_months <= MAX_PERIODS:
                    # Retain visible zero months whenever the full calendar fits.
                    starts = list(range(first_month, last_month + 1))
                else:
                    # Sparse history: show every occupied month, disclose removed
                    # zero-month gaps. Domain is independent of the current filter.
                    starts = sorted(counts)
                    omitted_empty_months = calendar_months - len(starts)
            else:
                stride = math.ceil(calendar_months / MAX_PERIODS)
                trend_counts = _rows(
                    con,
                    """SELECT CAST(floor((year(first_recorded) * 12 + month(first_recorded) - 1 - ?) / ?) AS INTEGER) AS bucket,
                        count(*) AS total, count(*) FILTER (WHERE selected) AS selected
                        FROM marked WHERE first_recorded IS NOT NULL GROUP BY bucket""",
                    [first_month, stride],
                )
                counts = {first_month + row["bucket"] * stride: row for row in trend_counts}
                starts = list(range(first_month, last_month + 1, stride))
            for start_month in starts:
                start, end = _month_start(start_month), _month_start(start_month + stride)
                # Shared time filter uses inclusive upper bounds, down to nanoseconds.
                inclusive_end = end - pd.Timedelta(1, "ns")
                label = start.strftime("%Y-%m")
                if stride > 1:
                    label += " – " + inclusive_end.strftime("%Y-%m")
                row = counts.get(start_month, {"total": 0, "selected": 0})
                periods.append(
                    {
                        "key": f"month:{start_month}",
                        "label": label,
                        "from": start.isoformat(),
                        "to": inclusive_end.isoformat(),
                        "total": row["total"],
                        "selected": row["selected"],
                    }
                )
        missing_time = _rows(
            con,
            "SELECT count(*) AS total, count(*) FILTER (WHERE selected) AS selected FROM marked WHERE first_recorded IS NULL",
        )[0]
        if missing_time["total"]:
            periods.append({"key": "missing", "label": "Unknown start", "from": None, "to": None, **missing_time})

        spans: list[dict[str, Any]] = []
        clauses = " ".join(f"WHEN span_days < {upper} THEN {i}" for i, upper in enumerate(SPAN_CUTS[1:]))
        distribution = _rows(
            con,
            f"""SELECT CASE WHEN span_days IS NULL THEN -1 {clauses} ELSE {len(SPAN_CUTS) - 1} END AS bucket,
            count(*) AS total, count(*) FILTER (WHERE selected) AS selected FROM marked GROUP BY bucket""",
        )
        span_counts = {row["bucket"]: row for row in distribution}
        for i, lower in enumerate(SPAN_CUTS):
            upper = SPAN_CUTS[i + 1] if i + 1 < len(SPAN_CUTS) else None
            row = span_counts.get(i, {"total": 0, "selected": 0})
            spans.append(
                {
                    "key": str(i),
                    "label": f"{lower:g}–<{upper:g} d" if upper is not None else f"≥{lower:g} d",
                    "min": lower,
                    "max": upper,
                    "missing": False,
                    "total": row["total"],
                    "selected": row["selected"],
                }
            )
        if -1 in span_counts:
            row = span_counts[-1]
            spans.append(
                {
                    "key": "missing",
                    "label": "Unknown span",
                    "min": None,
                    "max": None,
                    "missing": True,
                    "total": row["total"],
                    "selected": row["selected"],
                }
            )
        details = _rows(
            con,
            """SELECT case_id AS caseId, events, CAST(first_recorded AS VARCHAR) AS first_recorded, CAST(last_recorded AS VARCHAR) AS last_recorded,
            span_days AS spanDays, left(category, 512) AS category FROM marked WHERE selected
            ORDER BY first_recorded DESC NULLS LAST, case_id LIMIT ? OFFSET ?""",
            [request.pageSize, (request.page - 1) * request.pageSize],
        )
        for row in details:
            row["firstRecorded"] = _iso(row.pop("first_recorded"))
            row["lastRecorded"] = _iso(row.pop("last_recorded"))
        from .eda_events import event_evidence

        return {
            "values": value_page(
                con, domains[request.valueField], request.valueField, request.valueSearch, request.valuePage
            )
            if request.valueField
            else None,
            "hierarchy": hierarchy_counts(con, request.hierarchyFields, domains) if request.hierarchyFields else None,
            "eventEvidence": event_evidence(con, path.parent / "events.parquet", mapping, request)
            if request.eventInsight
            else None,
            "datasetId": request.datasetId,
            "attribute": attribute,
            "attributes": attributes,
            "caseNoun": mapping.case_noun or "cases",
            "summary": {
                "cases": {"selected": totals["cases_selected"], "total": totals["cases_total"]},
                "events": {"selected": totals["events_selected"], "total": totals["events_total"]},
                "knownSpanCases": totals["known"],
                "unknownSpanCases": totals["unknown_span"],
                "unknownStartCases": totals["unknown_start"],
                "medianSpanDays": totals["median"],
                "p90SpanDays": totals["p90"],
                "firstRecorded": _iso(totals["first"]),
                "lastRecorded": _iso(totals["last"]),
            },
            "categories": categories,
            "trend": periods,
            "trendMonthsPerBucket": stride,
            "trendOmittedEmptyMonths": omitted_empty_months,
            "spans": spans,
            "details": {
                "rows": details,
                "page": request.page,
                "pageSize": request.pageSize,
                "total": totals["cases_selected"],
            },
            "insights": aggregate_insights(
                con,
                schema=schema,
                aliases=aliases,
                attributes=attributes,
                case_id=case_id,
                mapping=mapping,
                primary=attribute,
                comparison=comparison,
                domains=domains,
                spans=spans,
                span_cuts=SPAN_CUTS,
            )
            if request.insight
            else None,
            "notes": [
                "Population: the prepared case table, after mapping decisions. Counts may differ from the raw import.",
                "Timezone-aware mapped timestamps are grouped and displayed in UTC; timestamps without a timezone retain the mapped clock time.",
                "First-to-last recorded span is elapsed time between the earliest and latest dated events; it is not business completion or active work time.",
                "Unknown spans are excluded from span percentiles, retained in case/event counts and shown as a selectable bucket. A single dated event has a zero recorded span.",
                "Time trend counts cases by their first recorded timestamp, not completed cases or monthly event volume. Undated events may precede or follow the dated span.",
                "Selections apply to all charts and case details. Background counts and bucket boundaries refer to the whole case table; percentages use selected cases.",
                "Multiple buckets are ORed within each facet, category, first-recorded time, span or event count; these dimensions intersect. New time ranges have exclusive upper bounds; legacy time filters retain inclusive upper bounds.",
                "Business completion is unknown here. No norm, closure outcome, cost, OEE, capability or defect rate is inferred.",
                "The top 20 category values are fixed for this case table; Other categories retains the remainder (including values longer than 512 characters). Detail category text is limited to 512 characters.",
            ]
            + (
                [
                    "Field profiles: distinct counts refer to the full table and exclude missing values; missing counts report both full-table and selected scopes. Numeric statistics describe selected cases only, excluding missing and nonfinite values.",
                    "Concentration span percentiles and event sums describe selected cases; unknown event counts contribute no events to sums, appear in an explicit event-count bucket, and are excluded by numeric event ranges.",
                ]
                if request.insight
                else []
            )
            + (
                [
                    f"{omitted_empty_months} empty calendar months are omitted. Every non-empty month remains a separate, selectable bar; the category axis does not represent continuous elapsed time. No cases are omitted."
                ]
                if omitted_empty_months
                else []
            )
            + ([f"Time buckets cover {stride} months to keep the trend within 120 periods."] if stride > 1 else [])
            + (
                ["Only the first 128 scalar attributes are offered."]
                if len(schema) > MAX_ATTRIBUTES + len(required)
                else []
            ),
        }


def explore_eda(c: Container, project_id: str, table_id: str, request: EDARequest) -> dict[str, Any]:
    table = c.mappings.get_case_table(project_id, table_id)
    if table.dataset_id != request.datasetId:
        raise NotFoundError("This case table does not belong to the selected dataset", code="case_table.not_found")
    if table.status != CaseTableStatus.READY:
        raise ValidationError(f"Case table is {table.status}; wait for its build job.", code="case_table.not_ready")
    path = c.workspace.case_table_dir(project_id, table_id) / "cases.parquet"
    if not path.is_file():
        raise NotFoundError("The prepared case table is missing", code="case_table.artefacts_missing")
    mapping = c.mappings.get_mapping(table.mapping_id)
    stamp = path.stat()
    events_path = path.parent / "events.parquet"
    event_stamp = events_path.stat() if request.eventInsight and events_path.is_file() else None
    key = (
        str(path.resolve()),
        table.mapping_id,
        stamp.st_mtime_ns,
        stamp.st_size,
        (event_stamp.st_mtime_ns, event_stamp.st_size) if event_stamp else None,
        request.model_dump_json(),
    )
    return _ANSWERS.get_or_compute(key, lambda: {"caseTableId": table_id, **aggregate_eda(path, mapping, request)})
