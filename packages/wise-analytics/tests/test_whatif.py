"""Headroom identities and weight what-ifs from cached violations."""

from __future__ import annotations

import numpy as np
import pytest
import wise

import wise_analytics as wa


def test_headroom_zero_for_constraint_without_violations(p2p_result):
    h = wa.headroom(p2p_result, "Finance", {"company": "A"}, gamma=2.0)
    for cid in ("c1", "c3", "c4", "c6"):  # no violations of these in σA, σB
        assert (
            h.table.loc[cid, "headroom_score"] == 0.0
            and h.table.loc[cid, "headroom_PI"] == 0.0
            and h.table.loc[cid, "PI_reduction"] == 0.0
        )
    assert h.table.loc["c4", "n_evaluated"] == 0 and np.isnan(h.table.loc["c4", "share_violated"])
    assert h.table.loc["c2", "headroom_score"] == pytest.approx(0.45 * 0.75 / 2)


def test_headroom_identities(p2p_result, synthetic_balanced):
    for result, view, where, gamma in (
        (p2p_result, "Finance", {"company": "B"}, 2.0),
        (synthetic_balanced[2], "Logistics", {"company": "C3", "spend_area": "Logistics"}, 20.0),
    ):
        h = wa.headroom(result, view, where, gamma=gamma)
        assert h.summary["identity_error"] < 1e-9
        assert h.table["headroom_score"].sum() == pytest.approx(1.0 - h.summary["mean_score"], abs=1e-9)
        assert h.table["headroom_PI"].sum() == pytest.approx(h.summary["volume_s"] * (1.0 - h.summary["mean_score"]), abs=1e-6)
        assert (h.table["PI_reduction"] <= h.summary["stable_PI"] + 1e-12).all() and (h.table["PI_reduction"] >= -1e-12).all()
        assert (h.table["stable_PI_after"] >= -1e-12).all()
        assert (h.table["headroom_score"] >= 0).all()
        assert h.summary["baseline"] == "global mean (held fixed)"


def test_headroom_removes_planted_gap(synthetic_clean):
    _log, truth, result = synthetic_clean
    hs = truth.hotspots[0]
    h = wa.headroom(result, "Finance", dict(hs.where), gamma=20.0)
    assert h.summary["top_constraint"] == hs.constraint
    assert h.table.loc[hs.constraint, "stable_PI_after"] == 0.0 and h.table.loc[hs.constraint, "share_of_PI"] == 1.0
    long = wa.headroom_by(result, ["company", "spend_area"], "Finance", gamma=20.0)
    key = (hs.where["company"], hs.where["spend_area"], hs.constraint)
    assert long.loc[key, "mean_penalty"] == pytest.approx(h.table.loc[hs.constraint, "mean_penalty"])
    assert long.loc[key, "stable_PI_after"] == pytest.approx(h.table.loc[hs.constraint, "stable_PI_after"])
    assert long.attrs["baseline"] == pytest.approx(h.summary["global_mean"])
    with pytest.raises(wise.NotScoredError):
        wa.headroom(result, "Finance", {"company": "none"})


@pytest.mark.parametrize("fixture", ["synthetic_clean", "synthetic_balanced"])
def test_rescore_view_reproduces_library_scoring(request, fixture):
    log, _truth, result = request.getfixturevalue(fixture)
    for view in result.views:
        frame = wa.rescore_view(result, view)
        assert np.array_equal(frame["score"].to_numpy(), result.scores[view].to_numpy(), equal_nan=True)
        for layer in result.norm.layer_ids:
            assert np.array_equal(
                frame[f"contrib__{layer}"].to_numpy(), result.contributions[view][layer].to_numpy(), equal_nan=True
            )
    # a fresh view: cached rescoring equals a full library scoring run
    new = wise.View(
        "Mixed", layer_weights={"completeness": 0.3, "lead_times": 0.3, "match": 0.2, "handling": 0.1, "exceptions": 0.1}
    )
    frame = wa.rescore_view(result, new)
    full = wise.score(log, result.norm.replace(views=(*result.norm.views, new)), views="Mixed", mode=result.mode)
    assert np.array_equal(frame["score"].to_numpy(), full.scores["Mixed"].to_numpy(), equal_nan=True)
    frame2 = wa.rescore_view(
        result, {"completeness": 0.3, "lead_times": 0.3, "match": 0.2, "handling": 0.1, "exceptions": 0.1}, name="Mixed"
    )
    assert np.array_equal(frame2["score"].to_numpy(), full.scores["Mixed"].to_numpy(), equal_nan=True)
    with pytest.raises(wise.NormError):
        wa.rescore_view(result, {"c1": 1.0, "completeness": 1.0})


def test_whatif_same_weights_is_identity(p2p_result, synthetic_balanced):
    for result, by, gamma in ((p2p_result, "company", 2.0), (synthetic_balanced[2], ["company", "spend_area"], 20.0)):
        w = wa.whatif_weights(result, "Finance", by=by, view="Finance", gamma=gamma, name="Finance")
        t = w.table
        for col in ("n_cases", "mean_score", "stable_gap", "stable_PI", "rank"):
            assert np.array_equal(t[f"{col}_before"].to_numpy(), t[f"{col}_after"].to_numpy())
        assert (t["rank_shift"] == 0).all() and w.summary["top_k_overlap"] == 1.0 and w.summary["n_rank_changes"] == 0
        assert w.summary["global_mean_before"] == w.summary["global_mean_after"]


def test_whatif_other_view_matches_library(synthetic_clean):
    _log, _truth, result = synthetic_clean
    by = ["company", "spend_area"]
    w = wa.whatif_weights(result, "Logistics", by=by, view="Finance", gamma=20.0, k=5)
    lib = wise.prioritize(result, by, view="Logistics", gamma=20.0)
    after = w.table.sort_values("rank_after")
    assert list(after.index) == list(lib.index)
    assert np.allclose(after["stable_PI_after"].to_numpy(), lib["stable_PI"].to_numpy())
    assert w.summary["top_k_overlap"] == wise.top_k_overlap(wise.prioritize(result, by, view="Finance", gamma=20.0), lib, k=5)
    assert w.summary["weights_after"] == result.norm.get_view("Logistics").weights and w.view == "Logistics"
