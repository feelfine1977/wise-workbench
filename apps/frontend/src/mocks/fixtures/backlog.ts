import type { BacklogPage, BacklogRow, HotspotType, Kind, Stability } from "@wise/api-schema";
import { bpic19Norm, layerName } from "./norm";
import { KIND_OF, backlogReading } from "./reading";
import { rng, round } from "./seed";
import { slicings } from "./runs";

export interface BacklogParams {
  slicing: string;
  view: string;
  gamma: number;
  minCases: number;
  sort: string;
  hotspotType?: HotspotType;
  kind?: Kind;
  layer?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export const globalMeans: Record<string, number> = { Finance: 0.819, Logistics: 0.817, Compliance: 0.871, Automation: 0.844 };
const viewFactor: Record<string, number> = { Finance: 1, Logistics: 0.92, Compliance: 0.72, Automation: 1.12 };

const SD = 0.28;
const Z = 1.96;
const LAYERS = bpic19Norm.layers.map((l) => l.id);

/** Per layer, the expectation of the norm that the mock reports as missed most, with its description. */
const TOP_BY_LAYER: Record<string, string> = {
  L1_closure_completeness: "c_l1_clear_invoice_present",
  L2_flow_discipline: "c_l2_df1_invoice_after_goods",
  L3_timeliness_ageing: "c_l3_invoice_to_clear_days",
  L4_rework_instability: "c_l4_goods_fragmentation",
  L5_exceptions_corrections: "c_l5_cancel_invoice_receipt",
  L6_value_commercial: "c_l6_change_price",
  L7_effort_automation: "c_l7_manual_share",
};

interface Raw {
  values: string[];
  n: number;
  gap: number;
  layer: string;
  /** Anchors reproduce published values exactly in one view (no view factor, no jitter). */
  anchorView?: string;
}

const ANCHOR_GAMMA = 20;

/** Gap that yields a given stable PI at γ = 20: stable_PI = n · n/(n+γ) · gap. */
const gapForStablePI = (n: number, stablePI: number) => round((stablePI * (n + ANCHOR_GAMMA)) / (n * n), 8);

const anchors: Record<string, Raw[]> = {
  // Illustrative vendor slices (design panel, Finance view): 945 cases · gap.18 · PI 170; 294 ·.21 · 62.
  "case Vendor": [
    { values: ["vendorID_0128"], n: 945, gap: 0.18, layer: "L3_timeliness_ageing", anchorView: "Finance" },
    { values: ["vendorID_0093"], n: 294, gap: 0.21, layer: "L4_rework_instability", anchorView: "Finance" },
    { values: ["vendorID_0341"], n: 230, gap: 0.22, layer: "L2_flow_discipline", anchorView: "Finance" },
  ],
  // Paper Table XI (BPIC 2019, view Automation, γ = 20): stable PI 945.7 / 294.2 / 50.6 at ranks 1, 2, 5 with the real case counts.
  "case Company+case Spend area text": [
    { values: ["companyID_0000", "Packaging"], n: 109199, gap: gapForStablePI(109199, 945.7), layer: "L3_timeliness_ageing", anchorView: "Automation" },
    { values: ["companyID_0000", "Logistics"], n: 5242, gap: gapForStablePI(5242, 294.2), layer: "L4_rework_instability", anchorView: "Automation" },
    { values: ["companyID_0000", "Additives"], n: 18318, gap: gapForStablePI(18318, 177.8), layer: "L7_effort_automation", anchorView: "Automation" },
    { values: ["companyID_0000", "Latex & Monomers"], n: 5007, gap: gapForStablePI(5007, 88.8), layer: "L7_effort_automation", anchorView: "Automation" },
    { values: ["companyID_0003", "Real Estate"], n: 583, gap: gapForStablePI(583, 50.6), layer: "L4_rework_instability", anchorView: "Automation" },
  ],
  "case Item Type": [
    { values: ["Service"], n: 22314, gap: 0.052, layer: "L2_flow_discipline" },
    { values: ["Consignment"], n: 14092, gap: 0.031, layer: "L1_closure_completeness" },
  ],
  flow_type: [
    { values: ["DF2"], n: 221010, gap: 0.004, layer: "L3_timeliness_ageing" },
    { values: ["DF1"], n: 15182, gap: 0.041, layer: "L2_flow_discipline" },
    { values: ["Consignment"], n: 14498, gap: 0.012, layer: "L1_closure_completeness" },
    { values: ["2-way"], n: 1044, gap: 0.09, layer: "L3_timeliness_ageing" },
  ],
};

const spendAreas = ["Packaging", "Logistics", "Facilities", "Marketing", "IT", "Raw materials", "Maintenance", "Travel", "Consulting", "Utilities", "Fleet", "Workforce Services", "Additives", "Latex & Monomers", "Real Estate"];
const companies = ["companyID_0000", "companyID_0001", "companyID_0002", "companyID_0003"];
const itemTypes = ["Standard", "Service", "Consignment", "Subcontracting", "Third-party", "Limit"];

export const keyOf = (values: string[]) => JSON.stringify(values);

export function attributesOf(slicing: string): string[] {
  return slicings.find((s) => s.id === slicing)?.attributes ?? slicing.split("+");
}

/** The raw slice population per slicing; deterministic. */
export function rawSlices(slicing: string): Raw[] {
  const r = rng(`slices:${slicing}`);
  const out: Raw[] = [...(anchors[slicing] ?? [])];
  const seen = new Set(out.map((o) => keyOf(o.values)));
  const target = slicing === "case Vendor" ? 60 : slicing === "case Company+case Spend area text" ? 30 : slicing === "flow_type" ? 4 : 6;
  let guard = 0;
  while (out.length < target && guard++ < 1000) {
    let values: string[];
    if (slicing === "case Vendor") {
      values = [`vendorID_${String(r.int(1, 1999)).padStart(4, "0")}`];
    } else if (slicing === "case Company+case Spend area text") {
      values = [r.pick(companies), r.pick(spendAreas)];
    } else {
      values = [itemTypes[out.length] ?? `type_${out.length}`];
    }
    const key = keyOf(values);
    if (seen.has(key)) continue;
    seen.add(key);
    const n = slicing === "case Item Type" ? r.int(3000, 90000) : Math.round(Math.exp(r.range(Math.log(20), Math.log(3200))));
    // company × spend area: the published anchors keep their ranks, so random slices stay below the fifth
    const gapRaw = slicing === "case Company+case Spend area text" ? Math.min(0.012, r.normal(0.006, 0.006)) : r.normal(0.025, 0.055);
    const gap = gapRaw > 0.001 ? round(gapRaw, 4) : 0;
    out.push({ values, n, gap, layer: r.pick(LAYERS) });
  }
  return out;
}

function stability(stablePI: number, piLower: number, n: number): Stability {
  if (stablePI <= 0) return "unknown";
  const ratio = piLower / stablePI;
  if (ratio >= 0.6 && n >= 200) return "stable";
  if (ratio >= 0.3) return "fragile";
  return "insufficient_support";
}

function rank(values: number[]): number[] {
  // average ranks, ascending
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]![1]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Full backlog for a slicing/view/gamma with the library's columns, the hotspot typology and the plain fields. */
export function buildBacklog(slicing: string, view: string, gamma: number, minCases: number): { rows: BacklogRow[]; globalMean: number } {
  const mu = globalMeans[view] ?? 0.84;
  const factor = viewFactor[view] ?? 1;
  const attributes = attributesOf(slicing);
  const r = rng(`view:${view}:${slicing}`);
  const rows: BacklogRow[] = rawSlices(slicing)
    .filter((s) => s.n >= minCases)
    .map((s) => {
      const n = s.n;
      const jitter = 1 + r.normal(0, 0.08);
      const exact = s.anchorView === view;
      const gap = round(Math.max(0, exact ? s.gap : s.gap * factor * jitter), 8);
      const mean = round(gap > 0 ? mu - gap : mu + r.range(0.005, 0.06), 6);
      const shrink = gamma > 0 ? n / (n + gamma) : 1;
      const stableGap = round(shrink * gap, 8);
      const se = SD / Math.sqrt(n);
      const gapLower = Math.max(0, stableGap - Z * se);
      const PI = round(n * gap, 4);
      const stablePI = round(n * stableGap, 4);
      const piLower = round(n * gapLower, 4);
      const layer = gap > 0 ? s.layer : undefined;
      const topId = layer ? TOP_BY_LAYER[layer] : undefined;
      const top = topId ? bpic19Norm.constraints.find((c) => c.id === topId) : undefined;
      return {
        key: keyOf(s.values),
        keys: Object.fromEntries(attributes.map((a, i) => [a, s.values[i] ?? ""])),
        n_cases: n,
        mean_score: mean,
        gap,
        stable_gap: stableGap,
        PI,
        stable_PI: stablePI,
        PI_lower: piLower,
        volume: n,
        stable_mean: round(mu - stableGap, 6),
        global_mean: mu,
        se: round(se, 6),
        gap_lower: round(gapLower, 8),
        rank: 0,
        dominant_layer: layer,
        dominant_layer_name: layer ? layerName(bpic19Norm, layer) : undefined,
        top_constraint: top?.id,
        top_constraint_description: top?.description,
        top_constraint_share: top ? round(Math.min(0.99, 0.2 + gap * 40 + r.range(0, 0.3)), 4) : undefined,
        stability: stability(stablePI, piLower, n),
      } as BacklogRow;
    });

  // ranks by stable PI (the library's order), then the hotspot typology on the top 12
  rows.sort((a, b) => b.stable_PI - a.stable_PI || b.n_cases - a.n_cases);
  rows.forEach((row, i) => {
    row.rank = i + 1;
    row.n_ranked = rows.length;
  });
  const top = rows.filter((x) => x.stable_PI > 0).slice(0, 12);
  if (top.length >= 2) {
    const vr = rank(top.map((x) => x.n_cases));
    const gr = rank(top.map((x) => x.stable_gap));
    const res = top.map((_, i) => vr[i]! - gr[i]!);
    let iRes = 0;
    res.forEach((v, i) => {
      if (v > res[iRes]!) iRes = i;
    });
    top.forEach((x) => (x.hotspot_type = "mechanism"));
    if (res[iRes]! > 0) top[iRes]!.hotspot_type = "reservoir";
    let iSev = -1;
    let best = -Infinity;
    top.forEach((_, i) => {
      if (i === iRes) return;
      const sev = gr[i]! - vr[i]!;
      if (sev > best) {
        best = sev;
        iSev = i;
      }
    });
    if (iSev >= 0 && best > 0) top[iSev]!.hotspot_type = "severity";
  }
  for (const row of rows) {
    const kind = row.hotspot_type ? (KIND_OF[row.hotspot_type] as Kind) : undefined;
    row.kind = kind;
    row.kind_reading = kind ? { acute: "few cases, far off", systematic: "one pattern behind it", widespread: "many cases, slightly off" }[kind] : undefined;
    row.reading = backlogReading(row, view, gamma);
  }
  return { rows, globalMean: mu };
}

/**
 * The expectations of this run whose threshold separates no group (R2-09): one missed by almost every case,
 * two met by almost every case. The verified run answers the same three.
 */
export const UNCALIBRATED = [
  {
    id: "c_l7_manual_share",
    layer: "L7_effort_automation",
    plain_name: "Mostly automatic",
    description: "High manual share indicates low straight-through processing.",
    share_violated: 0.9208926883138551,
    evaluated: 251734,
    reason: "almost_always_missed",
    text: "Mostly automatic is missed by 92 % of all purchase order items it applies to — a threshold to calibrate, not a difference between groups.",
  },
  {
    id: "c_l5_cancel_goods_receipt",
    layer: "L5_exceptions_corrections",
    plain_name: "Receipt not cancelled",
    description: "Goods receipt cancellations should be exceptional.",
    share_violated: 0.009852806254736926,
    evaluated: 250690,
    reason: "almost_never_missed",
    text: "Receipt not cancelled is met by 99 % of all purchase order items it applies to — it cannot fail on this log as it is set.",
  },
  {
    id: "c_l2_df2_release_after_goods",
    layer: "L2_flow_discipline",
    plain_name: "Block released after the goods (invoice-first flow)",
    description: "In DF2, payment-block release should happen after the first goods/service event.",
    share_violated: 0.0065355805243445695,
    evaluated: 53400,
    reason: "almost_never_missed",
    text: "Block released after the goods (invoice-first flow) is met by 99 % of all purchase order items it applies to — it cannot fail on this log as it is set.",
  },
];

export function pageBacklog(all: BacklogRow[], globalMean: number, p: BacklogParams): BacklogPage {
  let rows = all;
  const hotspot = p.hotspotType ?? (p.kind ? ({ acute: "severity", systematic: "mechanism", widespread: "reservoir" } as const)[p.kind] : undefined);
  if (hotspot) rows = rows.filter((x) => x.hotspot_type === hotspot);
  if (p.layer) rows = rows.filter((x) => x.dominant_layer === p.layer);
  if (p.q) {
    const q = p.q.toLowerCase();
    rows = rows.filter((x) => x.key.toLowerCase().includes(q) || Object.values(x.keys ?? {}).some((v) => v.toLowerCase().includes(q)));
  }
  const desc = p.sort.startsWith("-");
  const col = (desc ? p.sort.slice(1) : p.sort) as keyof BacklogRow;
  rows = [...rows].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    let c = 0;
    if (typeof av === "number" && typeof bv === "number") c = av - bv;
    else c = String(av ?? "").localeCompare(String(bv ?? ""));
    if (c === 0) c = a.rank - b.rank;
    return desc ? -c : c;
  });
  const start = (p.page - 1) * p.pageSize;
  return {
    rows: rows.slice(start, start + p.pageSize),
    total: rows.length,
    params: { ...p, attributes: attributesOf(p.slicing), baseline: globalMean, volume: "cases", z: Z, case_noun: "purchase order items", uncalibrated: UNCALIBRATED },
    globalMean,
    maxStablePI: all.reduce((m, r) => Math.max(m, r.stable_PI), 0),
  };
}
