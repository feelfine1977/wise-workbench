"""Bounded deterministic context search on the current prepared population.

No violations, scores, drivers or causal effects are computed. Norm relevance
means an exact column reference in a positively weighted selected constraint.
"""

from __future__ import annotations

import itertools
import re
from typing import Any, Literal, TypedDict

import numpy as np
import pandas as pd
from pandas.api.types import is_bool_dtype, is_datetime64_any_dtype, is_numeric_dtype
from wise.constraints import Metric
from wise.norm import _rule_attributes

from wise_workbench.application.ports import GROUPING_ATTRIBUTES, grouping_token
from wise_workbench.domain import ValidationError
from wise_workbench.domain.norm_views import with_general_benchmark

from .bands import band_values
from .grouping import enrich_grouping_fields
from .norms import _norm_from


class ContextProfile(TypedDict):
    name: str
    type: Literal["numeric", "categorical"]
    distinct: int
    missing: int


class GroupingSuggestion(TypedDict):
    id: str
    attributes: list[str]
    bands: list[dict[str, Any]]
    label: str
    reasons: list[str]
    relevance: float
    rankScore: float
    cases: int
    supportCases: int
    missingCases: int
    groups: int
    belowMinCases: int
    supportedCases: int
    relatedConstraints: list[str]


MAX_COLUMNS = 128
MAX_CANDIDATE_COLUMNS = 12
MAX_EVALUATIONS = 256
MAX_ROW_EVALUATIONS = 8_000_000


def discover_groupings(
    frame: pd.DataFrame,
    native: list[str],
    document: dict[str, Any],
    *,
    views: list[str],
    min_cases: int,
    case_id: str,
    focus_layer: str | None = None,
    focus_constraint: str | None = None,
    limit: int = 15,
) -> dict[str, Any]:
    document = with_general_benchmark(document)
    norm = _norm_from(document)
    unknown = set(views) - {v.name for v in norm.views}
    if unknown or not views:
        raise ValidationError(f"Select known norm views; unknown: {sorted(unknown)}", code="grouping.views")
    constraints = {c.id: c for c in norm.constraints}
    if focus_layer and focus_layer not in {c.layer for c in norm.constraints}:
        raise ValidationError("Unknown focus layer", code="grouping.focus")
    if focus_constraint and focus_constraint not in constraints:
        raise ValidationError("Unknown focus constraint", code="grouping.focus")
    managed_general = (document.get("metadata", {}).get("general_benchmark") or {}).get("name")
    relevance_views = sorted(set(views) - {managed_general}) or sorted(set(views))
    weights = {}
    for view in relevance_views:
        raw = norm.weight_vector(view)
        # Stakeholder and managed General raw totals can differ. Normalize each
        # view so that larger arbitrary weight units do not dominate relevance.
        weights[view] = (raw / raw.sum()).to_dict() if raw.sum() > 0 else raw.to_dict()
    active = {cid: max(float(w.get(cid, 0)) for w in weights.values()) for cid in constraints}
    active = {
        cid: w
        for cid, w in active.items()
        if w > 0
        and (not focus_layer or constraints[cid].layer == focus_layer)
        and (not focus_constraint or cid == focus_constraint)
    }
    if not active:
        raise ValidationError("No positively weighted constraints match these views and focus", code="grouping.focus")
    frame = enrich_grouping_fields(frame, native)
    all_names = sorted(set(native) | set(GROUPING_ATTRIBUTES))
    # Reuse the library's case-reference grammar. Activity labels and predicate
    # literal values must never masquerade as context-column references.
    refs = {}
    for cid in active:
        nc = constraints[cid]
        referenced = set(_rule_attributes(nc.applicability))
        if isinstance(nc.constraint, Metric):
            referenced.add(nc.constraint.attribute)
        refs[cid] = referenced & set(all_names)
    relevance = {
        name: sum(w for cid, w in active.items() if name in refs[cid]) / sum(active.values()) for name in all_names
    }
    # Relevant fields are considered first if an unusually wide source exceeds the profile bound.
    names = sorted(all_names, key=lambda n: (-relevance[n], n))[:MAX_COLUMNS]
    profiles: list[ContextProfile] = []
    excluded: list[dict[str, str]] = []
    values: dict[str, pd.Series[Any]] = {}
    missing_by_name: dict[str, pd.Series[bool]] = {}
    bands_by_name: dict[str, list[dict[str, Any]]] = {}
    for name in names:
        if name not in frame:
            continue
        series = frame[name]
        tags = set(re.findall(r"[a-z]+", re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).lower()))
        if (
            name == case_id
            or name == frame.index.name
            or name.startswith(("score__", "contrib__", "__"))
            or tags in ({"case"}, {"case", "id"})
        ):
            excluded.append({"name": name, "reason": "case identifier or internal field"})
            continue
        if is_datetime64_any_dtype(series.dtype) or name in ("first_ts", "last_ts"):
            excluded.append({"name": name, "reason": "timestamp; use a calendar grouping"})
            continue
        numeric = is_numeric_dtype(series.dtype) and not is_bool_dtype(series.dtype)
        missing = series.isna() | series.astype(str).str.strip().isin(("", "(missing)"))
        if numeric and ((~np.isfinite(series)) & series.notna()).any():
            excluded.append({"name": name, "reason": "non-finite numeric values cannot be reliably banded"})
            continue
        try:
            distinct = int(series[~missing].nunique())
        except TypeError:
            excluded.append({"name": name, "reason": "non-scalar context"})
            continue
        reason = "constant or empty in this scope" if distinct < 2 else None
        if not numeric and (
            distinct > 200 or distinct == int((~missing).sum()) or (distinct >= 20 and distinct >= len(frame) * 0.8)
        ):
            reason = "identifier-like or too many categories"
        if numeric and tags & {"id", "identifier", "document"} and distinct >= max(2, len(frame) * 0.8):
            reason = "identifier-like numeric context"
        if reason:
            excluded.append({"name": name, "reason": reason})
            continue
        profile: ContextProfile = {
            "name": name,
            "type": "numeric" if numeric else "categorical",
            "distinct": distinct,
            "missing": int(missing.sum()),
        }
        profiles.append(profile)
        band: list[dict[str, Any]] = [{"attribute": name, "method": "quantile", "q": 4}] if numeric else []
        # Keep engine band edges/labels and missing grouping semantics.
        values[name] = (
            band_values(series, band[0]) if band else series.astype(object).where(series.notna(), "(missing)")
        )
        missing_by_name[name] = missing
        bands_by_name[name] = band
    candidates = sorted(profiles, key=lambda p: (-relevance[p["name"]], p["missing"], p["name"]))[
        :MAX_CANDIDATE_COLUMNS
    ]
    candidate_names = [p["name"] for p in candidates]
    # Round-robin widths ensure all three sizes are explored even with a small work budget.
    iterators = [iter(itertools.combinations(candidate_names, width)) for width in (1, 2, 3)]
    bound = min(MAX_EVALUATIONS, max(3, MAX_ROW_EVALUATIONS // max(len(frame), 1)))
    combinations: list[tuple[str, ...]] = []
    while iterators and len(combinations) < bound:
        remaining = []
        for iterator in iterators:
            combo = next(iterator, None)
            if combo is not None:
                combinations.append(combo)
                remaining.append(iterator)
                if len(combinations) == bound:
                    break
        iterators = remaining
    suggestions: list[GroupingSuggestion] = []
    for combo in combinations:
        attrs = list(combo)
        keyed = pd.DataFrame({name: values[name] for name in attrs}, index=frame.index)
        sizes = keyed.groupby(attrs, dropna=False, observed=True).size()
        missing = pd.concat([missing_by_name[name] for name in attrs], axis=1).any(axis=1)
        support = int((~missing).sum())
        supported = int(sizes[sizes >= min_cases].sum())
        related = sorted(cid for cid in active if refs[cid] & set(attrs))
        rel = sum(active[cid] for cid in related) / sum(active.values())
        rank = 0.7 * (supported / max(len(frame), 1)) * (support / max(len(frame), 1)) + 0.3 * rel
        reasons = [
            f"{support} of {len(frame)} cases have all context values; {supported} cases are in groups meeting the {min_cases}-case minimum."
        ]
        if related:
            reasons.append(
                "Exact context/applicability references in selected weighted constraints: " + ", ".join(related) + "."
            )
        else:
            reasons.append(
                "Population context comparison; no direct column reference in the selected weighted constraints."
            )
        bands = [b for name in attrs for b in bands_by_name[name]]
        suggestions.append(
            {
                "id": grouping_token(attrs, bands),
                "attributes": attrs,
                "bands": bands,
                "label": " × ".join(name + (" (quartiles)" if bands_by_name[name] else "") for name in attrs),
                "reasons": reasons,
                "relevance": rel,
                "rankScore": round(rank, 6),
                "cases": len(frame),
                "supportCases": support,
                "missingCases": int(missing.sum()),
                "groups": len(sizes),
                "belowMinCases": int((sizes < min_cases).sum()),
                "supportedCases": supported,
                "relatedConstraints": related,
            }
        )
    suggestions.sort(key=lambda s: (-s["rankScore"], s["belowMinCases"], len(s["attributes"]), s["id"]))
    # Reserve the best viable result of each available width before filling the
    # remaining slots by score. A tie-heavy top-N must not silently hide pairs
    # and triples. The final displayed order is still the rank order.
    selected_ids: set[str] = set()
    for width in (1, 2, 3):
        best = next(
            (
                s
                for s in suggestions
                if len(s["attributes"]) == width
                and s["groups"] > 1
                and s["supportCases"] > 0
                and s["supportedCases"] > 0
            ),
            None,
        )
        if best and len(selected_ids) < limit:
            selected_ids.add(best["id"])
    for suggestion in suggestions:
        if len(selected_ids) >= limit:
            break
        selected_ids.add(suggestion["id"])
    return {
        "effectiveNormFingerprint": norm.fingerprint(),
        "attributes": sorted(profiles, key=lambda p: p["name"]),
        "suggestions": [s for s in suggestions if s["id"] in selected_ids],
        "search": {
            "profiledColumns": len(names),
            "eligibleColumns": len(profiles),
            "candidateColumns": candidate_names,
            "evaluatedCombinations": len(combinations),
            "maxEvaluations": bound,
            "truncated": len(all_names) > MAX_COLUMNS or len(profiles) > MAX_CANDIDATE_COLUMNS or bool(iterators),
            "sampled": False,
            "excluded": excluded,
            "activeConstraints": sorted(active),
            "relevanceViews": relevance_views,
            "relevanceBasis": "Selected stakeholder views; managed General is excluded from relevance when other views are selected. General alone uses its own weights.",
            "relatedWeightMeaning": "Normalize each relevance view's constraint weights to sum to 1, then take the maximum per constraint across those views. Apply optional focus, then divide the weight of constraints referencing any chosen context column by the total remaining weight. This is a reference-weight share, not measured influence or applicability prevalence.",
            "ranking": "70% × fraction with complete context × fraction in groups meeting minimum support, plus 30% reference-weight share; ties prefer fewer small groups, then fewer columns",
            "diversity": "Reserve the highest-ranked viable grouping of each available width (1, 2, 3), then fill remaining slots by rank. Viable means multiple groups, some complete context, and at least one group meeting minimum support.",
        },
        "notice": "Pre-scoring context, applicability-reference and support suggestions. These are not verified drivers or root causes. Counts use all cases in the selected scope; discovery is bounded.",
    }
