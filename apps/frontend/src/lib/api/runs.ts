/** Feature API: runs. Generated DTOs remain the wire contract. */
import type { BacklogRow, Run, RunCreate, ManifestRow as GeneratedManifestRow, RunManifestView as GeneratedRunManifestView } from "@wise/api-schema";
import type { UncalibratedExpectation } from "./exploration";
import { keys } from "@/lib/queries";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const runKeys = {
  flowTypes: (p: string, ct: string, attribute?: string) => ["projects", p, "case-tables", ct, "flow-types", attribute ?? ""] as const,
  compareFlowTypes: (p: string, r: string, attribute?: string) => ["projects", p, "runs", r, "compare-flow-types", attribute ?? ""] as const,
};

export type RunScope = S["RunScope"];

export type FlowTypes = S["FlowTypes"];

export type FlowType = S["FlowType"];

export type FlowTypeReadiness = S["FlowTypeReadiness"];

export type FlowTypeComparison = S["FlowTypeComparison"];

/** A run with its scope read as the contract's `RunScope` (the generated type leaves it open). */
export type RunWithScope = Omit<Run, "scope"> & { scope?: RunScope | null };

export const scopeOf = (run: Run | RunWithScope | undefined): RunScope | undefined => ((run?.scope as RunScope | null | undefined) ?? undefined) || undefined;

export const flowTypeOf = (run: Run | RunWithScope | undefined): string | undefined => scopeOf(run)?.flow_type ?? undefined;

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

export const flowTypesQuery = (projectId: string, caseTableId: string, attribute?: string) =>
  queryOptions({
    queryKey: runKeys.flowTypes(projectId, caseTableId, attribute),
    queryFn: () => http.get<FlowTypes>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/flow-types`, { attribute }),
    staleTime: IMMUTABLE,
  });

export const compareFlowTypesQuery = (projectId: string, runId: string, attribute?: string) =>
  queryOptions({
    queryKey: runKeys.compareFlowTypes(projectId, runId, attribute),
    queryFn: () => http.get<FlowTypeComparison>(`/projects/${enc(projectId)}/runs/${enc(runId)}/compare-flow-types`, { attribute }),
    staleTime: IMMUTABLE,
  });

export function useCreateScopedRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunCreate) => http.post<Run>(`/projects/${enc(projectId)}/runs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.runs(projectId) }),
  });
}

/** One line of the run's plain manifest: what it is, what it was, and one note in the reader's words. */
export type ManifestRow = GeneratedManifestRow;

/** `GET …/runs/{id}/manifest`: the run a person reads, with the fingerprints kept apart. */
export type RunManifestView = Omit<GeneratedRunManifestView, "uncalibrated"> & { uncalibrated?: UncalibratedExpectation[] };

/**
 * The run's own account of itself. A backend that does not serve it answers 404 and the screen falls back to
 * the fields of the run record, so the plain block is never the reason a screen is empty.
 */
export const runManifestQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: ["projects", projectId, "runs", runId, "manifest"] as const,
    queryFn: () => http.get<RunManifestView>(`/projects/${enc(projectId)}/runs/${enc(runId)}/manifest`),
    staleTime: IMMUTABLE,
    retry: false,
  });

export type { RunCreate } from "@wise/api-schema";
export { runQuery, runsQuery, runSummaryQuery, useCreateRun } from "@/lib/queries";
