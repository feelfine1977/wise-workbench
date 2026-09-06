"""Shared fixtures: the paper's running example and synthetic logs with planted truth."""

from __future__ import annotations

import pytest
import wise
from hypothesis import settings

import wise_analytics as wa

# property tests are deterministic under their seeds; keep no example database next to the package
settings.register_profile("package", database=None, deadline=None)
settings.load_profile("package")

COVERAGE_HOTSPOTS = (
    {"where": {"company": "C2", "spend_area": "Packaging"}, "mechanism": "lag", "strength": 3.0},
    {"where": {"company": "C1", "spend_area": "IT"}, "mechanism": "lag", "strength": 2.0},
    {"where": {"company": "C3", "spend_area": "Logistics"}, "mechanism": "mismatch", "strength": 0.4},
    {"where": {"company": "C1", "spend_area": "Services"}, "mechanism": "missing_invoice", "strength": 0.15},
)


@pytest.fixture(scope="session")
def p2p_log():
    return wise.running_p2p_log()


@pytest.fixture(scope="session")
def p2p_norm():
    return wise.running_p2p_norm()


@pytest.fixture(scope="session")
def p2p_result(p2p_log, p2p_norm):
    return wise.score(p2p_log, p2p_norm)


@pytest.fixture(scope="session")
def synthetic_clean():
    """A clean synthetic log with the default hotspots, scored in ``flat`` mode."""
    log, truth = wa.generate(n_cases=2000, seed=1)
    return log, truth, wise.score(log, truth.norm)


@pytest.fixture(scope="session")
def synthetic_balanced():
    """The same log scored in ``layer_balanced`` mode."""
    log, truth = wa.generate(n_cases=2000, seed=1, scoring_mode="layer_balanced")
    return log, truth, wise.score(log, truth.norm)


@pytest.fixture(scope="session")
def synthetic_artefacts():
    log, truth = wa.generate(n_cases=2000, seed=1, artefacts=wa.synthetic.DEFAULT_ARTEFACTS)
    return log, truth, wise.score(log, truth.norm)
