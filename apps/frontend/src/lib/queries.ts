import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { BacklogQuery, ColumnMapping, Job, NormVersionCreate, RunCreate } from "@wise/api-schema";
import { api, unwrap } from "./api";
import { apiBase } from "./config";

export const keys = {
  version: ["system", "version"] as const,
  projects: ["projects"] as const,
  project: (p: string) => ["projects", p] as const,
  datasets: (p: string) => ["projects", p, "datasets"] as const,
  dataset: (p: string, d: string) => ["projects", p, "datasets", d] as const,
  caseTables: (p: string) => ["projects", p, "case-tables"] as const,
  caseTable: (p: string, c: string) => ["projects", p, "case-tables", c] as const,
  mappingSuggestion: (p: string, d: string) => ["projects", p, "datasets", d, "mapping-suggestion"] as const,
  presets: (p: string) => ["projects", p, "presets"] as const,
  norms: (p: string) => ["projects", p, "norms"] as const,
  norm: (p: string, n: string) => ["projects", p, "norms", n] as const,
  runs: (p: string) => ["projects", p, "runs"] as const,
  run: (p: string, r: string) => ["projects", p, "runs", r] as const,
  runSummary: (p: string, r: string) => ["projects", p, "runs", r, "summary"] as const,
  backlog: (p: string, r: string, q: BacklogQuery) => ["projects", p, "runs", r, "backlog", q] as const,
  slice: (p: string, r: string, key: string, slicing: string, view?: string) =>
    ["projects", p, "runs", r, "slices", key, slicing, view ?? ""] as const,
  trace: (p: string, r: string, c: string) => ["projects", p, "runs", r, "cases", c, "trace"] as const,
  distribution: (p: string, r: string, c: string, slicing?: string, sliceKey?: string) =>
    ["projects", p, "runs", r, "signals", c, slicing ?? "", sliceKey ?? ""] as const,
  diagnostics: (p: string, r: string, slicing: string) => ["projects", p, "runs", r, "diagnostics", slicing] as const,
  flow: (p: string, r: string, slicing?: string, sliceKey?: string, abstraction?: number) =>
    ["projects", p, "runs", r, "flow", slicing ?? "", sliceKey ?? "", abstraction ?? 0.05] as const,
  job: (j: string) => ["jobs", j] as const,
};

const IMMUTABLE = 1000 * 60 * 30;

export const versionQuery = queryOptions({
  queryKey: keys.version,
  queryFn: async () => unwrap(await api.GET("/system/version")),
  staleTime: Infinity,
});

export const projectsQuery = queryOptions({
  queryKey: keys.projects,
  queryFn: async () => unwrap(await api.GET("/projects")),
});

export const projectQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.project(projectId),
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}", { params: { path: { projectId } } })),
  });

export const datasetsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.datasets(projectId),
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}/datasets", { params: { path: { projectId } } })),
  });

export const datasetQuery = (projectId: string, datasetId: string) =>
  queryOptions({
    queryKey: keys.dataset(projectId, datasetId),
    queryFn: async () =>
      unwrap(await api.GET("/projects/{projectId}/datasets/{datasetId}", { params: { path: { projectId, datasetId } } })),
  });

export const caseTableQuery = (projectId: string, caseTableId: string) =>
  queryOptions({
    queryKey: keys.caseTable(projectId, caseTableId),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/case-tables/{caseTableId}", { params: { path: { projectId, caseTableId } } }),
      ),
    staleTime: IMMUTABLE,
  });

export const caseTablesQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.caseTables(projectId),
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}/case-tables", { params: { path: { projectId } } })),
  });

export const mappingSuggestionQuery = (projectId: string, datasetId: string) =>
  queryOptions({
    queryKey: keys.mappingSuggestion(projectId, datasetId),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/datasets/{datasetId}/mapping-suggestion", {
          params: { path: { projectId, datasetId } },
        }),
      ),
    staleTime: IMMUTABLE,
  });

export const presetsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.presets(projectId),
    queryFn: async () =>
      unwrap(await api.GET("/projects/{projectId}/datasets/presets", { params: { path: { projectId } } })),
  });

export const normsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.norms(projectId),
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}/norms", { params: { path: { projectId } } })),
  });

export const normQuery = (projectId: string, normVersionId: string) =>
  queryOptions({
    queryKey: keys.norm(projectId, normVersionId),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/norms/{normVersionId}", { params: { path: { projectId, normVersionId } } }),
      ),
    staleTime: IMMUTABLE,
  });

export const runsQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.runs(projectId),
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}/runs", { params: { path: { projectId } } })),
  });

export const runQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: keys.run(projectId, runId),
    queryFn: async () =>
      unwrap(await api.GET("/projects/{projectId}/runs/{runId}", { params: { path: { projectId, runId } } })),
  });

export const runSummaryQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: keys.runSummary(projectId, runId),
    queryFn: async () =>
      unwrap(await api.GET("/projects/{projectId}/runs/{runId}/summary", { params: { path: { projectId, runId } } })),
    staleTime: IMMUTABLE,
  });

export const backlogQuery = (projectId: string, runId: string, query: BacklogQuery) =>
  queryOptions({
    queryKey: keys.backlog(projectId, runId, query),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/runs/{runId}/backlog", { params: { path: { projectId, runId }, query } }),
      ),
    staleTime: IMMUTABLE,
    placeholderData: (prev) => prev,
  });

export const sliceQuery = (projectId: string, runId: string, sliceKey: string, slicing: string, view?: string, drilldown?: string) =>
  queryOptions({
    queryKey: [...keys.slice(projectId, runId, sliceKey, slicing, view), drilldown ?? ""] as const,
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/runs/{runId}/slices/{sliceKey}", {
          params: { path: { projectId, runId, sliceKey }, query: { slicing, ...(view ? { view } : {}), ...(drilldown ? { drilldown } : {}) } },
        }),
      ),
    staleTime: IMMUTABLE,
  });

export const traceQuery = (projectId: string, runId: string, caseId: string) =>
  queryOptions({
    queryKey: keys.trace(projectId, runId, caseId),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/runs/{runId}/cases/{caseId}/trace", {
          params: { path: { projectId, runId, caseId } },
        }),
      ),
    staleTime: IMMUTABLE,
  });

export const distributionQuery = (projectId: string, runId: string, constraintId: string, slicing?: string, sliceKey?: string) =>
  queryOptions({
    queryKey: keys.distribution(projectId, runId, constraintId, slicing, sliceKey),
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/runs/{runId}/signals/{constraintId}", {
          params: {
            path: { projectId, runId, constraintId },
            query: { ...(slicing ? { slicing } : {}), ...(sliceKey ? { sliceKey } : {}) },
          },
        }),
      ),
    staleTime: IMMUTABLE,
  });

export interface FlowParams {
  slicing?: string;
  sliceKey?: string;
  abstraction?: number;
  /** The filter model (CONTRACT_CYCLE2.md, flow additions). */
  filter?: string;
}

export const flowQuery = (projectId: string, runId: string, params: FlowParams = {}) =>
  queryOptions({
    queryKey: [...keys.flow(projectId, runId, params.slicing, params.sliceKey, params.abstraction), params.filter ?? ""] as const,
    queryFn: async () =>
      unwrap(
        await api.GET("/projects/{projectId}/runs/{runId}/flow", {
          params: {
            path: { projectId, runId },
            query: {
              ...(params.slicing ? { slicing: params.slicing } : {}),
              ...(params.sliceKey ? { sliceKey: params.sliceKey } : {}),
              ...(params.filter ? { filter: params.filter } : {}),
              abstraction: params.abstraction ?? 0.05,
            },
          },
        }),
      ),
    staleTime: IMMUTABLE,
  });

export const jobQuery = (jobId: string) =>
  queryOptions({
    queryKey: keys.job(jobId),
    queryFn: async () => unwrap(await api.GET("/jobs/{jobId}", { params: { path: { jobId } } })),
  });

const ACTIVE: ReadonlySet<Job["status"]> = new Set(["queued", "running"]);
export const isJobActive = (job: Job | undefined) => !!job && ACTIVE.has(job.status);

const canStream = () => typeof EventSource !== "undefined";

/**
 * Follows a job: `GET /jobs/{id}` once, then `GET /jobs/{id}/events` over EventSource (progress and the
 * terminal `done` event update the cached job); where EventSource is unavailable or the stream fails,
 * the query polls every `intervalMs` while the job is queued or running.
 */
export function useJob(jobId: string | undefined, intervalMs = 700) {
  const qc = useQueryClient();
  const [streamFailed, setStreamFailed] = useState(false);
  const polling = streamFailed || !canStream();
  const query = useQuery({
    ...jobQuery(jobId ?? ""),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data !== undefined && !isJobActive(data)) return false;
      return polling ? intervalMs : false;
    },
  });
  const active = query.data === undefined || isJobActive(query.data);

  useEffect(() => {
    if (!jobId || !active || polling) return;
    const source = new EventSource(`${apiBase}/jobs/${encodeURIComponent(jobId)}/events`);
    const apply = (event: MessageEvent) => {
      try {
        const patch = JSON.parse(String(event.data)) as Partial<Job>;
        qc.setQueryData<Job>(keys.job(jobId), (prev) => (prev ? { ...prev, ...patch } : prev));
      } catch {
        /* a malformed event is ignored; the next one or the poll corrects it */
      }
    };
    source.addEventListener("progress", apply);
    source.addEventListener("done", (event) => {
      apply(event);
      source.close();
      void qc.invalidateQueries({ queryKey: keys.job(jobId) });
    });
    source.onerror = () => {
      source.close();
      setStreamFailed(true);
    };
    return () => source.close();
  }, [jobId, active, polling, qc]);

  return query;
}

/** The transport `useJob` uses in this environment, for the job tray's label. */
export const jobTransport = (): "stream" | "poll" => (canStream() ? "stream" : "poll");

export function useUploadDataset(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name?: string }) => {
      const body = new FormData();
      body.append("file", input.file);
      if (input.name) body.append("name", input.name);
      return unwrap(
        await api.POST("/projects/{projectId}/datasets", {
          params: { path: { projectId } },
          // The multipart body is built by hand; openapi-fetch would JSON-encode a plain object.
          body: body as unknown as { file: string; name?: string | null },
          bodySerializer: (b) => b as unknown as BodyInit,
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.datasets(projectId) }),
  });
}

export function useCreateMapping(projectId: string, datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapping: ColumnMapping) =>
      unwrap(
        await api.POST("/projects/{projectId}/datasets/{datasetId}/mappings", {
          params: { path: { projectId, datasetId } },
          body: mapping,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.datasets(projectId) }),
  });
}

export function useCreateNormVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: NormVersionCreate) =>
      unwrap(await api.POST("/projects/{projectId}/norms", { params: { path: { projectId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.norms(projectId) }),
  });
}

/**
 * Move a norm version along draft → reviewed → approved (R3-02, P1-9).
 *
 * The endpoint has been there since the cycle's backend work and no screen called it, so a version could be
 * committed in the browser and never signed: the exit criterion — *the norm version moved out of `draft` by a
 * named person* — could not be met without a request by hand. Leaving draft asks for that person; the server
 * refuses it, with its own sentence, while a threshold this version set still carries no rationale or owner.
 */
export function useSetNormStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { normVersionId: string; status: "draft" | "reviewed" | "approved"; author: string }) =>
      unwrap(
        await api.PATCH("/projects/{projectId}/norms/{normVersionId}", {
          params: { path: { projectId, normVersionId: input.normVersionId } },
          body: { status: input.status, author: input.author },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.norms(projectId) }),
  });
}

export function useCreateRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunCreate) =>
      unwrap(
        await api.POST("/projects/{projectId}/runs", {
          params: { path: { projectId }, header: { "Idempotency-Key": crypto.randomUUID() } },
          body,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.runs(projectId) }),
  });
}

export function useLoadPreset(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (presetId: string) =>
      unwrap(
        await api.POST("/projects/{projectId}/datasets/presets/{presetId}", {
          params: { path: { projectId, presetId } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.datasets(projectId) }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.DELETE("/jobs/{jobId}", { params: { path: { jobId } } });
      if (!res.response.ok) throw new Error(`Cancel failed (${res.response.status})`);
      return jobId;
    },
    onSuccess: (jobId) => qc.invalidateQueries({ queryKey: keys.job(jobId) }),
  });
}
