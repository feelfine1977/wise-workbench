from __future__ import annotations

import os
from pathlib import Path

import pytest

from wise_knowledge import load_pack

# Missing inputs remain explicit opt-ins; synthetic tests need no local datasets.
_UNCONFIGURED = Path(__file__).parent / "unconfigured-inputs"
BPIC2019_CSV = Path(os.environ.get("WISE_BPIC19_CSV", str(_UNCONFIGURED / "bpic19.csv"))).expanduser()
HACKATHON_DIR = Path(os.environ.get("WISE_HACKATHON_DIR", str(_UNCONFIGURED))).expanduser()
OCEL_P2P_EVENTS = Path(os.environ.get("WISE_OCEL2_P2P_EVENTS", str(_UNCONFIGURED / "ocel.csv"))).expanduser()
WISE_LIB_NORM = Path(os.environ.get("WISE_LIB_BPIC19_NORM", str(_UNCONFIGURED / "norm.json"))).expanduser()


@pytest.fixture(scope="session")
def p2p():
    return load_pack("p2p")


@pytest.fixture(scope="session")
def o2c():
    return load_pack("o2c")


def requires(path: Path):
    return pytest.mark.skipif(not path.is_file(), reason=f"{path} not available")
