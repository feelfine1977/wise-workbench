import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EDAMultiSelection } from "@/lib/api/eda";

export interface PeriodSelection {
  key: string;
  label: string;
  from?: string;
  before?: string;
  missing?: boolean;
}
export interface SpanSelection {
  key: string;
  label: string;
  min?: number;
  max?: number;
  missing?: boolean;
}
export interface FacetSelection {
  field: string;
  choices: { key: string; label: string }[];
}
export interface AnalysisDraft {
  facets?: FacetSelection[];
  eventRanges?: SpanSelection[];
  attribute?: string;
  categories: { key: string; label: string; field: string }[];
  periods: PeriodSelection[];
  spans: SpanSelection[];
  dates: { from: string; through: string };
}
export const emptyAnalysisDraft: AnalysisDraft = {
  categories: [],
  periods: [],
  spans: [],
  dates: { from: "", through: "" },
};
export const analysisKey = (
  projectId: string,
  datasetId: string,
  caseTableId: string,
) => JSON.stringify([projectId, datasetId, caseTableId]);
export const draftSelection = (draft: AnalysisDraft): EDAMultiSelection => ({
  ...(draft.facets?.length
    ? {
        facets: draft.facets
          .filter((f) => f.choices.length)
          .map((f) => ({ field: f.field, keys: f.choices.map((c) => c.key) })),
      }
    : {}),
  ...(draft.eventRanges?.some((r) => !r.missing)
    ? {
        eventRanges: draft.eventRanges
          .filter((r) => !r.missing)
          .map(({ min, max }) => ({ min, max })),
      }
    : {}),
  ...(draft.eventRanges?.some((r) => r.missing) ? { eventMissing: true } : {}),
  ...(draft.categories.length
    ? { categoryKeys: draft.categories.map((r) => r.key) }
    : {}),
  ...(draft.periods.some((r) => !r.missing)
    ? {
        timeRanges: draft.periods
          .filter((r) => !r.missing)
          .map(({ from, before }) => ({ from, before })),
      }
    : {}),
  ...(draft.periods.some((r) => r.missing) ? { timeMissing: true } : {}),
  ...(draft.spans.some((r) => !r.missing)
    ? {
        spanRanges: draft.spans
          .filter((r) => !r.missing)
          .map(({ min, max }) => ({ min, max })),
      }
    : {}),
  ...(draft.spans.some((r) => r.missing) ? { spanMissing: true } : {}),
});
export function draftFromSelection(
  selection: EDAMultiSelection,
  attribute?: string,
): AnalysisDraft {
  return {
    attribute,
    facets: selection.facets?.map((f) => ({
      field: f.field,
      choices: f.keys.map((key) => ({
        key,
        label:
          key === "missing"
            ? "Unknown / missing"
            : key === "other"
              ? "Other categories"
              : key,
      })),
    })),
    eventRanges: [
      ...(selection.eventRanges ?? []).map((r, i) => ({
        ...r,
        key: `saved-events-${i}`,
        label: `${r.min ?? 0} to ${r.max === undefined ? "any" : `<${r.max}`} events`,
      })),
      ...(selection.eventMissing
        ? [{ key: "missing", label: "Unknown event count", missing: true }]
        : []),
    ],
    dates: { from: "", through: "" },
    categories: (selection.categoryKeys ?? []).map((key) => ({
      key,
      label: key === "missing" ? "Unknown" : key === "other" ? "Other" : key,
      field: attribute ?? "Category",
    })),
    periods: [
      ...(selection.timeRanges ?? []).map((r, i) => ({
        ...r,
        key: `saved-time-${i}`,
        label: `${r.from?.slice(0, 10) ?? "Any start"} to ${r.before ? new Date(Date.parse(r.before) - 86400000).toISOString().slice(0, 10) : "Any end"}`,
      })),
      ...(selection.timeMissing
        ? [{ key: "missing", label: "Unknown date", missing: true }]
        : []),
    ],
    spans: [
      ...(selection.spanRanges ?? []).map((r, i) => ({
        ...r,
        key: `saved-span-${i}`,
        label: `${r.min ?? 0} to ${r.max === undefined ? "any" : `<${r.max}`} days`,
      })),
      ...(selection.spanMissing
        ? [{ key: "missing", label: "Unknown span", missing: true }]
        : []),
    ],
  };
}
// Legacy single-field selections and facets have the same membership semantics.
function criteria(draft: AnalysisDraft) {
  const selection = draftSelection(draft);
  const groups = new Map<string, string[]>();
  for (const facet of selection.facets ?? [])
    groups.set(facet.field, [...facet.keys].sort());
  if (selection.categoryKeys?.length && draft.attribute) {
    const prior = groups.get(draft.attribute);
    groups.set(
      draft.attribute,
      selection.categoryKeys
        .filter((key) => !prior || prior.includes(key))
        .sort(),
    );
  }
  const { categoryKeys: _categories, facets: _facets, ...rest } = selection;
  return JSON.stringify({
    ...rest,
    facets: [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, keys]) => ({ field, keys })),
  });
}
interface Entry {
  draft: AnalysisDraft;
  savedId?: string;
}
interface State {
  entries: Record<string, Entry>;
  update: (key: string, draft: AnalysisDraft) => void;
  activate: (key: string, id: string, draft?: AnalysisDraft) => void;
  clear: (key: string) => void;
}
export const useAnalysisSelection = create<State>()(
  persist(
    (set) => ({
      entries: {},
      update: (key, draft) =>
        set((state) => {
          const previous = state.entries[key];
          const same = previous && criteria(previous.draft) === criteria(draft);
          return {
            entries: {
              ...state.entries,
              [key]: { draft, savedId: same ? previous.savedId : undefined },
            },
          };
        }),
      activate: (key, savedId, draft) =>
        set((state) => ({
          entries: {
            ...state.entries,
            [key]: {
              draft: draft ?? state.entries[key]?.draft ?? emptyAnalysisDraft,
              savedId,
            },
          },
        })),
      clear: (key) =>
        set((state) => ({
          entries: { ...state.entries, [key]: { draft: emptyAnalysisDraft } },
        })),
    }),
    { name: "wise-analysis-selection-v1" },
  ),
);
