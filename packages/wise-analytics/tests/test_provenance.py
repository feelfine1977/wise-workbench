"""Provenance records: deterministic hashes, frozen records, fingerprints."""

from __future__ import annotations

import dataclasses
import json

import numpy as np
import pandas as pd
import pytest
import wise

import wise_analytics as wa
from wise_analytics.provenance import canonical_json, hash_frame, log_fingerprint, record


def test_record_id_is_deterministic():
    df = pd.DataFrame({"a": [1.0, 2.0], "b": ["x", "y"]}, index=pd.Index(["s1", "s2"], name="slice"))
    r1 = record("demo", "1", table=df, params={"gamma": 2.0, "by": ["company"]}, log_fingerprint="L", norm_fingerprint="N")
    r2 = record(
        "demo",
        "1",
        table=df.copy(),
        params={"by": ["company"], "gamma": 2.0},
        log_fingerprint="L",
        norm_fingerprint="N",
        runtime_s=3.0,
    )
    assert r1.record_id == r2.record_id  # parameter order and runtime do not enter the id
    assert r1.output_hash == r2.output_hash
    r3 = record("demo", "1", table=df, params={"gamma": 3.0, "by": ["company"]}, log_fingerprint="L", norm_fingerprint="N")
    assert r3.record_id != r1.record_id
    r4 = record(
        "demo",
        "1",
        table=df.assign(a=[1.0, 2.5]),
        params={"gamma": 2.0, "by": ["company"]},
        log_fingerprint="L",
        norm_fingerprint="N",
    )
    assert r4.output_hash != r1.output_hash and r4.record_id != r1.record_id
    assert len(r1.record_id) == 64 and r1.cite().startswith("demo@1#")


def test_record_is_frozen_and_serialisable():
    df = pd.DataFrame({"a": [1.0]})
    r = record("demo", "1", table=df, params={"k": [5, 10]}, warnings=["w1"])
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.analytic = "other"  # type: ignore[misc]
    with pytest.raises(TypeError):
        r.params["k"] = 3  # type: ignore[index]
    d = json.loads(r.to_json())
    assert d["analytic"] == "demo" and d["params"] == {"k": [5, 10]} and d["warnings"] == ["w1"]
    assert d["wise_version"] == wise.__version__ and d["package_version"] == wa.__version__
    assert d["record_id"] == r.record_id


def test_hash_frame_handles_index_and_nan():
    a = pd.DataFrame({"x": [1.0, np.nan]}, index=pd.MultiIndex.from_tuples([("A", "p"), ("B", "q")], names=["company", "area"]))
    assert hash_frame(a) == hash_frame(a.copy())
    b = a.copy()
    b.index = pd.MultiIndex.from_tuples([("A", "p"), ("B", "r")], names=["company", "area"])
    assert hash_frame(a) != hash_frame(b)
    assert hash_frame(pd.DataFrame()) == hash_frame(pd.DataFrame())


def test_log_fingerprint_is_content_based(p2p_log):
    again = wise.running_p2p_log()
    assert log_fingerprint(p2p_log) == log_fingerprint(again)
    fewer = wise.EventLog(
        wise.running_p2p_events(), case_col="case", activity_col="activity", timestamp_col="time", case_attributes=["company"]
    )
    assert log_fingerprint(fewer) != log_fingerprint(p2p_log)
    ev = wise.running_p2p_events()
    ev.loc[ev.index[0], "activity"] = "Other"
    changed = wise.EventLog(
        ev, case_col="case", activity_col="activity", timestamp_col="time", case_attributes=["flow_type", "company", "vendor"]
    )
    assert log_fingerprint(changed) != log_fingerprint(p2p_log)


def test_canonical_json_sorts_and_converts():
    s = canonical_json({"b": np.float64(1.5), "a": (1, 2), "t": pd.Timestamp("2024-01-01"), "n": float("nan")})
    assert s == '{"a":[1,2],"b":1.5,"n":"nan","t":"2024-01-01 00:00:00"}'


def test_analytics_records_are_reproducible(p2p_result):
    u1 = wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=50, seed=3, min_support=2)
    u2 = wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=50, seed=3, min_support=2)
    assert u1.record.record_id == u2.record.record_id and u1.record.output_hash == u2.record.output_hash
    pd.testing.assert_frame_equal(u1.table, u2.table)
    u3 = wa.bootstrap_backlog(p2p_result, "company", "Finance", gamma=2.0, B=50, seed=4, min_support=2)
    assert u3.record.record_id != u1.record.record_id
    assert (
        u1.record.log_fingerprint == log_fingerprint(p2p_result.log)
        and u1.record.norm_fingerprint == p2p_result.norm.fingerprint()
    )
    for res in (
        wa.contrast_slice(p2p_result, "Finance", {"company": "B"}, B=20),
        wa.headroom(p2p_result, "Finance", {"company": "B"}),
        wa.whatif_weights(p2p_result, "Logistics", by="company", view="Finance"),
        wa.readiness(p2p_result.log, p2p_result.norm),
    ):
        assert res.record.record_id and res.table is not None and isinstance(dict(res.summary), dict) and res.readings
