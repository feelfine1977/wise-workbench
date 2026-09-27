import { useEffect, useRef, useState } from "react";
import { StakeholderMatrix } from "./StakeholderMatrix";
import { viewColor } from "@/lib/viewColors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateNormVersion } from "@/lib/api/norms";
import { CommitFieldsForm, type CommitFields } from "./Builder";
import { normRefusal } from "./normErrors";
import { constraintName, nextLayerId, structureIssues, validWeight, type NormDocument, type NormView } from "./normAuthoring";

import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";
import { generalBenchmarkName, layerTotal, rawViewWeights, setViewConstraintIncluded, setViewLayerWeight, withGeneralBenchmark } from "./viewMembership";

export type AuthoringStep = "constraints" | "layers" | "views";
const inputWeight = (value: string) => value.trim() ? Number(value) : Number.NaN;

export function StructureEditor({ projectId, versionId, document, step, selectedView, onView, onStep, onConstraint, onSaved }: {
  projectId: string; versionId: string; document: NormDocument; step: AuthoringStep;
  selectedView?: string; onView: (view: string) => void;
  onStep: (step: AuthoringStep) => void; onConstraint: (id: string) => void; onSaved: (id: string) => void;
}) {
  const { allowDraftWithoutDecision } = useNormAuthoringPreferences();
  const [draft, setDraftState] = useState(() => withGeneralBenchmark(document));
  const setDraft = (next: NormDocument) => setDraftState(withGeneralBenchmark(next));
  const [layerId, setLayerId] = useState(document.layers?.[0]?.id ?? "");
  const [viewIndex, setViewIndex] = useState(0);
  useEffect(() => {
    const selected = document.views?.findIndex(v => v.name === selectedView) ?? -1;
    if (selected >= 0) setViewIndex(selected);
  }, [selectedView, document]);
  const dormantLayers = useRef(new Map<string, NormView>());
  const [editingView, setEditingView] = useState(false);
  const [newLayer, setNewLayer] = useState("");
  const [newView, setNewView] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [fields, setFields] = useState<CommitFields>({ rationale: "", owner: "" });
  const create = useCreateNormVersion(projectId);
  const layers = draft.layers ?? [];
  const constraints = draft.constraints ?? [];
  const views = draft.views ?? [];
  const duplicateViewName = !!newView.trim() && views.some(v => v.name.trim() === newView.trim());
  const layer = layers.find(l => l.id === layerId) ?? layers[0];
  const view = views[viewIndex];
  const issues = structureIssues(draft);
  const benchmark = generalBenchmarkName(draft);
  const isBenchmark = view?.name === benchmark;
  const dirty = JSON.stringify(draft) !== JSON.stringify(withGeneralBenchmark(document));
  const updateView = (patch: Partial<NormView>) => setDraft({ ...draft, views: views.map((v, i) => i === viewIndex ? { ...v, ...patch } : v) });
  const changeWeight = (id: string, value: string) => {
    if (!view || isBenchmark) return;
    const key = view.constraint_weights != null ? "constraint_weights" : "layer_weights";
    updateView({ [key]: { ...view[key], [id]: inputWeight(value) } });
  };
  const includeLayer = (id: string, included: boolean) => {
    if (!view || isBenchmark) return;
    const key = `${viewIndex}:${id}`;
    if (!included) dormantLayers.current.set(key, view);
    const saved = dormantLayers.current.get(key);
    let changed = setViewLayerWeight(draft, view, id, included ? saved ? layerTotal(draft, saved, id) : 1 : 0);
    if (included && saved?.constraint_weights != null && view.constraint_weights != null) {
      const weights = { ...view.constraint_weights };
      for (const c of constraints.filter(c => c.layer === id)) weights[c.id] = saved.constraint_weights[c.id] ?? 0;
      changed = { ...view, constraint_weights: weights };
    }
    setDraft({ ...draft, views: views.map((v, i) => i === viewIndex ? changed : v) });
  };
  const weightInput = (id: string, label: string, weight: number) => <Input id={id} aria-label={label} className="w-24" type="number" min="0" step="any" value={Number.isNaN(weight) ? "" : weight} aria-invalid={!validWeight(weight) || undefined} onChange={e => changeWeight(id.replace("view-weight-", ""), e.target.value)} />;
  const save = () => {
    setAttempted(true);
    if (!allowDraftWithoutDecision && (!fields.rationale.trim() || !fields.owner.trim())) {
      window.document.getElementById(!fields.rationale.trim() ? "structure-rationale" : "structure-owner")?.focus();
      return;
    }
    if (issues.length) return;
    create.mutate({ norm: { ...draft, layers: layers.map(l => ({ ...l, name: l.name.trim() })), views: views.map(v => ({ ...v, name: v.name.trim() })) }, parentId: versionId, note: allowDraftWithoutDecision ? "Layers and views updated in guided draft" : `Layers and views updated — ${fields.rationale.trim()} (owner: ${fields.owner.trim()})` }, {
      onSuccess: result => { setSaving(false); onSaved(result.id); },
    });
  };
  const matrix = <StakeholderMatrix document={draft} onChange={setDraft} onConstraint={onConstraint} onEdit={(name, layer) => {
    const index = views.findIndex(v => v.name === name);
    setViewIndex(index); setEditingView(true); onStep("views");
    if (document.views?.some(v => v.name === name)) onView(name);
    requestAnimationFrame(() => window.document.getElementById(`view-weight-${layer}`)?.focus());
  }} />;
  return <section aria-label="Layer and view editor" hidden={step === "constraints"} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-text-muted">{step === "layers" ? "Group constraints by business purpose. Each constraint belongs to one layer." : "Choose the layers that matter to each view and set their relative weights."}</p>
      <div className="flex gap-2">
        {dirty && <Button size="sm" variant="ghost" onClick={() => { setDraft(document); dormantLayers.current.clear(); create.reset(); }}>Discard structure changes</Button>}
        <Button size="sm" disabled={!dirty || issues.length > 0} onClick={() => { setSaving(true); setAttempted(false); create.reset(); }}>Save structure as new draft</Button>
      </div>
    </div>
    {dirty && <p role="status" className="text-xs text-text-muted">Unsaved layer or view changes. Existing versions and run results are unchanged.</p>}
    {dirty && issues.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-danger">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {step === "layers" && <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <Card>
        <CardTitle>Layers</CardTitle>
        <ul className="space-y-1">{layers.map(l => <li key={l.id}><button type="button" aria-pressed={layer?.id === l.id} className={`w-full rounded p-2 text-left text-sm ${layer?.id === l.id ? "bg-selection" : "hover:bg-surface-sunken"}`} onClick={() => setLayerId(l.id)}>{l.name || "Unnamed layer"}<span className="block text-xs text-text-muted">{constraints.filter(c => c.layer === l.id).length} constraints</span></button></li>)}</ul>
        <details className="mt-3 border-t border-border pt-3 text-sm"><summary className="cursor-pointer">Add layer</summary>
          <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); if (!newLayer.trim()) return; const id = nextLayerId(layers); setDraft({ ...draft, layers: [...layers, { id, name: newLayer.trim() }] }); setLayerId(id); setNewLayer(""); }}>
            <Field label="New layer name" htmlFor="new-layer-name"><Input id="new-layer-name" required value={newLayer} onChange={e => setNewLayer(e.target.value)} /></Field>
            <Button size="sm" type="submit">Add layer</Button>
          </form>
        </details>
      </Card>
      <Card className="min-w-0">
        {layer ? <>
          <Field label="Layer name" htmlFor="layer-name"><Input id="layer-name" value={layer.name} onChange={e => setDraft({ ...draft, layers: layers.map(l => l.id === layer.id ? { ...l, name: e.target.value } : l) })} /></Field>
          {layer.description && <details className="my-3 text-sm"><summary className="cursor-pointer">About this layer</summary><p className="mt-2 text-text-muted">{layer.description}</p></details>}
          <h3 className="my-3 text-sm font-medium">Constraints in this layer</h3>
          {constraints.filter(c => c.layer === layer.id).length === 0 && <p className="mb-3 text-sm text-text-muted">No constraints assigned. Use assignments below to add one.</p>}
          <ul className="space-y-3">{constraints.filter(c => c.layer === layer.id).map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <button type="button" className="min-w-0 text-left text-sm text-accent-text underline" onClick={() => onConstraint(c.id)}>{constraintName(c)}</button>
            <Field label="Weight within layer" htmlFor={`constraint-weight-${c.id}`}><Input id={`constraint-weight-${c.id}`} aria-label={`Weight within layer: ${constraintName(c)}`} className="w-24" type="number" min="0" step="any" value={Number.isNaN(c.weight) ? "" : c.weight ?? 1} aria-invalid={!validWeight(c.weight ?? 1) || undefined} onChange={e => setDraft({ ...draft, constraints: constraints.map(item => item.id === c.id ? { ...item, weight: inputWeight(e.target.value) } : item) })} /></Field>
          </li>)}</ul>
          <p className="mt-2 text-xs text-text-muted">Within-layer weights are relative. Views that weight constraints directly use their own weights.</p>
        </> : <p className="text-sm text-text-muted">Add a layer, then assign constraints to it.</p>}
        <details className="mt-4 rounded border border-border p-3" open={!layer || constraints.every(c => c.layer !== layer.id)}>
          <summary className="cursor-pointer text-sm font-medium">Edit constraint assignments</summary>
          <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">{constraints.map(c => <Field key={c.id} label={constraintName(c)} htmlFor={`assignment-${c.id}`}>
            <select id={`assignment-${c.id}`} aria-label={`Layer for ${constraintName(c)}`} className="h-control max-w-full rounded border border-border bg-surface px-2 text-sm" value={c.layer} onChange={e => setDraft({ ...draft, constraints: constraints.map(item => item.id === c.id ? { ...item, layer: e.target.value } : item) })}>
              {!layers.some(l => l.id === c.layer) && <option value={c.layer}>Choose layer</option>}
              {layers.map(l => <option key={l.id} value={l.id}>{l.name || "Unnamed layer"}</option>)}
            </select>
          </Field>)}</div>
        </details>
      </Card>
    </div>}
    {step === "views" && <div className="space-y-4">
      {matrix}
      <Button size="sm" variant="outline" aria-expanded={editingView} onClick={() => setEditingView(!editingView)}>{editingView ? "Close view details" : "Edit one view"}</Button>
      <div className="rounded border border-border bg-surface p-3">
        <ul className="flex flex-wrap gap-2" aria-label="View weight bookmarks">{views.map((v, index) => <li key={index}><button type="button" className={`w-full rounded p-2 text-left text-sm ${viewIndex === index ? "bg-selection" : "hover:bg-surface-sunken"}`} aria-pressed={viewIndex === index} style={{ borderBottom: `3px solid ${viewColor(v.name)}` }} onClick={() => { setEditingView(true); setViewIndex(index); const savedName = document.views?.[index]?.name; if (savedName) onView(savedName); }}>{v.name || "Unnamed view"}<span className="block text-xs text-text-muted">{v.name === benchmark ? "Equal-layer benchmark" : v.constraint_weights != null ? "Direct constraint weights" : `${Object.values(v.layer_weights ?? {}).filter(w => w > 0).length} weighted layers`}</span></button></li>)}</ul>
        <details className="mt-3 border-t border-border pt-3 text-sm"><summary className="cursor-pointer">Add view</summary>
          <form className="mt-2 space-y-2" onSubmit={e => {
            e.preventDefault();
            const name = newView.trim();
            if (!name || duplicateViewName) return;
            const next = withGeneralBenchmark({ ...draft, views: [...views, { name, layer_weights: Object.fromEntries(layers.map(l => [l.id, 0])) }] });
            setDraftState(next);
            setEditingView(true);
            setViewIndex(next.views!.findIndex(v => v.name === name));
            setNewView("");
          }}>
            <Field label="New view name" htmlFor="new-view-name"><Input id="new-view-name" required value={newView} aria-invalid={duplicateViewName || undefined} aria-describedby={duplicateViewName ? "new-view-name-error" : undefined} onChange={e => setNewView(e.target.value)} /></Field>
            {duplicateViewName && <p id="new-view-name-error" role="alert" className="text-xs text-danger">A view with this name already exists. Choose a different name.</p>}
            <Button size="sm" type="submit" disabled={!newView.trim() || duplicateViewName}>Add view</Button>
          </form>
        </details>
      </div>
      <Card className="min-w-0" hidden={!editingView}>
        {view ? <>
          {isBenchmark ? <div role="note" className="rounded border border-border bg-surface-sunken p-3 text-sm"><h3 className="font-semibold">General benchmark</h3><p className="mt-1">Includes every constraint used by any view. Each participating layer has equal total weight; its included constraints share that weight equally. This reference updates automatically.</p></div> : <Field label="View name" htmlFor="view-name"><Input id="view-name" value={view.name} onChange={e => updateView({ name: e.target.value })} /></Field>}
          <p className="my-3 text-xs text-text-muted">{isBenchmark ? "Read-only reference. Edit the stakeholder views to change the union." : "Include or exclude a layer or individual constraint in this view. Shared definitions and other views stay unchanged."}</p>
          {!isBenchmark && view.constraint_weights != null && <p className="mb-3 text-xs text-text-muted">This view weights constraints directly. Layer totals below sum those weights.</p>}
          <ul className="space-y-3">{layers.map(l => {
            const members = constraints.filter(c => c.layer === l.id);
            const weights = rawViewWeights(draft, view);
            const count = members.filter(c => (weights[c.id] ?? 0) > 0).length;
            const total = layerTotal(draft, view, l.id);
            return <li key={l.id} className="rounded border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm"><input type="checkbox" aria-label={`Include layer ${l.name} in ${view.name}`} checked={count > 0} disabled={isBenchmark || !members.length} onChange={e => includeLayer(l.id, e.target.checked)} /><span>{l.name}<span className="block text-xs text-text-muted">{count} / {members.length} constraints included</span></span></label>
                {isBenchmark ? <span className="text-sm">Layer weight: {total > 0 ? "1 (equal)" : "0 (unused)"}</span> : <Field label="Layer importance" htmlFor={`view-weight-${l.id}`}><Input id={`view-weight-${l.id}`} aria-label={`View weight: ${l.name}`} className="w-24" type="number" min="0" step="any" value={Number.isNaN(total) ? "" : total} aria-invalid={!validWeight(total) || undefined} onChange={e => { const changed = setViewLayerWeight(draft, view, l.id, inputWeight(e.target.value)); setDraft({ ...draft, views: views.map((v, i) => i === viewIndex ? changed : v) }); }} /></Field>}
                {!count && <span className="text-xs text-text-muted">Not weighted</span>}
              </div>
              <details className="mt-2 text-sm"><summary className="cursor-pointer">Choose constraints in {l.name}</summary><ul className="mt-2 space-y-2">{members.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" aria-label={`Include ${constraintName(c)} in ${view.name}`} checked={(weights[c.id] ?? 0) > 0} disabled={isBenchmark} onChange={e => { const changed = setViewConstraintIncluded(draft, view, c.id, e.target.checked); setDraft({ ...draft, views: views.map((v, i) => i === viewIndex ? changed : v) }); }} />{constraintName(c)}</label>
                <Button variant="ghost" size="sm" onClick={() => onConstraint(c.id)}>Inspect rule</Button>
                {!isBenchmark && view.constraint_weights != null && weightInput(`view-weight-${c.id}`, `View weight: ${constraintName(c)}`, weights[c.id] ?? 0)}
              </li>)}</ul></details>
            </li>;
          })}</ul>
        </> : <p className="text-sm text-text-muted">Add a view, then choose its layer weights.</p>}
      </Card>
    </div>}
    {step === "layers" && <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-medium">Structure matrix</summary>{matrix}</details>}
    <Dialog open={saving} onOpenChange={open => !create.isPending && setSaving(open)}><DialogContent hideClose={create.isPending}>
      <DialogHeader><DialogTitle>Save structure as new draft</DialogTitle><DialogDescription>Save layer assignments and view weights in a new version. Existing results retain their original Process norm.</DialogDescription></DialogHeader>
      {allowDraftWithoutDecision ? <p className="text-sm text-text-muted">Save these choices as a draft. Reason and owner are skipped in your Guided settings.</p> : <CommitFieldsForm value={fields} onChange={setFields} attempted={attempted} prefix="structure" />}
      {create.isError && <p role="alert" className="mt-3 text-sm text-danger">Changes could not be saved. Your edits are kept. {normRefusal(create.error, {}, "save")}</p>}
      <DialogFooter><Button variant="ghost" disabled={create.isPending} onClick={() => setSaving(false)}>Cancel</Button><Button disabled={create.isPending} onClick={save}>{create.isPending ? "Saving…" : "Save as the next version"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
