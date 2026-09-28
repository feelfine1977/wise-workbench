"""Recipes remain reusable knowledge; measured findings live only in run evidence."""

from copy import deepcopy

import pytest
import yaml

from wise_knowledge import build_hub, render_page
from wise_knowledge.solution_cards import load_solution_cards, solution_card_for


def test_specificity_order_and_copy_isolation():
    rule = {"id": "c_l3_df2_rpb_to_clear_days", "type": "lag", "description": "Renamed by owner"}
    catalogue = load_solution_cards()
    card = solution_card_for("p2p", rule, catalogue=catalogue)
    assert card["id"] == "release-to-clearing"
    assert [b["kind"] for b in card["blocks"]] == [
        "activity_coverage",
        "endpoint_duration",
        "end_day_of_month",
        "due_date_lead",
    ]
    card["blocks"][0]["title"] = "changed"
    assert solution_card_for("p2p", rule, catalogue=catalogue)["blocks"][0]["title"] != "changed"
    assert solution_card_for("o2c", rule, catalogue=catalogue)["id"] == "elapsed-time"
    assert solution_card_for(None, rule, catalogue=catalogue)["hubNode"] is None
    assert solution_card_for("p2p", {"type": "custom"}, catalogue=catalogue) is None
    catalogue["cards"][0]["blocks"].reverse()
    assert solution_card_for("p2p", rule, catalogue=catalogue)["blocks"][0]["kind"] == "due_date_lead"


@pytest.mark.parametrize("fault", ["reference", "duplicate", "kind", "presentation", "temporal"])
def test_invalid_catalogues_are_rejected(tmp_path, fault):
    document = load_solution_cards()
    if fault == "reference":
        document["cards"][0]["blocks"].append("absent")
    elif fault == "duplicate":
        document["cards"].append(deepcopy(document["cards"][0]))
    elif fault == "kind":
        document["blocks"]["coverage"]["kind"] = "run-arbitrary-code"
    elif fault == "presentation":
        document["blocks"]["coverage"]["presentation"] = "day_bars"
    else:
        document["cards"][0]["match"]["types"] = ["presence"]
    path = tmp_path / "cards.yaml"
    path.write_text(yaml.safe_dump(document))
    with pytest.raises(ValueError):
        load_solution_cards(path)


def test_ambiguous_matches_refuse_to_choose():
    document = load_solution_cards()
    extra = deepcopy(document["cards"][0])
    extra["id"] = "ambiguous"
    document["cards"].append(extra)
    with pytest.raises(ValueError, match="Ambiguous"):
        solution_card_for("p2p", {"id": "c_l3_df2_rpb_to_clear_days", "type": "lag"}, catalogue=document)


@pytest.mark.parametrize("pack_name", ["p2p", "o2c"])
def test_process_cards_problems_and_expectations_link_both_ways(pack_name, request):
    pack = request.getfixturevalue(pack_name)
    hub = build_hub(pack)
    process = hub.page(f"process:{pack.id}")
    cards = process["related"]["solution_cards"]
    assert cards
    linked_problems = 0
    for brief in cards:
        page = hub.page(brief["id"])
        card = page["node"]["solution_card"]
        assert card["hubNode"] == brief["id"]
        assert page["related"]["process"]["id"] == f"process:{pack.id}"
        assert card["blocks"] and "selectedCases" not in card
        for expectation in page["related"]["expectations"]:
            assert brief["id"] in {x["id"] for x in hub.page(expectation["id"])["related"]["solution_cards"]}
        for problem in page["related"]["failure_modes"]:
            linked_problems += 1
            assert brief["id"] in {x["id"] for x in hub.page(problem["id"])["related"]["solution_cards"]}
    assert linked_problems > 0
    ids = {n["id"] for n in hub.nodes}
    assert all(e["from"] in ids and e["to"] in ids for e in hub.edges)


def test_release_card_explains_missing_due_date_without_a_finding(p2p):
    hub = build_hub(p2p)
    node_id = "solution_card:p2p:release-to-clearing"
    page = hub.page(node_id)
    assert page["related"]["expectations"]
    assert page["related"]["failure_modes"]
    rendered = render_page(hub, node_id)
    assert "no dataset findings" in rendered
    assert "validated item-to-invoice linkage" in rendered
    assert "payment due date" in rendered
    assert "Presentation: day_bars" in rendered


def test_optional_catalogue_absent_preserves_external_pack_compatibility(tmp_path):
    assert load_solution_cards(tmp_path / "absent.yaml")["cards"] == []
