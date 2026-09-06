"""The descriptive vocabulary every user-visible sentence must follow.

`CUSTOMER_JOURNEY.md` §8 and ADR 0006 restrict generated text to
descriptive statements: a slice *carries* a gap, a mechanism *coincides
with* it, a value *differs by* so much. Nothing generated here may claim a
cause, a fault or a future improvement; WISE yields action hypotheses,
not effects. :func:`check_reading` is used by the tests to enforce the rule
on every reading produced by the package.
"""

from __future__ import annotations

import re

#: Phrases allowed in readings (documentation; not enforced).
ALLOWED = (
    "carries",
    "concentrates",
    "coincides with",
    "is associated with",
    "differs by",
    "headroom under the norm",
    "action hypothesis",
    "priority",
    "expectation shortfall",
)

#: Terms that never appear in generated text (word-boundary matched,
#: case-insensitive). "effective" is not matched by "effect".
FORBIDDEN = (
    "root cause",
    "root causes",
    "causes",
    "caused",
    "cause",
    "because",
    "will improve",
    "improves",
    "predicts",
    "predicted",
    "prediction",
    "effect",
    "effects",
    "fault",
    "faulty",
    "blame",
    "expected benefit",
)

_PATTERN = re.compile(r"\b(" + "|".join(re.escape(t) for t in FORBIDDEN) + r")\b", re.IGNORECASE)


def forbidden_terms(text: str) -> list[str]:
    """The forbidden terms found in ``text`` (empty when the text is clean)."""
    return [m.group(0) for m in _PATTERN.finditer(text)]


def check_reading(text: str) -> None:
    """Raise :class:`ValueError` when ``text`` uses a forbidden term."""
    found = forbidden_terms(text)
    if found:
        raise ValueError(f"reading uses forbidden vocabulary {found!r}: {text!r}")


__all__ = ["ALLOWED", "FORBIDDEN", "check_reading", "forbidden_terms"]
