import { useState } from "react";
import type { GroupingSuggestionsResponse, RankedGroupingSuggestion } from "@/lib/api/groupingSuggestions";
import { groupingSignature } from "@/lib/api/groupingSuggestions";
import type { SlicingSpec } from "@/lib/api/exploration";
import { Button } from "@/components/ui/button";

export function GroupingSuggestions({ data, chosen, onAdd, selectionName }: {
  data: GroupingSuggestionsResponse;
  chosen: SlicingSpec[];
  onAdd: (suggestion: RankedGroupingSuggestion) => void;
  selectionName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const signatures = new Set(chosen.map(groupingSignature));
  const e = data.evidence;
  const visible = expanded ? data.suggestions : data.suggestions.slice(0, 5);
  return <section aria-label="Suggested context groupings" className="flex flex-col gap-2 rounded border border-border p-3">
    <h3 className="text-sm font-medium">Suggested context groupings</h3>
    <p className="text-xs text-text-muted">Exploratory suggestions from context and case support, not verified drivers or root causes.</p>
    <p className="text-xs">{e.cases.toLocaleString()} cases · {e.scope?.selection_id ? `saved filter: ${selectionName ?? e.scope.selection_id}` : "all prepared cases"}{e.scope?.flow_type ? ` · flow: ${e.scope.flow_type}` : e.scope?.value ? ` · ${e.scope.attribute}: ${e.scope.value}` : ""} · views: {e.views.join(", ")}</p>
    <details className="text-xs"><summary>Why these groupings</summary>
      <p>Relevance basis: {data.search.relevanceViews.join(", ")}{e.focusLayer ? ` · layer: ${e.focusLayer}` : ""}{e.focusConstraint ? ` · constraint: ${e.focusConstraint}` : ""}.</p>
      <p>Evaluated {data.search.evaluatedCombinations} combinations of 1–3 columns{data.search.truncated ? " in a bounded search" : ""}.</p>
      <p>{data.search.relevanceBasis}</p><p>{data.search.relatedWeightMeaning}</p><p>{data.search.ranking}.</p><p>{data.search.diversity}</p>
    </details>
    <ol className="flex flex-col gap-2">
      {visible.map((s, i) => {
        const added = signatures.has(groupingSignature(s));
        return <li key={s.id} className="rounded border border-border p-2 text-xs">
          <div className="flex items-center justify-between gap-2"><strong>{i + 1}. {s.label}</strong><Button size="sm" variant="outline" disabled={added} aria-label={`Add grouping ${s.label}`} onClick={() => onAdd(s)}>{added ? "Added" : "Add"}</Button></div>
          <p>{s.supportCases.toLocaleString()} / {s.cases.toLocaleString()} with complete context · {s.groups.toLocaleString()} groups · {s.belowMinCases.toLocaleString()} below {e.minCases} cases</p>
          <details className="text-text-muted"><summary>Why this grouping</summary>
            <p>{s.missingCases.toLocaleString()} cases with missing context; {s.supportedCases.toLocaleString()} cases in groups meeting minimum support.</p>
            {s.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          </details>
        </li>;
      })}
    </ol>
    {data.suggestions.length > 5 && <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show more (${data.suggestions.length} suggestions)`}</Button>}
    {!data.suggestions.length && <p className="text-xs">No varying context columns in this scope. You can define a custom grouping below.</p>}
    <details className="text-xs"><summary>Scope and evidence provenance</summary><dl className="break-all">
      <dt>Fixed dataset / prepared table</dt><dd>{e.datasetId} / {e.caseTableId}</dd>
      <dt>Norm version / fingerprint</dt><dd>{e.normVersionId} / {e.normFingerprint}</dd>
      <dt>Effective WISE norm fingerprint, including General</dt><dd>{e.effectiveNormFingerprint}</dd>
      <dt>Prepared cases checksum</dt><dd>{e.source.casesChecksum}</dd>
      <dt>Prepared events checksum</dt><dd>{e.source.eventsChecksum}</dd>
      <dt>Mapping / checksum</dt><dd>{e.source.mappingId} / {e.source.mappingChecksum}</dd>
      {e.selectionChecksum && <><dt>Saved membership checksum</dt><dd>{e.selectionChecksum}</dd></>}
      <dt>Evidence fingerprint</dt><dd>{e.fingerprint}</dd>
    </dl></details>
  </section>;
}
