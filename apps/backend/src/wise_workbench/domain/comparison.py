"""The real-unit comparison sentence of a group, in one readable form per kind of number.

The analytics package contrasts a group with everyone else and reports, per
expectation, medians in real units, the shift, and the shares missing the
expectation here and elsewhere. This module turns one such row into the
sentence a card and the reason screen print — always "<expectation>: <here>
here against <elsewhere> elsewhere (<difference>)" with at most three numbers
(``docs/panel/ui_design_cycle2.md`` §2.7):

* durations: ``Paid within terms: 83 days here against 55 elsewhere (+28 days)``,
* counts: ``Received in few deliveries: 14 Record Goods Receipt events per
  purchase order item here against 1 elsewhere (+13)``,
* shares: ``Mostly automatic: a manual share of 83 % here against 80 %
  elsewhere (+3 points)``,
* other case attributes: ``Short event chain: 18 events per purchase order
  item here against 5 elsewhere (+13)``,
* the share of items missing the expectation, when no real-unit value is
  available: ``Invoice paid: missed in 67 % of purchase order items here
  against 22 % elsewhere (+45 points)``.

**One comparison, one bracket** (R3-04). The bracket is the difference of the
two numbers the sentence prints, at the precision of the coarser of the two,
with its sign, computed from the printed numbers rather than from the values
behind them: a reader who subtracts what is on the page must arrive at what is
in the brackets. *12 % here against 5.9 %* therefore brackets ``+6 points``,
not ``+6.1``: the first number is printed to whole per cent and a difference
cannot be finer than the coarser of the two numbers it comes from. The
analytics package's own shift estimate — a Hodges–Lehmann shift, which is not
the difference of two medians — keeps its own row in the contrast table,
labelled as such, and never appears in this sentence.

The rule is enforced on the way out as well as on the way in:
:func:`with_printed_bracket` rewrites the bracket of a sentence that was
rendered by an earlier form of this module, so a run scored before the rule
existed cannot serve a sentence that breaks it, and
:func:`bracket_is_difference` reads a rendered sentence back so a test can
assert the rule over every sentence a run serves.

When the difference of the printed numbers rounds to zero the sentence falls
back on the shares missing the expectation; when those round to the same value
as well it says ``No material difference on the top expectation
(<expectation>)``.
"""

from __future__ import annotations

import math
import re
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
    """A difference of two shares in percentage points (``+25 points``, ``+3 points``, ``-0.6 points``).

    A whole number keeps no decimal: the difference of *83 %* and *80 %* is three points, not 3.0.
    """
    p = abs(float(diff)) * 100
    s = f"{p:.0f}" if p >= 10 else f"{p:.1f}".removesuffix(".0")
    return f"{'+' if diff > 0 else '-'}{s} points"


def _rounds_to_zero(text: str) -> bool:
    return text.lstrip("+-").replace(",", "").rstrip("%").strip() in ("0", "0.0")


def printed_value(text: str) -> float:
    """The number a printed fragment shows (``"1,674.9"`` → 1674.9, ``"83 %"`` → 83.0).

    The comparison bracket is the difference of the two numbers the sentence prints (R3-04), so it is computed
    from the printed forms and not from the values behind them: 100.4 days against 1.64 prints *100 days here
    against 1.6 elsewhere*, and the bracket is +98 days, not the +99 the raw values would give.
    """
    cleaned = text.replace(",", "").replace("%", "").replace("+", "").strip()
    return float(cleaned)


def printed_decimals(text: str) -> int:
    """How many decimals a printed fragment carries (``"83"`` → 0, ``"5.9 %"`` → 1)."""
    cleaned = text.replace(",", "").replace("%", "").strip()
    return len(cleaned.split(".")[1]) if "." in cleaned else 0


def _round_half_up(value: float, digits: int) -> float:
    """Half away from zero, so the rounding does not depend on the parity of the digit before it."""
    factor = 10.0**digits
    scaled = value * factor
    return math.floor(scaled + 0.5) / factor if scaled >= 0 else -math.floor(-scaled + 0.5) / factor


def printed_difference(here: str, there: str) -> float:
    """The difference of two printed numbers, in the unit they are printed in and at the precision of the
    coarser of the two: *12 %* against *5.9 %* is six points, not 6.1 (R3-04)."""
    digits = min(printed_decimals(here), printed_decimals(there))
    return _round_half_up(printed_value(here) - printed_value(there), digits)


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
    diff = points(printed_difference(here, there) / 100)
    return Sentence(f"{c.name}: missed in {here} of {items} here against {there} elsewhere ({diff})", "rate")


def _none_sentence(c: Comparison) -> Sentence:
    return Sentence(f"no material difference on the top expectation ({c.name})", "none")


def readable_comparison(c: Comparison, *, items: str = "items", item: str | None = None) -> Sentence:
    """The sentence for one driver; ``items`` is the case noun in the plural (``purchase order items``)."""
    item = item or _singular(items)
    x: float | None = None
    y: float | None = None
    if _finite(c.value_slice, c.value_rest) and c.value_slice is not None and c.value_rest is not None:
        x, y = float(c.value_slice), float(c.value_rest)
    kind = c.kind
    text: str | None = None
    if x is not None and y is not None:
        if kind == "lag":
            unit = _UNIT_WORDS.get(c.unit or "", c.unit or "")
            here, there = number(x), number(y)
            diff = signed(printed_difference(here, there))
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: {here} {unit} here against {there} elsewhere ({diff} {unit})".replace("  ", " ")
        elif kind == "count":
            here, there = number(x, count=True), number(y, count=True)
            diff = signed(printed_difference(here, there), count=True)
            noun = _singular(c.count_noun or "events") if here == "1" else (c.count_noun or "events")
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: {here} {noun} per {item} here against {there} elsewhere ({diff})"
        elif kind == "share":
            here, there = percent(x), percent(y)
            diff = points(printed_difference(here, there) / 100)
            if here != there and not _rounds_to_zero(diff):
                text = f"{c.name}: amounts {here} apart here against {there} elsewhere ({diff})"
        elif kind == "metric":
            if is_share_unit(c.unit, x, y):
                here, there = percent(x), percent(y)
                diff = points(printed_difference(here, there) / 100)
                if here != there and not _rounds_to_zero(diff):
                    what = quantity_words(c.unit)
                    text = f"{c.name}: a {what} of {here} here against {there} elsewhere ({diff})"
            else:
                here, there = number(x), number(y)
                diff = signed(printed_difference(here, there))
                if here != there and not _rounds_to_zero(diff):
                    what = quantity_words(c.unit)
                    text = f"{c.name}: {here} {what} per {item} here against {there} elsewhere ({diff})"
    if text is not None:
        return Sentence(text, kind)
    return _rate_sentence(c, items) or _none_sentence(c)


_NUMBER = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")


@dataclass(frozen=True)
class _Printed:
    """A rendered comparison read back: the two numbers it prints, its bracket, and where the bracket sits."""

    here: str
    there: str
    bracket: str
    start: int
    end: int

    @property
    def unit(self) -> str:
        """The words after the number inside the bracket (``days``, ``points``), if any."""
        m = _NUMBER.search(self.bracket)
        return self.bracket[m.end() :].strip() if m else ""


def _read_back(text: str | None) -> _Printed | None:
    """The printed parts of a comparison sentence, or ``None`` when it carries no comparison."""
    if not text or " here against " not in text or "(" not in text or ")" not in text:
        return None
    head, rest = text.split(" here against ", 1)
    offset = len(head) + len(" here against ")
    right = rest.split(" elsewhere", 1)[0]
    start, end = rest.rfind("("), rest.rfind(")")
    if start < 0 or end < start:
        return None
    bracket = rest[start + 1 : end]
    here = _NUMBER.findall(head)
    there = _NUMBER.findall(right)
    if not here or not there or not _NUMBER.findall(bracket):
        return None
    return _Printed(here[-1], there[0], bracket, offset + start + 1, offset + end)


def bracket_check(text: str | None) -> tuple[float, float, float] | None:
    """The two numbers a comparison sentence prints and the number in its brackets, or ``None``.

    The invariant of R3-04 — *one comparison, one bracket* — is that the third number is the difference of the
    first two. This reads a rendered sentence back so that a test can assert it on every sentence a run produces,
    wherever the sentence was built.
    """
    parsed = _read_back(text)
    if parsed is None:
        return None
    inside = _NUMBER.findall(parsed.bracket)[0]
    return printed_value(parsed.here), printed_value(parsed.there), printed_value(inside)


def printed_bracket(here: str, there: str, unit: str = "") -> str:
    """The bracket a pair of printed numbers must carry: their difference, at the precision of the coarser of
    the two, with its sign and the unit the sentence prints (``+28 days``, ``+6 points``)."""
    digits = min(printed_decimals(here), printed_decimals(there))
    value = printed_difference(here, there)
    sign = "+" if value > 0 else "-" if value < 0 else ""
    body = f"{abs(value):,.{digits}f}"
    return f"{sign}{body} {unit}".strip()


def with_printed_bracket(text: str | None) -> str | None:
    """The same comparison sentence with its bracket made to agree with the two numbers beside it (R3-04).

    A run scored before this rule existed holds sentences whose bracket is the analytics package's shift
    estimate — *83 days here against 55 elsewhere (+25 days)* — in artefacts on disk, and nothing recomputes
    them when it is read. The rule is therefore applied where the sentence leaves the service as well as where
    it is written: the two numbers are the reader's, the bracket is derived from them, and a sentence this
    cannot read back is returned exactly as it came, since a wrong rewrite would be worse than the number it
    replaces.
    """
    parsed = _read_back(text)
    if parsed is None or text is None:
        return text
    try:
        bracket = printed_bracket(parsed.here, parsed.there, parsed.unit)
    except ValueError:
        return text
    return text[: parsed.start] + bracket + text[parsed.end :]


def bracket_is_difference(text: str | None) -> bool | None:
    """Whether a rendered comparison keeps the rule of R3-04; ``None`` when the sentence carries no comparison.

    The bracket is printed at the precision of the coarser of the two numbers beside it — *100 days here
    against 1.6 elsewhere* brackets ``+98``, not ``+98.4``, and *12 % against 5.9 %* brackets ``+6``, not
    ``+6.1`` — so the reading is exact and the tolerance only absorbs the last printed digit.
    """
    parsed = _read_back(text)
    if parsed is None:
        return None
    try:
        expected = printed_difference(parsed.here, parsed.there)
        printed = printed_value(_NUMBER.findall(parsed.bracket)[0])
    except ValueError:
        return None
    return abs(expected - printed) <= 0.05 + 1e-9


def capitalised(text: str) -> str:
    """The sentence as a card prints it: first letter upper-cased, one full stop."""
    text = text.strip().rstrip(".")
    return f"{text[:1].upper()}{text[1:]}." if text else ""


__all__ = [
    "KINDS",
    "Comparison",
    "Sentence",
    "bracket_check",
    "bracket_is_difference",
    "capitalised",
    "is_share_unit",
    "number",
    "percent",
    "points",
    "printed_bracket",
    "printed_decimals",
    "printed_difference",
    "printed_value",
    "quantity_words",
    "readable_comparison",
    "signed",
    "with_printed_bracket",
]
