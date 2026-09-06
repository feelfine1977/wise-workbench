from __future__ import annotations

import shutil

import pytest
import yaml

from wise_knowledge import available_packs, knowledge_root, validate_datasets, validate_pack
from wise_knowledge.schema import SCHEMA_KINDS, read_yaml, validate_document, validator


def test_all_schemas_load():
    for kind in SCHEMA_KINDS:
        validator(kind)


@pytest.mark.parametrize("name", sorted(available_packs()))
def test_every_pack_validates(name):
    issues = [i for i in validate_pack(name) if i.level == "error"]
    assert issues == [], "\n".join(str(i) for i in issues)


def test_builtin_packs_present():
    assert {"p2p", "o2c"} <= set(available_packs())


def test_datasets_registry_validates():
    assert validate_datasets() == []


def test_dates_stay_strings():
    doc = read_yaml(knowledge_root() / "datasets.yaml")
    checked = next(d["checked"] for d in doc["datasets"] if d["id"] == "bpic2019")
    assert isinstance(checked["date"], str) and checked["date"] == "2026-09-05"


def test_schema_rejects_unknown_property():
    issues = validate_document("kpis", {"pack": "p2p", "version": 1, "review_status": "draft", "kpis": [], "extra": 1})
    assert any("extra" in i.message for i in issues)
    assert any("kpis" in i.path for i in issues)  # minItems


def test_cross_reference_checks(tmp_path):
    src = knowledge_root() / "p2p"
    dst = tmp_path / "p2p"
    shutil.copytree(src, dst)
    ont = read_yaml(dst / "ontology.yaml")
    ont["activities"][0]["stage"] = "no_such_stage"
    ont["label_packs"]["bpic2019"]["labels"][0]["activity"] = "p2p.no_such_activity"
    (dst / "ontology.yaml").write_text(yaml.safe_dump(ont, allow_unicode=True, sort_keys=False), encoding="utf-8")
    messages = [i.message for i in validate_pack(dst)]
    assert any("unknown stage 'no_such_stage'" in m for m in messages)
    assert any("unknown activity 'p2p.no_such_activity'" in m for m in messages)


def test_template_not_loadable_is_reported(tmp_path):
    pytest.importorskip("wise")
    src = knowledge_root() / "o2c"
    dst = tmp_path / "o2c"
    shutil.copytree(src, dst)
    (dst / "templates" / "o2c_baseline.json").write_text(
        '{"schema_version": 2, "name": "x", "constraints": [], "views": []}', encoding="utf-8"
    )
    messages = [i.message for i in validate_pack(dst)]
    assert any("does not load with wise" in m for m in messages)
