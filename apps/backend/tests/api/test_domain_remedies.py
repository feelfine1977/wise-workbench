"""New cleanup decisions and evidence warnings preserve historical versions."""

import io
from copy import deepcopy

import pandas as pd
import pytest

from tests.api.test_norm_signals import create_table, norm_document, save_norm
from tests.conftest import wait_job


@pytest.mark.parametrize("custom_dedupe", [False, True], ids=["readiness-decision", "custom-mapping"])
def test_new_cleanup_has_exact_preview_and_keeps_parent_table(client, custom_dedupe):
    pid = client.post("/api/v1/projects", json={"name": "Distinct receipts"}).json()["id"]
    base = f"/api/v1/projects/{pid}"
    rows = pd.DataFrame(
        [
            {"case": "one", "activity": "Receipt", "time": "2019-01-01", "id": "A", "amount": 40},
            {"case": "one", "activity": "Receipt", "time": "2019-01-01", "id": "B", "amount": 60},
            {"case": "one", "activity": "Receipt", "time": "2019-01-01", "id": "A", "amount": 40},
        ]
    )
    upload = client.post(
        base + "/datasets", files={"file": ("receipts.csv", io.BytesIO(rows.to_csv(index=False).encode()), "text/csv")}
    )
    job = wait_job(client, upload.json()["id"])
    assert job["status"] == "done"
    ds = job["resultRef"].split(":", 1)[1]
    assert client.put(base + "/dataset-binding", json={"datasetId": ds}).status_code == 200
    mapped = client.post(
        base + f"/datasets/{ds}/mappings",
        json={"caseId": "case", "activity": "activity", "timestamp": "time", "eventId": "id", "dedupe": custom_dedupe},
    )
    job = wait_job(client, mapped.json()["id"])
    assert job["status"] == "done"
    original_id = job["resultRef"].split(":", 1)[1]
    original = client.get(base + f"/case-tables/{original_id}").json()
    if custom_dedupe:
        from wise_workbench.adapters.storage.parquet import read_frame

        c = client.app.state.container
        saved = c.repos.get_mapping(original["mappingId"])
        assert saved.decisions[-1]["policy"] == "identical_prepared_rows_v1"
        assert saved.decisions[-1]["legacyKeyDedupeInherited"] is False
        assert original["events"] == 2
        events = read_frame(c.workspace.case_table_dir(pid, original_id) / "events.parquet")
        assert events["id"].tolist() == ["A", "B"] and events["amount"].tolist() == ["40", "60"]
        assert len(c.engine.read_events(c.workspace.dataset_dir(pid, ds), saved)) == 3
        return
    url = base + f"/case-tables/{original_id}/decisions"
    preview = client.post(url + "/preview", json={"kind": "collapse_duplicates"}).json()
    assert preview["preview"]["events"] == 1
    assert preview["preview"]["detail"]["policy"] == "identical_prepared_rows_v1"
    response = client.post(url, json={"kind": "collapse_duplicates", "note": "Remove identical prepared rows"})
    assert response.status_code == 202, response.text
    outcome = response.json()
    job = wait_job(client, outcome["job"]["id"])
    assert job["status"] == "done", job
    child = client.get(base + "/case-tables/" + outcome["caseTable"]["id"]).json()
    assert child["id"] != original_id and child["events"] == 2 and original["events"] == 3
    assert client.get(base + f"/case-tables/{original_id}").json() == original
    items = {x["id"]: x for x in child["readiness"]["items"]}
    assert "duplicate_events" not in items and items["event_key_collisions"]["decision"] is None


def test_unsupported_evidence_advisory_does_not_block_draft_save(client):
    pid = client.post("/api/v1/projects", json={"name": "Advisory evidence"}).json()["id"]
    base = f"/api/v1/projects/{pid}"
    table = create_table(client, pid)
    document = norm_document()
    document["constraints"][0]["params"].update(
        a=["Vendor creates invoice", "Record Invoice Receipt"], b=["Clear Invoice"], missing_b="skip"
    )
    original = deepcopy(document)
    parent = save_norm(client, base, document)
    checked = client.post(base + f"/norms/{parent['id']}/check", json={"caseTableId": table})
    assert checked.status_code == 200, checked.text
    warnings = checked.json()["warnings"]
    assert any("does not measure contractual lateness" in str(x) for x in warnings)
    refreshed = client.get(base + f"/norms/{parent['id']}", params={"caseTableId": table}).json()
    assert any("evidence-coverage warning" in x for x in refreshed["warnings"])
    document["constraints"][0]["params"]["delta"] = 45
    child = save_norm(client, base, document, parentId=parent["id"])
    assert child["id"] != parent["id"]
    assert client.get(base + f"/norms/{parent['id']}").json()["norm"]["constraints"] == original["constraints"]


def test_gate_presentation_retains_fingerprint_measurements_and_saved_waivers(client, monkeypatch):
    from tests.api.test_filtered_action_evidence import gates, waive
    from tests.conftest import run_running_example, upload_running_example
    from wise_workbench.application.services import review

    ids = upload_running_example(client)
    world = {"client": client, "ids": ids, "run": run_running_example(client, ids)}
    with monkeypatch.context() as patch:
        patch.setattr(review, "_gate_display_text", lambda gate, noun: str(gate.get("text") or ""))
        waive(world)
        legacy = gates(world)
    current = gates(world)
    assert current["selection"] == legacy["selection"]
    assert current["blocking"] == legacy["blocking"] == []
    assert current["passed"] == legacy["passed"]
    for old, new in zip(legacy["gates"], current["gates"], strict=True):
        assert {k: v for k, v in old.items() if k != "text"} == {k: v for k, v in new.items() if k != "text"}
    by_kind = {g["kind"]: g for g in current["gates"]}
    assert "recent-unclosed diagnostic" in by_kind["censoring"]["text"]
    assert "event-concentration diagnostic" in by_kind["replication"]["text"]
    assert all(g["status"] == "waived" for g in current["gates"])
