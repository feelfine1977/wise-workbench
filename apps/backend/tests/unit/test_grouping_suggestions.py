from copy import deepcopy

import numpy as np
import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.bands import apply_bands, effective_attributes
from wise_workbench.adapters.engine.grouping_suggestions import discover_groupings
from wise_workbench.domain import ValidationError


def discover(frame, **kwargs):
    return discover_groupings(
        frame,
        list(frame.columns),
        kwargs.pop("document", wise.running_p2p_norm().to_dict()),
        views=kwargs.pop("views", ["Finance"]),
        min_cases=kwargs.pop("min_cases", 3),
        case_id="case_id",
        limit=50,
        **kwargs,
    )


def test_deterministic_combinations_actual_counts_and_dtype_not_name():
    frame = pd.DataFrame(
        {
            "company": ["A", "B"] * 12,
            "flow_type": ["DF1"] * 12 + ["DF2"] * 12,
            "odd_measure": np.arange(24, dtype=float),
            "amount_label": ["low", "high"] * 12,
            "numeric_strings": ["100", "200"] * 12,
            "case_id": range(24),
            "constant": "x",
            "absent": None,
            "unique_key": [f"u{i}" for i in range(24)],
        }
    )
    before = frame.copy(deep=True)
    result = discover(frame)
    assert result == discover(frame.iloc[::-1])
    pd.testing.assert_frame_equal(frame, before)
    profiles = {p["name"]: p for p in result["attributes"]}
    assert profiles["odd_measure"]["type"] == "numeric"
    assert profiles["amount_label"]["type"] == profiles["numeric_strings"]["type"] == "categorical"
    assert not {"case_id", "constant", "absent", "unique_key"} & profiles.keys()
    assert {len(s["attributes"]) for s in result["suggestions"]} == {1, 2, 3}
    for suggestion in result["suggestions"]:
        banded = apply_bands(frame, suggestion["bands"])
        counts = banded.groupby(
            effective_attributes(suggestion["attributes"], suggestion["bands"]), dropna=False, observed=True
        ).size()
        assert suggestion["groups"] == len(counts)
        assert suggestion["belowMinCases"] == int((counts < 3).sum())
        assert suggestion["supportedCases"] == int(counts[counts >= 3].sum())
        assert suggestion["supportCases"] == 24
    assert len({s["id"] for s in result["suggestions"]}) == len(result["suggestions"])
    assert "not verified drivers or root causes" in result["notice"]


def test_view_and_focus_change_relevance_using_effective_weights():
    doc = wise.running_p2p_norm().to_dict()
    doc["views"] = [
        {"name": "Flow", "constraint_weights": {"c4": 1}},
        {"name": "Presence", "constraint_weights": {"c1": 1}},
    ]
    original = deepcopy(doc)
    frame = pd.DataFrame({"flow_type": ["DF1", "DF2"] * 10, "company": ["A", "B"] * 10})
    flow = discover(frame, document=doc, views=["Flow"])
    assert flow["suggestions"][0]["attributes"] == ["flow_type"]
    assert flow["suggestions"][0]["relatedConstraints"] == ["c4"]
    presence = discover(frame, document=doc, views=["Presence"])
    assert all(s["relevance"] == 0 for s in presence["suggestions"])
    general = discover(frame, document=doc, views=["General"])
    assert general["search"]["activeConstraints"] == ["c1", "c4"]
    assert doc == original
    focused = discover(frame, document=doc, views=["Flow", "Presence"], focus_layer="match", focus_constraint="c4")
    assert focused["search"]["activeConstraints"] == ["c4"]
    for kwargs in [
        {"views": ["unknown"]},
        {"views": ["Presence"], "focus_constraint": "c4"},
        {"focus_layer": "absent"},
    ]:
        with pytest.raises(ValidationError):
            discover(frame, document=doc, **kwargs)


def test_missing_support_including_blank_and_null_groups_matches_engine():
    frame = pd.DataFrame(
        {"category": ["x", "x", "y", "y", None, "", "(missing)"], "bad_numeric": [1, 2, 3, 4, 5, 6, np.inf]}
    )
    result = discover(frame, min_cases=2)
    suggestion = next(s for s in result["suggestions"] if s["attributes"] == ["category"])
    assert (suggestion["cases"], suggestion["supportCases"], suggestion["missingCases"]) == (7, 4, 3)
    assert (suggestion["groups"], suggestion["belowMinCases"], suggestion["supportedCases"]) == (4, 1, 6)
    assert not any(p["name"] == "bad_numeric" for p in result["attributes"])


def test_search_bounds_are_reported_without_sampling_population():
    frame = pd.DataFrame({f"context_{i:03}": ["a", "b"] * 10 for i in range(150)})
    result = discover(frame)
    assert result["search"]["profiledColumns"] == 128
    assert len(result["search"]["candidateColumns"]) == 12
    assert result["search"]["evaluatedCombinations"] == 256
    assert result["search"]["truncated"] is True and result["search"]["sampled"] is False
    assert {s["cases"] for s in result["suggestions"]} == {20}


def test_relevance_is_invariant_to_raw_view_scale_and_excludes_managed_general():
    frame = pd.DataFrame({"company": ["A", "B"] * 20, "flow_type": ["DF1", "DF2"] * 20})
    doc = wise.running_p2p_norm().to_dict()
    doc["constraints"][0]["applicability"] = {"company": ["A"]}
    doc["views"] = [
        {"name": "Flow", "constraint_weights": {"c4": 1}},
        {"name": "Presence", "constraint_weights": {"c1": 2}},
    ]
    baseline = discover(frame, document=doc, views=["Flow", "Presence", "General"])
    scaled = deepcopy(doc)
    scaled["views"][0]["constraint_weights"]["c4"] = 100
    result = discover(frame, document=scaled, views=["Flow", "Presence", "General"])
    assert baseline["suggestions"] == result["suggestions"]
    assert result["search"]["relevanceViews"] == ["Flow", "Presence"]
    alone = discover(frame, document=doc, views=["Presence", "General"])
    assert alone["search"]["activeConstraints"] == ["c1"]
    assert not any("c4" in s["relatedConstraints"] for s in alone["suggestions"])
    general = discover(frame, document=doc, views=["General"])
    assert general["search"]["relevanceViews"] == ["General"]
    assert general["search"]["activeConstraints"] == ["c1", "c4"]


def test_default_limit_preserves_best_viable_single_pair_and_triple():
    frame = pd.DataFrame({f"context_{i}": ["a", "b"] * 30 for i in range(12)})
    result = discover_groupings(
        frame, list(frame.columns), wise.running_p2p_norm().to_dict(), views=["Finance"], min_cases=5, case_id="case"
    )
    assert len(result["suggestions"]) == 15
    assert {len(s["attributes"]) for s in result["suggestions"]} == {1, 2, 3}
    assert all(s["supportedCases"] == 60 for s in result["suggestions"])
    assert "Reserve" in result["search"]["diversity"]


def test_activity_labels_and_literal_values_are_not_case_references():
    doc = wise.running_p2p_norm().to_dict()
    doc["constraints"][0]["applicability"] = {"attr": "company", "eq": "flow_type"}
    frame = pd.DataFrame(
        {"Record Invoice Receipt": ["a", "b"] * 10, "flow_type": ["x", "y"] * 10, "company": ["a", "b"] * 10}
    )
    result = discover(frame, document=doc, focus_constraint="c1")
    by_name = {tuple(s["attributes"]): s for s in result["suggestions"]}
    assert by_name[("company",)]["relevance"] == 1
    assert by_name[("flow_type",)]["relevance"] == 0
    assert by_name[("Record Invoice Receipt",)]["relevance"] == 0
