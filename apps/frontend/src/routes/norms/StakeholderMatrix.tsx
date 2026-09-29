import { viewColor } from "@/lib/viewColors";
import { layerPriorityProfile } from "./layerPriorityProfiles";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, CircleDot, LockKeyhole, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { constraintName, validWeight, type NormDocument } from "./normAuthoring";
import { generalBenchmarkName, layerTotal, rawViewWeights } from "./viewMembership";
import { membershipBatch } from "./membershipBatch";
import "./NormPriorities.css";

const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];
const number = (value: number) => validWeight(value) ? String(value) : "Invalid";
const PAGE_SIZE = 12;

function Inclusion({ count, total, invalid = false }: { count: number; total: number; invalid?: boolean }) {
  const Icon = invalid ? CircleDot : !count ? Minus : count === total ? Check : CircleDot;
  return <span className={`priority-inclusion ${invalid ? "is-invalid" : count ? "is-included" : ""}`}>
    <Icon size={14} aria-hidden="true" />
    {invalid ? "Invalid weight" : !total ? "No expectations" : !count ? "Excluded" : `${count}/${total} included`}
  </span>;
}

export function StakeholderMatrix({ document, onChange, onEdit, onConstraint, focusedLayer, focusRequest }: {
  document: NormDocument; onChange: (document: NormDocument) => void;
  onEdit: (view: string, layer: string, constraint?: string) => void; onConstraint: (id: string) => void;
  focusedLayer?: string; focusRequest?: { layer: string; revision: number };
}) {
  const id = useId();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (focusRequest) rowRefs.current.get(focusRequest.layer)?.focus();
  }, [focusRequest]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [bulk, setBulk] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [proposal, setProposal] = useState<boolean>();
  const [undo, setUndo] = useState<{ before: NormDocument; after: NormDocument }>();
  const benchmark = generalBenchmarkName(document);
  const views = [...document.views ?? []].sort((a, b) => Number(b.name === benchmark) - Number(a.name === benchmark));
  const constraints = document.constraints ?? [];
  const layers = document.layers ?? [];
  const profiles = new Map(views.map(view => [view.name, layerPriorityProfile(document, view)]));
  const weights = new Map(views.map(view => [view.name, rawViewWeights(document, view)]));
  const invalidWeights = constraints.some(c => !validWeight(c.weight ?? 1)) || views.some(v => Object.values(v.constraint_weights ?? v.layer_weights ?? {}).some(w => !validWeight(w)));
  const selectedRows = rows.filter(cid => constraints.some(c => c.id === cid));
  const selectedColumns = columns.filter(name => name !== benchmark && views.some(v => v.name === name));
  const preview = proposal === undefined || invalidWeights ? undefined : membershipBatch(document, selectedColumns, selectedRows, proposal);
  // Reference equality also distinguishes invalid numeric edits (NaN/Infinity) that JSON serializes alike.
  const canUndo = undo && (undo.after === document || (!invalidWeights && JSON.stringify(undo.after) === JSON.stringify(document)));
  const unassigned = constraints.filter(c => !layers.some(l => l.id === c.layer));
  return <section aria-label="Stakeholder weighting matrix" className="norm-priorities priority-matrix">
    <header className="priority-heading">
      <div><p className="priority-eyebrow">Stakeholder priorities</p><h3>One norm, different priorities</h3><p>Configured weights and membership. These are not performance scores.</p></div>
      <Button size="sm" variant="outline" aria-pressed={bulk} onClick={() => { setBulk(!bulk); setRows([]); setColumns([]); }}>Change several memberships</Button>
    </header>
    <div className="priority-summary">
      <span><strong>{layers.length}</strong> layers</span><span><strong>{constraints.length}</strong> expectations</span><span><strong>{views.filter(v => v.name !== benchmark).length}</strong> stakeholder views</span>
      {benchmark && <span className="priority-reference"><LockKeyhole size={13} aria-hidden="true" /> {benchmark} · equal-layer reference</span>}
    </div>
    <div className="priority-matrix-help"><span>Expand a layer to inspect expectations. Select a cell to edit that view. Shares use the same 0–100% scale.</span><span>✓ Included <span aria-hidden="true">·</span> ◉ Partial <span aria-hidden="true">·</span> − Excluded</span></div>
    {invalidWeights && <p role="status" className="priority-notice">Correct invalid weights before changing memberships. Invalid values are not zero.</p>}
    {unassigned.length > 0 && <p role="status" className="priority-notice">{unassigned.length} expectations have no matching layer and are not shown below. Correct their layer assignments.</p>}
    {bulk && <div className="priority-bulk">
      <p>Select expectations and named stakeholder views. Selecting a layer includes all its expectations, including other pages.</p>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm" role="status">{selectedRows.length} constraints · {selectedColumns.length} views selected</span>
        <Button size="sm" variant="outline" disabled={invalidWeights || !selectedRows.length || !selectedColumns.length} onClick={() => setProposal(true)}>Preview inclusion</Button>
        <Button size="sm" variant="outline" disabled={invalidWeights || !selectedRows.length || !selectedColumns.length} onClick={() => setProposal(false)}>Preview exclusion</Button>
        <Button size="sm" variant="ghost" onClick={() => { setRows([]); setColumns([]); }}>Clear selection</Button>
      </div>
    </div>}
    {canUndo && <div className="priority-undo"><span role="status">Membership change applied to this draft.</span><Button size="sm" variant="ghost" onClick={() => { onChange(undo.before); setUndo(undefined); }}>Undo membership change</Button></div>}
    <div className="priority-scroll" role="region" aria-label="Scroll priority matrix" tabIndex={0}>
      <table className="priority-table" aria-describedby={`${id}-meaning`}>
        <caption className="sr-only">Layers, constraints and stakeholder membership. Cells show normalized layer shares and exact raw configured weights.</caption>
        <thead><tr><th scope="col" className="priority-row-label"><span>Layer / expectation</span><small>Shared definitions</small></th>{views.map(view => <th scope="col" key={view.name} className={view.name === benchmark ? "priority-benchmark" : undefined}>
          {bulk && view.name !== benchmark ? <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Select view ${view.name}`} checked={selectedColumns.includes(view.name)} onChange={() => setColumns(toggle(selectedColumns, view.name))} />{view.name || "Unnamed view"}</label> : <span className="flex items-center gap-2" style={{ borderBottom: `2px solid ${viewColor(view.name)}`, paddingBottom: 6 }}>{view.name === benchmark && <LockKeyhole size={13} aria-hidden="true" />}{view.name || "Unnamed view"}</span>}
          <small>{view.name === benchmark ? "Derived · read only" : view.constraint_weights != null ? "Direct weights" : "Layer weights"}</small>
          <small>{constraints.filter(c => (weights.get(view.name)?.[c.id] ?? 0) > 0).length} / {constraints.length} expectations included</small>
        </th>)}</tr></thead>
        <tbody>{layers.map(layer => {
          const members = constraints.filter(c => c.layer === layer.id);
          const selectedCount = members.filter(c => selectedRows.includes(c.id)).length;
          const open = expanded.includes(layer.id);
          const page = Math.min(pages[layer.id] ?? 0, Math.max(0, Math.ceil(members.length / PAGE_SIZE) - 1));
          return <Fragment key={layer.id}>
            <tr className={`priority-layer-row ${focusedLayer === layer.id ? "is-focused" : ""}`}><th scope="row" className="priority-row-label"><div className="flex items-start gap-2">
              {bulk && <input type="checkbox" aria-label={`Select layer ${layer.name}`} checked={members.length > 0 && selectedCount === members.length} ref={el => { if (el) el.indeterminate = selectedCount > 0 && selectedCount < members.length; }} disabled={!members.length} onChange={e => setRows(e.target.checked ? [...new Set([...selectedRows, ...members.map(c => c.id)])] : selectedRows.filter(cid => !members.some(c => c.id === cid)))} />}
              <button ref={el => { if (el) rowRefs.current.set(layer.id, el); else rowRefs.current.delete(layer.id); }} type="button" className="priority-layer-toggle" aria-label={`${open ? "Collapse" : "Expand"} matrix layer ${layer.name}`} aria-expanded={open} onClick={() => setExpanded(toggle(expanded, layer.id))}>
                {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}<span>{layer.name || "Unnamed layer"}<small>{members.length} expectations</small></span>
              </button>
            </div></th>{views.map(view => {
              const count = members.filter(c => (weights.get(view.name)?.[c.id] ?? 0) > 0).length;
              const total = layerTotal(document, view, layer.id);
              const profile = profiles.get(view.name);
              const share = profile?.values.find(value => value.layer === layer.id)?.share;
              const invalid = !validWeight(total) || members.some(c => !validWeight(weights.get(view.name)?.[c.id] ?? 0) || (view.constraint_weights == null && !validWeight(c.weight ?? 1)));
              return <td key={view.name} className={view.name === benchmark ? "priority-benchmark" : undefined}><button type="button" aria-label={`${view.name === benchmark ? "Inspect" : "Edit"} ${view.name}: ${layer.name}`} data-weight-state={invalid ? "invalid" : count ? "included" : "zero"} className="priority-cell" style={{ borderColor: count ? viewColor(view.name) : undefined }} onClick={() => onEdit(view.name, layer.id)}>
                <Inclusion count={count} total={members.length} invalid={invalid} />
                <span className="priority-share">{share == null ? "Unavailable" : `${(share * 100).toFixed(1)}%`}<span> of view weight</span></span>
                {share != null && <span className="priority-share-track" aria-hidden="true"><span style={{ width: `${share * 100}%`, background: viewColor(view.name) }} /></span>}
                <span className="priority-weight"><span>Raw weight {number(total)}</span><ArrowUpRight size={13} aria-hidden="true" /></span>
              </button></td>;
            })}</tr>
            {open && members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(c => <tr key={c.id} className="priority-expectation-row"><th scope="row" className="priority-row-label"><div className="flex items-start gap-2">{bulk && <input type="checkbox" aria-label={`Select constraint ${constraintName(c)}`} checked={selectedRows.includes(c.id)} onChange={() => setRows(toggle(selectedRows, c.id))} />}<button type="button" className="priority-rule-link" onClick={() => onConstraint(c.id)}>{constraintName(c)}<small>{c.id}</small></button></div></th>{views.map(view => {
              const value = weights.get(view.name)?.[c.id] ?? 0;
              const invalid = !validWeight(value) || (view.constraint_weights == null && (!validWeight(c.weight ?? 1) || !validWeight(view.layer_weights?.[c.layer] ?? 0)));
              return <td key={view.name} className={view.name === benchmark ? "priority-benchmark" : undefined}><button type="button" className="priority-cell priority-cell-detail" aria-label={`${view.name === benchmark ? "Inspect" : "Edit"} ${view.name}: ${constraintName(c)}`} onClick={() => onEdit(view.name, layer.id, c.id)}>
                <span className={`priority-inclusion ${invalid ? "is-invalid" : value > 0 ? "is-included" : ""}`}>{value > 0 && !invalid ? <Check size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}{invalid ? "Invalid weight" : value > 0 ? "Included" : "Excluded"}</span>
                <span className="priority-weight">{view.constraint_weights != null ? "Direct" : "Allocated"} weight {number(value)}</span>
              </button></td>;
            })}</tr>)}
            {open && members.length > PAGE_SIZE && <tr><td colSpan={views.length + 1} className="priority-pagination"><div><span role="status">{layer.name}: {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, members.length)} of {members.length} expectations</span><div className="flex gap-2"><Button size="sm" variant="ghost" aria-label={`Previous expectations in ${layer.name}`} disabled={!page} onClick={() => setPages({ ...pages, [layer.id]: page - 1 })}>Previous</Button><Button size="sm" variant="ghost" aria-label={`Next expectations in ${layer.name}`} disabled={(page + 1) * PAGE_SIZE >= members.length} onClick={() => setPages({ ...pages, [layer.id]: page + 1 })}>Next</Button></div></div></td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
      {!layers.length && <p className="priority-empty">Add a layer to start organizing expectations.</p>}
      {!views.length && <p className="priority-empty">Add a view to compare priorities.</p>}
    </div>
    {focusedLayer && layers.some(l => l.id === focusedLayer) && <button type="button" className="priority-return" onClick={() => rowRefs.current.get(focusedLayer)?.focus()}>Go to {layers.find(l => l.id === focusedLayer)?.name} in matrix</button>}
    <p id={`${id}-meaning`} className="priority-footnote">General includes the union of constraints used by any view, equally weighted by participating layer. Layer-weight views divide each layer’s weight among its constraints; direct-weight views set each constraint’s weight. Percentages divide a layer’s configured weight by the view total. Zero effective weight contributes nothing to the score; this format does not store a separate included-at-zero membership flag.</p>
    <Dialog open={proposal !== undefined} onOpenChange={open => { if (!open) setProposal(undefined); }}><DialogContent>
      <DialogHeader><DialogTitle>{proposal ? "Include" : "Exclude"} selected expectations</DialogTitle><DialogDescription>{preview?.changes.length ?? 0} membership changes in {selectedColumns.join(", ")}. Apply to the draft, then save a new version when ready.</DialogDescription></DialogHeader>
      <p className="text-sm">Each affected layer keeps its total weight while it has included constraints. Newly included empty layers start at weight 1. General updates automatically.</p>
      <ul aria-label="Membership changes" className="max-h-64 space-y-2 overflow-auto text-sm">{preview?.changes.map(change => <li key={`${change.view}:${change.constraint}`}>{change.view} · {constraintName(constraints.find(c => c.id === change.constraint)!)} → {change.included ? "included" : "excluded"}<span className="block text-xs text-text-muted">{change.constraint}</span></li>)}</ul>
      {invalidWeights ? <p role="alert">Correct invalid weights before applying this change.</p> : !preview?.changes.length && <p className="text-sm">The selected memberships already match this choice.</p>}
      <DialogFooter><Button variant="ghost" onClick={() => setProposal(undefined)}>Cancel</Button><Button disabled={!preview?.changes.length} onClick={() => { if (preview) { setUndo({ before: document, after: preview.document }); onChange(preview.document); } setProposal(undefined); }}>Apply to draft</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
