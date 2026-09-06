"""Plain-language readings: kinds of problem, percentages, the group sentence and the slice sentence."""

from __future__ import annotations

import re

from wise_workbench.domain.readings import (
    KIND_READING,
    KINDS,
    backlog_reading,
    confidence_reading,
    hotspot_of,
    kind_of,
    kind_reading,
    pct,
    slice_reading,
)

PACKAGING = {
    "n_cases": 109199,
    "gap": 0.008662,
    "stable_gap": 0.008660,
    "PI": 945.89,
    "stable_PI": 945.72,
    "rank": 1,
    "n_ranked": 30,
    "hotspot_type": "reservoir",
    "kind": "widespread",
    "dominant_layer": "L3_timeliness_ageing",
    "dominant_layer_name": "Handovers and ageing",
    "top_constraint": "c_l3_invoice_to_clear_days",
    "top_constraint_description": "Invoice-bearing flows should clear in a reasonable time.",
    "top_constraint_share": 0.9666,
    "stability": "unknown",
}

METHOD_TERMS = re.compile(r"\b(hotspot|slice|constraint|layer|stable PI|PI\b|dominant)", re.IGNORECASE)


def test_kinds_are_aliases_of_the_hotspot_types() -> None:
    assert kind_of("severity") == "acute"
    assert kind_of("mechanism") == "systematic"
    assert kind_of("reservoir") == "widespread"
    assert kind_of(None) is None and kind_of("nope") is None
    for kind in KINDS:
        assert kind_of(hotspot_of(kind)) == kind
        assert kind_reading(kind) == KIND_READING[kind]
    assert kind_reading("acute") == "few cases, far off"
    assert kind_reading("systematic") == "one pattern behind it"
    assert kind_reading("widespread") == "many cases, slightly off"


def test_confidence_reading_covers_every_stability() -> None:
    assert confidence_reading("stable") == "high"
    assert confidence_reading("fragile") == "medium"
    assert confidence_reading("insufficient_support") == "not enough cases to be sure"
    assert confidence_reading("unknown") == confidence_reading(None) == "not computed for this run"


def test_percentages_keep_the_decimals_the_size_needs() -> None:
    assert pct(0.008662) == "0.9 %"
    assert pct(0.11) == "11 %"
    assert pct(0.056) == "5.6 %"
    assert pct(0.0004) == "0.04 %"
    assert pct(None) == "n/a"


def test_group_sentence_is_plain_and_carries_the_numbers() -> None:
    text = backlog_reading(PACKAGING, "Automation", 20, "companyID_0000 × Packaging")
    assert text.startswith("companyID_0000 × Packaging: 109,199 cases, 0.9 % below expectation on average")
    assert "widespread: many cases, slightly off" in text
    assert "most-missed expectation area: Handovers and ageing" in text
    assert "Invoice-bearing flows should clear in a reasonable time, missed in 97 % of these cases" in text
    assert "confidence in rank: not computed for this run" in text
    assert "priority 945.7 (raw 945.9; small groups discounted with γ = 20), rank 1 of 30" in text
    assert text.endswith("in the Automation perspective.")
    assert not METHOD_TERMS.search(text), text
    for word in ("root cause", "fault", "effect"):
        assert word not in text


def test_group_without_shortfall_says_so() -> None:
    row = {**PACKAGING, "gap": 0.0, "stable_gap": 0.0, "PI": 0.0, "stable_PI": 0.0, "hotspot_type": None, "kind": None}
    text = backlog_reading(row, "Finance", 50, "companyID_0001 × Travel")
    assert (
        text
        == "companyID_0001 × Travel: 109,199 cases at or above expectation on average in the Finance perspective; no shortfall, priority 0."
    )


def test_small_group_shows_the_discounted_shortfall_and_falls_back_on_the_method_name() -> None:
    row = {
        "n_cases": 127,
        "gap": 0.112,
        "stable_gap": 0.0968,
        "PI": 14.2,
        "stable_PI": 12.3,
        "rank": 9,
        "hotspot_type": "severity",
        "dominant_layer": "L2_flow_discipline",
        "stability": "insufficient_support",
    }
    text = backlog_reading(row, None, 20, "Workforce Services")
    assert "127 cases, 11 % below expectation on average (9.7 % with small groups discounted)" in text
    assert "acute: few cases, far off" in text
    assert "most-missed expectation area: L2_flow_discipline" in text
    assert "confidence in rank: not enough cases to be sure" in text
    assert "priority 12.3 (raw 14.2; small groups discounted with γ = 20), rank 9." in text


def test_slice_sentence_lists_the_expectations_behind_the_shortfall() -> None:
    drivers = [
        {
            "constraint": "c_a",
            "description": "Invoices cleared within 30 days.",
            "delta_gap": 0.006,
            "share_of_shortfall": 0.69,
            "share_violated": 0.42,
        },
        {
            "constraint": "c_b",
            "description": "Goods receipt recorded once.",
            "delta_gap": 0.002,
            "share_of_shortfall": 0.23,
            "share_violated": 0.1,
        },
        {
            "constraint": "c_c",
            "description": None,
            "delta_gap": -0.001,
            "share_of_shortfall": -0.1,
            "share_violated": 0.3,
        },
    ]
    text = slice_reading(PACKAGING, drivers, "Automation", 20, "companyID_0000 × Packaging")
    assert (
        "Expectations behind the shortfall: Invoices cleared within 30 days (explains 69 % of the shortfall, missed in 42 % of cases); Goods receipt recorded once (explains 23 % of the shortfall, missed in 10 % of cases)."
        in text
    )
    assert "c_c" not in text
