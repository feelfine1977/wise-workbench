import { allNormItems, constraintVisible, type NormVisibility } from "./normVisibility";
import type { NormRelevance } from "@/lib/api/normRelevance";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { viewColor } from "@/lib/viewColors";
import { constraintName, validWeight, type NormDocument, type NormView } from "./normAuthoring";
import type { Constraint } from "./Builder";

export interface ConstraintLayerMapProps {
  document: NormDocument;
  onConstraint: (id: string) => void;
  visibility?: NormVisibility;
  relevance?: NormRelevance;
  onHideLayer?: (id: string) => void;
  onHideConstraint?: (id: string) => void;
  onStructure: (step: "layers" | "views", view?: string) => void;
}

type Group = { id: string; name: string; known: boolean; constraints: Constraint[] };
type Relation = { kind: string; name: string; layer: string; layerId: string; constraint?: string; view?: string; weight: string };
const PAGE_SIZE = 12;
const TABLE_SIZE = 24;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const hasDirectWeights = (view: NormView) => view.constraint_weights != null;
const displayWeight = (value: number) => !validWeight(value) ? "Invalid weight" : value === 0 ? "0 · Not weighted" : String(value);
function configuredWeight(weights: Record<string, number> | undefined, id: string): string {
  if (weights == null) return "Not configured";
  return Object.hasOwn(weights, id) ? displayWeight(weights[id]!) : "0 · Not weighted (not set)";
}
const withinWeight = (constraint: Constraint) => constraint.weight == null ? "1 (default)" : displayWeight(constraint.weight);

function Pagination({ page, total, size, label, onPage }: {
  page: number; total: number; size: number; label: string; onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  return <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
    <span aria-live="polite">{page * size + 1}–{Math.min((page + 1) * size, total)} of {total}</span>
    <div className="flex gap-2">
      <Button className={focus} size="sm" variant="outline" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
      <Button className={focus} size="sm" variant="outline" aria-label={`Next ${label}`} disabled={(page + 1) * size >= total} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  </div>;
}

/** A read-only association map. Selection never changes the norm, data context, or shared rules. */
export function ConstraintLayerMap({ document, onConstraint, onStructure, visibility = allNormItems, relevance, onHideLayer, onHideConstraint }: ConstraintLayerMapProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selectedView, setSelectedView] = useState<number | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<"map" | "table">("map");
  const [expanded, setExpanded] = useState(() => {
    const first = document.layers?.[0]?.id ?? document.constraints?.[0]?.layer;
    return new Set(first === undefined ? [] : [first]);
  });
  const [pages, setPages] = useState(new Map<string, number>());
  const [tablePage, setTablePage] = useState(0);
  const views = document.views ?? [];
  const activeView = selectedView === null ? undefined : views[selectedView];
  const visibleViews = activeView ? [activeView] : views;
  const search = query.trim().toLocaleLowerCase();
  const { groups, notes } = useMemo(() => {
    const layers = document.layers ?? [];
    const constraints = document.constraints ?? [];
    const byLayer = new Map<string, Group>(layers.map(layer => [layer.id, { id: layer.id, name: layer.name || "Unnamed layer", known: true, constraints: [] }]));
    for (const constraint of constraints) {
      if (!byLayer.has(constraint.layer)) byLayer.set(constraint.layer, { id: constraint.layer, name: constraint.layer ? `Unknown layer: ${constraint.layer}` : "Unassigned layer", known: false, constraints: [] });
      byLayer.get(constraint.layer)!.constraints.push(constraint);
    }
    const notes: string[] = [];
    for (const view of document.views ?? []) {
      const direct = hasDirectWeights(view);
      const weights = direct ? view.constraint_weights : view.layer_weights;
      if (direct && view.layer_weights != null) notes.push(`${view.name}: both weight types are present; showing direct constraint weights. Review this configuration.`);
      if (weights == null) notes.push(`${view.name}: weights are not configured.`);
      else {
        const known = new Set(direct ? constraints.map(c => c.id) : layers.map(layer => layer.id));
        for (const [key, value] of Object.entries(weights)) {
          if (!known.has(key)) notes.push(`${view.name}: unknown ${direct ? "constraint" : "layer"} “${key}” — ${displayWeight(value)}.`);
          else if (!validWeight(value)) notes.push(`${view.name}: invalid weight for “${key}”.`);
        }
        const hasPositive = constraints.some(c => direct
          ? validWeight(weights[c.id] ?? 0) && (weights[c.id] ?? 0) > 0
          : known.has(c.layer) && validWeight(weights[c.layer] ?? 0) && (weights[c.layer] ?? 0) > 0 && validWeight(c.weight ?? 1) && (c.weight ?? 1) > 0);
        if (!hasPositive) notes.push(`${view.name}: no positive configured weight on an assigned constraint.`);
      }
    }
    return { groups: Array.from(byLayer.values()), notes };
  }, [document]);
  const displayFiltered = visibility.minApplicability > 0 || visibility.hiddenLayers.length > 0 || visibility.hiddenConstraints.length > 0;
  const filteredGroups = groups.filter(group => !visibility.hiddenLayers.includes(group.id)).map(group => ({ ...group, matches: group.constraints.filter(c =>
    constraintVisible(c, visibility, relevance) && (!search || `${constraintName(c)} ${c.id} ${group.name} ${group.id}`.toLocaleLowerCase().includes(search))),
  })).filter(group => (!displayFiltered || group.matches.length > 0) && (!search || group.matches.length > 0 || `${group.name} ${group.id}`.toLocaleLowerCase().includes(search)));
  const highlightedLayer = filteredGroups.find(group => group.id === selectedLayer);
  const directViews = visibleViews.filter(hasDirectWeights);
  const rows: Relation[] = filteredGroups.flatMap(group => [
    ...visibleViews.filter(view => !hasDirectWeights(view)).map(view => ({ kind: "Layer weight", name: group.name, layer: group.name, layerId: group.id, view: view.name, weight: configuredWeight(view.layer_weights, group.id) })),
    ...group.matches.flatMap(constraint => [
      { kind: "Weight within layer", name: constraintName(constraint), layer: group.name, layerId: group.id, constraint: constraint.id, weight: withinWeight(constraint) },
      ...directViews.map(view => ({ kind: "Direct constraint weight", name: constraintName(constraint), layer: group.name, layerId: group.id, constraint: constraint.id, view: view.name, weight: configuredWeight(view.constraint_weights, constraint.id) })),
    ]),
  ]);
  const page = Math.min(tablePage, Math.max(0, Math.ceil(rows.length / TABLE_SIZE) - 1));
  const changeView = (index: number | null) => { setSelectedView(index); setTablePage(0); };
  const toggleLayer = (layer: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  });

  return <section aria-label="Constraint, layer and view map" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl space-y-1">
        <h2 className="text-base font-semibold">How this norm fits together</h2>
        <p id={`${id}-meaning`} className="text-sm text-text-muted">Constraints belong to layers. Views set relative weights. These are configured weights, not performance scores, causal effects or process flows.</p>
        <p className="text-xs text-text-muted">One shared rule per constraint. Within-layer weights do not apply to direct-weight views.</p>
      </div>
      <div role="group" aria-label="Map presentation" className="flex gap-2">
        <Button className={focus} size="sm" variant="outline" aria-pressed={presentation === "map"} onClick={() => setPresentation("map")}>Map</Button>
        <Button className={focus} size="sm" variant="outline" aria-pressed={presentation === "table"} onClick={() => setPresentation("table")}>Table</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <label className="mb-1 block text-sm" htmlFor={`${id}-search`}>Find constraints or layers</label>
        <Input className={focus} id={`${id}-search`} type="search" value={query} onChange={event => { setQuery(event.target.value); setPages(new Map()); setTablePage(0); }} />
      </div>
      {query && <Button className={focus} size="sm" variant="ghost" onClick={() => { setQuery(""); setPages(new Map()); setTablePage(0); }}>Clear search</Button>}
      <Button className={focus} size="sm" variant="outline" onClick={() => onStructure("layers")}>Edit layers</Button>
    </div>
    <p role="status" className="text-xs text-text-muted">
      {filteredGroups.reduce((sum, group) => sum + group.matches.length, 0)} of {document.constraints?.length ?? 0} constraints · {activeView ? `${activeView.name} weights` : "All views"}{highlightedLayer ? ` · Highlighted layer: ${highlightedLayer.name}` : ""}. Selection changes this map only.
    </p>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className={`min-w-0 space-y-3 ${presentation === "map" ? "max-h-[70vh] overflow-y-auto p-1" : ""}`} role="region" aria-label="Layer groups and relationships" tabIndex={presentation === "map" ? 0 : undefined}>
        {presentation === "map" ? <>
          {highlightedLayer && <Button className={focus} size="sm" variant="ghost" onClick={() => setSelectedLayer(null)}>Clear layer highlight</Button>}
          {filteredGroups.map((group, groupIndex) => {
            const open = !!search || expanded.has(group.id);
            const groupPage = Math.min(pages.get(group.id) ?? 0, Math.max(0, Math.ceil(group.matches.length / PAGE_SIZE) - 1));
            return <section key={group.id} aria-label={`Layer: ${group.name}`} className={`min-w-0 rounded border p-3 ${selectedLayer === group.id ? "border-accent bg-selection" : "border-border bg-surface"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3><button className={`min-h-7 break-words text-left text-sm font-semibold ${focus}`} type="button" aria-label={`Highlight layer ${group.name}`} aria-pressed={selectedLayer === group.id} onClick={() => setSelectedLayer(previous => previous === group.id ? null : group.id)}>{group.name}</button></h3>
                  <p className="text-xs text-text-muted">{group.matches.length} of {group.constraints.length} constraints shown{!group.known ? " · Layer assignment needs review" : ""}</p>
                </div>
                <div className="flex flex-wrap gap-1">{onHideLayer && <Button size="sm" variant="ghost" aria-label={`Hide layer ${group.name} from picture`} onClick={() => onHideLayer(group.id)}>Hide</Button>}<Button className={focus} size="sm" variant="ghost" aria-label={`${open ? "Collapse" : "Expand"} constraints in ${group.name}`} aria-expanded={open} aria-controls={`${id}-layer-${groupIndex}`} disabled={!!search} onClick={() => toggleLayer(group.id)}>{open ? "Collapse" : "Expand"}</Button></div>
              </div>
              <ul aria-label={`View relationships for ${group.name}`} className="mt-3 flex flex-wrap gap-2">
                {visibleViews.map((view, index) => <li key={`${view.name}-${index}`} className="max-w-full">
                  <button type="button" className={`min-h-7 max-w-full rounded border border-border bg-surface px-2 py-1 text-left text-xs ${focus}`} style={{ borderLeft: `3px solid ${viewColor(view.name)}` }} aria-label={hasDirectWeights(view) ? `Edit ${view.name} direct constraint weights in ${group.name}` : `Edit ${view.name} weights for layer ${group.name}`} onClick={() => onStructure("views", view.name)}>
                    <span className="break-words font-medium">{view.name}</span>
                    <span className="ml-2">{hasDirectWeights(view) ? "Direct constraint weights below" : `Layer weight: ${configuredWeight(view.layer_weights, group.id)}`}</span>
                  </button>
                  {!hasDirectWeights(view) && validWeight(view.layer_weights?.[group.id] ?? 0) && (view.layer_weights?.[group.id] ?? 0) > 0 && !group.constraints.some(c => validWeight(c.weight ?? 1) && (c.weight ?? 1) > 0) && <span className="mt-1 block text-xs text-text-muted">No weighted constraints in this layer.</span>}
                </li>)}
              </ul>
              <div id={`${id}-layer-${groupIndex}`} hidden={!open} className="mt-3">
                {group.matches.length ? <>
                  <ul aria-label={`Constraints in ${group.name}`} className="space-y-2 border-l-2 border-border pl-3">
                    {group.matches.slice(groupPage * PAGE_SIZE, (groupPage + 1) * PAGE_SIZE).map(constraint => <li key={constraint.id} className="min-w-0 rounded border border-border bg-surface p-2">
                      <button className={`group min-h-7 w-full text-left text-sm text-accent-text underline ${focus}`} type="button" onClick={() => onConstraint(constraint.id)} aria-label={`Open constraint ${constraintName(constraint)}`}><span className="line-clamp-2 break-words group-focus-visible:line-clamp-none" title={constraintName(constraint)}>{constraintName(constraint)}</span></button>
                      {onHideConstraint && <Button size="sm" variant="ghost" aria-label={`Hide constraint ${constraintName(constraint)} from picture`} onClick={() => onHideConstraint(constraint.id)}>Hide</Button>}
                      <p className="mt-1 text-xs text-text-muted">Weight within layer: {withinWeight(constraint)}</p>
                      {directViews.length > 0 && <ul aria-label={`Direct view weights for ${constraintName(constraint)}`} className="mt-1 flex flex-wrap gap-2">
                        {directViews.map((view, index) => <li key={`${view.name}-${index}`}><button type="button" className={`min-h-7 break-words rounded border border-border px-2 text-left text-xs ${focus}`} aria-label={`Edit ${view.name} weight for ${constraintName(constraint)}`} onClick={() => onStructure("views", view.name)}>{view.name} · Direct weight: {configuredWeight(view.constraint_weights, constraint.id)}</button></li>)}
                      </ul>}
                    </li>)}
                  </ul>
                  <Pagination page={groupPage} total={group.matches.length} size={PAGE_SIZE} label={`constraints in ${group.name}`} onPage={next => setPages(previous => new Map(previous).set(group.id, next))} />
                </> : <p className="text-sm text-text-muted">No constraints assigned.</p>}
                {search && <p className="mt-2 text-xs text-text-muted">Matching layers are expanded while searching.</p>}
              </div>
            </section>;
          })}
        </> : <div className="space-y-2">
          <p className="text-xs text-text-muted">Each row names one relationship. Layer weights are shown once per layer and view; direct weights are shown per constraint. Shared within-layer weights are listed separately.</p>
          <div className={`max-h-[65vh] overflow-auto rounded border border-border ${focus}`} role="region" aria-label="Configured weight relationships table" tabIndex={0}>
            <table className="w-full text-left text-sm" aria-describedby={`${id}-meaning`}>
              <caption className="p-2 text-left font-medium">Configured weight relationships</caption>
              <thead className="sticky top-0 bg-surface"><tr>{["Relationship", "Layer / constraint", "View", "Configured weight"].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
              <tbody>{rows.slice(page * TABLE_SIZE, (page + 1) * TABLE_SIZE).map((row, index) => <tr key={`${page}-${index}`} className={`border-t border-border ${highlightedLayer?.id === row.layerId ? "bg-selection" : ""}`}>
                <td className="p-2 align-top">{row.kind}</td>
                <th scope="row" className="max-w-xs p-2 align-top font-normal"><button type="button" className={`min-h-7 break-words text-left text-accent-text underline ${focus}`} onClick={() => row.constraint !== undefined ? onConstraint(row.constraint) : onStructure("layers")}>{row.name}</button>{row.constraint !== undefined && <span className="block text-xs text-text-muted">Layer: {row.layer}</span>}</th>
                <td className="p-2 align-top">{row.view !== undefined ? <button type="button" className={`min-h-7 text-left text-accent-text underline ${focus}`} onClick={() => onStructure("views", row.view)}>{row.view}</button> : "Shared within layer"}</td>
                <td className="p-2 align-top">{row.weight}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <Pagination page={page} total={rows.length} size={TABLE_SIZE} label="weight relationships" onPage={setTablePage} />
          {!rows.length && <p className="text-sm text-text-muted">No configured relationships to show.</p>}
        </div>}
        {!filteredGroups.length && <p className="rounded border border-border p-3 text-sm text-text-muted">{search ? "No matching constraints or layers. Try a different name or ID." : displayFiltered ? "No layers or constraints are visible. Restore hidden items or adjust applicability." : "No layers or constraints yet. Add them in the layer editor."}</p>}
      </div>
      <aside aria-label="View weighting bookmarks" className="min-w-0 rounded border border-border bg-surface p-3 lg:sticky lg:top-4">
        <h3 className="mb-1 text-sm font-semibold">Views · weighting priorities</h3>
        <p className="mb-3 text-xs text-text-muted">Colors identify views. Select a view to focus its relationships.</p>
        <Button className={`mb-2 w-full ${focus}`} size="sm" variant="outline" aria-pressed={!activeView} onClick={() => changeView(null)}>All views</Button>
        <ul className="space-y-2">{views.map((view, index) => <li key={`${view.name}-${index}`}>
          <button type="button" className={`min-h-10 w-full rounded border border-border p-2 text-left text-sm ${focus} ${activeView === view ? "bg-selection" : "hover:bg-surface-sunken"}`} style={{ borderLeft: `3px solid ${viewColor(view.name)}` }} aria-label={`Show ${view.name || "Unnamed view"} weights`} aria-pressed={activeView === view} onClick={() => changeView(index)}>
            <span className="block break-words font-medium">{view.name || "Unnamed view"}</span>
            <span className="block text-xs text-text-muted">{hasDirectWeights(view) ? "Direct constraint weights" : view.layer_weights == null ? "Weights not configured" : "Layer weights"}</span>
          </button>
        </li>)}</ul>
        {!views.length && <p className="text-sm text-text-muted">No views configured.</p>}
        <Button className={`mt-3 w-full ${focus}`} size="sm" variant="outline" onClick={() => activeView ? onStructure("views", activeView.name) : onStructure("views")}>Edit view weights</Button>
        {notes.length > 0 && <details className="mt-3 border-t border-border pt-2 text-xs"><summary className={`min-h-7 cursor-pointer ${focus}`}>Configuration notes ({notes.length})</summary><ul className="max-h-64 list-disc space-y-2 overflow-auto break-words py-2 pl-4">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
      </aside>
    </div>
  </section>;
}
