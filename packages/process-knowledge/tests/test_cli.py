from __future__ import annotations

import json

from wise_knowledge.cli import main


def test_validate_all(capsys):
    assert main(["validate"]) == 0
    out = capsys.readouterr().out
    assert "datasets.yaml: OK" in out and "pack p2p: OK" in out and "pack o2c: OK" in out and "VALID" in out


def test_validate_json(capsys):
    assert main(["validate", "p2p", "--json"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["packs"]["p2p"] == [] and report["datasets"] == []


def test_show(capsys):
    assert main(["show", "p2p", "stages"]) == 0
    out = capsys.readouterr().out
    assert "request" in out and "three_way_gr_first" in out
    assert main(["show", "o2c", "failure-modes"]) == 0
    out = capsys.readouterr().out
    assert "o2c.fm.delivery_date_postponed" in out and "0.032" in out
    assert main(["show", "p2p", "glossary", "--lang", "de"]) == 0
    out = capsys.readouterr().out
    assert "Zahlsperre" in out
    for what in ("activities", "kpis", "label-packs"):
        assert main(["show", "o2c", what]) == 0


def test_match_ad_hoc_labels_json(capsys):
    assert (
        main(
            [
                "match",
                "p2p",
                "--label",
                "Goods receipt",
                "--label",
                "Wareneingang buchen",
                "--label",
                "Nothing like it at all",
                "--format",
                "json",
            ]
        )
        == 0
    )
    payload = json.loads(capsys.readouterr().out)
    rows = {r["label"]: r for r in payload["rows"]}
    assert rows["Goods receipt"]["canonical_id"] == "p2p.gr" and rows["Goods receipt"]["stage"] == "receive"
    assert rows["Wareneingang buchen"]["canonical_id"] == "p2p.gr"
    assert rows["Nothing like it at all"]["tier"] == "unmatched"


def test_match_csv_with_oracle(tmp_path, capsys):
    csv = tmp_path / "sales.csv"
    csv.write_text(
        "case_id,activity\n1,Create Order\n1,Create Order Item\n1,Goods issue\n2,Picking Completed\n", encoding="utf-8"
    )
    assert main(["match", "o2c", "--labels-from", str(csv), "--oracle-id", "hackathon_sales"]) == 0
    out = capsys.readouterr().out
    assert "o2c.goods_issue" in out and "top-1 4/4 = 100.0%" in out
    assert (
        main(["match", "o2c", "--labels-from", str(csv), "--column", "activity", "--format", "csv", "--no-label-packs"])
        == 0
    )
    out = capsys.readouterr().out
    assert out.startswith("label,events,canonical_id")


def test_match_key_components(tmp_path, capsys):
    csv = tmp_path / "ocel.csv"
    csv.write_text(
        "id,type,time,lifecycle\n1,Execute Payment,2024-01-01,complete\n2,Create Goods Receipt,2024-01-01,complete\n",
        encoding="utf-8",
    )
    assert (
        main(
            [
                "match",
                "p2p",
                "--labels-from",
                str(csv),
                "--column",
                "type",
                "--key",
                "lifecycle=lifecycle",
                "--oracle-id",
                "ocel2_p2p",
                "--format",
                "json",
            ]
        )
        == 0
    )
    payload = json.loads(capsys.readouterr().out)
    assert payload["evaluation"]["top1"] == 2 and payload["rows"][0]["label"].endswith("[complete]")


def test_graph_and_explain(tmp_path, capsys):
    assert main(["graph", "o2c", "--out", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "nodes" in out and (tmp_path / "o2c_nodes.csv").is_file()
    assert main(["explain", "p2p", "c_l2_df1_invoice_after_goods"]) == 0
    out = capsys.readouterr().out
    assert "p2p.fm.invoice_before_goods_receipt" in out and "candidate causes" in out
    assert main(["explain", "p2p", "does_not_exist"]) == 1


def test_missing_file_is_reported(capsys):
    assert main(["match", "p2p", "--labels-from", "/no/such/file.csv"]) == 2
