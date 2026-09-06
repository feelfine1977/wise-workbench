/**
 * The reading sentences of the mocks, in the same plain template the backend uses
 * (`wise_workbench.domain.readings`): group, cases, shortfall, kind, most-missed expectation area,
 * confidence, priority, rank.
 */
import type { BacklogRow } from "@wise/api-schema";

export const KIND_OF: Record<string, string> = { severity: "acute", mechanism: "systematic", reservoir: "widespread" };
export const KIND_READING: Record<string, string> = { acute: "few cases, far off", systematic: "one pattern behind it", widespread: "many cases, slightly off" };
const CONFIDENCE: Record<string, string> = { stable: "high", fragile: "medium", insufficient_support: "not enough cases to be sure", unknown: "not computed for this run" };

const int = (n: number) => n.toLocaleString("en");
const fixed = (v: number, d = 1) => v.toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d });

/** A share as a percentage with as many decimals as the size needs: 0.0087 → "0.9 %". */
export function pct(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "n/a";
  const p = share * 100;
  const digits = p >= 10 ? 0 : p >= 0.1 ? 1 : 2;
  return `${p.toFixed(digits)} %`;
}

export function groupLabel(row: Pick<BacklogRow, "key" | "keys">): string {
  const values = Object.values(row.keys ?? {});
  if (values.length) return values.join(" × ");
  try {
    const parsed = JSON.parse(row.key) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join(" × ");
  } catch {
    /* not a JSON key */
  }
  return row.key;
}

export function backlogReading(row: BacklogRow, view: string | undefined, gamma: number, label = groupLabel(row)): string {
  const perspective = view ? ` in the ${view} perspective` : "";
  if (row.gap <= 0) return `${label}: ${int(row.n_cases)} cases at or above expectation on average${perspective}; no shortfall, priority 0.`;
  let shortfall = `${pct(row.gap)} below expectation on average`;
  if (pct(row.stable_gap) !== pct(row.gap)) shortfall += ` (${pct(row.stable_gap)} with small groups discounted)`;
  const parts = [`${label}: ${int(row.n_cases)} cases, ${shortfall}`];
  const kind = row.kind ?? (row.hotspot_type ? KIND_OF[row.hotspot_type] : undefined);
  if (kind) parts.push(`${kind}: ${KIND_READING[kind]}`);
  const area = row.dominant_layer_name ?? row.dominant_layer;
  if (area) {
    const detail = row.top_constraint_description?.replace(/\.$/, "");
    if (detail && row.top_constraint_share !== null && row.top_constraint_share !== undefined) parts.push(`most-missed expectation area: ${area} (${detail}, missed in ${pct(row.top_constraint_share)} of these cases)`);
    else if (detail) parts.push(`most-missed expectation area: ${area} (${detail})`);
    else parts.push(`most-missed expectation area: ${area}`);
  }
  parts.push(`confidence in rank: ${CONFIDENCE[row.stability ?? "unknown"]}`);
  let priority = `priority ${fixed(row.stable_PI)}`;
  priority += fixed(row.PI) !== fixed(row.stable_PI) ? ` (raw ${fixed(row.PI)}; small groups discounted with γ = ${gamma})` : ` (small groups discounted with γ = ${gamma})`;
  if (row.n_ranked) priority += `, rank ${row.rank} of ${int(row.n_ranked)}`;
  else priority += `, rank ${row.rank}`;
  parts.push(priority + perspective);
  return parts.join("; ") + ".";
}

export function sliceReading(row: BacklogRow, drivers: { description?: string; constraint: string; delta_gap: number; share_of_shortfall: number; share_violated: number }[], view: string | undefined, gamma: number): string {
  const base = backlogReading(row, view, gamma);
  const top = [...drivers].filter((d) => d.delta_gap > 0).sort((a, b) => b.delta_gap - a.delta_gap).slice(0, 3);
  if (!top.length) return base;
  const items = top.map((d) => `${(d.description ?? d.constraint).replace(/\.$/, "")} (explains ${pct(d.share_of_shortfall)} of the shortfall, missed in ${pct(d.share_violated)} of cases)`);
  return `${base} Expectations behind the shortfall: ${items.join("; ")}.`;
}
