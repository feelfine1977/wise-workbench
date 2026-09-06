import type { BacklogRow, SliceDetail, Table } from "@wise/api-schema";
import { bpic19Norm } from "./norm";
import { sliceReading } from "./reading";
import { rng, round } from "./seed";
import { violatedFor } from "./trace";

const subKeys: Record<string, { column: string; values: string[] }> = {
  "case Vendor": { column: "case Spend area text", values: ["Packaging", "Logistics", "Facilities", "Marketing", "IT", "Raw materials", "Maintenance", "Travel"] },
  "case Company+case Spend area text": { column: "case Vendor", values: ["vendorID_0136", "vendorID_0120", "vendorID_0104", "vendorID_0512", "vendorID_0077", "vendorID_1203", "vendorID_0844", "vendorID_0019"] },
  "case Item Type": { column: "case Company", values: ["companyID_0000", "companyID_0001", "companyID_0002", "companyID_0003"] },
  flow_type: { column: "case Vendor", values: ["vendorID_0136", "vendorID_0120", "vendorID_0104", "vendorID_0512"] },
};

export type DriverRecord = {
  constraint: string;
  layer: string;
  type: string;
  mean_penalty: number;
  mean_violation: number;
  share_violated: number;
  share_in_scope: number;
  share_evaluated: number;
  description: string;
  delta_gap: number;
  share_of_shortfall: number;
};

/**
 * Slice detail in the backend's shape: drivers (the library's `constraint_drivers` columns plus
 * `delta_gap`, whose values sum exactly to the gap, and `share_of_shortfall`), layer means vs global,
 * the penalty Pareto by a sub-key (`key` first), the validation row, worst cases and the headroom placeholder.
 */
export function buildSlice(row: BacklogRow, slicing: string, view: string, globalMean: number): SliceDetail {
  const r = rng(`slice:${slicing}:${row.key}:${view}`);
  const constraints = bpic19Norm.constraints;
  const dominant = row.dominant_layer;

  // constraint weights: dominant layer boosted, two constraints slightly negative
  const weights = constraints.map((c) => {
    const base = r.range(0.05, 1);
    return c.layer === dominant ? base * 4 : base;
  });
  const negIdx = new Set<number>();
  while (negIdx.size < 2 && row.gap > 0) {
    const i = r.int(0, constraints.length - 1);
    if (constraints[i]!.layer !== dominant) negIdx.add(i);
  }
  negIdx.forEach((i) => (weights[i] = -Math.abs(weights[i]!) * 0.15));
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  const deltas = weights.map((w) => (row.gap * w) / wSum);
  // enforce the exact sum after rounding: the largest contributor absorbs the rounding residual
  const rounded = deltas.map((d) => round(d, 8));
  const iMax = rounded.reduce((best, v, i) => (v > rounded[best]! ? i : best), 0);
  const residual = row.gap - rounded.reduce((s, v) => s + v, 0);
  rounded[iMax] = round(rounded[iMax]! + residual, 10);

  const records: DriverRecord[] = constraints
    .map((c, i) => {
      const delta = rounded[i]!;
      const globalPenalty = round(r.range(0.002, 0.05) * c.weight, 6);
      const shareViolated = Math.min(1, Math.max(0, Math.abs(delta) * r.range(15, 35) + r.range(0.02, 0.12)));
      const shareInScope = c.applicability?.flow_type ? round(r.range(0.35, 1), 4) : 1;
      return {
        constraint: c.id,
        layer: c.layer,
        type: c.type,
        mean_penalty: round(Math.max(0, globalPenalty + delta), 6),
        mean_violation: round(shareViolated * r.range(0.5, 1), 4),
        share_violated: round(shareViolated, 4),
        share_in_scope: shareInScope,
        share_evaluated: round(shareInScope * r.range(0.9, 1), 4),
        description: c.description ?? "",
        delta_gap: delta,
        share_of_shortfall: row.gap > 0 ? round(delta / row.gap, 6) : 0,
      };
    })
    .sort((a, b) => b.delta_gap - a.delta_gap);
  const driverColumns = ["constraint", "layer", "type", "mean_penalty", "mean_violation", "share_violated", "share_in_scope", "share_evaluated", "description", "delta_gap", "share_of_shortfall"] as const;
  const drivers: Table = { columns: [...driverColumns], rows: records.map((d) => driverColumns.map((c) => d[c])) };

  const layerRows = bpic19Norm.layers.map((l) => {
    const delta = round(records.reduce((s, d) => s + (d.layer === l.id ? d.delta_gap : 0), 0), 10);
    const global = round(r.range(0.001, 0.06), 6);
    return [l.id, round(global + delta, 8), global, delta];
  });
  const layers: Table = { columns: ["layer", "slice_mean", "global_mean", "delta"], rows: layerRows };

  const sk = subKeys[slicing] ?? subKeys["case Vendor"]!;
  let remaining = row.n_cases;
  const parts = sk.values.map((v, i) => {
    const n = i === sk.values.length - 1 ? remaining : Math.max(1, Math.round(remaining * r.range(0.15, 0.45)));
    remaining -= n;
    const meanPenalty = Math.min(0.95, Math.max(0.01, 1 - row.mean_score + r.normal(0, 0.05)));
    return { key: v, n, mass: n * meanPenalty, meanPenalty };
  });
  parts.sort((a, b) => b.mass - a.mass);
  const total = parts.reduce((s, p) => s + p.mass, 0) || 1;
  let cum = 0;
  const penaltyMass: Table = {
    columns: ["key", "n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "rank"],
    rows: parts.map((p, i) => {
      cum += p.mass / total;
      return [p.key, p.n, round(p.mass, 3), round(p.meanPenalty, 4), round(p.mass / total, 4), round(cum, 4), i + 1];
    }),
  };

  const worstCases = Array.from({ length: 12 }, (_, i) => {
    const doc = 4507000000 + r.int(1000, 99999);
    const item = String(r.int(1, 12) * 10).padStart(5, "0");
    const caseId = `${doc}_${item}`;
    return { caseId, score: round(Math.max(0, 0.15 + i * 0.03 + r.range(0, 0.05)), 4), violated: violatedFor(caseId) };
  });

  const censored = round(r.range(0.01, 0.16), 4);
  const replicated = round(dominant === "L4_rework_instability" ? r.range(0.45, 0.7) : r.range(0.05, 0.4), 4);
  const retained = round(r.range(0.55, 0.98), 4);
  const notes: string[] = [];
  if (retained < 0.5) notes.push("gap collapses without censored cases: window artefact");
  if (replicated >= 0.5) notes.push("high event replication: verify logging before acting");
  const validation = {
    n_cases: row.n_cases,
    stable_gap: row.stable_gap,
    stable_PI: row.stable_PI,
    censored_share: censored,
    replicated_share: replicated,
    stable_gap_kept: round(row.stable_gap * retained, 8),
    retained,
    reading: notes.length ? notes.join("; ") : "stable signal",
  };

  const headroom: Table = {
    columns: ["layer", "headroom", "note"],
    rows: bpic19Norm.layers.map((l) => [l.id, null, "headroom is computed by wise-analytics (increment 1)"]),
  };

  return {
    row,
    reading: sliceReading(row, records, view, 50),
    drivers,
    layers,
    penaltyMass,
    penaltyMassBy: sk.column,
    validation,
    worstCases,
    headroom,
    params: { view, gamma: 50, slicing: slicing.split("+"), key: JSON.parse(row.key) as unknown, globalMean },
  };
}
