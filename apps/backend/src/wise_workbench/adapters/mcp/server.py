"""MCP server v1 (see README): read-only tools over the application services, stdio transport.

Every tool returns a digest — aggregates, ids, plain-language guidance — never case
text. The tools are the ones a desktop assistant (Claude Code, an IDE agent) needs to
walk the journey with an analyst: packs and their knowledge, projects, runs, backlogs,
slice drivers, presets. Writes stay with the REST API and its eligibility checks.

Run:  python -m wise_workbench.adapters.mcp        (WISE_WORKSPACE selects the workspace)
"""

from __future__ import annotations

import dataclasses
from typing import Any

from mcp.server.mcpserver import MCPServer

INSTRUCTIONS = (
    "Read-only access to a local WISE Workbench: knowledge packs (activities, failure modes, guidance, "
    "interventions), projects, runs, ranked backlogs and slice drivers. Numbers come from scored runs; cite the "
    "run id and the norm fingerprint when you quote them. Causal wording only when an intervention's evidence "
    "class is 'matched' or 'pilot_did'."
)

server = MCPServer("wise-workbench", instructions=INSTRUCTIONS, version="0.1.0")
_container: Any = None


def container() -> Any:
    global _container
    if _container is None:
        from wise_workbench.container import Container

        _container = Container()
    return _container


def _plain(obj: Any) -> Any:
    if obj is None or isinstance(obj, str | int | float | bool):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _plain(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple | set):
        return [_plain(v) for v in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "__dict__"):
        return {k: _plain(v) for k, v in vars(obj).items() if not k.startswith("_")}
    return str(obj)


# ------------------------------------------------------------------ knowledge (no project needed)
@server.tool(description="Installed knowledge packs with their sizes (activities, failure modes, templates, interventions).")
def list_packs() -> list[dict[str, Any]]:
    from wise_knowledge import available_packs, load_pack

    out = []
    for name in sorted(available_packs()):
        p = load_pack(name)
        out.append(
            {
                "id": p.id,
                "process": p.process,
                "review_status": p.review_status,
                "activities": len(p.activities),
                "stages": [s.id for s in p.stage_model.stages],
                "layers": [layer.id for layer in p.layers],
                "failure_modes": len(p.failure_modes),
                "kpis": len(p.kpis),
                "templates": [t.id for t in p.templates],
                "presets": sorted(p.presets),
                "interventions": len(p.interventions),
            }
        )
    return out


@server.tool(description="One pack in detail: stages, layers, failure modes (id, name, layer, owner), KPIs, templates, slice keys, roles.")
def pack_summary(pack: str) -> dict[str, Any]:
    from wise_knowledge import load_pack

    p = load_pack(pack)
    return {
        "id": p.id,
        "process": p.process,
        "description": p.description,
        "case_notion": p.stage_model.case_notion.get("default") if isinstance(p.stage_model.case_notion, dict) else _plain(p.stage_model.case_notion),
        "stages": [{"id": s.id, "name": s.name.get("en"), "order": s.order} for s in p.stage_model.stages],
        "variants": [{"id": v.id, "name": v.name.get("en")} for v in p.stage_model.variants],
        "layers": [{"id": layer.id, "name": layer.name.get("en")} for layer in p.layers],
        "failure_modes": [
            {"id": f.id, "name": f.name_en, "stage": f.stage, "kind": f.kind, "owner_role": f.owner_role,
             "layers": sorted({w.layer for w in f.wise_patterns}), "kpis": list(f.kpis)}
            for f in p.failure_modes
        ],
        "kpis": [{"id": k.id, "name": k.name.get("en"), "direction": k.direction, "unit": k.unit} for k in p.kpis],
        "templates": [{"id": t.id, "name": t.name, "calibration": t.calibration} for t in p.templates],
        "slice_keys": [{"id": s.id, "name": s.name.get("en"), "owner_role": s.owner_role} for s in p.slicing.slice_keys],
        "roles": [{"id": r.id, "name": r.name.get("en")} for r in p.slicing.roles],
        "playbooks": [{"id": b.id, "stage": b.journey_stage, "title": b.title.get("en")} for b in p.playbooks],
    }


@server.tool(description="Plain-language guidance of a layer, a template constraint or a failure mode of a pack (no project needed).")
def pack_guidance(pack: str, entry_id: str) -> dict[str, Any]:
    from wise_knowledge import load_pack

    p = load_pack(pack)
    for g in p.guidance:
        if g.id == entry_id:
            return g.as_block()
    raise ValueError(f"no guidance entry {entry_id!r} in pack {pack!r}")


@server.tool(description="Intervention candidates of a pack, optionally filtered by layer and/or failure mode; each with mechanism, feasibility constraints, expected effect and evidence class.")
def interventions(pack: str, layer: str | None = None, failure_mode: str | None = None) -> list[dict[str, Any]]:
    from wise_knowledge import load_pack

    p = load_pack(pack)
    out = []
    for iv in p.interventions_for(layer=layer, failure_mode=failure_mode):
        out.append(
            {
                "id": iv.id,
                "name": iv.name_en,
                "status": iv.status,
                "mechanism": iv.mechanism,
                "countermeasure": iv.countermeasure,
                "layers": list(iv.layers),
                "failure_modes": list(iv.failure_modes),
                "feasibility_constraints": {k: list(v) for k, v in iv.feasibility_constraints.items()},
                "effort_class": iv.effort_class,
                "expected_effect": dict(iv.expected_effect),
                "evidence_class": iv.evidence_class,
                "causal_language_allowed": iv.causal_language_allowed,
                "owner_role": iv.owner_role,
                "pilot_template": iv.pilot_template,
                "monitoring_kpis": list(iv.monitoring_kpis),
                "risks_side_effects": list(iv.risks_side_effects),
                "reversibility": iv.reversibility,
            }
        )
    return out


# ------------------------------------------------------------------ projects, runs, backlogs
@server.tool(description="Projects of the workspace (id, name, process, steering question).")
def list_projects() -> list[dict[str, Any]]:
    return [_plain(p) for p in container().projects.list()]


@server.tool(description="Runs of a project with status, norm version and parameters.")
def list_runs(project_id: str) -> list[dict[str, Any]]:
    return [_plain(r) for r in container().runs.list(project_id)]


@server.tool(description="Summary of a scored run: cases, views, decomposition check, manifest fingerprints.")
def run_summary(project_id: str, run_id: str) -> dict[str, Any]:
    return _plain(container().runs.summary(project_id, run_id))


@server.tool(description="Ranked backlog of a run: the top slices under a view with priority, case count, gap and stability; slicing is a comma-separated list of case attributes.")
def backlog(
    project_id: str,
    run_id: str,
    slicing: str,
    view: str | None = None,
    top: int = 20,
    min_cases: int = 30,
    gamma: float | None = None,
    volume: str = "cases",
) -> dict[str, Any]:
    res = container().runs.backlog(
        project_id,
        run_id,
        slicing=slicing,
        view=view,
        gamma=gamma,
        min_cases=min_cases,
        sort="pi",
        hotspot_type=None,
        layer=None,
        q=None,
        page=1,
        page_size=max(1, min(int(top), 200)),
        volume=volume,
    )
    return _plain(res)


@server.tool(description="Drivers of one slice: layer and constraint contributions, comparison with the population, worst cases (ids only).")
def slice_detail(project_id: str, run_id: str, slicing: str, slice_key: str, view: str | None = None) -> dict[str, Any]:
    res = container().runs.slice_detail(project_id, run_id, slicing=slicing, slice_key=slice_key, view=view, drilldown=None)
    return _plain(res)


@server.tool(description="Knowledge hub of a project's process pack: nodes and edges (stages, layers, expectations, failure modes, reasons, actions, KPIs).")
def knowledge_hub(project_id: str, process: str | None = None) -> dict[str, Any]:
    return _plain(container().knowledge.hub(project_id, process))


@server.tool(description="Public-log presets a project can load in one click and whether their files are available on this machine.")
def presets(project_id: str) -> list[dict[str, Any]]:
    return [_plain(p) for p in container().presets.list(project_id)]


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
