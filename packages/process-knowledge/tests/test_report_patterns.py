"""Installed-engine semantic witnesses, mapping safety and API write contract."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pandas as pd
import pytest
import wise

from wise_knowledge.report_patterns import extend_report_patterns, load_report_patterns

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "packages/process-knowledge/src/wise_knowledge/data/p2p"


def base():
    return json.loads((DATA / "templates/p2p_bpic19.json").read_text())


def mapping():
    return json.loads((DATA / "mappings/bpic2019_report_patterns.json").read_text())


def extend(document=None, config=None):
    m = config or mapping()
    return extend_report_patterns(
        document or base(),
        activity_mapping=m["activity_mapping"],
        attribute_mapping=m["attribute_mapping"],
        flow_values=m["flow_values"],
        available_activities=[v for vals in m["activity_mapping"].values() for v in vals],
        available_attributes=list(m["attribute_mapping"].values()),
    )


def candidate_norm(config=None):
    doc, report = extend(config=config)
    doc["constraints"] = [c for c in doc["constraints"] if c["id"] in report["added_constraint_ids"]]
    doc["layers"] = [layer for layer in doc["layers"] if layer["id"].startswith("RP_")]
    doc["views"] = [v for v in doc["views"] if v["name"] == "Report candidates"]
    doc["derived_attributes"] = [r for r in doc["derived_attributes"] if r["name"].startswith("rp_")]
    return wise.Norm.from_dict(doc)


def score(cases, *, config=None):
    rows = []
    for case, events in cases.items():
        for activity, day in events:
            rows.append(
                {
                    "case": case,
                    "activity": activity,
                    "time": pd.Timestamp("2025-01-01") + pd.Timedelta(days=day),
                    "flow_type": "DF1",
                }
            )
    log = wise.EventLog(
        pd.DataFrame(rows),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=["flow_type"],
    )
    return wise.score(log, candidate_norm(config)), log


PO = "Create Purchase Order Item"
IR = "Record Invoice Receipt"
VI = "Vendor creates invoice"
CL = "Clear Invoice"
Q = "Change Quantity"
P = "Change Price"


def test_canonical_template_is_executable_and_catalogue_covers_every_rule():
    template, catalogue = load_report_patterns()
    norm = wise.Norm.from_dict(template)
    norm.validate()
    assert len(norm.constraints) == 14
    assert set(norm.constraint_ids) == {p["constraint_id"] for p in catalogue["patterns"]}
    assert all(
        p["sources"] and p["review_status"] == "draft" and p["owner"] is None and p["approved_by"] is None
        for p in catalogue["patterns"]
    )
    assert all("resource" not in json.dumps(c) for c in template["constraints"])


def test_preserves_original_document_rules_recipes_and_view_weights():
    before = base()
    original = copy.deepcopy(before)
    doc, report = extend(before)
    assert before == original
    for key in ("constraints", "layers", "views", "derived_attributes"):
        assert doc[key][: len(before[key])] == before[key]
    old, new = wise.Norm.from_dict(before), wise.Norm.from_dict(doc)
    for view in old.view_names:
        assert {k: v for k, v in new.raw_weights(view).items() if k in old.constraint_ids} == old.raw_weights(view)
        assert all(new.raw_weights(view)[cid] == 0 for cid in report["added_constraint_ids"])
    assert len(new.constraints) == 42
    assert report["omitted"][0]["constraint_id"] == "rp_validated_automation_recovery"


def test_original_scores_unchanged_on_public_example():
    before = base()
    # Original identity/value recipes need source-specific columns. Remove
    # only recipes for this synthetic fixture and supply their outputs.
    attrs = [r["name"] for r in before.pop("derived_attributes")]
    events = wise.running_p2p_events().copy()
    for name in attrs:
        events[name] = 0.0
    log = wise.EventLog(
        events, case_col="case", activity_col="activity", timestamp_col="time", case_attributes=["flow_type", *attrs]
    )
    after, _ = extend(before)
    a = wise.score(log, wise.Norm.from_dict(before))
    b = wise.score(log, wise.Norm.from_dict(after))
    pd.testing.assert_frame_equal(a.scores, b.scores[a.scores.columns])
    pd.testing.assert_frame_equal(a.violations, b.violations[a.violations.columns])


def test_correction_cases_and_events_are_distinct_and_repeats_start_at_two():
    result, log = score(
        {
            "clean": [(PO, 0)],
            "one": [(PO, 0), (Q, 1)],
            "three": [(PO, 0), (Q, 1), (Q, 2), (Q, 3)],
            "price": [(PO, 0), (P, 1), (P, 2)],
        }
    )
    v = result.violations
    assert (v.rp_any_commercial_correction > 0).sum() == 3
    assert log.count([Q]).sum() == 4
    assert v.loc["one", "rp_repeated_quantity_correction"] == 0
    assert v.loc["three", "rp_repeated_quantity_correction"] == 1
    assert v.loc["price", "rp_repeated_price_correction"] == 1


def test_scoped_changes_are_strict_timestamp_and_absent_anchor_is_unmeasured():
    result, _ = score(
        {
            "before": [(PO, 0), (Q, 1), ("Record Goods Receipt", 2)],
            "tie": [(PO, 0), ("Record Goods Receipt", 1), (Q, 1)],
            "after": [(PO, 0), ("Record Goods Receipt", 1), (Q, 2)],
            "none": [(PO, 0), (Q, 1)],
            "service": [(PO, 0), ("Record Service Entry Sheet", 1), (Q, 2)],
        }
    )
    v = result.violations.rp_quantity_change_after_receipt
    assert v["before"] == v["tie"] == 0
    assert v["after"] == v["service"] == 1
    assert pd.isna(v["none"])


def test_capture_lag_single_pairs_threshold_reverse_missing_and_repeated():
    result, _ = score(
        {
            "boundary": [(PO, 0), (VI, 1), (IR, 15)],
            "late": [(PO, 0), (VI, 1), (IR, 22)],
            "reverse": [(PO, 0), (IR, 1), (VI, 2)],
            "tie": [(PO, 0), (VI, 1), (IR, 1)],
            "missing": [(PO, 0), (VI, 1)],
            "repeat": [(PO, 0), (VI, 1), (IR, 10), (IR, 20)],
        }
    )
    v = result.violations
    assert v.loc["boundary", "rp_invoice_capture_interval"] == 0
    assert v.loc["late", "rp_invoice_capture_interval"] == 0.5
    assert v.loc["tie", "rp_invoice_capture_interval"] == 0
    for case in ("reverse", "missing", "repeat"):
        assert pd.isna(v.loc[case, "rp_invoice_capture_interval"])
    assert v.loc["reverse", "rp_invoice_recorded_before_vendor_date"] == 1
    assert v.loc["tie", "rp_invoice_recorded_before_vendor_date"] == 0


def test_invoice_first_means_timestamp_precedence_not_first_activity():
    result, _ = score(
        {
            "first": [(VI, 0), (PO, 1)],
            "not_first": [(Q, 0), (VI, 1), (PO, 2)],
            "tie": [(VI, 1), (PO, 1)],
            "absent": [(PO, 0)],
            "missing_po": [(VI, 0), (IR, 1)],
        }
    )
    v = result.violations.rp_invoice_before_order
    assert v["first"] == v["not_first"] == 1
    assert v["tie"] == 0
    assert pd.isna(v["absent"])
    # Both activities are mapped globally, but this case has no PO event.
    # Logging absence cannot prove invoice-before-order or lack of approval.
    assert pd.isna(v["missing_po"])


def test_settlement_interval_uses_receipt_only_and_excludes_multiple_cycles():
    result, _ = score(
        {
            "single": [(PO, 0), (VI, 1), (IR, 41), (CL, 72)],
            "repeat": [(PO, 0), (IR, 1), (IR, 2), (CL, 72)],
            "reverse": [(PO, 0), (CL, 1), (IR, 2)],
        }
    )
    v = result.violations.rp_recorded_invoice_to_clearing_interval
    assert v["single"] == pytest.approx(1 / 60)
    assert pd.isna(v["repeat"]) and pd.isna(v["reverse"])


def test_broad_clearing_screen_is_not_adjacency_or_duplicate_payment():
    result, _ = score(
        {
            "direct": [(PO, 0), (IR, 1), (CL, 2), (CL, 3)],
            "indirect": [(PO, 0), (IR, 1), (CL, 2), (Q, 3), (CL, 4)],
            "two_ir": [(PO, 0), (IR, 1), (IR, 2), (CL, 3), (CL, 4)],
            "zero_ir": [(PO, 0), (CL, 1), (CL, 2)],
        }
    )
    v = result.violations
    assert (
        v.loc["direct", "rp_repeated_clearing_limited_receipts"]
        == v.loc["indirect", "rp_repeated_clearing_limited_receipts"]
        == 1
    )
    assert pd.isna(v.loc["two_ir", "rp_repeated_clearing_limited_receipts"])
    assert v.loc["zero_ir", "rp_clearing_without_recorded_invoice"] == 1


def test_cancellation_then_clear_strict_first_anchor_semantics():
    result, _ = score(
        {
            "after": [(PO, 0), ("Cancel Invoice Receipt", 1), (IR, 2), (CL, 3)],
            "before": [(PO, 0), (CL, 1), ("Cancel Invoice Receipt", 2)],
            "tie": [(PO, 0), ("Cancel Invoice Receipt", 1), (CL, 1)],
            "none": [(PO, 0), (CL, 1)],
        }
    )
    v = result.violations.rp_clearing_after_cancellation
    assert v["after"] == 1
    assert v["before"] == v["tie"] == 0
    assert pd.isna(v["none"])


def test_transfer_failure_needs_explicit_failure_evidence():
    result, _ = score(
        {
            "success": [(PO, 0), ("SRM: In Transfer to Execution Syst.", 1)],
            "fail": [(PO, 0), ("SRM: Transfer Failed (E.Sys.)", 1)],
            "unknown": [(PO, 0)],
        }
    )
    v = result.violations.rp_recorded_transfer_failure
    assert v["success"] == 0 and v["fail"] == 1 and pd.isna(v["unknown"])


def test_optional_automation_fields_are_gated_by_validation_and_eligibility():
    m = mapping()
    m["attribute_mapping"].update(
        {a: a for a in ("automation_recovery_count", "automation_evidence_validated", "automation_eligible")}
    )
    norm = candidate_norm(m)
    rows = [
        {
            "case": c,
            "activity": PO,
            "time": "2025-01-01",
            "flow_type": "DF1",
            "automation_recovery_count": n,
            "automation_evidence_validated": valid,
            "automation_eligible": eligible,
        }
        for c, n, valid, eligible in [
            ("fail", 2, True, True),
            ("ok", 0, True, True),
            ("unknown", None, True, True),
            ("invalid", 2, False, True),
            ("ineligible", 2, True, False),
        ]
    ]
    log = wise.EventLog(
        pd.DataFrame(rows),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=list(m["attribute_mapping"].values()),
    )
    v = wise.score(log, norm).violations.rp_validated_automation_recovery
    assert v["fail"] == 1 and v["ok"] == 0
    assert all(pd.isna(v[c]) for c in ("unknown", "invalid", "ineligible"))


def test_missing_activity_mapping_omits_rule_with_gap_without_guessing():
    m = mapping()
    del m["activity_mapping"]["p2p.vendor_invoice"]
    doc, report = extend(config=m)
    assert "rp_invoice_capture_interval" not in report["added_constraint_ids"]
    assert any(
        r["constraint_id"] == "rp_invoice_capture_interval" and "mapping required" in r["reason"]
        for r in report["omitted"]
    )
    wise.Norm.from_dict(doc).validate()


def test_reapplication_rejected_without_mutation():
    doc, _ = extend()
    snapshot = copy.deepcopy(doc)
    with pytest.raises(ValueError, match="collision"):
        extend(doc)
    assert doc == snapshot


@pytest.mark.parametrize("raw_name", ["rp_vendor_invoice_count", "rp_invoice_receipt_count", "rp_clearing_count"])
def test_selected_recipe_raw_attribute_collision_rejected_without_mutation(raw_name):
    document = base()
    document["constraints"].append(
        {
            "id": "legacy_raw_metric",
            "layer": document["layers"][0]["id"],
            "type": "metric",
            "params": {"attribute": raw_name, "threshold": 0, "width": 1, "direction": "high"},
            "weight": 1,
        }
    )
    config = mapping()
    available = [*config["attribute_mapping"].values(), raw_name]
    snapshot = copy.deepcopy((document, config, available))
    with pytest.raises(ValueError, match="collision.*" + raw_name):
        extend_report_patterns(
            document,
            activity_mapping=config["activity_mapping"],
            attribute_mapping=config["attribute_mapping"],
            flow_values=config["flow_values"],
            available_activities=[v for labels in config["activity_mapping"].values() for v in labels],
            available_attributes=available,
        )
    assert (document, config, available) == snapshot


def test_unselected_recipe_name_does_not_block_an_existing_raw_attribute():
    config = mapping()
    del config["activity_mapping"]["p2p.invoice_clear"]
    doc, _ = extend_report_patterns(
        base(),
        activity_mapping=config["activity_mapping"],
        attribute_mapping=config["attribute_mapping"],
        flow_values=config["flow_values"],
        available_activities=[v for labels in config["activity_mapping"].values() for v in labels],
        available_attributes=[*config["attribute_mapping"].values(), "rp_clearing_count"],
    )
    assert "rp_clearing_count" not in {r["name"] for r in doc["derived_attributes"]}


def tool():
    spec = importlib.util.spec_from_file_location("draft_tool", ROOT / "tools/create_report_pattern_draft.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com:8010/api/v1",
        "http://127.0.0.1:8000/api/v1",
        "http://user@localhost:8010/api/v1",
        "http://localhost:8010/other",
        "http://localhost:8010/api/v1?x=1",
    ],
)
def test_api_tool_refuses_non_authorized_targets(url):
    with pytest.raises(ValueError):
        tool().check_url(url)


@pytest.mark.parametrize("apply", [False, True])
def test_tool_uses_only_get_and_new_draft_run_posts(tmp_path, apply):
    import httpx

    t = tool()
    calls = []
    b = {"id": t.BASE_NORM, "norm": base()}
    run = {
        "id": t.BASE_RUN,
        "status": "done",
        "caseTableId": t.CASE_TABLE,
        "normVersionId": t.BASE_NORM,
        "slicings": [],
        "gamma": 20,
        "minCases": 1,
        "scope": None,
    }

    def handle(request):
        path = request.url.path
        calls.append((request.method, path))
        if request.method == "POST":
            body = json.loads(request.content)
            if path.endswith("/norms"):
                assert body["parentId"] == t.BASE_NORM and "author" not in body and "calibration" not in body
                assert body["norm"]["constraints"][:29] == b["norm"]["constraints"]
                return httpx.Response(
                    201, json={"id": "new_norm", "status": "draft", "fingerprint": "server-canonical-fingerprint"}
                )
            assert path.endswith("/runs")
            assert body["baselineRunId"] == t.BASE_RUN and body["caseTableId"] == t.CASE_TABLE
            return httpx.Response(202, json={**run, "id": "new_run", "normVersionId": "new_norm"})
        if path.endswith(t.BASE_NORM):
            return httpx.Response(200, json=b)
        if path.endswith(t.BASE_RUN):
            return httpx.Response(200, json=run)
        if path.endswith("/inventory"):
            return httpx.Response(
                200,
                json={
                    "activities": [{"label": v[0]} for v in mapping()["activity_mapping"].values()],
                    "attributeNames": ["flow_type"],
                },
            )
        return httpx.Response(200, json={"stats": {"n": 0}, "casesInScope": 0, "threshold": 0, "unit": "events"})

    with httpx.Client(base_url="http://127.0.0.1:8010/api/v1", transport=httpx.MockTransport(handle)) as client:
        result = t.execute(client, mapping=mapping(), output=tmp_path, apply=apply)
    assert len([m for m, p in calls if m == "POST"]) == (2 if apply else 0)
    assert all(m in {"GET", "POST"} for m, p in calls)
    if apply:
        assert result["originalNormUnchanged"] and result["originalRunUnchanged"]
        assert result["fingerprint"] == "server-canonical-fingerprint"
        assert result["preparedFingerprint"] != result["fingerprint"]


def test_coverage_does_not_treat_missing_precedence_response_as_evaluated():
    import httpx

    t = tool()
    doc = {"constraints": [{"id": "order", "type": "precedence", "params": {"b": [VI], "missing_b": "skip"}}]}
    signals = {
        "order": {"casesInScope": 5, "stats": {"n": 5, "shareBeyondThreshold": 0.2}, "threshold": 0, "unit": "events"}
    }

    def handle(request):
        assert request.method == "GET"
        assert json.loads(request.url.params["filter"])["and"][0]["activity"] == [VI]
        return httpx.Response(200, json={"stats": {"n": 2, "shareBeyondThreshold": 0.5}})

    with httpx.Client(base_url="http://127.0.0.1:8010/api/v1", transport=httpx.MockTransport(handle)) as client:
        rows = t.collect_coverage(client, prefix="/projects/test", run_id="test", document=doc, signals=signals)
    assert rows["order"]["casesEvaluated"] == 2
    assert rows["order"]["candidateCases"] == 1
    assert rows["order"]["casesUnmeasuredInScope"] == 3


def test_consignment_and_unknown_flows_do_not_gain_invoice_obligations():
    rows = []
    for flow in ("DF1", "Consignment", "unmapped"):
        for a, d in [(PO, 0), (VI, 1), (IR, 30)]:
            rows.append(
                {
                    "case": flow,
                    "activity": a,
                    "time": pd.Timestamp("2025-01-01") + pd.Timedelta(days=d),
                    "flow_type": flow,
                }
            )
    log = wise.EventLog(
        pd.DataFrame(rows),
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=["flow_type"],
    )
    v = wise.score(log, candidate_norm()).violations
    assert v.loc["DF1", "rp_invoice_capture_interval"] == 1
    assert pd.isna(v.loc["Consignment", "rp_invoice_capture_interval"])
    assert v.loc["unmapped"].isna().all()
