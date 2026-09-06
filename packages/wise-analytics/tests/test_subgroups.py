"""Sub-groups: the library's penalty mass by attribute value, with the censoring caveat on periods."""

from __future__ import annotations

import numpy as np
import pytest
import wise
from wise.errors import NormError

import wise_analytics as wa
from wise_analytics.vocabulary import check_reading


def test_subgroups_match_library_penalty_mass(synthetic_clean):
    _log, truth, result = synthetic_clean
    where = dict(truth.hotspots[0].where)
    sg = wa.subgroups(result, where, ["vendor", "flow_type"], view="Finance")
    mask = (result.cases["company"] == where["company"]) & (result.cases["spend_area"] == where["spend_area"])
    for attr in ("vendor", "flow_type"):
        lib = wise.penalty_mass(result, "Finance", by=attr, where=mask)
        part = sg.table.loc[attr]
        assert list(part.index) == list(lib.index)
        for col in ("n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "rank"):
            assert np.allclose(part[col].to_numpy(dtype=float), lib[col].to_numpy(dtype=float))
        assert abs(part["share"].sum() - 1.0) < 1e-9 and part["rank"].iloc[0] == 1
    assert sg.summary["n_slice"] == int(mask.sum()) and sg.attributes == ("vendor", "flow_type")
    assert abs(sg.summary["penalty_mass"] - (1.0 - result.scores["Finance"][mask]).sum()) < 1e-9
    facts = sg.summary["per_attribute"]["flow_type"]
    assert facts["n_values"] == 2 and facts["top_value"] == sg.table.loc["flow_type"].index[0]
    assert sg.summary["per_attribute"]["vendor"]["values_for_80pct"] <= facts["n_values"] + 40
    for r in sg.readings:
        check_reading(r)
    assert sg.readings[0].startswith("Inside company=C2, spend_area=Packaging under Finance, vendor = ")
    top = wa.subgroups(result, where, "vendor", view="Finance", top=3)
    assert len(top.table) == 3 and top.summary["per_attribute"]["vendor"]["n_values"] > 3
    assert abs(top.table["share"].sum()) < 1.0
    with pytest.raises(NormError):
        wa.subgroups(result, where, ["nope"], view="Finance")
    with pytest.raises(wise.NotScoredError):
        wa.subgroups(result, {"company": "none"}, ["vendor"], view="Finance")


def test_period_subgroups_carry_the_censoring_caveat(synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    where = dict(truth.hotspots[0].where)
    q = wa.readiness(
        log, truth.norm, result=result, by=["company", "spend_area"], view="Finance", gamma=20.0, closure="Clear Invoice"
    )
    sg = wa.subgroups(
        result,
        where,
        ["flow_type"],
        view="Finance",
        period="Q",
        censored=q.case_flags["censored"],
        window_end=q.window_end,
        items="purchase order items",
        closure_label="clearing",
    )
    periods = sg.table.loc["start_Q"]
    assert abs(periods["share"].sum() - 1.0) < 1e-9
    last = periods[periods["partial_period"]]
    assert len(last) >= 1 and (last["caveat"] != "").all()
    heavy = periods[periods["censored_share"] >= 0.2]
    assert len(heavy) >= 1
    for _v, row in heavy.iterrows():
        assert "still open at the end of the data" in row["caveat"] and str(q.window_end.date()) in row["caveat"]
        assert "late clearing cannot be judged" in row["caveat"] and "purchase order items" in row["caveat"]
    clean = periods[(periods["censored_share"] < 0.2) & ~periods["partial_period"]]
    assert (clean["caveat"] == "").all()
    assert sg.summary["period_attribute"] == "start_Q" and sg.summary["window_end"] == q.window_end
    assert any("open lags are skipped, not penalised" in r for r in sg.readings)
    for r in sg.readings:
        check_reading(r)
    # the same window end as the readiness gate; closure activities give the same flags as the readiness report
    by_closure = wa.subgroups(
        result, where, ["flow_type"], view="Finance", period="Q", closure="Clear Invoice", window_end=q.window_end
    )
    assert np.allclose(
        by_closure.table.loc["start_Q", "censored_share"].to_numpy(dtype=float), periods["censored_share"].to_numpy(dtype=float)
    )
    bare = wa.subgroups(result, where, ["flow_type"], view="Finance", period="Q")
    assert (
        any("window edge alone" in w for w in bare.record.warnings) and bare.table.loc["start_Q", "censored_share"].isna().all()
    )
    assert bare.record.record_id != sg.record.record_id and sg.record.params["period"] == "Q"


def test_period_needs_the_log(synthetic_clean):
    _log, truth, result = synthetic_clean
    where = dict(truth.hotspots[0].where)
    detached = wise.ScoreResult(
        norm=result.norm,
        cases=result.cases,
        violations=result.violations,
        in_scope=result.in_scope,
        scores=result.scores,
        contributions=result.contributions,
        mode=result.mode,
        norm_fingerprint=result.norm_fingerprint,
        _weights=result._weights,
    )
    with pytest.raises(NormError):
        wa.subgroups(detached, where, ["vendor"], view="Finance", period="Q")
    ok = wa.subgroups(detached, where, ["vendor"], view="Finance")
    assert len(ok.table) > 0 and ok.record.log_fingerprint is None
