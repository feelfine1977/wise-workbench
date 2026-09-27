import { Fragment, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { constraintName, validWeight, type NormDocument } from "./normAuthoring";
import { generalBenchmarkName, layerTotal, rawViewWeights } from "./viewMembership";
import { membershipBatch } from "./membershipBatch";
import { viewColor } from "@/lib/viewColors";

const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];
const number = (value: number) => validWeight(value) ? Number(value.toPrecision(4)).toString() : "Invalid";

export function StakeholderMatrix({ document, onChange, onEdit, onConstraint }: {
  document: NormDocument; onChange: (document: NormDocument) => void;
  onEdit: (view: string, layer: string) => void; onConstraint: (id: string) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [bulk, setBulk] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [proposal, setProposal] = useState<boolean>();
  const [undo, setUndo] = useState<{ before: NormDocument; after: NormDocument }>();
  const benchmark = generalBenchmarkName(document);
  const views = [...document.views ?? []].sort((a, b) => Number(b.name === benchmark) - Number(a.name === benchmark));
  const constraints = document.constraints ?? [];
  const weights = new Map(views.map(view => [view.name, rawViewWeights(document, view)]));
  const invalidWeights = constraints.some(c => !validWeight(c.weight ?? 1)) || views.some(v => Object.values(v.constraint_weights ?? v.layer_weights ?? {}).some(w => !validWeight(w)));
  const preview = proposal === undefined ? undefined : membershipBatch(document, columns, rows, proposal);
  const canUndo = undo && JSON.stringify(undo.after) === JSON.stringify(document);
  return <section aria-label="Stakeholder weighting matrix" className="space-y-3 rounded border border-border bg-surface p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-base font-semibold">Compare priorities</h3><p className="mt-1 text-xs text-text-muted">Configured weights and membership. These are not performance scores.</p></div>
      <Button size="sm" variant="outline" aria-pressed={bulk} onClick={() => { setBulk(!bulk); setRows([]); setColumns([]); }}>Change several memberships</Button>
    </div>
    {bulk && <div className="space-y-2 rounded border border-border bg-surface-sunken p-3">
      {invalidWeights && <p className="text-xs text-danger">Correct invalid weights before changing memberships.</p>}
      <p className="text-sm">Select rows and stakeholder columns, then preview the change.</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs" role="status">{rows.length} constraints · {columns.length} views selected</span>
        <Button size="sm" variant="outline" disabled={invalidWeights || !rows.length || !columns.length} onClick={() => setProposal(true)}>Preview inclusion</Button>
        <Button size="sm" variant="outline" disabled={invalidWeights || !rows.length || !columns.length} onClick={() => setProposal(false)}>Preview exclusion</Button>
        <Button size="sm" variant="ghost" onClick={() => { setRows([]); setColumns([]); }}>Clear selection</Button>
      </div>
    </div>}
    {canUndo && <Button size="sm" variant="ghost" onClick={() => { onChange(undo.before); setUndo(undefined); }}>Undo membership change</Button>}
    <div className="max-h-[65vh] overflow-auto rounded border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Scroll priority matrix" tabIndex={0}>
      <table className="w-full text-left text-sm" aria-describedby={`${id}-meaning`}>
        <caption className="sr-only">Layers, constraints and stakeholder membership</caption>
        <thead className="sticky top-0 z-10 bg-surface"><tr><th scope="col" className="min-w-56 p-3">Layer / expectation</th>{views.map(view => <th scope="col" className="min-w-36 p-3 align-top" key={view.name} style={{ borderTop: `3px solid ${viewColor(view.name)}` }}>
          {bulk && view.name !== benchmark ? <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Select view ${view.name}`} checked={columns.includes(view.name)} onChange={() => setColumns(toggle(columns, view.name))} />{view.name}</label> : view.name}
          <span className="mt-1 block text-xs font-normal text-text-muted">{view.name === benchmark ? "Derived · read only" : view.constraint_weights != null ? "Direct weights" : "Layer weights"}</span>
        </th>)}</tr></thead>
        <tbody>{(document.layers ?? []).map(layer => {
          const members = constraints.filter(c => c.layer === layer.id);
          const selectedCount = members.filter(c => rows.includes(c.id)).length;
          const open = expanded.includes(layer.id);
          return <Fragment key={layer.id}>
            <tr className="border-t border-border bg-surface-sunken"><th scope="row" className="p-3 font-medium"><div className="flex items-center gap-2">
              {bulk && <input type="checkbox" aria-label={`Select layer ${layer.name}`} checked={members.length > 0 && selectedCount === members.length} ref={el => { if (el) el.indeterminate = selectedCount > 0 && selectedCount < members.length; }} disabled={!members.length} onChange={e => setRows(e.target.checked ? [...new Set([...rows, ...members.map(c => c.id)])] : rows.filter(cid => !members.some(c => c.id === cid)))} />}
              <button type="button" className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={`${open ? "Collapse" : "Expand"} matrix layer ${layer.name}`} aria-expanded={open} onClick={() => setExpanded(toggle(expanded, layer.id))}><span aria-hidden="true">{open ? "▾" : "▸"} </span>{layer.name}<span className="ml-2 text-xs font-normal text-text-muted">{members.length}</span></button>
            </div></th>{views.map(view => {
              const count = members.filter(c => weights.get(view.name)![c.id]! > 0).length;
              const total = layerTotal(document, view, layer.id);
              return <td key={view.name} className="p-2"><button type="button" aria-label={`${view.name === benchmark ? "Inspect" : "Edit"} ${view.name}: ${layer.name}`} className="w-full rounded border border-border bg-surface p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent hover:bg-selection" onClick={() => onEdit(view.name, layer.id)}><span className="block">{count ? `${count}/${members.length} included` : "Excluded"}</span><span className="text-xs text-text-muted">Weight {number(total)}</span></button></td>;
            })}</tr>
            {open && members.map(c => <tr key={c.id} className="border-t border-border"><th scope="row" className="py-2 pl-7 pr-3 font-normal"><div className="flex items-center gap-2">{bulk && <input type="checkbox" aria-label={`Select constraint ${constraintName(c)}`} checked={rows.includes(c.id)} onChange={() => setRows(toggle(rows, c.id))} />}<button type="button" className="text-left text-accent-text underline" onClick={() => onConstraint(c.id)}>{constraintName(c)}</button></div></th>{views.map(view => {
              const value = weights.get(view.name)![c.id] ?? 0;
              return <td key={view.name} className="p-3"><span>{value > 0 ? "Included" : validWeight(value) ? "Excluded" : "Invalid weight"}</span><span className="block text-xs text-text-muted">{view.constraint_weights != null ? "Direct" : "Allocated"} weight {number(value)}</span></td>;
            })}</tr>)}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <p id={`${id}-meaning`} className="text-xs text-text-muted">General includes the union of constraints used by any view, equally weighted by layer. Layer-weight views divide each layer’s weight among its constraints; direct-weight views set each constraint’s weight. Raw weights are not comparable scores.</p>
    <Dialog open={proposal !== undefined} onOpenChange={open => { if (!open) setProposal(undefined); }}><DialogContent>
      <DialogHeader><DialogTitle>{proposal ? "Include" : "Exclude"} selected expectations</DialogTitle><DialogDescription>{preview?.changes.length ?? 0} membership changes in {columns.join(", ")}. Apply to the draft, then save a new version when ready.</DialogDescription></DialogHeader>
      <p className="text-sm">Each affected layer keeps its total weight while it has included constraints. Newly included empty layers start at weight 1. General updates automatically.</p>
      <ul aria-label="Membership changes" className="max-h-64 space-y-1 overflow-auto text-sm">{preview?.changes.map(change => <li key={`${change.view}:${change.constraint}`}>{change.view} · {constraintName(constraints.find(c => c.id === change.constraint)!)} → {change.included ? "included" : "excluded"}</li>)}</ul>
      {!preview?.changes.length && <p className="text-sm">The selected memberships already match this choice.</p>}
      <DialogFooter><Button variant="ghost" onClick={() => setProposal(undefined)}>Cancel</Button><Button disabled={!preview?.changes.length} onClick={() => { if (preview) { setUndo({ before: document, after: preview.document }); onChange(preview.document); } setProposal(undefined); }}>Apply to draft</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
