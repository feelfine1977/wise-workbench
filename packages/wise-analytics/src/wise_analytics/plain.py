"""Plain-vocabulary sentences for cards and readings.

The comprehension test of the cycle 1 review (§9) showed that a card is
read correctly only when it says (a) how far the group is off in score
points with the percent in brackets, (b) what is wrong in real units, and
(c) what kind of problem it is in business words. This module produces
those three sentences from the package's own results, without a constraint
id and without method terms:

* :func:`comparison_sentence` / :func:`comparisons` — one real-unit
  sentence per top driver of a :class:`~wise_analytics.contrast.SliceContrast`
  ("invoices clear 83 days after receipt here against 55 elsewhere
  (+25 days)"; "14 receipt postings per item here against 1 elsewhere";
  "62 % of items without an invoice here against 10 % elsewhere"),
* :func:`problem_kind` / :func:`kind_reading` — acute / systematic /
  widespread from the group's own gap and size against the backlog's
  distributions (:data:`KIND_RULE`), with the library's relative hotspot
  type kept as an alias,
* :func:`points_below` — "0.9 points below the overall score of 84.4 (1 %)".

Every sentence is descriptive (:mod:`wise_analytics.vocabulary`): a group
*carries* a shortfall, a driver *is missed more often*, nothing is a cause.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd
import wise
from wise.errors import NormError

from ._common import pct
from .contrast import SliceContrast

KIND_THRESHOLD = 1.0 / 3.0

KINDS = ("acute", "systematic", "widespread", "none")

KIND_RULE = (
    "Kind of problem from the group's own numbers. Among the slices of the backlog with a positive stabilised gap, "
    "gap_pct is the percentile rank of the group's stabilised gap and size_pct the percentile rank of its case count "
    "among all slices. 'widespread' (many cases, each slightly off) when size_pct − gap_pct ≥ 1/3; 'acute' (few cases, "
    "far off) when gap_pct − size_pct ≥ 1/3; 'systematic' otherwise (one kind of problem explains most of it — see the "
    "top driver). A group at or above the overall score has kind 'none'. Across views a group keeps the kind of the "
    "primary view wherever its gap is positive (problem_kinds); only a gap that changes sign changes the kind. The "
    "library's relative hotspot type (reservoir / severity / mechanism among the top slices) is kept as an alias in "
    "the 'hotspot' column."
)

_UNIT_WORDS = {
    "D": "days",
    "W": "weeks",
    "h": "hours",
    "min": "minutes",
    "s": "seconds",
    "ms": "milliseconds",
}

_SHIFTED = ("whole distribution shifted", "tail shifted")


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _finite(*values: Any) -> bool:
    return all(v is not None and np.isfinite(float(v)) for v in values)


def _num(v: float, *, count: bool = False) -> str:
    """Real-unit number: whole numbers for counts and for values of 10 or more, one decimal below."""
    v = float(v)
    if count or abs(v) >= 10 or abs(v - round(v)) < 0.05:
        return f"{v:.0f}"
    return f"{v:.1f}"


def _signed(v: float, *, count: bool = False) -> str:
    s = _num(abs(v), count=count)
    return f"+{s}" if v > 0 else (f"-{s}" if v < 0 else "±0")


def _join(labels: Any) -> str:
    items = [str(x) for x in (labels if isinstance(labels, list | tuple) else [labels])]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def _singular(items: str) -> str:
    return items[:-1] if items.endswith("s") and len(items) > 1 else items


def _fill(template: str, **values: Any) -> str:
    return template.format_map(_Safe(values))


def _row_kind(row: pd.Series, c: wise.Constraint | None, ctype: str) -> tuple[str, float, float, float, str]:
    """Which sentence form a driver gets, with the two real-unit values, the difference and the unit word."""
    x, y, d = row["median_slice"], row["median_rest"], row["hl_shift"]
    if not _finite(d) and _finite(x, y):
        d = x - y
    pattern = str(row["pattern"])
    unit = str(row["unit"])
    if ctype == "lag":
        word = _UNIT_WORDS.get(unit, unit)
        if _finite(x, y) and pattern in _SHIFTED:
            return "lag", float(x), float(y), float(d), word
        return "rate", np.nan, np.nan, np.nan, word
    if ctype == "singularity":
        if _finite(x, y) and pattern in _SHIFTED and abs(float(x) - float(y)) >= 0.5:
            return "count", float(x), float(y), float(d), "count"
        return "rate", np.nan, np.nan, np.nan, "count"
    if ctype == "balance":
        if _finite(x, y) and pattern in _SHIFTED:
            return "share", float(x), float(y), float(d), "relative difference"
        return "rate", np.nan, np.nan, np.nan, "relative difference"
    if ctype == "metric":
        if _finite(x, y) and pattern in _SHIFTED:
            return "metric", float(x), float(y), float(d), unit
        return "rate", np.nan, np.nan, np.nan, unit
    return "rate", np.nan, np.nan, np.nan, unit


def _default_rate_phrase(c: wise.Constraint | None, ctype: str, description: str) -> tuple[str, str]:
    """``(prefix, condition)`` for the rate form: "{p} of items {condition} here against …"."""
    if isinstance(c, wise.Presence):
        act = _join(c.activity)
        return "", f"without {act}" if c.m <= 1 else f"with fewer than {c.m} {act}"
    if isinstance(c, wise.Exclusion):
        scope = (f" after {_join(c.after)}" if c.after else "") + (f" before {_join(c.before)}" if c.before else "")
        return "", f"with {_join(c.activity)}{scope}"
    if isinstance(c, wise.Singularity):
        return "", f"with more than {c.k} {_join(c.activity)}"
    if isinstance(c, wise.Precedence):
        return "", f"with {_join(c.b)} before {_join(c.a)}"
    if isinstance(c, wise.Balance):
        return "", f"where {description or 'the two amounts'} differ by more than {pct(c.tau)}"
    return description or "this expectation", "missed by"


def comparisons(
    contrast: SliceContrast,
    top: int = 3,
    *,
    labels: Mapping[str, str] | None = None,
    items: str = "items",
    item: str | None = None,
    norm: wise.Norm | None = None,
) -> pd.DataFrame:
    """One real-unit comparison per top driver of a slice contrast.

    Drivers are the constraints with a positive waterfall bar, in the
    contrast's order. Each gets a ``kind`` and a sentence:

    ``lag``
        medians in the constraint's unit with the Hodges–Lehmann shift in
        brackets ("… 83 days here against 55 elsewhere (+25 days)"), when
        the contrast reads the distribution as shifted,
    ``count``
        medians of the counted activity per item ("14 receipt postings per
        item here against 1 elsewhere"),
    ``share``
        medians of a relative difference as percentages,
    ``metric``
        medians of a case attribute with the shift in brackets,
    ``rate``
        the share of items missing the expectation here against elsewhere
        ("62 % of items without an invoice here against 10 % elsewhere") —
        also the fallback when no real-unit shift is material.

    ``labels`` maps constraint ids to plain phrases: for ``lag`` the name
    of the lag, for ``count`` the counted thing in the plural, for ``rate``
    the condition ("without an invoice"), for ``share`` and ``metric`` the
    quantity; a label containing ``{`` is a full template with the fields
    ``slice``, ``rest``, ``diff``, ``unit``, ``rate_slice``, ``rate_rest``,
    ``items`` and ``item``. Without a label the norm's description (or the
    activity names, when ``norm`` or the contrast's norm is available) is
    used. ``items`` is the case notion's business name ("purchase order
    items"); ``item`` its singular.

    Returns a table indexed by constraint: ``kind``, ``description``,
    ``value_slice``, ``value_rest``, ``difference``, ``unit``,
    ``rate_slice``, ``rate_rest``, ``share_of_gap``, ``sentence``.
    """
    norm = norm if norm is not None else contrast.norm
    item = item or _singular(items)
    lab = dict(labels or {})
    table = contrast.table
    drivers = table[table["delta"] > 0].head(int(top))
    rows = []
    for cid, r in drivers.iterrows():
        nc = norm.get_constraint(str(cid)) if norm is not None else None
        c = nc.constraint if nc is not None else None
        ctype = str(r["type"])
        description = str(r["description"] or "")
        kind, x, y, d, unit = _row_kind(r, c, ctype)
        ps, pr = r["rate_slice"], r["rate_rest"]
        custom = lab.get(str(cid))
        fields = {
            "slice": _num(x, count=kind == "count") if _finite(x) else "n/a",
            "rest": _num(y, count=kind == "count") if _finite(y) else "n/a",
            "diff": _signed(d, count=kind == "count") if _finite(d) else "n/a",
            "unit": unit,
            "rate_slice": pct(ps),
            "rate_rest": pct(pr),
            "items": items,
            "item": item,
        }
        if kind == "share":
            fields.update({"slice": pct(x), "rest": pct(y), "diff": f"{'+' if d >= 0 else '-'}{pct(abs(d))}"})
        if custom and "{" in custom:
            sentence = _fill(custom, **fields)
        elif kind == "lag":
            name = custom or description or "the lag"
            sentence = f"{name}: {fields['slice']} {unit} here against {fields['rest']} elsewhere ({fields['diff']} {unit})"
            if str(r["pattern"]) == "tail shifted" and _finite(r["q90_shift"]):
                sentence += f"; the slowest tenth differ by {_signed(float(r['q90_shift']))} {unit}"
        elif kind == "count":
            thing = custom or (f"{_join(c.activity)} events" if isinstance(c, wise.Singularity) else description or "events")
            sentence = f"{fields['slice']} {thing} per {item} here against {fields['rest']} elsewhere"
        elif kind == "share":
            name = custom or description or "the two amounts"
            sentence = f"{name}: {fields['slice']} apart here against {fields['rest']} elsewhere"
        elif kind == "metric":
            name = custom or description or "the value"
            sentence = f"{name}: {fields['slice']} here against {fields['rest']} elsewhere ({fields['diff']})"
        else:
            if not _finite(ps, pr):
                sentence = f"{custom or description or 'this expectation'}: no material difference here against elsewhere"
            else:
                prefix, condition = _default_rate_phrase(c, ctype, description)
                if custom:
                    prefix, condition = "", custom
                if prefix:
                    sentence = (
                        f"{prefix}: {condition} {fields['rate_slice']} of {items} here against {fields['rate_rest']} elsewhere"
                    )
                else:
                    sentence = f"{fields['rate_slice']} of {items} {condition} here against {fields['rate_rest']} elsewhere"
        rows.append(
            {
                "constraint": cid,
                "kind": kind,
                "description": description,
                "value_slice": x if kind != "rate" else np.nan,
                "value_rest": y if kind != "rate" else np.nan,
                "difference": d if kind != "rate" else np.nan,
                "unit": unit,
                "rate_slice": float(ps) if _finite(ps) else np.nan,
                "rate_rest": float(pr) if _finite(pr) else np.nan,
                "share_of_gap": float(r["share_of_gap"]) if _finite(r["share_of_gap"]) else np.nan,
                "sentence": sentence,
            }
        )
    cols = [
        "constraint",
        "kind",
        "description",
        "value_slice",
        "value_rest",
        "difference",
        "unit",
        "rate_slice",
        "rate_rest",
        "share_of_gap",
        "sentence",
    ]
    return pd.DataFrame(rows, columns=cols).set_index("constraint")


def comparison_sentence(
    contrast: SliceContrast,
    top: int = 1,
    *,
    labels: Mapping[str, str] | None = None,
    items: str = "items",
    item: str | None = None,
    norm: wise.Norm | None = None,
) -> str:
    """The real-unit comparison sentence(s) of the ``top`` drivers of a slice
    contrast, joined into one string (see :func:`comparisons`). A slice
    that misses no expectation more often than the rest gets a sentence
    saying so."""
    t = comparisons(contrast, top, labels=labels, items=items, item=item, norm=norm)
    if t.empty:
        return f"No expectation is missed more often by these {items} than elsewhere."
    return " ".join(f"{s[0].upper()}{s[1:]}." for s in t["sentence"].tolist() if s)


# ----------------------------------------------------------------------------- kind of problem
def problem_kind(
    backlog: pd.DataFrame,
    *,
    threshold: float = KIND_THRESHOLD,
    gap_col: str = "stable_gap",
    size_col: str = "n_cases",
) -> pd.DataFrame:
    """Kind of problem per slice of a backlog by :data:`KIND_RULE`.

    Returns a table indexed like ``backlog`` with ``kind`` (acute /
    systematic / widespread / none), ``gap_pct``, ``size_pct`` and
    ``hotspot`` (the library's relative type for the top slices, else
    ``None``).
    """
    for col in (gap_col, size_col):
        if col not in backlog.columns:
            raise NormError(f"backlog has no column {col!r}")
    gap = backlog[gap_col].astype(float)
    size = backlog[size_col].astype(float)
    positive = gap > 0
    gap_pct = pd.Series(np.nan, index=backlog.index, dtype=float)
    if positive.any():
        gap_pct[positive] = gap[positive].rank(method="average", pct=True)
    size_pct = size.rank(method="average", pct=True)
    kind = pd.Series("systematic", index=backlog.index, dtype=object)
    kind[(size_pct - gap_pct) >= threshold] = "widespread"
    kind[(gap_pct - size_pct) >= threshold] = "acute"
    kind[~positive] = "none"
    out = pd.DataFrame({"kind": kind, "gap_pct": gap_pct, "size_pct": size_pct})
    out["hotspot"] = None
    if "stable_PI" in backlog.columns:
        try:
            hot = wise.hotspot_table(backlog)
            out.loc[hot.index, "hotspot"] = hot["hotspot"].to_numpy()
        except (KeyError, ValueError, TypeError):
            pass
    out.attrs["rule"] = KIND_RULE
    out.attrs["threshold"] = float(threshold)
    return out


def problem_kinds(
    result: wise.ScoreResult,
    by: str | Sequence[str],
    *,
    gamma: float = 0.0,
    views: Sequence[str] | None = None,
    primary: str | None = None,
    threshold: float = KIND_THRESHOLD,
    volume: str = "cases",
) -> pd.DataFrame:
    """One kind of problem per slice across views.

    The kind is computed per view with :func:`problem_kind`
    (``kind__<view>`` columns, with ``gap__<view>``) and consolidated into
    ``kind``: the kind of the ``primary`` view (default: the first view
    scored) carried into every view where the slice's gap is positive; a
    slice at or above the overall score in the primary view takes its
    kind from the first view where its gap is positive. ``changes_sign``
    marks slices whose gap is positive in some views and not in others —
    the only case in which a group legitimately has different kinds.
    """
    by_l = [by] if isinstance(by, str) else list(by)
    names = list(views) if views is not None else list(result.views)
    if not names:
        raise NormError("no views to compute kinds for")
    primary = primary or names[0]
    if primary not in names:
        raise NormError(f"primary view {primary!r} is not among {names}")
    per: dict[str, pd.DataFrame] = {}
    for v in names:
        bl = wise.prioritize(result, by_l, view=v, gamma=gamma, volume=volume)
        per[v] = problem_kind(bl, threshold=threshold).join(bl[["stable_gap"]])
    index = per[primary].index
    for v in names:
        index = index.union(per[v].index)
    out = pd.DataFrame(index=index)
    for v in names:
        out[f"kind__{v}"] = per[v]["kind"].reindex(index).fillna("none")
        out[f"gap__{v}"] = per[v]["stable_gap"].reindex(index)
    positive = pd.DataFrame({v: out[f"gap__{v}"] > 0 for v in names})
    consolidated = out[f"kind__{primary}"].copy()
    for key in index:
        if consolidated.loc[key] == "none":
            others = [out.loc[key, f"kind__{v}"] for v in names if out.loc[key, f"kind__{v}"] != "none"]
            consolidated.loc[key] = others[0] if others else "none"
    out.insert(0, "kind", consolidated)
    out["changes_sign"] = positive.any(axis=1) & ~positive.all(axis=1)
    out["hotspot"] = per[primary]["hotspot"].reindex(index)
    out.attrs.update({"rule": KIND_RULE, "threshold": float(threshold), "primary": primary, "views": names})
    return out


def kind_reading(kind: str, *, items: str = "items", plain_layer: str | None = None) -> str:
    """The plain sentence for a kind of problem."""
    if kind == "acute":
        return f"acute: few {items}, far off the overall score"
    if kind == "widespread":
        return f"widespread: many {items}, each slightly off"
    if kind == "systematic":
        return "systematic: one kind of problem explains most of it" + (f": {plain_layer}" if plain_layer else "")
    if kind == "none":
        return "at or above the overall score: no shortfall"
    raise NormError(f"unknown kind {kind!r}; known: {KINDS}")


def points_below(mean_score: float, global_mean: float, *, scale: float = 100.0, digits: int = 1) -> str:
    """Distance of a group's score from the overall score in score points with the percent in brackets.

    ``"0.9 points below the overall score of 84.4 (1 %)"`` for a mean
    score of 0.835 against 0.844 — never a bare percent, which readers take
    for a share of items.
    """
    g = float(global_mean) * scale
    d = (float(global_mean) - float(mean_score)) * scale
    if not np.isfinite(g) or not np.isfinite(d):
        return "n/a"
    if abs(d) < 0.5 * 10.0 ** (-digits):
        return f"at the overall score of {g:.{digits}f}"
    word = "below" if d > 0 else "above"
    share = f" ({abs(d) / g * 100:.0f} %)" if g > 0 else ""
    return f"{abs(d):.{digits}f} points {word} the overall score of {g:.{digits}f}{share}"


__all__ = [
    "KINDS",
    "KIND_RULE",
    "KIND_THRESHOLD",
    "comparison_sentence",
    "comparisons",
    "kind_reading",
    "points_below",
    "problem_kind",
    "problem_kinds",
]
