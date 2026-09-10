/** Feature API: norms. Generated DTOs remain the wire contract. */

import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const normKeys = {
  inventory: (p: string, caseTableId: string) => ["projects", p, "norms", "inventory", caseTableId] as const,
  guidanceQuestions: (p: string, kind: string, id: string) => ["projects", p, "norms", "guidance-questions", kind, id] as const,
};

export type Inventory = S["Inventory"];

export type ActivityInventory = S["ActivityInventory"];

export type AttributeInventory = S["AttributeInventory"];

export type GuidanceQuestions = S["GuidanceQuestions"];

export const inventoryQuery = (projectId: string, caseTableId: string) =>
  queryOptions({
    queryKey: normKeys.inventory(projectId, caseTableId),
    queryFn: () => http.get<Inventory>(`/projects/${enc(projectId)}/norms/inventory`, { caseTableId }),
    staleTime: IMMUTABLE,
    enabled: !!caseTableId,
    retry: false,
  });

export const guidanceQuestionsQuery = (projectId: string, kind: string, id?: string) =>
  queryOptions({
    queryKey: normKeys.guidanceQuestions(projectId, kind, id ?? ""),
    queryFn: () => http.get<GuidanceQuestions>(`/projects/${enc(projectId)}/norms/guidance-questions`, { kind, id }),
    staleTime: IMMUTABLE,
    retry: false,
  });

/** Preserve the existing optional activity count while deriving named fields from the DTO. */
export type ConstraintCheck = Omit<S["ConstraintCheck"], "errors" | "activities"> & {
  errors?: { field?: string; message: string }[];
  activities?: (Omit<S["ConstraintActivity"], "cases"> & Partial<Pick<S["ConstraintActivity"], "cases">>)[];
};

export async function checkConstraint(projectId: string, caseTableId: string, constraint: Record<string, unknown>): Promise<ConstraintCheck> {
  return http.post<ConstraintCheck>(`/projects/${enc(projectId)}/norms/constraints/check`, { caseTableId, constraint });
}

export { normsQuery, normQuery, useCreateNormVersion, useSetNormStatus } from "@/lib/queries";
