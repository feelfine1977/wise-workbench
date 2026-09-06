"""Plain sentences: real units, points below, kind of problem — all descriptive."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import wise
from wise.errors import NormError

import wise_analytics as wa
from wise_analytics.plain import (
    KIND_RULE,
    KINDS,
    comparison_sentence,
    comparisons,
    kind_reading,
    points_below,
    problem_kind,
    problem_kinds,
)
from wise_analytics.vocabulary import check_reading


def test_lag_sentence_in_real_units(synthetic_clean):
    _log, truth, result = synthetic_clean
    hs = truth.hotspots[0]
    c = wa.contrast_slice(result, "Finance", dict(hs.where), B=0)
    t = comparisons(c, top=3)
    assert t.index[0] == "c2" and t.loc["c2", "kind"] == "lag" and t.loc["c2", "unit"] == "days"
    assert t.loc["c2", "value_slice"] > t.loc["c2", "value_rest"] and t.loc["c2", "difference"] > 0
    s = t.loc["c2", "sentence"]
    assert (
        s.startswith("GR → INV within 10 days: ") and " days here against " in s and " elsewhere (+" in s and s.endswith(" days)")
    )
    assert "c2" not in s.replace("c2", "") and "constraint" not in s
    one = comparison_sentence(c, items="purchase order items")
    assert one.endswith(".") and one[0].isupper()
    check_reading(one)
    # the numbers in the sentence are the medians and the Hodges–Lehmann shift of the contrast table
    med_s, med_r, hl = (c.table.loc["c2", k] for k in ("median_slice", "median_rest", "hl_shift"))
    assert f"{med_s:.0f} days here" in s and f"+{hl:.0f} days" in s and (f"{med_r:.1f}" in s or f"{med_r:.0f}" in s)
    # a full template label carries the panel's wording
    tmpl = {"c2": "invoices arrive {slice} days after the goods here against {rest} elsewhere ({diff} days)"}
    custom = comparison_sentence(c, labels=tmpl)
    assert custom.startswith("Invoices arrive ") and "after the goods here against" in custom
    named = comparisons(c, labels={"c2": "goods receipt to invoice"}).loc["c2", "sentence"]
    assert named.startswith("goods receipt to invoice: ")


def test_rate_count_and_share_forms(p2p_result, synthetic_clean):
    c = wa.contrast_slice(p2p_result, "Finance", {"company": "B"}, B=0)
    t = comparisons(c, top=6)
    assert t.loc["c3", "kind"] == "share" and "% apart here against" in t.loc["c3", "sentence"]
    assert t.loc["c1", "kind"] == "rate" and t.loc["c1", "sentence"].startswith("33 % of items without Record Invoice Receipt")
    assert t.loc["c6", "sentence"].startswith("33 % of items with Cancel Invoice Receipt here against 0 % elsewhere")
    assert (t["share_of_gap"] > 0).all()
    labelled = comparisons(c, top=6, labels={"c1": "without an invoice"}, items="purchase order items")
    assert labelled.loc["c1", "sentence"] == "33 % of purchase order items without an invoice here against 0 % elsewhere"
    _log, truth, result = synthetic_clean
    hs = truth.hotspots[2]  # fragmentation: extra goods receipts
    c3 = wa.contrast_slice(result, "Logistics", dict(hs.where), B=0)
    t3 = comparisons(c3, top=1, labels={"c5": "receipt postings"}, items="purchase order items")
    assert t3.index[0] == "c5" and t3.loc["c5", "kind"] == "count"
    assert t3.loc["c5", "sentence"].startswith("3 receipt postings per purchase order item here against 1 elsewhere")
    default = comparisons(c3, top=1).loc["c5", "sentence"]
    assert default.startswith("3 Record Goods Receipt events per item here against 1 elsewhere")
    for s in list(t["sentence"]) + list(t3["sentence"]):
        check_reading(s)
    # a slice above the overall score can still carry one positive bar (company A: the long GR → INV lag of case A)
    above = wa.contrast_slice(p2p_result, "Finance", {"company": "A"}, B=0)
    assert above.summary["signed_gap"] < 0 and "c2" in comparisons(above).index
    # the perfect cases carry no positive bar at all
    perfect = result.scores["Finance"] >= 1.0
    assert perfect.sum() > 1
    clean = wa.contrast_slice(result, "Finance", perfect, B=0)
    assert comparisons(clean).empty
    assert comparison_sentence(clean, items="purchase order items") == (
        "No expectation is missed more often by these purchase order items than elsewhere."
    )


def test_points_below_wording():
    assert points_below(0.835, 0.844) == "0.9 points below the overall score of 84.4 (1 %)"
    assert points_below(0.714, 0.842) == "12.8 points below the overall score of 84.2 (15 %)"
    assert points_below(0.9, 0.9) == "at the overall score of 90.0"
    assert points_below(0.95, 0.9) == "5.0 points above the overall score of 90.0 (6 %)"
    assert points_below(float("nan"), 0.9) == "n/a"
    for text in (points_below(0.64, 0.71), points_below(0.5, 0.5)):
        check_reading(text)
        assert "%" not in text.split("(")[0]  # never a bare percent before the points


def test_problem_kind_rule():
    backlog = pd.DataFrame(
        {
            "n_cases": [100_000, 500, 5_000, 20_000, 3_000, 800],
            "stable_gap": [0.009, 0.09, 0.03, 0.0, 0.02, 0.05],
            "stable_PI": [900.0, 45.0, 150.0, 0.0, 60.0, 40.0],
        },
        index=pd.Index(["Packaging", "Real Estate", "Logistics", "Sales", "Additives", "Latex"], name="slice"),
    )
    k = problem_kind(backlog)
    assert k.loc["Packaging", "kind"] == "widespread" and k.loc["Real Estate", "kind"] == "acute"
    assert k.loc["Sales", "kind"] == "none" and np.isnan(k.loc["Sales", "gap_pct"])
    assert set(k["kind"]) <= set(KINDS) and k.attrs["rule"] == KIND_RULE == wa.KIND_RULE
    assert k.loc["Packaging", "hotspot"] == "reservoir" and k.loc["Real Estate", "hotspot"] == "severity"
    assert ((k["size_pct"] > 0) & (k["size_pct"] <= 1)).all()
    strict = problem_kind(backlog, threshold=0.99)
    assert (strict.loc[strict["kind"] != "none", "kind"] == "systematic").all()
    with pytest.raises(NormError):
        problem_kind(backlog.drop(columns="stable_gap"))


def test_kind_is_stable_across_views_for_the_planted_hotspot(synthetic_clean):
    _log, truth, result = synthetic_clean
    key = tuple(truth.hotspots[0].where[k] for k in ("company", "spend_area"))
    kinds = {}
    for view in result.views:
        bl = wise.prioritize(result, ["company", "spend_area"], view=view, gamma=20.0)
        kinds[view] = problem_kind(bl).loc[key, "kind"]
    assert kinds["Finance"] != "none" and len({v for v in kinds.values() if v != "none"}) == 1


def test_kind_reading_texts():
    for kind in KINDS:
        text = kind_reading(kind, items="purchase order items", plain_layer="invoices waiting too long")
        check_reading(text)
        assert text.startswith(kind) or kind == "none"
    assert kind_reading("systematic").endswith("explains most of it")
    assert kind_reading("systematic", plain_layer="repeated postings").endswith(": repeated postings")
    assert "purchase order items" in kind_reading("widespread", items="purchase order items")
    with pytest.raises(NormError):
        kind_reading("severe")


def test_problem_kinds_consolidates_across_views(synthetic_clean):
    _log, truth, result = synthetic_clean
    by = ["company", "spend_area"]
    k = problem_kinds(result, by, gamma=20.0)
    assert k.attrs["primary"] == "Finance" and {"kind", "kind__Finance", "kind__Logistics", "changes_sign", "hotspot"} <= set(
        k.columns
    )
    key = tuple(truth.hotspots[0].where[c] for c in by)
    assert k.loc[key, "kind"] == k.loc[key, "kind__Finance"] != "none"
    # wherever the gap is positive the consolidated kind is the primary view's kind
    for _idx, row in k.iterrows():
        if row["gap__Finance"] > 0:
            assert row["kind"] == row["kind__Finance"]
        if row["gap__Finance"] <= 0 and row["gap__Logistics"] > 0:
            assert row["kind"] == row["kind__Logistics"] and row["changes_sign"]
    flipped = problem_kinds(result, by, gamma=20.0, primary="Logistics")
    assert flipped.loc[key, "kind"] == flipped.loc[key, "kind__Logistics"]
    for _idx, row in flipped.iterrows():
        assert row["kind"] in KINDS
    with pytest.raises(NormError):
        problem_kinds(result, by, primary="Nope")
