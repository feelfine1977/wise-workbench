"""The readiness gate flags every planted artefact and passes clean logs."""

from __future__ import annotations

import pandas as pd
import pytest
import wise

import wise_analytics as wa
from wise_analytics.quality import DEFAULT_THRESHOLDS, vocabulary_drift
from wise_analytics.vocabulary import check_reading

ARTEFACT_CHECK = {
    "censoring": "right_censoring",
    "replication": "replication",
    "sentinel_dates": "sentinel_dates",
    "duplicates": "duplicate_events",
    "precision_mix": "timestamp_precision",
    "vocabulary_drift": "vocabulary_drift",
    "unit_mixing": "exposure_sanity",
    "logging_asymmetry": "logging_asymmetry",
    "frequency_drift": "frequency_drift",
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
    assert set(q.table.columns) == {"status", "metric", "value", "threshold_warn", "threshold_fail", "window_end", "evidence"}
    assert q.slices is not None and (q.slices["reading"] == "stable signal").all()
    for check in ("frequency_drift", "logging_asymmetry"):
        assert q.table.loc[check, "status"] == "pass", check


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
    if artefact == "logging_asymmetry":
        detail = q.evidence[check].reset_index()
        row = detail[detail["releasing"] == "Remove Payment Block"].iloc[0]
        assert row["share_release_without_set"] > 0.9 and row["n_setting_events"] < row["n_releasing_events"]
        assert q.table.loc[check, "status"] == "warn"  # the norm does not reference the setting activity
    if artefact == "frequency_drift":
        detail = q.evidence[check]
        planted = truth.artefacts[artefact]
        assert detail.index[0] == planted["activity"] and q.table.loc[check, "status"] == "fail"
        assert detail.iloc[0]["share_after"] > detail.iloc[0]["share_before"]
        assert detail.iloc[0]["step_period"][:7] in (planted["from"][:7], str(pd.Period(planted["from"][:7], freq="M") + 1))
    assert q.readings[0].startswith("Readiness:")
    assert (q.table["window_end"] == q.window_end).all()


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


# ----------------------------------------------------------------------------- cycle 2: one window end, caveats, new checks
def test_window_end_is_the_library_robust_window(synthetic_clean):
    log, truth, result = synthetic_clean
    q = _gate(log, truth, result)
    lib_end = log.observation_window()[1]
    assert q.window_end == lib_end and q.summary["window_end"] == lib_end
    assert q.summary["window_end_source"].startswith("robust observation window")
    assert (q.table["window_end"] == lib_end).all() and q.record.params["window_end"] == str(lib_end)
    assert str(lib_end.date()) in q.table.loc["right_censoring", "evidence"]
    assert str(lib_end.date()) in q.readings[0]
    # the censored flags are the library's with that window end
    lib = wise.right_censored(log, "Clear Invoice", window="60D", window_end=lib_end)
    assert q.case_flags["censored"].equals(lib.reindex(q.case_flags.index).astype(bool))
    assert q.table.loc["right_censoring", "value"] == pytest.approx(float(lib.mean()))
    # explicit window and explicit argument take precedence
    explicit, t2 = wa.generate(n_cases=500, seed=1, explicit_window=True)
    qe = wa.readiness(explicit, t2.norm)
    assert qe.window_end == explicit.window[1] and qe.summary["window_end_source"].startswith("explicit log window")
    qa = wa.readiness(log, truth.norm, window_end="2024-06-30")
    assert qa.window_end == pd.Timestamp("2024-06-30") and qa.summary["window_end_source"] == "explicit argument"
    assert qa.record.record_id != q.record.record_id


def test_window_end_falls_back_when_the_robust_end_is_a_sentinel(synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    q = _gate(log, truth, result)
    assert log.observation_window()[1] == pd.Timestamp("2099-12-31")
    assert q.window_end < pd.Timestamp("2025-01-02") and q.window_end > pd.Timestamp("2024-12-01")
    assert q.summary["window_end_source"].startswith("bulk of timestamps")
    assert q.table.loc["sentinel_dates", "status"] == "fail"
    assert any("robust observation window ends at 2099-12-31" in w for w in q.record.warnings)
    assert q.table.loc["right_censoring", "status"] in ("warn", "fail") and q.table.loc["right_censoring", "value"] > 0.05


def test_duplicate_definition_matches_the_library_dedupe_key(synthetic_artefacts):
    log, truth, _ = synthetic_artefacts
    q = wa.readiness(log, truth.norm)
    ev = log.events
    key = ev.duplicated(subset=[log.case_col, log.activity_col, log.timestamp_col])
    deduped = wise.EventLog(
        ev,
        case_col=log.case_col,
        activity_col=log.activity_col,
        timestamp_col=log.timestamp_col,
        case_attributes=list(log.case_attributes),
        exposure_col=log.exposure_col,
        dedupe=True,
    )
    n_dropped = len(ev) - len(deduped.events)
    detail = q.evidence["duplicate_events"]
    assert detail.loc["duplicate (case, activity, timestamp)", "n_events"] == int(key.sum()) == n_dropped
    assert q.table.loc["duplicate_events", "value"] == pytest.approx(float(key.mean()))
    assert detail.loc["exact duplicate rows", "n_events"] <= detail.loc["duplicate (case, activity, timestamp)", "n_events"]
    per_case = key.groupby(ev[log.case_col].to_numpy()).any().reindex(log.case_ids, fill_value=False)
    assert q.case_flags["duplicate"].equals(per_case.astype(bool))
    prec = q.evidence["timestamp_precision"]
    assert set(prec["precision"]) <= {"day", "time", "mixed"} and prec.loc["Record Invoice Receipt", "precision"] == "mixed"


def test_caveats_for_slice(synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    q = _gate(log, truth, result)
    where = dict(truth.hotspots[0].where)
    caveats = wa.caveats_for_slice(q, where, items="purchase order items", closure_label="clearing")
    ids = [c.id for c in caveats]
    assert ids == [k for k in ("censoring", "replication", "duplicates", "sentinel_dates", "window_edge") if k in ids]
    assert {"censoring", "replication", "duplicates", "sentinel_dates"} <= set(ids)
    mask = (log.cases["company"] == where["company"]) & (log.cases["spend_area"] == where["spend_area"])
    for c in caveats:
        col = {
            "censoring": "censored",
            "replication": "replicated",
            "duplicates": "duplicate",
            "sentinel_dates": "sentinel",
            "window_edge": "window_edge",
        }[c.id]
        assert c.n == int((q.case_flags[col] & mask).sum()) and c.n_group == int(mask.sum())
        assert c.share == pytest.approx(c.n / c.n_group) and 0 < c.share <= 1
        assert c.status in ("pass", "warn", "fail") and c.window_end == q.window_end
        assert "purchase order items" in c.text and c.text.startswith(f"{100 * c.share:.0f} % of purchase order items")
        check_reading(c.text)
        d = c.to_dict()
        assert set(d) == {"id", "n", "n_group", "share", "status", "text", "window_end"} and d["window_end"] == str(
            q.window_end.date()
        )
    cens = next(c for c in caveats if c.id == "censoring")
    assert cens.text.endswith(f"still open at the end of the data ({q.window_end.date()}): late clearing cannot be judged")
    # a mask works too; min_share filters; the whole log gives the check values
    same = wa.caveats_for_slice(q, mask, items="purchase order items", closure_label="clearing")
    assert [(c.id, c.n) for c in same] == [(c.id, c.n) for c in caveats]
    assert all(c.share > 0.5 for c in wa.caveats_for_slice(q, where, min_share=0.5))
    whole = {c.id: c for c in wa.caveats_for_slice(q, None)}
    assert whole["censoring"].share == pytest.approx(q.table.loc["right_censoring", "value"])
    assert whole["replication"].share == pytest.approx(q.table.loc["replication", "value"])
    by = wa.caveats_by(q, ["company", "spend_area"])
    key = (where["company"], where["spend_area"])
    assert by.loc[key, "n_cases"] == cens.n_group and by.loc[key, "censoring_share"] == pytest.approx(cens.share)
    assert by.attrs["window_end"] == q.window_end
    bare = wa.readiness(log)
    assert "censored" not in bare.case_flags.columns and not [c for c in wa.caveats_for_slice(bare, where) if c.id == "censoring"]


def test_validation_reading_names_the_censored_share(synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    q = wa.readiness(
        log,
        truth.norm,
        result=result,
        by=["company", "spend_area"],
        view="Finance",
        gamma=20.0,
        closure="Clear Invoice",
        items="purchase order items",
        closure_label="clearing",
        thresholds={"censored_share_fail": 0.10},
    )
    s = q.slices
    assert {"library_reading", "caveat"} <= set(s.columns) and s.attrs["window_end"] == str(q.window_end)
    heavy = s[s["censored_share"] >= 0.10]
    assert len(heavy) >= 1
    for _key, row in heavy.iterrows():
        assert row["caveat"].startswith(
            f"{100 * row['censored_share']:.0f} % of purchase order items still open at the end of the data"
        )
        assert "late clearing cannot be judged" in row["reading"] and str(q.window_end.date()) in row["reading"]
        if row["library_reading"] != "stable signal":
            assert row["reading"].startswith(row["library_reading"])
        assert any(row["reading"] in r for r in q.readings)
    light = s[s["censored_share"] < 0.10]
    assert (light["caveat"] == "").all() and (light["reading"] == light["library_reading"]).all()


def test_logging_asymmetry_helpers(synthetic_artefacts):
    log, truth, _ = synthetic_artefacts
    from wise_analytics.quality import activity_pairs

    pairs = activity_pairs(log.activity_labels)
    assert ("Set Payment Block", "Remove Payment Block") in pairs and (
        "Record Invoice Receipt",
        "Cancel Invoice Receipt",
    ) in pairs
    assert activity_pairs(["Create Purchase Order Item", "Delete Purchase Order Item", "Clear Invoice"]) == [
        ("Create Purchase Order Item", "Delete Purchase Order Item")
    ]
    t = wa.logging_asymmetry(log, norm=truth.norm)
    row = t.loc[("Set Payment Block", "Remove Payment Block")]
    planted = truth.artefacts["logging_asymmetry"]
    assert row["cases_with_release"] <= planted["n_release_cases"] and row["n_setting_events"] <= planted["n_set_cases"]
    assert row["share_release_without_set"] > 0.9 and row["event_ratio"] > 10 and not row["setting_in_norm"]
    explicit = wa.logging_asymmetry(log, [("Set Payment Block", "Remove Payment Block")])
    assert len(explicit) == 1 and explicit.iloc[0]["share_release_without_set"] == row["share_release_without_set"]
    # a norm that expects the setting activity turns the warning into a failure
    norm2 = truth.norm.replace(
        constraints=(*truth.norm.constraints, wise.NormConstraint("c7", "handling", wise.Presence("Set Payment Block")))
    )
    q = wa.readiness(log, norm2)
    assert (
        q.table.loc["logging_asymmetry", "status"] == "fail"
        and "the norm references Set Payment Block" in q.table.loc["logging_asymmetry", "evidence"]
    )
    q2 = wa.readiness(log, truth.norm, asymmetry_pairs=[("Set Payment Block", "Remove Payment Block")])
    assert q2.table.loc["logging_asymmetry", "status"] == "warn" and q2.record.params["asymmetry_pairs"] == [
        ["Set Payment Block", "Remove Payment Block"]
    ]
    none = wa.readiness(log, truth.norm, asymmetry_pairs=[])
    assert none.table.loc["logging_asymmetry", "status"] == "skipped"


def test_activity_frequency_drift_table(synthetic_artefacts):
    log, truth, _ = synthetic_artefacts
    planted = truth.artefacts["frequency_drift"]
    q = wa.readiness(log, truth.norm)
    t = wa.activity_frequency_drift(log, "M", window_end=q.window_end, min_cases=50)
    assert set(t.columns) == {"n_cases", "n_with", "share", "eligible", "censored"} and t.index.names == ["activity", "period"]
    req = t.loc[planted["activity"]]
    assert (req["share"].between(0, 1)).all() and (req["n_with"] <= req["n_cases"]).all()
    assert req["censored"].iloc[-1] and not req[req["eligible"] & ~req["censored"]].empty
    early = req[(req.index < planted["from"][:7]) & req["eligible"] & ~req["censored"]]["share"].mean()
    late = req[(req.index > planted["from"][:7]) & req["eligible"] & ~req["censored"]]["share"].mean()
    assert early < 0.25 and late > 0.4
    per = q.evidence["frequency_drift__periods"]
    assert per.equals(t)
    summary = q.evidence["frequency_drift"]
    assert summary.index[0] == planted["activity"] and summary.iloc[0]["step_size"] > 0.3
    assert (summary["n_periods"] + summary["n_censored"] <= len(req)).all()
    assert wa.activity_frequency_drift(log, "M", activities=[]).empty
