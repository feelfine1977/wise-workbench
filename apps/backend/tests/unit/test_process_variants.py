from __future__ import annotations

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.process_variants import process_variants


def log_of(rows, *, order=None):
    return wise.EventLog(
        pd.DataFrame(rows, columns=["case", "activity", "time", "position"]),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        order_col=order,
        missing_timestamps="keep",
    )


def test_full_sequences_repeats_loops_deterministic_ties_and_top_coverage():
    rows = []
    # These paths have the same activity set and directly-follows set, but are different variants.
    for case, acts, hours in [
        ("z", "ABABC", [0, 1, 2, 3, 4]),
        ("a", "ABABC", [0, 1, 2, 3, 8]),
        ("b", "ABABABC", list(range(7))),
        ("c", "ABBC", list(range(4))),
    ]:
        rows.extend(
            (case, a, pd.Timestamp("2024-01-01") + pd.Timedelta(hours=h), i)
            for i, (a, h) in enumerate(zip(acts, hours))
        )
    log = log_of(rows[::-1], order="position")
    ids = pd.Index(["a", "b", "c", "z", "no-events"])
    result = process_variants(log, ids, limit=1, example_limit=1)
    assert result["totalSelectedCases"] == 5
    assert result["excludedZeroEventCases"] == 1
    assert result["totalVariants"] == 3
    assert result["coveredCount"] == 2 and result["coverage"] == 0.4
    top = result["variants"][0]
    assert top["activities"] == list("ABABC")
    assert top["count"] == 2 and top["share"] == 0.4
    assert top["medianDurationHours"] == 6 and top["durationCases"] == 2
    assert top["exampleCaseIds"] == ["a"]
    complete = process_variants(log, ids)
    assert [v["activities"] for v in complete["variants"]] == [list("ABABC"), list("ABABABC"), list("ABBC")]
    assert complete["variants"][0]["id"] == top["id"]
    assert process_variants(log_of(rows, order="position"), ids) == complete


@pytest.mark.parametrize("order, expected", [(None, ["C", "B", "A"]), ("position", ["B", "A", "C"])])
def test_equal_timestamp_order_uses_mapping_then_stable_input(order, expected):
    log = log_of([("c", a, "2024-01-01", pos) for a, pos in [("C", 2), ("B", 1), ("A", 1)]], order=order)
    result = process_variants(log, log.case_ids)
    assert result["variants"][0]["activities"] == expected
    assert result["variants"][0]["medianDurationHours"] == 0
    assert "Equal timestamps" in result["ordering"] and "does not establish business causality" in result["ordering"]


def test_unknown_labels_and_missing_timestamps_are_not_discarded_or_zero_duration():
    log = log_of(
        [
            ("c", "A", "2024-01-01", 0),
            ("c", None, None, 1),
            ("d", "A", "2024-01-01", 0),
            ("d", None, "2024-01-02", 1),
            ("e", "B", None, 0),
        ]
    )
    result = process_variants(log, log.case_ids)
    top, missing = result["variants"]
    assert top["activities"] == ["A", None] and top["count"] == 2
    assert top["durationCases"] == 1 and top["medianDurationHours"] == 24
    assert missing["medianDurationHours"] is None and missing["durationCases"] == 0


@pytest.mark.parametrize("ids, excluded", [([], 0), (["absent"], 1)])
def test_empty_and_zero_event_selections_have_finite_zero_coverage(ids, excluded):
    log = log_of([("outside", "A", "2024-01-01", 1)])
    result = process_variants(log, pd.Index(ids))
    assert result["totalSelectedCases"] == len(ids)
    assert result["excludedZeroEventCases"] == excluded
    assert result["variants"] == [] and result["totalVariants"] == result["coveredCount"] == result["coverage"] == 0
