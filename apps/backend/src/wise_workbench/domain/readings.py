"""Reading sentences in plain language.

The vocabulary follows the translation table of the guidance panel
(``docs/panel/guidance_and_insight_panel.md`` section 2): group, expectation,
expectation area, shortfall, priority, confidence, kind of problem. The
method's terms (slice, constraint, layer, gap, PI, hotspot type, stability)
stay available as aliases so that both vocabularies can be shown. Every
number a reader needs to recompute the ranking is inside the sentence.
Descriptive wording only: never "root cause", "fault" or "effect".
"""

from __future__ import annotations

from typing import Any

# Kinds of problem: the plain label is primary; the library's hotspot type is the alias.
KIND_OF: dict[str, str] = {"severity": "acute", "mechanism": "systematic", "reservoir": "widespread"}
HOTSPOT_OF: dict[str, str] = {kind: hotspot for hotspot, kind in KIND_OF.items()}
KINDS: tuple[str, ...] = ("acute", "systematic", "widespread")

KIND_READING: dict[str, str] = {
    "acute": "few cases, far off",
    "systematic": "one pattern behind it",
    "widespread": "many cases, slightly off",
}

CONFIDENCE_READING: dict[str, str] = {
    "stable": "high",
    "fragile": "medium",
    "insufficient_support": "not enough cases to be sure",
    "unknown": "not computed for this run",
}

# Kept for callers that still speak the method's vocabulary.
HOTSPOT_WORDS: dict[str, str] = {hotspot: f"{kind}: {KIND_READING[kind]}" for hotspot, kind in KIND_OF.items()}


def kind_of(hotspot_type: Any) -> str | None:
    """The plain kind for a library hotspot type (``None`` when the slice is not typed)."""
    if hotspot_type is None:
        return None
    return KIND_OF.get(str(hotspot_type))


def hotspot_of(kind: Any) -> str | None:
    if kind is None:
        return None
    return HOTSPOT_OF.get(str(kind))


def kind_reading(kind: Any) -> str | None:
    if kind is None:
        return None
    return KIND_READING.get(str(kind))


def confidence_reading(stability: Any) -> str:
    return CONFIDENCE_READING.get(str(stability or "unknown"), CONFIDENCE_READING["unknown"])


def _fmt_int(n: Any) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return str(n)


def _fmt(x: Any, digits: int = 1) -> str:
    try:
        return f"{float(x):,.{digits}f}"
    except (TypeError, ValueError):
        return "n/a"


def _num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if v != v else v  # NaN


def pct(share: Any) -> str:
    """A share in [0, 1] as a percentage with as many decimals as the size needs: 0.0087 → ``0.9 %``."""
    v = _num(share)
    if v is None:
        return "n/a"
    p = v * 100
    digits = 0 if p >= 10 else 1 if p >= 0.1 else 2
    return f"{p:.{digits}f} %"


def group_label(keys: dict[str, Any] | None, fallback: str) -> str:
    if keys:
        return " × ".join(str(v) for v in keys.values())
    return fallback


def backlog_reading(row: dict[str, Any], view: str | None, gamma: float, label: str) -> str:
    """One plain sentence per group.

    Reads the library's columns (``n_cases``, ``gap``, ``stable_gap``, ``PI``,
    ``stable_PI``, ``rank``) and the derived plain fields (``kind``,
    ``dominant_layer_name``, ``top_constraint_description``,
    ``top_constraint_share``, ``n_ranked``, ``stability``) when present.
    """
    n = row.get("n_cases")
    gap = _num(row.get("gap")) or 0.0
    stable_gap = _num(row.get("stable_gap"))
    perspective = f" in the {view} perspective" if view else ""
    if gap <= 0:
        return (
            f"{label}: {_fmt_int(n)} cases at or above expectation on average{perspective}; no shortfall, priority 0."
        )
    shortfall = f"{pct(gap)} below expectation on average"
    if stable_gap is not None and pct(stable_gap) != pct(gap):
        shortfall += f" ({pct(stable_gap)} with small groups discounted)"
    parts = [f"{label}: {_fmt_int(n)} cases, {shortfall}"]
    kind = row.get("kind") or kind_of(row.get("hotspot_type"))
    if kind:
        parts.append(f"{kind}: {kind_reading(kind)}")
    area = row.get("dominant_layer_name") or row.get("dominant_layer")
    if area:
        detail = row.get("top_constraint_description")
        share = _num(row.get("top_constraint_share"))
        if detail and share is not None:
            detail = str(detail).rstrip(".")
            parts.append(f"most-missed expectation area: {area} ({detail}, missed in {pct(share)} of these cases)")
        elif detail:
            parts.append(f"most-missed expectation area: {area} ({str(detail).rstrip('.')})")
        else:
            parts.append(f"most-missed expectation area: {area}")
    parts.append(f"confidence in rank: {confidence_reading(row.get('stability'))}")
    priority = f"priority {_fmt(row.get('stable_PI'), 1)}"
    raw = _num(row.get("PI"))
    if raw is not None and _fmt(raw, 1) != _fmt(row.get("stable_PI"), 1):
        priority += f" (raw {_fmt(raw, 1)}; small groups discounted with γ = {gamma:g})"
    else:
        priority += f" (small groups discounted with γ = {gamma:g})"
    rank = row.get("rank")
    n_ranked = row.get("n_ranked")
    if rank is not None and n_ranked:
        priority += f", rank {int(rank)} of {_fmt_int(n_ranked)}"
    elif rank is not None:
        priority += f", rank {int(rank)}"
    parts.append(priority + perspective)
    return "; ".join(parts) + "."


def slice_reading(
    row: dict[str, Any], drivers: list[dict[str, Any]], view: str | None, gamma: float, label: str
) -> str:
    """The group's sentence plus the expectations behind the shortfall (share of the shortfall each explains)."""
    base = backlog_reading(row, view, gamma, label)
    ranked = sorted(
        (d for d in drivers if (_num(d.get("delta_gap")) or 0) > 0),
        key=lambda d: -(_num(d.get("delta_gap")) or 0),
    )[:3]
    if not ranked:
        ranked = [d for d in drivers if (_num(d.get("mean_penalty")) or 0) > 0][:3]
    if not ranked:
        return base
    items = []
    for d in ranked:
        text = str(d.get("description") or d.get("constraint")).rstrip(".")
        extras = []
        share = _num(d.get("share_of_shortfall"))
        if share is not None and share > 0:
            extras.append(f"explains {pct(share)} of the shortfall")
        missed = _num(d.get("share_violated"))
        if missed is not None:
            extras.append(f"missed in {pct(missed)} of cases")
        items.append(f"{text} ({', '.join(extras)})" if extras else text)
    return base + " Expectations behind the shortfall: " + "; ".join(items) + "."
