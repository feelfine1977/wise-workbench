from copy import deepcopy

import wise

from wise_workbench.domain.norm_views import BENCHMARK_POLICY, with_general_benchmark
from wise_workbench.domain.run import RunParams


def document():
    return {
        "name": "Membership",
        "layers": [{"id": "a"}, {"id": "b"}],
        "constraints": [
            {"id": cid, "layer": layer, "weight": weight, "type": "presence", "params": {"activity": "Event"}}
            for cid, layer, weight in [("a1", "a", 9), ("a2", "a", 1), ("b1", "b", 1), ("b2", "b", 1)]
        ],
        "views": [
            {"name": "Ops", "layer_weights": {"a": 4, "b": 0}},
            {"name": "Finance", "constraint_weights": {"a1": 2, "b1": 8}},
        ],
    }


def test_general_union_equal_layers_without_changing_source_or_other_views():
    before = document()
    original = deepcopy(before)
    prepared = with_general_benchmark(before)
    norm = wise.Norm.from_dict(prepared)
    assert before == original
    assert prepared["views"][:-1] == original["views"]
    assert norm.raw_weights("General") == {"a1": 0.5, "a2": 0.5, "b1": 1, "b2": 0}
    assert norm.layer_weight_table().loc[:, "General"].to_dict() == {"a": 1, "b": 1}
    assert with_general_benchmark(norm.to_dict()) == norm.to_dict()


def test_removal_recomputes_union_and_never_overwrites_named_user_view():
    source = document()
    source["views"][0]["name"] = "General"
    prepared = with_general_benchmark(source)
    assert prepared["metadata"]["general_benchmark"]["name"] == "General benchmark"
    prepared["views"][0]["layer_weights"]["a"] = 0
    prepared["views"][0]["layer_weights"]["b"] = 1
    updated = wise.Norm.from_dict(with_general_benchmark(prepared))
    assert updated.raw_weights("General benchmark")["a2"] == 0
    assert updated.raw_weights("Finance") == {"a1": 2, "a2": 0, "b1": 8, "b2": 0}


def test_run_policy_roundtrip_and_hash_preserve_legacy_identity():
    legacy = RunParams("ct", "nv", views=("Ops",))
    current = RunParams("ct", "nv", views=("Ops", "General"), general_benchmark=BENCHMARK_POLICY)
    assert RunParams.from_dict(legacy.to_dict()).params_hash() == legacy.params_hash()
    assert RunParams.from_dict(current.to_dict()) == current
    assert current.params_hash() != legacy.params_hash()
