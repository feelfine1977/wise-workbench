"""Domain invariants: state machines, hashes, readiness levels."""

from __future__ import annotations

from datetime import timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wise_workbench.domain import (
    InvalidTransitionError,
    Job,
    JobStatus,
    NormStatus,
    NormVersion,
    Project,
    Readiness,
    ReadinessItem,
    ReadinessLevel,
    ReadinessStatus,
    Run,
    RunParams,
    RunStatus,
    Slicing,
    ValidationError,
    slicing_id,
    utcnow,
)
from wise_workbench.domain.readings import backlog_reading


def params(**changes: object) -> RunParams:
    base = {
        "case_table_id": "ct",
        "norm_version_id": "nv",
        "views": ("Finance",),
        "slicings": (Slicing("company", ("company",)),),
        "gamma": 20.0,
        "min_cases": 5,
    }
    base.update(changes)
    return RunParams(**base)  # type: ignore[arg-type]


def test_project_needs_a_name() -> None:
    with pytest.raises(ValidationError):
        Project(id="p", name="  ")


def test_run_state_machine() -> None:
    run = Run(id="r", project_id="p", params=params())
    assert run.status == RunStatus.QUEUED
    running = run.transition(RunStatus.RUNNING)
    done = running.transition(RunStatus.DONE)
    assert done.is_final
    with pytest.raises(InvalidTransitionError):
        done.transition(RunStatus.RUNNING)
    with pytest.raises(InvalidTransitionError):
        run.transition(RunStatus.DONE)


def test_params_hash_ignores_note_and_order() -> None:
    a = params(note="one", slicings=(Slicing("a", ("x",)), Slicing("b", ("y",))))
    b = params(note="two", slicings=(Slicing("b", ("y",)), Slicing("a", ("x",))))
    assert a.params_hash() == b.params_hash()
    assert params(gamma=21.0).params_hash() != a.params_hash()


def test_params_validation() -> None:
    with pytest.raises(ValidationError):
        params(gamma=-1)
    with pytest.raises(ValidationError):
        params(min_cases=0)
    with pytest.raises(ValidationError):
        params(slicings=(Slicing("s", ("a",)), Slicing("s", ("b",))))
    with pytest.raises(ValidationError):
        Slicing("", ())


def test_slicing_id_and_round_trip() -> None:
    s = Slicing("", ("case Company", "case Spend area text"))
    assert s.id == slicing_id(s.attributes) == "case Company+case Spend area text"
    p = params()
    assert RunParams.from_dict(p.to_dict()) == p


def test_job_claim_and_lease() -> None:
    job = Job(id="j", kind="ingest", payload={})
    now = utcnow()
    claimed = job.claim("w1", timedelta(seconds=5), now)
    assert claimed.status == JobStatus.RUNNING and claimed.attempts == 1 and claimed.worker_id == "w1"
    assert not claimed.lease_expired(now)
    later = now + timedelta(seconds=6)
    assert claimed.lease_expired(later)
    reclaimed = claimed.claim("w2", timedelta(seconds=5), later)
    assert reclaimed.attempts == 2 and reclaimed.worker_id == "w2"
    with pytest.raises(InvalidTransitionError):
        claimed.claim("w3", timedelta(seconds=5), now)


def test_job_transitions_and_retry() -> None:
    job = Job(id="j", kind="ingest", payload={}, max_attempts=2).claim("w", timedelta(seconds=1))
    assert job.can_retry()
    requeued = job.transition(JobStatus.QUEUED)
    again = requeued.claim("w", timedelta(seconds=1))
    assert again.attempts == 2 and not again.can_retry()
    failed = again.transition(JobStatus.FAILED, error="boom")
    assert failed.is_final and failed.finished_at is not None
    with pytest.raises(InvalidTransitionError):
        failed.transition(JobStatus.DONE)


def test_norm_status_transitions() -> None:
    nv = NormVersion(
        id="n",
        project_id="p",
        norm_id="norm",
        version=1,
        fingerprint="f",
        document={"name": "x", "views": [{"name": "Finance"}]},
    )
    assert nv.view_names == ["Finance"]
    approved = nv.with_status(NormStatus.REVIEWED).with_status(NormStatus.APPROVED)
    with pytest.raises(InvalidTransitionError):
        approved.with_status(NormStatus.DRAFT)


def test_readiness_status_is_the_worst_level() -> None:
    items = (ReadinessItem("a", ReadinessLevel.INFO, "fine"), ReadinessItem("b", ReadinessLevel.WARN, "hmm"))
    assert Readiness(items).status == ReadinessStatus.WARN
    assert Readiness((*items, ReadinessItem("c", ReadinessLevel.FAIL, "no"))).status == ReadinessStatus.FAIL
    assert Readiness(()).status == ReadinessStatus.PASS
    assert Readiness.from_dict(Readiness(items).to_dict()) == Readiness(items)


@given(st.floats(min_value=0, max_value=1e6, allow_nan=False), st.integers(min_value=1, max_value=10**6))
def test_reading_sentence_vocabulary(pi: float, n: int) -> None:
    row = {
        "stable_PI": pi,
        "PI": pi,
        "n_cases": n,
        "stable_gap": 0.1,
        "gap": 0.1,
        "global_mean": 0.8,
        "hotspot_type": "reservoir",
        "dominant_layer": "L1",
    }
    text = backlog_reading(row, "Finance", 20.0, "slice")
    assert "priority" in text and "below expectation" in text and "widespread: many cases, slightly off" in text
    assert f"{n:,} cases" in text and "in the Finance perspective" in text
    for banned in ("root cause", "fault", "effect"):
        assert banned not in text.lower()
