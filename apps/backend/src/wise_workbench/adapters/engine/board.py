"""The explore board (R3-O12): facets, KPI tiles and the period breakdown under the canonical filter.

One selection, many panels. A board request carries the same ``filter`` as
the backlog, the flow and the lens, so that every panel answers for the same
cases. Three shapes are computed here from the run's per-case frame:

* **facets** — one row per value of a case attribute, of the flow type or of
  the case start period: how many cases carry it, how many of them miss at
  least one expectation, and how much priority is at stake on it;
* **KPI tiles** — items, share below expectation, priority at stake and open
  share for the whole selection, each with a plain sentence;
* **period breakdown** — the same rows ordered by time (``by=period``).

Definitions, once, so that the panels agree with the cards:

``cases``
    rows of the run's frame that pass the filter and carry the value.
``share_below_expectation``
    share of those cases whose score in the view is below 1, that is, cases
    that miss at least one expectation that applies to them.
``priority_at_stake``
    the library's stabilised Priority Index of the value as a group,
    ``PĨ = n · (μ̄ − μ̃)₊`` with the run's γ, measured against the **run's**
    baseline mean μ̄ (the mean of the unfiltered frame in that view) so that
    the number keeps its meaning when the board is filtered.
``open_share``
    share of the value's cases that are still open at the window end (the one
    censoring definition of the case table).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import wise

from wise_workbench.domain import ValidationError

BY_KINDS = ("attribute", "flow_type", "period")
PERIODS: dict[str, str] = {"month": "M", "quarter": "Q", "year": "Y", "week": "W"}
MISSING = "(missing)"


def _period_label(ts: pd.Timestamp, period: str) -> str:
    if period == "year":
        return f"{ts.year}"
    if period == "quarter":
        return f"{ts.year}-Q{(ts.month - 1) // 3 + 1}"
    if period == "week":
        iso = ts.isocalendar()
        return f"{int(iso[0])}-W{int(iso[1]):02d}"
    return f"{ts.year}-{ts.month:02d}"


def period_values(starts: pd.Series, period: str) -> pd.Series:
    """The case start period label per case ("2018-03"), ``(missing)`` without a start timestamp."""
    if period not in PERIODS:
        raise ValidationError(f"period must be one of {sorted(PERIODS)}", code="board.period")
    ts = pd.to_datetime(starts, errors="coerce")
    labels = [MISSING if pd.isna(t) else _period_label(t, period) for t in ts]
    return pd.Series(labels, index=starts.index, dtype=object)


def _values_of(frame: pd.DataFrame, column: str) -> pd.Series:
    col = frame[column]
    return col.astype(object).where(col.notna(), MISSING).astype(str)


def facet_values(
    frame: pd.DataFrame,
    *,
    by: str,
    attribute: str | None,
    flow_type_attribute: str,
    period: str,
    starts: pd.Series | None,
) -> tuple[pd.Series, str]:
    """The facet value per case and the name of the field it comes from."""
    if by not in BY_KINDS:
        raise ValidationError(f"by must be one of {list(BY_KINDS)}", code="board.by")
    if by == "period":
        if starts is None:
            raise ValidationError(
                "the case table has no case start timestamp; the period facet needs one", code="board.period_column"
            )
        return period_values(starts.reindex(frame.index), period), "case start"
    field = attribute if by == "attribute" else flow_type_attribute
    if not field:
        raise ValidationError("by=attribute needs the attribute parameter", code="board.attribute")
    if field not in frame.columns:
        available = [str(c) for c in frame.columns if not str(c).startswith(("score__", "penalty__", "contrib__"))]
        raise ValidationError(
            f"attribute {field!r} is not in the case table; available: {available[:30]}", code="board.attribute"
        )
    return _values_of(frame, field), field


def facet_table(
    frame: pd.DataFrame,
    values: pd.Series,
    *,
    view: str,
    gamma: float,
    baseline: float,
    censored: pd.Series | None = None,
    exposure: pd.Series | None = None,
) -> pd.DataFrame:
    """One row per facet value: cases, share, mean score, share below expectation, priority at stake, open share."""
    score_col = f"score__{view}"
    if score_col not in frame.columns:
        raise ValidationError(f"view {view!r} is not part of this run", code="board.view")
    work = pd.DataFrame({"__value__": values.reindex(frame.index).fillna(MISSING), "score": frame[score_col]})
    scored = work["score"].notna()
    n_total = len(work)
    with_score = work[scored]
    if with_score.empty:
        return pd.DataFrame(
            columns=[
                "value",
                "cases",
                "share",
                "mean_score",
                "cases_below",
                "share_below_expectation",
                "gap",
                "stable_gap",
                "PI",
                "priority_at_stake",
                "open_cases",
                "open_share",
                "exposure",
            ]
        )
    pri = wise.prioritize(
        with_score.rename(columns={"score": "score"}),
        ["__value__"],
        gamma=gamma,
        min_cases=1,
        baseline=baseline,
        score_col="score",
    )
    below = (with_score["score"] < 1.0).groupby(with_score["__value__"], observed=True).agg(["sum", "count"])
    out = pd.DataFrame(
        {
            "value": [str(v) for v in pri.index],
            "cases": pri["n_cases"].to_numpy(dtype=int),
            "mean_score": pri["mean_score"].to_numpy(dtype=float),
            "gap": pri["gap"].to_numpy(dtype=float),
            "stable_gap": pri["stable_gap"].to_numpy(dtype=float),
            "PI": pri["PI"].to_numpy(dtype=float),
            "priority_at_stake": pri["stable_PI"].to_numpy(dtype=float),
        }
    )
    out["share"] = out["cases"] / max(n_total, 1)
    out["cases_below"] = [int(below["sum"].get(v, 0)) for v in out["value"]]
    out["share_below_expectation"] = [
        (int(below["sum"].get(v, 0)) / int(below["count"].get(v, 1))) if int(below["count"].get(v, 0)) else None
        for v in out["value"]
    ]
    if censored is not None:
        c = censored.reindex(frame.index, fill_value=False).astype(bool)
        grouped = c.groupby(work["__value__"], observed=True).agg(["sum", "count"])
        out["open_cases"] = [int(grouped["sum"].get(v, 0)) for v in out["value"]]
        out["open_share"] = [
            (int(grouped["sum"].get(v, 0)) / int(grouped["count"].get(v, 1)))
            if int(grouped["count"].get(v, 0))
            else None
            for v in out["value"]
        ]
    else:
        out["open_cases"] = None
        out["open_share"] = None
    if exposure is not None:
        e = pd.to_numeric(exposure.reindex(frame.index), errors="coerce").fillna(0.0)
        summed = e.groupby(work["__value__"], observed=True).sum()
        out["exposure"] = [float(summed.get(v, 0.0)) for v in out["value"]]
    else:
        out["exposure"] = None
    return out


def order_facets(table: pd.DataFrame, *, by: str, sort: str) -> pd.DataFrame:
    """Periods in time order, everything else by the chosen measure (descending)."""
    if table.empty:
        return table
    if by == "period" and sort in ("period", "value"):
        return table.sort_values("value", kind="mergesort")
    column = {
        "-priority": "priority_at_stake",
        "priority": "priority_at_stake",
        "-cases": "cases",
        "cases": "cases",
        "-share_below": "share_below_expectation",
        "share_below": "share_below_expectation",
    }.get(sort, "priority_at_stake")
    ascending = not sort.startswith("-") if sort in ("cases", "priority", "share_below") else False
    return table.sort_values([column, "cases"], ascending=[ascending, False], kind="mergesort")


def _pct(value: float | None) -> str:
    """A share in words; one decimal near the ends so that 99.9 % never reads as 100 %."""
    if value is None or not np.isfinite(value):
        return "not computed"
    p = float(value) * 100
    if p in (0.0, 100.0):
        return f"{p:.0f} %"
    if p < 10 or p > 99:
        return f"{p:.1f} %"
    return f"{p:.0f} %"


def kpi_tiles(
    *,
    cases: int,
    cases_total: int,
    mean_score: float | None,
    baseline: float | None,
    cases_below: int,
    scored: int,
    priority_at_stake: float,
    groups: int,
    open_cases: int | None,
    censored_known: bool,
    noun: str,
    grouping_label: str,
    window_end: str | None,
) -> list[dict[str, Any]]:
    """The four tiles of the board with a plain sentence each (R3-O12)."""
    share_below = (cases_below / scored) if scored else None
    open_share = (open_cases / cases) if (censored_known and cases and open_cases is not None) else None
    selected = "all" if cases >= cases_total else f"{_pct(cases / max(cases_total, 1))} of all"
    tiles: list[dict[str, Any]] = [
        {
            "id": "items",
            "label": noun[:1].upper() + noun[1:],
            "value": float(cases),
            "format": "count",
            "unit": noun,
            "text": f"{cases:,} {noun} in this selection ({selected} {cases_total:,}).",
        },
        {
            "id": "share_below_expectation",
            "label": "Below expectation",
            "value": None if share_below is None else float(share_below),
            "format": "share",
            "unit": None,
            "text": (
                f"{_pct(share_below)} of the {scored:,} scored {noun} miss at least one expectation."
                if share_below is not None
                else f"No scored {noun} in this selection."
            ),
        },
        {
            "id": "priority_at_stake",
            "label": "Priority at stake",
            "value": float(priority_at_stake),
            "format": "index",
            "unit": "priority",
            "text": (
                f"{priority_at_stake:,.1f} priority carried by the {groups:,} {grouping_label} in this selection "
                f"(shortfall against the overall score of {baseline * 100:.1f}, small groups discounted)."
                if baseline is not None
                else f"{priority_at_stake:,.1f} priority carried by the {groups:,} {grouping_label} in this selection."
            ),
        },
        {
            "id": "open_share",
            "label": "Still open",
            "value": None if open_share is None else float(open_share),
            "format": "share",
            "unit": None,
            "text": (
                f"{_pct(open_share)} of these {noun} are still open at the end of the data"
                + (f" ({window_end[:10]})." if window_end else ".")
                if open_share is not None
                else "Open cases cannot be told apart: the mapping names no closure activity."
            ),
        },
    ]
    if mean_score is not None and baseline is not None:
        tiles.append(
            {
                "id": "mean_score",
                "label": "Score",
                "value": float(mean_score) * 100,
                "format": "points",
                "unit": "points",
                # one comparison, one bracket (R3-04): the difference of the two numbers this sentence prints
                "text": (
                    f"{mean_score * 100:.1f} points on average against {baseline * 100:.1f} over the whole run "
                    f"({float(f'{mean_score * 100:.1f}') - float(f'{baseline * 100:.1f}'):+.1f})."
                ),
            }
        )
    return tiles
