"""Small synthetic P2P/O2C journeys using only public HTTP endpoints.

The callable journey also seeds an isolated HTTP server for manual browser review.
It never reads or modifies an existing project.
"""

from __future__ import annotations

import csv
import io
import json
from copy import deepcopy
from typing import Any
from urllib.parse import quote, urlencode

import httpx
import pytest
import wise
from fastapi.testclient import TestClient

from tests.api.test_presets import small_bpic_csv
from tests.conftest import make_settings, wait_job
from wise_workbench.api.app import create_app
from wise_workbench.presets import BPIC19_MAPPING

Client = TestClient | httpx.Client


def journey_fixture(process: str) -> dict[str, Any]:
    """Reuse the ten-item public test fixture; O2C is an explicitly synthetic adaptation."""
    rows = list(csv.DictReader(io.StringIO(small_bpic_csv().decode())))
    cases = list(dict.fromkeys(row["case concept:name"] for row in rows))
    for row in rows:
        if row["case concept:name"] == cases[2]:
            row["case Vendor"] = ""  # One missing context value, retained across every event of the item.
        if row["event concept:name"] == "Change Price":
            row["event time:timestamp"] = ""  # One recorded event without a clock.
    if process == "p2p":
        mapping = deepcopy(BPIC19_MAPPING)
        acts = ("Record Invoice Receipt", "Clear Invoice", "Record Goods Receipt", "Cancel Invoice Receipt")
        attribute, selected_value = "case Company", "companyID_0000"
        grouping = "case Spend area text"
    elif process == "o2c":
        labels = {
            "Create Purchase Order Item": "Create Order Item",
            "Record Goods Receipt": "Goods issue",
            "Record Invoice Receipt": "Create Invoice",
            "Clear Invoice": "Receive Payment",
            "Cancel Invoice Receipt": "Cancel Invoice",
            "Remove Payment Block": "Release Credit Block",
            "Change Price": "Change Price",
        }
        rows = [
            {
                "case": row["case concept:name"].replace("4507", "SO"),
                "activity": labels[row["event concept:name"]],
                "time": row["event time:timestamp"],
                "region": "North" if row["case Company"] == "companyID_0000" else "South",
                "customer": row["case Vendor"].replace("vendorID", "customer"),
                "segment": row["case Spend area text"],
                "amount": row["event Cumulative net worth (EUR)"],
                "resource": row["event org:resource"],
            }
            for row in rows
        ]
        mapping = {
            "caseId": "case",
            "activity": "activity",
            "timestamp": "time",
            "timestampFormat": "%d-%m-%Y %H:%M:%S.%f",
            "dayfirst": True,
            "caseAttributes": ["region", "customer", "segment"],
            "exposure": "amount",
            "resource": "resource",
            "closureActivities": ["Receive Payment"],
            "flowTyping": [{"name": "correction", "rule": {"has": ["Cancel Invoice"]}}],
            "flowTypeDefault": "standard",
        }
        acts = ("Create Invoice", "Receive Payment", "Goods issue", "Cancel Invoice")
        attribute, selected_value, grouping = "region", "North", "segment"
    else:
        raise ValueError(process)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    invoice, payment, delivery, cancellation = acts
    norm = wise.Norm(
        name=f"Synthetic {process.upper()} review expectations",
        description="Ten-item verification example. Thresholds are illustrative, not a business recommendation.",
        constraints=(
            wise.NormConstraint(
                "invoice_present", "completeness", wise.Presence(invoice), description="Invoice recorded"
            ),
            wise.NormConstraint(
                "payment_present", "completeness", wise.Presence(payment), description="Payment recorded"
            ),
            wise.NormConstraint(
                "payment_days",
                "timeliness",
                wise.Lag(invoice, payment, delta=30, width=30),
                description="Invoice to payment within 30 days",
            ),
            wise.NormConstraint(
                "delivery_repeat",
                "handling",
                wise.Singularity(delivery, k=1, K=2),
                description="Repeated delivery events",
            ),
            wise.NormConstraint(
                "cancellation", "handling", wise.Exclusion(cancellation), description="Invoice corrections"
            ),
        ),
        layers=(
            wise.Layer("completeness", "Milestone coverage"),
            wise.Layer("timeliness", "Payment timing"),
            wise.Layer("handling", "Repeated work"),
        ),
        views=(
            wise.View("Finance", layer_weights={"completeness": 0.4, "timeliness": 0.5, "handling": 0.1}),
            wise.View("Operations", layer_weights={"completeness": 0.3, "timeliness": 0.2, "handling": 0.5}),
        ),
    ).to_dict()
    return {
        "csv": output.getvalue().encode(),
        "mapping": mapping,
        "norm": norm,
        "attribute": attribute,
        "value": selected_value,
        "grouping": grouping,
        "cases": 10,
        "events": len(rows),
        "cohortCases": 6,
    }


def checked(response: httpx.Response, expected: int = 200) -> Any:
    assert response.status_code == expected, response.text
    return response.json()


def completed(client: Client, response: httpx.Response) -> dict[str, Any]:
    queued = checked(response, 202)
    job = wait_job(client, queued["id"], timeout=120)
    assert job["status"] == "done", job
    return job


def seed_journey(client: Client, process: str) -> dict[str, Any]:
    """Import → bind → map → cohort → norm preview → assessment → evidence → proposal."""
    fixture = journey_fixture(process)
    project = checked(
        client.post(
            "/api/v1/projects",
            json={
                "name": f"Synthetic {process.upper()} — 10-item journey",
                "process": process,
                "question": "Verification fixture only: inspect missing clocks, context, repeated events and payment delays.",
            },
        ),
        201,
    )
    pid = project["id"]
    base = f"/api/v1/projects/{pid}"
    job = completed(
        client,
        client.post(
            base + "/datasets",
            files={
                "file": (f"synthetic-{process}-10-items.csv", fixture["csv"], "text/csv"),
            },
            data={"name": f"Synthetic {process.upper()} mini fixture (not the public benchmark)"},
        ),
    )
    dataset = job["resultRef"].split(":", 1)[1]
    checked(client.put(base + "/dataset-binding", json={"datasetId": dataset}))
    job = completed(client, client.post(base + f"/datasets/{dataset}/mappings", json=fixture["mapping"]))
    table = job["resultRef"].split(":", 1)[1]
    table_url = base + f"/case-tables/{table}"
    mapped = checked(client.get(table_url))
    assert mapped["cases"] == fixture["cases"] and mapped["events"] == fixture["events"]
    recipe = {
        "facets": [{"field": fixture["attribute"], "values": [fixture["value"]]}],
        "timeRanges": [{"from": "2018-01-01", "before": "2018-02-01"}],
    }
    selected = checked(
        client.post(
            table_url + "/eda/query",
            json={
                "datasetId": dataset,
                "attribute": fixture["attribute"],
                "selection": json.dumps(recipe),
                "pageSize": 100,
            },
        )
    )
    assert selected["summary"]["cases"] == {"total": 10, "selected": 6}
    assert len(selected["details"]["rows"]) == fixture["cohortCases"]
    cohort = checked(
        client.post(
            table_url + "/selections",
            json={
                "datasetId": dataset,
                "attribute": fixture["attribute"],
                "selection": recipe,
                "name": f"{fixture['value']} · January starts (synthetic)",
            },
        ),
        201,
    )
    scope = {"caseTableId": table, "selectionId": cohort["id"]}
    cards = checked(client.get(table_url + "/flow-types", params={"selectionId": cohort["id"]}))
    assert cards["cases"] == sum(row["cases"] for row in cards["types"]) == 6
    norm = checked(client.post(base + "/norms", json={"norm": fixture["norm"], "note": "Synthetic starting norm"}), 201)
    proposed = deepcopy(next(rule for rule in fixture["norm"]["constraints"] if rule["id"] == "payment_days"))
    proposed["params"]["delta"] = 8
    preview = checked(
        client.post(base + f"/norms/{norm['id']}/preview/payment_days", json={**scope, "constraint": proposed})
    )
    assert preview["scope"]["membershipChecksum"] == cohort["membershipChecksum"]
    assert preview["proposed"]["counts"]["populationCases"] == 6
    assert preview["proposed"]["counts"]["missingSignalCases"] == 1
    assert preview["proposed"]["counts"]["violatingCases"] > preview["saved"]["counts"]["violatingCases"]
    assert checked(client.get(base + f"/norms/{norm['id']}")) == norm
    assert checked(client.get(base + "/runs")) == []
    calibrated = deepcopy(fixture["norm"])
    calibrated["constraints"] = [
        proposed if rule["id"] == "payment_days" else rule for rule in calibrated["constraints"]
    ]
    revision = checked(
        client.post(
            base + "/norms",
            json={"norm": calibrated, "parentId": norm["id"], "note": "Synthetic 8-day threshold preview saved"},
        ),
        201,
    )
    run = checked(
        client.post(
            base + "/runs",
            json={
                "caseTableId": table,
                "normVersionId": revision["id"],
                "scope": {"selection_id": cohort["id"]},
                "slicings": [
                    {"attributes": [fixture["grouping"]]},
                    {"attributes": [fixture["attribute"], fixture["grouping"]]},
                ],
                "gamma": 0,
                "minCases": 1,
                "note": "Synthetic fixture: small groups, not statistical evidence for a business decision.",
            },
        ),
        202,
    )
    job = wait_job(client, run["jobId"], timeout=120)
    assert job["status"] == "done", job
    run_url = base + f"/runs/{run['id']}"
    assert checked(client.get(run_url + "/summary"))["cases"] == 6
    signal = checked(client.get(run_url + "/signals/payment_days"))
    assert signal["stats"]["shareViolated"] == pytest.approx(preview["proposed"]["counts"]["violationShare"])
    assert signal["casesInScope"] == 6 and signal["stats"]["n"] == 5
    params = {"slicing": fixture["grouping"], "view": "Finance", "minCases": 1}
    ranking = checked(client.get(run_url + "/backlog", params=params))
    assert ranking["params"]["cases"] == sum(row["n_cases"] for row in ranking["rows"]) == 6
    row = ranking["rows"][0]
    evidence_filter = {"and": [{"kind": "activity", "op": "contains", "activity": proposed["params"]["a"][0]}]}
    evidence_params = {"slicing": fixture["grouping"], "view": "Finance", "filter": json.dumps(evidence_filter)}
    detail = checked(client.get(run_url + "/slices/" + quote(row["key"], safe=""), params=evidence_params))
    assert detail["row"]["n_cases"] == row["n_cases"]
    gates = checked(client.get(run_url + "/gates", params={**evidence_params, "key": row["key"]}))
    assert gates["cases"] == row["n_cases"]
    action = checked(
        client.post(
            base + "/actions",
            json={
                "title": "Synthetic review: inspect payment delay and missing closure",
                "owner_role": "Fixture reviewer",
                "runId": run["id"],
                "slicing": fixture["grouping"],
                "sliceKey": row["key"],
                "view": "Finance",
                "filter": evidence_filter,
                "note": "Proposal only. No review gates have been waived and no business intervention is authorised.",
            },
        ),
        201,
    )
    context = action["evidenceContext"]
    assert context["populationCases"] == row["n_cases"] and context["normVersionId"] == revision["id"]
    assert context["selectionFingerprint"] == gates["selection"]["fingerprint"]
    assert next(item for item in checked(client.get(base + "/actions")) if item["id"] == action["id"]) == action
    assert checked(client.get(base + "/dataset-binding"))["datasetId"] == dataset
    return {
        "process": process,
        "synthetic": True,
        "project": pid,
        "dataset": dataset,
        "caseTable": table,
        "selection": cohort["id"],
        "membershipChecksum": cohort["membershipChecksum"],
        "norm": revision["id"],
        "originalNorm": norm["id"],
        "run": run["id"],
        "action": action["id"],
        "cases": fixture["cases"],
        "events": fixture["events"],
        "cohortCases": fixture["cohortCases"],
        "preview": preview,
        "slicing": fixture["grouping"],
        "sliceKey": row["key"],
        "urls": {
            "explore": f"/p/{pid}/data/{dataset}?" + urlencode({"caseTable": table, "tab": "overview"}),
            "define": f"/p/{pid}/norms/{revision['id']}?"
            + urlencode({"caseTable": table, "selection": cohort["id"], "tab": "map", "constraint": "payment_days"}),
            "improve": f"/p/{pid}/runs/{run['id']}/backlog?" + urlencode(params),
            "flow": f"/p/{pid}/runs/{run['id']}/flow?" + urlencode({"view": "Finance"}),
            "actions": f"/p/{pid}/runs/{run['id']}/slices/{quote(row['key'], safe='')}/act?"
            + urlencode(evidence_params),
        },
    }


@pytest.mark.parametrize("process", ["p2p", "o2c"])
def test_public_multi_dataset_journey(tmp_path, process):
    settings = make_settings(tmp_path, inprocess_worker=True, analytics_auto=False)
    with TestClient(create_app(settings)) as client:
        seeded = seed_journey(client, process)
        assert len(checked(client.get("/api/v1/projects"))) == 1
        # Reopening the app preserves the binding, frozen cohort, run and proposal.
    with TestClient(create_app(settings.model_copy(update={"inprocess_worker": False}))) as fresh:
        base = f"/api/v1/projects/{seeded['project']}"
        assert checked(fresh.get(base + "/dataset-binding"))["datasetId"] == seeded["dataset"]
        cohort = checked(fresh.get(base + f"/case-tables/{seeded['caseTable']}/selections/{seeded['selection']}"))
        assert cohort["membershipChecksum"] == seeded["membershipChecksum"]
        assert checked(fresh.get(base + f"/runs/{seeded['run']}/summary"))["cases"] == 6
        assert any(item["id"] == seeded["action"] for item in checked(fresh.get(base + "/actions")))
