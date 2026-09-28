import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { GroupingDefinition } from "../grouping";

export interface GroupingAttribute { name: string; type: string; distinct: number; missing: number; description?: string }
export interface GroupingSuggestion extends GroupingDefinition { id: string; label: string; description: string }
export interface GroupingOptions { cases: number; attributes: GroupingAttribute[]; suggestions: GroupingSuggestion[] }
export const groupingOptionsQuery = (projectId: string, runId: string) => queryOptions({
  queryKey: ["projects", projectId, "runs", runId, "slicings", "options"],
  queryFn: () => http.get<GroupingOptions>(`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/slicings/options`),
  staleTime: 1000 * 60 * 30,
});
