from __future__ import annotations

import json

import pytest

from wise_knowledge import Activity, FailureMode, Kpi, Playbook, Stage, load_datasets, load_mapping
from wise_knowledge.loaders import PackError

BPIC2019_LABELS = {
    "Record Goods Receipt",
    "Create Purchase Order Item",
    "Record Invoice Receipt",
    "Vendor creates invoice",
    "Clear Invoice",
    "Record Service Entry Sheet",
    "Remove Payment Block",
    "Create Purchase Requisition Item",
    "Receive Order Confirmation",
    "Change Quantity",
    "Change Price",
    "Delete Purchase Order Item",
    "Change Approval for Purchase Order",
    "Cancel Invoice Receipt",
    "Vendor creates debit memo",
    "Change Delivery Indicator",
    "Cancel Goods Receipt",
    "SRM: In Transfer to Execution Syst.",
    "SRM: Awaiting Approval",
    "SRM: Complete",
    "SRM: Ordered",
    "SRM: Document Completed",
    "SRM: Created",
    "Release Purchase Order",
    "SRM: Change was Transmitted",
    "Reactivate Purchase Order Item",
    "Block Purchase Order Item",
    "Cancel Subsequent Invoice",
    "Release Purchase Requisition",
    "Change Storage Location",
    "Update Order Confirmation",
    "SRM: Deleted",
    "Record Subsequent Invoice",
    "Set Payment Block",
    "SRM: Transfer Failed (E.Sys.)",
    "Change Currency",
    "Change Final Invoice Indicator",
    "SRM: Transaction Completed",
    "Change payment term",
    "SRM: Incomplete",
    "SRM: Held",
    "Change Rejection Indicator",
}
OCEL_P2P_TYPES = {
    "Create Goods Receipt",
    "Create Invoice Receipt",
    "Perform Two-Way Match",
    "Approve Purchase Order",
    "Create Purchase Order",
    "Execute Payment",
    "Create Request for Quotation",
    "Create Purchase Requisition",
    "Approve Purchase Requisition",
    "Delegate Purchase Requisition Approval",
}
HACKATHON_PURCHASE = {
    "Created Purchase Vendor Confirmation",
    "Goods receipt",
    "Send Purchase order",
    "Create Purchase Order",
    "Create Purchase Order Item",
    "Change Delivery date (Confirmation)",
    "Changed PO Quantity- Decrease",
    "Change PO Deleted Flag",
    "Changed Delivery date (Schedule Line)",
    "Changed PO Quantity - Increase",
}
HACKATHON_SALES = {
    "Create Order Item",
    "Create Order",
    "Create Delivery Item",
    "Goods issue",
    "Picking Completed",
    "Changed Mat.Avail.Date",
    "Scheduled delivery date preponed",
    "Scheduled delivery date postponed",
    "Send Order Confirmation",
    "Changed RejectionReason",
    "Schedule line confirmed quantity removed",
    "Changed Incoterms",
    "Schedule line requested quantity changed",
    "Schedule line confirmed quantity changed",
    "Packing Completed",
    "Changed Delivery block",
}
OCEL_OM = {
    "place order",
    "confirm order",
    "item out of stock",
    "reorder item",
    "pick item",
    "create package",
    "send package",
    "failed delivery",
    "package delivered",
    "pay order",
    "payment reminder",
}


def test_typed_dataclasses(p2p):
    assert all(isinstance(a, Activity) for a in p2p.activities)
    assert all(isinstance(f, FailureMode) for f in p2p.failure_modes)
    assert all(isinstance(k, Kpi) for k in p2p.kpis)
    assert all(isinstance(p, Playbook) for p in p2p.playbooks)
    assert all(isinstance(s, Stage) for s in p2p.stages)
    assert [s.id for s in p2p.stages] == ["request", "approve", "order", "receive", "invoice", "match", "pay"]
    assert p2p.activity("p2p.gr").stage == "receive"
    assert "Wareneingang" in " ".join(p2p.activity("p2p.gr").synonyms["de"])


def test_o2c_stages(o2c):
    assert [s.id for s in o2c.stages] == ["capture", "commit", "fulfil", "return", "invoice", "pay"]
    assert {v.id for v in o2c.stage_model.variants} >= {"standard", "make_to_order", "returns", "rejected_at_capture"}


def test_p2p_variants(p2p):
    ids = {v.id for v in p2p.stage_model.variants}
    assert ids >= {"three_way_gr_first", "three_way_invoice_first", "two_way", "consignment", "service"}
    df = {v.flow_type_codes.get("p2p_bpic19") for v in p2p.stage_model.variants}
    assert {"DF1", "DF2", "2-way", "Consignment"} <= df


def test_label_packs_cover_datasets(p2p, o2c):
    bp = {e.label for e in p2p.label_packs["bpic2019"].labels}
    assert bp >= BPIC2019_LABELS and len(BPIC2019_LABELS) == 42
    assert {e.label for e in p2p.label_packs["ocel2_p2p"].labels} >= OCEL_P2P_TYPES
    assert {e.label for e in p2p.label_packs["hackathon"].labels} >= HACKATHON_PURCHASE
    assert len(p2p.label_packs["sap_mm"].labels) >= 20
    assert {e.label for e in o2c.label_packs["hackathon"].labels} == HACKATHON_SALES
    assert {e.label for e in o2c.label_packs["ocel2_order_management"].labels} == OCEL_OM
    assert len(o2c.label_packs["sap_sd"].labels) >= 20


def test_mappings_loaded(p2p, o2c):
    assert set(p2p.mappings) >= {"bpic2019", "hackathon_purchase", "ocel2_p2p"}
    assert {e.label for e in p2p.mappings["bpic2019"].entries} == BPIC2019_LABELS
    assert p2p.mappings["bpic2019"].key["label"] == "event concept:name"
    assert {e.label for e in o2c.mappings["hackathon_sales"].entries} == HACKATHON_SALES
    assert all(e.lifecycle == "complete" for e in p2p.mappings["ocel2_p2p"].entries)


def test_failure_modes_reference_paper_constraints(p2p):
    tmpl = json.loads(p2p.template("p2p_bpic19").path.read_text(encoding="utf-8"))
    ids = {c["id"] for c in tmpl["constraints"]}
    assert len(ids) == 29
    referenced = {p.constraint_ref for fm in p2p.failure_modes for p in fm.wise_patterns if p.template == "p2p_bpic19"}
    assert ids <= referenced, f"constraints without failure mode: {sorted(ids - referenced)}"
    price = p2p.failure_modes_for_constraint("c_l6_change_price", template="p2p_bpic19")
    assert [fm.id for fm in price] == ["p2p.fm.price_change_after_po"]


def test_required_p2p_failure_modes(p2p):
    ids = {fm.id for fm in p2p.failure_modes}
    assert {
        "p2p.fm.price_change_after_po",
        "p2p.fm.quantity_change_after_po",
        "p2p.fm.invoice_before_goods_receipt",
        "p2p.fm.payment_block",
        "p2p.fm.duplicate_invoice",
        "p2p.fm.cancelled_goods_receipt",
        "p2p.fm.deleted_item",
        "p2p.fm.late_or_repeated_approval",
        "p2p.fm.invoice_before_order",
        "p2p.fm.order_without_requisition",
    } <= ids
    for fm in p2p.failure_modes:
        assert fm.typical_causes and fm.typical_remedies and fm.evidence_to_check and fm.sources
        if fm.evidence == "none":
            assert not fm.observed_share


def test_o2c_failure_modes_keep_readme_shares(o2c):
    fm = {f.id: f for f in o2c.failure_modes}
    assert fm["o2c.fm.delivery_date_postponed"].observed_share[0]["value"] == 0.032
    assert fm["o2c.fm.confirmation_withdrawn"].observed_share[0]["value"] == 0.015
    assert fm["o2c.fm.change_churn"].observed_share[0]["value"] == 0.137
    assert fm["o2c.fm.late_goods_issue"].observed_share[0]["value"] == 0.032
    vocabulary = [f for f in o2c.failure_modes if f.evidence == "none"]
    assert {
        "o2c.fm.credit_block",
        "o2c.fm.return_without_return_order",
        "o2c.fm.invoice_correction",
        "o2c.fm.payment_after_due_date",
    } <= {f.id for f in vocabulary}
    # shares are seeds, never thresholds: no pattern parameter equals an observed share
    for f in o2c.failure_modes:
        shares = {s["value"] for s in f.observed_share}
        for p in f.wise_patterns:
            assert not (set(p.params.values()) & shares)


def test_every_template_constraint_is_catalogued(p2p, o2c):
    for pack in (p2p, o2c):
        for t in pack.templates:
            ids = {c["id"] for c in json.loads(t.path.read_text(encoding="utf-8"))["constraints"]}
            referenced = {p.constraint_ref for fm in pack.failure_modes for p in fm.wise_patterns if p.template == t.id}
            assert ids <= referenced, f"{t.id}: constraints without failure mode {sorted(ids - referenced)}"


def test_owner_roles_and_kpis_resolve(p2p, o2c):
    for pack in (p2p, o2c):
        roles = {r.id for r in pack.slicing.roles}
        kpis = {k.id for k in pack.kpis}
        for fm in pack.failure_modes:
            assert fm.owner_role in roles
            assert set(fm.kpis) <= kpis
        assert any(n["key"].startswith("user") for n in pack.slicing.never_slice_by)


def test_playbooks_cover_all_journey_stages(p2p, o2c):
    for pack in (p2p, o2c):
        assert {pb.journey_stage for pb in pack.playbooks} == {f"S{i}" for i in range(13)}
        assert all(q.get("de") for pb in pack.playbooks for q in pb.questions)


def test_glossary_bilingual(p2p, o2c):
    for pack in (p2p, o2c):
        assert len(pack.glossary) >= 20
        assert all(t.term.get("de") and t.definition.get("de") for t in pack.glossary)


def test_datasets_registry():
    reg = load_datasets()
    assert reg.get("bpic2019").pack == "p2p"
    assert reg.get("bpic2019").checked["activities"] == 42
    assert len(set(reg.ids)) == len(reg.ids)
    assert "icpm2026_hackathon" in reg.ids


def test_load_mapping_file(p2p):
    m = load_mapping(p2p.path / "mappings" / "bpic2019.yaml")
    assert m.as_dict()["Record Goods Receipt"] == "p2p.gr"


def test_invalid_pack_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        from wise_knowledge import load_pack

        load_pack(tmp_path / "nope")
    with pytest.raises((PackError, FileNotFoundError)):
        from wise_knowledge import load_pack

        load_pack("no_such_pack")
