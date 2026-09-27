"""Rare observed misses must not be described as an expectation that cannot fail."""

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from wise_workbench.adapters.engine import gateway
from wise_workbench.adapters.storage import Workspace


@pytest.mark.parametrize("misses", [2472, 870, 1, 0])
def test_rare_warning_reports_exact_observations_without_claiming_impossibility(tmp_path, monkeypatch, misses):
    evaluated = 251734
    # Keep some unevaluated cases to distinguish evaluated support from applicability.
    values = np.concatenate([np.full(misses, 0.25), np.zeros(evaluated - misses), np.full(100, np.nan)])
    violations = pd.DataFrame({"rare": values})
    before = violations.copy(deep=True)
    scope = pd.DataFrame({"rare": np.ones(len(values), dtype=bool)})
    engine = gateway.EngineAdapter(Workspace(tmp_path))
    constraint = SimpleNamespace(id="rare", layer="corrections", description="Repeated correction")
    monkeypatch.setattr(gateway, "_norm_from", lambda _: SimpleNamespace(constraints=[constraint]))
    monkeypatch.setattr(engine, "_get_violations", lambda *_: violations)
    monkeypatch.setattr(engine, "_in_scope", lambda _: scope)
    monkeypatch.setattr(engine, "_measurement", lambda _: {})
    monkeypatch.setattr(
        engine, "_guidance_for", lambda *_: SimpleNamespace(plain_name="Repeated correction", hub_node=None)
    )
    run = SimpleNamespace(id="observed-run")
    context = SimpleNamespace(document={}, case_noun="purchase order items")

    (warning,) = engine.uncalibrated(run, context)

    assert warning["reason"] == "almost_never_missed"
    assert warning["share_violated"] == misses / evaluated
    assert warning["evaluated"] == evaluated and warning["applies_to"] == evaluated + 100
    assert "251,734 evaluated purchase order items" in warning["text"]
    assert "cannot fail" not in warning["text"] and "100 %" not in warning["text"]
    assert "check whether it distinguishes the problem" in warning["text"]
    if misses:
        assert f"rarely missed on this log — {misses:,} of" in warning["text"]
        assert "no observed misses" not in warning["text"]
    else:
        assert "no observed misses" in warning["text"] and "rarely missed" not in warning["text"]
    pd.testing.assert_frame_equal(violations, before)
