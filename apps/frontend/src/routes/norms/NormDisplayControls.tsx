import { useId, useState } from "react";
import type { NormRelevance } from "@/lib/api/normRelevance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { constraintName, type NormDocument } from "./normAuthoring";
import { allNormItems, constraintVisible, type NormVisibility } from "./normVisibility";

export function NormDisplayControls({ document, visibility, relevance, onChange, loading, onRetry, compact = false }: {
  compact?: boolean;
  loading?: boolean; onRetry?: () => void;
  document: NormDocument; visibility: NormVisibility; relevance?: NormRelevance; onChange: (value: NormVisibility) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const constraints = document.constraints ?? [];
  const visible = constraints.filter(c => constraintVisible(c, visibility, relevance)).length;
  const hasFilter = visibility.minApplicability > 0 || visibility.hiddenLayers.length > 0 || visibility.hiddenConstraints.length > 0;
  const toggle = (key: "hiddenLayers" | "hiddenConstraints", value: string) => onChange({ ...visibility, [key]: visibility[key].includes(value) ? visibility[key].filter(x => x !== value) : [...visibility[key], value] });
  const matches = constraints.filter(c => !query || `${constraintName(c)} ${c.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (compact) return <div aria-label="Norm display status" className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
    <span>{visible} / {constraints.length} constraints match{hasFilter ? ` · ${visibility.minApplicability}% minimum applicability · ${visibility.hiddenLayers.length} layers and ${visibility.hiddenConstraints.length} constraints hidden` : " · No display filters"}</span>
    {hasFilter && <Button size="sm" variant="ghost" onClick={() => onChange(allNormItems)}>Show everything again</Button>}
  </div>;
  return <section aria-label="Simplify the norm picture" className="mb-3 space-y-2 rounded border border-border bg-surface-sunken p-3">
    <h3 className="text-sm font-semibold">Display</h3>
    <div className="flex flex-wrap items-end gap-3">
      <div><label htmlFor={`${id}-coverage`} className="mb-1 block text-xs font-medium">Minimum applicability (% of dataset)</label>
        <Input id={`${id}-coverage`} className="h-8 w-24" type="number" min={0} max={100} step="any" value={visibility.minApplicability} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) onChange({ ...visibility, minApplicability: Math.max(0, Math.min(100, value)) }); }} />
      </div>
      <input className="mb-2 w-44 accent-accent" type="range" min={0} max={100} step={0.1} aria-label="Minimum applicability slider" value={visibility.minApplicability} onChange={e => onChange({ ...visibility, minApplicability: Number(e.target.value) })} />
      {hasFilter && <Button size="sm" variant="ghost" onClick={() => onChange(allNormItems)}>Show everything again</Button>}
      <span className="text-xs text-text-muted">{visible} / {constraints.length} constraints match</span>
    </div>
    <details className="text-xs text-text-muted"><summary className="cursor-pointer font-medium">About display filters</summary><p className="mt-2">Applicability = cases in the rule’s business scope / all cases in this mapped dataset. It is separate from activity coverage or passing the rule. Display changes do not remove rules from analysis or change weights.</p></details>
    {visibility.minApplicability > 0 && !relevance && <p className="text-xs text-text-muted">{loading ? "Checking applicability… Matching rules will appear when ready." : "Applicability is unavailable. Clear the cutoff to browse all constraints."}{!loading && onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Retry applicability</Button>}</p>}

    <details><summary className="cursor-pointer text-sm font-medium">Choose layers and constraints to show{visibility.hiddenLayers.length + visibility.hiddenConstraints.length > 0 ? ` · ${visibility.hiddenLayers.length} layers and ${visibility.hiddenConstraints.length} constraints hidden` : ""}</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <fieldset><legend className="mb-2 text-xs font-semibold">Visible layers</legend><div className="max-h-48 space-y-2 overflow-auto">{(document.layers ?? []).map(layer => <label key={layer.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!visibility.hiddenLayers.includes(layer.id)} onChange={() => toggle("hiddenLayers", layer.id)} /><span>{layer.name}</span></label>)}</div></fieldset>
        <fieldset><legend className="mb-2 text-xs font-semibold">Visible constraints</legend><Input type="search" aria-label="Find constraints to show or hide" placeholder="Find a constraint…" value={query} onChange={e => setQuery(e.target.value)} className="mb-2" />
          <p className="mb-2 text-xs text-text-muted">Showing {Math.min(12, matches.length)} of {matches.length} names. Search to find more. A hidden layer hides its constraints too.</p>
          <div className="max-h-48 space-y-2 overflow-auto">{matches.slice(0, 12).map(c => <label key={c.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!visibility.hiddenConstraints.includes(c.id)} onChange={() => toggle("hiddenConstraints", c.id)} /><span>{constraintName(c)}</span></label>)}</div>
        </fieldset>
      </div>
    </details>
  </section>;
}
