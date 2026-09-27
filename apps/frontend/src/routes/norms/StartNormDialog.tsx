import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inventoryQuery, useCreateNormVersion } from "@/lib/api/norms";
import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";
import { normRefusal } from "./normErrors";

/** A deliberately small, explicit starting point, using the selected preparation's vocabulary. */
export function StartNormDialog({ projectId, caseTableId, datasetName, onCreated }: {
  projectId: string; caseTableId?: string; datasetName?: string; onCreated: (id: string) => void;
}) {
  const { allowDraftWithoutDecision } = useNormAuthoringPreferences();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [activity, setActivity] = useState("");
  const [owner, setOwner] = useState("");
  const [attempted, setAttempted] = useState(false);
  const inventory = useQuery({ ...inventoryQuery(projectId, caseTableId ?? ""), enabled: open && !!caseTableId });
  const create = useCreateNormVersion(projectId);
  const known = inventory.data?.activities?.some(a => a.label === activity);
  const save = () => {
    setAttempted(true);
    const missing = !name.trim() ? "start-norm-name" : !purpose.trim() ? "start-norm-purpose" : !known ? "start-norm-activity" : !allowDraftWithoutDecision && !owner.trim() ? "start-norm-owner" : undefined;
    if (missing) { document.getElementById(missing)?.focus(); return; }
    create.mutate({
      norm: {
        schema_version: 2, name: name.trim(), scoring_mode: "layer_balanced",
        layers: [{ id: "purpose", name: "Process expectations" }],
        constraints: [{ id: "expected_activity", layer: "purpose", type: "presence", params: { activity: [activity], m: 1 }, weight: 1, description: `${activity} should be recorded` }],
        views: [{ name: "Overview", layer_weights: { purpose: 1 } }],
        metadata: { authoring: { situation: "new", goal: purpose.trim(), ...(owner.trim() ? { owner: owner.trim() } : {}), evidence: `Initial expectation using ${datasetName ?? "the selected dataset"}; validate event meaning and applicability before interpretation.`, caseTableId } },
      },
      note: `Small starting norm — ${purpose.trim()}${owner.trim() ? ` (owner: ${owner.trim()})` : ""}. Event presence is a proposed expectation; logging completeness still needs review.`,
      ...(owner.trim() ? { author: owner.trim() } : {}),
    }, { onSuccess: n => { setOpen(false); onCreated(n.id); } });
  };
  return <>
    <Button variant="outline" onClick={() => { setOpen(true); setAttempted(false); }}>Start a small norm</Button>
    <Dialog open={open} onOpenChange={v => !create.isPending && setOpen(v)}>
      <DialogContent hideClose={create.isPending} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Start with one expectation</DialogTitle><DialogDescription>Choose an activity that should be recorded for the cases you study. Add exceptions, other rules and priorities as you learn.</DialogDescription></DialogHeader>
        {!caseTableId ? <p className="text-sm">Prepare the project dataset in Understand data first. The editor will then offer its actual activity names.</p> : <div className="space-y-3">
          <p className="text-xs text-text-muted">Dataset: {datasetName ?? "Selected project dataset"}. This creates a separate draft norm.</p>
          <Field label="Norm name" htmlFor="start-norm-name"><Input id="start-norm-name" value={name} onChange={e => setName(e.target.value)} required aria-invalid={attempted && !name.trim() || undefined} placeholder="e.g. Reliable order fulfilment" /></Field>
          <Field label="What do you want to understand?" htmlFor="start-norm-purpose"><Textarea id="start-norm-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} required aria-invalid={attempted && !purpose.trim() || undefined} placeholder="Describe the business question this norm should help answer." /></Field>
          <Field label="Which activity should be recorded?" htmlFor="start-norm-activity"><select id="start-norm-activity" className="h-control w-full rounded border border-border bg-surface px-2 text-sm" value={activity} onChange={e => setActivity(e.target.value)} required aria-invalid={attempted && !known || undefined}><option value="">Choose an observed activity</option>{inventory.data?.activities?.map(a => <option key={a.label} value={a.label}>{a.label}</option>)}</select></Field>
          {inventory.isPending && <p role="status" className="text-sm">Loading recorded activities…</p>}
          {inventory.isError && <p role="alert" className="text-sm text-danger">Activities could not be loaded. <Button size="sm" variant="ghost" onClick={() => void inventory.refetch()}>Retry activities</Button></p>}
          {known && <p className="rounded border border-border bg-surface-sunken p-3 text-sm">Proposed rule: “{activity}” happens at least once per case. Review who it applies to next. A missing recorded event can also mean missing data.</p>}
          <details open={!allowDraftWithoutDecision || undefined}><summary className="cursor-pointer text-sm font-medium">{allowDraftWithoutDecision ? "Add owner (optional)" : "Starting expectation owner"}</summary>
            <Field label={allowDraftWithoutDecision ? "Who owns this starting expectation? (optional)" : "Who owns this starting expectation?"} htmlFor="start-norm-owner" className="mt-2"><Input id="start-norm-owner" value={owner} onChange={e => setOwner(e.target.value)} required={!allowDraftWithoutDecision} aria-required={!allowDraftWithoutDecision} aria-invalid={!allowDraftWithoutDecision && attempted && !owner.trim() || undefined} /></Field>
          </details>
          {attempted && (!name.trim() || !purpose.trim() || !known || !allowDraftWithoutDecision && !owner.trim()) && <p role="alert" className="text-sm text-danger">{allowDraftWithoutDecision ? "Complete the name, purpose and activity." : "Complete the name, purpose, activity and owner."}</p>}
          {create.isError && <p role="alert" className="text-sm text-danger">Your entries are kept. {normRefusal(create.error, {}, "save")}</p>}
        </div>}
        <DialogFooter><Button variant="ghost" disabled={create.isPending} onClick={() => setOpen(false)}>Cancel</Button>{caseTableId && <Button disabled={create.isPending || !inventory.data || inventory.isError} onClick={save}>{create.isPending ? "Creating…" : "Create starting draft"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
