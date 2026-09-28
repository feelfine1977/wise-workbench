"""Bounded field domains, predicates and insight aggregates over prepared cases only."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import duckdb
import pyarrow as pa
from pydantic import ValidationError as ModelValidationError

from wise_workbench.api.schema_models.eda import EDASelection
from wise_workbench.domain import DomainError, ValidationError

if TYPE_CHECKING:
    from wise_workbench.domain import ColumnMapping

MAX_CATEGORIES = 20
EVENT_CUTS = (0, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _rows(con: duckdb.DuckDBPyConnection, sql: str, values: list[Any] | None = None) -> list[dict[str, Any]]:
    result = con.execute(sql, values or [])
    names = [x[0] for x in result.description]
    return [dict(zip(names, row)) for row in result.fetchall()]


def _text(column: str) -> str:
    # Match the shared pandas filter's bool spelling.
    return f"CASE WHEN typeof({column}) = 'BOOLEAN' THEN CASE CAST({column} AS VARCHAR) WHEN 'true' THEN 'True' WHEN 'false' THEN 'False' END ELSE CAST({column} AS VARCHAR) END"


def _category_expr(column: str, mapping: ColumnMapping) -> str:
    # Literal display labels stay ordinary values, distinct from sentinel buckets.
    missing = f"{column} IS NULL OR CAST({column} AS VARCHAR) = ''"
    if mapping.missing_label is not None:
        missing += f" OR CAST({column} AS VARCHAR) = '" + mapping.missing_label.replace("'", "''") + "'"
    return f"CASE WHEN {missing} THEN NULL ELSE {_text(column)} END"


def parse_selection(value: str | None) -> EDASelection:
    if value is None:
        return EDASelection()
    try:
        return EDASelection.model_validate_json(value)
    except ModelValidationError as exc:
        raise ValidationError(
            "Invalid EDA selection: use bounded facet/category/time/span/event unions with unique facet fields.",
            code="eda.selection",
        ) from exc


def validate_field(field: str, available: list[str]) -> None:
    if field not in available:
        raise DomainError(f"Unknown EDA facet or comparison attribute {field!r}", code="eda.field")


def choose_comparison(
    con: duckdb.DuckDBPyConnection, attributes: dict[str, str], primary: str | None, mapping: ColumnMapping
) -> str | None:
    """Pick a useful stable context using bounded scalar results, never raw values."""
    candidates = [name for name in attributes if name != primary]
    if not candidates:
        return None
    expressions = [f"count(DISTINCT ({_category_expr(attributes[name], mapping)}))" for name in candidates]
    counts = con.execute("SELECT " + ",".join(expressions) + " FROM prepared").fetchone()
    assert counts is not None  # An aggregate without GROUP BY always returns one row.
    useful = [name for name, count in zip(candidates, counts) if 2 <= count <= 20]
    ordinary = [
        name for name in useful if not re.search(r"(^|[_\W])(id|uuid|guid|identifier|case)([_\W]|$)|Id$|ID$", name)
    ]
    return next(iter(ordinary or useful or candidates), None)


@dataclass(frozen=True)
class CategoryDomain:
    column: str
    table: str
    categories: list[dict[str, Any]]
    expression: str

    @property
    def keys(self) -> set[str]:
        return {row["key"] for row in self.categories}


def prepare_domains(
    con: duckdb.DuckDBPyConnection,
    aliases: dict[str, str],
    fields: list[str],
    primary: str | None,
    mapping: ColumnMapping,
) -> dict[str, CategoryDomain]:
    """Every displayed or referenced field gets its own full-table top-20 mapping."""
    domains: dict[str, CategoryDomain] = {}
    projections: list[str] = []
    joins: list[str] = []
    for i, field in enumerate(dict.fromkeys(fields)):
        column, table = f"facet_key_{i}", f"facet_top_{i}"
        expression = _category_expr(aliases[field], mapping)
        con.execute(f"""CREATE TEMP TABLE {table} AS
            SELECT category, n, 'v' || CAST(row_number() OVER (ORDER BY n DESC, category) AS VARCHAR) AS key
            FROM (SELECT category, count(*) AS n FROM
                  (SELECT {expression} AS category FROM prepared)
                  WHERE category IS NOT NULL AND length(category) <= 512
                  GROUP BY category ORDER BY n DESC, category LIMIT {MAX_CATEGORIES})""")
        categories = _rows(
            con,
            f"SELECT key, category AS value, category AS label, 'value' AS kind FROM {table} ORDER BY n DESC, category",
        )
        categories.extend(
            [
                {"key": "other", "value": None, "label": "Other categories", "kind": "other"},
                {"key": "missing", "value": None, "label": "Unknown / missing", "kind": "missing"},
            ]
        )
        domains[field] = CategoryDomain(column, table, categories, expression)
        projections.append(
            f"CASE WHEN ({expression}) IS NULL THEN 'missing' ELSE coalesce(t{i}.key, 'other') END AS {column}"
        )
        joins.append(f"LEFT JOIN {table} t{i} ON ({expression}) = t{i}.category")
    if primary is not None:
        expression = _category_expr(aliases[primary], mapping)
        con.execute(f"CREATE TEMP VIEW top_categories AS SELECT category, key FROM {domains[primary].table}")
        projections.extend([f"{expression} AS category", f"{domains[primary].column} AS category_key"])
    else:
        con.execute(
            "CREATE TEMP VIEW top_categories AS SELECT NULL::VARCHAR AS category, NULL::VARCHAR AS key WHERE FALSE"
        )
        projections.extend(["NULL::VARCHAR AS category", "'missing' AS category_key"])
    con.execute(
        f"CREATE TEMP VIEW categorized AS SELECT p.*, {','.join(projections)} FROM prepared p {' '.join(joins)}"
    )
    return domains


def selection_extensions(
    selection: EDASelection,
    domains: dict[str, CategoryDomain],
    aliases: dict[str, str],
    schema: pa.Schema,
    mapping: ColumnMapping,
) -> tuple[list[str], list[Any]]:
    predicates: list[str] = []
    values: list[Any] = []

    def facet_predicate(facet):
        domain = domains[facet.field]
        if not set(facet.keys) <= domain.keys:
            raise DomainError(f"Select category keys returned for EDA facet {facet.field!r}.", code="eda.facet_key")
        terms = []
        if facet.keys:
            terms.append(f"{domain.column} IN (" + ",".join("?" for _ in facet.keys) + ")")
            values.extend(facet.keys)
        if facet.values:
            terms.append(f"({domain.expression}) IN (" + ",".join("?" for _ in facet.values) + ")")
            values.extend(facet.values)
        return "(" + " OR ".join(terms) + ")"

    for facet in selection.facets or []:
        predicates.append(facet_predicate(facet))
    if selection.jointAny:
        predicates.append(
            " OR ".join(
                "(" + " AND ".join(facet_predicate(f) for f in branch.facets) + ")" for branch in selection.jointAny
            )
        )
    for numeric_facet in selection.numericFacets or []:
        dtype = schema.field(numeric_facet.field).type
        if not (pa.types.is_integer(dtype) or pa.types.is_floating(dtype) or pa.types.is_decimal(dtype)):
            raise ValidationError(
                f"{numeric_facet.field!r} is not a typed numeric case attribute", code="eda.numeric_type"
            )
        column = aliases[numeric_facet.field]
        normalized = _category_expr(column, mapping)
        known = f"(({normalized}) IS NOT NULL AND isfinite({column}))"
        choices = [f"NOT {known}"] if numeric_facet.missing else []
        for interval in numeric_facet.ranges:
            bounds = []
            for value, operator in ((interval.min, ">="), (interval.max, "<")):
                if value is not None:
                    decimal = Decimal(value)
                    if not pa.types.is_floating(dtype):
                        # Never let DuckDB silently reduce scale when finding a common decimal type.
                        scale = dtype.scale if pa.types.is_decimal(dtype) else 0
                        digits = (
                            dtype.precision - scale
                            if pa.types.is_decimal(dtype)
                            else (20 if pa.types.is_unsigned_integer(dtype) else 19)
                        )
                        if max(digits, decimal.adjusted() + 1) + max(scale, -int(decimal.as_tuple().exponent)) > 38:
                            raise ValidationError(
                                "Numeric bound exceeds exact comparison precision for this field",
                                code="eda.numeric_precision",
                            )
                    bounds.append(f"{column} {operator} ?")
                    values.append(float(decimal) if pa.types.is_floating(dtype) else decimal)
            choices.append("(" + known + " AND " + " AND ".join(bounds) + ")")
        predicates.append(" OR ".join(choices))
    event_choices: list[str] = ["events IS NULL"] if selection.eventMissing else []
    for event_interval in selection.eventRanges or []:
        event_bounds: list[str] = []
        for event_value, operator in ((event_interval.min, ">="), (event_interval.max, "<")):
            if event_value is not None:
                event_bounds.append(f"events {operator} ?")
                values.append(event_value)
        event_choices.append("(" + " AND ".join(event_bounds) + ")")
    if event_choices:
        predicates.append(" OR ".join(event_choices))
    return predicates, values


def _profiles(
    con: duckdb.DuckDBPyConnection,
    schema: pa.Schema,
    aliases: dict[str, str],
    attributes: list[str],
    case_id: str,
    mapping: ColumnMapping,
) -> list[dict[str, Any]]:
    columns = [
        (case_id, "case_id", "case_id"),
        ("n_events", "events", "events"),
        ("first_ts", "first_recorded", "timestamp"),
        ("last_ts", "last_recorded", "timestamp"),
    ]
    columns.extend((name, aliases[name], "attribute") for name in attributes)
    expressions: list[str] = []
    numeric_fields: set[int] = set()
    for i, (name, column, role) in enumerate(columns):
        normalized = _category_expr(column, mapping)
        expressions.extend(
            [
                f"count(DISTINCT ({normalized})) AS d{i}",
                f"count(*) FILTER (WHERE ({normalized}) IS NULL) AS m{i}",
                f"count(*) FILTER (WHERE selected AND ({normalized}) IS NULL) AS s{i}",
            ]
        )
        dtype = schema.field(name).type
        if role != "case_id" and (
            pa.types.is_integer(dtype) or pa.types.is_floating(dtype) or pa.types.is_decimal(dtype)
        ):
            numeric_fields.add(i)
            number = f"TRY_CAST(({normalized}) AS DOUBLE)"
            for stat, aggregate in (
                ("min", f"min({number})"),
                ("max", f"max({number})"),
                ("median", f"median({number})"),
                ("p90", f"quantile_cont({number}, .9)"),
            ):
                expressions.append(f"{aggregate} FILTER (WHERE selected AND isfinite({number})) AS {stat}{i}")
    row = _rows(con, "SELECT " + ",".join(expressions) + " FROM marked")[0]
    return [
        {
            "name": name,
            "dataType": str(schema.field(name).type),
            "role": role,
            "distinct": row[f"d{i}"],
            "missing": {"total": row[f"m{i}"], "selected": row[f"s{i}"]},
            "numeric": {stat: row[f"{stat}{i}"] for stat in ("min", "max", "median", "p90")}
            if i in numeric_fields
            else None,
        }
        for i, (name, _column, role) in enumerate(columns)
    ]


def _bucket_expr(column: str, cuts: tuple[float, ...] | tuple[int, ...]) -> str:
    clauses = " ".join(f"WHEN {column} < {upper} THEN '{i}'" for i, upper in enumerate(cuts[1:]))
    return f"CASE WHEN {column} IS NULL THEN 'missing' {clauses} ELSE '{len(cuts) - 1}' END"


def aggregate_insights(
    con: duckdb.DuckDBPyConnection,
    *,
    schema: pa.Schema,
    aliases: dict[str, str],
    attributes: list[str],
    case_id: str,
    mapping: ColumnMapping,
    primary: str | None,
    comparison: str | None,
    domains: dict[str, CategoryDomain],
    spans: list[dict[str, Any]],
    span_cuts: tuple[float, ...],
) -> dict[str, Any]:
    facets: list[dict[str, Any]] = []
    displayed = list(dict.fromkeys(field for field in (primary, comparison) if field is not None))
    for field in displayed:
        domain = domains[field]
        counts = {
            row["key"]: row
            for row in _rows(
                con,
                f"""SELECT {domain.column} AS key,
            count(*) AS total, count(*) FILTER (WHERE selected) AS selected FROM marked GROUP BY {domain.column}""",
            )
        }
        facets.append(
            {
                "field": field,
                "categories": [
                    {
                        **category,
                        "total": counts.get(category["key"], {}).get("total", 0),
                        "selected": counts.get(category["key"], {}).get("selected", 0),
                    }
                    for category in domain.categories
                ],
            }
        )
    joint: list[dict[str, Any]] = []
    if primary is not None and comparison is not None and primary != comparison:
        left, right = domains[primary], domains[comparison]
        counts = {
            (row["leftKey"], row["rightKey"]): row
            for row in _rows(
                con,
                f"""SELECT
            {left.column} AS leftKey, {right.column} AS rightKey,
            count(*) AS total, count(*) FILTER (WHERE selected) AS selected
            FROM marked GROUP BY {left.column}, {right.column}""",
            )
        }
        joint = [
            counts.get(
                (left_category["key"], right_category["key"]),
                {"leftKey": left_category["key"], "rightKey": right_category["key"], "total": 0, "selected": 0},
            )
            for left_category in left.categories
            for right_category in right.categories
        ]

    event_expr = _bucket_expr("events", EVENT_CUTS)
    event_counts = {
        row["key"]: row
        for row in _rows(
            con,
            f"""SELECT {event_expr} AS key,
        count(*) AS total, count(*) FILTER (WHERE selected) AS selected FROM marked GROUP BY key""",
        )
    }
    event_bins: list[dict[str, Any]] = []
    for i, lower in enumerate(EVENT_CUTS):
        upper = EVENT_CUTS[i + 1] if i + 1 < len(EVENT_CUTS) else None
        counts = event_counts.get(str(i), {"total": 0, "selected": 0})
        event_bins.append(
            {
                "key": str(i),
                "label": f"{lower}–<{upper} events" if upper is not None else f"≥{lower} events",
                "min": lower,
                "max": upper,
                "missing": False,
                "total": counts["total"],
                "selected": counts["selected"],
            }
        )
    if "missing" in event_counts:
        event_bins.append(
            {**event_counts["missing"], "label": "Unknown event count", "min": None, "max": None, "missing": True}
        )
    cells = {
        (row["spanKey"], row["eventKey"]): row
        for row in _rows(
            con,
            f"""SELECT
        {_bucket_expr("span_days", span_cuts)} AS spanKey, {event_expr} AS eventKey,
        count(*) AS total, count(*) FILTER (WHERE selected) AS selected FROM marked GROUP BY spanKey, eventKey""",
        )
    }
    density = [
        cells.get(
            (span["key"], event["key"]), {"spanKey": span["key"], "eventKey": event["key"], "total": 0, "selected": 0}
        )
        for span in spans
        for event in event_bins
    ]
    concentration: list[dict[str, Any]] = []
    if primary is not None:
        counts = {
            row["key"]: row
            for row in _rows(
                con,
                """SELECT category_key AS key,
            count(*) AS total, count(*) FILTER (WHERE selected) AS selected,
            count(span_days) FILTER (WHERE selected) AS knownSpanCases,
            count(*) FILTER (WHERE selected AND span_days IS NULL) AS unknownSpanCases,
            count(*) FILTER (WHERE selected AND events IS NULL) AS unknownEventCases,
            median(span_days) FILTER (WHERE selected) AS medianSpanDays,
            quantile_cont(span_days, .9) FILTER (WHERE selected) AS p90SpanDays,
            coalesce(sum(events) FILTER (WHERE selected), 0) AS events FROM marked GROUP BY category_key""",
            )
        }
        concentration = [
            {
                "label": category["label"],
                **counts.get(
                    category["key"],
                    {
                        "key": category["key"],
                        "total": 0,
                        "selected": 0,
                        "knownSpanCases": 0,
                        "unknownSpanCases": 0,
                        "unknownEventCases": 0,
                        "medianSpanDays": None,
                        "p90SpanDays": None,
                        "events": 0,
                    },
                ),
            }
            for category in domains[primary].categories
        ]
    return {
        "compareAttribute": comparison,
        "fields": _profiles(con, schema, aliases, attributes, case_id, mapping),
        "facets": facets,
        "joint": joint,
        "density": density,
        "eventBins": event_bins,
        "concentration": concentration,
    }


def value_page(con, domain: CategoryDomain, field: str, query: str, page: int) -> dict[str, Any]:
    """Search the full normalized domain; the top-20 partition never changes."""
    expr = domain.expression
    condition = f"({expr}) IS NOT NULL AND contains(lower({expr}), lower(?))"
    total = con.execute(f"SELECT count(DISTINCT ({expr})) FROM marked WHERE {condition}", [query]).fetchone()[0]
    rows = _rows(
        con,
        f"""SELECT {expr} AS value, count(*) AS total,
        count(*) FILTER (WHERE selected) AS selected, length({expr}) <= 4096 AS selectable
        FROM marked WHERE {condition} GROUP BY value ORDER BY total DESC, value LIMIT 40 OFFSET ?""",
        [query, (page - 1) * 40],
    )
    # Oversized values remain discoverable but cannot be submitted as predicates.
    for row in rows:
        if not row["selectable"]:
            row["value"] = row["value"][:4096] + "…"
    return {"field": field, "query": query, "page": page, "pageSize": 40, "totalValues": total, "rows": rows}


def hierarchy_counts(con, fields: list[str], domains: dict[str, CategoryDomain]) -> dict[str, Any]:
    columns = [domains[field].column for field in fields]
    labels = [{row["key"]: row["label"] for row in domains[field].categories} for field in fields]
    rows = _rows(
        con,
        f"""SELECT {",".join(columns)}, count(*) AS total,
        count(*) FILTER (WHERE selected) AS selected FROM marked GROUP BY {",".join(columns)}
        ORDER BY {",".join(columns)}""",
    )
    return {
        "fields": fields,
        "cells": [
            {
                "keys": [row[column] for column in columns],
                "labels": [lookup[row[column]] for lookup, column in zip(labels, columns)],
                "total": row["total"],
                "selected": row["selected"],
            }
            for row in rows
        ],
    }
