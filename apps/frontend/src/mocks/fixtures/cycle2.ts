/**
 * Cycle-2 shapes on the mocks, in the contract's own field names (openapi.yaml of 2026-09-06): the plain
 * fields on backlog rows, the contrast, comparisons, subgroups, guidance refs and headroom of a slice, the
 * filter model and its preview, drill-in, the slicing preview, flow types, the flow-type comparison and the
 * decisions on readiness items. Real numbers come from the verified fixtures where they exist; everything
 * derived for the illustrative slicings is deterministic and labelled so in `params.illustrative`.
 */
import type { BacklogRow, CaseTable, Readiness, SliceDetail, Table } from "@wise/api-schema";
import type { BacklogParamsC2, Caveat, Decision, DecisionKind, DecisionPreviewNumbers, DecisionPreviewOut, Filter, FilterClause, FilterPreview, FlowTypeComparison, FlowTypes, GuidanceRef, SlicingPreview, Within } from "@/lib/api/cycle2";
import { clauseKey } from "@/lib/filter";
import { bpic19Norm } from "./norm";
import { rng, round } from "./seed";
import { VERIFIED_CASE_NOUN, VERIFIED_WINDOW_END, verifiedComparison, verifiedDecisionKinds, verifiedDrillPackaging, verifiedFlowTypes } from "./verified";

/** Plain names of the seven layers: the hub's expectation and the missed form for cards (cycle-1 review §9, as the backend serves them). */
export const LAYER_PLAIN: Record<string, { expectation: string; missed: string }> = {
  L1_closure_completeness: { expectation: "Closing the loop", missed: "missing invoice or payment" },
  L2_flow_discipline: { expectation: "Buying channel and sequence", missed: "steps out of order for this flow type" },
  L3_timeliness_ageing: { expectation: "On time", missed: "waiting too long between steps" },
  L4_rework_instability: { expectation: "Doing it once", missed: "repeated or changed postings" },
  L5_exceptions_corrections: { expectation: "Exceptions stay rare", missed: "cancellations and memos" },
  L6_value_commercial: { expectation: "Paying what was agreed", missed: "price or quantity changed after ordering" },
  L7_effort_automation: { expectation: "Touchless where possible", missed: "too many manual touches" },
};

const CONSTRAINT_PLAIN: Record<string, string> = {
  c_l3_invoice_to_clear_days: "Paid within terms",
  c_l3_df2_goods_to_rpb_days: "Block released soon after the goods",
  c_l7_manual_share: "Mostly automatic",
  c_l1_clear_invoice_present: "Invoice cleared",
  c_l2_df1_invoice_after_goods: "Goods before the invoice",
  c_l4_goods_fragmentation: "Goods received in one go",
  c_l5_cancel_invoice_receipt: "No invoice cancellations",
  c_l6_change_price: "Price unchanged after ordering",
};
const plainConstraint = (id: string, description?: string | null) => CONSTRAINT_PLAIN[id] ?? (description ?? id).replace(/\.$/, "").replace(/ should .*$/, "");

const LOG_WIDE_CAVEATS: Caveat[] = [
  { id: "censoring", share: 0.139, status: "warn", text: "14 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged (log-wide share)", window_end: "2019-01-17" },
  { id: "replication", share: 0.017, status: "info", text: "2 % of purchase order items carry postings copied from the order header (log-wide share)", window_end: null },
];

/** "0.9 points below the overall score of 84.4 (1 %)" — the backend's points rule (RG-18). */
export function pointsBelow(row: { gap: number; global_mean?: number | null; mean_score: number }): string {
  const mu = row.global_mean ?? row.mean_score + row.gap;
  const points = row.gap * 100;
  const pct = mu > 0 ? Math.round((row.gap / mu) * 100) : 0;
  if (row.gap <= 0) return `at or above the overall score of ${(mu * 100).toFixed(1)}`;
  return `${points.toFixed(points >= 10 ? 0 : 1)} points below the overall score of ${(mu * 100).toFixed(1)} (${pct} %)`;
}

/** Illustrative comparison sentences for slicings that have no verified contrast. */
function illustrativeComparison(row: BacklogRow): { sentence: string | null; kind: "lag" | "count" | "share" | "metric" | "rate" | null } {
  if (!row.top_constraint) return { sentence: null, kind: null };
  const c = bpic19Norm.constraints.find((x) => x.id === row.top_constraint);
  if (!c) return { sentence: null, kind: null };
  const r = rng(`cmp:${row.key}:${c.id}`);
  const plain = plainConstraint(c.id, c.description);
  switch (c.type) {
    case "lag": {
      const rest = Number(c.params.delta ?? 30) * r.range(0.7, 1.4);
      const here = rest * r.range(1.3, 2.4);
      return { sentence: `${plain}: ${Math.round(here)} days here against ${Math.round(rest)} elsewhere (+${Math.round(here - rest)} days).`, kind: "lag" };
    }
    case "presence": {
      const rest = r.range(0.04, 0.2);
      const here = Math.min(0.95, rest * r.range(2, 5));
      return { sentence: `${plain}: ${Math.round(here * 100)} % of items without the posting here against ${Math.round(rest * 100)} % elsewhere.`, kind: "share" };
    }
    case "singularity":
    case "metric": {
      const rest = r.range(1, 2);
      const here = rest * r.range(1.5, 4);
      return { sentence: `${plain}: ${here.toFixed(1)} postings per item here against ${rest.toFixed(1)} elsewhere.`, kind: "count" };
    }
    default: {
      const rest = r.range(0.05, 0.25);
      const here = Math.min(0.95, rest * r.range(1.8, 4));
      return { sentence: `${plain}: ${Math.round(here * 100)} % of items miss this rule here against ${Math.round(rest * 100)} % elsewhere.`, kind: "rate" };
    }
  }
}

function illustrativeStability(row: BacklogRow): { stability: BacklogRow["stability"]; reason: string } {
  if (row.stable_PI <= 0) return { stability: "unknown", reason: "no shortfall" };
  const ratio = (row.PI_lower ?? 0) / row.stable_PI;
  if (ratio >= 0.6 && row.n_cases >= 200) return { stability: "stable", reason: "P(stays in top-10) = 0.95 (illustrative)" };
  if (ratio >= 0.3) return { stability: "fragile", reason: "P(stays in top-10) = 0.55 (illustrative)" };
  return { stability: "insufficient_support", reason: "fewer cases than the resampling rule needs (illustrative)" };
}

/** Adds the cycle-2 plain fields to an illustrative row in the contract's field names; verified rows carry them already. */
export function enrichRow(row: BacklogRow, _view: string, illustrative: boolean): BacklogRow {
  if (!illustrative) return row;
  const plain = row.dominant_layer ? LAYER_PLAIN[row.dominant_layer] : undefined;
  const cmp = illustrativeComparison(row);
  const st = illustrativeStability(row);
  const caveats = LOG_WIDE_CAVEATS;
  const noun = VERIFIED_CASE_NOUN;
  const label = Object.values(row.keys ?? {}).join(" × ") || row.key;
  const readingPlain = `${label}: ${row.n_cases.toLocaleString("en")} ${noun}, ${pointsBelow(row)}${row.kind ? `; ${row.kind}: ${row.kind_reading}` : ""}${plain ? `; most often missed: ${plain.expectation}.` : "."}${cmp.sentence ? ` ${cmp.sentence}` : ""}`;
  return {
    ...row,
    stability: st.stability,
    stability_reason: st.reason,
    plain_layer: plain?.expectation ?? null,
    layer_missed_label: plain?.missed ?? null,
    top_constraint_plain: row.top_constraint ? plainConstraint(row.top_constraint, row.top_constraint_description) : null,
    comparison: cmp.sentence,
    comparison_kind: cmp.kind,
    caveats,
    n_caveats: caveats.length,
    case_noun: noun,
    points_below: pointsBelow(row),
    kind_source: "library",
    reading_plain: readingPlain,
  } as BacklogRow;
}

export const backlogParamsC2 = (illustrative: boolean, extra: Partial<BacklogParamsC2> = {}): BacklogParamsC2 => ({
  window_end: VERIFIED_WINDOW_END,
  case_noun: VERIFIED_CASE_NOUN,
  analytics_record_ids: illustrative ? {} : { readiness: "mock", bootstrap_backlog: "mock", caveats: "mock" },
  analytics_available: !illustrative,
  stability_applies: !illustrative,
  illustrative,
  scope: null,
  drill: null,
  filter: null,
  cases: null,
  ...extra,
});

// ---------------------------------------------------------------- filters

/** Every clause removes a deterministic share of the cases; the preview and the rows agree. */
export function clauseKeepShare(c: FilterClause): number {
  return round(rng(`filter:${clauseKey(c)}`).range(0.4, 0.95), 4);
}

export function filterKeepShare(filter: Filter | undefined): number {
  return (filter?.and ?? []).reduce((s, c) => s * clauseKeepShare(c), 1);
}

export function applyFilter(rows: BacklogRow[], filter: Filter | undefined, gamma: number): BacklogRow[] {
  const keep = filterKeepShare(filter);
  if (keep >= 1) return rows;
  const out = rows.map((row) => {
    const n = Math.max(1, Math.round(row.n_cases * keep));
    const gap = row.gap;
    const shrink = gamma > 0 ? n / (n + gamma) : 1;
    return { ...row, n_cases: n, volume: n, PI: round(n * gap, 4), stable_gap: round(gap * shrink, 8), stable_PI: round(n * gap * shrink, 4), PI_lower: round(n * Math.max(0, gap * shrink - 1.96 * (row.se ?? 0)), 4), points_below: pointsBelow(row) };
  });
  out.sort((a, b) => b.stable_PI - a.stable_PI);
  out.forEach((r, i) => {
    r.rank = i + 1;
    r.n_ranked = out.length;
  });
  return out;
}

export function filterPreviewFor(filter: Filter | undefined, total: number): FilterPreview {
  const clauses = filter?.and ?? [];
  let remaining = total;
  const perClause = clauses.map((c, i) => {
    const before = remaining;
    remaining = Math.round(remaining * clauseKeepShare(c));
    return { clause: i, removed_marginally: before - remaining, kept_alone: Math.round(total * clauseKeepShare(c)) };
  });
  return {
    cases_in: remaining,
    cases_out: total - remaining,
    per_clause: perClause,
    in_scope_by_constraint: Object.fromEntries(bpic19Norm.constraints.map((c) => [c.id, Math.round(remaining * rng(`scope:${c.id}`).range(0.5, 1))])),
    filter: (filter as unknown as Record<string, unknown> | undefined) ?? null,
  };
}

// ---------------------------------------------------------------- drill into a group (R2-O2) and the slicing preview

const DRILL_ATTRIBUTE: Record<string, string> = {
  "case Company+case Spend area text": "case Vendor",
  "case Vendor": "case Spend area text",
  "case Item Type": "case Company",
  flow_type: "case Vendor",
};

export const drillAttributeFor = (slicing: string) => DRILL_ATTRIBUTE[slicing] ?? "case Vendor";

/** Rows of a finer slicing inside one group: the verified vendors inside Packaging, else the group's cases split over the sub-key of its penalty Pareto. */
export function drillInto(parent: BacklogRow, within: Within, detail: SliceDetail, gamma: number, view: string): { rows: BacklogRow[]; attributes: string[]; illustrative: boolean } {
  const sub = detail.penaltyMassBy ?? drillAttributeFor(within.slicing);
  if (within.slicing === "case Company+case Spend area text" && JSON.stringify(JSON.parse(within.key)) === JSON.stringify(["companyID_0000", "Packaging"]) && view === "Automation") {
    return { rows: verifiedDrillPackaging.rows, attributes: ["case Vendor"], illustrative: false };
  }
  const r = rng(`drill:${within.slicing}:${within.key}`);
  const cols = detail.penaltyMass.columns;
  const iKey = cols.indexOf("key");
  const iN = cols.indexOf("n_cases");
  const iPen = cols.indexOf("mean_penalty");
  const mu = parent.global_mean ?? parent.mean_score + parent.gap;
  const rows: BacklogRow[] = detail.penaltyMass.rows.map((row) => {
    const value = String(row[iKey]);
    const n = Number(row[iN]);
    const meanPenalty = Number(row[iPen]);
    const mean = round(Math.min(0.99, Math.max(0.05, 1 - meanPenalty + r.normal(0, 0.01))), 6);
    const gap = round(Math.max(0, mu - mean), 8);
    const shrink = gamma > 0 ? n / (n + gamma) : 1;
    const se = 0.28 / Math.sqrt(Math.max(1, n));
    const base = {
      key: JSON.stringify([value]),
      keys: { [sub]: value },
      n_cases: n,
      mean_score: mean,
      gap,
      stable_gap: round(gap * shrink, 8),
      PI: round(n * gap, 4),
      stable_PI: round(n * gap * shrink, 4),
      PI_lower: round(n * Math.max(0, gap * shrink - 1.96 * se), 4),
      volume: n,
      global_mean: mu,
      se: round(se, 6),
      rank: 0,
      hotspot_type: parent.hotspot_type,
      kind: parent.kind,
      kind_reading: parent.kind_reading,
      dominant_layer: parent.dominant_layer,
      dominant_layer_name: parent.dominant_layer_name,
      top_constraint: parent.top_constraint,
      top_constraint_description: parent.top_constraint_description,
      top_constraint_share: parent.top_constraint_share,
      stability: "unknown" as const,
      reading: `${value} inside ${Object.values(parent.keys ?? {}).join(" × ")}: ${n.toLocaleString("en")} purchase order items, ${pointsBelow({ gap, global_mean: mu, mean_score: mean })}.`,
    } as BacklogRow;
    return enrichRow(base, view, true);
  });
  rows.sort((a, b) => b.stable_PI - a.stable_PI);
  rows.forEach((row, i) => {
    row.rank = i + 1;
    row.n_ranked = rows.length;
  });
  return { rows, attributes: [sub], illustrative: true };
}

export function slicingPreviewFor(attributes: string[], bands: { attribute: string; method?: string; q?: number | null; cuts?: number[] | null }[] | undefined, minCases: number, total: number): SlicingPreview {
  const r = rng(`preview:${attributes.join("+")}:${JSON.stringify(bands ?? [])}`);
  const distinct = attributes.reduce((p, a) => p * ({ "case Vendor": 1975, "case Company": 4, "case Spend area text": 21, "case Item Type": 6, "case Item Category": 4, flow_type: 4, "case Document Type": 3 }[a] ?? (bands?.find((b) => b.attribute === a) ? (bands.find((b) => b.attribute === a)?.q ?? (bands.find((b) => b.attribute === a)?.cuts?.length ?? 3) + 1) : 8)), 1);
  const groups = Math.min(distinct, 5000);
  const below = Math.round(groups * (groups > 200 ? r.range(0.5, 0.85) : r.range(0, 0.2)));
  const sizes: Record<string, number> = {};
  let left = total;
  for (let i = 0; i < Math.min(groups, 6); i++) {
    const n = i === Math.min(groups, 6) - 1 ? Math.round(left * r.range(0.1, 0.3)) : Math.round(left * r.range(0.15, 0.5));
    sizes[`group ${i + 1}`] = n;
    left -= n;
  }
  return { attributes, effectiveAttributes: attributes.map((a) => (bands?.some((b) => b.attribute === a) ? `${a} (band)` : a)), bands: (bands ?? []) as Record<string, unknown>[], groups, cases: total, belowMinCases: below, minCases, sizes, largest: Object.entries(sizes).map(([key, n]) => ({ key, cases: n })) };
}

// ---------------------------------------------------------------- slice additions

/** The contract's slice additions for an illustrative slice; verified slices carry them already. */
export function sliceC2(detail: SliceDetail, view: string, illustrative: boolean): SliceDetail {
  if (!illustrative) return detail;
  const cols = detail.drivers.columns;
  const idx = (n: string) => cols.indexOf(n);
  const drivers = detail.drivers.rows
    .map((row) => ({
      constraint: String(row[idx("constraint")]),
      layer: String(row[idx("layer")]),
      type: String(row[idx("type")]),
      description: String(row[idx("description")] ?? ""),
      shareViolated: Number(row[idx("share_violated")] ?? 0),
      shareOfShortfall: Number(row[idx("share_of_shortfall")] ?? 0),
      deltaGap: Number(row[idx("delta_gap")] ?? 0),
    }))
    .filter((d) => d.deltaGap > 0)
    .slice(0, 5);
  const contrastRows = drivers.map((d) => {
    const c = bpic19Norm.constraints.find((x) => x.id === d.constraint);
    const r = rng(`contrast:${detail.row.key}:${d.constraint}`);
    const rest = round(Math.max(0.01, d.shareViolated * r.range(0.35, 0.8)), 4);
    const rd = round(d.shareViolated - rest, 4);
    const unit = c?.type === "lag" ? "D" : c?.type === "singularity" || c?.type === "metric" ? "count" : null;
    const medianGroup = unit ? round(Number(c?.params.delta ?? c?.params.k ?? 1) * r.range(1.2, 2.6), 2) : null;
    const medianRest = medianGroup !== null ? round(medianGroup * r.range(0.45, 0.8), 2) : null;
    const nGroup = Math.round(detail.row.n_cases * r.range(0.6, 1));
    return { d, rest, rd, unit, medianGroup, medianRest, nGroup, nRest: Math.round(251734 * r.range(0.5, 0.9)) };
  });
  const contrast: Table = {
    columns: ["constraint", "plain", "description", "layer", "type", "share_missed_group", "share_missed_elsewhere", "risk_difference", "rd_lo", "rd_hi", "median_group", "median_elsewhere", "shift", "unit", "pattern", "share_of_shortfall", "delta", "delta_lo", "delta_hi", "n_evaluated_group", "n_evaluated_elsewhere"],
    rows: contrastRows.map(({ d, rest, rd, unit, medianGroup, medianRest, nGroup, nRest }) => [d.constraint, plainConstraint(d.constraint, d.description), d.description, d.layer, d.type, d.shareViolated, rest, rd, round(rd - 0.02, 4), round(rd + 0.02, 4), medianGroup, medianRest, medianGroup !== null && medianRest !== null ? round(medianGroup - medianRest, 2) : null, unit, medianGroup !== null ? "whole distribution shifted" : "more cases miss it", d.shareOfShortfall, d.deltaGap, round(d.deltaGap * 0.98, 8), round(d.deltaGap * 1.02, 8), nGroup, nRest]),
  };
  const comparisons: Table = {
    columns: ["constraint", "kind", "description", "value_slice", "value_rest", "difference", "unit", "rate_slice", "rate_rest", "share_of_gap", "sentence"],
    rows: contrastRows.map(({ d, unit, medianGroup, medianRest, rest }) => {
      const kind = unit === "D" ? "lag" : unit === "count" ? "count" : "share";
      const plain = plainConstraint(d.constraint, d.description);
      const sentence =
        kind === "lag" && medianGroup !== null && medianRest !== null
          ? `${plain}: ${Math.round(medianGroup)} days here against ${Math.round(medianRest)} elsewhere (+${Math.round(medianGroup - medianRest)} days)`
          : kind === "count" && medianGroup !== null && medianRest !== null
            ? `${plain}: ${medianGroup.toFixed(1)} postings per item here against ${medianRest.toFixed(1)} elsewhere`
            : `${plain}: ${Math.round(d.shareViolated * 100)} % of items miss it here against ${Math.round(rest * 100)} % elsewhere`;
      return [d.constraint, kind, d.description, kind === "share" ? d.shareViolated : medianGroup, kind === "share" ? rest : medianRest, kind === "share" ? round(d.shareViolated - rest, 4) : medianGroup !== null && medianRest !== null ? round(medianGroup - medianRest, 2) : null, kind === "lag" ? "days" : kind === "count" ? "postings" : "share", d.shareViolated, rest, d.shareOfShortfall, sentence];
    }),
  };
  const v = (detail.validation ?? {}) as { censored_share?: number; replicated_share?: number };
  const caveats: Caveat[] = [];
  if ((v.censored_share ?? 0) > 0.005) caveats.push({ id: "censoring", share: round(v.censored_share ?? 0, 4), status: "warn", text: `${Math.round((v.censored_share ?? 0) * 100)} % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged`, window_end: "2019-01-17" });
  if ((v.replicated_share ?? 0) > 0.005) caveats.push({ id: "replication", share: round(v.replicated_share ?? 0, 4), status: (v.replicated_share ?? 0) > 0.5 ? "fail" : "warn", text: `${Math.round((v.replicated_share ?? 0) * 100)} % of purchase order items carry postings copied from the order header`, window_end: null });
  const pm = detail.penaltyMass;
  const subgroups: Table = {
    columns: ["attribute", "value", "cases", "share", "penalty_mass", "mean_penalty", "rank", "censored_share", "caveat"],
    rows: pm.rows.slice(0, 8).map((row, i) => [detail.penaltyMassBy ?? "sub-group", row[pm.columns.indexOf("key")], row[pm.columns.indexOf("n_cases")], row[pm.columns.indexOf("share")], row[pm.columns.indexOf("penalty_mass")], row[pm.columns.indexOf("mean_penalty")], i + 1, null, ""]),
  };
  const guidance: GuidanceRef[] = [
    ...(detail.row.dominant_layer ? [{ kind: "layer" as const, id: detail.row.dominant_layer, plain_name: LAYER_PLAIN[detail.row.dominant_layer]?.expectation ?? null, missed_label: LAYER_PLAIN[detail.row.dominant_layer]?.missed ?? null, hub_node: `layer:${detail.row.dominant_layer.replace(/^L\d_/, "")}` }] : []),
    ...drivers.slice(0, 3).map((d) => ({ kind: "constraint" as const, id: d.constraint, plain_name: plainConstraint(d.constraint, d.description), missed_label: null, hub_node: `expectation:p2p_bpic19:${d.constraint}` })),
  ];
  const headroom: Table = {
    columns: ["constraint", "plain", "description", "layer", "gain_points", "gain_percent", "stable_PI_after", "PI_reduction", "share_violated", "n_evaluated"],
    rows: drivers.map((d) => {
      const gainPoints = round(d.deltaGap * 100 * rng(`hr:${d.constraint}`).range(1, 5), 3);
      const pct = Math.min(100, round((d.deltaGap / Math.max(detail.row.gap, 1e-9)) * 100, 1));
      return [d.constraint, plainConstraint(d.constraint, d.description), d.description, d.layer, gainPoints, pct, round(detail.row.stable_PI * (1 - pct / 100), 4), round(detail.row.stable_PI * (pct / 100), 4), d.shareViolated, Math.round(detail.row.n_cases * 0.8)];
    }),
  };
  const row = enrichRow(detail.row, view, true);
  const comparison = row.comparison ?? null;
  return {
    ...detail,
    row,
    reading_plain: row.reading_plain ?? undefined,
    contrast,
    comparisons,
    caveats,
    subgroups,
    guidance_refs: guidance,
    comparison,
    headroom,
    analytics: { available: false, recordIds: {}, readings: [], error: null, illustrative: true },
  };
}

// ---------------------------------------------------------------- flow types (R2-O10) and the comparison

/** The verified case table's flow types, re-keyed to the case table asked for. */
export function flowTypesFor(caseTableId: string): FlowTypes {
  return { ...verifiedFlowTypes, caseTableId };
}

export function compareFlowTypesFor(scopedRunIds: Record<string, string>): FlowTypeComparison {
  return { ...verifiedComparison, types: (verifiedComparison.types as { name: string }[]).map((t) => ({ ...t, runId: scopedRunIds[t.name] ?? null })) };
}

// ---------------------------------------------------------------- readiness decisions (R2-O1)

export const decisionKinds = (): DecisionKind[] => verifiedDecisionKinds;

export function decisionPreviewFor(kind: string, params: Record<string, unknown>, readiness: Readiness | null | undefined, caseTableId: string, version: number): DecisionPreviewOut | undefined {
  const spec = verifiedDecisionKinds.find((k) => k.kind === kind);
  if (!spec) return undefined;
  const ev = (id: string) => ((readiness?.items ?? []).find((i) => i.id === id)?.evidence ?? {}) as Record<string, unknown>;
  const total = { totalCases: 251734, totalEvents: 1595923 };
  let numbers: DecisionPreviewNumbers;
  switch (kind) {
    case "drop_outside_window": {
      const events = Number(ev("timestamp_outliers").events ?? 578);
      numbers = { cases: Math.round(events * 0.9), events, ...total, detail: { start: params.start ?? "2017-12-31T23:59:00", end: params.end ?? "2019-01-17T15:44:00" } };
      break;
    }
    case "sentinel_as_missing": {
      const values = (ev("sentinel_dates").values as { events: number; timestamp: string }[] | undefined) ?? [{ events: 74, timestamp: "2017-12-04T23:59:00" }];
      const events = values.reduce((s, v) => s + v.events, 0);
      numbers = { cases: events, events, ...total, detail: { timestamps: (params.timestamps as string[] | undefined) ?? values.map((v) => v.timestamp) } };
      break;
    }
    case "collapse_duplicates":
      numbers = { cases: 5089, events: Number(ev("duplicate_events").events ?? 180913), ...total, detail: {} };
      break;
    case "day_precision": {
      const acts = (ev("timestamp_precision").activities as { activity: string; events: number }[] | undefined) ?? [{ activity: "Create Purchase Requisition Item", events: 1140 }];
      const chosen = (params.activities as string[] | undefined) ?? acts.map((a) => a.activity);
      const events = acts.filter((a) => chosen.includes(a.activity)).reduce((s, a) => s + a.events, 0);
      numbers = { cases: events, events, ...total, detail: { activities: chosen } };
      break;
    }
    case "header_events": {
      const cases = Number(ev("header_event_replication").casesFlagged ?? 4323);
      numbers = { cases, events: cases * 3, ...total, detail: { activities: params.activities ?? ev("header_event_replication").headerEvents ?? [] } };
      break;
    }
    case "open_cases": {
      const cases = Number(ev("right_censored").cases ?? 34947);
      numbers = { cases, events: 173184, ...total, detail: { handling: params.handling ?? "censor", windowEnd: VERIFIED_WINDOW_END, closure: ["Clear Invoice"] } };
      break;
    }
    case "zero_exposure": {
      const cases = Number(ev("zero_exposure").cases ?? 16378);
      numbers = { cases, events: 0, ...total, detail: { handling: params.handling ?? "exclude" } };
      break;
    }
    default:
      numbers = { cases: 251734, events: 0, ...total, detail: { rules: params.rules ?? [], default: params.default ?? "other" } };
  }
  return { kind, params, readinessItem: spec.item, label: spec.label, preview: numbers as unknown as Record<string, unknown>, caseTableId, version };
}

/** The readiness report after a decision: the item becomes informational and names the decision. */
export function readinessAfterDecision(readiness: Readiness, kind: string, preview: DecisionPreviewOut): Readiness {
  const numbers = preview.preview as unknown as DecisionPreviewNumbers;
  const items = (readiness.items ?? []).map((i) => (i.id === preview.readinessItem ? { ...i, level: "info" as const, message: `Decided (${preview.label.toLowerCase()}): ${numbers.cases.toLocaleString("en")} cases and ${numbers.events.toLocaleString("en")} events affected.`, evidence: { ...(i.evidence ?? {}), decision: kind }, decision: null } : i));
  const status = items.some((i) => i.level === "fail") ? "fail" : items.some((i) => i.level === "warn") ? "warn" : "pass";
  return { ...readiness, status, items };
}

export function decisionRecord(id: string, ct: CaseTable, next: CaseTable, preview: DecisionPreviewOut, body: { note?: string | null; author?: string | null }): Decision {
  return {
    id,
    projectId: "p2p2018",
    caseTableId: ct.id,
    kind: preview.kind,
    params: preview.params,
    readinessItem: preview.readinessItem,
    version: preview.version,
    mappingId: next.mappingId ?? "map_3",
    resultCaseTableId: next.id,
    preview: preview.preview,
    author: body.author ?? "u.jessen",
    note: body.note ?? null,
    createdAt: new Date().toISOString(),
  };
}
