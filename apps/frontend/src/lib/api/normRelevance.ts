import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";

import type { components } from "@wise/api-schema";
/** Observability and scope, never a pass/fail or approval score. */
export type ConstraintRelevance = components["schemas"]["NormRelevanceConstraint"];
export type NormRelevance = components["schemas"]["NormRelevance"];
export const normRelevanceQuery = (projectId: string, versionId: string, caseTableId: string) => queryOptions({
  queryKey: ["projects", projectId, "norms", versionId, "relevance", caseTableId] as const,
  queryFn: () => http.get<NormRelevance>(`/projects/${encodeURIComponent(projectId)}/norms/${encodeURIComponent(versionId)}/relevance`, { caseTableId }),
  enabled: !!projectId && !!versionId && !!caseTableId,
  staleTime: 1000 * 60 * 30,
  retry: false,
});
