/**
 * Cycle-2 contract: the operations of `packages/api-schema/openapi.yaml` that arrived with this cycle
 * (flow types, run scope, decisions on readiness items, the filter model, drill-in, slicing preview,
 * analytics status, the notebook). The response shapes come from the generated types; only the filter
 * clauses (a JSON object the contract leaves open) are written here. Requests go through `fetch` on the
 * same base URL as the generated client and raise `ApiError` on RFC 9457 problems.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BacklogRow, FlowGraph, Problem, Run, RunCreate, SliceDetail, components } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import { apiBase } from "@/lib/config";
import { keys } from "@/lib/queries";

type S = components["schemas"];

// ---------------------------------------------------------------- generated shapes, under the names the screens use

export type Caveat = S["Caveat"];
export type RunScope = S["RunScope"];
export type BandSpec = S["BandSpec"];
export type SlicingSpecC2 = S["SlicingSpec"];
export type RunCreateC2 = RunCreate;
export type FlowTypes = S["FlowTypes"];
export type FlowType = S["FlowType"];
export type FlowTypeReadiness = S["FlowTypeReadiness"];
export type FlowTypeComparison = S["FlowTypeComparison"];
export type FlowPaths = S["FlowPaths"];
export type FlowPath = S["FlowPath"];
export type FilterPreview = S["FilterPreview"];
export type SlicingPreview = S["SlicingPreview"];
export type AnalyticsStatus = S["AnalyticsStatus"];
export type DecisionKind = S["DecisionKind"];
export type Decision = S["Decision"];
export type DecisionRequest = S["DecisionRequest"];
export type DecisionPreviewOut = S["DecisionPreviewOut"];
export type DecisionApplied = S["DecisionApplied"];
export type Notebook = S["Notebook"];
export type Snapshot = S["Snapshot"];
export type SnapshotUpdate = S["SnapshotUpdate"];
export type GuidanceRef = S["GuidanceRefOut"];
export type BacklogRowC2 = BacklogRow;
export type SliceDetailC2 = SliceDetail;
export type FlowGraphC2 = FlowGraph;

/** A run with its scope read as the contract's `RunScope` (the generated type leaves it open). */
export type RunC2 = Omit<Run, "scope"> & { scope?: RunScope | null };
export const scopeOf = (run: Run | RunC2 | undefined): RunScope | undefined => ((run?.scope as RunScope | null | undefined) ?? undefined) || undefined;
export const flowTypeOf = (run: Run | RunC2 | undefined): string | undefined => scopeOf(run)?.flow_type ?? undefined;

/** The `params` block of a backlog page as the backend fills it in this cycle. */
export interface BacklogParamsC2 {
  slicing?: string;
  attributes?: string[];
  bands?: unknown[];
  view?: string;
  gamma?: number;
  minCases?: number;
  window_end?: string | null;
  case_noun?: string | null;
  scope?: RunScope | null;
  drill?: { slicing: string; attributes: string[]; key: unknown[] } | null;
  filter?: Filter | null;
  /** Cases the filter (or the drill) keeps. */
  cases?: number | null;
  analytics_record_ids?: Record<string, string>;
  analytics_available?: boolean;
  stability_applies?: boolean;
  /** Set by the mocks on slicings whose rows are made up rather than read from the verified run. */
  illustrative?: boolean;
  /** Expectations whose threshold needs calibrating on this log (R2-09): the run's own list. */
  uncalibrated?: UncalibratedExpectation[];
}

/** One entry of `params.uncalibrated`: an expectation that separates no group on this log. */
export interface UncalibratedExpectation {
  id: string;
  layer?: string;
  plain_name?: string | null;
  description?: string | null;
  share_violated?: number;
  evaluated?: number;
  reason?: string;
  text?: string;
}

/** The run's uncalibrated expectations by id, for the chips that flag them wherever they are named. */
export function uncalibratedById(params: BacklogParamsC2 | undefined): Map<string, UncalibratedExpectation> {
  return new Map((params?.uncalibrated ?? []).map((u) => [u.id, u]));
}

/** One element of `FlowTypeComparison.types` (the contract leaves it open). */
export interface FlowTypeComparisonEntry {
  name: string;
  cases: number;
  share: number;
  views: Record<string, { mean_score: number; gap: number; points_below?: string | null }>;
  mostMissed?: { constraint: string; description: string; plain_name?: string | null; share: number } | null;
  censoredShare?: number | null;
  topGroups: { key: string; keys?: Record<string, string>; n_cases: number; stable_PI: number; gap: number; kind?: BacklogRow["kind"]; reading?: string | null }[];
  scope: RunScope;
  /** Set by the client from the runs list: the run that analyses this flow type alone. */
  runId?: string | null;
}

/** `Decision.preview` and `DecisionPreviewOut.preview`. */
export interface DecisionPreviewNumbers {
  cases: number;
  events: number;
  totalCases: number;
  totalEvents: number;
  detail?: Record<string, unknown>;
}

/** Snapshot context as the screens write it (`SnapshotCreate.context` in the contract). */
export interface SnapshotContext {
  screen: string;
  url: string;
  run_id?: string | null;
  slicing?: string | null;
  view?: string | null;
  slice_key?: string | null;
  filters?: Filter | null;
  scope?: RunScope | null;
}

export interface SnapshotCreate {
  title: string;
  note: string;
  context: SnapshotContext;
  data?: unknown;
  author?: string;
  /** PNG of the screen; omitted when client capture failed (the backend renders from the context). */
  image?: Blob;
}

/** Drill into one group (R2-O2): the finer slicing is restricted to the group's cases. */
export interface Within {
  slicing: string;
  key: string;
}

// ---------------------------------------------------------------- filters (RF-01, RF-09, RF-10)

export type TimeMode = "case_start" | "case_end" | "active" | "events_inside";
export interface TimeClause { kind: "time"; field?: TimeMode; from?: string; to?: string }
export interface AttributeClause { kind: "attribute"; field: string; in?: string[]; not_in?: string[]; range?: [number | null, number | null]; missing?: boolean }
export interface ActivityClause { kind: "activity"; op: "contains" | "not_contains" | "starts_with" | "ends_with" | "never"; activity: string }
export interface FollowsClause { kind: "follows"; a: string; b: string; directly?: boolean; never?: boolean }
export interface LagClause { kind: "lag"; a: string; b: string; unit?: "D" | "H" | "M" | "S"; min?: number; max?: number; directly?: boolean }
export interface CountClause { kind: "count"; activity: string; min?: number; max?: number }
export interface OpenClause { kind: "open"; value: boolean }
export interface ConstraintClause { kind: "constraint"; constraint: string; state: "violating" | "satisfied" | "in_scope" | "out_of_scope"; label?: string }
export interface SliceClause { kind: "slice"; slicing: string; key: unknown }
export interface AnyClause { kind: "any"; clauses: FilterClause[] }
export type FilterClause = TimeClause | AttributeClause | ActivityClause | FollowsClause | LagClause | CountClause | OpenClause | ConstraintClause | SliceClause | AnyClause;
export interface Filter { and: FilterClause[] }

// ---------------------------------------------------------------- transport

const enc = encodeURIComponent;

async function problemOf(res: Response): Promise<Problem | undefined> {
  try {
    return (await res.json()) as Problem;
  } catch {
    return undefined;
  }
}

async function request<T>(method: string, path: string, init: { body?: unknown; form?: FormData; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const url = new URL(`${apiBase}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await globalThis.fetch(url.toString(), { method, headers, body });
  if (!res.ok) throw new ApiError(res.status, await problemOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const c2 = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, query?: Record<string, string | number | undefined>) => request<T>("POST", path, { body, query }),
  postForm: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export const filterParam = (f: Filter | undefined): string | undefined => (f && f.and.length ? JSON.stringify(f) : undefined);
export const bandsParam = (bands: BandSpec[] | undefined): string | undefined => (bands && bands.length ? JSON.stringify(bands) : undefined);

// ---------------------------------------------------------------- queries

const IMMUTABLE = 1000 * 60 * 30;

export const keys2 = {
  filterPreview: (p: string, r: string, filter: string) => ["projects", p, "runs", r, "filters", "preview", filter] as const,
  slicingPreview: (p: string, r: string, slicing: string, bands: string, minCases: number) => ["projects", p, "runs", r, "slicings", "preview", slicing, bands, minCases] as const,
  analytics: (p: string, r: string) => ["projects", p, "runs", r, "analytics"] as const,
  flowTypes: (p: string, ct: string, attribute?: string) => ["projects", p, "case-tables", ct, "flow-types", attribute ?? ""] as const,
  compareFlowTypes: (p: string, r: string, attribute?: string) => ["projects", p, "runs", r, "compare-flow-types", attribute ?? ""] as const,
  notebook: (p: string) => ["projects", p, "notebook"] as const,
  decisionKinds: (p: string) => ["projects", p, "decisions", "kinds"] as const,
  decisions: (p: string, ct?: string) => ["projects", p, "decisions", ct ?? ""] as const,
  flowFocused: (p: string, r: string, slicing: string | undefined, sliceKey: string | undefined, focus: string, filter: string | undefined) => ["projects", p, "runs", r, "flow", "focus", slicing ?? "", sliceKey ?? "", focus, filter ?? ""] as const,
};

export const filterPreviewQuery = (projectId: string, runId: string, filter: Filter | undefined) => {
  const f = filterParam(filter) ?? "";
  return queryOptions({
    queryKey: keys2.filterPreview(projectId, runId, f),
    queryFn: () => c2.get<FilterPreview>(`/projects/${enc(projectId)}/runs/${enc(runId)}/filters/preview`, { filter: f }),
    staleTime: IMMUTABLE,
  });
};

export const slicingPreviewQuery = (projectId: string, runId: string, attributes: string[], bands: BandSpec[] | undefined, minCases: number) => {
  const slicing = attributes.join(",");
  const b = bandsParam(bands) ?? "";
  return queryOptions({
    queryKey: keys2.slicingPreview(projectId, runId, slicing, b, minCases),
    queryFn: () => c2.get<SlicingPreview>(`/projects/${enc(projectId)}/runs/${enc(runId)}/slicings/preview`, { slicing, bands: b || undefined, minCases }),
    staleTime: IMMUTABLE,
  });
};

export const analyticsQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: keys2.analytics(projectId, runId),
    queryFn: () => c2.get<AnalyticsStatus>(`/projects/${enc(projectId)}/runs/${enc(runId)}/analytics`),
  });

export const flowTypesQuery = (projectId: string, caseTableId: string, attribute?: string) =>
  queryOptions({
    queryKey: keys2.flowTypes(projectId, caseTableId, attribute),
    queryFn: () => c2.get<FlowTypes>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/flow-types`, { attribute }),
    staleTime: IMMUTABLE,
  });

export const compareFlowTypesQuery = (projectId: string, runId: string, attribute?: string) =>
  queryOptions({
    queryKey: keys2.compareFlowTypes(projectId, runId, attribute),
    queryFn: () => c2.get<FlowTypeComparison>(`/projects/${enc(projectId)}/runs/${enc(runId)}/compare-flow-types`, { attribute }),
    staleTime: IMMUTABLE,
  });

export const notebookQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys2.notebook(projectId),
    queryFn: () => c2.get<Notebook>(`/projects/${enc(projectId)}/notebook`),
  });

export const decisionKindsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys2.decisionKinds(projectId),
    queryFn: () => c2.get<DecisionKind[]>(`/projects/${enc(projectId)}/decisions/kinds`),
    staleTime: IMMUTABLE,
  });

export const decisionsQuery = (projectId: string, caseTableId?: string) =>
  queryOptions({
    queryKey: keys2.decisions(projectId, caseTableId),
    queryFn: () => c2.get<Decision[]>(`/projects/${enc(projectId)}/decisions`, { caseTableId }),
  });

/** The flow endpoint with `filter` and `focus` (the `paths` block) of the contract. */
export const flowFocusedQuery = (projectId: string, runId: string, params: { slicing?: string; sliceKey?: string; focus: string; filter?: Filter; abstraction?: number }) => {
  const f = filterParam(params.filter);
  return queryOptions({
    queryKey: keys2.flowFocused(projectId, runId, params.slicing, params.sliceKey, params.focus, f),
    queryFn: () =>
      c2.get<FlowGraph>(`/projects/${enc(projectId)}/runs/${enc(runId)}/flow`, { slicing: params.slicing, sliceKey: params.sliceKey, focus: params.focus, filter: f, abstraction: params.abstraction ?? 0.05 }),
    staleTime: IMMUTABLE,
  });
};

export const notebookExportUrl = (projectId: string, format: "markdown" = "markdown") => `${apiBase}/projects/${enc(projectId)}/notebook/export?format=${format}`;
export const snapshotImageUrl = (snapshot: Snapshot): string | undefined => {
  if (!snapshot.hasImage && !snapshot.imageUrl) return undefined;
  const raw = snapshot.imageUrl ?? `/api/v1/projects/${enc(snapshot.projectId)}/notebook/snapshots/${enc(snapshot.id)}/image`;
  if (/^https?:/.test(raw)) return raw;
  const origin = apiBase.replace(/\/api\/v1$/, "");
  return raw.startsWith("/api/") ? `${origin}${raw}` : `${apiBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
};

// ---------------------------------------------------------------- mutations

export function useCreateScopedRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunCreateC2) => c2.post<Run>(`/projects/${enc(projectId)}/runs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.runs(projectId) }),
  });
}

export function useRequestAnalytics(projectId: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => c2.post<S["Job"]>(`/projects/${enc(projectId)}/runs/${enc(runId)}/analytics`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys2.analytics(projectId, runId) }),
  });
}

export function useCreateSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SnapshotCreate) => {
      const form = new FormData();
      form.append("payload", JSON.stringify({ title: input.title, note: input.note, context: input.context, data: input.data ?? null, author: input.author ?? null }));
      if (input.image) form.append("image", input.image, "screen.png");
      return c2.postForm<Snapshot>(`/projects/${enc(projectId)}/notebook/snapshots`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys2.notebook(projectId) }),
  });
}

export function useUpdateSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & SnapshotUpdate) => c2.patch<Snapshot>(`/projects/${enc(projectId)}/notebook/snapshots/${enc(input.id)}`, { title: input.title, note: input.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys2.notebook(projectId) }),
  });
}

export function useDeleteSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => c2.delete<void>(`/projects/${enc(projectId)}/notebook/snapshots/${enc(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys2.notebook(projectId) }),
  });
}

export function useReorderSnapshots(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => c2.post<Notebook>(`/projects/${enc(projectId)}/notebook/reorder`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys2.notebook(projectId) }),
  });
}

export function usePreviewDecision(projectId: string, caseTableId: string) {
  return useMutation({
    mutationFn: (body: DecisionRequest) => c2.post<DecisionPreviewOut>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/decisions/preview`, body),
  });
}

export function useApplyDecision(projectId: string, caseTableId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DecisionRequest) => c2.post<DecisionApplied>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/decisions`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects", projectId, "decisions"] });
      void qc.invalidateQueries({ queryKey: keys.caseTables(projectId) });
      void qc.invalidateQueries({ queryKey: keys.caseTable(projectId, caseTableId) });
    },
  });
}
