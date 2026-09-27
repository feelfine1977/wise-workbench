"""Relevance measures applicability and distinct observed cases without scoring."""

from copy import deepcopy
from pathlib import Path

import pandas as pd
import pytest
import wise

from wise_workbench.adapters.engine import EngineAdapter
from wise_workbench.adapters.engine.norms import NormInspector
from wise_workbench.adapters.storage import Workspace
from wise_workbench.domain import ColumnMapping, ValidationError


def event_log() -> wise.EventLog:
    rows = []
    for case, group, activities in (
        ("one", "X", ["A", "A", "B", "C"]),
        ("two", "X", ["B"]),
        ("three", "Y", ["C"]),
        ("four", "X", ["Z"]),
    ):
        for i, activity in enumerate(activities):
            rows.append(
                {
                    "case": case,
                    "activity": activity,
                    "time": pd.Timestamp("2026-01-01") + pd.Timedelta(i, unit="h"),
                    "group": group,
                }
            )
    return wise.EventLog(
        pd.DataFrame(rows), case_col="case", activity_col="activity", timestamp_col="time", case_attributes=["group"]
    )


def document(*constraints: wise.NormConstraint, derived: tuple = ()) -> dict:
    return wise.Norm(
        constraints=constraints,
        layers=(wise.Layer("test"),),
        views=(wise.View("Process", layer_weights={"test": 1}),),
        derived_attributes=derived,
    ).to_dict()


def inspector(log: wise.EventLog) -> NormInspector:
    mapping = ColumnMapping(
        id="m", dataset_id="d", case_id="case", activity="activity", timestamp="time", case_attributes=("group",)
    )
    return NormInspector(lambda: log, mapping)


def no_scoring(*args: object, **kwargs: object) -> None:
    pytest.fail("relevance must never evaluate violations")


def test_distinct_any_activity_counts_and_real_scope_without_scoring(monkeypatch: pytest.MonkeyPatch) -> None:
    log = event_log()
    spec = document(
        wise.NormConstraint(
            "union", "test", wise.Lag(["A", "Missing"], "B", delta=0), applicability={"attr": "group", "eq": "X"}
        ),
        wise.NormConstraint("same", "test", wise.Lag("A", ["B", "Missing"], delta=500)),
        wise.NormConstraint("has", "test", wise.Presence("A"), applicability={"has": "B"}),
        wise.NormConstraint(
            "composite",
            "test",
            wise.Lag("A", "B"),
            applicability={"all": [{"attr": "group", "eq": "X"}, {"not": {"has": "C"}}]},
        ),
        wise.NormConstraint(
            "any", "test", wise.Presence("C"), applicability={"any": [{"attr": "group", "eq": "Y"}, {"has": "A"}]}
        ),
        wise.NormConstraint("metric", "test", wise.Metric("not_measured", threshold=0), applicability={"lacks": "A"}),
        wise.NormConstraint("absent", "test", wise.Presence("raw missing label")),
    )
    before = deepcopy(spec)
    monkeypatch.setattr(wise, "evaluate_constraint", no_scoring)
    original_groupby = pd.DataFrame.groupby
    scans = []

    def count_groupby(self: pd.DataFrame, *args: object, **kwargs: object):
        scans.append(args)
        return original_groupby(self, *args, **kwargs)

    monkeypatch.setattr(pd.DataFrame, "groupby", count_groupby)
    result = inspector(log).relevance(spec)
    rows = {r["id"]: r for r in result["constraints"]}
    assert result["cases"] == 4
    assert (rows["union"]["casesInScope"], rows["union"]["observedCases"]) == (3, 2)
    assert rows["union"]["missingActivities"] == ["Missing"]
    assert rows["same"]["observedCases"] == 2
    assert (rows["has"]["casesInScope"], rows["has"]["observedCases"]) == (2, 1)
    assert (rows["composite"]["casesInScope"], rows["composite"]["observedCases"]) == (2, 1)
    assert (rows["any"]["casesInScope"], rows["any"]["observedCases"]) == (2, 2)
    assert rows["metric"]["casesInScope"] == 3 and rows["metric"]["observedCases"] is None
    assert rows["metric"]["missingActivities"] == []
    assert rows["absent"]["observedCases"] == 0 and rows["absent"]["missingActivities"] == ["raw missing label"]
    assert len(scans) == 1  # shared activity index, not one event-table scan per constraint
    assert all(not row["issues"] for row in rows.values())
    assert spec == before


def test_individual_scope_errors_stay_unknown_and_do_not_hide_healthy_rows() -> None:
    spec = document(
        wise.NormConstraint(
            "unknown", "test", wise.Presence("Missing"), applicability={"attr": "absent_attribute", "eq": "X"}
        ),
        wise.NormConstraint(
            "bad_type", "test", wise.Presence("A"), applicability={"attr": "group", "gt": {"bad": "value"}}
        ),
        wise.NormConstraint("empty", "test", wise.Presence("A"), applicability={"attr": "group", "eq": "not present"}),
        wise.NormConstraint("healthy", "test", wise.Presence("B")),
    )
    rows = {r["id"]: r for r in inspector(event_log()).relevance(spec)["constraints"]}
    for key in ("unknown", "bad_type"):
        assert rows[key]["casesInScope"] is rows[key]["observedCases"] is None
        assert rows[key]["issues"] and "applicability" in rows[key]["issues"][0]
    assert rows["unknown"]["missingActivities"] == ["Missing"]
    assert rows["empty"]["casesInScope"] == rows["empty"]["observedCases"] == 0
    assert rows["empty"]["missingActivities"] == []  # globally present, even though scope is empty
    assert rows["healthy"]["casesInScope"] == 4 and rows["healthy"]["observedCases"] == 2


def test_derived_scope_is_evaluated_and_failed_recipes_do_not_prevent_other_derivations() -> None:
    spec = document(
        wise.NormConstraint("derived", "test", wise.Presence("B"), applicability={"attr": "a_count", "gt": 0}),
        wise.NormConstraint("failed", "test", wise.Presence("A"), applicability={"attr": "bad_sum", "gt": 0}),
        derived=(
            {"name": "bad_sum", "kind": "agg", "column": "absent", "agg": "sum"},
            {"name": "a_count", "kind": "count", "activities": ["A"]},
        ),
    )
    rows = {r["id"]: r for r in inspector(event_log()).relevance(spec)["constraints"]}
    assert (rows["derived"]["casesInScope"], rows["derived"]["observedCases"]) == (1, 1)
    assert rows["failed"]["casesInScope"] is rows["failed"]["observedCases"] is None
    assert any("bad_sum" in issue for issue in rows["failed"]["issues"])


def test_empty_table_reports_no_positive_coverage() -> None:
    empty = pd.DataFrame(
        {"case": pd.Series(dtype=str), "activity": pd.Series(dtype=str), "time": pd.Series(dtype="datetime64[ns]")}
    )
    log = wise.EventLog(empty, case_col="case", activity_col="activity", timestamp_col="time")
    spec = document(
        wise.NormConstraint("present", "test", wise.Presence("A")),
        wise.NormConstraint("metric", "test", wise.Metric("amount", threshold=1)),
    )
    result = inspector(log).relevance(spec)
    assert result["cases"] == 0
    assert result["constraints"][0] == {
        "id": "present",
        "casesInScope": 0,
        "observedCases": 0,
        "missingActivities": ["A"],
        "issues": [],
    }
    assert result["constraints"][1]["casesInScope"] == 0 and result["constraints"][1]["observedCases"] is None


def test_invalid_norm_is_refused_before_loading_artefacts(tmp_path: Path) -> None:
    engine = EngineAdapter(Workspace(tmp_path))
    mapping = ColumnMapping(id="m", dataset_id="d", case_id="case", activity="activity", timestamp="time")
    spec = document(wise.NormConstraint("x", "test", wise.Presence("A")))
    spec["constraints"][0]["type"] = "not-a-rule"
    with pytest.raises(ValidationError) as caught:
        engine.norm_relevance(tmp_path / "absent", mapping, spec)
    assert caught.value.code == "norm.invalid"


def test_failed_derived_replacement_cannot_fall_back_to_same_named_source_values() -> None:
    log = event_log()
    log.add_case_attribute("derived", pd.Series(1, index=log.case_ids))
    spec = document(
        wise.NormConstraint("scope", "test", wise.Presence("B"), applicability={"attr": "derived", "gt": 0}),
        derived=({"name": "derived", "kind": "agg", "column": "absent", "agg": "sum"},),
    )
    row = inspector(log).relevance(spec)["constraints"][0]
    assert row["casesInScope"] is row["observedCases"] is None
    assert row["issues"]
