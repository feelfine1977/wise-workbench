"""Decision reuse follows rule meaning; evidence gaps never imply business exclusion."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine.norms import NormInspector
from wise_workbench.application.services.norms import _with_calibration
from wise_workbench.domain import ColumnMapping, changed_thresholds, missing_rationales, thresholds_of


@pytest.fixture
def calibrated_document() -> dict[str, Any]:
    document = wise.Norm.from_dict(
        {
            "name": "Synthetic decision reuse",
            "layers": [{"id": "timing"}, {"id": "commercial"}],
            "views": [{"name": "Operations", "layer_weights": {"timing": 1, "commercial": 1}}],
            "constraints": [
                {
                    "id": "lag",
                    "layer": "timing",
                    "type": "lag",
                    "params": {
                        "a": ["Order"],
                        "b": ["Invoice"],
                        "delta": 7,
                        "width": 3,
                        "missing_a": "skip",
                        "missing_b": "skip",
                    },
                },
                {
                    "id": "metric",
                    "layer": "commercial",
                    "type": "metric",
                    "params": {"attribute": "amount", "threshold": 100, "width": 20},
                },
                {
                    "id": "balance",
                    "layer": "commercial",
                    "type": "balance",
                    "params": {
                        "attr_x": "qty",
                        "activities_x": ["Receipt"],
                        "attr_y": "qty",
                        "activities_y": ["Invoice"],
                        "tau": 0.05,
                        "width": 0.1,
                    },
                },
            ],
        }
    ).to_dict()
    document["metadata"] = {
        "calibration": {
            c["id"]: {"rationale": f"Agreed definition of {c['id']}", "owner": "Process owner"}
            for c in document["constraints"]
        },
        "authoring": {"question": "What evidence supports payment timeliness?", "answers": []},
    }
    return document


@pytest.mark.parametrize(
    ("cid", "field", "value"),
    [
        pytest.param("lag", "a", ["Receipt"], id="activation-activity"),
        pytest.param("lag", "b", ["Payment"], id="response-activity"),
        pytest.param("lag", "unit", "H", id="units"),
        pytest.param("lag", "missing_a", "violate", id="missing-activation"),
        pytest.param("lag", "missing_b", "censor", id="missing-response"),
        pytest.param("lag", "activation", "each", id="each-activation"),
        pytest.param("lag", "response", "first_overall", id="response-pairing"),
        pytest.param("metric", "attribute", "days_late", id="measured-attribute"),
        pytest.param("metric", "direction", "low", id="metric-direction"),
        pytest.param("balance", "attr_x", "value", id="balance-attribute"),
        pytest.param("balance", "activities_y", ["Credit"], id="balance-activity"),
        pytest.param("balance", "agg", "max", id="aggregation"),
        pytest.param("balance", "eps", 0.001, id="balance-denominator"),
        pytest.param("lag", "applicability", {"attr": "company", "in": ["A"]}, id="population"),
        pytest.param("lag", "delta", 8, id="target"),
        pytest.param("lag", "width", 4, id="tolerance-width"),
        pytest.param("balance", "tau", 0.07, id="tau-only"),
    ],
)
def test_changed_rule_discards_only_its_inherited_decision(
    calibrated_document: dict[str, Any], cid: str, field: str, value: Any
) -> None:
    parent = calibrated_document
    document = deepcopy(parent)
    rule = next(c for c in document["constraints"] if c["id"] == cid)
    if field == "applicability":
        rule[field] = value
    else:
        rule["params"][field] = value
    snapshot = deepcopy(document)
    if field not in {"delta", "width", "tau"}:
        # The number did not change, but its business/measurement meaning did.
        assert thresholds_of(document) == thresholds_of(parent)
    assert changed_thresholds(document, parent) == [cid]

    saved = _with_calibration(document, None, None, "Editor", parent=parent)
    assert saved["metadata"]["calibration_pending"] == [cid]
    assert cid not in saved["metadata"]["calibration"]
    for other in {"lag", "metric", "balance"} - {cid}:
        assert saved["metadata"]["calibration"][other] == parent["metadata"]["calibration"][other]
    assert missing_rationales(saved, parent) == [cid]
    assert saved["metadata"]["authoring"] == parent["metadata"]["authoring"]
    assert document == snapshot
    assert cid in parent["metadata"]["calibration"]


@pytest.mark.parametrize("change", ["name", "description", "layer", "weight", "view", "authoring"])
def test_presentation_and_priority_edits_reuse_decisions(calibrated_document: dict[str, Any], change: str) -> None:
    document = deepcopy(calibrated_document)
    if change == "name":
        document["name"] = "Clearer norm title"
    elif change == "description":
        document["constraints"][0]["description"] = "Invoice promptly"
    elif change == "layer":
        document["constraints"][0]["layer"] = "commercial"
    elif change == "weight":
        document["constraints"][0]["weight"] = 0
    elif change == "view":
        document["views"][0]["layer_weights"]["timing"] = 0
    else:
        document["metadata"]["authoring"]["answers"].append({"evidence": "unknown"})
    assert changed_thresholds(document, calibrated_document) == []
    saved = _with_calibration(document, None, None, "Editor", parent=calibrated_document)
    assert saved["metadata"]["calibration"] == calibrated_document["metadata"]["calibration"]
    assert missing_rationales(saved, calibrated_document) == []


def test_rule_type_is_part_of_the_definition(calibrated_document: dict[str, Any]) -> None:
    document = deepcopy(calibrated_document)
    # Comparison precedes schema validation: the type field itself must invalidate reuse.
    document["constraints"][0]["type"] = "metric"
    assert thresholds_of(document) == thresholds_of(calibrated_document)
    assert changed_thresholds(document, calibrated_document) == ["lag"]


def test_new_numeric_constraint_cannot_reuse_a_copied_decision(calibrated_document: dict[str, Any]) -> None:
    document = deepcopy(calibrated_document)
    extra = deepcopy(document["constraints"][0])
    extra["id"] = "new_lag"
    document["constraints"].append(extra)
    document["metadata"]["calibration"]["new_lag"] = deepcopy(document["metadata"]["calibration"]["lag"])
    saved = _with_calibration(document, None, None, "Editor", parent=calibrated_document)
    assert changed_thresholds(document, calibrated_document) == ["new_lag"]
    assert missing_rationales(saved, calibrated_document) == ["new_lag"]
    assert "new_lag" not in saved["metadata"]["calibration"]


def test_empty_scope_and_dictionary_order_do_not_change_meaning(calibrated_document: dict[str, Any]) -> None:
    document = deepcopy(calibrated_document)
    document["constraints"].reverse()
    for rule in document["constraints"]:
        rule["params"] = dict(reversed(list(rule["params"].items())))
        rule["applicability"] = None
    assert changed_thresholds(document, calibrated_document) == []


def test_absent_invoice_data_and_no_eligible_cases_have_different_denominators(
    calibrated_document: dict[str, Any],
) -> None:
    events = pd.DataFrame(
        {
            "case": ["a", "b"],
            "activity": ["Order", "Order"],
            "time": ["2026-01-01", "2026-01-02"],
            "flow_type": ["standard", "standard"],
        }
    )
    log = wise.EventLog(
        events, case_col="case", activity_col="activity", timestamp_col="time", case_attributes=["flow_type"]
    )
    mapping = ColumnMapping(
        id="m", dataset_id="d", case_id="case", activity="activity", timestamp="time", case_attributes=("flow_type",)
    )
    inspector = NormInspector(lambda: log, mapping)
    document = deepcopy(calibrated_document)
    document["constraints"] = [document["constraints"][0]]
    before = deepcopy(document)

    unknown = inspector.check_norm(document)
    row = unknown["constraints"][0]
    assert row["activitiesMissing"] == ["Invoice"]
    assert (row["casesInScope"], row["casesEvaluated"]) == (2, 0)
    assert unknown["issues"]
    assert document == before
    assert "not_applicable" not in document["metadata"]

    document["constraints"][0]["applicability"] = {"attr": "flow_type", "in": ["returns"]}
    outside_scope = inspector.check_norm(document)["constraints"][0]
    assert (outside_scope["casesInScope"], outside_scope["casesEvaluated"]) == (0, 0)
    assert outside_scope["activitiesMissing"] == ["Invoice"]
    assert "not_applicable" not in document["metadata"]


@pytest.mark.parametrize("change", ["add", "replace", "remove"])
def test_derived_attribute_changes_invalidate_numeric_decisions(
    calibrated_document: dict[str, Any], change: str
) -> None:
    parent = deepcopy(calibrated_document)
    old_recipe = {"name": "amount", "kind": "count", "activities": ["Order"]}
    new_recipe = {"name": "amount", "kind": "count", "activities": ["Invoice"]}
    parent["derived_attributes"] = [] if change == "add" else [old_recipe]
    document = deepcopy(parent)
    document["derived_attributes"] = [] if change == "remove" else [new_recipe]
    snapshot = deepcopy(document)

    assert document["constraints"] == parent["constraints"]
    assert thresholds_of(document) == thresholds_of(parent)
    # Conservative invalidation is intentional: recipes may feed attributes or applicability indirectly.
    assert changed_thresholds(document, parent) == ["balance", "lag", "metric"]
    saved = _with_calibration(document, None, None, "Editor", parent=parent)
    assert saved["metadata"]["calibration"] == {}
    assert saved["metadata"]["calibration_pending"] == ["balance", "lag", "metric"]
    assert missing_rationales(saved, parent) == ["balance", "lag", "metric"]
    assert document == snapshot
    assert parent["metadata"]["calibration"] == calibrated_document["metadata"]["calibration"]


def test_unchanged_derived_recipes_do_not_reset_decisions(calibrated_document: dict[str, Any]) -> None:
    parent = deepcopy(calibrated_document)
    parent["derived_attributes"] = [{"name": "amount", "kind": "count", "activities": ["Order"]}]
    document = deepcopy(parent)
    document["name"] = "A clearer title"
    document["derived_attributes"][0] = dict(reversed(list(document["derived_attributes"][0].items())))
    assert changed_thresholds(document, parent) == []
    saved = _with_calibration(document, None, None, "Editor", parent=parent)
    assert saved["metadata"]["calibration"] == parent["metadata"]["calibration"]
    assert missing_rationales(saved, parent) == []
