"""Cycle 4 through the API on the synthetic P2P log (``wise_analytics.generate``, planted artefacts).

Covers the six P1 items of the cycle 4 backend brief:

* **R3-07** the four-tile budget — the tiles answer from the run's own artefacts, agree with the backlog to the
  last digit, and a repeated call is served from the memo;
* **R3-04, R3-14** truthfulness — every comparison bracket is the difference of the two numbers beside it, and an
  expectation whose shortfall counts missing events carries its own sentence and never leads a card unflagged;
* **R3-03** the group-aware readiness gate — computed from the group's own shares, with the run-wide summary
  beside it, and blocking only the groups that fail it;
* **R3-27, R1-11** what-if against a frozen baseline — the transform layer, the norm layer, the change table and
  its provenance, and the ``domain`` gate;
* **R3-15** exposure and the flow-type rules — the ranking in force with the one it offers instead, and the flow
  types the rules name that the log does not carry;
* **R3-02** the norm builder's server side — applicability options from the flow types, a required rationale per
  threshold, and expectations marked not applicable with a note.
"""

from __future__ import annotations

import io
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
import wise_analytics as wa
from fastapi.testclient import TestClient

from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app
from wise_workbench.domain.comparison import bracket_check, bracket_is_difference

MAPPING = {
    "caseId": "case",
    "activity": "activity",
    "timestamp": "time",
    "caseAttributes": ["company", "spend_area", "vendor", "document", "flow_type"],
    "exposure": "net_worth",
    "headerEvents": ["Create Purchase Order Item"],
    "closureActivities": ["Clear Invoice"],
    "flowTyping": [
        {"name": "with GR", "rule": {"has": ["Record Goods Receipt"]}},
        {"name": "consignment", "rule": {"kind": "attribute", "field": "spend_area", "in": ["Consignment"]}},
    ],
    "flowTypingNotes": [
        {
            "name": "make to order",
            "reason": "missing_column",
            "needs": ["planning_type"],
            "text": "The flow type 'make to order' is not assigned on this log: its rule reads planning_type, which the file does not carry.",
        }
    ],
    "flowTypeDefault": "no GR",
}
SLICINGS = [{"attributes": ["company", "spend_area"]}]


def _wait_analytics(client: TestClient, pid: str, run_id: str, timeout: float = 180.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = client.get(f"/api/v1/projects/{pid}/runs/{run_id}/analytics").json()
        if st["status"] == "done":
            return st
        time.sleep(0.1)
    raise AssertionError("analytics did not finish")


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Any]]:
    slog, truth = wa.generate("p2p", n_cases=600, seed=7, artefacts=wa.synthetic.DEFAULT_ARTEFACTS)
    settings = make_settings(tmp_path_factory.mktemp("cycle4"), inprocess_worker=True)
    app = create_app(settings)
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Cycle 4", "process": "p2p"}).json()["id"]
        csv = slog.events.to_csv(index=False).encode()
        job = client.post(
            f"/api/v1/projects/{pid}/datasets", files={"file": ("synthetic.csv", io.BytesIO(csv), "text/csv")}
        ).json()
        assert wait_job(client, job["id"])["status"] == "done"
        dataset = job["resultRef"].split(":")[1]
        r = client.post(f"/api/v1/projects/{pid}/datasets/{dataset}/mappings", json=MAPPING)
        assert r.status_code == 202, r.text
        ct = wait_job(client, r.json()["id"])["resultRef"].split(":")[1]
        norm = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": truth.norm.to_dict(), "note": "synthetic"})
        assert norm.status_code == 201, norm.text
        body = {"caseTableId": ct, "normVersionId": norm.json()["id"], "slicings": SLICINGS, "gamma": 2, "minCases": 5}
        run = client.post(f"/api/v1/projects/{pid}/runs", json=body).json()
        assert wait_job(client, run["jobId"], timeout=180)["status"] == "done"
        analytics = _wait_analytics(client, pid, run["id"])
        yield {
            "client": client,
            "settings": settings,
            "pid": pid,
            "dataset": dataset,
            "ct": ct,
            "norm": norm.json(),
            "run": run,
            "cases": 600,
            "analytics": analytics,
        }


def _get(w: dict[str, Any], path: str, **params: Any) -> dict[str, Any]:
    r = w["client"].get(f"/api/v1/projects/{w['pid']}/runs/{w['run']['id']}/{path}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- R3-07 the four-tile budget
def test_the_tiles_answer_from_the_run_artefacts_and_agree_with_the_backlog(world: dict[str, Any]) -> None:
    cold = time.perf_counter()
    kpis = _get(world, "kpis", view="Finance", minCases=5)
    first = time.perf_counter() - cold
    warm = time.perf_counter()
    again = _get(world, "kpis", view="Finance", minCases=5)
    second = time.perf_counter() - warm
    assert kpis == again, "the same request answers with the same numbers"
    assert second < first or second < 0.1, "a repeated call is served from the memo"
    assert kpis["params"]["priority_source"] == "run artefact", "an unfiltered board reads the run's own backlog"

    backlog = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=200)
    assert kpis["groups"] == backlog["total"]
    assert abs(kpis["priorityAtStake"] - sum(r["stable_PI"] for r in backlog["rows"])) < 1e-6
    assert kpis["cases"] == kpis["casesTotal"] == world["cases"]

    tiles = {t["id"]: t for t in kpis["tiles"]}
    assert set(tiles) >= {"items", "share_below_expectation", "priority_at_stake", "open_share"}
    assert all(t["text"] for t in kpis["tiles"])

    # a filtered call answers for the cases the filter keeps, and the four tiles say the same number
    f = json.dumps({"and": [{"kind": "activity", "op": "contains", "activity": "Record Goods Receipt"}]})
    filtered = _get(world, "kpis", view="Finance", filter=f, minCases=1)
    preview = _get(world, "filters/preview", filter=f)
    assert filtered["cases"] == preview["cases_in"] and filtered["params"]["priority_source"] == "selection"


def test_the_score_tile_brackets_the_difference_it_prints(world: dict[str, Any]) -> None:
    """R3-04 on the board: the tile prints the group's score and the run's, so the bracket is their difference."""
    row = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=1)["rows"][0]
    kpis = _get(world, "kpis", view="Finance", slicing="company,spend_area", key=row["key"], minCases=1)
    tile = next(t for t in kpis["tiles"] if t["id"] == "mean_score")
    numbers = [float(x) for x in tile["text"].replace("(", " ").replace(")", " ").split() if _is_number(x)]
    here, elsewhere, bracket = numbers[0], numbers[1], numbers[2]
    assert abs((here - elsewhere) - bracket) <= 0.05


def _is_number(token: str) -> bool:
    try:
        float(token)
    except ValueError:
        return False
    return True


# ---------------------------------------------------------------- R3-04 one comparison, one bracket
def test_every_comparison_bracket_is_the_difference_of_the_two_numbers_it_prints(world: dict[str, Any]) -> None:
    seen = 0
    for view in ("Finance", "Logistics"):
        page = _get(world, "backlog", slicing="company,spend_area", view=view, minCases=1, pageSize=200)
        for row in page["rows"]:
            text = row.get("comparison")
            if not text:
                assert row.get("comparison_reason"), "a row carries a sentence or the reason there is none"
                continue
            verdict = bracket_is_difference(text)
            if verdict is None:
                continue
            seen += 1
            assert verdict, f"bracket is not the difference of the two numbers it prints: {text}"
    assert seen, "the run produced at least one comparison sentence"


def test_a_run_scored_before_the_rule_never_serves_a_sentence_that_breaks_it(world: dict[str, Any]) -> None:
    """R3-04 on a **pre-existing** run: the rule holds over every sentence the run serves, not only a fresh one.

    The comparison sentences are rendered by the analytics job and kept on disk, so the release that fixed the
    bracket left every run scored before it serving *83 days here against 55 elsewhere (+25 days)* — the
    package's shift estimate — and only the card masked it. The stored artefacts are rewritten here into that
    older form, the run is then read by a **new** service on the same workspace (its caches empty, as after a
    restart), and no sentence it serves may break the rule.
    """
    settings = world["settings"]
    stored = sorted(Path(settings.workspace).glob("projects/*/runs/*/analytics/comparisons/*.parquet"))
    assert stored, "the analytics job stored the comparison sentences"

    def unrule(text: Any) -> Any:
        """The same sentence with the bracket the older rendering printed: a number that is not the difference."""
        if not isinstance(text, str):
            return text
        parsed = bracket_check(text)
        if parsed is None:
            return text
        here, there, _bracket = parsed
        start = text.rfind("(")
        end = text.rfind(")")
        unit = text[start + 1 : end].split(" ", 1)[1] if " " in text[start + 1 : end] else ""
        return f"{text[: start + 1]}{here - there + 7:+.0f} {unit}".strip() + text[end:]

    planted = 0
    for path in stored:
        table = pd.read_parquet(path)
        if "comparison" not in table.columns:
            continue
        before = list(table["comparison"])
        table["comparison"] = [unrule(v) for v in before]
        planted += sum(1 for a, b in zip(before, table["comparison"]) if a != b)
        table.to_parquet(path, index=True)
    assert planted, "the run holds comparison sentences to plant an older bracket in"

    with TestClient(create_app(settings)) as fresh:
        seen = 0
        for view in ("Finance", "Logistics"):
            r = fresh.get(
                f"/api/v1/projects/{world['pid']}/runs/{world['run']['id']}/backlog",
                params={"slicing": "company,spend_area", "view": view, "minCases": 1, "pageSize": 200},
            )
            assert r.status_code == 200, r.text
            for row in r.json()["rows"]:
                for field in ("comparison", "reading_plain", "reading"):
                    verdict = bracket_is_difference(row.get(field))
                    if verdict is None:
                        continue
                    seen += 1
                    assert verdict, (
                        f"the pre-existing run serves a sentence that breaks the rule in {field}: {row[field]}"
                    )
        assert seen > 5, "the pre-existing run serves comparison sentences to check"


def test_the_card_says_which_expectation_is_which(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=1, pageSize=200)
    for row in page["rows"]:
        top, compared = row.get("top_constraint"), row.get("comparison_constraint")
        if top and compared and top != compared:
            note = row.get("expectation_note")
            assert note and "largest share of the shortfall" in note
            return
    assert all("expectation_note" in r for r in page["rows"])


def test_the_hypothesis_reading_brackets_points_and_the_medians_get_their_own_sentence(
    world: dict[str, Any],
) -> None:
    row = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=1)["rows"][0]
    out = _get(world, "what-can-we-do", slicing="company,spend_area", key=row["key"], view="Finance")
    for driver in out["drivers"]:
        if driver.get("comparison"):
            assert bracket_is_difference(driver["comparison"]) is not False
            assert "points)" in driver["comparison"], "the shares are compared in percentage points"
        if driver.get("median_comparison"):
            assert bracket_is_difference(driver["median_comparison"]) is not False


# ---------------------------------------------------------------- R3-14 an expectation that measures logging
LOGGING_NORM = {
    "schema_version": 2,
    "name": "Delivery lag on a log that rarely records the delivery",
    "layers": [{"id": "delivery", "name": "Delivery"}],
    "views": [{"name": "Delivery", "constraint_weights": {"picked_to_issue": 1.0}}],
    "constraints": [
        {
            "id": "picked_to_issue",
            "layer": "delivery",
            "type": "lag",
            "params": {
                "a": ["Picking Completed"],
                "b": ["Goods issue"],
                "delta": 1.0,
                "width": 3.0,
                "unit": "D",
                "missing_a": "violate",
                "missing_b": "violate",
            },
            "weight": 1.0,
            "description": "Picked goods leave promptly",
        }
    ],
}


def _logging_csv(n_cases: int = 60, with_issue: int = 6) -> bytes:
    """A log where every item is picked and only a few have a goods issue: the lag is measurable on those."""
    rows = ["case,activity,time,region"]
    for i in range(n_cases):
        region = "north" if i % 2 else "south"
        day = 1 + (i % 20)
        rows.append(f"item{i:03d},Picking Completed,2026-01-{day:02d} 08:00:00,{region}")
        if i < with_issue:
            rows.append(f"item{i:03d},Goods issue,2026-01-{day:02d} 09:00:00,{region}")
    return ("\n".join(rows) + "\n").encode()


@pytest.fixture(scope="module")
def logging_world(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Any]]:
    """A run whose only expectation counts a missing partner event rather than a measured lag."""
    app = create_app(make_settings(tmp_path_factory.mktemp("cycle4-logging"), inprocess_worker=True))
    with TestClient(app) as client:
        pid = client.post("/api/v1/projects", json={"name": "Logging", "process": "o2c"}).json()["id"]
        job = client.post(
            f"/api/v1/projects/{pid}/datasets",
            files={"file": ("logging.csv", io.BytesIO(_logging_csv()), "text/csv")},
        ).json()
        assert wait_job(client, job["id"])["status"] == "done"
        dataset = job["resultRef"].split(":")[1]
        r = client.post(
            f"/api/v1/projects/{pid}/datasets/{dataset}/mappings",
            json={"caseId": "case", "activity": "activity", "timestamp": "time", "caseAttributes": ["region"]},
        )
        assert r.status_code == 202, r.text
        ct = wait_job(client, r.json()["id"])["resultRef"].split(":")[1]
        norm = client.post(f"/api/v1/projects/{pid}/norms", json={"norm": LOGGING_NORM, "note": "one lag"})
        assert norm.status_code == 201, norm.text
        run = client.post(
            f"/api/v1/projects/{pid}/runs",
            json={
                "caseTableId": ct,
                "normVersionId": norm.json()["id"],
                "slicings": [{"attributes": ["region"]}],
                "gamma": 0,
                "minCases": 1,
            },
        ).json()
        assert wait_job(client, run["jobId"], timeout=120)["status"] == "done"
        yield {"client": client, "pid": pid, "run": run}


def test_an_expectation_whose_misses_are_missing_events_says_so(logging_world: dict[str, Any]) -> None:
    c, pid, rid = logging_world["client"], logging_world["pid"], logging_world["run"]["id"]
    manifest = c.get(f"/api/v1/projects/{pid}/runs/{rid}/manifest").json()
    flags = {row["id"]: row for row in manifest["uncalibrated"]}
    assert "picked_to_issue" in flags, "the expectation is flagged, not printed as a difference between groups"
    row = flags["picked_to_issue"]
    assert row["reason"] == "missing_partner" and row["measures_logging"] is True
    assert "the pair of events is missing" in row["text"]
    assert row["applies_to"] == 60 and row["measured"] == 6 and row["violated_without_value"] == 54

    page = c.get(
        f"/api/v1/projects/{pid}/runs/{rid}/backlog",
        params={"slicing": "region", "view": "Delivery", "minCases": 1, "pageSize": 10},
    ).json()
    assert page["rows"], "the run has a backlog"
    for card in page["rows"]:
        assert card["top_constraint"] == "picked_to_issue"
        assert card["top_constraint_measures_logging"] is True
        assert card["top_constraint_flag"] and "pair of events is missing" in card["top_constraint_flag"]


def test_the_flag_vocabulary_and_its_shape(world: dict[str, Any]) -> None:
    manifest = _get(world, "manifest")
    for row in manifest["uncalibrated"]:
        assert row["text"] and row["reason"] in {
            "almost_always_missed",
            "almost_never_missed",
            "declared",
            "partly_measured",
            "missing_partner",
        }
        assert row["measures_logging"] == (row["reason"] in ("partly_measured", "missing_partner"))
    logging_flagged = {r["id"] for r in manifest["uncalibrated"] if r["measures_logging"]}
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=1, pageSize=200)
    for card in page["rows"]:
        if card.get("top_constraint") in logging_flagged:
            assert card["top_constraint_measures_logging"] is True
            assert card["top_constraint_flag"], "a card that leads with it carries the sentence"


# ---------------------------------------------------------------- R3-03 the group-aware readiness gate
def test_the_readiness_gate_is_read_from_the_group_and_stated_once_at_the_run(world: dict[str, Any]) -> None:
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=200)
    statuses, run_wide = {}, None
    for row in page["rows"][:8]:
        gates = _get(world, "gates", slicing="company,spend_area", key=row["key"], view="Finance")
        by_id = {g["id"]: g for g in gates["gates"]}
        assert set(by_id) == {"readiness", "censoring", "replication", "domain"}
        readiness = by_id["readiness"]
        statuses[row["key"]] = readiness["computed_status"]
        own = readiness["evidence"]["groupChecks"]
        if own:
            worst = (
                "fail"
                if any(c["status"] == "fail" for c in own)
                else ("warn" if any(c["status"] == "warn" for c in own) else "pass")
            )
            assert readiness["computed_status"] == {"fail": "failed", "warn": "pending", "pass": "passed"}[worst], (
                "the gate is the worst of the checks this group has a share of, not the log's own verdict"
            )
            assert readiness["scope"] == "group"
        else:
            assert readiness["scope"] == "run"
        assert by_id["readiness"]["evidence"]["runStatus"], "the run's own reading stays beside the group's"
        run_wide = gates["runWide"]
        assert run_wide["text"]
        assert by_id["readiness"]["scope"] in ("run", "group")
        assert set(by_id["readiness"]["evidence"]) >= {"runStatus", "runFailed", "logWideFailed", "groupChecks"}
    assert run_wide is not None
    assert statuses, "the gate answers for every group"


def test_a_hypothesis_is_blocked_only_by_a_gate_its_own_group_fails(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    page = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=200)
    clean = None
    for row in page["rows"]:
        gates = _get(world, "gates", slicing="company,spend_area", key=row["key"], view="Finance")
        if not gates["blocking"]:
            clean = row
            break
    if clean is None:
        pytest.skip("every group of this synthetic log fails a gate of its own")
    body = {
        "runId": rid,
        "slicing": "company,spend_area",
        "sliceKey": clean["key"],
        "view": "Finance",
        "constraint_id": clean.get("top_constraint") or "c1",
        "expected_direction": "higher",
        "author": "analyst",
    }
    created = c.post(f"/api/v1/projects/{pid}/hypotheses", json=body)
    assert created.status_code == 201, created.text


def test_the_domain_gate_is_computed(world: dict[str, Any]) -> None:
    """R3-27: the fourth gate of the vocabulary answers instead of standing empty."""
    row = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=1)["rows"][0]
    gates = _get(world, "gates", slicing="company,spend_area", key=row["key"], view="Finance")
    domain = next(g for g in gates["gates"] if g["id"] == "domain")
    assert domain["status"] in ("passed", "pending", "failed", "waived")
    assert domain["text"] and "drivers" in domain["evidence"]


# ---------------------------------------------------------------- R3-15 exposure and the flow-type rules
def test_the_run_states_the_ranking_in_force_and_the_one_it_offers_instead(world: dict[str, Any]) -> None:
    rows = {r["label"]: r for r in _get(world, "manifest")["plain"]}
    ranked = rows["Ranked by"]
    assert ranked["value"] and ranked["options"] and len(ranked["options"]) == 2
    in_force = [o for o in ranked["options"] if o["inForce"]]
    assert len(in_force) == 1 and in_force[0]["id"] == "cases"
    by_cases = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=5)
    by_quantity = _get(
        world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=5, volume="exposure"
    )
    assert by_cases["rows"] and by_quantity["rows"], "both weightings answer on the same run"


def test_a_flow_type_the_log_cannot_carry_is_named_with_its_reason(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    types = c.get(f"/api/v1/projects/{pid}/case-tables/{world['ct']}/flow-types").json()
    present = {t["name"] for t in types["types"]}
    absent = {a["name"]: a for a in types["absent"]}
    assert present == {"with GR", "no GR"}
    assert "make to order" in absent and absent["make to order"]["reason"] == "missing_column"
    assert "planning_type" in (absent["make to order"]["text"] or "")
    assert "consignment" in absent and absent["consignment"]["reason"] == "matches_nothing"


# ---------------------------------------------------------------- R3-02 the norm builder's server side
def test_applicability_options_come_from_the_log(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    out = c.get(f"/api/v1/projects/{pid}/norms/applicability", params={"caseTableId": world["ct"]}).json()
    assert out["flowTypeAttribute"] == "flow_type"
    assert {t["value"] for t in out["flowTypes"]} == {"with GR", "no GR"}
    assert all(t["cases"] > 0 for t in out["flowTypes"])
    assert {a["name"] for a in out["flowTypesAbsent"]} >= {"make to order"}
    assert {k["id"] for k in out["kinds"]} == {"flow_type", "attribute", "always", "not_applicable"}
    assert out["attributes"], "the attribute values of the case table are offered as well"


def test_a_threshold_needs_a_rationale_and_an_owner_before_the_version_leaves_draft(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    parent = world["norm"]
    document = json.loads(json.dumps(parent["norm"]))
    target = next((cnt for cnt in document["constraints"] if "delta" in (cnt.get("params") or {})), None)
    assert target is not None, "the synthetic norm carries at least one threshold"
    target["params"]["delta"] = float(target["params"]["delta"] or 0) + 7
    created = c.post(
        f"/api/v1/projects/{pid}/norms",
        json={"norm": document, "note": "a threshold moved", "parentId": parent["id"], "author": "SD expert"},
    )
    assert created.status_code == 201, created.text
    version = created.json()
    calibration = c.get(f"/api/v1/projects/{pid}/norms/{version['id']}/calibration").json()
    assert target["id"] in calibration["missingRationale"] and calibration["canLeaveDraft"] is False
    refused = c.patch(
        f"/api/v1/projects/{pid}/norms/{version['id']}", json={"status": "reviewed", "author": "SD expert"}
    )
    assert refused.status_code == 422 and refused.json()["code"] == "norm.rationale_required"

    signed = c.post(
        f"/api/v1/projects/{pid}/norms",
        json={
            "norm": document,
            "note": "a threshold moved, with its reason",
            "parentId": parent["id"],
            "author": "SD expert",
            "calibration": {target["id"]: {"rationale": "the contract allows a week longer", "owner": "order desk"}},
        },
    ).json()
    state = c.get(f"/api/v1/projects/{pid}/norms/{signed['id']}/calibration").json()
    assert state["missingRationale"] == [] and state["canLeaveDraft"] is True
    row = next(r for r in state["thresholds"] if r["constraint_id"] == target["id"])
    assert row["changedHere"] and row["rationale"] and row["owner"] == "order desk"
    moved = c.patch(f"/api/v1/projects/{pid}/norms/{signed['id']}", json={"status": "reviewed", "author": "SD expert"})
    assert moved.status_code == 200 and moved.json()["status"] == "reviewed"


def test_an_expectation_can_be_marked_not_applicable_with_a_note(world: dict[str, Any]) -> None:
    c, pid = world["client"], world["pid"]
    parent = world["norm"]
    document = json.loads(json.dumps(parent["norm"]))
    dropped = str(document["constraints"][0]["id"])
    without_note = c.post(
        f"/api/v1/projects/{pid}/norms",
        json={
            "norm": document,
            "note": "drop one",
            "parentId": parent["id"],
            "notApplicable": {dropped: {"note": "   "}},
        },
    )
    assert without_note.status_code == 422 and without_note.json()["code"] == "norm.not_applicable_note"
    created = c.post(
        f"/api/v1/projects/{pid}/norms",
        json={
            "norm": document,
            "note": "drop one",
            "parentId": parent["id"],
            "author": "SD expert",
            "notApplicable": {dropped: {"note": "this log has no such event, so the expectation cannot be judged"}},
        },
    )
    assert created.status_code == 201, created.text
    version = created.json()
    assert dropped not in {cnt["id"] for cnt in version["norm"]["constraints"]}
    state = c.get(f"/api/v1/projects/{pid}/norms/{version['id']}/calibration").json()
    entry = next(e for e in state["notApplicable"] if e["constraint_id"] == dropped)
    assert entry["note"] and entry["author"] == "SD expert"


# ---------------------------------------------------------------- R3-27 what-if against a frozen baseline
def test_a_scenario_runs_against_the_frozen_baseline_and_reports_what_changed(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    preview = c.post(
        f"/api/v1/projects/{pid}/runs/{rid}/whatif/preview",
        json={"transforms": [{"kind": "keep_first", "activity": "Record Goods Receipt"}]},
    )
    assert preview.status_code == 200, preview.text
    record = preview.json()["transforms"][0]
    assert record["kind"] == "keep_first" and record["eventsRemoved"] >= 0

    empty = c.post(f"/api/v1/projects/{pid}/runs/{rid}/whatif", json={"name": "nothing"})
    assert empty.status_code == 422 and empty.json()["code"] == "whatif.empty"

    job = c.post(
        f"/api/v1/projects/{pid}/runs/{rid}/whatif",
        json={
            "name": "goods receipts are posted once",
            "note": "one receipt per item instead of many",
            "transforms": [{"kind": "keep_first", "activity": "Record Goods Receipt"}],
            "author": "process owner",
        },
    )
    assert job.status_code == 202, job.text
    done = wait_job(c, job.json()["id"], timeout=300)
    assert done["status"] == "done", done.get("error")
    scenario_id = done["resultRef"].split(":")[1]

    listed = c.get(f"/api/v1/projects/{pid}/scenarios", params={"baselineRunId": rid}).json()
    assert [s["runId"] for s in listed] == [scenario_id]
    assert listed[0]["name"] == "goods receipts are posted once"

    table = c.get(f"/api/v1/projects/{pid}/runs/{scenario_id}/whatif").json()
    assert table["baselineRunId"] == rid and table["rows"]
    assert table["summary"]["text"] and table["summary"]["groupsCompared"] > 0
    assert table["provenance"]["frozen"] is True
    assert table["provenance"]["baseline"]["runId"] == rid
    assert table["provenance"]["scenario"]["normFingerprint"]
    for row in table["rows"]:
        if row["state"] == "changed":
            assert row["baseline"] and row["scenario"]
            assert (
                abs((row["scenario"]["mean_score"] - row["baseline"]["mean_score"]) * 100 - row["deltaMeanPoints"])
                < 1e-3
            )

    # the baseline is untouched: it still answers with its own numbers
    before = _get(world, "backlog", slicing="company,spend_area", view="Finance", minCases=5, pageSize=5)
    assert before["rows"][0]["stable_PI"] == pytest.approx(table["rows"][0]["baseline"]["stable_PI"], rel=1e-6) or any(
        r["key"] == before["rows"][0]["key"] for r in table["rows"]
    )


def test_a_scenario_that_changes_a_threshold_makes_its_own_norm_version(world: dict[str, Any]) -> None:
    c, pid, rid = world["client"], world["pid"], world["run"]["id"]
    document = world["norm"]["norm"]
    target = next(cnt for cnt in document["constraints"] if "delta" in (cnt.get("params") or {}))
    job = c.post(
        f"/api/v1/projects/{pid}/runs/{rid}/whatif",
        json={
            "name": "a longer threshold for one expectation",
            "norm": {"constraints": [{"id": target["id"], "delta": float(target["params"]["delta"] or 0) + 30}]},
            "author": "SD expert",
        },
    )
    assert job.status_code == 202, job.text
    done = wait_job(c, job.json()["id"], timeout=300)
    assert done["status"] == "done", done.get("error")
    scenario_id = done["resultRef"].split(":")[1]
    table = c.get(f"/api/v1/projects/{pid}/runs/{scenario_id}/whatif").json()
    assert table["normChanges"] and target["id"] in table["normChanges"][0]
    assert table["provenance"]["scenario"]["normFingerprint"] != table["provenance"]["baseline"]["normFingerprint"], (
        "a scenario that changes the norm is scored under a norm version of its own"
    )
    assert table["summary"]["rankAgreement"] is None or -1.0 <= table["summary"]["rankAgreement"] <= 1.0

    unknown = c.post(
        f"/api/v1/projects/{pid}/runs/{rid}/whatif",
        json={"name": "unknown expectation", "norm": {"constraints": [{"id": "no_such_expectation", "delta": 1}]}},
    )
    assert wait_job(c, unknown.json()["id"], timeout=120)["status"] == "failed"
