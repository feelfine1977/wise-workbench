import { constraintFamily } from "./constraintFamily";
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
  const [expandedLayer, setExpandedLayer] = useState<string>();
  const [family, setFamily] = useState("");
  const { mode } = useNormAuthoringPreferences();
  const guided = mode === "guided";
  const [showDeferred, setShowDeferred] = useState(false);
  const [offset, setOffset] = useState<number>();
  const evidence = new Map((relevance?.constraints ?? []).map(row => [row.id, row]));
  const ranked = orderConstraints((document.constraints ?? []).filter(c => constraintVisible(c, visibility, relevance)), evidence, guided);
  const [orderSnapshot, setOrderSnapshot] = useState(() => ranked.map(c => c.id));
  const ranks = new Map(orderSnapshot.map((key, index) => [key, index]));
  const constraints = guided ? [...ranked].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity)) : ranked;
  const priority = (c: Constraint) => constraintPriority(evidence.get(c.id));
  const groups = new Map((document.layers ?? []).map(layer => [layer.id, { ...layer, constraints: [] as Constraint[] }]));
  for (const c of constraints) {
    if (!groups.has(c.layer)) groups.set(c.layer, { id: c.layer, name: c.layer || "Unassigned", constraints: [] });
    groups.get(c.layer)!.constraints.push(c);
  }
  const activeLayer = overview ? expandedLayer : selected?.layer;
  const layer = groups.get(activeLayer ?? "");
  const guidance = readLayerGuidance(document, layer?.id ?? "");
  const attention = (c: Constraint) => missing.includes(c.id) || warnings.has(c.id);
  const search = query.trim().toLocaleLowerCase();
  const matches = constraints.filter(c => (!needsReview || attention(c)) && (!search || `${constraintName(c)} ${c.id} ${groups.get(c.layer)?.name}`.toLocaleLowerCase().includes(search)));
  const inLayer = matches.filter(c => c.layer === activeLayer);
  const deferred = inLayer.filter(c => priority(c).deferred);
  const families = [...new Set(inLayer.map(c => constraintFamily(c.type)))];
  const items = search ? matches : inLayer.filter(c => (!family || constraintFamily(c.type) === family) && (!guided || showDeferred || !priority(c).deferred || (!overview && c.id === selected?.id)));
  const selectedPage = Math.max(0, Math.floor(items.findIndex(c => c.id === selected?.id) / LIMIT)) * LIMIT;
  const start = Math.min(offset ?? selectedPage, Math.max(0, Math.floor((items.length - 1) / LIMIT) * LIMIT));
  const index = items.findIndex(c => c.id === selected?.id);
  const choose = (constraint: Constraint, pane?: "rule" | "lens") => {
    setQuery(""); setOffset(undefined); setExpandedLayer(constraint.layer); setFamily(""); onSelect(constraint.id, pane);
  };
  const hasDisplayFilter = visibility.minApplicability > 0 || visibility.hiddenLayers.length > 0 || visibility.hiddenConstraints.length > 0;
  const orderedGroups = [...groups.values()].filter(group => !visibility.hiddenLayers.includes(group.id) && (!hasDisplayFilter || group.constraints.length > 0));
  const branch = (search || layer) ? <div id={`${id}-branch`} className="space-y-3">
      {guided && relevance && !search && <Button size="sm" variant="ghost" onClick={() => { setOrderSnapshot(ranked.map(c => c.id)); setOffset(undefined); }}>Reorder by relevance</Button>}
      {overview && !search && <h3 className="text-sm font-semibold">{layer?.name} · choose an expectation</h3>}
      {!search && inLayer.length > LIMIT && families.length > 1 && <div><label className="mb-1 block text-xs" htmlFor={`${id}-family`}>Rule family</label><select id={`${id}-family`} value={family} onChange={e => { setFamily(e.target.value); setOffset(0); }} className="h-control w-full rounded border border-border bg-surface px-2 text-sm"><option value="">All families</option>{families.map(name => <option key={name} value={name}>{name} ({inLayer.filter(c => constraintFamily(c.type) === name).length})</option>)}</select></div>}
      {!search && (guidance.why || guidance.expectation || layer?.description) && <details className="rounded border border-border bg-surface-sunken p-2 text-xs"><summary className="cursor-pointer font-medium">Why this layer matters</summary><p className="mt-2 text-text-muted">Saved norm guidance; figures here are not recalculated findings for this dataset.</p><p className="mt-2">{guidance.why || guidance.expectation || layer?.description}</p>{guidance.checks.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{guidance.checks.slice(0, 3).map((check, i) => <li key={i}>{check}</li>)}</ul>}</details>}
      {guided && !search && deferred.length > 0 && <label className="flex items-start gap-2 rounded border border-border bg-surface-sunken p-2 text-xs"><input type="checkbox" checked={showDeferred} onChange={e => { setShowDeferred(e.target.checked); setOffset(undefined); }} />Show lower-evidence constraints ({deferred.length})</label>}
      {guided && !search && !showDeferred && !overview && selected && priority(selected).deferred && <p className="text-xs text-text-muted">This selected rule stays visible. Other lower-evidence rules are folded away.</p>}
      <section aria-label={search ? "Constraint search results" : layer?.name ?? "Constraints"}>
        <p role="status" className="mb-2 text-xs text-text-muted">{search ? `${items.length} matches across all layers` : `${items.length} in this layer${needsReview ? " need review" : ""}${guided && !showDeferred && deferred.length ? " visible" : ""}`} · {items.length ? `${start + 1}–${Math.min(start + LIMIT, items.length)} shown` : "none shown"}</p>
        <ul className="space-y-2 border-l-2 border-border pl-2">{items.slice(start, start + LIMIT).map(c => <li key={c.id}>
          <button type="button" aria-label={`${constraintName(c)}${missing.includes(c.id) ? " · Review decision needed" : ""}`} title={constraintName(c)} aria-pressed={!overview && selected?.id === c.id} onClick={() => choose(c)} className={`w-full rounded border p-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${!overview && selected?.id === c.id ? "border-accent bg-selection" : "border-transparent hover:bg-surface-sunken"}`}>
            <span className="line-clamp-2 font-medium">{constraintName(c)}</span>
            {search && <span className="mt-1 block text-xs text-text-muted">{groups.get(c.layer)?.name}</span>}
            {relevance && <span className="mt-1 block text-xs text-text-muted">{priority(c).label}</span>}
            {relevance && evidence.get(c.id)?.casesInScope != null && <span className="block text-xs text-text-muted">Applicable: {evidence.get(c.id)!.casesInScope!.toLocaleString()} / {relevance.cases.toLocaleString()} cases{relevance.cases > 0 ? ` (${Math.round(evidence.get(c.id)!.casesInScope! / relevance.cases * 100)}%)` : ""}</span>}
            {missing.includes(c.id) && <span className="block text-xs text-warning">Review decision needed</span>}
          </button>
          {onHideConstraint && <Button size="sm" variant="ghost" aria-label={`Hide constraint ${constraintName(c)} from picture`} onClick={() => onHideConstraint(c.id)}>Hide</Button>}
          {warnings.has(c.id) && <CalibrationAction className="mt-1 text-left" warning={warnings.get(c.id)!} numeric={!!thresholdOf(c)} name={constraintName(c)} onClick={() => choose(c, "lens")} />}
        </li>)}</ul>
        {!items.length && <p className="text-sm text-text-muted">No matching constraints. Clear the search or review filter to see more.</p>}
        {items.length > LIMIT && <div className="mt-2 flex justify-between gap-2"><Button variant="outline" size="sm" disabled={start === 0} onClick={() => setOffset(start - LIMIT)}>Previous page</Button><Button variant="outline" size="sm" disabled={start + LIMIT >= items.length} onClick={() => setOffset(start + LIMIT)}>Next page</Button></div>}
      </section>
      {!overview && !search && <div className="flex justify-between gap-2 border-t border-border pt-3"><Button size="sm" variant="outline" disabled={index <= 0} onClick={() => choose(items[index - 1]!)}>Previous in layer</Button><Button size="sm" variant="outline" disabled={index < 0 || index >= items.length - 1} onClick={() => choose(items[index + 1]!)}>Next in layer</Button></div>}
    </div> : null;
  // Layer positions stay stable when coverage arrives; only unopened rule lists are prioritized.
  return <section aria-label="Constraint hierarchy" className="space-y-3">
    {guided && evidenceState && evidenceState !== "ready" && <p className="text-xs text-text-muted" role="note">{evidenceState === "loading" ? "Checking applicability and activity coverage… All rules remain available while evidence loads." : evidenceState === "error" ? "Coverage could not be checked. Showing the catalogue without data-based prioritization." : "Select the project’s mapped data to prioritize by applicability. Coverage is currently unknown."}</p>}
    {relevance && <p className="text-xs text-text-muted">Coverage: all cases in the prepared dataset. Applicability is not a pass rate.</p>}
    {guided && template && <details><summary className="cursor-pointer text-sm font-medium">Start from a process template</summary><div className="mt-3">{template}</div></details>}

    {(!overview || expandedLayer) && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setOffset(0); setExpandedLayer(undefined); setFamily(""); onOverview(); }}>← All layers</Button>}
    <div><h2 className="text-base font-semibold">{overview ? "Explore expectations" : layer?.name ?? "New expectation"}</h2>
      <p className="mt-1 text-xs text-text-muted">{overview ? "Expand a layer, then choose one expectation to inspect." : "Layer → expectation → rule and evidence"}</p></div>
    <div><label className="mb-1 block text-xs font-medium" htmlFor={`${id}-search`}>Find a constraint</label><Input id={`${id}-search`} type="search" placeholder="Search all layers…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />{query && <Button className="mt-1" size="sm" variant="ghost" onClick={() => { setQuery(""); setOffset(0); }}>Clear search</Button>}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needsReview} onChange={e => { setNeedsReview(e.target.checked); setOffset(0); }} />Needs review only <span className="text-text-muted">({constraints.filter(attention).length})</span></label>
    {overview && !search && <>
      <p className="rounded border border-border bg-surface-sunken p-3 text-sm"><span className="block text-xs text-text-muted">Purpose</span>{readAuthoringBrief(document).goal || document.name || "Define your purpose in the guided overview"}</p>
      <ul className="divide-y divide-border rounded border border-border" aria-label="Business purpose layers">
        {orderedGroups.map(group => {
          const eligible = group.constraints.filter(c => !needsReview || attention(c));
          if (needsReview && !eligible.length) return null;
          const open = expandedLayer === group.id;
          const pending = group.constraints.filter(attention).length;
          return <li key={group.id} className={open ? "bg-selection" : ""}>
            <div className="flex items-center gap-1 p-1">
              <button type="button" aria-label={`Explore ${group.name}`} aria-expanded={open} aria-controls={open ? `${id}-branch` : undefined} disabled={!eligible.length} onClick={() => { setExpandedLayer(open ? undefined : group.id); setOrderSnapshot(ranked.map(c => c.id)); setOffset(0); setFamily(""); }} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent hover:bg-surface-sunken disabled:opacity-60">
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 text-sm font-medium">{group.name}</span>
                <span className="whitespace-nowrap text-xs text-text-muted">{group.constraints.length} rules{pending > 0 ? ` · ${pending} to review` : ""}</span>
              </button>
              {onHideLayer && <Button size="sm" variant="ghost" aria-label={`Hide layer ${group.name} from picture`} onClick={() => onHideLayer(group.id)}>Hide</Button>}
            </div>
            {open && <div className="border-t border-border bg-surface p-3 sm:pl-6">{branch}</div>}
          </li>;
        })}
      </ul>
      {needsReview && !matches.length && <p className="text-sm text-text-muted">No constraints need review according to the available decisions and run warnings. This is not an approval.</p>}
      {!orderedGroups.length && <p className="text-sm text-text-muted">No layers match the display settings. Restore hidden items or lower the applicability filter.</p>}
    </>}
    {(!overview || search) && branch}
    <div className="border-t border-border pt-3">{children}</div>
  </section>;
}
