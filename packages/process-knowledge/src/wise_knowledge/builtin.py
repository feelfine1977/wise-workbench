"""Entry-point targets for the packs shipped with this repository."""

from __future__ import annotations

from pathlib import Path

from .paths import knowledge_root


def p2p() -> Path:
    return knowledge_root() / "p2p"


def o2c() -> Path:
    return knowledge_root() / "o2c"
