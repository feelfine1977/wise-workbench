/** Feature API: review. Generated DTOs remain the wire contract. */
import type { UsualReason, UsualAction } from "./knowledge";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const reviewKeys = {
  whatCanWeDo: (p: string, r: string, slicing: string, key: string, view: string) => ["projects", p, "runs", r, "what-can-we-do", slicing, key, view] as const,
  gates: (p: string, r: string, slicing: string, key: string, view: string) => ["projects", p, "runs", r, "gates", slicing, key, view] as const,
  review: (p: string, collection: string) => ["projects", p, collection] as const,
};

/** Generated named fields, with the contract's open guidance lists refined for display. */
export type Driver = Pick<S["WhatCanWeDoDriver"],
  "constraint_id" | "plain_name" | "hub_node" | "share_of_shortfall" | "comparison" |
  "headroom_points" | "headroom_percent" | "meaning_when_missed" | "why_it_matters" |
  "what_to_check_first" | "kpis" | "note"
> & { usual_reasons?: UsualReason[]; usual_actions?: UsualAction[] };

export type WhatCanWeDo = Omit<S["WhatCanWeDo"], "drivers"> & { drivers?: Driver[] };

export type Gate = S["Gate"];

export type GateState = NonNullable<Gate["status"]>;

export type Gates = S["Gates"];

export type ReviewItem = S["ReviewItem"];

export const whatCanWeDoQuery = (projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string; top?: number }) =>
  queryOptions({
    queryKey: reviewKeys.whatCanWeDo(projectId, runId, params.slicing, params.sliceKey, params.view ?? ""),
    queryFn: () =>
      http.get<WhatCanWeDo>(`/projects/${enc(projectId)}/runs/${enc(runId)}/what-can-we-do`, {
        slicing: params.slicing,
        key: params.sliceKey,
        view: params.view,
        top: params.top ?? 3,
      }),
    staleTime: IMMUTABLE,
    retry: false,
  });

export const gatesQuery = (projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string }) =>
  queryOptions({
    queryKey: reviewKeys.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? ""),
    queryFn: () =>
      http.get<Gates>(`/projects/${enc(projectId)}/runs/${enc(runId)}/gates`, {
        slicing: params.slicing,
        key: params.sliceKey,
        view: params.view,
      }),
    staleTime: 0,
    retry: false,
  });

export interface GateDecision {
  status: "passed" | "failed" | "waived";
  note: string;
  author: string;
}

/**
 * Pass, fail or waive one gate, with a note and an author that the endpoint requires (§1.8). The answer
 * replaces the cached gate list, so the hypothesis form unblocks in the same tick as the decision.
 */
export function useDecideGate(projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { gateId: string } & GateDecision) =>
      http.post<Gates>(
        `/projects/${enc(projectId)}/runs/${enc(runId)}/gates/${enc(input.gateId)}`,
        { status: input.status, note: input.note, author: input.author },
        { slicing: params.slicing, key: params.sliceKey, view: params.view },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? "") });
      void qc.invalidateQueries({ queryKey: reviewKeys.whatCanWeDo(projectId, runId, params.slicing, params.sliceKey, params.view ?? "") });
    },
  });
}

/**
 * The gates that block this group's own hypothesis (R3-03): a gate whose computed state on **this group**
 * is not passed and which has not been waived. A run-wide gate — one that reads the same on every group of
 * the log — is stated once at the run and never counted 57 times here.
 */
export function blockingGates(gates: Gate[] | undefined): Gate[] {
  return (gates ?? []).filter((g) => g.status !== "passed" && g.status !== "waived" && !isRunWide(g));
}

/** A gate whose evidence names the log rather than the group: the readiness report of the case table. */
export function isRunWide(gate: Gate): boolean {
  if (gate.kind === "readiness") {
    const evidence = (gate.evidence ?? {}) as { share?: number | null; scope?: string };
    // a readiness gate the backend computes per group carries the group's own share; without one it is the log's
    return evidence.scope !== "group" && (evidence.share === undefined || evidence.share === null);
  }
  return false;
}

export type ReviewCollection = "findings" | "actions" | "hypotheses";

export const reviewQuery = (projectId: string, collection: ReviewCollection, params?: { runId?: string; slicing?: string; sliceKey?: string }) =>
  queryOptions({
    queryKey: [...reviewKeys.review(projectId, collection), params?.runId ?? "", params?.slicing ?? "", params?.sliceKey ?? ""] as const,
    queryFn: () =>
      http.get<ReviewItem[]>(`/projects/${enc(projectId)}/${collection}`, {
        runId: params?.runId,
        slicing: params?.slicing,
        sliceKey: params?.sliceKey,
      }),
    staleTime: 0,
    retry: false,
  });

export function useCreateReviewItem(projectId: string, collection: ReviewCollection) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => http.post<ReviewItem>(`/projects/${enc(projectId)}/${collection}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.review(projectId, collection) }),
  });
}

export function useUpdateReviewItem(projectId: string, collection: ReviewCollection) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: Record<string, unknown> }) =>
      http.patch<ReviewItem>(`/projects/${enc(projectId)}/${collection}/${enc(input.id)}`, input.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.review(projectId, collection) }),
  });
}
