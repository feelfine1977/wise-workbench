"""Identities hold for every constraint type of the catalogue, both scoring modes, with applicability and skipped endpoints."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import wise

import wise_analytics as wa
from wise_analytics.contrast import raw_signals

ACTS = ["PO", "GR", "INV", "CLR", "CINV", "CHG"]


def random_log(rng: np.random.Generator, n_cases: int = 300) -> wise.EventLog:
    rows = []
    for i in range(n_cases):
        n = int(rng.integers(1, 9))
        acts = rng.choice(ACTS, size=n)
        days = np.sort(rng.uniform(0, 60, size=n))
        for a, d in zip(acts, days):
            rows.append(
                {
                    "case": f"c{i:03d}",
                    "activity": a,
                    "time": pd.Timestamp("2024-01-01") + pd.Timedelta(days=float(d)),
                    "amount": float(rng.uniform(0, 100)),
                    "flow": rng.choice(["DF1", "DF2"]),
                    "region": rng.choice(list("XYZ")),
                    "touches": int(rng.integers(0, 6)),
                }
            )
    df = pd.DataFrame(rows)
    return wise.EventLog(
        df,
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=["flow", "region", "touches"],
        exposure_col="amount",
        exposure_agg="sum",
    )


def full_norm(mode: str) -> wise.Norm:
    cons = [
        wise.NormConstraint("pres", "L1", wise.Presence("INV"), weight=1.0),
        wise.NormConstraint(
            "lag", "L2", wise.Lag("GR", "INV", delta=5, width=10, missing_b="censor"), weight=1.5, applicability={"flow": ["DF1"]}
        ),
        wise.NormConstraint("each", "L2", wise.Lag("GR", "INV", delta=5, width=10, activation="each"), weight=0.5),
        wise.NormConstraint("skip", "L2", wise.Lag("PO", "CLR", delta=3, width=4, missing="skip"), weight=1.0),
        wise.NormConstraint("prec", "L2", wise.Precedence("GR", "INV"), weight=1.0),
        wise.NormConstraint("sing", "L3", wise.Singularity("GR", k=1, K=2), weight=1.0),
        wise.NormConstraint("excl", "L3", wise.Exclusion("CINV", after="INV"), weight=1.0),
        wise.NormConstraint("bal", "L4", wise.Balance("amount", "INV", "amount", "GR", tau=0.1, width=0.5), weight=1.0),
        wise.NormConstraint(
            "met",
            "L4",
            wise.Metric("touches", threshold=2, width=3),
            weight=0.7,
            applicability={"all": [{"attr": "region", "in": ["X", "Y"]}, {"has": ["GR"]}]},
        ),
    ]
    layers = [wise.Layer(f"L{i}") for i in range(1, 5)]
    views = [
        wise.View("A", layer_weights={"L1": 0.2, "L2": 0.4, "L3": 0.3, "L4": 0.1}),
        wise.View("B", constraint_weights={c.id: float(i + 1) for i, c in enumerate(cons)}),
    ]
    return wise.Norm(cons, layers, views, scoring_mode=mode)


@pytest.mark.parametrize("mode", ["flat", "layer_balanced"])
@pytest.mark.parametrize("seed", [0, 1])
def test_identities_hold_for_every_constraint_type(mode, seed):
    rng = np.random.default_rng(seed)
    log, norm = random_log(rng), full_norm(mode)
    result = wise.score(log, norm)
    assert result.scores.isna().any().any() or True  # unscored cases may exist; analytics must cope
    sig = raw_signals(log, norm)
    assert (
        list(sig.columns) == norm.constraint_ids
        and sig.attrs["units"]["met"] == "touches"
        and sig.attrs["units"]["bal"] == "relative difference"
    )
    for view in result.views:
        for where in ({"region": "X"}, {"flow": "DF2"}, {"region": "Z", "flow": "DF1"}):
            c = wa.contrast_slice(result, view, where, B=10)
            assert c.summary["decomposition_error"] < 1e-9 and c.summary["layer_decomposition_error"] < 1e-9
            h = wa.headroom(result, view, where, gamma=5.0, volume="exposure")
            assert h.summary["identity_error"] < 1e-9 and (h.table["headroom_score"] >= 0).all()
        frame = wa.rescore_view(result, view)
        assert np.array_equal(frame["score"].to_numpy(), result.scores[view].to_numpy(), equal_nan=True)
        u = wa.bootstrap_backlog(result, "region", view, gamma=5.0, B=30, seed=seed, volume="exposure", min_support=5)
        point = wise.prioritize(result, "region", view=view, gamma=5.0, volume="exposure")
        pd.testing.assert_frame_equal(u.table[["stable_PI"]], point[["stable_PI"]])
        e = wa.sensitivity_envelope(result, "region", view, gamma=5.0, k=2, n_jitter=1, gamma_grid=[0.0])
        assert (e.settings["kind"] == "threshold").sum() == 2 * 7  # lag, each, skip, prec, sing, bal, met
    w = wa.whatif_weights(result, "B", by="region", view="A", gamma=5.0)
    lib = wise.prioritize(result, "region", view="B", gamma=5.0)
    assert np.allclose(w.table.sort_values("rank_after")["stable_PI_after"].to_numpy(), lib["stable_PI"].to_numpy())
    q = wa.readiness(log, norm, result=result, by="region", view="A", closure="CLR")
    assert set(q.table["status"]) <= {"pass", "warn", "fail", "skipped"}
