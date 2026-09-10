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

export type NormCalibration = S["NormCalibration"];
export type CalibrationEntry = S["CalibrationEntry"];
export type NotApplicableEntry = S["NotApplicableEntry"];
export type { NormVersionCreate } from "@wise/api-schema";

/** Saved decisions are read from the version, not inferred from an editor or a run. */
export const normCalibrationQuery = (projectId: string, normVersionId: string) =>
  queryOptions({
    queryKey: ["projects", projectId, "norms", normVersionId, "calibration"] as const,
    queryFn: () => http.get<NormCalibration>(`/projects/${enc(projectId)}/norms/${enc(normVersionId)}/calibration`),
    enabled: !!normVersionId,
    retry: false,
  });

/** No prior-run or prior-version placeholder is valid for a norm calibration lens. */
export const normSignalQuery = (projectId: string, normVersionId: string, caseTableId: string, constraintId: string) =>
  queryOptions({
    queryKey: ["projects", projectId, "norms", normVersionId, "signals", caseTableId, constraintId] as const,
    queryFn: () => http.get<S["NormSignalDistribution"]>(`/projects/${enc(projectId)}/norms/${enc(normVersionId)}/signals/${enc(constraintId)}`, { caseTableId }),
    enabled: !!projectId && !!normVersionId && !!caseTableId && !!constraintId,
    retry: false,
  });

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
