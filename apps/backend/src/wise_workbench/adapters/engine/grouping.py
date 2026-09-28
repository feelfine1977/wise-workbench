"""Typed grouping features and suggestions; no expression language or scoring changes."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

import numpy as np
import pandas as pd
from pandas.api.types import is_bool_dtype, is_datetime64_any_dtype, is_numeric_dtype

from wise_workbench.application.ports import grouping_token

DESCRIPTIONS = {
    "start_month": "Calendar month (YYYY-MM) of the first recorded timestamp, in UTC. An unknown start is shown as (missing).",
    "start_year": "Calendar year of the first recorded timestamp, in UTC. An unknown start is shown as (missing).",
    "recorded_span_days": "Days between the first and last recorded timestamps. This is the recorded span, not active work time or a completed lifecycle. Unknown spans are missing.",
    "n_events": "Number of recorded events per case, including repeated activities; not the number of distinct activities.",
    "exposure": "The case value supplied by the mapping; units and aggregation follow that mapping.",
}


def enrich_grouping_fields(frame: pd.DataFrame, native: Iterable[str] = ()) -> pd.DataFrame:
    """Derive only fixed calendar/span fields, preserving all declared native attributes.

    Recompute from each object's timestamps, including after scenario transforms.
    The same function is used for persisted frames, live result cases and logs.
    """
    out = frame.copy()
    protected = set(native)
    start = (
        pd.to_datetime(out["first_ts"], utc=True, errors="coerce", format="mixed")
        if "first_ts" in out
        else pd.Series(pd.NaT, index=out.index, dtype="datetime64[ns, UTC]")
    )
    # Avoid per-row timezone-aware strftime; integer calendar fields stay vectorized.
    year = start.dt.year.astype("Int64").astype("string").str.zfill(4)
    if "start_month" not in protected:
        month = start.dt.month.astype("Int64").astype("string").str.zfill(2)
        out["start_month"] = (year + "-" + month).astype(object).where(start.notna(), None)
    if "start_year" not in protected:
        out["start_year"] = year.astype(object).where(start.notna(), None)
    if "recorded_span_days" not in protected:
        end = (
            pd.to_datetime(out["last_ts"], utc=True, errors="coerce", format="mixed")
            if "last_ts" in out
            else pd.Series(pd.NaT, index=out.index, dtype="datetime64[ns, UTC]")
        )
        span = (end - start).dt.total_seconds() / 86400
        out["recorded_span_days"] = span.where(np.isfinite(span) & (span >= 0))
    out.attrs["_wise_grouping_native"] = tuple(sorted(protected))
    return out


def grouping_options(
    frame: pd.DataFrame, native: Iterable[str], *, scope: dict[str, Any] | None, noun: str
) -> dict[str, Any]:
    """Profile actual case columns in the run population, excluding score/internal columns."""
    native = list(dict.fromkeys(native))
    names = list(
        dict.fromkeys([*native, "flow_type", "exposure", "start_month", "start_year", "recorded_span_days", "n_events"])
    )
    profiles: list[dict[str, Any]] = []
    for name in names:
        if name not in frame.columns:
            continue
        values = frame[name]
        missing = values.isna() | values.astype(str).str.strip().isin(("", "(missing)"))
        numbers = pd.to_numeric(values, errors="coerce")
        # Mapped case attributes can be stored as strings even when every supplied value is numeric.
        numeric = (
            not is_bool_dtype(values.dtype)
            and not is_datetime64_any_dtype(values.dtype)
            and (is_numeric_dtype(values.dtype) or (bool((~missing).any()) and bool(numbers[~missing].notna().all())))
        )
        if numeric:
            missing |= ~np.isfinite(numbers)
        description = DESCRIPTIONS.get(name) if name not in native else f"Supplied case attribute: {name}."
        profiles.append(
            {
                "name": name,
                "type": "numeric" if numeric else "categorical",
                "distinct": int(values[~missing].nunique()),
                "missing": int(missing.sum()),
                **({"description": description} if description else {}),
            }
        )

    def readable(name: str) -> str:
        fixed = {
            "start_month": "Start month",
            "start_year": "Start year",
            "recorded_span_days": "Recorded span (days)",
            "n_events": "Recorded event count",
            "exposure": "Value",
        }
        if name in fixed:
            return fixed[name]
        label = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).replace("_", " ")
        label = re.sub(r"^case[ :]+", "", label, flags=re.IGNORECASE)
        label = re.sub(r"\s+text$", "", label, flags=re.IGNORECASE).strip()
        return label[:1].upper() + label[1:]

    def words(name: str) -> set[str]:
        return set(re.findall(r"[a-z]+", re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).lower()))

    def rank(profile: dict[str, Any]) -> tuple[int, str]:
        tags = words(profile["name"])
        return (
            0 if tags & {"company", "spend", "vendor", "supplier", "customer", "category", "flow"} else 1,
            profile["name"].casefold(),
        )

    suggestions: list[dict[str, Any]] = []
    # Prefer real supplied calendar fields; engine-derived calendar remains selectable.
    native_month = next(
        (p["name"] for p in profiles if p["name"] in native and "month" in words(p["name"]) and p["distinct"]), None
    )
    native_year = next(
        (p["name"] for p in profiles if p["name"] in native and "year" in words(p["name"]) and p["distinct"]), None
    )
    for profile in sorted(profiles, key=rank):
        name = profile["name"]
        if not profile["distinct"]:
            continue
        # All fields remain manual options, but identifiers/timestamps are poor automatic comparisons.
        if is_datetime64_any_dtype(frame[name].dtype) or name in ("first_ts", "last_ts"):
            continue
        tags = words(name)
        if (profile["type"] == "categorical" or tags & {"id", "document", "code"}) and (
            profile["distinct"] > 200 or (profile["distinct"] >= 20 and profile["distinct"] >= len(frame) * 0.8)
        ):
            continue
        if (name == "start_month" and native_month and native_month != name) or (
            name == "start_year" and native_year and native_year != name
        ):
            continue
        tags = words(name)
        categorical_number = bool(
            tags & {"company", "vendor", "supplier", "customer", "category", "month", "year", "code", "id", "document"}
        )
        bands: list[dict[str, Any]] = []
        if profile["type"] == "numeric" and not categorical_number:
            if profile["distinct"] < 2:
                continue
            bands = [{"attribute": name, "method": "quantile", "q": 4}]
            label = f"{readable(name)} · quartiles"
            description = "Four value bands using this run's cases; tied values may produce fewer bands. Missing values form their own group."
        else:
            label = readable(name)
            description = profile.get("description") or f"Compare groups with the same {label}."
        suggestions.append(
            {
                "id": grouping_token([name], bands),
                "label": label,
                "description": description,
                "attributes": [name],
                "bands": bands,
            }
        )
    return {"attributes": profiles, "suggestions": suggestions, "scope": scope, "cases": len(frame), "caseNoun": noun}
