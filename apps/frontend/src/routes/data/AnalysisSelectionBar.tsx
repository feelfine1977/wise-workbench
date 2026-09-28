import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "@/components/ui";
import { ErrorBlock } from "@/components/states";
import { analysisSelectionsQuery, useSaveAnalysisSelection } from "@/lib/api/analysisSelections";
import { analysisKey, draftFromSelection, draftSelection, emptyAnalysisDraft, useAnalysisSelection } from "@/lib/stores/analysisSelection";
import { numericLabel, jointLabel } from "./insights/selectionHelpers";
import { fmtInt } from "@/lib/format";

export function AnalysisSelectionBar({ projectId, datasetId, caseTableId, selectedCases, canRun = true }: { projectId: string; datasetId: string; caseTableId: string; selectedCases?: number; canRun?: boolean }) {
  const key = analysisKey(projectId, datasetId, caseTableId);
  const entry = useAnalysisSelection((s) => s.entries[key]);
  const draft = entry?.draft ?? emptyAnalysisDraft;
  const selection = draftSelection(draft);
  const hasSelection = Object.keys(selection).length > 0;
  const saved = useQuery(analysisSelectionsQuery(projectId, caseTableId));
  const create = useSaveAnalysisSelection(projectId, caseTableId);
  const [name, setName] = useState("");
  const active = saved.data?.find((r) => r.id === entry?.savedId);
  return <section aria-label="Analysis filter" className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Analysis filter</h3><p className="mt-1 text-sm text-text-muted">Save your selection to use the same cases in flow exploration and every result of a new run.</p></div>
      {hasSelection && <Button variant="ghost" size="sm" onClick={() => useAnalysisSelection.getState().clear(key)}>Use all cases</Button>}
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Saved filters<select aria-label="Saved analysis filter" className="mt-1 block h-control max-w-full rounded border border-border bg-surface px-2" value={active?.id ?? ""} onChange={(e) => {
        const chosen = saved.data?.find((r) => r.id === e.target.value);
        if (chosen) useAnalysisSelection.getState().activate(key, chosen.id, draftFromSelection(chosen.selection ?? {}, chosen.attribute ?? undefined));
        else useAnalysisSelection.getState().clear(key);
      }}><option value="">{hasSelection && !active ? "Unsaved selection" : "All prepared cases"}</option>{saved.data?.map((r) => <option key={r.id} value={r.id}>{r.name} · {fmtInt(r.cases)} cases</option>)}</select></label>
      {!active && hasSelection && <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: name.trim(), datasetId, attribute: draft.attribute, selection }, { onSuccess: (result) => { const current = useAnalysisSelection.getState().entries[key]?.draft; if (current && current.attribute === draft.attribute && JSON.stringify(draftSelection(current)) === JSON.stringify(selection)) useAnalysisSelection.getState().activate(key, result.id); setName(""); } }); }}>
        <label className="text-sm">Filter name<Input aria-label="Filter name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jan–Mar cases, span ≥14 days" /></label>
        <Button type="submit" disabled={!name.trim() || selectedCases === 0 || create.isPending}>Save filter</Button>
      </form>}
      {active && canRun && <Button asChild><Link to="/p/$projectId/runs" params={{ projectId }} search={{ new: true, caseTable: caseTableId, selection: active.id }}>Analyse saved filter</Link></Button>}
    </div>
    <p role="status" className="text-sm">{active ? <><strong>{active.name}</strong> · {fmtInt(active.cases)} saved cases. Flow types narrow this selection further.</> : hasSelection ? "Your selection is retained on this device. Save it before continuing to flow exploration or running an assessment." : "All prepared cases. Select bars or dates in Explore data to create a custom filter."}</p>
    {hasSelection && <div aria-label="Filter criteria" className="flex flex-wrap gap-2 text-xs text-text-muted">
      {draft.categories.length > 0 && <span className="rounded border border-border px-2 py-1">{draft.attribute ?? "Category"}: {draft.categories.every((r) => !/^v\d+$/.test(r.label)) ? draft.categories.map((r) => r.label).join(" or ") : `${draft.categories.length} selected categories`}</span>}
      {draft.facets?.map((f) => <span key={f.field} className="rounded border border-border px-2 py-1">{f.field}: {f.choices.some((c) => /^v\d+$/.test(c.label)) ? `${f.choices.length} selected categories` : f.choices.map((c) => c.label).join(" or ")}</span>)}
      {draft.numericFacets?.map((f) => <span key={`numeric:${f.field}`} className="rounded border border-border px-2 py-1">{numericLabel(f)}</span>)}
      {draft.jointAny?.map((branch, i) => <span key={`joint:${i}`} className="rounded border border-border px-2 py-1">OR path {i + 1}: {jointLabel(branch)}</span>)}
      {draft.eventRanges?.map((r) => <span key={r.key} className="rounded border border-border px-2 py-1">Recorded events: {r.label}</span>)}
      {draft.periods.map((r) => <span key={r.key} className="rounded border border-border px-2 py-1">First recorded: {r.label}</span>)}
      {draft.spans.map((r) => <span key={r.key} className="rounded border border-border px-2 py-1">Recorded span: {r.label}</span>)}
    </div>}
    {entry?.savedId && saved.isError && <p className="text-sm text-warning">The saved filter could not be verified. Analysis stays unavailable until it can be loaded.</p>}
    {create.isError && <ErrorBlock error={create.error} />}{saved.isError && <ErrorBlock error={saved.error} retry={() => void saved.refetch()} />}
  </section>;
}
