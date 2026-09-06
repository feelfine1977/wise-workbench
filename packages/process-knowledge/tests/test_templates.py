from __future__ import annotations

import json

import pytest
from conftest import WISE_LIB_NORM, requires

wise = pytest.importorskip("wise")


def _templates(*packs):
    return [(pack.id, t) for pack in packs for t in pack.templates]


def test_every_template_loads_and_validates(p2p, o2c):
    for pack_id, t in _templates(p2p, o2c):
        norm = wise.Norm.from_dict(json.loads(t.path.read_text(encoding="utf-8")))
        norm.validate()
        assert norm.constraints, (pack_id, t.id)
        assert norm.fingerprint()


def test_paper_norm_is_verbatim(p2p):
    requires(WISE_LIB_NORM)
    if not WISE_LIB_NORM.is_file():
        pytest.skip("wise-lib checkout not available")
    ours = p2p.template("p2p_bpic19").path.read_text(encoding="utf-8")
    assert ours == WISE_LIB_NORM.read_text(encoding="utf-8")
    norm = wise.Norm.load(p2p.template("p2p_bpic19").path)
    assert len(norm.constraints) == 29 and norm.view_names == ["Finance", "Logistics", "Compliance", "Automation"]


def test_baselines_flag_uncalibrated_and_use_canonical_ids(p2p, o2c):
    for pack in (p2p, o2c):
        for t in pack.templates:
            norm = wise.Norm.load(t.path)
            if t.calibration == "uncalibrated":
                meta = norm.metadata["meta"]
                assert meta["calibration"] == "uncalibrated"
                assert set(meta["uncalibrated_parameters"]) <= set(norm.constraint_ids)
            if t.activity_labels == "canonical_ids":
                unknown = set(norm.activities()) - set(pack.activity_ids)
                assert not unknown, unknown


def test_o2c_baseline_uses_required_constraint_forms(o2c):
    norm = wise.Norm.load(o2c.template("o2c_baseline").path)
    types = {c.type for c in norm.constraints}
    assert {"presence", "lag", "balance", "exclusion", "precedence", "metric"} <= types
    censored = [c for c in norm.constraints if c.type == "lag" and c.constraint.missing_b == "censor"]
    assert censored
    return_rules = [c for c in norm.constraints if "return_item" in json.dumps(c.applicability)]
    assert len(return_rules) >= 10
    assert any(c.applicability == {"attr": "return_item", "eq": "X"} for c in norm.constraints)
    assert "return_item" in norm.attributes() and "confirmed_quantity" in norm.attributes()


def test_pattern_and_template_constraints_agree(p2p, o2c):
    """Each failure-mode pattern names the same type, activities and parameters as the template constraint it cites."""
    for pack in (p2p, o2c):
        label_to_id = {}
        for lp in pack.label_packs.values():
            for e in lp.labels:
                label_to_id.setdefault(e.label, e.activity)
        norms = {t.id: (t, wise.Norm.load(t.path)) for t in pack.templates}
        for fm in pack.failure_modes:
            for p in fm.wise_patterns:
                for template_id in p.templates:  # the primary template and every derived one (also_templates)
                    t, norm = norms[template_id]
                    c = norm.get_constraint(p.constraint_ref)
                    assert c.type == p.type, (fm.id, template_id, p.constraint_ref)
                    acts = set(c.constraint.activities())
                    if t.activity_labels == "log_labels":
                        acts = {label_to_id[a] for a in acts}
                    assert acts == set(p.referenced_activities()), (
                        fm.id,
                        template_id,
                        p.constraint_ref,
                        acts,
                        p.referenced_activities(),
                    )
                    params = c.constraint.params()
                    for k, v in p.params.items():
                        assert params[k] == v or (isinstance(v, int | float) and float(params[k]) == float(v)), (
                            fm.id,
                            template_id,
                            p.constraint_ref,
                            k,
                            params[k],
                            v,
                        )
                    if p.type == "metric":
                        assert params["attribute"] == p.attribute


def test_o2c_baseline_scores_synthetic_log(o2c):
    import pandas as pd

    norm = wise.Norm.load(o2c.template("o2c_baseline").path)
    t0 = pd.Timestamp("2025-01-06 08:00:00")
    rows = []

    def ev(case, act, day, **attrs):
        rows.append({"case": case, "activity": act, "time": t0 + pd.Timedelta(days=day), **attrs})

    std = {"return_item": "", "confirmed_quantity": 10, "flow_type": "standard", "days_late": -1, "order_quantity": 10}
    for act, d in [
        ("o2c.order_create", 0),
        ("o2c.item_create", 0),
        ("o2c.schedule_confirm", 0.1),
        ("o2c.delivery_create", 1),
        ("o2c.pick", 1.2),
        ("o2c.goods_issue", 1.5),
    ]:
        ev("std", act, d, **std)
    late = dict(std, days_late=9)
    for act, d in [
        ("o2c.order_create", 0),
        ("o2c.item_create", 0),
        ("o2c.delivery_date_postpone", 2),
        ("o2c.delivery_date_postpone", 5),
        ("o2c.delivery_create", 20),
        ("o2c.pick", 21),
        ("o2c.goods_issue", 25),
    ]:
        ev("late", act, d, **late)
    ret = dict(std, return_item="X", flow_type="returns")
    for act, d in [
        ("o2c.order_create", 0),
        ("o2c.item_create", 0),
        ("o2c.return_order_create", 0),
        ("o2c.return_delivery", 3),
        ("o2c.return_to_own_stock", 4),
    ]:
        ev("ret", act, d, **ret)
    rej = dict(std, confirmed_quantity=0, flow_type="rejected")
    for act, d in [("o2c.order_create", 0), ("o2c.item_create", 0), ("o2c.rejection_change", 1)]:
        ev("rej", act, d, **rej)
    events = pd.DataFrame(rows)
    log = wise.EventLog(
        events,
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=["return_item", "confirmed_quantity", "flow_type", "days_late"],
    )
    result = wise.score(log, norm)
    v = result.violations
    assert v.loc["std", "o_commit_no_postponement"] == 0.0
    assert v.loc["late", "o_commit_no_postponement"] == 1.0
    assert pd.isna(v.loc["ret", "o_commit_no_postponement"])  # return items are out of scope
    assert pd.isna(v.loc["rej", "o_deliv_goods_issue_present"])  # rejected at capture: no delivery expected
    assert v.loc["ret", "o_return_receipt_present"] == 0.0
    assert pd.isna(v.loc["std", "o_return_receipt_present"])
    assert v.loc["late", "o_deliv_days_late"] > 0 and v.loc["std", "o_deliv_days_late"] == 0.0
    assert v.loc["late", "o_change_churn"] > 0
    assert result.scores.loc["late", "Logistics"] < result.scores.loc["std", "Logistics"]
