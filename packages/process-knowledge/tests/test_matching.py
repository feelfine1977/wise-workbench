from __future__ import annotations

from difflib import SequenceMatcher
from itertools import pairwise

import pytest
from conftest import BPIC2019_CSV, HACKATHON_DIR, OCEL_P2P_EVENTS

from wise_knowledge import Matcher, MatchKey, ObservedActivity, normalise_label
from wise_knowledge import matching as m
from wise_knowledge.labels import guess_label_column, read_labels, sniff_columns


def test_normalisation():
    assert normalise_label("Goods Receipt for Purchase Order (MIGO)") == "good receipt purchas order"
    assert normalise_label("Changed PO Quantity- Decrease") == "chang purchas order quantiti decreas"
    assert normalise_label("Wareneingang buchen") == "wareneingang buchen"
    assert normalise_label("Änderung übertragen") == "aenderung uebertragen"
    tokens, tcodes = m.tokenise("ME21N Create Purchase Order")
    assert tcodes == ["me21n"] and tokens == ["creat", "purchas", "order"]
    assert m.stem("deliveries") == m.stem("delivery") == "deliveri"
    assert m.stem("approval") == m.stem("approved") == "approv"


def test_bpic2019_top1_at_least_90_percent(p2p):
    ev = Matcher(p2p).evaluate(p2p.mappings["bpic2019"])
    assert ev.n == 42
    assert ev.top1_rate >= 0.9, ev.misses


def test_bpic2019_without_label_packs(p2p):
    ev = Matcher(p2p, label_packs=[]).evaluate(p2p.mappings["bpic2019"])
    assert ev.top1_rate >= 0.9, ev.misses


def test_hackathon_purchase_and_ocel(p2p):
    assert Matcher(p2p).evaluate(p2p.mappings["hackathon_purchase"]).top1_rate >= 0.9
    ev = Matcher(p2p, key=MatchKey(label="type", lifecycle="lifecycle")).evaluate(p2p.mappings["ocel2_p2p"])
    assert ev.n == 10 and ev.top1_rate >= 0.9, ev.misses


def test_o2c_hackathon_top1_at_least_90_percent(o2c):
    ev = Matcher(o2c).evaluate(o2c.mappings["hackathon_sales"])
    assert ev.n == 16 and ev.top1_rate >= 0.9, ev.misses
    assert Matcher(o2c, label_packs=[]).evaluate(o2c.mappings["hackathon_sales"]).top1_rate >= 0.9
    assert Matcher(o2c).evaluate(o2c.mappings["ocel2_order_management"]).top1_rate >= 0.9


def test_candidates_carry_stage_and_confidence(p2p):
    cands = Matcher(p2p).match("Record Goods Receipt")
    assert cands[0].activity_id == "p2p.gr" and cands[0].stage == "receive" and cands[0].confidence == 1.0
    assert cands[0].method == "label_pack:bpic2019" and cands[0].tier == "high"
    assert all(c1.confidence >= c2.confidence for c1, c2 in pairwise(cands))


def test_partial_label_prefers_plain_over_cancel(p2p):
    cands = Matcher(p2p, label_packs=[]).match("Goods receipt")
    ids = [c.activity_id for c in cands]
    assert ids[0] == "p2p.gr" and "p2p.gr_cancel" in ids
    assert cands[0].confidence > cands[ids.index("p2p.gr_cancel")].confidence


def test_german_synonym_and_tcode(p2p):
    matcher = Matcher(p2p, label_packs=[])
    assert matcher.match("Wareneingang buchen")[0].activity_id == "p2p.gr"
    assert matcher.match("Rechnung erfassen")[0].activity_id == "p2p.ir"
    best = Matcher(p2p).match("MIGO")[0]
    assert best.activity_id == "p2p.gr" and best.method.startswith("tcode")
    assert Matcher(p2p).match("Zahllauf F110")[0].activity_id == "p2p.invoice_clear"


def test_abbreviations_and_header_item_distinction(p2p):
    matcher = Matcher(p2p, label_packs=[])
    assert matcher.match("Create PO")[0].activity_id == "p2p.po_create"
    assert matcher.match("Create PO item")[0].activity_id == "p2p.po_item_create"
    assert matcher.match("Approve Purchase Order")[0].activity_id == "p2p.po_release"
    assert matcher.match("GR")[0].activity_id == "p2p.gr"


def test_unknown_label_is_unmatched(p2p):
    assert Matcher(p2p).match("Quarterly strategy offsite") == []


def test_key_components_are_respected(p2p):
    matcher = Matcher(p2p, key=MatchKey(label="type", lifecycle="lifecycle"))
    ok = matcher.match(ObservedActivity(label="Execute Payment", lifecycle="complete"))
    assert ok[0].method == "label_pack:ocel2_p2p" and ok[0].confidence == 1.0
    other = matcher.match(ObservedActivity(label="Execute Payment", lifecycle="start"))
    assert other[0].activity_id == "p2p.invoice_clear" and not other[0].method.startswith("label_pack")
    plain = matcher.match(ObservedActivity(label="Execute Payment"))
    assert plain[0].activity_id == "p2p.invoice_clear" and plain[0].confidence == pytest.approx(0.95)


def test_difflib_fallback(p2p, monkeypatch):
    monkeypatch.setattr(m, "_ratio", lambda a, b: SequenceMatcher(None, a, b).ratio())
    ev = Matcher(p2p, label_packs=[]).evaluate(p2p.mappings["bpic2019"])
    assert ev.top1_rate >= 0.9, ev.misses


def test_unknown_label_pack_rejected(p2p):
    with pytest.raises(KeyError):
        Matcher(p2p, label_packs=["nope"])


def test_read_labels_from_csv(tmp_path, p2p):
    csv = tmp_path / "log.csv"
    csv.write_text(
        "case,activity,lifecycle\n1,Goods receipt,complete\n1,Goods receipt,complete\n2,Create PO,complete\n",
        encoding="utf-8",
    )
    cols = sniff_columns(csv)
    assert guess_label_column(cols) == "activity"
    observed = read_labels(csv, MatchKey(label="activity", lifecycle="lifecycle"))
    assert observed[0] == ObservedActivity(label="Goods receipt", lifecycle="complete", count=2)
    results = Matcher(p2p).match_many(observed)
    assert results[0].best.activity_id == "p2p.gr"


@pytest.mark.skipif(not BPIC2019_CSV.is_file(), reason="BPIC 2019 CSV not available")
def test_real_bpic2019_labels(p2p):
    observed = read_labels(BPIC2019_CSV, MatchKey(label="event concept:name"))
    assert len(observed) == 42
    assert sum(o.count for o in observed) == 1595923
    ev = Matcher(p2p).evaluate(p2p.mappings["bpic2019"], observed)
    assert ev.n == 42 and ev.top1_rate >= 0.9, ev.misses


@pytest.mark.skipif(not (HACKATHON_DIR / "Sales_Eventlog.csv").is_file(), reason="hackathon extract not available")
def test_real_hackathon_labels(p2p, o2c):
    sales = read_labels(HACKATHON_DIR / "Sales_Eventlog.csv", MatchKey(label="activity"))
    assert len(sales) == 16
    assert Matcher(o2c).evaluate(o2c.mappings["hackathon_sales"], sales).top1_rate >= 0.9
    purchase = read_labels(HACKATHON_DIR / "Purchase_Eventlog.csv", MatchKey(label="activity"))
    assert len(purchase) == 10
    assert Matcher(p2p).evaluate(p2p.mappings["hackathon_purchase"], purchase).top1_rate >= 0.9


@pytest.mark.skipif(not OCEL_P2P_EVENTS.is_file(), reason="OCEL 2.0 P2P events not available")
def test_real_ocel_types(p2p):
    observed = read_labels(OCEL_P2P_EVENTS, MatchKey(label="type", lifecycle="lifecycle"))
    assert len(observed) == 10 and all(o.lifecycle == "complete" for o in observed)
    ev = Matcher(p2p, key=MatchKey(label="type", lifecycle="lifecycle")).evaluate(p2p.mappings["ocel2_p2p"], observed)
    assert ev.top1_rate >= 0.9, ev.misses
