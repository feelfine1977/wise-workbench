import { allNormItems, constraintVisible, type NormVisibility } from "./normVisibility";
import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";
import { useId, useState, type ReactNode } from "react";
import type { NormRelevance } from "@/lib/api/normRelevance";
import { constraintPriority, orderConstraints } from "./constraintPriority";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type UncalibratedExpectation } from "@/lib/api/exploration";
import { CalibrationAction } from "./CalibrationNotice";
import { thresholdOf, type Constraint } from "./Builder";
import { constraintName, type NormDocument } from "./normAuthoring";
import { readAuthoringBrief, readLayerGuidance } from "./normGuideState";

interface Props {
  document: NormDocument;
  selected?: Constraint;
  overview: boolean;
  missing: string[];
  warnings: Map<string, UncalibratedExpectation>;
  onSelect: (id: string, pane?: "rule" | "lens") => void;
  onOverview: () => void;
  children?: ReactNode;
  template?: ReactNode;
  relevance?: NormRelevance;
  evidenceState?: "no-table" | "loading" | "error" | "ready";
  datasetName?: string;
  visibility?: NormVisibility;
  onHideLayer?: (id: string) => void;
  onHideConstraint?: (id: string) => void;
}
const LIMIT = 8;

/** Purpose → one layer → one expectation. Global search is available without expanding every layer. */
export function ConstraintNavigator({ document, selected, overview, missing, warnings, onSelect, onOverview, children, template, relevance, evidenceState, visibility = allNormItems, onHideLayer, onHideConstraint }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const { mode } = useNormAuthoringPreferences();
  const guided = mode === "guided";
  const [showDeferred, setShowDeferred] = useState(false);
  const [offset, setOffset] = useState<number>();
  const evidence = new Map((relevance?.constraints ?? []).map(row => [row.id, row]));
  const constraints = orderConstraints((document.constraints ?? []).filter(c => constraintVisible(c, visibility, relevance)), evidence, guided);
  const priority = (c: Constraint) => constraintPriority(evidence.get(c.id));
  const groups = new Map((document.layers ?? []).map(layer => [layer.id, { ...layer, constraints: [] as Constraint[] }]));
  for (const c of constraints) {
    if (!groups.has(c.layer)) groups.set(c.layer, { id: c.layer, name: c.layer || "Unassigned", constraints: [] });
    groups.get(c.layer)!.constraints.push(c);
  }
  const layer = groups.get(selected?.layer ?? "");
  const guidance = readLayerGuidance(document, layer?.id ?? "");
  const attention = (c: Constraint) => missing.includes(c.id) || warnings.has(c.id);
  const search = query.trim().toLocaleLowerCase();
  const matches = constraints.filter(c => (!needsReview || attention(c)) && (!search || `${constraintName(c)} ${c.id} ${groups.get(c.layer)?.name}`.toLocaleLowerCase().includes(search)));
  const inLayer = matches.filter(c => c.layer === selected?.layer);
  const deferred = inLayer.filter(c => priority(c).deferred);
  const items = search ? matches : inLayer.filter(c => !guided || showDeferred || !priority(c).deferred || c.id === selected?.id);
  const selectedPage = Math.max(0, Math.floor(items.findIndex(c => c.id === selected?.id) / LIMIT)) * LIMIT;
  const start = Math.min(offset ?? selectedPage, Math.max(0, Math.floor((items.length - 1) / LIMIT) * LIMIT));
  const index = items.findIndex(c => c.id === selected?.id);
  const choose = (constraint: Constraint, pane?: "rule" | "lens") => {
    setQuery(""); setOffset(undefined); onSelect(constraint.id, pane);
  };
  const hasDisplayFilter = visibility.minApplicability > 0 || visibility.hiddenLayers.length > 0 || visibility.hiddenConstraints.length > 0;
  const orderedGroups = [...groups.values()].filter(group => !visibility.hiddenLayers.includes(group.id) && (!hasDisplayFilter || group.constraints.length > 0));
  if (guided) orderedGroups.sort((a, b) => Math.min(5, ...a.constraints.map(c => priority(c).tier)) - Math.min(5, ...b.constraints.map(c => priority(c).tier)));
  return <section aria-label="Constraint hierarchy" className="space-y-3">
    {guided && evidenceState && evidenceState !== "ready" && <p className="text-xs text-text-muted" role="note">{evidenceState === "loading" ? "Checking applicability and activity coverage… All rules remain available while evidence loads." : evidenceState === "error" ? "Coverage could not be checked. Showing the catalogue without data-based prioritization." : "Select the project’s mapped data to prioritize by applicability. Coverage is currently unknown."}</p>}
    {guided && template && <details><summary className="cursor-pointer text-sm font-medium">Start from a process template</summary><div className="mt-3">{template}</div></details>}

    {!overview && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setOffset(0); onOverview(); }}>← All layers</Button>}
    <div><h2 className="text-base font-semibold">{overview ? "Choose a business purpose" : layer?.name ?? "New expectation"}</h2>
      <p className="mt-1 text-xs text-text-muted">{overview ? "Start with one layer, then inspect its expectations. Layer descriptions are saved guidance, not current dataset findings." : `Showing this layer’s ${layer?.constraints.length ?? 0} constraints. Search across all layers when needed.`}</p></div>
    {overview && <ol aria-label="How to explore the norm" className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface-sunken p-3 text-sm">
      <li><span className="font-semibold">1 · Purpose</span></li><li aria-hidden="true">→</li><li>2 · Layer</li><li aria-hidden="true">→</li><li>3 · Expectation & evidence</li>
    </ol>}
    <div><label className="mb-1 block text-xs font-medium" htmlFor={`${id}-search`}>Find a constraint</label><Input id={`${id}-search`} type="search" placeholder="Search all layers…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />{query && <Button className="mt-1" size="sm" variant="ghost" onClick={() => { setQuery(""); setOffset(0); }}>Clear search</Button>}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needsReview} onChange={e => { setNeedsReview(e.target.checked); setOffset(0); }} />Needs review only <span className="text-text-muted">({constraints.filter(attention).length})</span></label>
    {overview && !search ? <><div className="mx-auto max-w-2xl rounded-lg border border-accent/40 bg-accent-subtle p-4 text-center"><p className="text-xs font-medium uppercase tracking-wide text-text-muted">Process purpose</p><p className="mt-1 font-semibold">{readAuthoringBrief(document).goal || document.name || "Define the purpose in the guided overview"}</p><p className="mt-1 text-xs text-text-muted">{readAuthoringBrief(document).goal ? "The working question is explored through these layers." : "Record your business goal in the guided overview to give these layers a shared purpose."}</p></div><div aria-hidden="true" className="mx-auto h-5 w-px bg-border" /><div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Business purpose layers">
      {orderedGroups.map((group, position) => {
        const pending = group.constraints.filter(c => missing.includes(c.id)).length;
        const flagged = group.constraints.filter(c => warnings.has(c.id)).length;
        const eligible = group.constraints.filter(c => !needsReview || attention(c));
        if (needsReview && !eligible.length) return null;
        const later = group.constraints.filter(c => priority(c).deferred).length;
        const words = readLayerGuidance(document, group.id);
        return <div key={group.id} className="flex flex-col"><button type="button" aria-label={`Explore ${group.name}`} disabled={!eligible.length} onClick={() => choose(eligible[0]!)} className="group flex flex-1 min-h-36 flex-col rounded-lg border border-border bg-surface p-4 text-left hover:border-accent hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
          <span className="mb-2 flex w-full items-center justify-between text-xs text-text-muted"><span>Layer {position + 1}</span><span>{group.constraints.length} constraints →</span></span>
          <span className="text-base font-semibold">{group.name}</span>
          <span className="mt-2 line-clamp-2 text-sm text-text-muted">{words.why || words.expectation || group.description || "Explore the expectations grouped under this purpose."}</span>
          {guided && relevance && <span className="mt-2 text-xs text-text-muted">{group.constraints.length - later} to explore · {later} lower-evidence</span>}
          <span className="mt-auto flex flex-wrap gap-x-3 pt-3 text-xs"><span>{pending} decisions needed</span><span>{flagged} measurement / rule warnings</span></span>
        </button>{onHideLayer && <Button size="sm" variant="ghost" aria-label={`Hide layer ${group.name} from picture`} onClick={() => onHideLayer(group.id)}>Hide from picture</Button>}</div>;
      })}
      {needsReview && !matches.length && <p className="text-sm text-text-muted">No constraints need review according to the available decisions and run warnings. This is not an approval.</p>}
      {!orderedGroups.length && <p className="text-sm text-text-muted">No layers match the display settings. Restore hidden items or lower the applicability filter.</p>}
    </div></> : <>
      {!search && (guidance.why || guidance.expectation || layer?.description) && <details className="rounded border border-border bg-surface-sunken p-2 text-xs"><summary className="cursor-pointer font-medium">Why this layer matters</summary><p className="mt-2 text-text-muted">Saved norm guidance; figures here are not recalculated findings for this dataset.</p><p className="mt-2">{guidance.why || guidance.expectation || layer?.description}</p>{guidance.checks.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{guidance.checks.slice(0, 3).map((check, i) => <li key={i}>{check}</li>)}</ul>}</details>}
      {guided && !search && deferred.length > 0 && <label className="flex items-start gap-2 rounded border border-border bg-surface-sunken p-2 text-xs"><input type="checkbox" checked={showDeferred} onChange={e => { setShowDeferred(e.target.checked); setOffset(undefined); }} />Show lower-evidence constraints ({deferred.length})</label>}
      {guided && !search && !showDeferred && selected && priority(selected).deferred && <p className="text-xs text-text-muted">This selected rule stays visible. Other lower-evidence rules are folded away.</p>}
      <section aria-label={search ? "Constraint search results" : layer?.name ?? "Constraints"}>
        <p role="status" className="mb-2 text-xs text-text-muted">{search ? `${items.length} matches across all layers` : `${items.length} in this layer${needsReview ? " need review" : ""}${guided && !showDeferred && deferred.length ? " visible" : ""}`} · {items.length ? `${start + 1}–${Math.min(start + LIMIT, items.length)} shown` : "none shown"}</p>
        <ul className="space-y-2 border-l-2 border-border pl-2">{items.slice(start, start + LIMIT).map(c => <li key={c.id}>
          <button type="button" aria-label={`${constraintName(c)}${missing.includes(c.id) ? " · Review decision needed" : ""}`} title={constraintName(c)} aria-pressed={selected?.id === c.id} onClick={() => choose(c)} className={`w-full rounded border p-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === c.id ? "border-accent bg-selection" : "border-transparent hover:bg-surface-sunken"}`}>
            <span className="line-clamp-2 font-medium">{constraintName(c)}</span>
            {search && <span className="mt-1 block text-xs text-text-muted">{groups.get(c.layer)?.name}</span>}
            {relevance && <span className="mt-1 block text-xs text-text-muted">{priority(c).label}</span>}
            {relevance && evidence.get(c.id)?.observedCases != null && evidence.get(c.id)?.casesInScope != null && <span className="block text-xs text-text-muted">{evidence.get(c.id)!.observedCases!.toLocaleString()} / {evidence.get(c.id)!.casesInScope!.toLocaleString()} applicable cases with a named activity</span>}
            {missing.includes(c.id) && <span className="block text-xs text-warning">Review decision needed</span>}
          </button>
          {onHideConstraint && <Button size="sm" variant="ghost" aria-label={`Hide constraint ${constraintName(c)} from picture`} onClick={() => onHideConstraint(c.id)}>Hide</Button>}
          {warnings.has(c.id) && <CalibrationAction className="mt-1 text-left" warning={warnings.get(c.id)!} numeric={!!thresholdOf(c)} name={constraintName(c)} onClick={() => choose(c, "lens")} />}
        </li>)}</ul>
        {!items.length && <p className="text-sm text-text-muted">No matching constraints. Clear the search or review filter to see more.</p>}
        {items.length > LIMIT && <div className="mt-2 flex justify-between gap-2"><Button variant="outline" size="sm" disabled={start === 0} onClick={() => setOffset(start - LIMIT)}>Previous page</Button><Button variant="outline" size="sm" disabled={start + LIMIT >= items.length} onClick={() => setOffset(start + LIMIT)}>Next page</Button></div>}
      </section>
      {!overview && !search && <div className="flex justify-between gap-2 border-t border-border pt-3"><Button size="sm" variant="outline" disabled={index <= 0} onClick={() => choose(items[index - 1]!)}>Previous in layer</Button><Button size="sm" variant="outline" disabled={index < 0 || index >= items.length - 1} onClick={() => choose(items[index + 1]!)}>Next in layer</Button></div>}
    </>}
    <div className="border-t border-border pt-3">{children}</div>
  </section>;
}
