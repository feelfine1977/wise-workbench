"""Datasets: multipart upload → ingest job; mappings → build job; case tables."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from wise_workbench.api import schemas
from wise_workbench.api.deps import ContainerDep

router = APIRouter(prefix="/projects/{projectId}", tags=["datasets"])


@router.get("/datasets", operation_id="listDatasets", response_model=list[schemas.DatasetVersion])
def list_datasets(projectId: str, c: ContainerDep) -> list[schemas.DatasetVersion]:
    return [schemas.DatasetVersion.from_domain(d) for d in c.datasets.list(projectId)]


@router.post(
    "/datasets",
    operation_id="uploadDataset",
    response_model=schemas.Job,
    status_code=status.HTTP_202_ACCEPTED,
    description="Multipart upload of CSV, Parquet or XES; returns the ingest job. The dataset id is in resultRef.",
)
def upload_dataset(
    projectId: str,
    c: ContainerDep,
    file: Annotated[UploadFile, File()],
    name: Annotated[str | None, Form()] = None,
) -> schemas.Job:
    dataset, job = c.datasets.upload(projectId, file.filename or "upload.csv", file.file, name)
    out = schemas.Job.from_domain(job)
    out.resultRef = f"dataset:{dataset.id}"
    return out


@router.get(
    "/datasets/presets",
    operation_id="listPresets",
    response_model=list[schemas.Preset],
    description="Public logs with a known mapping and norm that can be loaded in one click; `available` says whether the files are on this machine.",
)
def list_presets(projectId: str, c: ContainerDep) -> list[schemas.Preset]:
    return [schemas.Preset(**p) for p in c.presets.list(projectId)]


@router.post(
    "/datasets/presets/{presetId}",
    operation_id="loadPreset",
    response_model=schemas.Job,
    status_code=status.HTTP_202_ACCEPTED,
    responses={404: {"model": schemas.Problem}, 422: {"model": schemas.Problem}},
    description=(
        "Loads a public log preset: registers the configured file (not copied), builds the case table with the "
        "known mapping, imports the norm and scores a run, all in one job. The run id is in resultRef when done; "
        "every step reuses what the project already has."
    ),
)
def load_preset(projectId: str, presetId: str, c: ContainerDep) -> schemas.Job:
    return schemas.Job.from_domain(c.presets.load(projectId, presetId))


@router.get("/datasets/{datasetId}", operation_id="getDataset", response_model=schemas.DatasetVersion)
def get_dataset(projectId: str, datasetId: str, c: ContainerDep) -> schemas.DatasetVersion:
    return schemas.DatasetVersion.from_domain(c.datasets.get(projectId, datasetId))


@router.get("/datasets/{datasetId}/preview", operation_id="previewDataset", response_model=schemas.Table)
def preview_dataset(
    projectId: str, datasetId: str, c: ContainerDep, rows: Annotated[int, Query(ge=1, le=1000)] = 50
) -> schemas.Table:
    return schemas.Table(**c.datasets.preview(projectId, datasetId, rows))


@router.get(
    "/datasets/{datasetId}/mapping-suggestion",
    operation_id="suggestMapping",
    response_model=schemas.MappingSuggestion,
    description="A column mapping guessed from the column names: exact presets for known logs, patterns otherwise.",
)
def suggest_mapping(projectId: str, datasetId: str, c: ContainerDep) -> schemas.MappingSuggestion:
    return schemas.MappingSuggestion(**c.mappings.suggest(projectId, datasetId))


@router.get(
    "/datasets/{datasetId}/mappings", operation_id="listMappings", response_model=list[schemas.ColumnMappingOut]
)
def list_mappings(projectId: str, datasetId: str, c: ContainerDep) -> list[schemas.ColumnMappingOut]:
    return [schemas.ColumnMappingOut.from_domain(m) for m in c.mappings.list_mappings(projectId, datasetId)]


@router.post(
    "/datasets/{datasetId}/mappings",
    operation_id="createMapping",
    response_model=schemas.Job,
    status_code=status.HTTP_202_ACCEPTED,
    responses={422: {"model": schemas.Problem}},
    description="Validates the mapping on a sample and starts the case-table build job. The case table id is in resultRef.",
)
def create_mapping(projectId: str, datasetId: str, body: schemas.ColumnMapping, c: ContainerDep) -> schemas.Job:
    mapping, table, job, sample = c.mappings.create(projectId, datasetId, body.model_dump())
    out = schemas.Job.from_domain(job)
    out.resultRef = f"case_table:{table.id}"
    out.message = f"mapping {mapping.id} validated on {sample['sampleEvents']:,} events ({sample['cases']:,} cases); building the case table"
    return out


@router.get("/case-tables", operation_id="listCaseTables", response_model=list[schemas.CaseTable])
def list_case_tables(projectId: str, c: ContainerDep) -> list[schemas.CaseTable]:
    return [schemas.CaseTable.from_domain(t) for t in c.mappings.list_case_tables(projectId)]


@router.get("/case-tables/{caseTableId}", operation_id="getCaseTable", response_model=schemas.CaseTable)
def get_case_table(projectId: str, caseTableId: str, c: ContainerDep) -> schemas.CaseTable:
    return schemas.CaseTable.from_domain(c.mappings.get_case_table(projectId, caseTableId))


@router.get(
    "/case-tables/{caseTableId}/mapping", operation_id="getCaseTableMapping", response_model=schemas.ColumnMappingOut
)
def get_case_table_mapping(projectId: str, caseTableId: str, c: ContainerDep) -> schemas.ColumnMappingOut:
    table = c.mappings.get_case_table(projectId, caseTableId)
    return schemas.ColumnMappingOut.from_domain(c.mappings.get_mapping(table.mapping_id))


@router.get(
    "/case-tables/{caseTableId}/flow-types",
    operation_id="getFlowTypes",
    response_model=schemas.FlowTypes,
    description=(
        "The detected flow types of a case table (from the mapping's flow typing, else from the named attribute): "
        "counts, share, one process map each with stage groups, and a readiness headline per type. Each type carries "
        "the run scope that analyses it alone."
    ),
)
def get_flow_types(
    projectId: str,
    caseTableId: str,
    c: ContainerDep,
    attribute: Annotated[
        str | None, Query(description="case attribute holding the flow type (default: the mapping's)")
    ] = None,
    abstraction: Annotated[float, Query(ge=0.0, le=1.0)] = 0.05,
) -> schemas.FlowTypes:
    return schemas.FlowTypes(
        **c.mappings.flow_types(projectId, caseTableId, attribute=attribute, abstraction=abstraction)
    )


# ---------------------------------------------------------------------------- decisions on data caveats (R2-O1)
@router.get(
    "/decisions/kinds",
    operation_id="listDecisionKinds",
    response_model=list[schemas.DecisionKind],
    description="The decisions a reader can take on readiness items, with the parameters each accepts.",
)
def list_decision_kinds(projectId: str, c: ContainerDep) -> list[schemas.DecisionKind]:
    c.repos.get_project(projectId)
    return [schemas.DecisionKind(**k) for k in c.decisions.kinds()]


@router.get(
    "/decisions",
    operation_id="listDecisions",
    response_model=list[schemas.Decision],
    description="Decisions taken in the project (optionally those that touch one case table).",
)
def list_decisions(projectId: str, c: ContainerDep, caseTableId: str | None = None) -> list[schemas.Decision]:
    return [schemas.Decision.from_domain(d) for d in c.decisions.list(projectId, caseTableId)]


@router.post(
    "/case-tables/{caseTableId}/decisions/preview",
    operation_id="previewDecision",
    response_model=schemas.DecisionPreviewOut,
    description="Cases and events a decision would affect, before it is applied.",
)
def preview_decision(
    projectId: str, caseTableId: str, body: schemas.DecisionRequest, c: ContainerDep
) -> schemas.DecisionPreviewOut:
    return schemas.DecisionPreviewOut(**c.decisions.preview(projectId, caseTableId, body.kind, body.params))


@router.post(
    "/case-tables/{caseTableId}/decisions",
    operation_id="applyDecision",
    response_model=schemas.DecisionApplied,
    status_code=status.HTTP_202_ACCEPTED,
    description=(
        "Apply a decision: it is stored as a versioned mapping decision (a child mapping), a new case table is built "
        "from it (job) and its readiness report is the re-evaluation."
    ),
)
def apply_decision(
    projectId: str, caseTableId: str, body: schemas.DecisionRequest, c: ContainerDep
) -> schemas.DecisionApplied:
    decision, table, job = c.decisions.apply(
        projectId, caseTableId, body.kind, body.params, author=body.author, note=body.note
    )
    return schemas.DecisionApplied(
        decision=schemas.Decision.from_domain(decision),
        caseTable=schemas.CaseTable.from_domain(table),
        job=schemas.Job.from_domain(job),
    )


def _unused() -> dict[str, Any]:  # pragma: no cover - keeps the Any import meaningful for type checkers
    return {}
