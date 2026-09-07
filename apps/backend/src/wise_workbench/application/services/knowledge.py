"""Guidance and the knowledge hub (RK-2, RK-3, RK-4): what an expectation means, why it matters, what to do.

Two tiers, as ``docs/panel/knowledge_hub_panel.md`` §2 asks for: the pack's generic tier (``guidance.yaml``, or the
``metadata.guidance`` block a norm carries with it) and the project overlay — "your organisation's note" — kept in
the project's workspace next to its other files. A reader always sees the generic text; the overlay adds to it and
never silently replaces it.

Everything degrades: without the knowledge package the endpoints answer 404 with a reason instead of failing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wise_workbench.adapters.knowledge import (
    guidance_ref,
    hub_index,
    hub_node_id,
    hub_page,
    knowledge_available,
)
from wise_workbench.domain import NotFoundError, ValidationError
from wise_workbench.domain.project import utcnow

if TYPE_CHECKING:  # pragma: no cover
    from wise_workbench.container import Container

KINDS = ("layer", "constraint", "expectation", "failure_mode")

# the five elicitation questions of docs/panel/knowledge_hub_panel.md §4, asked when a layer or an expectation is
# defined; the answers become the project overlay and travel with the norm (R3-O6, RK-6)
GUIDANCE_QUESTIONS: list[dict[str, str]] = [
    {"id": "plain_name", "field": "plain_name", "question": "What do we call this in our own words?"},
    {"id": "expectation", "field": "expectation", "question": "What do we expect, in one sentence?"},
    {
        "id": "meaning_when_missed",
        "field": "meaning_when_missed",
        "question": "What does it mean when it is missed?",
    },
    {"id": "usual_reasons", "field": "usual_reasons", "question": "What usually causes it here?"},
    {
        "id": "usual_actions",
        "field": "usual_actions",
        "question": "What do we usually do about it, and who owns it?",
    },
]
OVERLAY_FILE = "guidance_overlay.json"
OVERLAY_FIELDS = (
    "note",
    "plain_name",
    "expectation",
    "meaning_when_missed",
    "why_it_matters",
    "usual_reasons",
    "usual_actions",
    "what_to_check_first",
    "owner_role",
    "stakeholders",
    "examples",
    "kpis",
)


class KnowledgeService:
    def __init__(self, c: Container):
        self.c = c

    # ------------------------------------------------------------- the project overlay
    def _overlay_path(self, project_id: str) -> Any:
        return self.c.workspace.project_dir(project_id) / OVERLAY_FILE

    def _overlays(self, project_id: str) -> dict[str, Any]:
        path = self._overlay_path(project_id)
        if not path.exists():
            return {}
        try:
            data = self.c.workspace.read_json(path)
        except (OSError, ValueError):  # pragma: no cover - a hand-edited file
            return {}
        return dict(data) if isinstance(data, dict) else {}

    def overlay(self, project_id: str, kind: str, entry_id: str) -> dict[str, Any] | None:
        return self._overlays(project_id).get(f"{kind}:{entry_id}")

    def set_overlay(self, project_id: str, kind: str, entry_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self.c.repos.get_project(project_id)
        if kind not in KINDS:
            raise ValidationError(f"kind must be one of {list(KINDS)}", code="guidance.kind")
        unknown = [k for k in body if k not in (*OVERLAY_FIELDS, "author")]
        if unknown:
            raise ValidationError(
                f"the overlay accepts {list(OVERLAY_FIELDS)}; unknown: {unknown}", code="guidance.overlay"
            )
        overlays = self._overlays(project_id)
        entry = {k: v for k, v in body.items() if v is not None}
        entry["updatedAt"] = utcnow().isoformat()
        overlays[f"{kind}:{entry_id}"] = entry
        self.c.workspace.write_json(self._overlay_path(project_id), overlays)
        return entry

    # ------------------------------------------------------------- RK-2 guidance of one entry
    def guidance(self, project_id: str, kind: str, entry_id: str, *, norm_version_id: str | None = None) -> dict:
        project = self.c.repos.get_project(project_id)
        if kind not in KINDS:
            raise ValidationError(f"kind must be one of {list(KINDS)}", code="guidance.kind")
        document = None
        if norm_version_id:
            document = self.c.norms.get(project_id, norm_version_id).document
        lookup = "constraint" if kind == "expectation" else kind
        ref = guidance_ref(project.process, lookup, entry_id, document=document)
        generic = dict(ref.block) if ref.block else None
        node = ref.hub_node or hub_node_id(project.process, lookup, entry_id)
        overlay = self.overlay(project_id, kind, entry_id)
        if generic is None and overlay is None:
            raise NotFoundError(
                f"no guidance for {kind} {entry_id!r} in process {project.process!r}"
                + ("" if knowledge_available() else " (the knowledge package is not installed)"),
                code="guidance.not_found",
            )
        if generic is not None:
            generic.setdefault("hub_node", node)
        return {"kind": kind, "id": entry_id, "generic": generic, "overlay": overlay, "hub_node": node}

    def questions(self, project_id: str, kind: str, entry_id: str | None = None) -> dict[str, Any]:
        """The elicitation questions for a layer or an expectation, with the generic text as a starting answer."""
        self.c.repos.get_project(project_id)
        if kind not in KINDS:
            raise ValidationError(f"kind must be one of {list(KINDS)}", code="guidance.kind")
        generic: dict[str, Any] = {}
        overlay: dict[str, Any] = {}
        if entry_id:
            try:
                found = self.guidance(project_id, kind, entry_id)
                generic = found.get("generic") or {}
                overlay = found.get("overlay") or {}
            except NotFoundError:
                generic, overlay = {}, {}
        return {
            "kind": kind,
            "id": entry_id,
            "questions": [
                {**q, "suggested": generic.get(q["field"]), "answer": overlay.get(q["field"])}
                for q in GUIDANCE_QUESTIONS
            ],
        }

    # ------------------------------------------------------------- RK-3 the hub
    def hub(self, project_id: str, process: str | None = None) -> dict[str, Any]:
        project = self.c.repos.get_project(project_id)
        pack = process or project.process
        index = hub_index(pack)
        if index is None:
            raise NotFoundError(
                f"no knowledge hub for process {pack!r}"
                + ("" if knowledge_available() else " (the knowledge package is not installed)"),
                code="hub.not_found",
            )
        overlays = self._overlays(project_id)
        for node in index.get("nodes", []):
            key = str(node.get("id") or "")
            kind, _, entry = key.partition(":")
            if f"{kind}:{entry}" in overlays or key in overlays:
                node["hasOverlay"] = True
        index["process"] = pack
        index["overlays"] = len(overlays)
        return index

    def hub_page(self, project_id: str, node_id: str, process: str | None = None) -> dict[str, Any]:
        project = self.c.repos.get_project(project_id)
        pack = process or project.process
        page = hub_page(pack, node_id)
        if page is None:
            raise NotFoundError(f"no hub page {node_id!r} for process {pack!r}", code="hub.node_not_found")
        kind, _, entry = str(node_id).partition(":")
        page["overlay"] = self.overlay(project_id, kind, entry) or self.overlay(project_id, "constraint", entry)
        page["process"] = pack
        return page
