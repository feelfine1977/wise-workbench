"""Accepted library versions and norm schema versions."""

from __future__ import annotations

from typing import Any

import wise

from wise_workbench.domain import ValidationError

ACCEPTED_SCHEMA_VERSIONS = frozenset({1, 2})
MIN_LIBRARY = (0, 1, 0)
MAX_LIBRARY_EXCLUSIVE = (0, 2, 0)


def library_version() -> str:
    return str(wise.__version__)


def check_library_version() -> None:
    parts = tuple(int(p) for p in library_version().split(".")[:3])
    if not (MIN_LIBRARY <= parts < MAX_LIBRARY_EXCLUSIVE):
        raise RuntimeError(f"wise-pm {library_version()} is outside the accepted range [0.1, 0.2)")


def check_schema_version(document: dict[str, Any]) -> None:
    version = document.get("schema_version", wise.SCHEMA_VERSION)
    try:
        version = int(version)
    except (TypeError, ValueError):
        raise ValidationError(
            f"norm schema_version {version!r} is not an integer", code="norm.schema_version"
        ) from None
    if version not in ACCEPTED_SCHEMA_VERSIONS:
        raise ValidationError(
            f"norm schema_version {version} is not supported; accepted: {sorted(ACCEPTED_SCHEMA_VERSIONS)}",
            code="norm.schema_version",
        )
