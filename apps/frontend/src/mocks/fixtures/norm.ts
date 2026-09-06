import type { NormVersion } from "@wise/api-schema";
import bpic19 from "./bpic19_norm.json";

export interface NormJson {
  name: string;
  version: string;
  scoring_mode: string;
  layers: { id: string; name: string; description?: string }[];
  views: { name: string; layer_weights?: Record<string, number>; constraint_weights?: Record<string, number> }[];
  constraints: { id: string; layer: string; type: string; params: Record<string, unknown>; weight: number; applicability?: Record<string, unknown>; description?: string }[];
  metadata?: Record<string, unknown>;
}

export const bpic19Norm = bpic19 as unknown as NormJson;

export const layerName = (norm: NormJson, id: string | undefined) => norm.layers.find((l) => l.id === id)?.name ?? id ?? "";

function withThreshold(norm: NormJson, constraintId: string, delta: number, width: number): NormJson {
  return {
    ...norm,
    constraints: norm.constraints.map((c) => (c.id === constraintId ? { ...c, params: { ...c.params, delta, width } } : c)),
  };
}

const versions: Omit<NormVersion, "normId" | "name" | "views">[] = [
  {
    id: "nv_5",
    version: 5,
    fingerprint: "sha256:2b7e1516a0c4d8e3",
    status: "reviewed",
    note: "Workshop 2 result: L3 lag constraints measured from first activation; consignment exclusions added.",
    author: "u.jessen",
    norm: withThreshold(withThreshold(bpic19Norm, "c_l3_invoice_to_clear_days", 45, 60), "c_l3_df1_goods_to_invoice_days", 14, 20) as unknown as Record<string, unknown>,
    validation: [],
    createdAt: "2026-06-11T09:40:00Z",
  },
  {
    id: "nv_6",
    version: 6,
    fingerprint: "sha256:7c1a9e0b55d2f4a8",
    status: "reviewed",
    note: "Invoice-to-clear target set to 30 days after the treasury review; width kept at 60.",
    author: "u.jessen",
    parentId: "nv_5",
    norm: withThreshold(bpic19Norm, "c_l3_df1_goods_to_invoice_days", 14, 20) as unknown as Record<string, unknown>,
    validation: [],
    createdAt: "2026-06-18T14:05:00Z",
  },
  {
    id: "nv_7",
    version: 7,
    fingerprint: "sha256:9f3c0d2a4e6b8c1f",
    status: "approved",
    note: "Approved by the P2P process owner for the 2018 baseline; goods-to-invoice target back to 10 days.",
    author: "process.owner",
    parentId: "nv_6",
    norm: bpic19Norm as unknown as Record<string, unknown>,
    validation: [],
    createdAt: "2026-06-25T10:12:00Z",
  },
  {
    id: "nv_8",
    version: 8,
    fingerprint: "sha256:d41d8cd98f00b204",
    status: "draft",
    note: "Draft: manual-touch threshold raised from 4 to 6 after the automation team's objection; not yet checked in a run.",
    author: "u.jessen",
    parentId: "nv_7",
    norm: {
      ...bpic19Norm,
      constraints: bpic19Norm.constraints.map((c) => (c.id === "c_l7_manual_touches" ? { ...c, params: { ...c.params, threshold: 6.0, width: 6.0 } } : c)),
    } as unknown as Record<string, unknown>,
    validation: ["c_l6_networth_volatility: attribute networth_cv is undefined for 12.4 % of cases (single posting); they are treated as not evaluated"],
    createdAt: "2026-08-30T16:48:00Z",
  },
];

/** Every version belongs to one norm lineage and carries the library document's name and views. */
export const normVersions: NormVersion[] = versions.map((v) => ({
  ...v,
  normId: "norm_1",
  name: (v.norm as { name?: string }).name ?? bpic19Norm.name,
  views: ((v.norm as { views?: { name: string }[] }).views ?? bpic19Norm.views).map((x) => x.name),
}));
