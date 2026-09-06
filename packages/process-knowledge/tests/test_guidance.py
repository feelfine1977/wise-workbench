"""Guidance schema, completeness, hub and stage-lane shapes, norm draft v1.1, presets and data-quality patterns."""

from __future__ import annotations

import json

import pytest

from wise_knowledge import build_graph, build_hub, render_page, stage_lanes, template_guidance
from wise_knowledge.cli import main
from wise_knowledge.guidance import HUB_EDGE_KINDS, HUB_KINDS, embed_guidance, guidance_complete
from wise_knowledge.models import COUNTERMEASURES, GUIDANCE_KINDS
from wise_knowledge.schema import GUIDANCE_BLOCKS, validate_document

CONTRACT_BLOCK_FIELDS = {
    "plain_name",
    "expectation",
    "meaning_when_missed",
    "why_it_matters",
    "how_detected",
    "usual_reasons",
    "usual_actions",
    "what_to_check_first",
    "examples",
    "kpis",
    "owner_role",
    "stakeholders",
    "sources",
    "review_status",
    "version",
}

# R1-05: plain names (expectation form) and missed labels (card form) of the seven layers of the paper's norm,
# as proposed by the clerk and the owner in the cycle 1 review §9 and the knowledge-hub panel §5.
P2P_LAYER_NAMES = {
    "L1_closure_completeness": ("closing the loop", "missing invoice or payment"),
    "L2_flow_discipline": ("buying channel and sequence", "steps out of order for this flow type"),
    "L3_timeliness_ageing": ("on time", "waiting too long between steps"),
    "L4_rework_instability": ("doing it once", "repeated or changed postings"),
    "L5_exceptions_corrections": ("exceptions stay rare", "cancellations and memos"),
    "L6_value_commercial": ("paying what was agreed", "price or quantity changed after ordering"),
    "L7_effort_automation": ("touchless where possible", "too many manual touches"),
}


def _template_doc(pack, template_id):
    return json.loads(pack.template(template_id).path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- schema
def _minimal_entry(**over):
    e = {
        "id": "closure_completeness",
        "plain_name": {"en": "Closing the loop"},
        "missed_label": {"en": "missing invoice or payment"},
        "expectation": "x",
        "meaning_when_missed": "x",
        "why_it_matters": "x",
        "how_detected": "x",
        "usual_reasons": [{"text": "x", "where": "log", "check": "x"}],
        "usual_actions": [
            {"text": "x", "countermeasure": "policy", "owner_role": "purchasing", "effect_area": "closure_completeness"}
        ],
        "what_to_check_first": ["x"],
        "examples": [{"kind": "violating", "text": "x"}, {"kind": "compliant", "text": "x"}],
        "kpis": [],
        "owner_role": "purchasing",
    }
    e.update(over)
    return e


def _doc(entry):
    return {
        "pack": "p2p",
        "version": 1,
        "review_status": "draft",
        "defaults": {"stakeholders": "x", "sources": ["x"], "review_status": "draft", "version": 1},
        "layers": [entry],
        "constraints": [],
        "failure_modes": [],
    }


def test_guidance_schema_accepts_complete_entry_and_rejects_broken_ones():
    assert validate_document("guidance", _doc(_minimal_entry())) == []
    missing = _minimal_entry()
    del missing["why_it_matters"]
    assert any("why_it_matters" in i.message for i in validate_document("guidance", _doc(missing)))
    bad_where = _minimal_entry(usual_reasons=[{"text": "x", "where": "somewhere", "check": "x"}])
    assert validate_document("guidance", _doc(bad_where))
    no_check = _minimal_entry(usual_reasons=[{"text": "x", "where": "log"}])
    assert validate_document("guidance", _doc(no_check))
    bad_cm = _minimal_entry(
        usual_actions=[
            {
                "text": "x",
                "countermeasure": "wishful",
                "owner_role": "purchasing",
                "effect_area": "closure_completeness",
            }
        ]
    )
    assert validate_document("guidance", _doc(bad_cm))
    stray = _minimal_entry(extra="x")
    assert any("extra" in i.message for i in validate_document("guidance", _doc(stray)))


# --------------------------------------------------------------------------- completeness (RK-1)
def test_every_layer_constraint_and_failure_mode_has_guidance_with_all_blocks(p2p, o2c):
    for pack in (p2p, o2c):
        layers = {layer.id for layer in pack.layers}
        roles = {r.id for r in pack.slicing.roles}
        kpis = {k.id for k in pack.kpis}
        by = {(g.kind, g.id) for g in pack.guidance}
        assert {("layer", lid) for lid in layers} <= by
        assert {("failure_mode", fm.id) for fm in pack.failure_modes} <= by
        for t in pack.templates:
            ok, missing = guidance_complete(pack, t.id)
            assert ok, (pack.id, t.id, missing)
            for c in _template_doc(pack, t.id)["constraints"]:
                assert pack.guidance_for("constraint", c["id"], template=t.id) is not None, (t.id, c["id"])
        for g in pack.guidance:
            assert g.kind in GUIDANCE_KINDS
            block = g.as_block()
            assert set(block) >= CONTRACT_BLOCK_FIELDS, (g.kind, g.id, CONTRACT_BLOCK_FIELDS - set(block))
            assert set(GUIDANCE_BLOCKS) <= set(block)
            assert g.plain_name_en and g.expectation and g.meaning_when_missed and g.why_it_matters and g.how_detected
            if g.kind == "layer":
                assert g.missed_label_en, g.id
            assert g.usual_reasons and g.usual_actions and g.what_to_check_first and g.examples
            for r in g.usual_reasons:
                assert r.where in ("log", "outside") and r.check and r.text, (g.id, r)
            for a in g.usual_actions:
                assert a.countermeasure in COUNTERMEASURES, (g.id, a)
                assert a.owner_role in roles and a.effect_area in layers, (g.id, a)
            assert {e.kind for e in g.examples} == {"violating", "compliant"}, g.id
            assert set(g.kpis) <= kpis and g.owner_role in roles, g.id
            assert g.stakeholders and g.sources and g.review_status in ("draft", "reviewed", "approved") and g.version


def test_guidance_entry_counts(p2p, o2c):
    def counts(pack):
        return {k: sum(1 for g in pack.guidance if g.kind == k) for k in GUIDANCE_KINDS}

    assert counts(p2p) == {"layer": 8, "constraint": 42, "failure_mode": 29}
    assert counts(o2c) == {"layer": 7, "constraint": 30, "failure_mode": 22}


def test_plain_names_and_missed_labels_of_the_seven_paper_layers(p2p):
    for template_layer, (plain, missed) in P2P_LAYER_NAMES.items():
        g = p2p.guidance_for("layer", template_layer, template="p2p_bpic19")
        assert g is not None, template_layer
        assert g.plain_name_en.lower().startswith(plain), (template_layer, g.plain_name_en)
        assert g.missed_label_en.lower().startswith(missed), (template_layer, g.missed_label_en)
        assert g.plain_name.get("de") and g.missed_label.get("de"), template_layer
    assert p2p.guidance_for("layer", "L2_flow_discipline", template="p2p_bpic19_v1_1") is p2p.guidance_for(
        "layer", "flow_discipline"
    )


def test_constraint_guidance_resolves_through_templates_and_aliases(p2p):
    g = p2p.guidance_for("constraint", "c_l6_change_price", template="p2p_bpic19")
    assert g is not None and g.id == "c_l6_change_price"
    assert p2p.guidance_for("constraint", "c_l6_change_price", template="p2p_bpic19_v1_1") is g
    assert p2p.guidance_for("constraint", "b_value_price_change_after_po", template="p2p_baseline") is g
    assert p2p.guidance_for("constraint", "c_l2_df1_invoice_after_goods", template="p2p_bpic19_v1_1") is None
    split = p2p.guidance_for("constraint", "c_l2_df1_vendor_invoice_after_goods", template="p2p_bpic19_v1_1")
    assert split is not None and split.templates == ("p2p_bpic19_v1_1",)


def test_plain_blocks_name_no_constraint_ids(p2p, o2c):
    import re

    rx = re.compile(r"\b(?:c_l\d+_[a-z0-9_]+|b_[a-z]+_[a-z0-9_]+|o_[a-z]+_[a-z0-9_]+)\b")
    for pack in (p2p, o2c):
        for g in pack.guidance:
            text = " ".join([g.expectation, g.meaning_when_missed, g.why_it_matters, g.how_detected])
            assert not rx.findall(text), (g.id, rx.findall(text))


# --------------------------------------------------------------------------- metadata.guidance in templates (RK-2)
def test_non_verbatim_templates_carry_current_metadata_guidance(p2p, o2c):
    for pack in (p2p, o2c):
        for t in pack.templates:
            doc = _template_doc(pack, t.id)
            if t.verbatim:
                assert "guidance" not in doc.get("metadata", {}), t.id
                continue
            block = template_guidance(pack, t.id)
            assert doc["metadata"]["guidance"] == block, t.id
            changed, _ = embed_guidance(pack, t.id, write=False)
            assert not changed, t.id
            assert set(block["layers"]) == {layer["id"] for layer in doc["layers"]}
            assert set(block["constraints"]) == {c["id"] for c in doc["constraints"]}
            for cid, g in block["constraints"].items():
                assert set(g) >= CONTRACT_BLOCK_FIELDS and g["constraint_id"] == cid and g["hub_node"], cid
                assert {"text", "where", "check"} <= set(g["usual_reasons"][0])
                assert {"text", "countermeasure", "owner_role", "effect_area"} <= set(g["usual_actions"][0])
            for lid, g in block["layers"].items():
                assert g["template_layer_id"] == lid and g["missed_label"], lid


def test_verbatim_template_is_never_rewritten(p2p):
    with pytest.raises(ValueError):
        embed_guidance(p2p, "p2p_bpic19", write=False)


# --------------------------------------------------------------------------- norm draft v1.1 (R1-10)
def test_norm_draft_v1_1_splits_invoice_before_goods(p2p):
    wise = pytest.importorskip("wise")
    entry = p2p.template("p2p_bpic19_v1_1")
    assert entry.derived_from == "p2p_bpic19" and not entry.verbatim and entry.calibration == "mixed"
    norm = wise.Norm.load(entry.path)
    norm.validate()
    ids = set(norm.constraint_ids)
    v10 = set(wise.Norm.load(p2p.template("p2p_bpic19").path).constraint_ids)
    assert len(ids) == 31 and len(v10) == 29
    assert "c_l2_df1_invoice_after_goods" not in ids
    assert {
        "c_l2_df1_vendor_invoice_after_goods",
        "c_l2_df1_invoice_posting_after_goods",
        "c_l2_clear_after_goods",
    } <= ids
    assert ids - v10 == {
        "c_l2_df1_vendor_invoice_after_goods",
        "c_l2_df1_invoice_posting_after_goods",
        "c_l2_clear_after_goods",
    }
    assert v10 - ids == {"c_l2_df1_invoice_after_goods"}
    vendor = norm.get_constraint("c_l2_df1_vendor_invoice_after_goods")
    posting = norm.get_constraint("c_l2_df1_invoice_posting_after_goods")
    clear = norm.get_constraint("c_l2_clear_after_goods")
    assert set(vendor.constraint.b) == {"Vendor creates invoice"} and vendor.applicability == {"flow_type": ["DF1"]}
    assert set(posting.constraint.b) == {"Record Invoice Receipt"} and posting.applicability == {"flow_type": ["DF1"]}
    assert set(clear.constraint.b) == {"Clear Invoice"} and clear.applicability == {"flow_type": ["DF1", "DF2"]}
    terms = norm.get_constraint("c_l4_change_payment_terms_repeats")
    assert list(terms.constraint.activities()) == ["Change payment term"]
    meta = norm.metadata["meta"]
    assert meta["derived_from"] == "p2p_bpic19" and meta["calibration"] == "mixed"
    changed = {c["constraint"] for c in meta["changes"]}
    assert {
        "c_l2_df1_invoice_after_goods",
        "c_l2_df1_vendor_invoice_after_goods",
        "c_l2_df1_invoice_posting_after_goods",
        "c_l2_clear_after_goods",
        "c_l4_change_payment_terms_repeats",
    } <= changed
    assert all(c.get("rationale") for c in meta["changes"])
    assert set(meta["uncalibrated_parameters"]) == ids - v10
    assert set(norm.metadata["guidance"]["constraints"]) == ids
    # the shared expectations keep the paper's thresholds and weights
    old = wise.Norm.load(p2p.template("p2p_bpic19").path)
    for cid in ids & v10 - {"c_l4_change_payment_terms_repeats"}:
        a, b = old.get_constraint(cid), norm.get_constraint(cid)
        assert a.constraint.params() == b.constraint.params() and a.weight == b.weight and a.layer == b.layer, cid


def test_failure_modes_cover_both_bpic19_norms(p2p):
    for tid in ("p2p_bpic19", "p2p_bpic19_v1_1"):
        ids = {c["id"] for c in _template_doc(p2p, tid)["constraints"]}
        covered = {p.constraint_ref for fm in p2p.failure_modes for p in fm.wise_patterns if tid in p.templates}
        assert ids <= covered, (tid, sorted(ids - covered))
    fms = {fm.id for fm in p2p.failure_modes_for_constraint("c_l2_clear_after_goods", template="p2p_bpic19_v1_1")}
    assert fms == {"p2p.fm.invoice_before_goods_receipt"}


# --------------------------------------------------------------------------- data-quality patterns (R1-24)
def test_data_quality_failure_modes_are_readiness_checks(p2p):
    for fid, activity in (
        ("p2p.fm.block_release_logging_asymmetry", "p2p.payment_block_remove"),
        ("p2p.fm.missing_order_confirmation", "p2p.po_confirmation_receive"),
    ):
        fm = p2p.failure_mode(fid)
        assert fm.kind == "data_quality" and fm.is_data_quality
        assert activity in fm.signature_activities
        assert all(p.template is None and p.constraint_ref is None for p in fm.wise_patterns), fid
        assert fm.observed_share and fm.observed_share[0]["source"] == "bpic2019"
        g = p2p.guidance_for("failure_mode", fid)
        assert g is not None and "readiness" in g.how_detected.lower()
    block = p2p.failure_mode("p2p.fm.block_release_logging_asymmetry")
    assert block.observed_share[0]["value"] == pytest.approx(0.9995)
    conf = p2p.failure_mode("p2p.fm.missing_order_confirmation")
    assert conf.observed_share[0]["value"] == pytest.approx(0.1274)
    assert {fm.id for fm in p2p.failure_modes if fm.is_data_quality} == {
        "p2p.fm.block_release_logging_asymmetry",
        "p2p.fm.missing_order_confirmation",
    }


# --------------------------------------------------------------------------- knowledge hub (RK-3)
def test_hub_index_and_pages_follow_the_contract(p2p, o2c):
    for pack in (p2p, o2c):
        hub = build_hub(pack)
        index = hub.index()
        assert set(index) >= {"pack", "process", "case_noun", "nodes", "edges"}
        ids = {n["id"] for n in index["nodes"]}
        assert len(ids) == len(index["nodes"])
        for n in index["nodes"]:
            assert {"id", "kind", "plain_name", "method_name"} <= set(n) and n["kind"] in HUB_KINDS, n
            assert n["plain_name"], n
        for e in index["edges"]:
            assert set(e) == {"from", "to", "kind"} and e["kind"] in HUB_EDGE_KINDS
            assert e["from"] in ids and e["to"] in ids, e
        kinds = {n["kind"] for n in index["nodes"]}
        assert kinds == set(HUB_KINDS)
        # every layer, expectation and failure mode opens as a page with guidance and related nodes
        for n in index["nodes"]:
            page = hub.page(n["id"])
            assert set(page) == {"node", "guidance", "related", "overlay"} and page["overlay"] is None
            assert set(page["related"]) >= {"stage", "expectations", "failure_modes", "kpis", "playbook"}
            if n["kind"] in ("layer", "expectation", "failure_mode"):
                g = page["guidance"]
                assert g is not None and set(g) >= CONTRACT_BLOCK_FIELDS and g["hub_node"] == n["id"], n["id"]
        export = hub.export()
        assert set(export["pages"]) == ids
        json.dumps(export)  # serialisable


def test_hub_navigation_and_page_rendering(p2p):
    hub = build_hub(p2p)
    layer = hub.node_for("layer", "L2_flow_discipline", template="p2p_bpic19")
    assert layer == "layer:flow_discipline"
    exp = hub.node_for("constraint", "c_l6_change_price", template="p2p_bpic19")
    assert exp == "expectation:p2p_bpic19:c_l6_change_price"
    assert hub.node_for("failure_mode", "p2p.fm.price_change_after_po") == "failure_mode:p2p.fm.price_change_after_po"
    page = hub.page(exp)
    assert [f["id"] for f in page["related"]["failure_modes"]] == ["failure_mode:p2p.fm.price_change_after_po"]
    assert page["related"]["stage"]["id"] == "stage:order"
    assert page["related"]["playbook"]
    layer_page = hub.page(layer)
    assert {e["id"] for e in layer_page["related"]["expectations"]} >= {
        "expectation:p2p_bpic19:c_l2_df1_invoice_after_goods",
        "expectation:p2p_bpic19_v1_1:c_l2_clear_after_goods",
    }
    text = render_page(hub, layer)
    for heading in (
        "What this means",
        "Why it matters",
        "How we detect it",
        "What usually causes it",
        "What usually helps",
        "What to check first",
        "Examples",
        "Related",
        "Your organisation's note",
    ):
        assert heading in text, heading
    assert "in the log: check" in text and "outside the log: ask" in text
    assert "Buying channel and sequence" in text and "steps out of order" in text
    assert "c_l2_" not in text.split("Related")[0]  # no constraint ids in the guidance blocks


def test_graph_links_guidance_nodes(p2p):
    g = build_graph(p2p)
    guidance_nodes = g.nodes_of_type("guidance")
    assert len(guidance_nodes) == len(p2p.guidance)
    explained = g.edges_of_type("explained_by")
    layer_targets = {e.target for e in explained if e.source.startswith("layer:")}
    assert layer_targets == {f"guidance:layer:{layer.id}" for layer in p2p.layers}
    fm_sources = {e.source for e in explained if e.target.startswith("guidance:failure_mode:")}
    assert fm_sources == {fm.id for fm in p2p.failure_modes}
    pattern_edges = [e for e in explained if e.source.startswith("pattern:")]
    with_ref = sum(1 for fm in p2p.failure_modes for p in fm.wise_patterns if p.constraint_ref)
    assert len(pattern_edges) == with_ref
    path = g.explain("c_l6_change_price", template="p2p_bpic19")[0]
    assert path["guidance"]["constraint"]["plain_name"] and path["guidance"]["failure_mode"]["plain_name"]


# --------------------------------------------------------------------------- stage lanes (R1-16)
def test_stage_lanes_export_in_flowgraph_groups_shape(o2c, p2p):
    payload = stage_lanes(o2c, mapping="hackathon_sales")
    assert set(payload) == {"groups", "nodes", "edges", "overlays", "meta"}
    assert [g["id"] for g in payload["groups"]] == [f"stage:{s.id}" for s in o2c.stages]
    assert all(set(g) == {"id", "kind", "label", "parent"} and g["kind"] == "lane" for g in payload["groups"])
    group_ids = {g["id"] for g in payload["groups"]}
    node_ids = {n["id"] for n in payload["nodes"]}
    for n in payload["nodes"]:
        assert n["group"] in group_ids and n["kind"] == "activity" and n["label"], n
        assert set(n) >= {"id", "kind", "label", "group", "metrics", "tags"}
    mapped = {e.activity for e in o2c.mappings["hackathon_sales"].entries}
    assert node_ids == mapped
    labels = payload["meta"]["labels"]
    assert sum(len(v) for v in labels.values()) == 16 and labels["o2c.goods_issue"] == ["Goods issue"]
    for e in payload["edges"]:
        assert e["kind"] == "flow" and e["source"] in node_ids and e["target"] in node_ids
        assert e["payload"]["origin"] == "expected_ordering"
    assert payload["meta"]["case_noun"] == "sales order items"
    assert payload["meta"]["stage_order"] == [s.id for s in o2c.stages]
    # a P2P variant reorders the lanes: invoice-first flows show the invoice lane before receive
    full = stage_lanes(p2p)
    assert len(full["nodes"]) == len(p2p.activities)
    variant = stage_lanes(p2p, variant="three_way_invoice_first")
    lanes = [g["id"] for g in variant["groups"]]
    assert lanes.index("stage:invoice") < lanes.index("stage:receive")
    with pytest.raises(KeyError):
        stage_lanes(p2p, variant="no_such_variant")


# --------------------------------------------------------------------------- O2C preset (R1-13)
def test_o2c_preset_for_the_hackathon_extract(o2c):
    preset = o2c.presets["icpm2026_o2c"]
    assert preset.dataset == "icpm2026_hackathon" and preset.file == "Sales_Eventlog.csv" and preset.local_only
    assert preset.case_noun["en"] == "sales order items"
    assert preset.mapping["case_id"] == "case_id" and preset.mapping["activity"] == "activity"
    assert preset.header_events == ("Create Order",)
    assert preset.activity_mapping == "hackathon_sales"
    assert preset.norm["template"] == "o2c_baseline" and preset.norm["calibration_visible"] is True
    prepared = {a["name"]: a for a in preset.derived_case_attributes}
    assert prepared["days_late"]["kind"] == "date_difference" and prepared["days_late"]["unit"] == "days"
    assert (
        "Requested delivery date" in prepared["days_late"]["description"]
        or "requested" in prepared["days_late"]["description"]
    )
    assert [s["id"] for s in preset.slicings] == ["customer", "sku", "incoterms", "period"]
    assert next(s for s in preset.slicings if s["id"] == "customer")["default"] is True
    assert set(preset.mapping["attribute_aliases"]) >= {"return_item", "confirmed_quantity", "days_late", "flow_type"}
    assert {f["name"] for f in preset.mapping["flow_typing"]} >= {"returns", "rejected", "partial_delivery"}
    assert preset.pitfalls


# --------------------------------------------------------------------------- CLI
def test_cli_guidance_hub_stages_and_embed(capsys, tmp_path):
    assert main(["guidance", "p2p", "layer", "L2_flow_discipline", "--template", "p2p_bpic19"]) == 0
    out = capsys.readouterr().out
    assert "Buying channel and sequence" in out and "What usually causes it" in out
    assert main(["guidance", "p2p", "constraint", "c_l6_change_price", "--json"]) == 0
    page = json.loads(capsys.readouterr().out)
    assert page["node"]["kind"] == "expectation" and page["guidance"]["plain_name"]
    assert main(["guidance", "o2c", "failure_mode", "o2c.fm.delivery_date_postponed", "--lang", "de"]) == 0
    assert main(["guidance", "p2p", "layer", "no_such_layer"]) == 1
    capsys.readouterr()
    assert main(["hub", "o2c", "--json"]) == 0
    export = json.loads(capsys.readouterr().out)
    assert {n["kind"] for n in export["nodes"]} == set(HUB_KINDS) and set(export["pages"]) == {
        n["id"] for n in export["nodes"]
    }
    assert main(["hub", "p2p", "--out", str(tmp_path / "hub.json")]) == 0
    assert (tmp_path / "hub.json").is_file()
    assert main(["hub", "p2p"]) == 0
    out = capsys.readouterr().out
    assert "template p2p_bpic19: guidance complete" in out and "template p2p_bpic19_v1_1: guidance complete" in out
    assert main(["stages", "o2c", "--json", "--mapping", "hackathon_sales"]) == 0
    lanes = json.loads(capsys.readouterr().out)
    assert [g["label"] for g in lanes["groups"]][:3] == ["Capture", "Commit", "Fulfil"]
    assert main(["stages", "p2p", "--variant", "three_way_invoice_first"]) == 0
    capsys.readouterr()
    assert main(["embed-guidance", "p2p", "--check"]) == 0
    assert main(["embed-guidance", "o2c", "--check"]) == 0
    out = capsys.readouterr().out
    assert "up to date" in out
    assert main(["show", "p2p", "guidance"]) == 0
    out = capsys.readouterr().out
    assert "79 guidance entries" in out
    assert main(["show", "o2c", "presets"]) == 0
    assert "icpm2026_o2c" in capsys.readouterr().out
