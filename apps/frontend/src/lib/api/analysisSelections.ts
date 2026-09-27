import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { EDAMultiSelection } from "./eda";
export interface AnalysisSelection { id: string; name: string; datasetId: string; caseTableId: string; cases: number; createdAt: string; attribute?: string | null; selection: EDAMultiSelection | null }
const path = (p: string, ct: string) => `/projects/${encodeURIComponent(p)}/case-tables/${encodeURIComponent(ct)}/selections`;
export const analysisSelectionsQuery = (p: string, ct: string) => queryOptions({
  queryKey: ["projects", p, "case-tables", ct, "selections"],
  queryFn: () => http.get<AnalysisSelection[]>(path(p, ct)), retry: false,
});
export function useSaveAnalysisSelection(p: string, ct: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { name: string; datasetId: string; attribute?: string; selection: EDAMultiSelection | null }) => http.post<AnalysisSelection>(path(p, ct), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: analysisSelectionsQuery(p, ct).queryKey }),
  });
}
