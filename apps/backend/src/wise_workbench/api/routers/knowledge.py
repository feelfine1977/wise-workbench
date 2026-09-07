"""Guidance and the knowledge hub (RK-2, RK-3, RK-4)."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep

router = APIRouter(prefix="/projects/{projectId}", tags=["knowledge"])

Kind = Literal["layer", "constraint", "expectation", "failure_mode"]


@router.get(
    "/knowledge/hub",
    operation_id="getKnowledgeHub",
    response_model=schemas.HubIndex,
    responses={404: {"model": schemas.Problem}},
    description=(
        "The knowledge hub of the project's process pack as node and edge tables: stages, expectation areas, "
        "expectations, failure modes, usual reasons, usual actions and KPIs, each with its plain name and its "
        "method name. Nodes the project has written its own note on are marked `hasOverlay`."
    ),
)
def get_knowledge_hub(
    projectId: str,
    c: ContainerDep,
    process: Annotated[str | None, Query(description="pack id; default: the project's process")] = None,
) -> schemas.HubIndex:
    return schemas.HubIndex(**c.knowledge.hub(projectId, process))


@router.get(
    "/knowledge/hub/{nodeId:path}",
    operation_id="getKnowledgeHubPage",
    response_model=schemas.HubPage,
    responses={404: {"model": schemas.Problem}},
    description=(
        "One hub page: what it means, why it matters, how it is detected, the usual reasons with what to check in "
        "the log and whom to ask outside it, the usual actions with countermeasure type and owner role, what to "
        "check first, examples and KPIs, plus the related stage, expectations, failure modes and playbook."
    ),
)
def get_knowledge_hub_page(projectId: str, nodeId: str, c: ContainerDep, process: str | None = None) -> schemas.HubPage:
    return schemas.HubPage(**c.knowledge.hub_page(projectId, nodeId, process))


@router.get(
    "/guidance/{kind}/{entryId:path}",
    operation_id="getGuidance",
    response_model=schemas.Guidance,
    responses={404: {"model": schemas.Problem}},
    description=(
        "The guidance of one expectation area (`layer`), expectation (`constraint` or `expectation`) or failure "
        "mode: the pack's generic tier, the project's own note as `overlay`, and the hub node to open. Pass "
        "`normVersionId` to read the guidance a norm carries with it."
    ),
)
def get_guidance(
    projectId: str,
    kind: Kind,
    entryId: str,
    c: ContainerDep,
    normVersionId: Annotated[str | None, Query(description="read metadata.guidance of this norm version")] = None,
) -> schemas.Guidance:
    return schemas.Guidance(**c.knowledge.guidance(projectId, kind, entryId, norm_version_id=normVersionId))


@router.put(
    "/guidance/{kind}/{entryId:path}",
    operation_id="setGuidanceOverlay",
    response_model=schemas.Guidance,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description="Your organisation's note on this entry (RK-5). It is added to the generic tier, never instead of it.",
)
def set_guidance_overlay(
    projectId: str, kind: Kind, entryId: str, body: schemas.GuidanceOverlay, c: ContainerDep
) -> schemas.Guidance:
    c.knowledge.set_overlay(projectId, kind, entryId, body.model_dump(exclude_none=True))
    return schemas.Guidance(**c.knowledge.guidance(projectId, kind, entryId))
