"""Unsupported qualifiers must not silently select a different process cohort."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.filters import clause_mask, filter_masks, filter_preview, parse_filter
from wise_workbench.adapters.engine.review_selection import validate_filter as validate_review_filter
from wise_workbench.domain import ValidationError


@pytest.fixture
def log() -> wise.EventLog:
    # The spanning case is active during Jan 4–6, although neither endpoint falls there.
    traces = {
        "direct": [("A", 1), ("B", 3)],
        "indirect": [("A", 1), ("X", 2), ("B", 3)],
        "spanning": [("A", 1), ("X", 5), ("B", 10)],
        "reverse": [("B", 1), ("A", 3)],
        "missing_b": [("A", 1)],
    }
    events = pd.DataFrame(
        [(case, activity, f"2024-01-{day:02d}") for case, trace in traces.items() for activity, day in trace],
        columns=["case", "activity", "time"],
    )
    return wise.EventLog(events, case_col="case", activity_col="activity", timestamp_col="time")


UNSUPPORTED = [
    pytest.param(
        {"kind": "lag", "a": "A", "b": "B", "directly": True, "min": 2, "max": 2, "unit": "D"},
        "directly",
        id="direct-lag",
    ),
    pytest.param(
        {"kind": "time", "field": "active", "from": "2024-01-04", "to": "2024-01-06"},
        "active",
        id="active-period",
    ),
]


@pytest.mark.parametrize("clause,qualifier", UNSUPPORTED)
@pytest.mark.parametrize("entry", ["single-json", "and-json", "clause", "masks", "preview"])
def test_every_exploration_entry_rejects_unsupported_meaning(log, clause, qualifier, entry):
    selection = {"and": [clause]}
    with pytest.raises(ValidationError, match=qualifier) as error:
        if entry == "single-json":
            parse_filter(json.dumps(clause))
        elif entry == "and-json":
            parse_filter(json.dumps(selection))
        elif entry == "clause":
            clause_mask(log, clause, censored=None)
        elif entry == "masks":
            filter_masks(log, selection, censored=None)
        else:
            filter_preview(log, selection, censored=None, in_scope=None)
    assert error.value.code == "filter.unsupported" and error.value.status == 422


@pytest.mark.parametrize("clause,qualifier", UNSUPPORTED)
def test_review_uses_the_same_rejection_and_preserves_its_error_contract(clause, qualifier):
    with pytest.raises(ValidationError) as error:
        validate_review_filter({"and": [clause]})
    assert error.value.code == "review.filter_unsupported"
    assert isinstance(error.value.__cause__, ValidationError)
    assert error.value.__cause__.code == "filter.unsupported"
    assert qualifier in str(error.value.__cause__)


def selected(log: wise.EventLog, clause: dict[str, Any]) -> set[str]:
    obj = parse_filter(json.dumps(clause))
    validate_review_filter(obj)
    mask, _ = filter_masks(log, obj, censored=None)
    return set(mask[mask].index)


def test_positive_and_absent_relations_select_complementary_populations(log):
    assert selected(log, {"kind": "follows", "a": "A", "b": "B"}) == {"direct", "indirect", "spanning"}
    assert selected(log, {"kind": "follows", "a": "A", "b": "B", "never": True}) == {"reverse", "missing_b"}
    assert selected(log, {"kind": "follows", "a": "A", "b": "B", "directly": True, "never": True}) == {
        "indirect",
        "spanning",
        "reverse",
        "missing_b",
    }
    # Activity absence has a different meaning: reverse also contains B.
    assert selected(log, {"kind": "activity", "activity": "B", "op": "never"}) == {"missing_b"}


def test_eventual_lag_does_include_a_x_b_but_direct_follows_does_not(log):
    assert selected(log, {"kind": "lag", "a": "A", "b": "B", "unit": "D", "min": 2, "max": 2}) == {"direct", "indirect"}
    assert selected(log, {"kind": "follows", "a": "A", "b": "B", "directly": True}) == {"direct"}


def test_active_interval_cannot_be_mistaken_for_end_period(log):
    case = log.cases.loc["spanning"]
    assert case["first_ts"] < pd.Timestamp("2024-01-04") < pd.Timestamp("2024-01-06") < case["last_ts"]
    assert selected(log, {"kind": "time", "field": "case_end", "from": "2024-01-04", "to": "2024-01-06"}) == set()
    assert selected(log, {"kind": "time", "field": "case_end", "from": "2024-01-10", "to": "2024-01-10"}) == {
        "spanning"
    }
    assert selected(log, {"kind": "time", "field": "case_start", "to": "2024-01-01"}) == set(log.case_ids)


@pytest.mark.parametrize(
    "selection",
    [
        {"and": [], "or": [{"kind": "open"}]},
        {"and": [{"kind": "activity", "activity": "B", "op": "not_contains"}]},
        {"and": [{"kind": "time", "field": "events_inside", "from": "2024-01-01"}]},
        {"and": [{"kind": "follows", "a": "A", "b": "B", "directly": "false"}]},
        {"and": [{"kind": "follows", "a": "A", "b": "B", "never": "false"}]},
        {"and": [{"kind": "count", "activity": "A", "min": 0.5}]},
    ],
)
def test_other_ignored_or_coerced_semantics_are_rejected_before_evaluation(log, selection):
    with pytest.raises(ValidationError):
        parse_filter(json.dumps(selection))
    with pytest.raises(ValidationError):
        filter_masks(log, selection, censored=None)


def test_validate_all_clauses_before_an_earlier_clause_can_hide_the_unsupported_one(log):
    selection = {
        "and": [
            {"kind": "attribute", "field": "missing-column", "in": ["x"]},
            {"kind": "lag", "a": "A", "b": "B", "min": 0, "directly": True},
        ]
    }
    with pytest.raises(ValidationError, match="directly") as error:
        filter_masks(log, selection, censored=None)
    assert error.value.code == "filter.unsupported"


def test_no_filter_and_explicit_empty_conjunction_still_keep_all_cases(log):
    for raw in (None, "{}", '{"and": []}'):
        mask, parts = filter_masks(log, parse_filter(raw), censored=None)
        assert mask.all() and not parts


@pytest.mark.parametrize("raw", ["", " ", "null", "7", "false", "[]"])
def test_explicit_empty_or_non_object_filter_fails_closed(raw):
    with pytest.raises(ValidationError) as error:
        parse_filter(raw)
    assert error.value.status == 422


@pytest.mark.parametrize("directly", [False, True])
def test_absent_relation_keeps_missing_activities_and_obeys_other_clauses(log, directly):
    clause = {"kind": "follows", "a": "not recorded", "b": "B", "directly": directly, "never": True}
    assert selected(log, clause) == set(log.case_ids)
    selection = {"and": [clause, {"kind": "count", "activity": "A", "min": 1}]}
    mask, _ = filter_masks(log, selection, censored=None)
    assert mask.all()
    # Invert the relation first, then intersect the independent cohort restrictions.
    selection["and"] = [
        {**clause, "a": "A"},
        {"kind": "activity", "activity": "B", "op": "contains"},
    ]
    mask, _ = filter_masks(log, selection, censored=None)
    assert set(mask[mask].index) == ({"reverse", "indirect", "spanning"} if directly else {"reverse"})


@pytest.mark.parametrize("directly", [False, True])
def test_absent_relation_on_an_empty_log_has_no_invented_cases(directly):
    empty = wise.EventLog(
        pd.DataFrame(columns=["case", "activity", "time"]),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
    )
    assert selected(empty, {"kind": "follows", "a": "A", "b": "B", "directly": directly, "never": True}) == set()


def test_equal_timestamp_absence_complements_the_existing_observation_semantics():
    events = pd.DataFrame(
        [
            ("ab", "A", 1),
            ("ab", "B", 2),
            ("ba", "B", 1),
            ("ba", "A", 2),
            ("axb", "A", 1),
            ("axb", "X", 2),
            ("axb", "B", 3),
        ],
        columns=["case", "activity", "position"],
    ).assign(time=pd.Timestamp("2024-01-01"))
    tied = wise.EventLog(events, case_col="case", activity_col="activity", timestamp_col="time", order_col="position")
    # Eventual follows is timestamp-based (B at or after A); ties count in either order.
    assert selected(tied, {"kind": "follows", "a": "A", "b": "B", "never": True}) == set()
    # Direct follows uses the supplied event order, so B→A and A→X→B have no direct A→B.
    assert selected(tied, {"kind": "follows", "a": "A", "b": "B", "directly": True, "never": True}) == {"ba", "axb"}
    # Without an order column, the log's stable input order resolves timestamp ties.
    stable = wise.EventLog(events, case_col="case", activity_col="activity", timestamp_col="time")
    assert selected(stable, {"kind": "follows", "a": "A", "b": "B", "directly": True, "never": True}) == {"ba", "axb"}


@pytest.mark.parametrize("name", ["from", "to"])
@pytest.mark.parametrize(
    "value",
    [
        "not-a-date",
        {"date": "2024-01-01"},
        ["2024-01-01"],
        None,
        True,
        1704067200,
        "",
        " ",
        "NaT",
        "now",
        "2024-02-30",
        "2024-13-01",
        "2024-01-01T25:00:00",
        "9999-01-01",
    ],
)
def test_invalid_time_bound_is_rejected_by_exploration_and_review(log, name, value):
    # A valid other boundary must not hide an explicitly invalid one.
    clause = {"kind": "time", "from": "2024-01-01", "to": "2024-01-10", name: value}
    with pytest.raises(ValidationError, match=f"time.{name}") as error:
        parse_filter(json.dumps(clause))
    assert error.value.status == 422 and error.value.code == "filter.time"
    with pytest.raises(ValidationError) as error:
        filter_masks(log, {"and": [clause]}, censored=None)
    assert error.value.code == "filter.time"
    with pytest.raises(ValidationError) as error:
        validate_review_filter({"and": [clause]})
    assert error.value.code == "review.filter_unsupported"
    assert error.value.__cause__.code == "filter.time"


@pytest.mark.parametrize(
    "bounds",
    [
        {},
        {"from": "2024-01-04", "to": "2024-01-03"},
        {"from": "2024-01-03T00:00:00+00:00", "to": "2024-01-03T00:00:00+01:00"},
        {"from": "2024-01-03", "to": "2024-01-04T00:00:00Z"},
    ],
)
def test_time_range_requires_bounds_in_order_and_consistent_timezone_information(bounds):
    with pytest.raises(ValidationError) as error:
        parse_filter(json.dumps({"kind": "time", **bounds}))
    assert error.value.status == 422 and error.value.code == "filter.time"


@pytest.mark.parametrize(
    "bounds",
    [
        {"from": "2024-01-03", "to": "2024-01-03"},
        {"from": "2024-01-03T00:00:00", "to": "2024-01-03T00:00:00.000000000"},
        {"from": "2024-01-03T00:00:00Z", "to": "2024-01-03T01:00:00+01:00"},
        {"from": "2024-01-02T19:00:00-05:00", "to": "2024-01-03T01:00:00+01:00"},
    ],
)
@pytest.mark.parametrize("utc", [False, True])
def test_time_dates_datetimes_and_offsets_select_the_same_inclusive_instant(log, bounds, utc):
    if utc:
        log = wise.EventLog(log.events, case_col="case", activity_col="activity", timestamp_col="time", utc=True)
    clause = {"kind": "time", "field": "case_end", **bounds}
    assert selected(log, clause) == {"direct", "indirect", "reverse"}


def test_time_one_sided_bounds_keep_inclusive_behavior(log):
    assert selected(log, {"kind": "time", "field": "case_end", "to": "2024-01-01"}) == {"missing_b"}
    assert selected(log, {"kind": "time", "field": "case_end", "from": "2024-01-10"}) == {"spanning"}
