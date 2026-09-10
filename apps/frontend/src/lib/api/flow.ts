/** Feature API: flow. Generated DTOs remain the wire contract. */
import type { FlowGraph } from "@wise/api-schema";
import type { Filter } from "./filter-types";
import { filterParam, canonicalParam } from "./exploration";
import { apiBase } from "@/lib/config";
import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const flowKeys = {
  flowFocused: (p: string, r: string, slicing: string | undefined, sliceKey: string | undefined, focus: string, filter: string | undefined) => ["projects", p, "runs", r, "flow", "focus", slicing ?? "", sliceKey ?? "", focus, filter ?? ""] as const,
};

export type FlowPaths = S["FlowPaths"];

export type FlowPath = S["FlowPath"];

/** `graph.paths` of `GET …/flow?focus=`, with what the backend says about paths below the detail level. */
export interface ActivityPaths {
  focus: string;
  incoming: Record<string, unknown>[];
  outgoing: Record<string, unknown>[];
  /** Paths of the activity that the current detail level does not draw (R3-O8). */
  hidden: number;
}

/** The flow endpoint with `filter` and `focus` (the `paths` block) of the contract. */
export const flowFocusedQuery = (projectId: string, runId: string, params: { slicing?: string; sliceKey?: string; focus: string; filter?: Filter; abstraction?: number }) => {
  const f = filterParam(params.filter);
  return queryOptions({
    queryKey: flowKeys.flowFocused(projectId, runId, params.slicing, params.sliceKey, params.focus, f),
    queryFn: () =>
      http.get<FlowGraph>(`/projects/${enc(projectId)}/runs/${enc(runId)}/flow`, { slicing: params.slicing, sliceKey: params.sliceKey, focus: params.focus, filter: f, abstraction: params.abstraction ?? 0.05 }),
    staleTime: IMMUTABLE,
  });
};

/** The flow as BPMN 2.0 from the server (§3.9); the map generates one from the log when this is not served. */
export const bpmnUrl = (projectId: string, runId: string, params: { detail?: number; slicing?: string; sliceKey?: string; filter?: Filter; scope?: "flow" | "stages" }) => {
  const url = new URL(`${apiBase}/projects/${enc(projectId)}/runs/${enc(runId)}/flow/bpmn`);
  const f = canonicalParam(params.filter);
  const query: Record<string, string | number | undefined> = { scope: params.scope ?? "flow", detail: params.detail, slicing: params.slicing, sliceKey: params.sliceKey, filter: f };
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
};

/**
 * The paths block of `GET …/flow?focus=`: every incoming and outgoing path of the activity from the complete
 * directly-follows relation (R3-O8). `hidden` counts the ones the current detail level does not draw; the
 * backend may say so in `meta.pathsHidden`, otherwise the screen counts them against the drawn graph.
 */
export function pathsOf(graph: FlowGraph | undefined, focus: string): ActivityPaths | undefined {
  if (!graph) return undefined;
  const paths = (graph as { paths?: { incoming?: Record<string, unknown>[]; outgoing?: Record<string, unknown>[] } }).paths;
  if (!paths) return undefined;
  const meta = (graph.meta ?? {}) as { pathsHidden?: number };
  return { focus, incoming: paths.incoming ?? [], outgoing: paths.outgoing ?? [], hidden: meta.pathsHidden ?? 0 };
}

export type { FlowGraph } from "@wise/api-schema";
export { flowQuery, type FlowParams } from "@/lib/queries";
