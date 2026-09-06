"""Every reading uses the descriptive vocabulary."""

from __future__ import annotations

import pytest

import wise_analytics as wa
from wise_analytics.vocabulary import check_reading, forbidden_terms


def test_forbidden_terms_match_words_only():
    assert forbidden_terms("the effective weights carry the gap") == []
    assert forbidden_terms("Vendor X causes delays because of faults") == [
        "causes",
        "because",
        "faults",
    ] or "causes" in forbidden_terms("Vendor X causes delays because of faults")
    assert forbidden_terms("this is the root cause") == ["root cause"]
    with pytest.raises(ValueError):
        check_reading("the slice will improve")
    check_reading("the gap coincides with a longer lag; headroom under the norm is 0.1")


def test_all_readings_are_descriptive(p2p_result, synthetic_artefacts):
    log, truth, result = synthetic_artefacts
    results = [
        wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=50, min_support=2),
        wa.bootstrap_backlog(result, ["company", "spend_area"], "Finance", gamma=20.0, B=50, cluster="document"),
        wa.sensitivity_envelope(result, ["company", "spend_area"], "Finance", gamma=20.0, k=5),
        wa.contrast_slice(p2p_result, "Finance", {"company": "B"}, B=50),
        wa.contrast_slice(result, "Finance", dict(truth.hotspots[0].where), B=50),
        wa.headroom(p2p_result, "Finance", {"company": "B"}, gamma=2.0),
        wa.headroom(result, "Logistics", dict(truth.hotspots[2].where), gamma=20.0),
        wa.whatif_weights(result, "Logistics", by="vendor", view="Finance", gamma=20.0),
        wa.readiness(
            log, truth.norm, result=result, by=["company", "spend_area"], view="Finance", gamma=20.0, closure="Clear Invoice"
        ),
        wa.readiness(p2p_result.log, p2p_result.norm),
        wa.subgroups(
            result, dict(truth.hotspots[0].where), ["vendor", "flow_type"], view="Finance", period="Q", closure="Clear Invoice"
        ),
        wa.subgroups(p2p_result, {"company": "B"}, ["vendor"], view="Finance"),
    ]
    for res in results:
        assert len(res.readings) >= 1
        for sentence in res.readings:
            check_reading(sentence)
        assert res.record.record_id and res.table is not None
    q = wa.readiness(
        log, truth.norm, result=result, by=["company", "spend_area"], view="Finance", gamma=20.0, closure="Clear Invoice"
    )
    for c in wa.caveats_for_slice(q, dict(truth.hotspots[0].where)):
        check_reading(c.text)
    for text in q.slices["reading"]:
        check_reading(text)
    contrast = wa.contrast_slice(result, "Finance", dict(truth.hotspots[0].where), B=0)
    check_reading(wa.comparison_sentence(contrast, top=3))
    for kind in ("acute", "systematic", "widespread", "none"):
        check_reading(wa.kind_reading(kind))
    check_reading(wa.points_below(0.64, 0.71))
    check_reading(wa.KIND_RULE)
