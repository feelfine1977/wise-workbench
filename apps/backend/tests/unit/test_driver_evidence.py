"""Temporal evidence keeps descriptive populations and missingness explicit."""

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.driver_evidence import solution_card_metadata, temporal_evidence


def fixture_log():
    specs = {
        "ordered": [("Start", "2026-01-01"), ("End", "2026-01-03")],
        "tie": [("Start", "2026-01-26"), ("End", "2026-01-26")],
        "reversed": [("Start", "2026-02-03"), ("End", "2026-02-01")],
        "repeat-end": [("Start", "2026-01-02"), ("End", "2026-01-26"), ("End", "2026-02-26")],
        "start-only": [("Start", "2026-01-01")],
        "end-only": [("End", "2026-01-31")],
        "neither": [("Other", "2026-01-01")],
        "undated": [("Start", "2026-01-01"), ("End", None)],
        "repeat-start": [("Start", "2026-01-01"), ("Start", "2026-01-02"), ("End", "2026-01-04")],
        "repeat-reversed": [("Start", "2026-01-05"), ("End", "2026-01-01"), ("End", "2026-01-02")],
    }
    frame = pd.DataFrame(
        [
            {"case": case, "activity": act, "time": pd.Timestamp(ts) if ts else pd.NaT}
            for case, events in specs.items()
            for act, ts in events
        ]
    )
    log = wise.EventLog(
        frame, case_col="case", activity_col="activity", timestamp_col="time", missing_timestamps="keep"
    )
    return log, pd.Index([*specs, "zero-events"], name="case")


def test_partitions_ties_repeats_reversal_calendar_denominators_and_no_mutation():
    log, ids = fixture_log()
    before_events, before_cases = log.events.copy(deep=True), log.cases.copy(deep=True)
    nc = wise.NormConstraint("any-id", "time", wise.Lag("Start", "End", delta=1, width=2, missing_b="censor"))
    result = temporal_evidence(log, ids, nc, ("End",))
    duration = result["duration"]
    assert duration["partitions"] == {
        "neitherEndpointCases": 2,
        "missingStartOnlyCases": 1,
        "missingEndOnlyCases": 1,
        "repeatedEndpointCases": 3,
        "missingTimestampCases": 1,
        "reversedCases": 1,
        "tiedCases": 1,
        "orderedCases": 1,
    }
    assert sum(duration["partitions"].values()) == len(ids)
    assert duration["pairedCases"] == 2 and duration["median"] == 1 and duration["p90"] == pytest.approx(1.8)
    assert duration["ordering"] == {
        "casesWithKnownEndpointTimes": 6,
        "firstEndBeforeFirstStartCases": 2,
        "allDatedEndsBeforeFirstStartCases": 2,
    }
    histogram = result["endDayOfMonth"]
    assert [b["day"] for b in histogram["buckets"]] == list(range(1, 32))
    assert histogram["eventCount"] == 10 and histogram["caseCount"] == 8
    assert (
        histogram["datedEventCount"] == 9
        and histogram["datedCaseCount"] == 7
        and histogram["missingTimestampEvents"] == 1
    )
    assert sum(b["eventCount"] for b in histogram["buckets"]) == 9
    assert histogram["topDay"] == {"day": 26, "eventCount": 3, "caseCount": 2, "monthsPresent": 2}
    assert histogram["representedMonths"] == 2 and histogram["timezone"] is None
    assert histogram["calendarExposureAdjusted"] is False
    assert result["endpoints"]["end"]["mappedHeaderLabels"] == ["End"]
    assert result["activityCoverage"]["casesWithoutActivity"] == 3
    assert result["dueDate"]["status"] == "unavailable"
    assert any("header" in s for s in result["caveats"])
    pd.testing.assert_frame_equal(log.events, before_events)
    pd.testing.assert_frame_equal(log.cases, before_cases)


@pytest.mark.parametrize(
    "constraint", [wise.Presence("End"), wise.Exclusion("End", after="Start"), wise.Singularity("End", k=1)]
)
def test_coverage_uses_actual_labels_without_claiming_scoring_anchors(constraint):
    log, ids = fixture_log()
    result = temporal_evidence(log, ids, wise.NormConstraint("arbitrary", "L", constraint), ())
    coverage = result["activityCoverage"]
    assert result["status"] == "available" and result["endpoints"] is None and result["duration"] is None
    assert (
        coverage["selectedCases"] == 11 and coverage["casesWithActivity"] == 8 and coverage["casesWithoutActivity"] == 3
    )
    assert coverage["singleOccurrenceCases"] == 6 and coverage["repeatedOccurrenceCases"] == 2
    assert coverage["eventCount"] == 10 and coverage["labels"] == coverage["observedLabels"] == ["End"]
    assert any("anchors are not applied" in text for text in result["caveats"])


def test_empty_missing_labels_and_unsupported_types_stay_unavailable():
    log, ids = fixture_log()
    lag = wise.NormConstraint("elapsed", "L", wise.Lag("Unknown start", "Unknown end", delta=1, width=2))
    no_labels = temporal_evidence(log, ids, lag, ())
    assert no_labels["duration"]["status"] == "unavailable" and no_labels["duration"]["median"] is None
    assert no_labels["duration"]["partitions"]["neitherEndpointCases"] == len(ids)
    assert no_labels["endDayOfMonth"]["topDay"] is None
    empty = temporal_evidence(log, ids[:0], lag, ())
    assert empty["status"] == "unavailable" and empty["selectedEvents"] == 0
    assert all(b["eventCount"] == b["caseCount"] == 0 for b in empty["endDayOfMonth"]["buckets"])
    unsupported = temporal_evidence(
        log, ids, wise.NormConstraint("amount", "L", wise.Metric("unmapped", threshold=1, width=1)), ()
    )
    assert unsupported["status"] == "unavailable" and unsupported["activityCoverage"] is None


def test_precedence_has_endpoint_evidence_without_applying_missingness_scoring_policy():
    log, ids = fixture_log()
    nc = wise.NormConstraint("order", "L", wise.Precedence("Start", "End", missing_a="violate", missing_b="skip"))
    result = temporal_evidence(log, ids, nc, ())
    assert result["status"] == "available"
    assert result["activityCoverage"]["casesWithActivity"] == 8
    assert result["duration"]["partitions"]["reversedCases"] == 1
    assert result["duration"]["ordering"]["firstEndBeforeFirstStartCases"] == 2
    assert sum(result["duration"]["partitions"].values()) == len(ids)
    assert result["duration"]["pairedCases"] == 2


def test_overlapping_endpoint_labels_do_not_invent_a_zero_duration_pair():
    log, ids = fixture_log()
    result = temporal_evidence(log, ids, wise.NormConstraint("same", "L", wise.Lag("End", "End", delta=1, width=1)), ())
    assert result["endpoints"]["start"]["eventCount"] == 10
    assert result["endDayOfMonth"]["datedEventCount"] == 9
    assert result["duration"] is None
    assert any("one record could act as both" in text for text in result["caveats"])


def test_timezone_and_selected_case_boundary_preserve_calendar_days():
    events = pd.DataFrame(
        [
            {"case": "selected", "activity": "Start", "time": pd.Timestamp("2026-02-01T00:00:00+02:00")},
            {"case": "selected", "activity": "End", "time": pd.Timestamp("2026-02-01T00:15:00+02:00")},
            {"case": "outside", "activity": "End", "time": pd.Timestamp("2026-02-26T12:00:00+02:00")},
        ]
    )
    log = wise.EventLog(events, case_col="case", activity_col="activity", timestamp_col="time")
    result = temporal_evidence(
        log, pd.Index(["selected"]), wise.NormConstraint("time", "L", wise.Lag("Start", "End", delta=1, width=1)), ()
    )
    calendar = result["endDayOfMonth"]
    assert result["selectedEvents"] == 2 and result["duration"]["pairedCases"] == 1
    assert calendar["datedEventCount"] == 1
    # EventLog owns any timezone normalization; bucket against stored timestamps.
    expected_day = int(
        log.events.loc[log.events["activity"].eq("End") & log.events["case"].eq("selected"), "time"].dt.day.iloc[0]
    )
    assert calendar["topDay"]["day"] == expected_day
    assert calendar["timezone"] == str(log.events["time"].dtype.tz)


@pytest.mark.parametrize(
    "process,cid,a,b,expected",
    [
        ("p2p", "c_l3_df2_rpb_to_clear_days", "Remove Payment Block", "Clear Invoice", "release-to-clearing"),
        ("p2p", "c_l3_df2_rpb_to_clear_days", "Record Goods Receipt", "Clear Invoice", "elapsed-time"),
        ("p2p", "c_l3_df2_rpb_to_clear_days", "Remove Payment Block", "Record Invoice Receipt", "elapsed-time"),
        ("p2p", "c_l3_df2_rpb_to_clear_days", "Clear Invoice", "Remove Payment Block", "elapsed-time"),
        ("o2c", "o_deliv_pick_to_issue_days", "Picking Completed", "Goods issue", "pick-to-issue"),
        ("o2c", "o_deliv_order_to_issue_days", "Create Order Item", "Goods issue", "order-to-issue"),
        ("o2c", "o_deliv_order_to_issue_days", "Create Delivery Item", "Goods issue", "elapsed-time"),
        ("p2p", "unrecognised-id", "Remove Payment Block", "Clear Invoice", "elapsed-time"),
    ],
)
def test_specific_cards_require_saved_endpoint_meaning(process, cid, a, b, expected):
    card = solution_card_metadata(
        process, {"id": cid, "type": "lag", "params": {"a": [a], "b": [b], "delta": 999, "width": 1}}
    )
    assert card is not None and card["id"] == expected
    assert card["hubNode"] == f"solution_card:{process}:{expected}"
    assert ("due_date_lead" in [block["kind"] for block in card["blocks"]]) == (expected == "release-to-clearing")


def test_generic_precedence_and_unknown_evidence_recipe():
    card = solution_card_metadata(None, {"id": "order", "type": "precedence", "params": {"a": ["Start"], "b": ["End"]}})
    assert card is not None and card["id"] == "event-order" and card["hubNode"] is None
    assert solution_card_metadata("p2p", {"id": "value", "type": "metric", "params": {"attribute": "amount"}}) is None
