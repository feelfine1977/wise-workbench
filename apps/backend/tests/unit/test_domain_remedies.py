"""Domain decisions preserve distinct evidence and historical assessment semantics."""

import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine import analytics
from wise_workbench.adapters.engine.filters import clause_mask
from wise_workbench.adapters.engine.logs import (
    build_log,
    censored_mask,
    closure_diagnostics,
    norm_interpretation_label,
    norm_interpretation_warnings,
    preview_decision,
    readiness_report,
)
from wise_workbench.application.services.decisions import fold_decision
from wise_workbench.domain import ColumnMapping
from wise_workbench.presets import BPIC19_MAPPING


def mapping(**extra):
    return ColumnMapping.from_dict(
        "m",
        "d",
        {
            "caseId": "case",
            "activity": "activity",
            "timestamp": "time",
            "eventId": "id",
            **extra,
        },
    )


def receipts():
    return pd.DataFrame(
        [
            {"case": "one", "activity": "Record Goods Receipt", "time": "2019-01-01", "id": "A", "amount": 40},
            {"case": "one", "activity": "Record Goods Receipt", "time": "2019-01-01", "id": "B", "amount": 60},
            {"case": "one", "activity": "Record Goods Receipt", "time": "2019-01-01", "id": "A", "amount": 40},
            {"case": "one", "activity": "Clear Invoice", "time": "2019-01-17", "id": "C", "amount": 100},
        ]
    )


def test_cleanup_preview_matches_new_preparation_and_preserves_ids_values():
    m, data = mapping(), receipts()
    original = build_log(data, m)
    preview = preview_decision(original, m, "collapse_duplicates", {})
    doc = fold_decision(m, "collapse_duplicates", {}, "decision")
    child = ColumnMapping.from_dict("child", "d", doc)
    cleaned = build_log(data, child)
    assert preview.events == 1 and len(cleaned.events) == len(original.events) - 1
    assert cleaned.events["id"].tolist() == ["A", "B", "C"]
    assert cleaned.events["amount"].tolist() == [40, 60, 100]
    assert len(original.events) == 4 and not m.dedupe and m.decisions == ()
    assert doc["decisions"][-1]["policy"] == "identical_prepared_rows_v1"
    # Typed historical artifacts are never re-cleaned on load.
    assert len(build_log(original.events, child, typed=True).events) == 4


def test_collision_only_has_no_duplicate_cleanup_action():
    log = build_log(receipts().drop(index=2), mapping())
    items = {i.id: i for i in readiness_report(log, mapping()).items}
    assert "duplicate_events" not in items
    collision = items["event_key_collisions"]
    assert collision.evidence["events"] == 1 and collision.evidence["identicalEvents"] == 0
    assert collision.decision is None
    assert collision.evidence["casesShare"] == 1 and collision.evidence["eventShare"] == pytest.approx(1 / 3)
    assert preview_decision(log, mapping(), "collapse_duplicates", {}).events == 0


def test_missing_ids_and_different_values_are_not_identical_rows():
    data = receipts().iloc[:3].copy()
    data["id"] = None
    m = mapping()
    child = ColumnMapping.from_dict("child", "d", fold_decision(m, "collapse_duplicates", {}, "dec"))
    cleaned = build_log(data, child)
    assert cleaned.events["amount"].tolist() == [40, 60]


def test_legacy_key_cleanup_is_replayed_and_not_silently_recovered_by_child():
    m, data = mapping(dedupe=True), receipts()
    legacy = build_log(data, m)
    child = ColumnMapping.from_dict("child", "d", fold_decision(m, "collapse_duplicates", {}, "dec"))
    assert child.decisions[-1]["legacyKeyDedupeInherited"] is True
    assert len(legacy.events) == 2
    assert build_log(data, child).events.equals(legacy.events)
    assert preview_decision(legacy, m, "collapse_duplicates", {}).events == 0


def closure_fixture():
    rows = []
    for cid, category, end, closed in (
        ("consign", "Consignment", "2019-01-10", False),
        ("old", "3-way match, invoice before GR", "2018-02-01", False),
        ("recent", "2-way match", "2019-01-10", False),
        ("paid", "3-way match, invoice after GR", "2019-01-17", True),
        ("unknown", None, "2019-01-10", False),
    ):
        rows.append(
            {
                "case": cid,
                "activity": "Clear Invoice" if closed else "Record Goods Receipt",
                "time": end,
                "id": cid,
                "case Item Category": category,
            }
        )
    m = mapping(
        caseAttributes=["case Item Category"],
        flowTyping=deepcopy(BPIC19_MAPPING["flowTyping"]),
        closureActivities=["Clear Invoice"],
    )
    return build_log(pd.DataFrame(rows), m), m


def test_closure_applicability_does_not_change_legacy_filter_membership():
    log, m = closure_fixture()
    end = pd.Timestamp("2019-01-17")
    flags = censored_mask(log, m, end)
    assert flags.to_dict() == {"consign": True, "old": False, "paid": False, "recent": True, "unknown": True}
    diag = closure_diagnostics(log, m, end)
    assert (diag["applicableCases"], diag["notApplicableCases"], diag["unknownApplicabilityCases"]) == (3, 1, 1)
    assert diag["closureObservedCases"] == 1 and diag["closureNotObservedCases"] == 2
    assert diag["recentUnclosedCases"] == 1 and diag["recentUnclosedShare"] == pytest.approx(1 / 3)
    assert diag["legacyFlaggedCases"] == 3
    complement = clause_mask(log, {"kind": "open", "value": False}, censored=flags)
    assert bool(complement.loc["old"])  # Retained legacy filter; never relabel as business-closed.


def test_ambiguous_category_is_unknown_and_missing_time_has_no_recent_measurement():
    log, m = closure_fixture()
    rows = log.events.copy()
    extra = rows.loc[rows["case"].eq("consign")].copy()
    extra["case Item Category"] = "2-way match"
    rows = pd.concat([rows, extra], ignore_index=True)
    rows.loc[rows["case"].eq("recent"), "time"] = pd.NaT
    diag = closure_diagnostics(build_log(rows, m), m, pd.Timestamp("2019-01-17"))
    assert diag["unknownApplicabilityCases"] == 2 and diag["notApplicableCases"] == 0
    assert diag["timestampUnknownCases"] == 1 and diag["recentUnclosedEvaluableCases"] == 2
    assert diag["recentUnclosedCases"] == 0


def test_all_consignment_or_missing_closure_has_no_defined_applicable_rate():
    log, m = closure_fixture()
    only = build_log(log.events.loc[log.events["case"].eq("consign")], m)
    assert closure_diagnostics(only, m)["recentUnclosedShare"] is None
    unknown = closure_diagnostics(log, replace(m, closure_activities=()))
    assert unknown["unknownApplicabilityCases"] == len(log)
    assert unknown["legacyFlaggedCases"] is None and unknown["recentUnclosedShare"] is None


def test_readiness_and_gate_disclose_legacy_flag_and_separate_applicability():
    log, m = closure_fixture()
    report = readiness_report(log, m)
    items = {i.id: i for i in report.items}
    assert "recent-unclosed" in items["right_censored"].message
    assert "Not flagged does not mean closed" in items["right_censored"].message
    assert items["closure_applicability"].evidence["notApplicableCases"] == 1
    gate = analytics.gate_report(log, m)
    if gate is not None:
        assert gate.summary["closure_diagnostics"]["notApplicableCases"] == 1
        assert gate.table.loc["right_censoring", "metric"] == "legacy recent-unclosed share (all cases)"


@pytest.mark.parametrize("missing", ["skip", "violate", "censor"])
def test_setting_censor_window_keeps_each_constraint_policy(missing):
    m = mapping(openCases="censor", closureActivities=["Clear Invoice"])
    data = pd.DataFrame(
        [
            {"case": "open", "activity": "Invoice", "time": "2018-01-01", "id": "1"},
            {"case": "clock", "activity": "Other", "time": "2018-12-31", "id": "2"},
        ]
    )
    log = build_log(data, m)
    rule = wise.NormConstraint(
        "lag", "time", wise.Lag("Invoice", "Clear Invoice", delta=30, width=60, missing_a="skip", missing_b=missing)
    )
    measured = wise.evaluate_constraint(log, rule)
    assert pd.isna(measured.loc["open"]) if missing == "skip" else measured.loc["open"] == 1
    message = next(i.message for i in readiness_report(log, m).items if i.id == "right_censored")
    assert "each rule retains its missing-event policy" in message


def reference_document():
    return json.loads(
        (
            Path(__file__).parents[4]
            / "packages/process-knowledge/src/wise_knowledge/data/p2p/templates/p2p_bpic19.json"
        ).read_text()
    )


def test_reference_advisories_and_endpoint_labels_do_not_mutate_norm():
    document = reference_document()
    before = deepcopy(document)
    rows = pd.DataFrame([{"case": "one", "activity": "Change payment term", "time": "2019-01-01", "id": "a"}])
    notices = norm_interpretation_warnings(build_log(rows, mapping()), document)
    assert any("Change Payment Terms" in x and "observed label is 'Change payment term'" in x for x in notices)
    assert any("Vendor creates credit memo" in x and "not observed" in x for x in notices)
    assert any("supplied evidence population" in x for x in notices)
    assert any("activation=first, response=first_overall, missing_b=skip" in x for x in notices)
    assert any("does not measure contractual lateness" in x for x in notices)
    assert (
        norm_interpretation_label("c_l3_invoice_to_clear_days", document) == "Invoice evidence-to-clearing elapsed time"
    )
    assert (
        norm_interpretation_label("c_l2_df1_invoice_after_goods", document) == "Invoice evidence before first receipt"
    )
    assert document == before


def test_label_follows_actual_endpoints_and_leaves_other_rules_alone():
    doc = {
        "constraints": [
            {"id": "lag", "type": "lag", "params": {"a": ["Record Invoice Receipt"], "b": ["Clear Invoice"]}}
        ]
    }
    assert norm_interpretation_label("lag", doc) == "Invoice receipt-to-clearing elapsed time"
    doc["constraints"][0]["params"]["b"] = ["Delivery"]
    assert norm_interpretation_label("lag", doc) is None

    doc["constraints"][0].update(
        type="precedence",
        params={"a": ["Delivery"], "b": ["Vendor creates invoice", "Record Invoice Receipt"]},
    )
    assert norm_interpretation_label("lag", doc) is None


@pytest.mark.parametrize("share", [None, 0.0, 0.2, 0.5])
def test_gate_interpretation_changes_only_presentation(share):
    from wise_workbench.application.services.review import ReviewService, _gate_display_text

    service = ReviewService(None)
    for kind in ("censoring", "replication"):
        gate = service._share_gate(kind, share, 0.2, 0.5, "legacy words", "items")
        original = deepcopy(gate)
        text = _gate_display_text(gate, "items")
        assert gate == original
        if share is None:
            assert "unavailable" in text and gate["status"] == "pending"
        elif kind == "censoring":
            assert "regardless of closure applicability" in text
            assert "Not flagged does not mean closed" in text
        else:
            assert "more than two events per distinct timestamp" in text
            assert "not proof of copied postings or identical events" in text
        if share == 0.2:
            assert gate["status"] == "pending"
        if share == 0.5:
            assert gate["status"] == "failed"
