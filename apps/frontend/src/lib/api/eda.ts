import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";

/** Norm-free, read-only case-table exploration; all counts come from one server selection. */
export interface EDAParams {
  datasetId: string;
  attribute?: string;
  insight?: boolean;
  compareAttribute?: string;
  hierarchyFields?: string[];
  valueField?: string;
  valueSearch?: string;
  valuePage?: number;
  eventInsight?: boolean;
  activitySearch?: string;
  activityPage?: number;
  endpointStart?: string;
  endpointEnd?: string;
  traceCaseId?: string;
  tracePage?: number;
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

export interface EDAContextPredicate { field: string; keys: string[]; values?: string[] }
export interface EDANumericFacet { field: string; ranges: { min?: string; max?: string }[]; missing: boolean }
export interface EDAJointPredicate { facets: EDAContextPredicate[] }
export interface EDAMultiSelection {
  facets?: EDAContextPredicate[];
  numericFacets?: EDANumericFacet[];
  jointAny?: EDAJointPredicate[];
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
export interface EDAValuePage { field: string; query: string; page: number; pageSize: number; totalValues: number; rows: { value: string; total: number; selected: number; selectable: boolean }[] }
export interface EDAHierarchy { fields: string[]; cells: { keys: string[]; labels: string[]; total: number; selected: number }[] }
export interface EDAEndpointCoverage {
  startActivity: string; endActivity: string; eligibleCases: number; pairedCases: number;
  startOnlyCases: number; endOnlyCases: number; neitherCases: number; undatedEndpointCases: number;
  reversedCases: number; ambiguousCases: number; medianDays: number | null; p90Days: number | null; rule: string;
}
export interface EDATrace {
  caseId: string; page: number; pageSize: number; total: number; undatedEvents: number;
  events: { position: number; activity: string | null; timestamp: string | null; lifecycle: string | null; resource: string | null; timestampTied: boolean }[];
  endpointStatus: string | null; endpointDays: number | null;
}
export interface EDAEventEvidence {
  eligibleCases: number; recordedEvents: number; casesWithoutEvents: number; missingActivityEvents: number; undatedEvents: number;
  activityPage: number; activityPageSize: number; totalActivities: number;
  activities: { activity: string | null; occurrences: number; cases: number; repeatedCases: number; zeroCases: number; presenceRate: number | null; repetitionRate: number | null }[];
  endpoints: EDAEndpointCoverage | null; trace: EDATrace | null; notes: string[];
}
export type EDAResult = components["schemas"]["EDAResponse"] & {
  values?: EDAValuePage | null; hierarchy?: EDAHierarchy | null; eventEvidence?: EDAEventEvidence | null;
};

export const edaQuery = (projectId: string, caseTableId: string, params: EDAParams) => {
  const query = { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 25 };
  return queryOptions({
    queryKey: ["projects", projectId, "case-tables", caseTableId, "eda", "linked-d3-v5", query] as const,
    queryFn: ({ signal }) => {
      if (query.selection !== undefined && !query.selection.trim()) throw new Error("EDA selection must be JSON; omit it to clear the selection.");
      const extended = query.hierarchyFields || query.valueField || query.eventInsight ||
        (query.selection && /"(?:numericFacets|jointAny|values)"\s*:/.test(query.selection));
      if (extended) return http.post<EDAResult>(`/projects/${encodeURIComponent(projectId)}/case-tables/${encodeURIComponent(caseTableId)}/eda/query`, query, undefined, signal);
      const { hierarchyFields: _hierarchy, eventInsight: _events, ...getQuery } = query;
      return http.get<EDAResult>(`/projects/${encodeURIComponent(projectId)}/case-tables/${encodeURIComponent(caseTableId)}/eda`, { ...getQuery, insight: query.insight === undefined ? undefined : Number(query.insight) }, signal);
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
};
