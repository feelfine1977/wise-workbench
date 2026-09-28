import { scaleLinear } from "d3";
import { constraintName, type NormDocument } from "./normAuthoring";
import { thresholdOf } from "./Builder";
import { fmtNum } from "@/lib/format";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)])));
  return JSON.stringify(value) ?? "undefined";
}
export function comparableThresholds(before: NormDocument, after: NormDocument) {
  if (canonical(before.derived_attributes ?? []) !== canonical(after.derived_attributes ?? [])) return [];
  const previous = new Map(before.constraints?.map(constraint => [constraint.id, constraint]) ?? []);
  return (after.constraints ?? []).flatMap(constraint => {
    const old = previous.get(constraint.id);
    const next = thresholdOf(constraint), saved = old && thresholdOf(old);
    if (!old || !saved || !next || old.type !== constraint.type || canonical(old.applicability ?? {}) !== canonical(constraint.applicability ?? {})) return [];
    const meaning = (params: Record<string, unknown>) => Object.fromEntries(Object.entries(params).filter(([key]) => !next.keys.includes(key)));
    if (canonical(meaning(old.params)) !== canonical(meaning(constraint.params))) return [];
    if (![saved.threshold, saved.width, next.threshold, next.width].every(Number.isFinite) || saved.threshold === next.threshold && saved.width === next.width) return [];
    return [{ id: constraint.id, name: constraintName(constraint), unit: String(constraint.params.unit ?? (constraint.type === "singularity" ? "events" : constraint.type === "balance" ? "relative difference" : constraint.params.attribute ?? "units")), saved, next }];
  });
}
export function NormThresholdChanges({ before, after, onConstraint }: { before: NormDocument; after: NormDocument; onConstraint: (id: string) => void }) {
  const rows = comparableThresholds(before, after);
  if (!rows.length) return null;
  return <section aria-label="Comparable target changes" className="rounded-xl border border-border bg-surface-sunken p-4">
    <h3 className="font-semibold">How the targets changed</h3>
    <p className="mt-1 text-xs text-text-muted">Saved definitions only · each row has its own scale. A connected pair is shown only when measurement meaning, applicability and derived data definitions are unchanged.</p>
    <div className="mt-3 space-y-4">{rows.map(row => {
      const low = Math.min(row.saved.threshold, row.next.threshold), high = Math.max(row.saved.threshold, row.next.threshold);
      const pad = Math.max((high - low) * .15, Math.abs(high) * .05, .1);
      const scale = scaleLinear().domain([low - pad, high + pad]).range([35, 405]);
      return <div key={row.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)]">
        <div><button type="button" className="text-left text-sm font-medium text-accent-text underline" onClick={() => onConstraint(row.id)}>{row.name}</button><p className="mt-1 text-xs text-text-muted">Target: {fmtNum(row.saved.threshold, 3)} → {fmtNum(row.next.threshold, 3)} {row.unit}<br />Tolerance: {fmtNum(row.saved.width, 3)} → {fmtNum(row.next.width, 3)} {row.unit}</p></div>
        <svg viewBox="0 0 440 55" role="img" aria-label={`${row.name}: target from ${row.saved.threshold} to ${row.next.threshold} ${row.unit}`} className="w-full">
          <line x1="35" x2="405" y1="18" y2="18" stroke="currentColor" opacity=".12" />
          <line x1={scale(row.saved.threshold)} x2={scale(row.next.threshold)} y1="18" y2="18" stroke="#6b62df" strokeWidth="3" />
          <circle cx={scale(row.saved.threshold)} cy="18" r="5" fill="var(--surface, white)" stroke="#65758b" strokeWidth="2" />
          <circle cx={scale(row.next.threshold)} cy="18" r="5" fill="#6b62df" />
          <text x="35" y="47" fontSize="11" fill="currentColor">○ Previous</text><text x="405" y="47" textAnchor="end" fontSize="11" fill="currentColor">● Current</text>
        </svg>
      </div>;
    })}</div>
  </section>;
}
