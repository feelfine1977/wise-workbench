"""The readable comparison sentence: one form per kind of number, at most three numbers, no '(+0)'."""

from __future__ import annotations

from wise_workbench.domain.comparison import (
    Comparison,
    capitalised,
    is_share_unit,
    number,
    percent,
    points,
    quantity_words,
    readable_comparison,
)

ITEMS = "purchase order items"


def test_numbers_follow_the_design_rule() -> None:
    assert number(83.378) == "83" and number(1.94) == "1.9" and number(14.0, count=True) == "14"
    assert number(12345.6) == "12,346"
    assert percent(0.9666) == "97 %" and percent(0.0087) == "0.9 %" and percent(1.0) == "100 %"
    assert points(0.2494) == "+25 points" and points(-0.0062) == "-0.6 points"
    assert quantity_words("manual_share") == "manual share"
    assert quantity_words("total_events") == "events"
    assert quantity_words("distinct_human_resources") == "distinct human resources"
    assert quantity_words("n_change_events") == "change events"
    assert is_share_unit("manual_share") and is_share_unit(None, 0.83, 0.8) and not is_share_unit("count", 4.0, 4.0)


def test_lag_keeps_the_acceptance_sentence() -> None:
    s = readable_comparison(
        Comparison("lag", "Paid within terms", 83.378, 54.698, 24.94, "D", 0.9666, 0.8336), items=ITEMS
    )
    assert s.text == "Paid within terms: 83 days here against 55 elsewhere (+25 days)" and s.kind == "lag"
    assert capitalised(s.text) == "Paid within terms: 83 days here against 55 elsewhere (+25 days)."


def test_count_uses_the_count_noun_and_the_case_noun() -> None:
    s = readable_comparison(
        Comparison(
            "count", "Received in few deliveries", 14.0, 1.0, 13.0, "count", 0.768, 0.009, "Record Goods Receipt events"
        ),
        items=ITEMS,
    )
    assert (
        s.text == "Received in few deliveries: 14 Record Goods Receipt events per purchase order item "
        "here against 1 elsewhere (+13)"
    )
    assert s.kind == "count"
    without = readable_comparison(Comparison("count", "Approved once", 3.0, 0.0, 3.0, "count", 1.0, 0.015), items=ITEMS)
    assert without.text == "Approved once: 3 events per purchase order item here against 0 elsewhere (+3)"
    # the bracket is the difference of the two counts shown, and one event is singular
    sampled = readable_comparison(
        Comparison("count", "Received in few deliveries", 14.0, 1.0, 12.0, "count", 0.77, 0.01, "receipt events"),
        items=ITEMS,
    )
    assert sampled.text.endswith("14 receipt events per purchase order item here against 1 elsewhere (+13)")
    one = readable_comparison(
        Comparison("count", "Approved once", 1.0, 0.0, 1.0, "count", 1.0, 0.02, "Change Approval events"), items=ITEMS
    )
    assert one.text == "Approved once: 1 Change Approval event per purchase order item here against 0 elsewhere (+1)"


def test_share_valued_metric_reads_as_percentages() -> None:
    s = readable_comparison(
        Comparison("metric", "Mostly automatic", 0.8333, 0.8, 0.0333, "manual_share", 0.99, 0.919), items=ITEMS
    )
    assert s.text == "Mostly automatic: a manual share of 83 % here against 80 % elsewhere (+3.3 points)"
    assert s.kind == "metric"


def test_other_metric_reads_per_item() -> None:
    s = readable_comparison(
        Comparison("metric", "Short event chain", 18.0, 5.0, 13.0, "total_events", 0.65, 0.023), items=ITEMS
    )
    assert s.text == "Short event chain: 18 events per purchase order item here against 5 elsewhere (+13)"


def test_rate_says_missed_in_with_the_difference_in_points() -> None:
    s = readable_comparison(Comparison("rate", "Invoice paid", None, None, None, "count", 0.669, 0.2157), items=ITEMS)
    assert s.text == "Invoice paid: missed in 67 % of purchase order items here against 22 % elsewhere (+45 points)"
    assert s.kind == "rate"


def test_zero_real_unit_difference_falls_back_on_the_shares() -> None:
    s = readable_comparison(
        Comparison("metric", "Few manual touches", 4.0, 4.0, 0.0, "manual_touch_count", 0.4636, 0.2918), items=ITEMS
    )
    assert (
        s.text == "Few manual touches: missed in 46 % of purchase order items here against 29 % elsewhere (+17 points)"
    )
    assert s.kind == "rate"
    lag = readable_comparison(Comparison("lag", "Paid within terms", 64.2, 64.0, 0.02, "D", 0.83, 0.82), items=ITEMS)
    assert (
        lag.text
        == "Paid within terms: missed in 83 % of purchase order items here against 82 % elsewhere (+1.0 points)"
    )


def test_no_material_difference_is_said_once_without_numbers() -> None:
    s = readable_comparison(
        Comparison("metric", "Mostly automatic", 0.8, 0.8, 0.0, "manual_share", 0.921, 0.919), items=ITEMS
    )
    assert s.text == "no material difference on the top expectation (Mostly automatic)" and s.kind == "none"
    assert capitalised(s.text) == "No material difference on the top expectation (Mostly automatic)."
    empty = readable_comparison(Comparison("rate", "Invoice paid", None, None, None, None, None, None), items=ITEMS)
    assert empty.kind == "none"


def test_every_sentence_holds_at_most_three_numbers() -> None:
    import re

    for c in (
        Comparison("lag", "Paid within terms", 83.4, 54.7, 24.9, "D", 0.97, 0.83),
        Comparison("count", "Received in few deliveries", 14.0, 1.0, 13.0, "count", 0.77, 0.01, "receipt events"),
        Comparison("metric", "Mostly automatic", 0.83, 0.8, 0.03, "manual_share", 0.99, 0.92),
        Comparison("share", "Invoiced as received", 0.12, 0.05, 0.07, "relative difference", 0.4, 0.2),
        Comparison("rate", "Invoice paid", None, None, None, "count", 0.67, 0.22),
    ):
        text = readable_comparison(c, items=ITEMS).text
        assert len(re.findall(r"\d[\d,]*(?:\.\d+)?", text)) <= 3, text
        assert "(+0" not in text and "(-0" not in text and "±" not in text
