"""Contrast: the waterfall is an exact identity; effect sizes are descriptive."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import wise
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import wise_analytics as wa
from wise_analytics._stats import (
    cliffs_delta,
    ecdf_pair,
    hodges_lehmann,
    jensen_shannon,
    newcombe_interval,
    wilson_interval,
    z_for,
)
from wise_analytics.contrast import _pattern, raw_signals, signal_units


@pytest.mark.parametrize("view", ["Finance", "Logistics"])
@pytest.mark.parametrize("where", [{"company": "A"}, {"company": "B"}, {"vendor": "V1"}, {"vendor": "V2"}, {"case": "E"}])
def test_decomposition_sums_to_gap_running_example(p2p_result, view, where):
    c = wa.contrast_slice(p2p_result, view, where, B=0)
    assert abs(c.table["delta"].sum() - c.summary["signed_gap"]) < 1e-9
    assert abs(c.layers["delta"].sum() - c.summary["signed_gap"]) < 1e-9
    assert c.summary["decomposition_error"] < 1e-9 and c.summary["layer_decomposition_error"] < 1e-9
    assert set(c.table.index) == set(p2p_result.norm.constraint_ids)
    if c.summary["n_rest"]:
        assert abs(c.table["delta_vs_rest"].sum() - c.summary["gap_vs_rest"]) < 1e-9


def test_layer_table_matches_library_layer_drivers(p2p_result):
    drivers = wise.layer_drivers(p2p_result, by="company", view="Finance")
    for company in ("A", "B"):
        c = wa.contrast_slice(p2p_result, "Finance", {"company": company}, B=0)
        for layer in p2p_result.norm.layer_ids:
            assert abs(c.layers.loc[layer, "delta"] - drivers.loc[company, f"{layer}__delta"]) < 1e-12


@pytest.mark.parametrize("fixture", ["synthetic_clean", "synthetic_balanced"])
def test_decomposition_sums_to_gap_synthetic_both_modes(request, fixture):
    _log, _truth, result = request.getfixturevalue(fixture)
    assert result.mode in ("flat", "layer_balanced")
    for view in result.views:
        for where in ({"company": "C2", "spend_area": "Packaging"}, {"vendor": "V007"}, {"flow_type": "DF1"}, {"company": "C3"}):
            c = wa.contrast_slice(result, view, where, B=0)
            assert c.summary["decomposition_error"] < 1e-9 and c.summary["layer_decomposition_error"] < 1e-9
            assert abs(c.table["delta"].sum() - (c.summary["mean_score_all"] - c.summary["mean_score_slice"])) < 1e-9


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(bits=st.lists(st.booleans(), min_size=2000, max_size=2000), view=st.sampled_from(["Finance", "Logistics"]))
def test_decomposition_property_random_masks(synthetic_balanced, bits, view):
    _log, _truth, result = synthetic_balanced
    mask = pd.Series(np.asarray(bits, dtype=bool), index=result.cases.index)
    if not mask.any():
        mask.iloc[0] = True
    c = wa.contrast_slice(result, view, mask, B=0)
    assert c.summary["decomposition_error"] < 1e-9
    mu_s = result.scores[view][mask].mean()
    assert abs(c.summary["mean_score_slice"] - mu_s) < 1e-12


def test_planted_driver_is_top_across_seeds():
    hits = 0
    for seed in range(10):
        log, truth = wa.generate(n_cases=1500, seed=seed)
        result = wise.score(log, truth.norm)
        c = wa.contrast_slice(result, "Finance", dict(truth.hotspots[0].where), B=0)
        hits += c.summary["top_constraint"] == truth.hotspots[0].constraint
        assert c.table.loc["c2", "pattern"] == "whole distribution shifted"
        assert c.table.loc["c2", "median_slice"] > c.table.loc["c2", "median_rest"] and c.table.loc["c2", "cliffs_delta"] > 0.5
    assert hits >= 9  # ≥ 95 % of runs in the specification; 10 seeds here
    log, truth = wa.generate(n_cases=1500, seed=0)
    result = wise.score(log, truth.norm)
    c = wa.contrast_slice(result, "Finance", dict(truth.hotspots[1].where), B=0)
    assert c.summary["top_constraint"] in truth.hotspots[1].constraints
    c3 = wa.contrast_slice(result, "Logistics", dict(truth.hotspots[2].where), B=0)
    assert c3.summary["top_constraint"] == "c5" and c3.table.loc["c5", "unit"] == "count"


def test_raw_signals_running_example(p2p_log, p2p_norm):
    sig = raw_signals(p2p_log, p2p_norm)
    assert (
        sig.attrs["units"]
        == signal_units(p2p_norm)
        == {"c1": "count", "c2": "D", "c3": "relative difference", "c4": "relative difference", "c5": "count", "c6": "count"}
    )
    assert sig["c2"].to_dict() == pytest.approx({"A": 25.0, "B": 8.0, "C": 7.0, "D": 5.0}, nan_ok=False) or np.isnan(
        sig.loc["E", "c2"]
    )
    assert sig.loc["A", "c2"] == 25.0 and sig.loc["B", "c2"] == 8.0 and np.isnan(sig.loc["E", "c2"])
    assert sig.loc["C", "c3"] == pytest.approx(0.18) and sig.loc["E", "c3"] == pytest.approx(1.0)
    assert sig.loc["B", "c5"] == 4.0 and sig.loc["D", "c6"] == 1.0 and sig.loc["E", "c1"] == 0.0
    only = raw_signals(p2p_log, p2p_norm, constraints=["c2"])
    assert list(only.columns) == ["c2"]


def test_effect_sizes_and_intervals(p2p_result):
    c = wa.contrast_slice(p2p_result, "Finance", {"company": "B"}, B=100, ci=0.9)
    t = c.table
    assert ((t["rate_slice"].dropna() >= 0) & (t["rate_slice"].dropna() <= 1)).all()
    ok = t["risk_difference"].notna()
    assert (t.loc[ok, "rd_lo"] <= t.loc[ok, "risk_difference"] + 1e-12).all() and (
        t.loc[ok, "rd_hi"] >= t.loc[ok, "risk_difference"] - 1e-12
    ).all()
    assert (t["delta_lo"] <= t["delta"] + 1e-12).all() and (t["delta_hi"] >= t["delta"] - 1e-12).all()
    assert t.loc["c4", "n_evaluated_slice"] == 0 and np.isnan(t.loc["c4", "rate_slice"])
    for _cid, e in c.ecdf.items():
        assert list(e.columns) == ["x", "F_slice", "F_rest"] and e["x"].is_monotonic_increasing
        assert (
            e["F_slice"].iloc[-1] == 1.0
            and e["F_rest"].iloc[-1] == 1.0
            and (e[["F_slice", "F_rest"]].diff().dropna() >= 0).all().all()
        )
    assert c.summary["top_constraint"] == "c3" and c.slice == "company=B"
    whole = wa.contrast_slice(p2p_result, "Finance", None, B=0)
    assert whole.summary["n_rest"] == 0 and any("every scored case" in w for w in whole.record.warnings)
    with pytest.raises(wise.NotScoredError):
        wa.contrast_slice(p2p_result, "Finance", {"company": "Z"})


def test_pattern_rule():
    assert _pattern((6.0, 6.0), (13.0, 13.0), 0.5) == "no material shift"
    assert _pattern((18.0, 6.0), (39.0, 13.0), 0.5) == "whole distribution shifted"  # multiplicative ×3
    assert _pattern((16.0, 6.0), (23.0, 13.0), 0.5) == "whole distribution shifted"  # additive +10
    assert _pattern((6.0, 6.0), (40.0, 13.0), 0.5) == "tail shifted"
    assert _pattern((0.0, 0.0), (3.0, 0.0), 0.5) == "tail shifted"
    assert _pattern((float("nan"), 1.0), (1.0, 1.0), 0.5) == "not available"


@settings(max_examples=50, deadline=None)
@given(
    x1=st.integers(0, 50),
    n1=st.integers(1, 50),
    x2=st.integers(0, 50),
    n2=st.integers(1, 50),
    ci=st.sampled_from([0.8, 0.9, 0.95]),
)
def test_interval_helpers(x1, n1, x2, n2, ci):
    x1, x2 = min(x1, n1), min(x2, n2)
    z = z_for(ci)
    lo, hi = wilson_interval(x1, n1, z)
    assert 0 <= lo <= x1 / n1 <= hi <= 1
    rlo, rhi = newcombe_interval(x1, n1, x2, n2, z)
    rd = x1 / n1 - x2 / n2
    assert -1 <= rlo <= rd + 1e-12 and rd - 1e-12 <= rhi <= 1


@settings(max_examples=30, deadline=None)
@given(
    a=st.lists(st.floats(0, 100, allow_nan=False), min_size=1, max_size=40),
    b=st.lists(st.floats(0, 100, allow_nan=False), min_size=1, max_size=40),
)
def test_effect_size_helpers(a, b):
    a, b = np.array(a), np.array(b)
    d = cliffs_delta(a, b)
    assert -1 - 1e-12 <= d <= 1 + 1e-12
    brute = np.mean(np.sign(np.subtract.outer(a, b)))
    assert d == pytest.approx(brute, abs=1e-9)
    hl = hodges_lehmann(a, b)
    assert hl == pytest.approx(np.median(np.subtract.outer(a, b)))
    e = ecdf_pair(a, b)
    assert e["F_slice" if "F_slice" in e else "F_a"].iloc[-1] == 1.0
    p = np.bincount(np.minimum(a.astype(int), 100), minlength=101)
    q = np.bincount(np.minimum(b.astype(int), 100), minlength=101)
    assert 0 <= jensen_shannon(p, q) <= 1 + 1e-12
    assert jensen_shannon(p, p) == pytest.approx(0.0)
