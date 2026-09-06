"""Short, sortable identifiers: ``<prefix>_<time base36><random base36>``."""

from __future__ import annotations

import secrets
import time

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _base36(n: int, width: int) -> str:
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _ALPHABET[r] + out
    return out.rjust(width, "0")


def new_id(prefix: str) -> str:
    """A new identifier; the time prefix keeps ids roughly chronological."""
    stamp = _base36(int(time.time() * 1000), 9)
    rand = _base36(secrets.randbits(40), 8)
    return f"{prefix}_{stamp}{rand}"
