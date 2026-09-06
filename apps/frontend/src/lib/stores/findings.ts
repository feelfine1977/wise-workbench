import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HotspotType } from "@wise/api-schema";

export type Disposition = "investigate" | "defer" | "waive" | "not_a_hotspot";

export interface Finding {
  id: string;
  projectId: string;
  runId: string;
  slicing: string;
  key: string;
  computedType?: HotspotType;
  hotspotType?: HotspotType;
  overrideNote?: string;
  disposition?: Disposition;
  dispositionNote?: string;
  owner?: string;
  updatedAt: string;
}

export const findingId = (runId: string, slicing: string, key: string) => `${runId}:${slicing}:${key}`;

interface FindingState {
  findings: Record<string, Finding>;
  upsert: (f: Omit<Finding, "id" | "updatedAt">) => Finding;
  remove: (id: string) => void;
}

/**
 * Findings are the analyst's reading of a slice. The review endpoints arrive with increment 2;
 * until then findings persist in the browser and are keyed by (run, slicing, key).
 */
export const useFindingStore = create<FindingState>()(
  persist(
    (set) => ({
      findings: {},
      upsert: (f) => {
        const id = findingId(f.runId, f.slicing, f.key);
        const finding: Finding = { ...f, id, updatedAt: new Date().toISOString() };
        set((s) => ({ findings: { ...s.findings, [id]: finding } }));
        return finding;
      },
      remove: (id) =>
        set((s) => {
          const next = { ...s.findings };
          delete next[id];
          return { findings: next };
        }),
    }),
    { name: "wise.findings" },
  ),
);
