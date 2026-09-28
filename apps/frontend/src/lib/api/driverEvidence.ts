import { queryOptions } from "@tanstack/react-query";
import type { components } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import type { SolutionCard } from "./solutionCards";
import { http } from "./transport";

export type DriverEvidence = Omit<components["schemas"]["DriverEvidence"], "solutionCard"> & { solutionCard?: SolutionCard | null };
export interface DriverEvidenceParams {
  constraintId: string;
  slicing: string;
  sliceKey: string;
  view?: string;
  /** Preserve invalid/empty input too: the server must reject it, never drop the selection. */
  filter?: string;
}

function sameKey(key: unknown, requested: string): boolean {
  try { return Array.isArray(key) && JSON.stringify(key) === JSON.stringify(JSON.parse(requested)); }
  catch { return false; }
}

/** Compare JSON content independently of object-key order, preserving array order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function requestedFilter(text: string | undefined): { value: unknown; filtered: boolean; valid: boolean } {
  if (text === undefined) return { value: null, filtered: false, valid: true };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { value: null, filtered: false, valid: false };
    // The endpoint accepts either a full filter or one clause, and keeps an explicit empty conjunction.
    const value = "and" in parsed ? parsed : { and: Object.keys(parsed).length ? [parsed] : [] };
    const clauses = (value as { and: unknown }).and;
    return { value, filtered: Array.isArray(clauses) && clauses.length > 0, valid: Array.isArray(clauses) };
  } catch { return { value: null, filtered: false, valid: false }; }
}

function checkedEvidence(data: DriverEvidence, projectId: string, runId: string, params: DriverEvidenceParams): DriverEvidence {
  const scope = data.scope;
  const expectedFilter = requestedFilter(params.filter);
  const counts = scope && [scope.selectedCases, scope.groupCases, scope.runCases, scope.fullCaseTableCases];
  if (data.source?.projectId !== projectId || data.source?.runId !== runId || data.constraintId !== params.constraintId ||
    scope?.slicing !== params.slicing || !sameKey(scope?.key, params.sliceKey) ||
    (params.view !== undefined && scope?.view !== params.view) ||
    typeof scope?.fingerprint !== "string" || !scope.fingerprint.trim() ||
    scope.population !== "selected_cases" || scope.ruleApplicabilityApplied !== false || scope.viewAffectsMeasurements !== false ||
    !expectedFilter.valid || scope.filtered !== expectedFilter.filtered ||
    canonical(scope.filter) !== canonical(expectedFilter.value) ||
    !counts || !counts.every((count, i) => Number.isSafeInteger(count) && count >= 0 && (i === 0 || count >= counts[i - 1]!))) {
    throw new ApiError(409, { status: 409, title: "Evidence scope unavailable", detail: "The response did not identify this exact run, group and filter. No whole-group evidence was substituted." });
  }
  return data;
}

export const driverEvidenceQuery = (projectId: string, runId: string, params: DriverEvidenceParams) => queryOptions({
  queryKey: ["projects", projectId, "runs", runId, "driver-evidence", params.constraintId, params.slicing, params.sliceKey, params.view ?? null, params.filter ?? null] as const,
  queryFn: async ({ signal }) => checkedEvidence(await http.get<DriverEvidence>(
    `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/driver-evidence`,
    { constraintId: params.constraintId, slicing: params.slicing, key: params.sliceKey, view: params.view, filter: params.filter },
    signal,
  ), projectId, runId, params),
  staleTime: 1000 * 60 * 30,
  retry: false,
});
