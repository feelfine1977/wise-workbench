"""Opt-in: the ICPM 2026 sales extract through the O2C preset, against the hackathon's own backlog (R2-04).

Set ``WISE_PRESET_DATA_DIRS`` (or leave the default) so that ``Sales_Eventlog.csv`` is found; the extract stays
local and is read in place. Takes a few minutes.

What the comparison can and cannot show. The reference file ``WISE_backlog_sales_by_customer.csv`` was produced
by the hackathon's own norm with the order quantity as volume and no shrinkage. The preset starts from the pack's
``o2c_baseline`` template, whose thresholds are placeholders (``metadata.meta.uncalibrated_parameters``) and 32 of
whose activities do not occur in this extract at all. The **population** must therefore agree exactly — the same
customers, the same items, the same exposure — and the **scores** must not, until the template is calibrated.
The test asserts the first and records the second.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from tests.conftest import make_settings
from wise_workbench.container import Container
from wise_workbench.jobs import Worker
from wise_workbench.jobs.handlers import load_preset
from wise_workbench.presets import all_presets
from wise_workbench.settings import load_settings

PRESET = "icpm2026_o2c"
REFERENCE = "WISE_backlog_sales_by_customer.csv"


def _paths() -> tuple[Path, Path] | None:
    settings = load_settings()
    presets = all_presets(settings)
    preset = presets.get(PRESET)
    if preset is None:
        return None
    csv_path, norm_path = load_preset.preset_paths(settings, preset)
    if not csv_path.exists() or not norm_path.exists():
        return None
    return csv_path, norm_path


PATHS = _paths()
pytestmark = pytest.mark.skipif(
    PATHS is None, reason="the ICPM 2026 sales extract or the o2c pack is not available on this machine"
)


@pytest.fixture(scope="module")
def loaded(tmp_path_factory: pytest.TempPathFactory) -> dict:
    c = Container(make_settings(tmp_path_factory.mktemp("o2c")))
    project = c.projects.create("O2C", process="o2c")
    job = c.presets.load(project.id, PRESET)
    Worker(c, worker_id="test").drain()
    job = c.repos.get_job(job.id)
    assert job.status.value == "done", job.error
    run_id = str(job.result_ref or "").split(":")[1]
    table = c.mappings.list_case_tables(project.id)[0]
    yield {"c": c, "project": project.id, "run": run_id, "table": table.id}
    c.close()


def test_the_preset_builds_the_extract_with_its_prepared_attributes(loaded: dict) -> None:
    c, pid, ct = loaded["c"], loaded["project"], loaded["table"]
    table = c.mappings.get_case_table(pid, ct)
    assert table.cases == 51_164, "sales order items of the extract"
    assert table.events == 267_071
    assert len(table.activities) == 16
    assert table.readiness is not None and table.readiness.case_noun == "sales order items"
    attributes = set(table.attributes)
    assert {"days_late", "order_month", "flow_type"} <= attributes, "the preset's prepared attributes"
    assert {"return_item", "confirmed_quantity", "order_quantity"} <= attributes, "the template's canonical names"
    flow_types = {i.id: i for i in table.readiness.items}["flow_types"].evidence["counts"]
    assert sum(flow_types.values()) == table.cases and "standard" in flow_types


def test_the_preset_translates_the_template_into_this_log_s_labels(loaded: dict) -> None:
    c, pid, run_id = loaded["c"], loaded["project"], loaded["run"]
    norm = c.repos.list_norm_versions(pid)[0]
    labels = {
        str(a)
        for constraint in norm.document["constraints"]
        for key in ("activity", "a", "b")
        for a in (constraint.get("params") or {}).get(key) or []
    }
    assert "Goods issue" in labels and "Create Delivery Item" in labels, "canonical ids replaced by log labels"
    assert norm.uncalibrated or norm.calibration == "uncalibrated"
    run = c.runs.get(pid, run_id)
    assert run.manifest is not None
    # the activities the extract does not carry are reported, not silently ignored
    assert any("never occurs in the log" in w for w in run.manifest.norm_warnings)


def test_the_customer_backlog_covers_the_hackathon_s_own_backlog(loaded: dict) -> None:
    c, pid, run_id = loaded["c"], loaded["project"], loaded["run"]
    assert PATHS is not None
    reference_path = PATHS[0].parent / REFERENCE
    if not reference_path.exists():
        pytest.skip("the hackathon's own backlog is not next to the extract")
    reference = {r["slice"]: r for r in csv.DictReader(reference_path.open())}
    page = c.runs.backlog(
        pid,
        run_id,
        slicing="Customer ID",
        view="Logistics",
        gamma=0.0,
        min_cases=1,
        sort="-PI",
        hotspot_type=None,
        layer=None,
        q=None,
        page=1,
        page_size=500,
        volume="exposure",
    )
    ours = {str(json.loads(r["key"])[0]).removesuffix(".0"): r for r in page["rows"]}
    common = sorted(set(reference) & set(ours))
    assert len(common) >= 68, f"only {len(common)} of the {len(reference)} customers of the reference are ours"
    # the population agrees: the same items and the same order quantity per customer, within the 153 items the
    # reference counts more overall (51,317 against the extract's own 51,164 sales order items)
    total_reference = sum(float(reference[c_]["n_cases"]) for c_ in reference)
    total_ours = sum(r["n_cases"] for r in page["rows"])
    assert abs(total_reference - total_ours) / total_reference < 0.005, (total_reference, total_ours)
    close = [
        c_
        for c_ in common
        if abs(float(reference[c_]["n_cases"]) - ours[c_]["n_cases"]) <= max(3, 0.02 * float(reference[c_]["n_cases"]))
    ]
    assert len(close) >= len(common) - 2, "item counts per customer must agree with the reference within 2 %"
    same_volume = [
        c_
        for c_ in common
        if ours[c_].get("volume") is not None
        and abs(float(reference[c_]["volume"]) - float(ours[c_]["volume"])) / max(float(reference[c_]["volume"]), 1)
        < 0.02
    ]
    assert len(same_volume) >= len(common) - 5, "the exposure per customer must agree with the reference"
    # the customers the reference has and we do not are tiny, and their items are in the (missing) group
    only_reference = sorted(set(reference) - set(ours))
    assert sum(float(reference[c_]["n_cases"]) for c_ in only_reference) <= 10
    # the scores differ, and that is the uncalibrated template, not a defect: record the size of the difference
    biggest = max(abs(float(reference[c_]["mean_score"]) - ours[c_]["mean_score"]) for c_ in common)
    assert biggest > 0.0, "the o2c_baseline template is not the hackathon's norm; calibration is cycle 3's next step"
