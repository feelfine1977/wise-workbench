"""Norm inspection and assessment share canonical attributes and applicability."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine import EngineAdapter
from wise_workbench.adapters.storage import Workspace
from wise_workbench.adapters.storage.parquet import write_frame
from wise_workbench.adapters.storage.selections import checksum, selection_path, source_identity
from wise_workbench.domain import ColumnMapping, FlowTypingRule, PreparedAttribute


@pytest.mark.parametrize("selected", [False, True], ids=["whole-table", "saved-cohort"])
def test_norm_inspection_restores_canonical_values_before_applicability(tmp_path: Path, selected: bool) -> None:
    ws = Workspace(tmp_path)
    directory = ws.case_table_dir("project", "table")
    mapping = ColumnMapping(
        id="mapping",
        dataset_id="dataset",
        case_id="case",
        activity="activity",
        timestamp="time",
        case_attributes=("source_group", "group", "amount", "canonical_amount", "flow_type"),
        prepared_attributes=(
            PreparedAttribute("group", "alias", {"from": "source_group"}),
            PreparedAttribute("canonical_amount", "alias", {"from": "amount"}),
        ),
        flow_typing=(FlowTypingRule("typed-A", {"attr": "group", "eq": "A"}),),
    )
    events = pd.DataFrame(
        [
            {
                "case": case,
                "activity": "Start",
                "time": pd.Timestamp("2026-01-01"),
                "source_group": group,
                "group": "raw-export",
                "amount": amount,
                "canonical_amount": 999,
                "flow_type": "raw-export",
            }
            for case, group, amount in (("one", "A", 10), ("two", "A", 20), ("outside", "B", 30))
        ]
    )
    write_frame(ws, directory / "events.parquet", events, index=False)
    engine = EngineAdapter(ws)
    assessment = engine._load_log(directory, mapping)
    assert assessment.cases["group"].to_dict() == {"one": "A", "two": "A", "outside": "B"}
    assert assessment.cases["flow_type"].to_dict() == {"one": "typed-A", "two": "typed-A", "outside": "other"}
    write_frame(ws, directory / "cases.parquet", assessment.cases)
    before_cases = assessment.cases.copy(deep=True)
    before_events = assessment.events.copy(deep=True)
    selection_id = None
    members = ["one", "outside"] if selected else list(assessment.case_ids)
    if selected:
        selection_id = "sel_12345678901234567"
        metadata = {
            "id": selection_id,
            "projectId": "project",
            "caseTableId": "table",
            "datasetId": "dataset",
            "cases": len(members),
            "semanticsVersion": "eda-v1",
            "membershipChecksum": checksum(members),
            "source": source_identity(directory, mapping, None),
        }
        record = {"metadata": metadata, "memberIds": members}
        ws.write_json(selection_path(directory, selection_id), {**record, "checksum": checksum(record)})
    before_files = {p: sha256(p.read_bytes()).hexdigest() for p in directory.rglob("*") if p.is_file()}
    norm = wise.Norm(
        constraints=(
            wise.NormConstraint(
                "amount",
                "quality",
                wise.Metric("canonical_amount", threshold=5, width=20),
                applicability={"attr": "flow_type", "eq": "typed-A"},
            ),
        ),
        layers=(wise.Layer("quality"),),
        views=(wise.View("Process", layer_weights={"quality": 1}),),
    )
    constraint = norm.get_constraint("amount")
    mask = constraint.applies_to(assessment.cases, assessment) & assessment.case_ids.isin(members)
    expected = 1 if selected else 2
    assert int(mask.sum()) == expected
    penalties = wise.evaluate_constraint(assessment, constraint)[mask]
    scoped_assessment = engine._scoped_log(directory, mapping, {"selection_id": selection_id} if selected else None)
    scoped_mask = constraint.applies_to(scoped_assessment.cases, scoped_assessment)
    assert int(scoped_mask.sum()) == expected
    pd.testing.assert_series_equal(wise.evaluate_constraint(scoped_assessment, constraint)[scoped_mask], penalties)
    document = norm.to_dict()
    proposed = deepcopy(document["constraints"][0])
    proposed["params"]["threshold"] = 12

    preview = engine.norm_preview(directory, mapping, document, "amount", proposed, selection_id=selection_id)
    signal = engine.norm_signals(directory, mapping, document, "amount", selection_id=selection_id)
    relevance = engine.norm_relevance(directory, mapping, document, selection_id=selection_id)
    for result in (preview["saved"], preview["proposed"]):
        counts = result["counts"]
        assert counts["populationCases"] == len(members)
        assert counts["applicableCases"] == counts["evaluatedCases"] == counts["observedCases"] == expected
        assert counts["unknownCases"] == counts["missingSignalCases"] == 0
    assert preview["saved"]["counts"]["meanPenalty"] == pytest.approx(float(penalties.mean()))
    assert preview["saved"]["counts"]["violatingCases"] == int((penalties > 0).sum())
    assert preview["proposed"]["counts"]["violatingCases"] == (0 if selected else 1)
    assert signal["casesInScope"] == signal["stats"]["nCases"] == signal["stats"]["n"] == expected
    assert signal["stats"]["mean"] == (10 if selected else 15)
    assert relevance["cases"] == len(members)
    assert relevance["constraints"][0]["casesInScope"] == expected
    assert relevance["constraints"][0]["issues"] == []
    pd.testing.assert_frame_equal(assessment.cases, before_cases)
    pd.testing.assert_frame_equal(assessment.events, before_events)
    assert {p: sha256(p.read_bytes()).hexdigest() for p in before_files} == before_files
