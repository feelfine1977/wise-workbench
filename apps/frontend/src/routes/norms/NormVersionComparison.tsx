import { useState } from "react";
import { NormThresholdChanges } from "./NormThresholdChanges";
import { useQuery } from "@tanstack/react-query";
import { normQuery } from "@/lib/api/norms";
import { Button } from "@/components/ui/button";
import { constraintName, type NormDocument } from "./normAuthoring";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
export function normChanges(before: NormDocument, after: NormDocument) {
  const rows: { id: string; name: string; kinds: string[]; removed: boolean }[] = [];
  const previous = new Map((before.constraints ?? []).map(c => [c.id, c]));
  const current = new Set((after.constraints ?? []).map(c => c.id));
  for (const c of after.constraints ?? []) {
    const old = previous.get(c.id); const kinds: string[] = [];
    if (!old) kinds.push("Added");
    else {
      if (c.type !== old.type || stable(c.params) !== stable(old.params)) kinds.push("Rule or threshold changed");
      if (stable(c.applicability ?? {}) !== stable(old.applicability ?? {})) kinds.push("Applicability changed");
      if (c.layer !== old.layer || (c.weight ?? 1) !== (old.weight ?? 1)) kinds.push("Grouping or weight changed");
      if (constraintName(c) !== constraintName(old)) kinds.push("Name changed");
    }
    if (kinds.length) rows.push({ id: c.id, name: constraintName(c), kinds, removed: false });
  }
  for (const c of before.constraints ?? []) if (!current.has(c.id)) rows.push({ id: c.id, name: constraintName(c), kinds: ["Removed from active norm"], removed: true });
  return { rows, structure: stable(before.layers) !== stable(after.layers) || stable(before.views) !== stable(after.views), derivation: stable(before.derived_attributes) !== stable(after.derived_attributes), brief: stable(before.metadata?.authoring) !== stable(after.metadata?.authoring) };
}
export function NormVersionComparison({ projectId, parentId, document, onConstraint }: { projectId: string; parentId?: string | null; document: NormDocument; onConstraint: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const parent = useQuery({ ...normQuery(projectId, parentId ?? ""), enabled: open && !!parentId });
  const delta = parent.data ? normChanges(parent.data.norm as NormDocument, document) : undefined;
  return <details className="mt-4 rounded border border-border bg-surface p-4" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">Compare with the previous version</summary>
    {!parentId ? <p className="mt-3 text-sm text-text-muted">This norm has no recorded parent. It is the starting point for later reassessments.</p> : <div className="mt-3 space-y-3 text-sm">
      {parent.isPending && <p role="status">Loading the previous version…</p>}
      {parent.isError && <p role="alert">The previous version could not be loaded. <Button size="sm" variant="outline" onClick={() => void parent.refetch()}>Retry comparison</Button></p>}
      {delta && <>
        <p>Compared with parent version {parent.data!.version}: {delta.rows.length} changed constraints. Layer/view settings {delta.structure ? "changed" : "unchanged"}. Working brief {delta.brief ? "changed" : "unchanged"}.</p>
        {delta.derivation && <p className="text-warning">Derived data definitions changed. Recheck measurement meaning and any dependent thresholds.</p>}
        <p className="text-xs text-text-muted">This compares saved definitions. It does not measure data drift or performance changes. A reused decision does not establish that new data has been checked.</p>
        <NormThresholdChanges before={parent.data!.norm as NormDocument} after={document} onConstraint={onConstraint} />
        {delta.rows.length ? <ul className="max-h-72 space-y-2 overflow-y-auto">{delta.rows.map(row => <li key={row.id} className="border-b border-border pb-2"><div>{row.removed ? row.name : <button type="button" className="text-left text-accent-text underline" onClick={() => onConstraint(row.id)}>{row.name}</button>}</div><p className="text-xs text-text-muted">{row.kinds.join(" · ")}</p></li>)}</ul> : <p>No constraint definition changed.</p>}
      </>}
    </div>}
  </details>;
}
