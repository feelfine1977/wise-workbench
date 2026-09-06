from __future__ import annotations

import os
from pathlib import Path

import pytest

from wise_knowledge import load_pack

BPIC2019_CSV = Path(
    os.environ.get("WISE_BPIC19_CSV", "~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv")
).expanduser()
HACKATHON_DIR = Path(
    os.environ.get("WISE_HACKATHON_DIR", "~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026")
).expanduser()
OCEL_P2P_EVENTS = Path(
    os.environ.get("WISE_OCEL2_P2P_EVENTS", "~/code/PhD/WISE/OC-WISE/data/ocel2.ocel.events.csv")
).expanduser()
WISE_LIB_NORM = Path(
    os.environ.get("WISE_LIB_BPIC19_NORM", "~/code/PhD/WISE/wise-lib/examples/bpic19_norm.json")
).expanduser()


@pytest.fixture(scope="session")
def p2p():
    return load_pack("p2p")


@pytest.fixture(scope="session")
def o2c():
    return load_pack("o2c")


def requires(path: Path):
    return pytest.mark.skipif(not path.is_file(), reason=f"{path} not available")
