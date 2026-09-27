import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";

import type { components } from "@wise/api-schema";
export type ProcessVariant = components["schemas"]["ProcessVariant"];
export type ProcessVariantsResponse = components["schemas"]["ProcessVariants"];

export interface VariantsParams {
  filter?: string;
  slicing?: string;
  sliceKey?: string;
  bands?: string;
  limit?: number;
  exampleLimit?: number;
}

export const variantsQuery = (projectId: string, runId: string, params: VariantsParams = {}) => {
  const query = { ...params, limit: params.limit ?? 10, exampleLimit: params.exampleLimit ?? 3 };
  return queryOptions({
    // Keep raw filters intact, including unsupported clauses the backend must reject.
    queryKey: ["projects", projectId, "runs", runId, "variants", query] as const,
    queryFn: () => http.get<ProcessVariantsResponse>(`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/variants`, query),
    staleTime: 1000 * 60 * 30,
  });
};
