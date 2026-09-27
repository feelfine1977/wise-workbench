"""Synthetic oracles for generic mechanisms; business names appear only in fixtures."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.filters import filter_masks
from wise_workbench.adapters.engine.investigation_questions import investigation_questions
from wise_workbench.api.schemas import InvestigationQuestions
from wise_workbench.domain import ValidationError


def make_log(rows):
    frame = pd.DataFrame(rows, columns=["case", "activity", "hour", "order", "identity", "group"])
    frame["time"] = pd.Timestamp("2024-01-01", tz="UTC") + pd.to_timedelta(frame.pop("hour"), unit="h")
    return wise.EventLog(
        frame,
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        order_col="order",
        case_attributes=["group"],
        missing_timestamps="keep",
    )


@pytest.fixture
def log():
    return make_log(
        [
            ("repeat", "A", 0, 0, "user-1", "X"),
            ("repeat", "B", 1, 1, None, "X"),
            ("repeat", "A", 2, 2, "batch-1", "X"),
            ("repeat", "B", 6, 3, " ", "X"),
            ("plain", "A", 0, 0, "user-2", "Y"),
            ("plain", "B", 3, 1, "user-2", "Y"),
            ("reverse-tie", "B", 0, 0, None, "Y"),
            ("reverse-tie", "A", 0, 1, None, "Y"),
            ("forward-tie", "A", 0, 0, "none", "X"),
            ("forward-tie", "B", 0, 1, "nan", "X"),
            ("missing-clock", "A", 0, 0, "user-1", "X"),
            ("missing-clock", "B", None, 1, None, "X"),
            ("missing-label", None, 0, 0, "user-1", "Y"),
            ("missing-label", "B", 1, 1, "user-1", "Y"),
            ("source-only", "A", 2, 0, None, None),
        ]
    )


def result(log, *, ids=None, **params):
    out = investigation_questions(
        log,
        log.case_ids if ids is None else pd.Index(ids),
        run_id="r",
        total_cases=len(log.case_ids),
        resource_column="identity",
        case_attributes=["group"],
        **params,
    )
    InvestigationQuestions.model_validate(out)
    json.dumps(out, allow_nan=False)
    return out


def metrics(question):
    return {m["id"]: m["value"] for m in question["metrics"]}


def test_repetition_counts_items_occurrences_and_extras_separately(log):
    out = result(log, family="repetition", activity="A")
    q = out["questions"][0]
    m = metrics(q)
    assert m["affected_cases"] == m["repeated_cases"] == 1
    assert m["events"] == 2 and m["extra_events"] == 1
    assert m["activity_events"] == 7
    assert m["median_case_span_hours"] == 6 and m["case_span_measured_cases"] == 1
    assert q["exampleCaseIds"] == ["repeat"]
    assert q["filter"] == {"and": [{"kind": "count", "activity": "A", "min": 2}]}
    assert m["open_cases"] is None and m["open_status_known_cases"] == 0


def test_direct_pair_clocks_include_zero_and_missing_and_weighted_support(log):
    q = result(log, family="timing", source="A", target="B")["questions"][0]
    m = metrics(q)
    assert m["pairs"] == 5 and m["affected_cases"] == 4
    assert m["measured_pairs"] == 4 and m["missing_clock_pairs"] == 1
    assert m["measured_cases"] == 3 and m["clock_coverage"] == 0.8
    assert m["median_hours"] == 2 and m["case_weighted_median_hours"] == 2.5
    assert m["equal_timestamp_pairs"] == 1
    assert m["both_without_match_cases"] == 1
    assert m["missing_target_cases"] == 1
    assert q["parameters"]["relation"] == "direct"
    assert "not active processing time" in " ".join(q["limitations"])


def test_eventual_uses_first_source_and_strict_later_position_not_timestamp_greater_equal(log):
    q = result(log, family="timing", source="A", target="B", relation="eventual")["questions"][0]
    m = metrics(q)
    assert m["pairs"] == 4 and m["measured_pairs"] == 3
    assert m["median_hours"] == 1  # repeat contributes the first A→B (1h), not its later 4h pair
    assert m["both_without_match_cases"] == 1  # reverse-tie has equal clocks but wrong recorded order
    assert q["filter"] is None
    assert any("No exact supported" in s for s in q["limitations"])
    same = result(log, family="sequence", source="A", target="A", relation="eventual")["questions"][0]
    assert metrics(same)["pairs"] == 1 and metrics(same)["affected_cases"] == 1
    assert metrics(same)["median_hours"] == 2


def test_inherited_filter_survives_every_supported_exact_drill(log):
    inherited = {"and": [{"kind": "attribute", "field": "group", "eq": "X"}]}
    mask, _ = filter_masks(log, inherited, censored=None)
    ids = log.case_ids[mask]
    out = result(log, ids=ids, filter_obj=inherited)
    for q in out["questions"]:
        if q["filter"] is None:
            continue
        assert q["filter"]["and"][:1] == inherited["and"]
        selected, _ = filter_masks(log, q["filter"], censored=None)
        assert int(selected.sum()) == metrics(q)["affected_cases"]
        assert set(q["exampleCaseIds"]) <= set(log.case_ids[selected])
        assert set(log.case_ids[selected]) <= set(ids)


def test_raw_boundaries_do_not_skip_null_labels_or_claim_approximate_filters(log):
    out = result(log, family="boundaries")
    start_b = next(q for q in out["questions"] if q["title"] == "Recorded start: B")
    assert metrics(start_b)["affected_cases"] == 1
    assert metrics(start_b)["missing_boundary_cases"] == 1
    assert start_b["filter"] is None  # starts_with skips nulls and would also select missing-label
    end_b = next(q for q in out["questions"] if q["title"] == "Recorded end: B")
    assert end_b["filter"] is not None


def test_direct_drill_is_disabled_when_stringified_missing_labels_collide():
    log = make_log(
        [
            ("unknown", None, 0, 0, None, "X"),
            ("unknown", "B", 1, 1, None, "X"),
            ("literal", "nan", 0, 0, None, "X"),
            ("literal", "B", 1, 1, None, "X"),
        ]
    )
    q = result(log, family="sequence", source="nan", target="B")["questions"][0]
    assert metrics(q)["affected_cases"] == 1
    if q["filter"] is not None:
        # pandas may use a different null string on another pinned dependency version.
        mask, _ = filter_masks(log, q["filter"], censored=None)
        assert int(mask.sum()) == 1
    else:
        assert any("drill links" in text for text in q["limitations"])


def test_identity_is_availability_not_a_manual_batch_classifier(log):
    q = result(log, family="identity")["questions"][0]
    m = metrics(q)
    assert m["events"] == 15 and m["known_identity_events"] == 9 and m["missing_identity_events"] == 6
    assert m["distinct_identities"] == 5  # literal 'none'/'nan' retained as recorded identifiers
    assert q["filter"] == {"and": []}
    assert all("manualEvents" not in r and "automatedEvents" not in r for r in q["rows"])
    unavailable = investigation_questions(log, log.case_ids, run_id="r", total_cases=7, family="identity")
    q = unavailable["questions"][0]
    assert q["status"] == "unavailable" and metrics(q)["known_identity_events"] is None
    assert "No mapped execution identity" in q["summary"]


def test_missingness_zero_event_cases_and_open_coverage(log):
    flags = pd.Series([False, True], index=["repeat", "missing-clock"])
    out = result(log, ids=["repeat", "missing-clock", "no-events"], family="missingness", censored=flags)
    q = out["questions"][0]
    m = metrics(q)
    assert out["selectedCases"] == 3 and m["zero_event_cases"] == 1
    assert m["case_span_measured_cases"] == 1 and m["case_span_unmeasured_cases"] == 2
    assert m["missing_timestamp_events"] == 1
    assert m["open_cases"] == 1 and m["open_status_known_cases"] == 2
    assert q["filter"] == {"and": []}
    assert out["choices"]["attributes"]["values"] == ["group"]


@pytest.mark.parametrize(
    "family", ["overview", "frequency", "repetition", "boundaries", "identity", "missingness", "timing", "sequence"]
)
def test_empty_selection_is_finite_and_preserves_the_population(log, family):
    params = {"source": "A", "target": "B"} if family in ("timing", "sequence") else {}
    out = result(log, ids=[], family=family, **params)
    assert out["selectedCases"] == 0 and out["totalCases"] == 7
    assert out["choices"]["activities"] == {"values": [], "total": 0, "truncated": False}
    assert all(q["exampleCaseIds"] == [] for q in out["questions"])


def test_known_but_filtered_out_activity_vs_unknown_activity(log):
    q = result(log, ids=["source-only"], family="timing", source="A", target="B")["questions"][0]
    assert q["status"] == "unavailable" and q["summary"] == "No selected occurrences of: B."
    assert metrics(q)["median_hours"] is None
    with pytest.raises(ValidationError, match="not recorded"):
        result(log, family="frequency", activity="No such activity")


def test_choices_and_profiles_are_bounded_independently_and_order_stable():
    log = make_log([(f"c{i:03}", f"Activity {i:03}", 0, 0, None, "X") for i in range(125)])
    for i in range(110):
        log.add_case_attribute(f"extra{i:03}", pd.Series("x", index=log.case_ids))
    out = investigation_questions(log, log.case_ids, run_id="r", total_cases=125, limit=2)
    assert len(out["choices"]["activities"]["values"]) == 100
    assert out["choices"]["activities"]["total"] == 125 and out["choices"]["activities"]["truncated"]
    assert len(out["choices"]["attributes"]["values"]) == 100 and out["choices"]["attributes"]["truncated"]
    assert len(out["questions"]) <= 6 and all(len(q["exampleCaseIds"]) <= 3 for q in out["questions"])
    assert out == investigation_questions(log, log.case_ids, run_id="r", total_cases=125, limit=2)


@pytest.mark.parametrize("seed", [3, 19])
def test_pair_counts_match_independent_sequence_oracle_with_loops_ties_and_missing_clocks(seed):
    rng = np.random.default_rng(seed)
    rows = [
        (f"c{c}", str(rng.choice(["Pick", "Pack", "Ship"])), None if i == 6 else int(rng.integers(0, 3)), i, None, "X")
        for c in range(8)
        for i in range(7)
    ]
    log = make_log(rows[::-1])
    for source, target in [("Pick", "Pack"), ("Pack", "Pack"), ("Ship", "Pick")]:
        for relation in ("direct", "eventual"):
            expected = []
            cases = set()
            for cid, ev in log.events.groupby(log.case_col, observed=True):
                acts, times = ev[log.activity_col].tolist(), ev[log.timestamp_col].tolist()
                if relation == "direct":
                    positions = [
                        (i, i + 1) for i in range(len(acts) - 1) if acts[i] == source and acts[i + 1] == target
                    ]
                else:
                    start = next((i for i, a in enumerate(acts) if a == source), None)
                    end = next((j for j, a in enumerate(acts) if start is not None and j > start and a == target), None)
                    positions = [(start, end)] if end is not None else []
                if positions:
                    cases.add(cid)
                expected.extend(
                    (times[j] - times[i]).total_seconds() / 3600 if pd.notna(times[j]) and pd.notna(times[i]) else None
                    for i, j in positions
                )
            q = result(log, family="timing", source=source, target=target, relation=relation)["questions"][0]
            m = metrics(q)
            clocks = [v for v in expected if v is not None]
            assert m["pairs"] == len(expected) and m["affected_cases"] == len(cases)
            assert m["measured_pairs"] == len(clocks)
            assert m["median_hours"] == (float(np.median(clocks)) if clocks else None)


def test_timing_does_not_build_unrelated_repetition_or_boundary_reductions(log, monkeypatch):
    from wise_workbench.adapters.engine.investigation_questions import _Investigation

    def unrelated(_):
        raise AssertionError("Timing must not compute unrelated family reductions")

    for name in ("activity_cases", "activity_groups", "activity_stats", "starts", "ends"):
        monkeypatch.setattr(_Investigation, name, property(unrelated))
    for relation in ("direct", "eventual"):
        q = result(log, family="timing", source="A", target="B", relation=relation)["questions"][0]
        assert metrics(q)["affected_cases"] == 4


def test_bounded_examples_remain_lexical_and_distinct_after_selection():
    ids = ["z-last", "03", "2", "10", "å", "a-first", "02", "01"]
    log = make_log([(cid, activity, i, i, None, "X") for cid in ids for i, activity in enumerate(["A", "A", "B"])])
    out = result(log, ids=[*ids, ids[0], "no-events"], family="frequency", activity="A")
    q = out["questions"][0]
    assert out["selectedCases"] == len(ids) + 1
    assert metrics(q)["affected_cases"] == len(ids)
    assert q["exampleCaseIds"] == sorted(ids)[:3]
