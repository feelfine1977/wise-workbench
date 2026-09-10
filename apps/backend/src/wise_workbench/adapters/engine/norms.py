"""Inspect norm inputs against a lazily loaded event log.

Storage and caching remain with the engine facade. Invalid specifications are
reported before loading the log; inspection preserves the library's existing
evaluation and derived-attribute behavior.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pandas as pd
import wise

from wise_workbench.adapters.knowledge import guidance_ref, stage_model
from wise_workbench.domain import ColumnMapping, NotFoundError, ValidationError

from . import compat, sentences
from .logs import activity_inventory


def _constraint_from_dict(spec: dict[str, Any]) -> wise.NormConstraint:
    """One catalogue entry from the JSON shape the norm document uses (``id, layer, type, params,...``)."""
    from wise.constraints import constraint_from_dict

    return wise.NormConstraint(
        id=str(spec.get("id") or ""),
        layer=str(spec.get("layer") or ""),
        constraint=constraint_from_dict(str(spec["type"]), spec.get("params") or {}),
        weight=float(spec.get("weight", 1.0)),
        applicability=dict(spec.get("applicability") or {}),
        description=str(spec.get("description") or ""),
    )


def _norm_from(document: dict[str, Any]) -> wise.Norm:
    compat.check_schema_version(document)
    try:
        return wise.Norm.from_dict(document)
    except wise.NormError as exc:
        raise ValidationError(str(exc), code="norm.invalid") from exc


class NormInspector:
    """The norm builder's inventory, single-rule preview and complete-norm checks."""

    def __init__(self, load_log: Callable[[], wise.EventLog], mapping: ColumnMapping):
        self._load_log = load_log
        self._mapping = mapping

    def inventory(
        self,
        *,
        process: str | None = None,
        attribute: str | None = None,
        q: str | None = None,
        limit: int = 25,
    ) -> dict[str, Any]:
        """What a norm can be built from: the activities of the log and the values of every case attribute, with
        counts. Without ``attribute`` every attribute is summarised with its top values; with one, that attribute's
        values are listed (searchable, paged by ``limit``)."""
        log = self._load_log()
        cases = log.cases
        n_cases = max(len(log), 1)
        reserved = {"n_events", "first_ts", "last_ts"}
        names = [str(c) for c in cases.columns if str(c) not in reserved]
        if attribute is not None and attribute not in names:
            raise NotFoundError(
                f"attribute {attribute!r} is not in the case table; available: {names}", code="inventory.attribute"
            )

        def values_of(name: str, top: int) -> dict[str, Any]:
            col = cases[name]
            numeric = pd.to_numeric(col, errors="coerce")
            is_numeric = bool(numeric.notna().mean() > 0.95 and col.notna().any())
            counts = col.astype(object).where(col.notna(), "(missing)").astype(str).value_counts()
            if q:
                counts = counts[[str(i).lower().find(q.lower()) >= 0 for i in counts.index]]
            out: dict[str, Any] = {
                "name": name,
                "kind": "number" if is_numeric else "text",
                "distinct": int(col.nunique(dropna=True)),
                "missing": int(col.isna().sum()),
                "total": len(counts),
                "values": [
                    {"value": str(v), "cases": int(n), "share": int(n) / n_cases} for v, n in counts.head(top).items()
                ],
            }
            if is_numeric:
                out["numeric"] = {
                    "min": float(numeric.min()),
                    "p10": float(numeric.quantile(0.10)),
                    "median": float(numeric.median()),
                    "p90": float(numeric.quantile(0.90)),
                    "max": float(numeric.max()),
                }
            return out

        activities = activity_inventory(log)
        if q:
            activities = [a for a in activities if q.lower() in str(a["label"]).lower()]
        stages = stage_model(process, [str(a["label"]) for a in activities])
        for a in activities:
            match = stages.matches.get(str(a["label"])) if stages is not None else None
            a["stage"] = match.stage if match else None
            a["canonicalId"] = match.activity_id if match else None
            a["share"] = int(a["cases"]) / n_cases
        wanted = [attribute] if attribute else names
        return {
            "cases": len(log),
            "events": len(log.events),
            "caseNoun": self._mapping.case_noun,
            "activities": activities if attribute is None else [],
            "attributes": [values_of(name, limit if attribute else 10) for name in wanted],
            "attributeNames": names,
            "stages": [dict(s) for s in stages.stages] if stages is not None else [],
        }

    def validate_constraint(
        self,
        constraint: dict[str, Any],
        *,
        process: str | None = None,
        document: dict[str, Any] | None = None,
        case_noun: str = "cases",
    ) -> dict[str, Any]:
        """One expectation checked against the case table before it goes into a norm: is it well formed, does it
        name activities and attributes that occur, how many cases does it apply to and how many miss it, and what
        does it say in one sentence (R3-O6)."""
        errors: list[dict[str, Any]] = []
        try:
            nc = _constraint_from_dict(dict(constraint))
        except (wise.NormError, KeyError, TypeError, ValueError) as exc:
            return {
                "valid": False,
                "errors": [{"field": "constraint", "message": str(exc)}],
                "sentence": None,
                "applicability_sentence": None,
                "activities": [],
                "casesInScope": None,
                "casesEvaluated": None,
                "casesMissing": None,
                "shareMissing": None,
            }
        log = self._load_log()
        labels = set(log.activity_labels)
        activities = [
            {"label": str(a), "known": str(a) in labels, "cases": int((log.count([str(a)]) > 0).sum())}
            for a in dict.fromkeys(nc.constraint.activities())
        ]
        for a in activities:
            if not a["known"]:
                errors.append({"field": "activities", "message": f"activity {a['label']!r} never occurs in this log"})
        in_scope = evaluated = missing = None
        share = None
        try:
            mask = nc.applies_to(log.cases, log) if nc.applicability else pd.Series(True, index=log.case_ids)
            in_scope = int(mask.sum())
            values = wise.evaluate_constraint(log, nc)
            ok = values.notna()
            evaluated = int(ok.sum())
            missing = int((values[ok] > 0).sum())
            share = (missing / evaluated) if evaluated else None
        except (wise.NormError, wise.LogSchemaError) as exc:
            errors.append({"field": "constraint", "message": str(exc)})
        plain = guidance_ref(process, "constraint", nc.id, document=document).plain_name
        return {
            "valid": not errors,
            "errors": errors,
            "id": nc.id,
            "layer": str(nc.layer),
            "type": nc.constraint.type,
            "sentence": sentences.full_sentence(nc, plain_name=plain, noun=case_noun),
            "rule_sentence": sentences.constraint_sentence(nc, noun=case_noun),
            "applicability_sentence": sentences.applicability_sentence(nc),
            "activities": activities,
            "casesInScope": in_scope,
            "casesEvaluated": evaluated,
            "casesMissing": missing,
            "shareMissing": share,
            "note": (
                f"{missing:,} of the {evaluated:,} {case_noun} it applies to miss it ({share * 100:.0f} %)."
                if share is not None
                else None
            ),
        }

    def check_norm(self, document: dict[str, Any]) -> dict[str, Any]:
        norm = _norm_from(document)
        log = self._load_log()
        issues = norm.check(log)
        try:
            if norm.derived_attributes:
                log.derive(norm.derived_attributes, overwrite=False)
        except (wise.NormError, wise.LogSchemaError) as exc:
            issues.append(f"derived attributes: {exc}")
        labels = set(log.activity_labels)
        constraints = []
        for nc in norm.constraints:
            missing = sorted({a for a in nc.constraint.activities() if a not in labels})
            in_scope = int(nc.applies_to(log.cases, log).sum()) if nc.applicability else len(log)
            try:
                evaluated = int(wise.evaluate_constraint(log, nc).notna().sum())
            except (wise.NormError, wise.LogSchemaError) as exc:
                evaluated = 0
                issues.append(f"constraint {nc.id!r}: {exc}")
            constraints.append(
                {
                    "id": nc.id,
                    "layer": nc.layer,
                    "type": nc.constraint.type,
                    "activitiesMissing": missing,
                    "casesInScope": in_scope,
                    "casesEvaluated": evaluated,
                }
            )
        return {"constraints": constraints, "issues": issues, "cases": len(log), "fingerprint": norm.fingerprint()}

    def norm_warnings(self, document: dict[str, Any]) -> list[str]:
        """``Norm.check``: activities and attributes the norm names that never occur in the case table (R1-08)."""
        norm = _norm_from(document)
        log = self._load_log()
        return [str(w) for w in norm.check(log)]
