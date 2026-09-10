/** Feature API: analytics. Generated DTOs remain the wire contract. */
import type { Distribution } from "@wise/api-schema";
import type { Filter } from "./filter-types";
import { canonicalParam } from "./exploration";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const analyticsKeys = {
  analytics: (p: string, r: string) => ["projects", p, "runs", r, "analytics"] as const,
};

export type Caveat = S["Caveat"];

export type AnalyticsStatus = S["AnalyticsStatus"];

export const analyticsQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: analyticsKeys.analytics(projectId, runId),
    queryFn: () => http.get<AnalyticsStatus>(`/projects/${enc(projectId)}/runs/${enc(runId)}/analytics`),
  });

export function useRequestAnalytics(projectId: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<S["Job"]>(`/projects/${enc(projectId)}/runs/${enc(runId)}/analytics`),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.analytics(projectId, runId) }),
  });
}

/**
 * `GET …/runs/{id}/signals/{constraint}` with the canonical filter. A backend that does not filter the
 * distribution answers without echoing the filter; the panel then draws the unfiltered shape with the lock
 * chip and the words *all items*, so a filtered number is never shown beside an unfiltered one unnamed.
 */
export const distributionFilteredQuery = (projectId: string, runId: string, constraintId: string, params: { filter?: Filter; slicing?: string; sliceKey?: string }) => {
  const f = canonicalParam(params.filter) ?? "";
  return queryOptions({
    queryKey: ["projects", projectId, "runs", runId, "signals", constraintId, params.slicing ?? "", params.sliceKey ?? "", f] as const,
    queryFn: () =>
      http.get<Distribution & { filter?: Filter | null }>(`/projects/${enc(projectId)}/runs/${enc(runId)}/signals/${enc(constraintId)}`, {
        slicing: params.slicing,
        sliceKey: params.sliceKey,
        filter: f || undefined,
      }),
    staleTime: IMMUTABLE,
    placeholderData: (prev: (Distribution & { filter?: Filter | null }) | undefined) => prev,
  });
};

export { distributionQuery } from "@/lib/queries";
