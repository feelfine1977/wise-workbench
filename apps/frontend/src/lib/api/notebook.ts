/** Feature API: notebook. Generated DTOs remain the wire contract. */
import type { Filter } from "./filter-types";
import type { RunScope } from "./runs";
import { apiBase } from "@/lib/config";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;

const notebookKeys = {
  notebook: (p: string) => ["projects", p, "notebook"] as const,
};

export type Notebook = S["Notebook"];

export type Snapshot = S["Snapshot"];

export type SnapshotUpdate = S["SnapshotUpdate"];

/** Snapshot context as the screens write it (`SnapshotCreate.context` in the contract). */
export interface SnapshotContext {
  screen: string;
  url: string;
  run_id?: string | null;
  slicing?: string | null;
  view?: string | null;
  slice_key?: string | null;
  filters?: Filter | null;
  scope?: RunScope | null;
}

export interface SnapshotCreate {
  title: string;
  note: string;
  context: SnapshotContext;
  data?: unknown;
  author?: string;
  /** PNG of the screen; omitted when client capture failed (the backend renders from the context). */
  image?: Blob;
}

export const notebookQuery = (projectId: string) =>
  queryOptions({
    queryKey: notebookKeys.notebook(projectId),
    queryFn: () => http.get<Notebook>(`/projects/${enc(projectId)}/notebook`),
  });

export const notebookExportUrl = (projectId: string, format: "markdown" = "markdown") => `${apiBase}/projects/${enc(projectId)}/notebook/export?format=${format}`;

export const snapshotImageUrl = (snapshot: Snapshot): string | undefined => {
  if (!snapshot.hasImage && !snapshot.imageUrl) return undefined;
  const raw = snapshot.imageUrl ?? `/api/v1/projects/${enc(snapshot.projectId)}/notebook/snapshots/${enc(snapshot.id)}/image`;
  if (/^https?:/.test(raw)) return raw;
  const origin = apiBase.replace(/\/api\/v1$/, "");
  return raw.startsWith("/api/") ? `${origin}${raw}` : `${apiBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
};

export function useCreateSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SnapshotCreate) => {
      const form = new FormData();
      form.append("payload", JSON.stringify({ title: input.title, note: input.note, context: input.context, data: input.data ?? null, author: input.author ?? null }));
      if (input.image) form.append("image", input.image, "screen.png");
      return http.postForm<Snapshot>(`/projects/${enc(projectId)}/notebook/snapshots`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.notebook(projectId) }),
  });
}

export function useUpdateSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & SnapshotUpdate) => http.patch<Snapshot>(`/projects/${enc(projectId)}/notebook/snapshots/${enc(input.id)}`, { title: input.title, note: input.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.notebook(projectId) }),
  });
}

export function useDeleteSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.delete<void>(`/projects/${enc(projectId)}/notebook/snapshots/${enc(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.notebook(projectId) }),
  });
}

export function useReorderSnapshots(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => http.post<Notebook>(`/projects/${enc(projectId)}/notebook/reorder`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.notebook(projectId) }),
  });
}
