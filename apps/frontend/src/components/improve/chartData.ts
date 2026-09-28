import type { BacklogRow, Table } from "@wise/api-schema";
import { tableRecords } from "@/lib/utils";

export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const share = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

export function priorityRows(rows: BacklogRow[]) {
  return rows.filter((r) => count(r.n_cases) && finite(r.stable_PI) && r.stable_PI >= 0).slice().sort((a, b) => b.stable_PI - a.stable_PI || a.key.localeCompare(b.key));
}

export interface Contribution {
  constraint: string;
  layer: string;
  delta_gap: number;
}

/** Reconcile the complete signed decomposition; never fill a residual with an invented driver. */
export function contributionData(table: Table | undefined, signedGap: number | undefined) {
  const rows = tableRecords<Record<string, unknown>>(table);
  if (!rows.length || !finite(signedGap)) return undefined;
  if (rows.some((r) => typeof r.constraint !== "string" || !r.constraint || typeof r.layer !== "string" || !r.layer || !finite(r.delta_gap))) return undefined;
  const drivers = rows as unknown as Contribution[];
  if (new Set(drivers.map((r) => r.constraint)).size !== drivers.length) return undefined;
  const positive = drivers.reduce((sum, r) => sum + Math.max(0, r.delta_gap), 0);
  const offsets = drivers.reduce((sum, r) => sum + Math.max(0, -r.delta_gap), 0);
  if (!finite(positive) || !finite(offsets) || Math.abs(positive - offsets - signedGap) > 1e-7) return undefined;
  return { drivers, positive, offsets, signedGap };
}


export interface ScoreStep {
  constraint?: string;
  layer?: string;
  remaining?: number;
  delta: number;
  before: number;
  after: number;
}

/** delta_gap is a penalty difference; its negative is the signed change in score. */
export function scoreWaterfallData(table: Table | undefined, baseline: unknown, groupScore: unknown, topCount = 6) {
  if (!share(baseline) || !share(groupScore) || !Number.isSafeInteger(topCount) || topCount < 1) return undefined;
  const data = contributionData(table, baseline - groupScore);
  if (!data) return undefined;
  const ordered = [...data.drivers].sort((a, b) => Math.abs(b.delta_gap) - Math.abs(a.delta_gap) || a.constraint.localeCompare(b.constraint));
  const entries = ordered.map(row => ({ constraint: row.constraint, layer: row.layer, delta: -row.delta_gap }));
  const remaining = entries.slice(topCount);
  const remainder = remaining.reduce((sum, row) => sum + row.delta, 0);
  const accumulate = (rows: { constraint?: string; layer?: string; remaining?: number; delta: number }[]): ScoreStep[] => {
    let value = baseline;
    return rows.map(row => {
      const before = value;
      value += row.delta;
      return { ...row, before, after: value };
    });
  };
  const all = accumulate(entries);
  const collapsed = accumulate(remaining.length ? [...entries.slice(0, topCount), { remaining: remaining.length, delta: remainder }] : entries);
  if (Math.abs(all.at(-1)!.after - groupScore) > 1e-7 || Math.abs(collapsed.at(-1)!.after - groupScore) > 1e-7) return undefined;
  return { baseline, groupScore, net: entries.reduce((sum, row) => sum + row.delta, 0), all, collapsed, remaining: remaining.length };
}

export interface MeasuredPair {
  here: number;
  elsewhere: number;
  unit: string;
  measure: "Median" | "Missed";
  evaluatedHere?: number;
  evaluatedElsewhere?: number;
}

export function measuredPair(row: Record<string, unknown> | undefined, noun = "cases"): MeasuredPair | undefined {
  if (!row || (row.comparison != null && row.comparison !== "group_vs_rest")) return undefined;
  if (row.n_evaluated_group === 0 || row.n_evaluated_elsewhere === 0) return undefined;
  if ([row.n_evaluated_group, row.n_evaluated_elsewhere].some((value) => value != null && !count(value))) return undefined;
  const counts = {
    evaluatedHere: count(row.n_evaluated_group) ? row.n_evaluated_group : undefined,
    evaluatedElsewhere: count(row.n_evaluated_elsewhere) ? row.n_evaluated_elsewhere : undefined,
  };
  if (finite(row.median_group) && finite(row.median_elsewhere) && typeof row.unit === "string" && row.unit.trim()) {
    const units: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds", count: "count" };
    return { here: row.median_group, elsewhere: row.median_elsewhere, unit: units[row.unit] ?? row.unit, measure: "Median", ...counts };
  }
  if (share(row.share_missed_group) && share(row.share_missed_elsewhere)) {
    return { here: row.share_missed_group * 100, elsewhere: row.share_missed_elsewhere * 100, unit: `% of evaluated ${noun}`, measure: "Missed", ...counts };
  }
  return undefined;
}

/** The contrast's evaluated cases are a subset of this view's scored cases (contrast_slice). */
export function supportStages(group: unknown, scored: unknown, evaluated: unknown) {
  if (!count(group) || !count(scored) || !count(evaluated) || scored > group || evaluated > scored) return undefined;
  return [
    { label: "Whole group", count: group },
    { label: "Scored in this view", count: scored },
    { label: "Evaluated for this expectation", count: evaluated },
  ];
}
