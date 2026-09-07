"""Norm versions: immutable library documents with fingerprint, lineage and a note."""

from __future__ import annotations

import builtins
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import case_noun as pack_case_noun
from wise_workbench.adapters.knowledge import guidance_complete, guidance_ref
from wise_workbench.domain import (
    CaseTableStatus,
    NormStatus,
    NormVersion,
    NotFoundError,
    ValidationError,
    changed_thresholds,
    missing_rationales,
    thresholds_of,
)
from wise_workbench.domain.project import utcnow
from wise_workbench.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container


class NormService:
    def __init__(self, c: Container):
        self.c = c

    def create_version(
        self,
        project_id: str,
        document: dict[str, Any],
        note: str,
        parent_id: str | None = None,
        author: str | None = None,
        calibration: dict[str, Any] | None = None,
        not_applicable: dict[str, Any] | None = None,
    ) -> NormVersion:
        """A new immutable version.

        ``calibration`` records, per expectation, why its threshold is what it is and who owns it; the version
        does not leave ``draft`` without one for every threshold it changed (R3-02). ``not_applicable`` moves an
        expectation out of the norm with a note that says why, so that a layer-balanced score stops averaging a
        constant; the expectation itself is kept in the metadata and can be brought back.
        """
        self.c.repos.get_project(project_id)
        if not isinstance(document, dict):
            raise ValidationError("norm must be a JSON object", code="norm.invalid")
        document = _with_calibration(document, calibration, not_applicable, author)
        canonical, fingerprint = self.c.engine.validate_norm(document)
        canonical.setdefault("metadata", {})
        for block in ("calibration", "not_applicable"):
            if (document.get("metadata") or {}).get(block):
                canonical["metadata"][block] = (document["metadata"])[block]
        parent: NormVersion | None = None
        if parent_id:
            parent = self.c.repos.get_norm_version(parent_id)
            if parent.project_id != project_id:
                raise NotFoundError(f"parent norm version {parent_id!r} not found in project", code="norm.not_found")
        norm_id = parent.norm_id if parent else new_id("norm")
        number = self.c.repos.next_norm_number(norm_id)
        version = NormVersion(
            id=new_id("nv"),
            project_id=project_id,
            norm_id=norm_id,
            version=number,
            fingerprint=fingerprint,
            document=canonical,
            status=NormStatus.DRAFT,
            note=note or "",
            author=author,
            parent_id=parent.id if parent else None,
            validation=(),
        )
        path = self.c.workspace.norm_version_path(project_id, norm_id, number)
        self.c.workspace.write_text(path, self.c.engine.norm_text(document))
        saved = self.c.repos.add_norm_version(version)
        # R1-08: warnings from Norm.check against the project's latest ready case table, when there is one
        tables = [t for t in self.c.repos.list_case_tables(project_id) if t.status == CaseTableStatus.READY]
        if tables:
            saved = self.refresh_warnings(saved, tables[-1].id)
        return saved

    def refresh_warnings(self, n: NormVersion, case_table_id: str) -> NormVersion:
        table = self.c.repos.get_case_table(case_table_id)
        mapping = self.c.repos.get_mapping(table.mapping_id)
        warnings = self.c.engine.norm_warnings(
            self.c.workspace.case_table_dir(n.project_id, table.id), mapping, n.document
        )
        updated = replace(n, validation=tuple(warnings))
        return self.c.repos.update_norm_validation(updated)

    def guidance_complete(self, n: NormVersion) -> bool:
        process = self.c.repos.get_project(n.project_id).process
        return guidance_complete(process, n.document)

    def get(self, project_id: str, norm_version_id: str) -> NormVersion:
        n = self.c.repos.get_norm_version(norm_version_id)
        if n.project_id != project_id:
            raise NotFoundError(
                f"norm version {norm_version_id!r} not found in project {project_id!r}", code="norm.not_found"
            )
        return n

    def list(self, project_id: str) -> list[NormVersion]:
        self.c.repos.get_project(project_id)
        return self.c.repos.list_norm_versions(project_id)

    def set_status(
        self, project_id: str, norm_version_id: str, status: NormStatus, *, author: str | None = None
    ) -> NormVersion:
        """Move a version along ``draft → reviewed → approved``.

        Leaving ``draft`` is the moment a norm becomes something a person stands behind, so it is refused while a
        threshold this version set carries no rationale and no owner, and it is refused without a named person
        (R3-02).
        """
        n = self.get(project_id, norm_version_id)
        if status != NormStatus.DRAFT and n.status == NormStatus.DRAFT:
            if not str(author or n.author or "").strip():
                raise ValidationError(
                    "a norm version leaves draft under the name of the person who signs it", code="norm.author"
                )
            parent = self.c.repos.get_norm_version(n.parent_id).document if n.parent_id else None
            missing = missing_rationales(n.document, parent, n.uncalibrated)
            if missing:
                raise ValidationError(
                    "these thresholds have no rationale and no owner yet: " + ", ".join(missing),
                    code="norm.rationale_required",
                    errors=[{"field": cid, "message": "a rationale and an owner are required"} for cid in missing],
                )
        moved = n.with_status(status)
        if author and not moved.author:
            moved = replace(moved, author=author)
        return self.c.repos.update_norm_status(moved)

    def calibration(self, project_id: str, norm_version_id: str) -> dict[str, Any]:
        """What this version's thresholds are, which of them it set, and which of those still lack a rationale."""
        n = self.get(project_id, norm_version_id)
        parent = self.c.repos.get_norm_version(n.parent_id).document if n.parent_id else None
        entries = n.calibration_entries
        thresholds = thresholds_of(n.document)
        changed = changed_thresholds(n.document, parent)
        rows = []
        for cid, values in sorted(thresholds.items()):
            entry = entries.get(cid) or {}
            rows.append(
                {
                    "constraint_id": cid,
                    "threshold": values,
                    "changedHere": cid in changed,
                    "rationale": entry.get("rationale"),
                    "owner": entry.get("owner"),
                    "decidedAt": entry.get("decidedAt"),
                }
            )
        missing = missing_rationales(n.document, parent, n.uncalibrated)
        return {
            "normVersionId": n.id,
            "status": str(n.status),
            "parentId": n.parent_id,
            "author": n.author,
            "thresholds": rows,
            "notApplicable": [
                {"constraint_id": cid, **{k: v for k, v in entry.items() if k != "constraint"}}
                for cid, entry in sorted(n.not_applicable.items())
            ],
            "missingRationale": missing,
            "canLeaveDraft": not missing,
        }

    def applicability_options(self, project_id: str, case_table_id: str) -> dict[str, Any]:
        """What an expectation can be made to apply to on this log (R3-02): flow types, attribute values, nothing.

        The applicability editor writes one of these clauses onto an expectation, so the options it offers are
        the log's own: the flow types the case table carries with their counts, every case attribute with its
        values, and *not applicable to this log*, which moves the expectation out of the norm with a note.
        """
        inventory = self.inventory(project_id, case_table_id, limit=50)
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        mapping = self.c.repos.get_mapping(table.mapping_id)
        flow_types: list[dict[str, Any]] = []
        absent: list[dict[str, Any]] = []
        try:
            payload = self.c.mappings.flow_types(project_id, case_table_id, attribute=None, abstraction=0.05)
            flow_types = [
                {"value": t["name"], "cases": t["cases"], "share": t["share"]} for t in payload.get("types") or []
            ]
            absent = list(payload.get("absent") or [])
        except (ValidationError, NotFoundError):  # a case table without flow typing offers attributes only
            flow_types = []
        return {
            "caseTableId": case_table_id,
            "caseNoun": inventory.get("caseNoun"),
            "flowTypeAttribute": "flow_type" if flow_types else None,
            "flowTypes": flow_types,
            "flowTypesAbsent": absent,
            "attributes": inventory.get("attributes") or [],
            "kinds": [
                {
                    "id": "flow_type",
                    "label": "one or more flow types",
                    "shape": {"attr": "flow_type", "in": ["standard"]},
                    "available": bool(flow_types),
                },
                {
                    "id": "attribute",
                    "label": "a case attribute equal to one of a set of values",
                    "shape": {
                        "attr": mapping.case_attributes[0] if mapping.case_attributes else "attribute",
                        "in": ["value"],
                    },
                    "available": bool(mapping.case_attributes),
                },
                {
                    "id": "always",
                    "label": "every case of this log",
                    "shape": {},
                    "available": True,
                },
                {
                    "id": "not_applicable",
                    "label": "not applicable to this log",
                    "shape": None,
                    "available": True,
                    "note": (
                        "the expectation is moved out of this version with a note; it is kept in the metadata "
                        "and can be brought back"
                    ),
                },
            ],
        }

    # ------------------------------------------------------------- norm builder (R3-O6)
    def inventory(
        self,
        project_id: str,
        case_table_id: str,
        *,
        attribute: str | None = None,
        q: str | None = None,
        limit: int = 25,
    ) -> dict[str, Any]:
        """The activities and attribute values a norm can be built from, with counts."""
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        mapping = self.c.repos.get_mapping(table.mapping_id)
        process = self.c.repos.get_project(project_id).process
        out = self.c.engine.inventory(
            self.c.workspace.case_table_dir(project_id, case_table_id),
            mapping,
            process=process,
            attribute=attribute,
            q=q,
            limit=limit,
        )
        out["caseTableId"] = case_table_id
        out["caseNoun"] = out.get("caseNoun") or (table.readiness.case_noun if table.readiness else None)
        return out

    def validate_constraint(
        self,
        project_id: str,
        case_table_id: str,
        constraint: dict[str, Any],
        *,
        norm_version_id: str | None = None,
    ) -> dict[str, Any]:
        """One expectation checked against a case table, with the plain sentence the builder shows."""
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        mapping = self.c.repos.get_mapping(table.mapping_id)
        project = self.c.repos.get_project(project_id)
        document = self.get(project_id, norm_version_id).document if norm_version_id else None
        noun = (
            mapping.case_noun
            or (table.readiness.case_noun if table.readiness else None)
            or pack_case_noun(project.process)
            or "cases"
        )
        out = self.c.engine.validate_constraint(
            self.c.workspace.case_table_dir(project_id, case_table_id),
            mapping,
            constraint,
            process=project.process,
            document=document,
            case_noun=noun,
        )
        out["caseTableId"] = case_table_id
        out["caseNoun"] = noun
        return out

    def guidance_missing(self, n: NormVersion) -> builtins.list[str]:
        """Layers of the norm that carry no guidance: what the elicitation questions still have to fill (RK-6)."""
        process = self.c.repos.get_project(n.project_id).process
        out: builtins.list[str] = []
        for layer in n.document.get("layers") or []:
            lid = str(layer.get("id"))
            if guidance_ref(process, "layer", lid, document=n.document).plain_name is None:
                out.append(lid)
        return out

    def check(self, project_id: str, norm_version_id: str, case_table_id: str) -> dict[str, Any]:
        n = self.get(project_id, norm_version_id)
        table = self.c.mappings.get_case_table(project_id, case_table_id)
        if table.status != CaseTableStatus.READY:
            raise ValidationError(f"case table {case_table_id} is {table.status}", code="case_table.not_ready")
        mapping = self.c.repos.get_mapping(table.mapping_id)
        out = self.c.engine.check_norm(self.c.workspace.case_table_dir(project_id, case_table_id), mapping, n.document)
        self.c.repos.update_norm_validation(replace(n, validation=tuple(str(i) for i in out.get("issues", []))))
        out["warnings"] = list(out.get("issues", []))
        return out


def _with_calibration(
    document: dict[str, Any],
    calibration: dict[str, Any] | None,
    not_applicable: dict[str, Any] | None,
    author: str | None,
) -> dict[str, Any]:
    """Merge the rationales and the *not applicable* decisions into the document's metadata."""
    if not calibration and not not_applicable:
        return document
    out = dict(document)
    metadata = dict(out.get("metadata") or {})
    now = utcnow().isoformat()
    if calibration:
        block = dict(metadata.get("calibration") or {})
        for cid, entry in calibration.items():
            body = dict(entry or {})
            rationale, owner = str(body.get("rationale") or "").strip(), str(body.get("owner") or "").strip()
            if not rationale or not owner:
                raise ValidationError(
                    f"the threshold of {cid} needs a rationale and an owner", code="norm.rationale_required"
                )
            block[str(cid)] = {
                "rationale": rationale,
                "owner": owner,
                "decidedAt": body.get("decidedAt") or now,
                "decidedBy": body.get("decidedBy") or author,
            }
        metadata["calibration"] = block
    if not_applicable:
        block = dict(metadata.get("not_applicable") or {})
        kept = []
        removed = {str(cid) for cid in not_applicable}
        for constraint in out.get("constraints") or []:
            cid = str(constraint.get("id") or "")
            if cid not in removed:
                kept.append(constraint)
                continue
            note = str((not_applicable[cid] or {}).get("note") or "").strip()
            if not note:
                raise ValidationError(
                    f"marking {cid} not applicable needs a note that says why", code="norm.not_applicable_note"
                )
            block[cid] = {
                "note": note,
                "author": (not_applicable[cid] or {}).get("author") or author,
                "decidedAt": (not_applicable[cid] or {}).get("decidedAt") or now,
                "constraint": dict(constraint),
            }
        unknown = sorted(removed - {str(c.get("id")) for c in out.get("constraints") or []} - set(block))
        if unknown:
            raise ValidationError(f"the norm has no expectation {unknown}", code="norm.not_applicable")
        out["constraints"] = kept
        # a view weights the expectations by name, so an expectation that is no longer there leaves its weights too
        views = []
        for view in out.get("views") or []:
            copy_view = dict(view)
            weights = copy_view.get("constraint_weights")
            if isinstance(weights, dict):
                copy_view["constraint_weights"] = {k: v for k, v in weights.items() if str(k) not in removed}
            views.append(copy_view)
        out["views"] = views
        metadata["not_applicable"] = block
    out["metadata"] = metadata
    return out
