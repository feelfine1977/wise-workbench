import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";

/** Norm-free, read-only case-table exploration; all counts come from one server selection. */
export interface EDAParams {
  datasetId: string;
  attribute?: string;
  insight?: boolean;
  compareAttribute?: string;
  /** Existing {and:[attribute/time clauses]} contract. Unsupported clauses fail explicitly. */
  filter?: string;
  /** JSON EDAMultiSelection. Unions within dimensions, intersection across dimensions. */
  selection?: string;
  categoryMode?: "missing" | "other";
  timeMissing?: 1;
  spanMissing?: 1;
  spanMin?: number;
  /** Exclusive upper bound, shared by histogram clicks and the range form. */
  spanMax?: number;
  page?: number;
  pageSize?: number;
}

export interface EDAMultiSelection {
  facets?: { field: string; keys: string[] }[];
  eventRanges?: { min?: number; max?: number }[];
  eventMissing?: boolean;
  categoryKeys?: string[];
  timeRanges?: { from?: string; before?: string }[];
  timeMissing?: boolean;
  spanRanges?: { min?: number; max?: number }[];
  spanMissing?: boolean;
}

/** Generated DTOs are the wire contract; filters remain a small feature parameter type. */
export type EDACount = components["schemas"]["EDACount"];
export type EDACategory = components["schemas"]["EDACategory"];
export type EDAPeriod = components["schemas"]["EDAPeriod"];
export type EDASpan = components["schemas"]["EDASpan"];
export type EDARow = components["schemas"]["EDARow"];
export type EDAResult = components["schemas"]["EDAResponse"];

export const edaQuery = (projectId: string, caseTableId: string, params: EDAParams) => {
  const query = { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 25 };
  return queryOptions({
    queryKey: ["projects", projectId, "case-tables", caseTableId, "eda", "linked-d3-v4", query] as const,
    queryFn: () => {
      if (query.selection !== undefined && !query.selection.trim()) throw new Error("EDA selection must be JSON; omit it to clear the selection.");
      return http.get<EDAResult>(`/projects/${encodeURIComponent(projectId)}/case-tables/${encodeURIComponent(caseTableId)}/eda`, { ...query, insight: query.insight === undefined ? undefined : Number(query.insight) });
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
};
