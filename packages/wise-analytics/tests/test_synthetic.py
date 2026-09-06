"""The synthetic generator: deterministic, scoreable by the running norm, truthful."""

from __future__ import annotations

import numpy as np
import pytest
import wise

import wise_analytics as wa
from wise_analytics.provenance import log_fingerprint
from wise_analytics.synthetic import CASE_ATTRIBUTES, DEFAULT_ARTEFACTS, MECHANISMS


def test_generate_is_deterministic():
    a, ta = wa.generate(n_cases=500, seed=5, artefacts=DEFAULT_ARTEFACTS)
    b, tb = wa.generate(n_cases=500, seed=5, artefacts=DEFAULT_ARTEFACTS)
    assert log_fingerprint(a) == log_fingerprint(b)
    assert ta.hotspots == tb.hotspots and dict(ta.artefacts) == dict(tb.artefacts)
    c, _ = wa.generate(n_cases=500, seed=6, artefacts=DEFAULT_ARTEFACTS)
    assert log_fingerprint(c) != log_fingerprint(a)


def test_generate_shape_and_truth(synthetic_clean):
    log, truth, result = synthetic_clean
    assert len(log) == 2000 and list(log.case_attributes) == list(CASE_ATTRIBUTES) and "exposure" in log.cases.columns
    assert truth.norm.fingerprint() == wise.running_p2p_norm().fingerprint()
    assert result.check_decomposition() < 1e-9 and result.scores["Finance"].notna().all()
    for h in truth.hotspots:
        assert h.n_cases > 0 and len(h.case_ids) == h.n_cases and h.constraints == MECHANISMS[h.mechanism]
        assert set(h.case_ids) <= set(log.case_ids)
    assert truth.hotspot_for("c2").mechanism == "lag" and truth.hotspot_for("c4") is None
    with pytest.raises(TypeError):
        truth.artefacts["x"] = 1  # type: ignore[index]


def test_planted_hotspot_tops_the_backlog(synthetic_clean):
    _log, _truth, result = synthetic_clean
    top = wise.prioritize(result, ["company", "spend_area"], view="Finance", gamma=20.0).index[0]
    assert top == ("C2", "Packaging")
    vendor_top = wise.prioritize(result, "vendor", view="Finance", gamma=20.0).index[0]
    assert vendor_top == "V007"
    logistics_top = wise.prioritize(result, ["company", "spend_area"], view="Logistics", gamma=20.0).index[0]
    assert logistics_top in {("C3", "Logistics"), ("C2", "Packaging")}


def test_artefacts_are_recorded(synthetic_artefacts):
    log, truth, _ = synthetic_artefacts
    art = truth.artefacts
    assert set(art) == set(DEFAULT_ARTEFACTS)
    assert art["sentinel_dates"]["n_events"] > 0 and art["replication"]["n_events_added"] > 0
    assert art["duplicates"]["n_events"] > 0 and art["precision_mix"]["n_events"] > 0
    assert art["vocabulary_drift"]["new_label"] in log.activity_labels
    assert art["censoring"]["n_events_dropped"] > 0 and len(art["censoring"]["case_ids_truncated"]) > 0
    assert art["unit_mixing"]["company"] == "C3"
    assert art["logging_asymmetry"]["n_release_cases"] > 10 * art["logging_asymmetry"]["n_set_cases"]
    assert "Remove Payment Block" in log.activity_labels and art["frequency_drift"]["n_events"] > 0
    assert art["frequency_drift"]["activity"] in log.activity_labels


def test_late_artefacts_leave_the_rest_of_the_log_unchanged():
    base = {k: v for k, v in DEFAULT_ARTEFACTS.items() if k not in ("logging_asymmetry", "frequency_drift")}
    a, ta = wa.generate(n_cases=800, seed=4, artefacts=base)
    b, tb = wa.generate(n_cases=800, seed=4, artefacts=DEFAULT_ARTEFACTS)
    extra = {"Set Payment Block", "Remove Payment Block", "Create Purchase Requisition Item"}
    kept = b.events[~b.events["activity"].isin(extra)]
    cols = ["case", "activity", "time", "amount", "resource"]
    left = a.events[cols].sort_values(cols, kind="mergesort").reset_index(drop=True)
    right = kept[cols].sort_values(cols, kind="mergesort").reset_index(drop=True)
    assert left.equals(right)
    assert ta.hotspots == tb.hotspots
    ra, rb = wise.score(a, ta.norm), wise.score(b, tb.norm)
    # the same scores up to the summation order of the shuffled amounts
    assert np.allclose(ra.scores["Finance"].to_numpy(), rb.scores["Finance"].to_numpy(), atol=1e-12, equal_nan=True)


def test_mechanisms_load_their_constraints():
    for mech, cons in MECHANISMS.items():
        strength = {"lag": 3.0, "missing_invoice": 0.5, "fragmentation": 3, "mismatch": 0.6, "cancellation": 0.5}[mech]
        log, truth = wa.generate(
            n_cases=1500, seed=2, hotspots=[{"where": {"company": "C2"}, "mechanism": mech, "strength": strength}]
        )
        result = wise.score(log, truth.norm)
        drivers = wise.constraint_drivers(result, "Logistics" if mech == "fragmentation" else "Finance", where={"company": "C2"})
        rest = wise.constraint_drivers(
            result, "Logistics" if mech == "fragmentation" else "Finance", where=result.cases["company"] != "C2"
        )
        lift = (drivers["mean_violation"] - rest["mean_violation"]).reindex(list(cons))
        assert (lift > 0).all(), (mech, lift)


def test_subsample_and_window():
    log, truth = wa.generate(n_cases=300, seed=9, explicit_window=True)
    assert log.window == truth.window
    ids = log.case_ids[:50]
    sub = wa.subsample_cases(log, ids)
    assert len(sub) == 50 and set(sub.case_ids) == set(ids) and sub.window == log.window and "exposure" in sub.cases.columns
    with pytest.raises(ValueError):
        wa.generate(template="o2c")
    with pytest.raises(ValueError):
        wa.generate(n_cases=100, hotspots=[{"where": {"company": "C1"}, "mechanism": "unknown", "strength": 1}])
    assert np.isfinite(log.cases["exposure"]).all()
