/** Feature API: review. Generated DTOs remain the wire contract. */
import type { UsualReason, UsualAction } from "./knowledge";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import { ApiError } from "@/lib/api";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const reviewKeys = {
  whatCanWeDo: (p: string, r: string, slicing: string, key: string, view: string) => ["projects", p, "runs", r, "what-can-we-do", slicing, key, view] as const,
  gates: (p: string, r: string, slicing: string, key: string, view: string, filter?: string) => ["projects", p, "runs", r, "gates", slicing, key, view, filter ?? null] as const,
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

interface GateScope {
  slicing: string;
  sliceKey: string;
  view?: string;
  /** Raw search.filter, including invalid or empty input, for strict server validation. */
  filter?: string;
}

/** A legacy whole-group answer must never be presented as measured filtered evidence. */
function checkedGates(data: Gates, filter?: string): Gates {
  if (filter !== undefined) {
    const selection = data.selection;
    if (!data.filter || typeof data.filter !== "object" || Array.isArray(data.filter) || selection?.state !== "measured" ||
      !Number.isSafeInteger(selection.cases) || selection.cases <= 0 ||
      !Number.isSafeInteger(selection.wholeGroupCases) || selection.wholeGroupCases < selection.cases ||
      typeof selection.fingerprint !== "string" || !selection.fingerprint.trim()) {
      throw new ApiError(409, { status: 409, title: "Selection checks unavailable", detail: "Checks for this exact selection could not be measured. No whole-group checks were substituted." });
    }
  }
  return data;
}

export const gatesQuery = (projectId: string, runId: string, params: GateScope) =>
  queryOptions({
    queryKey: reviewKeys.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? "", params.filter),
    queryFn: async () =>
      checkedGates(await http.get<Gates>(`/projects/${enc(projectId)}/runs/${enc(runId)}/gates`, {
        slicing: params.slicing,
        key: params.sliceKey,
        view: params.view,
        filter: params.filter,
      }), params.filter),
    staleTime: 0,
    retry: false,
  });

export interface GateDecision {
  status: "passed" | "failed" | "waived";
  note: string;
  author: string;
}

/**
 * Pass, fail or waive one gate in the exact requested scope, then re-read that scope's checks.
 * Filtered decisions never replace or invalidate the whole-group hypothesis checks.
 */
export function useDecideGate(projectId: string, runId: string, params: GateScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { gateId: string } & GateDecision) =>
      checkedGates(await http.post<Gates>(
        `/projects/${enc(projectId)}/runs/${enc(runId)}/gates/${enc(input.gateId)}`,
        { status: input.status, note: input.note, author: input.author },
        { slicing: params.slicing, key: params.sliceKey, view: params.view, filter: params.filter },
      ), params.filter),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? "", params.filter), exact: true });
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
  if (gate.scope === "run") return true;
  if (gate.scope === "group") return false;
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
        key: params?.sliceKey,
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
