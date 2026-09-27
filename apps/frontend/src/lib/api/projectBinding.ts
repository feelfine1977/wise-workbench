import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";

export interface ProjectDatasetBinding {
  projectId: string;
  datasetId: string | null;
  boundAt: string | null;
}
const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/dataset-binding`;
function binding(value: ProjectDatasetBinding, projectId: string): ProjectDatasetBinding {
  if (!value || value.projectId !== projectId || !(value.datasetId === null && value.boundAt === null || typeof value.datasetId === "string" && !!value.datasetId && typeof value.boundAt === "string" && Number.isFinite(Date.parse(value.boundAt)))) {
    throw new Error("The project dataset binding could not be verified. Reload before continuing.");
  }
  return value;
}
export const projectBindingQuery = (projectId: string) => queryOptions({
  queryKey: ["projects", projectId, "dataset-binding"],
  queryFn: async () => binding(await http.get<ProjectDatasetBinding>(path(projectId)), projectId),
  retry: false,
  staleTime: 0,
});
export async function bindProjectDataset(projectId: string, datasetId: string) {
  return binding(await http.put<ProjectDatasetBinding>(path(projectId), { datasetId }), projectId);
}
export function useBindProjectDataset(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (datasetId: string) => bindProjectDataset(projectId, datasetId),
    onSuccess: async (saved) => {
      client.setQueryData(projectBindingQuery(projectId).queryKey, saved);
      await Promise.all(["datasets", "case-tables", "runs"].map((key) => client.invalidateQueries({ queryKey: ["projects", projectId, key] })));
    },
    // Another tab/process may have won. Read the authoritative binding, never optimistically rebind.
    onError: () => client.invalidateQueries({ queryKey: projectBindingQuery(projectId).queryKey }),
  });
}
