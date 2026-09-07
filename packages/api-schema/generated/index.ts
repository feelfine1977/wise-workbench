/**
 * Typed access to the WISE Workbench API contract.
 *
 * `schema.d.ts` is generated from `../openapi.yaml` with openapi-typescript
 * (`npm run generate` in apps/frontend). This file only adds readable aliases;
 * it carries no hand-written contract knowledge.
 */
import type { components, operations, paths } from "./schema";

export type { components, operations, paths };

type S = components["schemas"];

export type Problem = S["Problem"];
export type Project = S["Project"];
export type ProjectCreate = S["ProjectCreate"];
export type DatasetVersion = S["DatasetVersion"];
export type DatasetStatus = DatasetVersion["status"];
export type ColumnProfile = S["ColumnProfile"];
export type ColumnMapping = S["ColumnMapping"];
export type ColumnMappingOut = S["ColumnMappingOut"];
export type MappingSuggestion = S["MappingSuggestion"];
export type Preset = S["Preset"];
export type CaseTable = S["CaseTable"];
export type Readiness = S["Readiness"];
export type ReadinessItem = S["ReadinessItem"];
export type ReadinessLevel = ReadinessItem["level"];
export type NormVersion = S["NormVersion"];
export type NormVersionCreate = S["NormVersionCreate"];
export type NormStatus = NormVersion["status"];
export type NormCheck = S["NormCheck"];
export type SlicingSpec = S["SlicingSpec"];
export type RunCreate = S["RunCreate"];
export type Run = S["Run"];
export type RunStatus = Run["status"];
export type RunManifest = S["RunManifest"];
export type RunSummary = S["RunSummary"];
export type Table = S["Table"];
export type BacklogRow = S["BacklogRow"];
export type HotspotType = NonNullable<BacklogRow["hotspot_type"]>;
export type Kind = NonNullable<BacklogRow["kind"]>;
export type Stability = NonNullable<BacklogRow["stability"]>;
export type BacklogPage = S["BacklogPage"];
export type SliceDetail = S["SliceDetail"];
export type WorstCase = S["WorstCase"];
export type Trace = S["Trace"];
export type TraceEvent = S["TraceEvent"];
export type Distribution = S["Distribution"];
export type DistributionBin = S["DistributionBin"];
export type FlowGraph = S["FlowGraph"];
export type FlowNode = S["FlowNode"];
export type FlowEdge = S["FlowEdge"];
export type FlowGroup = S["FlowGroup"];
export type FlowOverlay = S["FlowOverlay"];
export type Job = S["Job"];
export type JobStatus = Job["status"];
/** The explore board (R3-O12): the breakdown bars, the four tiles and the run's plain manifest. */
export type Facets = S["Facets"];
export type FacetValue = S["FacetValue"];
export type Kpis = S["Kpis"];
export type KpiTile = S["KpiTile"];
export type RunManifestView = S["RunManifestView"];
export type ManifestRow = S["ManifestRow"];

export type BacklogQuery = NonNullable<operations["getBacklog"]["parameters"]["query"]>;
export type BacklogSort = NonNullable<BacklogQuery["sort"]>;

/** All paths of the contract, relative to the `/api/v1` server. */
export type ApiPath = keyof paths;
