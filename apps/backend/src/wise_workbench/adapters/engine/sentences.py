"""One expectation in one sentence (R3-O6): the plain rendering the norm builder shows under every rule.

The rule itself stays the library's; the sentence is what the person defining it reads back — *Paid within terms:
after Record Invoice Receipt, Clear Invoice follows within 30 days (still fully counted up to 90)* — with the
activity labels and the threshold in the unit the log carries. Nothing here decides anything: it renders.
"""

from __future__ import annotations

import re
from typing import Any

import wise

_NEVER_OCCURS = re.compile(r"^constraint '([^']+)': activity '([^']+)' never occurs")


def warning_sentence(warning: str, *, expectation: str | None, activity: str | None) -> str:
    """A norm warning as a sentence, with both names in words (P1-8).

    The library warns *constraint 'o_deliv_delivery_present': activity 'o2c.rejection_change' never occurs in
    the log*, and that reached the reader as the first paragraph of a group. Where both names are known it
    becomes *A delivery exists is never missed here, because Rejection reason changed never occurs in this
    log*; where either is not, the warning is kept as it came — a wrong name is worse than a raw one — with
    the clause that says what it means for the reading. There is no full stop: the caller ends the sentence.
    """
    match = _NEVER_OCCURS.match(warning.strip())
    if not match or not expectation or not activity:
        return f"{warning.rstrip('.')}; this expectation is never missed for that reason"
    return f"{expectation} is never missed here, because {activity} never occurs in this log"


def warned_activity(warning: str) -> str | None:
    """The activity a norm warning names, when it names one."""
    match = _NEVER_OCCURS.match(warning.strip())
    return match.group(2) if match else None


UNITS = {
    "D": "days",
    "h": "hours",
    "m": "minutes",
    "s": "seconds",
    "W": "weeks",
}


def _labels(values: Any) -> str:
    items = [str(v) for v in (values or [])]
    if not items:
        return "—"
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + f" or {items[-1]}"


def _unit(unit: Any) -> str:
    return UNITS.get(str(unit), str(unit))


def _num(value: Any) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    return f"{f:g}"


def constraint_sentence(nc: wise.NormConstraint, *, noun: str = "cases") -> str:
    """The rule in one sentence, without any constraint id or method term."""
    c = nc.constraint
    if isinstance(c, wise.Presence):
        times = "at least once" if float(c.m) <= 1 else f"at least {_num(c.m)} times"
        return f"{_labels(c.activity)} happens {times}."
    if isinstance(c, wise.Exclusion):
        scope = ""
        if getattr(c, "after", None):
            scope += f" after {_labels(c.after)}"
        if getattr(c, "before", None):
            scope += f" before {_labels(c.before)}"
        return f"{_labels(c.activity)} does not happen{scope}."
    if isinstance(c, wise.Singularity):
        limit = "once" if float(c.k) <= 1 else f"at most {_num(c.k)} times"
        return (
            f"{_labels(c.activity)} happens {limit}; "
            f"a {noun[:-1] if noun.endswith('s') else noun} with {_num(c.K)} of them counts as fully missed."
        )
    if isinstance(c, wise.Lag):
        delta = "immediately" if c.delta is None else f"within {_num(c.delta)} {_unit(c.unit)}"
        tail = f" (still partly counted up to {_num(float(c.delta or 0) + float(c.width))} {_unit(c.unit)})"
        return f"after {_labels(c.a)}, {_labels(c.b)} follows {delta}{tail}."
    if isinstance(c, wise.Precedence):
        return (
            f"{_labels(c.b)} does not start before {_labels(c.a)}; "
            f"up to {_num(c.k)} out of order is tolerated, {_num(c.K)} counts as fully missed."
        )
    if isinstance(c, wise.Balance):
        return (
            f"{c.attr_x} over {_labels(c.activities_x)} and {c.attr_y} over {_labels(c.activities_y)} agree "
            f"within {_num(float(c.tau) * 100)} % (fully missed at {_num((float(c.tau) + float(c.width)) * 100)} %)."
        )
    if isinstance(c, wise.Metric):
        direction = "stays at or below" if str(c.direction) == "high" else "stays at or above"
        return (
            f"{c.attribute} {direction} {_num(c.threshold)} "
            f"(fully missed {_num(float(c.threshold) + float(c.width))} away)."
        )
    return str(c.describe())


def applicability_sentence(nc: wise.NormConstraint) -> str | None:
    """Whom the expectation applies to, in words: *only for items with flow type DF1*."""
    rule = nc.applicability
    if not rule:
        return None
    return "applies " + _rule_words(dict(rule))


LEAF_WORDS = {
    "in": "is one of {value}",
    "not_in": "is not one of {value}",
    "eq": "is {value}",
    "ne": "is not {value}",
    "gt": "is above {value}",
    "gte": "is at least {value}",
    "lt": "is below {value}",
    "lte": "is at most {value}",
    "isna": "is missing",
    "notna": "is present",
}


def _rule_words(rule: dict[str, Any]) -> str:
    """The library's applicability grammar in words (``norm.py`` ``_eval_rule``)."""
    if "all" in rule:
        return " and ".join(_rule_words(dict(r)) for r in rule["all"])
    if "any" in rule:
        return " or ".join(_rule_words(dict(r)) for r in rule["any"])
    if "not" in rule:
        return "unless " + _rule_words(dict(rule["not"]))
    if "has" in rule:
        return f"when {_labels(rule['has'])} happens"
    if "lacks" in rule:
        return f"when {_labels(rule['lacks'])} never happens"
    if "attr" in rule:
        field = str(rule["attr"])
        ops = [k for k in rule if k != "attr"]
        if not ops:
            return f"when {field} is set"
        op = ops[0]
        value = rule[op]
        if op in ("isna", "notna"):
            missing = bool(value)
            word = "is missing" if (op == "isna") == missing else "is present"
            return f"when {field} {word}"
        text = LEAF_WORDS.get(op, "matches {value}")
        return f"when {field} " + text.format(value=_labels(value) if isinstance(value, list) else value)
    # the short form: {attribute: [values]}
    parts = [f"when {attr} is one of {_labels(values)}" for attr, values in rule.items()]
    return " and ".join(parts) if parts else "to every case"


def full_sentence(nc: wise.NormConstraint, *, plain_name: str | None = None, noun: str = "cases") -> str:
    """Name, rule and applicability in one line."""
    head = plain_name or str(nc.description or nc.id)
    parts = [f"{head}: {constraint_sentence(nc, noun=noun)}"]
    scope = applicability_sentence(nc)
    if scope:
        parts.append(scope[0].upper() + scope[1:] + ".")
    return " ".join(parts)
