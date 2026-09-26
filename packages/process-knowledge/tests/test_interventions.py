from __future__ import annotations

import copy
import shutil

import pytest
import yaml

from wise_knowledge import Intervention, load_pack, validate_pack
from wise_knowledge.schema import validate_document


def _document(pack):
    """Synthetic entries using only the public pack's identifiers."""
    entry = {
        "id": "p2p.iv.example",
        "version": 1,
        "name": {"en": "Synthetic example"},
        "mechanism": "Test-only mechanism; no measured business effect.",
        "addresses": {"layers": [pack.layers[0].id], "failure_modes": [pack.failure_modes[0].id]},
        "feasibility_constraints": {},
        "effort_class": "S",
        "expected_effect": {
            "kpi": pack.kpis[0].id,
            "direction": "down",
            "magnitude": "Not measured",
            "evidence_class": "descriptive",
        },
        "reversibility": "easy",
        "owner_role": pack.slicing.roles[0].id,
        "pilot_template": "Synthetic test cohort",
        "monitoring_kpis": [pack.kpis[0].id],
        "sources": ["Synthetic test fixture"],
        "review_status": "draft",
    }
    pilot = copy.deepcopy(entry)
    pilot["id"] = "p2p.iv.pilot_example"
    pilot["status"] = "piloting"
    pilot["expected_effect"]["evidence_class"] = "matched"
    return {"pack": "p2p", "version": 1, "review_status": "draft", "interventions": [entry, pilot]}


@pytest.fixture
def example_pack(tmp_path):
    public_pack = load_pack("p2p")
    destination = tmp_path / "p2p"
    shutil.copytree(public_pack.path, destination)
    (destination / "interventions.yaml").write_text(yaml.safe_dump(_document(public_pack)), encoding="utf-8")
    return load_pack(destination)


def test_pack_validates_with_interventions(example_pack):
    assert [i for i in validate_pack(example_pack.path) if i.level == "error"] == []
    assert len(example_pack.interventions) == 2
    assert all(isinstance(i, Intervention) for i in example_pack.interventions)


def test_interventions_cross_reference_the_pack(example_pack):
    layers = {layer.id for layer in example_pack.layers}
    failure_modes = {f.id for f in example_pack.failure_modes}
    roles = {r.id for r in example_pack.slicing.roles}
    kpis = {k.id for k in example_pack.kpis}
    for intervention in example_pack.interventions:
        assert set(intervention.layers) <= layers and set(intervention.failure_modes) <= failure_modes
        assert intervention.owner_role in roles and intervention.expected_effect["kpi"] in kpis
        assert set(intervention.monitoring_kpis) <= kpis


def test_interventions_for_layer_and_evidence_gate(example_pack):
    layer = example_pack.layers[0].id
    selected = example_pack.interventions_for(layer=layer)
    assert len(selected) == 2 and all(layer in i.layers for i in selected)
    assert example_pack.interventions_for(layer="not_a_layer") == ()
    piloted = [i for i in selected if i.status == "piloting"]
    assert len(piloted) == 1 and piloted[0].causal_language_allowed
    assert not next(i for i in selected if i.evidence_class == "descriptive").causal_language_allowed


def test_schema_rejects_bad_evidence_class():
    doc = _document(load_pack("p2p"))
    doc["interventions"][0]["expected_effect"]["evidence_class"] = "proven"
    assert any("evidence_class" in i.path for i in validate_document("interventions", doc))
