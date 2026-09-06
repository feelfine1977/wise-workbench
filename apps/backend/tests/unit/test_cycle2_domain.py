"""Cycle 2 domain and engine helpers: slicings with bands, run scope, decisions, snapshots, bands, filters, histograms."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from wise_workbench.adapters.engine.bands import apply_bands, band_edges, band_summary, effective_attributes
from wise_workbench.adapters.engine.filters import parse_filter
from wise_workbench.adapters.engine.signals import distribution
from wise_workbench.domain import (
    DECISION_KINDS,
    ColumnMapping,
    RunManifest,
    RunParams,
    Slicing,
    Snapshot,
    ValidationError,
    slicing_id,
    validate_decision,
    validate_scope,
)


# ---------------------------------------------------------------------------- slicings, scope, params hash
def test_slicing_bands_and_ids() -> None:
    s = Slicing(
        id="", attributes=("company", "exposure"), bands=({"attribute": "exposure", "method": "quantile", "q": 4},)
    )
    assert s.id == "company+exposure:q4" and s.band_for("exposure") == {
        "attribute": "exposure",
        "method": "quantile",
        "q": 4,
    }
    assert s.to_dict()["bands"] == [{"attribute": "exposure", "method": "quantile", "q": 4}]
    cuts = Slicing(
        id="", attributes=("n_events",), bands=({"attribute": "n_events", "method": "cuts", "cuts": [3, 10]},)
    )
    assert cuts.id == "n_events:cuts(3,10)" and slicing_id(["a"]) == "a"
    with pytest.raises(ValidationError, match="at most 3"):
        Slicing(id="", attributes=("a", "b", "c", "d"))
    with pytest.raises(ValidationError, match="once"):
        Slicing(id="", attributes=("a", "a"))
    with pytest.raises(ValidationError, match="not one of"):
        Slicing(id="", attributes=("a",), bands=({"attribute": "b"},))
    with pytest.raises(ValidationError, match="ascending"):
        Slicing(id="", attributes=("a",), bands=({"attribute": "a", "method": "cuts", "cuts": [5, 1]},))
    with pytest.raises(ValidationError, match="2 to 20"):
        Slicing(id="", attributes=("a",), bands=({"attribute": "a", "q": 1},))


def test_scope_validation_and_params_hash_stability() -> None:
    assert validate_scope(None) is None
    assert validate_scope({"flow_type": "DF2"}) == {"flow_type": "DF2", "attribute": "flow_type"}
    assert validate_scope({"attribute": "case Item Category", "value": "2-way match"}) == {
        "attribute": "case Item Category",
        "value": "2-way match",
    }
    with pytest.raises(ValidationError, match="scope"):
        validate_scope({"nope": 1})
    with pytest.raises(ValidationError, match="scope"):
        validate_scope({"attribute": "x"})
    plain = RunParams("ct", "nv", slicings=(Slicing("", ("company",)),), gamma=20.0, min_cases=1)
    # the hash of a run without bands or scope is the cycle 1 hash (existing runs are reused)
    canonical = json.dumps(
        {
            "caseTableId": "ct",
            "normVersionId": "nv",
            "views": [],
            "slicings": [["company"]],
            "gamma": 20.0,
            "minCases": 1,
            "baselineRunId": None,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    import hashlib

    assert plain.params_hash() == hashlib.sha256(canonical.encode()).hexdigest()
    scoped = RunParams("ct", "nv", slicings=plain.slicings, gamma=20.0, min_cases=1, scope={"flow_type": "DF2"})
    banded = RunParams(
        "ct",
        "nv",
        slicings=(Slicing("", ("company", "exposure"), ({"attribute": "exposure", "q": 4},)),),
        gamma=20.0,
        min_cases=1,
    )
    assert len({plain.params_hash(), scoped.params_hash(), banded.params_hash()}) == 3
    assert RunParams.from_dict(scoped.to_dict()) == scoped and RunParams.from_dict(banded.to_dict()) == banded
    m = RunManifest(
        "n", "c", "m", "p", "0.1.0", scope={"flow_type": "DF2"}, cases=5, window_end="2019-01-17", norm_warnings=("w",)
    )
    assert RunManifest.from_dict(m.to_dict()) == m


# ---------------------------------------------------------------------------- decisions, mapping, snapshots
def test_decision_validation_and_mapping_round_trip() -> None:
    assert set(DECISION_KINDS) == {
        "drop_outside_window",
        "sentinel_as_missing",
        "collapse_duplicates",
        "day_precision",
        "header_events",
        "open_cases",
        "zero_exposure",
        "flow_type_assignment",
    }
    assert validate_decision("open_cases", None) == {"handling": "censor", "window": "60D"}
    assert validate_decision("zero_exposure", {"handling": "keep"}) == {"handling": "keep"}
    assert validate_decision("header_events", {"activities": ["A", 1]}) == {"activities": ["A", "1"]}
    with pytest.raises(ValidationError, match="unknown decision kind"):
        validate_decision("nope", {})
    with pytest.raises(ValidationError, match="accepts"):
        validate_decision("collapse_duplicates", {"x": 1})
    with pytest.raises(ValidationError, match="handling"):
        validate_decision("open_cases", {"handling": "drop"})
    with pytest.raises(ValidationError, match="rule"):
        validate_decision("flow_type_assignment", {"rules": []})
    doc = {
        "caseId": "c",
        "activity": "a",
        "timestamp": "t",
        "caseNoun": "sales order items",
        "dayPrecisionActivities": ["Goods issue"],
        "openCases": "censor",
        "zeroExposure": "exclude",
        "censoringWindow": "30D",
        "decisions": [{"id": "dec_1", "kind": "collapse_duplicates", "params": {}}],
        "parentId": "map_0",
    }
    m = ColumnMapping.from_dict("map_1", "ds", doc)
    assert m.noun == "sales order items" and m.version == 1 and m.parent_id == "map_0" and m.open_cases == "censor"
    assert ColumnMapping.from_dict("map_1", "ds", m.to_dict()).to_dict() == m.to_dict()
    assert ColumnMapping.from_dict("m", "ds", {"caseId": "c", "activity": "a", "timestamp": "t"}).noun == "cases"
    with pytest.raises(ValidationError, match="open cases"):
        ColumnMapping.from_dict("m", "ds", {**doc, "openCases": "drop"})


def test_snapshot_invariants() -> None:
    s = Snapshot(id="s", project_id="p", title="Top vendors", context={"run_id": "r", "view": None})
    assert s.context == {"run_id": "r"} and s.order == 0
    assert s.edited(note="x").note == "x" and s.edited(note="x").updated_at >= s.updated_at
    with pytest.raises(ValidationError, match="title"):
        Snapshot(id="s", project_id="p", title="  ")
    with pytest.raises(ValidationError, match="context"):
        Snapshot(id="s", project_id="p", title="t", context={"nope": 1})


# ---------------------------------------------------------------------------- bands
def test_band_edges_labels_and_reserved_columns() -> None:
    frame = pd.DataFrame(
        {
            "exposure": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, np.nan],
            "amount": [10, 20, 30, 40, 50, 60, 70, 80, 90],
            "k": list("aaabbbccc"),
        }
    )
    edges, labels = band_edges(frame["exposure"], {"attribute": "exposure", "method": "quantile", "q": 4})
    assert (
        edges[0] == -np.inf
        and edges[-1] == np.inf
        and len(labels) == 4
        and labels[0].startswith("<")
        and labels[-1].startswith("≥")
    )
    edges, labels = band_edges(frame["amount"], {"attribute": "amount", "method": "cuts", "cuts": [25, 65]})
    assert labels == ["< 25", "25 – 65", "≥ 65"]
    _edges, custom = band_edges(
        frame["amount"], {"attribute": "amount", "method": "cuts", "cuts": [25, 65], "labels": ["low", "mid", "high"]}
    )
    assert custom == ["low", "mid", "high"]
    out = apply_bands(
        frame, [{"attribute": "exposure", "q": 2}, {"attribute": "amount", "method": "cuts", "cuts": [45]}]
    )
    assert "exposure band" in out.columns and out["exposure"].dtype == float, (
        "the library's exposure column stays numeric"
    )
    assert out["exposure band"].iloc[-1] == "(missing)" and out["amount"].tolist()[:2] == ["< 45", "< 45"]
    assert effective_attributes(["k", "exposure", "amount"], [{"attribute": "exposure"}, {"attribute": "amount"}]) == [
        "k",
        "exposure band",
        "amount",
    ]
    summary = band_summary(frame, {"attribute": "exposure", "q": 2})
    assert sum(summary["counts"]) == 8 and summary["missing"] == 1 and summary["edges"][0] is None
    # constant columns collapse to one band; quantile duplicates are merged
    edges, labels = band_edges(pd.Series([1.0] * 5), {"attribute": "x", "q": 4})
    assert labels == ["all"]
    with pytest.raises(ValidationError, match="not a case attribute"):
        apply_bands(frame, [{"attribute": "nope", "q": 2}])
    with pytest.raises(ValidationError, match="no numeric values"):
        band_edges(pd.Series(["a", "b"]), {"attribute": "k", "q": 2})


# ---------------------------------------------------------------------------- filters
def test_parse_filter_shapes() -> None:
    assert parse_filter(None) is None and parse_filter("") is None
    single = parse_filter(json.dumps({"kind": "open", "value": True}))
    assert single == {"and": [{"kind": "open", "value": True}]}
    assert parse_filter(json.dumps({"and": []})) == {"and": []}
    for bad, msg in (
        ("nope", "valid JSON"),
        ("[1]", "JSON object"),
        (json.dumps({"and": 1}), "list"),
        (json.dumps({"and": [{"kind": "x"}]}), "kind"),
    ):
        with pytest.raises(ValidationError, match=msg):
            parse_filter(bad)


# ---------------------------------------------------------------------------- robust histograms
def test_distribution_bins_over_the_robust_range_with_a_beyond_bin() -> None:
    rng = np.random.default_rng(0)
    values = pd.Series(np.concatenate([rng.gamma(2.0, 20.0, 5000), [20_000.0, 30_000.0, 641.0 * 40]]))
    violations = pd.Series(np.where(values > 30, (values - 30) / 60, 0.0), index=values.index).clip(upper=1.0)
    meta = {"unit": "D", "threshold": 30.0, "width": 60.0, "direction": "high", "constraintId": "c", "type": "lag"}
    d = distribution(values, violations, meta)
    assert len(d["bins"]) == 40 and d["beyond"]["n"] >= 3 and d["beyond"]["x1"] == float(values.max())
    assert d["stats"]["rangeHigh"] < 1000 and d["saturation"] == 90.0
    assert [m["x"] for m in d["markers"]] == [30.0, 90.0] and d["markers"][1]["label"] == "δ + W = 90 days"
    assert d["stats"]["shareBeyondThresholdText"].endswith("% beyond 30 days")
    assert abs(d["stats"]["shareBeyondThreshold"] - float((values > 30).mean())) < 1e-12
    assert sum(b["n"] for b in d["bins"]) + d["beyond"]["n"] + (d["below"]["n"] if d["below"] else 0) == len(values)
    # the histogram is informative: more than 20 bins carry cases
    assert sum(1 for b in d["bins"] if b["n"] > 0) >= 20
    log = distribution(values, violations, meta, scale="log")
    assert log["scale"] == "log" and log["bins"][0]["x0"] > 0 and log["bins"][-1]["x1"] >= 90.0
    low = distribution(
        pd.Series([0.0, 1.0, 1.0, 2.0, 3.0]),
        pd.Series([1.0, 0.0, 0.0, 0.0, 0.0]),
        {"unit": "events", "threshold": 1.0, "width": None, "direction": "low"},
    )
    assert low["stats"]["shareBeyondThresholdText"] == "20 % below 1 events" and low["saturation"] is None
    empty = distribution(pd.Series([], dtype=float), pd.Series([], dtype=float), meta)
    assert empty["bins"] == [] and empty["beyond"] is None
