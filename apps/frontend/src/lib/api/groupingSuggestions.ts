import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { BandSpec, SlicingSpec } from "./exploration";
import type { RunScope } from "./runs";

export interface GroupingSuggestionsRequest {
  normVersionId: string; views: string[]; scope?: RunScope; focusLayer?: string; focusConstraint?: string; minCases: number; limit?: number;
}
export interface ContextAttribute { name: string; type: "numeric" | "categorical"; distinct: number; missing: number }
export interface RankedGroupingSuggestion {
  id: string; attributes: string[]; bands: BandSpec[]; label: string; reasons: string[]; relevance: number; rankScore: number;
  cases: number; supportCases: number; missingCases: number; groups: number; belowMinCases: number; supportedCases: number; relatedConstraints: string[];
}
export interface GroupingSuggestionsResponse {
  attributes: ContextAttribute[]; suggestions: RankedGroupingSuggestion[]; notice: string;
  evidence: {
    kind: "pre_scoring_context_support"; projectId: string; datasetId: string; caseTableId: string; normVersionId: string; normFingerprint: string; effectiveNormFingerprint: string;
    source: { mappingId: string; mappingChecksum: string; datasetContentHash?: string | null; casesChecksum: string; eventsChecksum: string };
    selectionChecksum?: string | null; scope?: RunScope | null; views: string[]; focusLayer?: string | null; focusConstraint?: string | null; minCases: number; cases: number; fingerprint: string;
  };
  search: { evaluatedCombinations: number; eligibleColumns: number; candidateColumns: string[]; truncated: boolean; sampled: boolean; ranking: string; relevanceViews: string[]; relevanceBasis: string; relatedWeightMeaning: string; diversity: string };
}
export const groupingSuggestionsQuery = (projectId: string, caseTableId: string, request: GroupingSuggestionsRequest) => {
  const body = { ...request, views: [...new Set(request.views)].sort() };
  return queryOptions({
    queryKey: ["projects", projectId, "case-tables", caseTableId, "grouping-suggestions", body],
    queryFn: () => http.post<GroupingSuggestionsResponse>(`/projects/${encodeURIComponent(projectId)}/case-tables/${encodeURIComponent(caseTableId)}/grouping-suggestions`, body),
    staleTime: 0, gcTime: 0, retry: false,
  });
};

/** Bands and columns define equivalence; a user's row ID is only its handle. */
export function groupingSignature(spec: Pick<SlicingSpec, "attributes" | "bands">): string {
  return JSON.stringify({ attributes: [...spec.attributes].sort(), bands: [...(spec.bands ?? [])].map((b) => ({
    attribute: b.attribute, method: b.method ?? "quantile", ...(b.method === "cuts" ? { cuts: b.cuts ?? [] } : { q: b.q ?? 4 }), ...(b.labels ? { labels: b.labels } : {}),
  })).sort((a, b) => a.attribute.localeCompare(b.attribute)) });
}

export function uniqueSlicingId(spec: SlicingSpec, others: SlicingSpec[]): string {
  const base = spec.attributes.map(encodeURIComponent).join("+") || "grouping";
  const taken = new Set(others.map((row) => row.id));
  let id = base;
  let suffix = 2;
  while (taken.has(id)) id = `${base}#${suffix++}`;
  return id;
}
