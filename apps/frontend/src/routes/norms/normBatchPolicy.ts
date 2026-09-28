import type { components, NormVersionCreate } from "@wise/api-schema";
import type { CalibrationEntry, NormCalibration } from "@/lib/api/norms";
import type { Constraint } from "./Builder";
import { constraintName, type NormDocument } from "./normAuthoring";

export type BatchSignal = components["schemas"]["NormSignalDistribution"];
export type BatchMode = "decisions" | "thresholds";
export interface NumericRule {
  key: string;
  label: string;
  unit: string;
  direction: "high" | "low";
  targetKey: string;
  widthKey: string;
  target: number;
  width: number;
}
export interface SignalEvidence { data: BatchSignal; loadedAt: string }
export interface BatchPreviewRow {
  id: string;
  name: string;
  rationale: string;
  owner: string;
  before?: { target: number; width: number };
  after?: { target: number; width: number };
  rule?: NumericRule;
  evidence?: SignalEvidence;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

/** Exact semantic grouping is deliberately conservative. IDs/labels need no translation here. */
export function batchNumericRule(c: Constraint): NumericRule | undefined {
  const p = c.params;
  const keys: Record<string, [string, string]> = { lag: ["delta", "width"], metric: ["threshold", "width"], singularity: ["k", "K"], balance: ["tau", "width"] };
  const pair = keys[c.type];
  if (!pair || (c.type === "lag" && p.activation === "each")) return undefined;
  const [targetKey, widthKey] = pair;
  const target = p[targetKey], width = p[widthKey];
  if (!finite(target) || !finite(width)) return undefined;
  const direction = c.type === "metric" ? p.direction ?? "high" : "high";
  if (direction !== "high" && direction !== "low") return undefined;
  const unit = c.type === "lag" ? String(p.unit ?? "D") : c.type === "metric" ? String(p.attribute ?? "") : c.type === "singularity" ? "events" : "relative difference";
  if (!unit) return undefined;
  const semantics = Object.fromEntries(Object.entries(p).filter(([key]) => key !== targetKey && key !== widthKey));
  return { key: stable({ type: c.type, unit, direction, semantics, applicability: c.applicability ?? {} }), label: c.type + " · " + unit + " · " + (direction === "high" ? "at most" : "at least"), unit, direction, targetKey, widthKey, target, width };
}

export function signalCoverage(data: BatchSignal): { measured: number; scope: number; missing: number } | undefined {
  const measured: unknown = data.stats?.n, scope: unknown = data.stats?.nCases;
  if (!finite(measured) || !finite(scope) || !Number.isInteger(measured) || !Number.isInteger(scope) || measured < 0 || scope < measured) return undefined;
  if (data.casesInScope != null && data.casesInScope !== scope) return undefined;
  return { measured, scope, missing: scope - measured };
}

export function evidenceIssue(c: Constraint, evidence: SignalEvidence | undefined, versionId: string, caseTableId: string): string | undefined {
  if (!evidence) return "Load evidence first.";
  const data = evidence.data, rule = batchNumericRule(c);
  if (!rule) return "Review this rule individually.";
  if (data.normVersionId !== versionId || data.caseTableId !== caseTableId || data.constraintId !== c.id) return "Evidence belongs to a different version, table or constraint. Reload it.";
  if (data.type !== c.type || data.unit !== rule.unit || data.direction !== rule.direction || data.threshold !== rule.target || data.width !== rule.width) return "Evidence does not match this saved rule. Review it individually.";
  const coverage = signalCoverage(data);
  if (!coverage) return "Measurement coverage is unavailable.";
  if (!coverage.scope) return "No applicable cases; no threshold proposal.";
  if (!coverage.measured) return "No finite measurements; no threshold proposal.";
  return undefined;
}

export function thresholdSettingsIssue(c: Constraint, targetText: string, widthText: string): string | undefined {
  const target = Number(targetText), width = Number(widthText);
  if (!targetText.trim() || !widthText.trim() || !finite(target) || !finite(width)) return "Enter a finite target and tolerance width.";
  if (width < 0) return "Tolerance width must be zero or positive.";
  if (c.type === "lag" && target < 0) return "A lag target must be zero or positive.";
  if (c.type === "balance" && (target < 0 || target > 1)) return "A balance target must be between 0 and 1.";
  if (c.type === "singularity" && (!Number.isInteger(target) || target < 0 || width <= 0)) return "An occurrence target must be a nonnegative integer and its width must be positive.";
  return undefined;
}

/** A server missingRationale entry is authoritative, including explicit reconfirmation. */
export function pendingBatchConstraints(document: NormDocument, calibration: NormCalibration | undefined): Constraint[] {
  const pending = new Set(calibration?.missingRationale ?? []);
  return (document.constraints ?? []).filter(c => pending.has(c.id));
}

/** Bound expensive signal requests; an unmounted/context-replaced session starts no more work. */
export async function forEachBatchLimited<T>(items: T[], work: (item: T) => Promise<void>, current: () => boolean = () => true): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (current() && next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  }));
}

/** Only explicitly chosen rows change; every other field and inherited decision is carried forward. */
export function batchVersionRequest(document: NormDocument, versionId: string, mode: BatchMode, rows: BatchPreviewRow[], caseTableId?: string): NormVersionCreate {
  if (!rows.length || rows.some(r => !r.rationale.trim() || !r.owner.trim())) throw new Error("Choose decisions with a reason and owner.");
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("Each constraint can appear only once.");
  const byId = new Map(rows.map(r => [r.id, r]));
  if (rows.some(r => !(document.constraints ?? []).some(c => c.id === r.id))) throw new Error("A selected constraint is unavailable.");
  if (mode === "thresholds") {
    if (!caseTableId || rows.some(r => !r.rule || !r.after || !r.evidence)) throw new Error("Threshold changes require measured evidence.");
    if (new Set(rows.map(r => r.rule!.key)).size !== 1) throw new Error("Choose rules with the same measurement semantics.");
    for (const row of rows) {
      const c = document.constraints!.find(c => c.id === row.id)!;
      const rule = batchNumericRule(c);
      if (!rule || row.rule!.key !== rule.key || row.rule!.targetKey !== rule.targetKey || row.rule!.widthKey !== rule.widthKey) throw new Error("The preview no longer matches this rule.");
      const issue = evidenceIssue(c, row.evidence, versionId, caseTableId) ?? thresholdSettingsIssue(c, String(row.after!.target), String(row.after!.width));
      if (issue) throw new Error(issue);
    }
  }
  const calibration: Record<string, CalibrationEntry> = Object.fromEntries(rows.map(r => [r.id, { rationale: r.rationale.trim(), owner: r.owner.trim() }]));
  const norm = mode === "decisions" ? document : {
    ...document,
    constraints: (document.constraints ?? []).map(c => {
      const row = byId.get(c.id);
      return row?.after && row.rule ? { ...c, params: { ...c.params, [row.rule.targetKey]: row.after.target, [row.rule.widthKey]: row.after.width } } : c;
    }),
  };
  const provenance = mode === "thresholds" ? " Evidence: norm " + versionId + ", case table " + caseTableId + "; " + rows.map(r => {
    const coverage = signalCoverage(r.evidence!.data)!;
    return r.id + ": " + coverage.measured + "/" + coverage.scope + " measured, loaded " + r.evidence!.loadedAt;
  }).join("; ") + "." : "";
  return { norm, parentId: versionId, calibration, note: "Batch " + (mode === "decisions" ? "review decisions" : "explicit threshold settings") + " for " + rows.map(r => r.id).join(", ") + "." + provenance };
}

export const batchNames = (document: NormDocument) => Object.fromEntries((document.constraints ?? []).map(c => [c.id, constraintName(c)]));

/** Keep very small native units visible while suppressing floating-point display noise. */
export const batchValue = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 15 }).format(value);
