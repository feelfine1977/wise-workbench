import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { Filter } from "./filter-types";
import type { components } from "@wise/api-schema";
type S = components["schemas"];

export const investigationFamilies = ["overview", "frequency", "repetition", "timing", "sequence", "boundaries", "identity", "missingness"] as const;
export type InvestigationFamily = typeof investigationFamilies[number];
export interface InvestigationParams {
  filter?: string;
  family?: InvestigationFamily;
  activity?: string;
  source?: string;
  target?: string;
  relation?: "direct" | "eventual";
}
export type InvestigationMetric = S["InvestigationMetric"];
export type InvestigationQuestion = Omit<S["InvestigationQuestion"], "filter"> & {filter: Filter | null};
export type InvestigationQuestions = Omit<S["InvestigationQuestions"], "questions" | "filter"> & {filter?:Filter|null;questions: InvestigationQuestion[]};
export const investigationQuery = (projectId: string, runId: string, params: InvestigationParams = {}) => queryOptions({
  queryKey: ["projects", projectId, "runs", runId, "investigation-questions", params],
  queryFn: () => http.get<InvestigationQuestions>(`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/investigation-questions`, { ...params, limit: 5 }),
  staleTime: 1000 * 60 * 30,
});
