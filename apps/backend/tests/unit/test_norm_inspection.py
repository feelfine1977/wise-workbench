"""Norm inspection keeps its validation order and population denominators."""

from pathlib import Path

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine import EngineAdapter
from wise_workbench.adapters.storage import Workspace
from wise_workbench.domain import ColumnMapping, NotFoundError, ValidationError


@pytest.fixture
def mapping() -> ColumnMapping:
    return ColumnMapping(
        id="mapping",
        dataset_id="dataset",
        case_id="case",
        activity="activity",
        timestamp="time",
        case_attributes=("flow_type", "company", "vendor"),
        case_noun="purchase order items",
    )


def test_invalid_constraint_is_reported_before_loading_missing_artefacts(
    tmp_path: Path, mapping: ColumnMapping
) -> None:
    engine = EngineAdapter(Workspace(tmp_path))
    out = engine.validate_constraint(tmp_path / "absent", mapping, {"type": "not-a-type"})
    assert out["valid"] is False
    assert out["errors"][0]["field"] == "constraint"
    assert out["sentence"] is None and out["casesEvaluated"] is None
    valid = wise.running_p2p_norm().to_dict()["constraints"][0]
    with pytest.raises(NotFoundError, match="case table artefacts missing"):
        engine.validate_constraint(tmp_path / "absent", mapping, valid)


def test_inventory_search_keeps_population_shares_and_numeric_summary(
    tmp_path: Path, mapping: ColumnMapping, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = EngineAdapter(Workspace(tmp_path))
    log = wise.running_p2p_log()
    log.add_case_attribute("amount", pd.Series([0, 10, 20, 30, 40], index=log.case_ids))
    monkeypatch.setattr(engine, "_load_log", lambda *_: log)
    out = engine.inventory(tmp_path, mapping, attribute="vendor", q="v1", limit=1)
    assert out["cases"] == 5 and out["caseNoun"] == "purchase order items"
    assert out["activities"] == []
    assert out["attributes"] == [
        {
            "name": "vendor",
            "kind": "text",
            "distinct": 2,
            "missing": 0,
            "total": 1,
            "values": [{"value": "V1", "cases": 3, "share": 0.6}],
        }
    ]
    numeric = engine.inventory(tmp_path, mapping, attribute="amount", q="0", limit=1)["attributes"][0]
    assert numeric["numeric"] == {"min": 0.0, "p10": 4.0, "median": 20.0, "p90": 36.0, "max": 40.0}
    assert numeric["total"] == 5 and len(numeric["values"]) == 1
    with pytest.raises(NotFoundError) as caught:
        engine.inventory(tmp_path, mapping, attribute="absent")
    assert caught.value.code == "inventory.attribute"


def test_unknown_activity_retains_evaluation_and_plain_rule(
    tmp_path: Path, mapping: ColumnMapping, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = EngineAdapter(Workspace(tmp_path))
    monkeypatch.setattr(engine, "_load_log", lambda *_: wise.running_p2p_log())
    spec = {"id": "extra", "layer": "completeness", "type": "presence", "params": {"activity": "Unlogged", "m": 1}}
    out = engine.validate_constraint(tmp_path, mapping, spec, case_noun="purchase order items")
    assert out["valid"] is False
    assert out["activities"] == [{"label": "Unlogged", "known": False, "cases": 0}]
    assert (out["casesInScope"], out["casesEvaluated"], out["casesMissing"], out["shareMissing"]) == (5, 5, 5, 1.0)
    assert out["sentence"].endswith("Unlogged happens at least once.")
    assert "5 of the 5 purchase order items" in out["note"]


def test_invalid_norm_is_refused_before_loading_missing_artefacts(tmp_path: Path, mapping: ColumnMapping) -> None:
    engine = EngineAdapter(Workspace(tmp_path))
    document = wise.running_p2p_norm().to_dict()
    document["constraints"][0]["type"] = "not-a-type"
    for inspect in (engine.check_norm, engine.norm_warnings):
        with pytest.raises(ValidationError) as caught:
            inspect(tmp_path / "absent", mapping, document)
        assert caught.value.code == "norm.invalid"
