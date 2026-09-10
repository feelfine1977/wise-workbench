/** Feature API: readiness. Generated DTOs remain the wire contract. */
import { keys } from "@/lib/queries";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const readinessKeys = {
  decisionKinds: (p: string) => ["projects", p, "decisions", "kinds"] as const,
  decisions: (p: string, ct?: string) => ["projects", p, "decisions", ct ?? ""] as const,
};

export type DecisionKind = S["DecisionKind"];

export type Decision = S["Decision"];

export type DecisionRequest = S["DecisionRequest"];

export type DecisionPreviewOut = S["DecisionPreviewOut"];

export type DecisionApplied = S["DecisionApplied"];

/** `Decision.preview` and `DecisionPreviewOut.preview`. */
export interface DecisionPreviewNumbers {
  cases: number;
  events: number;
  totalCases: number;
  totalEvents: number;
  detail?: Record<string, unknown>;
}

export const decisionKindsQuery = (projectId: string) =>
  queryOptions({
    queryKey: readinessKeys.decisionKinds(projectId),
    queryFn: () => http.get<DecisionKind[]>(`/projects/${enc(projectId)}/decisions/kinds`),
    staleTime: IMMUTABLE,
  });

export const decisionsQuery = (projectId: string, caseTableId?: string) =>
  queryOptions({
    queryKey: readinessKeys.decisions(projectId, caseTableId),
    queryFn: () => http.get<Decision[]>(`/projects/${enc(projectId)}/decisions`, { caseTableId }),
  });

export function usePreviewDecision(projectId: string, caseTableId: string) {
  return useMutation({
    mutationFn: (body: DecisionRequest) => http.post<DecisionPreviewOut>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/decisions/preview`, body),
  });
}

export function useApplyDecision(projectId: string, caseTableId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DecisionRequest) => http.post<DecisionApplied>(`/projects/${enc(projectId)}/case-tables/${enc(caseTableId)}/decisions`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects", projectId, "decisions"] });
      void qc.invalidateQueries({ queryKey: keys.caseTables(projectId) });
      void qc.invalidateQueries({ queryKey: keys.caseTable(projectId, caseTableId) });
    },
  });
}
