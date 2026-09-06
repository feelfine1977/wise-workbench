"""The real-unit comparison sentence of a group, in one readable form per kind of number.

The analytics package contrasts a group with everyone else and reports, per
expectation, medians in real units, the shift, and the shares missing the
expectation here and elsewhere. This module turns one such row into the
sentence a card and the reason screen print — always "<expectation>: <here>
here against <elsewhere> elsewhere (<difference>)" with at most three numbers
(``docs/panel/ui_design_cycle2.md`` §2.7):

* durations: ``Paid within terms: 83 days here against 55 elsewhere (+25 days)``,
* counts: ``Received in few deliveries: 14 Record Goods Receipt events per
  purchase order item here against 1 elsewhere (+13)``,
* shares: ``Mostly automatic: a manual share of 83 % here against 80 %
  elsewhere (+3.3 points)``,
* other case attributes: ``Short event chain: 18 events per purchase order
  item here against 5 elsewhere (+13)``,
* the share of items missing the expectation, when no real-unit value is
  available: ``Invoice paid: missed in 67 % of purchase order items here
  against 22 % elsewhere (+45 points)``.

When the real-unit difference rounds to zero the sentence falls back on the
shares missing the expectation; when those round to the same value as well
it says ``No material difference on the top expectation (<expectation>)``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

KINDS: tuple[str, ...] = ("lag", "count", "share", "metric", "rate", "none")

_UNIT_WORDS = {
    "D": "days",
    "W": "weeks",
    "h": "hours",
    "min": "minutes",
    "s": "seconds",
    "ms": "milliseconds",
    "days": "days",
    "hours": "hours",
}

# Plain words for the case attributes the packs measure; anything else is the attribute name in words.
_QUANTITY_WORDS = {
    "manual_share": "manual share",
    "manual_touch_count": "manual touches",
    "manual_touches": "manual touches",
    "total_events": "events",
    "n_events": "events",
    "distinct_human_resources": "distinct human resources",
    "distinct_resources": "distinct resources",
}

_SHARE_WORDS = ("share", "ratio", "rate", "fraction", "pct", "percent", "%")


@dataclass(frozen=True)
class Comparison:
    """One driver of a slice contrast, as the analytics package reports it."""

    kind: str
    name: str
    value_slice: float | None = None
    value_rest: float | None = None
    difference: float | None = None
    unit: str | None = None
    rate_slice: float | None = None
    rate_rest: float | None = None
    count_noun: str | None = None


@dataclass(frozen=True)
class Sentence:
    text: str
    kind: str


def _finite(*values: Any) -> bool:
    for v in values:
        if v is None:
            return False
        try:
            if not math.isfinite(float(v)):
                return False
        except (TypeError, ValueError):
            return False
    return True


def number(v: float, *, count: bool = False) -> str:
    """Whole numbers for counts and values of 10 or more, one decimal below (``83``, ``1.9``, ``14``)."""
    v = float(v)
    if count or abs(v) >= 10 or abs(v - round(v)) < 0.05:
        return f"{v:,.0f}"
    return f"{v:.1f}"


def signed(v: float, *, count: bool = False) -> str:
    s = number(abs(v), count=count)
    return f"+{s}" if v > 0 else f"-{s}"


def percent(share: float) -> str:
    """A share in [0, 1] as a per cent: whole above 10 %, one decimal below (``97 %``, ``0.9 %``)."""
    p = float(share) * 100
    return f"{p:.0f} %" if p >= 10 else f"{p:.1f} %"


def points(diff: float) -> str:
    """A difference of two shares in percentage points (``+25 points``, ``-0.6 points``)."""
    p = abs(float(diff)) * 100
    s = f"{p:.0f}" if p >= 10 else f"{p:.1f}"
    return f"{'+' if diff > 0 else '-'}{s} points"


def _rounds_to_zero(text: str) -> bool:
    return text.lstrip("+-").replace(",", "").rstrip("%").strip() in ("0", "0.0")


def quantity_words(unit: str | None) -> str:
    if not unit:
        return "value"
    if unit in _QUANTITY_WORDS:
        return _QUANTITY_WORDS[unit]
    words = unit.replace("_", " ").strip()
    for prefix in ("n ", "total ", "number of "):
        if words.startswith(prefix) and len(words) > len(prefix):
            words = words[len(prefix) :]
    if words.endswith(" count"):
        words = words[: -len(" count")]
    return words or "value"


def is_share_unit(unit: str | None, *values: Any) -> bool:
    """A metric measured as a share: named as one, or every value in [0, 1] without being a whole number."""
    if unit and any(w in unit.lower() for w in _SHARE_WORDS):
        return True
    finite = [float(v) for v in values if _finite(v)]
    if not finite:
        return False
    return all(0.0 <= v <= 1.0 for v in finite) and any(abs(v - round(v)) >= 1e-9 for v in finite)


def _singular(items: str) -> str:
    return items[:-1] if items.endswith("s") and len(items) > 1 else items


def _rate_sentence(c: Comparison, items: str) -> Sentence | None:
    if not _finite(c.rate_slice, c.rate_rest) or c.rate_slice is None or c.rate_rest is None:
        return None
    ps, pr = float(c.rate_slice), float(c.rate_rest)
    here, there = percent(ps), percent(pr)
    if here == there:
        return None
    diff = points(ps - pr)
    return Sentence(f"{c.name}: missed in {here} of {items} here against {there} elsewhere ({diff})", "rate")


def _none_sentence(c: Comparison) -> Sentence:
    return Sentence(f"no material difference on the top expectation ({c.name})", "none")


def readable_comparison(c: Comparison, *, items: str = "items", item: str | None = None) -> Sentence:
    """The sentence for one driver; ``items`` is the case noun in the plural (``purchase order items``)."""
    item = item or _singular(items)
    x: float | None = None
    y: float | None = None
    d: float | None = None
    if _finite(c.value_slice, c.value_rest) and c.value_slice is not None and c.value_rest is not None:
        x, y = float(c.value_slice), float(c.value_rest)
        d = float(c.difference) if _finite(c.difference) and c.difference is not None else x - y
    kind = c.kind
    text: str | None = None
    if x is not None and y is not None and d is not None:
        if kind == "lag":
            unit = _UNIT_WORDS.get(c.unit or "", c.unit or "")
            here, there, diff = number(x), number(y), signed(d)
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: {here} {unit} here against {there} elsewhere ({diff} {unit})".replace("  ", " ")
        elif kind == "count":
            # counts and case attributes print the difference of the two numbers shown; durations keep the
            # analytics package's shift estimate, which the acceptance sentence pins
            here, there, diff = number(x, count=True), number(y, count=True), signed(round(x) - round(y), count=True)
            noun = _singular(c.count_noun or "events") if here == "1" else (c.count_noun or "events")
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: {here} {noun} per {item} here against {there} elsewhere ({diff})"
        elif kind == "share":
            here, there, diff = percent(x), percent(y), points(d)
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: amounts {here} apart here against {there} elsewhere ({diff})"
        elif kind == "metric":
            if is_share_unit(c.unit, x, y):
                here, there, diff = percent(x), percent(y), points(x - y)
                if here != there and not _rounds_to_zero(diff):
                    what = quantity_words(c.unit)
                    text = f"{c.name}: a {what} of {here} here against {there} elsewhere ({diff})"
            else:
                here, there, diff = number(x), number(y), signed(x - y)
                if here != there and not _rounds_to_zero(diff):
                    what = quantity_words(c.unit)
                    text = f"{c.name}: {here} {what} per {item} here against {there} elsewhere ({diff})"
    if text is not None:
        return Sentence(text, kind)
    return _rate_sentence(c, items) or _none_sentence(c)


def capitalised(text: str) -> str:
    """The sentence as a card prints it: first letter upper-cased, one full stop."""
    text = text.strip().rstrip(".")
    return f"{text[:1].upper()}{text[1:]}." if text else ""


__all__ = [
    "KINDS",
    "Comparison",
    "Sentence",
    "capitalised",
    "is_share_unit",
    "number",
    "percent",
    "points",
    "quantity_words",
    "readable_comparison",
    "signed",
]
