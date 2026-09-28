/** Review preflight uses the same saved decisions that the server checks before signing. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NormVersion } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import { normConstraintNames, normRefusal } from "./normErrors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { normCalibrationQuery, normQuery, useCreateNormVersion, useSetNormStatus } from "@/lib/api/norms";
import { ruleSentence, type CommitFields, type Constraint } from "./Builder";

export const NEXT_STATUS = { draft: { status: "reviewed" as const, label: "Mark reviewed" }, reviewed: { status: "approved" as const, label: "Approve this version" } };
type Version = Pick<NormVersion, "id" | "version" | "status" | "note"> & { norm?: Record<string, unknown> };

export function SignVersion({ projectId, version, onDone }: { projectId: string; version: Version; onDone: (createdId?: string) => void }) {
  const [current, setCurrent] = useState(version);
  const [author, setAuthor] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, CommitFields>>({});
  const [recorded, setRecorded] = useState<Record<string, CommitFields>>({});
  const [decisionAttempted, setDecisionAttempted] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const calibration = useQuery({ ...normCalibrationQuery(projectId, current.id), refetchOnMount: "always" });
  const document = useQuery(normQuery(projectId, current.id));
  const create = useCreateNormVersion(projectId);
  const sign = useSetNormStatus(projectId);
  const norm = document.data?.norm ?? current.norm;
  const names = normConstraintNames(norm);
  const missing = [...new Set([...(calibration.data?.missingRationale ?? []), ...refused])];
  const rows = calibration.data?.thresholds ?? [];
  const active = selected && missing.includes(selected) ? selected : missing[0];
  const fieldsOf = (id: string): CommitFields => drafts[id] ?? {
    rationale: rows.find(r => r.constraint_id === id)?.rationale ?? "",
    owner: rows.find(r => r.constraint_id === id)?.owner ?? "",
  };
  const fields = active ? fieldsOf(active) : { rationale: "", owner: "" };
  const missingFields = (id: string) => {
    const value = fieldsOf(id);
    return [!value.rationale.trim() && "reason", !value.owner.trim() && "owner"].filter(Boolean).join(" + ") || "confirm decision";
  };
  const ready = missing.filter(id => recorded[id]).length;
  const next = NEXT_STATUS[current.status as "draft" | "reviewed"];
  const checking = calibration.isPending || calibration.isFetching || document.isPending;
  const readFailed = calibration.isError || document.isError || calibration.data?.canLeaveDraft === false && missing.length === 0;
  const busy = create.isPending || sign.isPending;
  const close = () => onDone(current.id === version.id ? undefined : current.id);
  const constraint = (norm?.constraints as Constraint[] | undefined)?.find(c => c.id === active);
  const choose = (id: string) => {
    setSelected(id);
    setDecisionAttempted(false);
    requestAnimationFrame(() => window.document.getElementById(!fieldsOf(id).rationale.trim() ? "review-reason" : !fieldsOf(id).owner.trim() ? "review-owner" : "review-reason")?.focus());
  };
  const change = (value: CommitFields) => {
    if (!active) return;
    setDrafts(previous => ({ ...previous, [active]: value }));
    setRecorded(previous => { const next = { ...previous }; delete next[active]; return next; });
    create.reset();
  };
  const record = () => {
    if (!active) return;
    setDecisionAttempted(true);
    if (!fields.rationale.trim() || !fields.owner.trim()) {
      window.document.getElementById(!fields.rationale.trim() ? "review-reason" : "review-owner")?.focus();
      return;
    }
    setRecorded(previous => ({ ...previous, [active]: { rationale: fields.rationale.trim(), owner: fields.owner.trim() } }));
    const following = missing.find(id => id !== active && !recorded[id]);
    if (following) choose(following);
    else setDecisionAttempted(false);
  };
  const saveDecisions = () => {
    if (!norm || !ready) return;
    create.mutate({ norm, parentId: current.id, note: `Review decisions recorded for ${ready} constraint${ready === 1 ? "" : "s"}.`, calibration: Object.fromEntries(missing.filter(id => recorded[id]).map(id => [id, recorded[id]!])) }, {
      onSuccess: created => {
        setCurrent(created);
        setDrafts({}); setRecorded({}); setSelected(undefined); setRefused([]); setDecisionAttempted(false);
        sign.reset();
      },
    });
  };
  if (!next) return null;
  return (
    <Dialog open onOpenChange={open => !open && !busy && close()}>
      <DialogContent data-testid="sign-norm" style={{ animation: "none" }} className={`flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-4xl ${missing.length ? "h-[min(44rem,calc(100dvh-2rem))]" : ""}`} hideClose={busy}>
        <DialogHeader className="shrink-0 pr-5">
          <DialogTitle>{next.label} — v{current.version}</DialogTitle>
          <DialogDescription>{missing.length ? "Complete the required constraint decisions before signing." : "Check the recorded decisions, then sign this version."}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="review-body">
        {current.id !== version.id && <p role="status" className="shrink-0 text-sm">Decisions saved in draft v{current.version}. Previous versions and run results are unchanged.</p>}
        {checking && <p role="status" className="text-sm">Checking review requirements…</p>}
        {readFailed && <div role="alert" className="text-sm text-danger">Review requirements could not be checked. <Button variant="outline" size="sm" onClick={() => { void calibration.refetch(); void document.refetch(); }}>Retry preflight</Button></div>}
        {!checking && !readFailed && missing.length > 0 && (
          <section aria-label="Review preflight" className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="shrink-0 text-sm font-medium" role="status">{missing.length} constraints need a decision · {ready} ready to save</p>
            <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:grid-rows-[minmax(0,1fr)]">
              <ul className="min-h-0 max-h-40 space-y-1 overflow-y-auto overscroll-contain rounded border border-border p-1 sm:max-h-none" aria-label="Required decisions">
                {missing.map(id => <li key={id}><button type="button" title={names[id] ?? id} className={`w-full rounded p-2 text-left text-sm ${active === id ? "bg-selection" : "hover:bg-surface-sunken"}`} aria-pressed={active === id} onClick={() => choose(id)}>
                  <span className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]" data-testid="review-nav-title">{names[id] ?? id}</span>
                  <span className="text-xs text-text-muted">{recorded[id] ? "Ready to save" : `Needs ${missingFields(id)}`}</span>
                </button></li>)}
              </ul>
              {active && <fieldset className="min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain pr-1 [overflow-wrap:anywhere]" disabled={busy}>
                <legend className="sr-only">Decision for {names[active] ?? active}</legend>
                <p className="line-clamp-2 text-sm font-medium" title={names[active] ?? active}>{names[active] ?? active}</p>
                <details key={active} className="text-sm">
                  <summary className="cursor-pointer text-accent-text">Full constraint meaning and rule</summary>
                  <div className="mt-2 max-h-32 space-y-2 overflow-y-auto overscroll-contain rounded border border-border p-2 text-xs text-text-muted" data-testid="review-meaning">
                    <p>{names[active] ?? active}</p>
                    {constraint?.description && constraint.description !== names[active] && <p>{constraint.description}</p>}
                    {constraint && <p>{ruleSentence(constraint)}</p>}
                  </div>
                </details>
                <Field label="Reason for this constraint (required)" htmlFor="review-reason">
                  <Textarea id="review-reason" value={fields.rationale} onChange={e => change({ ...fields, rationale: e.target.value })} required aria-invalid={decisionAttempted && !fields.rationale.trim() || undefined} aria-describedby={decisionAttempted && !fields.rationale.trim() ? "review-reason-error" : undefined} />
                  {decisionAttempted && !fields.rationale.trim() && <p id="review-reason-error" className="text-xs text-danger">Record the agreed reason for this constraint.</p>}
                </Field>
                <Field label="Constraint owner (required)" htmlFor="review-owner">
                  <Input id="review-owner" value={fields.owner} onChange={e => change({ ...fields, owner: e.target.value })} required aria-invalid={decisionAttempted && !fields.owner.trim() || undefined} aria-describedby={decisionAttempted && !fields.owner.trim() ? "review-owner-error" : undefined} />
                  {decisionAttempted && !fields.owner.trim() && <p id="review-owner-error" className="text-xs text-danger">Name the person or role that owns this decision.</p>}
                </Field>
                <Button variant="outline" size="sm" onClick={record}>Record decision</Button>
              </fieldset>}
            </div>
            <p className="shrink-0 text-xs text-text-muted">Save completed decisions as a new draft. Any remaining decisions will still require review.</p>
          </section>
        )}
        {!checking && !readFailed && missing.length === 0 && <>
          <p role="status" className="mb-3 text-sm">All required reasons and owners are recorded.</p>
          <Field label="Who signs it" htmlFor="norm-author">
            <Input id="norm-author" required value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name" aria-invalid={attempted && !author.trim() || undefined} aria-describedby={attempted && !author.trim() ? "norm-author-error" : undefined} />
            {attempted && !author.trim() && <p id="norm-author-error" className="text-xs text-danger">Enter your name to sign this version.</p>}
          </Field>
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-text-muted">Version note</summary><p className="mt-2">{current.note || "No note recorded."}</p></details>
        </>}
        {sign.isError && <p role="alert" className="mt-3 text-sm text-danger" data-testid="sign-error">{missing.length ? "Complete the listed decisions before signing. Your entries are kept." : normRefusal(sign.error, names, "sign")}</p>}
        {create.isError && <p role="alert" className="mt-3 text-sm text-danger">Decisions could not be saved. Your entries are kept. {normRefusal(create.error, names, "save")}</p>}
        </div>
        <DialogFooter className="shrink-0 flex-wrap border-t border-border pt-3" data-testid="review-footer">
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          {missing.length > 0 ? <Button size="sm" disabled={busy || checking || readFailed || !ready} onClick={saveDecisions}>{create.isPending ? "Saving…" : `Save ${ready} decision${ready === 1 ? "" : "s"} as new draft`}</Button> : <Button size="sm" disabled={busy || checking || readFailed} onClick={() => {
            setAttempted(true);
            if (!author.trim()) { window.document.getElementById("norm-author")?.focus(); return; }
            sign.mutate({ normVersionId: current.id, status: next.status, author: author.trim() }, {
              onSuccess: close,
              onError: error => {
                if (error instanceof ApiError && error.problem?.code === "norm.rationale_required") setRefused((error.problem.errors ?? []).flatMap(e => typeof e.field === "string" ? [e.field] : []));
                void calibration.refetch();
              },
            });
          }}>{sign.isPending ? "Saving…" : next.label}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
