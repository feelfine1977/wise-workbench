"""The readiness gate flags every planted artefact and passes clean logs."""

from __future__ import annotations

import pandas as pd
import pytest
import wise

import wise_analytics as wa
from wise_analytics.quality import DEFAULT_THRESHOLDS, vocabulary_drift

ARTEFACT_CHECK = {
    "censoring": "right_censoring",
    "replication": "replication",
    "sentinel_dates": "sentinel_dates",
    "duplicates": "duplicate_events",
    "precision_mix": "timestamp_precision",
    "vocabulary_drift": "vocabulary_drift",
    "unit_mixing": "exposure_sanity",
}


def _gate(log, truth, result=None):
    return wa.readiness(
        log,
        truth.norm,
        result=result,
        by=["company", "spend_area"],
        view="Finance",
        gamma=20.0,
        closure="Clear Invoice",
        group_col="company",
        document_col="document",
    )


def test_clean_log_has_no_failures(synthetic_clean):
    log, truth, result = synthetic_clean
    q = _gate(log, truth, result)
    assert q.status in ("pass", "warn") and q.failed() == []
    for check in ARTEFACT_CHECK.values():
        assert q.table.loc[check, "status"] in ("pass", "warn")
        if check != "vocabulary_drift":  # the partial first month may warn on JSD
            assert q.table.loc[check, "status"] == "pass", check
    assert set(q.table.columns) == {"status", "metric", "value", "threshold_warn", "threshold_fail", "evidence"}
    assert q.slices is not None and (q.slices["reading"] == "stable signal").all()


@pytest.mark.parametrize("artefact", sorted(ARTEFACT_CHECK))
def test_each_planted_artefact_is_flagged(artefact):
    value = wa.synthetic.DEFAULT_ARTEFACTS[artefact]
    log, truth = wa.generate(n_cases=2000, seed=3, artefacts={artefact: value})
    result = wise.score(log, truth.norm)
    q = _gate(log, truth, result)
    check = ARTEFACT_CHECK[artefact]
    assert q.table.loc[check, "status"] in ("warn", "fail"), (artefact, q.table.loc[check, "evidence"])
    assert check in q.evidence
    if artefact == "sentinel_dates":
        assert q.table.loc[check, "status"] == "fail" and set(q.evidence[check].index.astype(str)) <= {"1900-01-01", "2099-12-31"}
    if artefact == "vocabulary_drift":
        assert q.table.loc[check, "status"] == "fail" and truth.artefacts[artefact]["new_label"] in q.table.loc[check, "evidence"]
    if artefact == "unit_mixing":
        assert q.table.loc[check, "status"] == "fail" and "C3" in q.table.loc[check, "evidence"]
    if artefact == "precision_mix":
        assert q.table.loc[check, "status"] == "fail" and q.evidence[check].loc["Record Invoice Receipt", "mixed"]
    if artefact == "replication":
        assert q.table.loc["window_edge_share", "status"] == "pass"
        assert q.evidence[check].loc["replication_ratio", "max"] == 3.0
    if artefact == "censoring":
        assert q.table.loc["window_edge_share", "status"] in ("warn", "fail")
    assert q.readings[0].startswith("Readiness:")


def test_all_artefacts_together(synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    q = _gate(log, truth, result)
    assert q.status == "fail"
    for artefact, check in ARTEFACT_CHECK.items():
        assert q.table.loc[check, "status"] in ("warn", "fail"), artefact
    assert q.record.params["thresholds"] == DEFAULT_THRESHOLDS
    assert q.record.log_fingerprint == wa.log_fingerprint(log) and q.record.norm_fingerprint == truth.norm.fingerprint()
    assert any("blocked" in r for r in q.readings)


def test_running_example_passes(p2p_log, p2p_norm, p2p_result):
    q = wa.readiness(
        p2p_log,
        p2p_norm,
        result=p2p_result,
        by="company",
        view="Finance",
        gamma=2.0,
        closure=["Clear Invoice", "Cancel Invoice Receipt"],
        opened_by="Record Invoice Receipt",
    )
    assert q.status == "pass" and q.warned() == [] and q.failed() == []
    assert q.table.loc["vocabulary_drift", "status"] == "skipped" and q.table.loc["exposure_sanity", "status"] == "skipped"
    strict = wa.readiness(p2p_log, p2p_norm, result=p2p_result, by="company", view="Finance", gamma=2.0, closure="Clear Invoice")
    assert strict.table.loc["right_censoring", "status"] == "fail" and strict.slices.loc["B", "reading"].startswith(
        "gap collapses"
    )
    bare = wa.readiness(p2p_log)
    assert bare.table.loc["window_edge_share", "status"] == "skipped" and bare.table.loc["right_censoring", "status"] == "skipped"


def test_thresholds_are_configurable(synthetic_clean):
    log, truth, _result = synthetic_clean
    q = wa.readiness(log, truth.norm, thresholds={"concentration_share_warn": 0.0, "concentration_min_events": 1})
    assert q.table.loc["timestamp_concentration", "status"] == "warn"
    assert q.summary["thresholds"]["concentration_min_events"] == 1


def test_vocabulary_drift_table(synthetic_artefacts):
    log, truth, _ = synthetic_artefacts
    d = vocabulary_drift(log, "M", min_events=200, norm=truth.norm)
    assert {
        "n_events",
        "eligible",
        "reference",
        "jsd",
        "new_labels",
        "new_share",
        "vanished_labels",
        "vanished_share",
        "missing_norm_activities",
    } <= set(d.columns)
    drifted = d[d["new_labels"].str.contains("new", regex=False)]
    assert len(drifted) >= 1 and (drifted["new_share"] > 0).all()
    q = vocabulary_drift(log, "Q", reference="2023Q2")
    assert (q["reference"] == "2023Q2").all()
    assert isinstance(d.loc[d.index[0], "jsd"], float)
    empty = pd.DataFrame({"case": [], "activity": [], "time": pd.to_datetime([])})
    assert list(
        vocabulary_drift(wise.EventLog(empty, case_col="case", activity_col="activity", timestamp_col="time"), "M").columns
    ) == list(d.columns)
