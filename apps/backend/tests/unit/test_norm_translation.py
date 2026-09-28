"""Template translation preserves business scope while binding activity predicates to log labels."""

import json
from copy import deepcopy

import pandas as pd
import pytest
import wise

from wise_workbench.adapters import knowledge


def test_nested_activity_predicates_translate_without_rewriting_attribute_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        knowledge,
        "label_map",
        lambda *_: {"o2c.issue": ["Goods issue", "Alternate issue"], "o2c.reject": ["Rejected"]},
    )
    attrs = {"attr": "o2c.issue", "in": ["o2c.issue", "o2c.unknown_attribute_value"]}
    document = {
        "constraints": [
            {
                "id": "delivery",
                "params": {"activity": ["o2c.issue", "Goods issue"]},
                "applicability": {
                    "all": [
                        attrs,
                        {"any": [{"has": "o2c.issue"}, {"not": {"lacks": ["o2c.issue", "Goods issue"]}}]},
                        {"not": {"any": [{"has": ["o2c.reject"]}, {"not": {"lacks": "Raw label"}}]}},
                    ]
                },
            },
            {"id": "short-form", "applicability": {"flow_type": ["o2c.issue"]}},
        ],
        "derived_attributes": [{"name": "issues", "kind": "count_events", "activities": ["o2c.issue"]}],
    }
    before = deepcopy(document)
    translated, unresolved = knowledge.translate_norm(document, "o2c", "fixture")
    rules = translated["constraints"][0]["applicability"]["all"]
    assert rules == [
        attrs,
        {"any": [{"has": ["Goods issue", "Alternate issue"]}, {"not": {"lacks": ["Goods issue", "Alternate issue"]}}]},
        {"not": {"any": [{"has": ["Rejected"]}, {"not": {"lacks": ["Raw label"]}}]}},
    ]
    assert translated["constraints"][1] == document["constraints"][1]
    assert translated["constraints"][0]["params"]["activity"] == ["Goods issue", "Alternate issue"]
    assert translated["derived_attributes"][0]["activities"] == ["Goods issue", "Alternate issue"]
    assert unresolved == []
    assert document == before
    assert knowledge.translate_norm(translated, "o2c", "fixture") == (translated, [])


def test_unresolved_applicability_references_join_existing_translation_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(knowledge, "label_map", lambda *_: {"o2c.issue": ["Goods issue"]})
    document = {
        "constraints": [
            {
                "id": "delivery",
                "params": {"activity": ["o2c.issue"]},
                "applicability": {
                    "all": [
                        {"attr": "status", "eq": "o2c.attribute_value"},
                        {"has": ["o2c.unmapped_z", "Existing raw label"]},
                        {"not": {"any": [{"lacks": "o2c.unmapped_a"}, {"has": "o2c.unmapped_z"}]}},
                    ]
                },
            }
        ]
    }
    translated, unresolved = knowledge.translate_norm(document, "o2c", "fixture")
    assert unresolved == ["o2c.unmapped_a", "o2c.unmapped_z"]
    assert translated["constraints"][0]["applicability"]["all"][1] == {"has": ["o2c.unmapped_z", "Existing raw label"]}
    assert translated["constraints"][0]["applicability"]["all"][2] == {
        "not": {"any": [{"lacks": ["o2c.unmapped_a"]}, {"has": ["o2c.unmapped_z"]}]}
    }


def test_o2c_template_scopes_delivery_and_invoice_by_recorded_labels() -> None:
    knowledge.reset_cache()
    path = knowledge.template_path("o2c", "o2c_baseline")
    assert path is not None
    source = path.read_bytes()
    document = json.loads(source)
    translated, unresolved = knowledge.translate_norm(document, "o2c", "hackathon_sales")
    norm = wise.Norm.from_dict(translated)
    rows = []
    for case, returned, activities in [
        ("shipped", "", ["Create Order Item", "Goods issue"]),
        ("open", "", ["Create Order Item"]),
        ("rejected", "", ["Create Order Item", "Changed RejectionReason"]),
        ("rejected-shipped", "", ["Create Order Item", "Changed RejectionReason", "Goods issue"]),
        ("return", "X", ["Create Order Item", "Goods issue"]),
    ]:
        for day, activity in enumerate(activities):
            rows.append(
                {
                    "case": case,
                    "activity": activity,
                    "time": pd.Timestamp("2026-01-01") + pd.Timedelta(days=day),
                    "return_item": returned,
                }
            )
    log = wise.EventLog(
        pd.DataFrame(rows),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=["return_item"],
    )
    for cid in ("o_deliv_goods_issue_present", "o_deliv_order_to_issue_days", "o_change_churn"):
        mask = norm.get_constraint(cid).applies_to(log.cases, log)
        assert set(mask.index[mask]) == {"shipped", "open"}, cid
    invoice_mask = norm.get_constraint("o_invoice_present").applies_to(log.cases, log)
    assert set(invoice_mask.index[invoice_mask]) == {"shipped", "rejected-shipped"}
    assert "o2c.rejection_change" not in unresolved and "o2c.goods_issue" not in unresolved
    assert "o2c.invoice_create" in unresolved  # No observed label is manufactured for absent stages.
    assert json.loads(source) == document and path.read_bytes() == source
    assert translated["layers"] == document["layers"] and translated["views"] == document["views"]
    assert [c["weight"] for c in translated["constraints"]] == [c["weight"] for c in document["constraints"]]
    knowledge.reset_cache()
