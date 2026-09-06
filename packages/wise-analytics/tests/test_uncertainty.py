"""Bootstrap intervals, badges, P(top-k) and the sensitivity envelope."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import wise
from conftest import COVERAGE_HOTSPOTS
from wise.errors import NormError

import wise_analytics as wa
from wise_analytics.uncertainty import STABILITY_RULE


def test_point_estimates_equal_prioritize(p2p_result):
    point = wise.prioritize(p2p_result, "company", view="Finance", gamma=2.0)
    u = wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=100, seed=0, min_support=2)
    pd.testing.assert_frame_equal(
        u.table[["n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI"]],
        point[["n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI"]],
    )
    assert list(u.table["rank"]) == [1, 2] and u.table.index[0] == "B"
    assert u.draws.shape == (100, 2) and list(u.draws.columns) == list(u.table.index)
    assert u.summary["baseline"] == "recomputed per replicate" and u.stability_rule() == STABILITY_RULE
    assert {
        "gap_lo",
        "gap_hi",
        "stable_gap_lo",
        "stable_PI_hi",
        "rank_lo",
        "rank_hi",
        "p_top5",
        "p_top10",
        "stability",
        "stability_reason",
    } <= set(u.table.columns)


def test_determinism_and_badges(synthetic_clean):
    _log, _truth, result = synthetic_clean
    by = ["company", "spend_area"]
    u1 = wa.bootstrap_backlog(result, by, "Finance", gamma=20.0, B=200, seed=11)
    u2 = wa.bootstrap_backlog(result, by, "Finance", gamma=20.0, B=200, seed=11)
    pd.testing.assert_frame_equal(u1.table, u2.table)
    top = u1.table.iloc[0]
    assert u1.table.index[0] == ("C2", "Packaging") and top["stability"] == "stable" and top["p_top5"] == 1.0
    assert top["rank_lo"] == 1 and top["rank_hi"] == 1
    t = u1.table
    assert (t["stable_gap_lo"] <= t["stable_gap"] + 1e-12).all() and (t["stable_gap_hi"] >= t["stable_gap"] - 1e-12).all()
    assert (t["rank_lo"] <= t["rank"]).all() and (t["rank_hi"] >= t["rank"]).all()
    assert set(t["stability"]) <= {"stable", "fragile", "insufficient_support"}
    for k in (5, 10):
        assert t[f"p_top{k}"].between(0, 1).all() and t[f"p_top{k}"].sum() <= k + 1e-9
    assert u1.summary["badges"]["stable"] + u1.summary["badges"]["fragile"] + u1.summary["badges"]["insufficient_support"] == len(
        t
    )


def test_insufficient_support_and_k_handling(p2p_result):
    u = wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=50, min_support=10, k=3)
    assert (u.table["stability"] == "insufficient_support").all() and u.table["stability_reason"].str.contains(
        "insufficient support"
    ).all()
    assert "p_top3" in u.table.columns and u.summary["k_badge"] == 3
    with pytest.raises(NormError):
        wa.bootstrap_backlog(p2p_result, "company", "Finance", k=0)
    with pytest.raises(NormError):
        wa.bootstrap_backlog(p2p_result, "company", "Finance", B=0)
    with pytest.raises(NormError):
        wa.bootstrap_backlog(p2p_result, "company", "Finance", cluster="nope")


def test_fixed_baseline_and_exposure_volume(synthetic_clean):
    _log, _truth, result = synthetic_clean
    u = wa.bootstrap_backlog(result, "vendor", "Finance", gamma=20.0, B=50, baseline=0.9, volume="exposure")
    point = wise.prioritize(result, "vendor", view="Finance", gamma=20.0, baseline=0.9, volume="exposure")
    pd.testing.assert_frame_equal(u.table[["stable_PI"]], point[["stable_PI"]])
    assert u.summary["baseline"] == "fixed" and u.summary["baseline_value"] == 0.9 and "exposure" in u.table.columns


def test_cluster_bootstrap(synthetic_clean):
    _log, _truth, result = synthetic_clean
    u = wa.bootstrap_backlog(result, ["company", "spend_area"], "Finance", gamma=20.0, B=100, cluster="document", seed=1)
    assert u.summary["cluster"] == "document" and u.summary["n_clusters"] == result.cases["document"].nunique()
    assert u.table.index[0] == ("C2", "Packaging") and u.table.iloc[0]["stability"] == "stable"
    assert not any("exchangeable" in w for w in u.record.warnings)


def test_null_logs_top_k_probabilities_average_to_k_over_slices():
    """Within one log the bootstrap conditions on the observed ranking, so the
    observed leader legitimately has a high P(top-k). Across independent null
    logs no slice is a consistent priority and Σ_s P(top-k) = k."""
    per_seed = []
    for seed in range(6):
        log, truth = wa.generate(n_cases=2000, seed=100 + seed, hotspots=())
        result = wise.score(log, truth.norm)
        u = wa.bootstrap_backlog(result, ["company", "spend_area"], "Finance", gamma=20.0, B=100, seed=0)
        total = u.table["p_top5"].sum()
        assert total <= 5 + 1e-9 and total > 4.5  # k slices are in the top-k of a replicate unless fewer have positive PI
        per_seed.append(u.table["p_top5"])
    avg = pd.concat(per_seed, axis=1).mean(axis=1)
    assert avg.max() < 0.7 and abs(avg.mean() - 5 / len(avg)) < 0.05


def test_interval_coverage_on_finite_population():
    """Draw samples from a large synthetic population; the 90 % interval of the
    raw gap must cover the population gap at roughly the nominal rate."""
    pop_log, truth = wa.generate(n_cases=40000, seed=7, hotspots=COVERAGE_HOTSPOTS)
    pop = wise.score(pop_log, truth.norm)
    by = ["company", "spend_area"]
    true_gap = wise.prioritize(pop, by, view="Finance", gamma=0.0)["gap"]
    hot_keys = [tuple(h.where[k] for k in by) for h in truth.hotspots]
    assert (true_gap.reindex(hot_keys) > 0.02).all()
    rng = np.random.default_rng(123)
    ids = pop_log.case_ids.to_numpy()
    covered, trials = 0, 0
    for rep in range(30):
        sample = wa.subsample_cases(pop_log, rng.choice(ids, size=1500, replace=False))
        res = wise.score(sample, truth.norm)
        u = wa.bootstrap_backlog(res, by, "Finance", gamma=0.0, B=200, seed=rep, ci=0.90)
        for key in hot_keys:
            if key not in u.table.index:
                continue
            row = u.table.loc[key]
            trials += 1
            covered += bool(row["gap_lo"] - 1e-12 <= true_gap[key] <= row["gap_hi"] + 1e-12)
    assert trials >= 100
    assert covered / trials >= 0.85, f"coverage {covered / trials:.3f} over {trials} trials"


def test_sensitivity_envelope(synthetic_clean):
    _log, _truth, result = synthetic_clean
    by = ["company", "spend_area"]
    e = wa.sensitivity_envelope(result, by, "Finance", gamma=20.0, k=5, seed=0, n_jitter=2)
    s = e.settings
    assert s.loc["reference", "top_k_overlap"] == 1.0
    graded = sum(1 for nc in result.norm.constraints if nc.constraint.type in ("lag", "balance", "singularity"))
    assert (s["kind"] == "threshold").sum() == 2 * graded and (s["kind"] == "weights").sum() == 2
    assert (s["kind"] == "gamma").sum() >= 3
    assert e.table.loc[("C2", "Packaging"), "always_topk"] and e.table.loc[("C2", "Packaging"), "rank_max"] == 1
    assert (e.table["rank_min"] <= e.table["rank_ref"]).all() and (e.table["rank_max"] >= e.table["rank_ref"]).all()
    assert e.summary["n_settings"] == len(s) and e.summary["n_always_topk"] >= 1
    detached = wise.ScoreResult(
        norm=result.norm,
        cases=result.cases,
        violations=result.violations,
        in_scope=result.in_scope,
        scores=result.scores,
        contributions=result.contributions,
        mode=result.mode,
        log=None,
        _weights=result._weights,
    )
    e2 = wa.sensitivity_envelope(detached, by, "Finance", gamma=20.0, k=5, gamma_grid=[0.0, 40.0], n_jitter=1)
    assert (e2.settings["kind"] == "threshold").sum() == 0 and any("threshold settings skipped" in w for w in e2.record.warnings)
    assert list(e2.settings.index) == ["reference", "gamma=0", "gamma=40", "weights~1"]
