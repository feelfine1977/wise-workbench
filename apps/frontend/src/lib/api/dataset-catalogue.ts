import type { components, Job } from "@wise/api-schema";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";

export type DatasetCatalogue = components["schemas"]["DatasetCatalogue"];

export const datasetCatalogueQuery = (projectId: string) => queryOptions({
  queryKey: ["projects", projectId, "dataset-catalogue"],
  queryFn: () => http.get<DatasetCatalogue>(`/projects/${encodeURIComponent(projectId)}/dataset-catalogue`),
  staleTime: 0,
});

export function useImportCatalogueDataset(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => http.post<Job>(`/projects/${encodeURIComponent(projectId)}/dataset-catalogue/imports/${encodeURIComponent(entryId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", projectId] }),
  });
}
