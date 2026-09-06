import type { FlowGraph } from "@wise/api-schema";
import { bpic19Norm } from "./norm";
import { rng, round } from "./seed";

interface Activity {
  id: string;
  label: string;
  stage: string;
  cases: number;
  events: number;
}

const STAGES = [
  { id: "ordering", label: "Ordering", order: 1 },
  { id: "receiving", label: "Receiving", order: 2 },
  { id: "invoicing", label: "Invoicing", order: 3 },
  { id: "payment", label: "Payment", order: 4 },
];

const ACTIVITIES: Activity[] = [
  { id: "a_create_purchase_order_item", label: "Create Purchase Order Item", stage: "ordering", cases: 251734, events: 251734 },
  { id: "a_change_price", label: "Change Price", stage: "ordering", cases: 11240, events: 12988 },
  { id: "a_change_quantity", label: "Change Quantity", stage: "ordering", cases: 8402, events: 9021 },
  { id: "a_record_goods_receipt", label: "Record Goods Receipt", stage: "receiving", cases: 234479, events: 314097 },
  { id: "a_record_service_entry_sheet", label: "Record Service Entry Sheet", stage: "receiving", cases: 22314, events: 45872 },
  { id: "a_vendor_creates_invoice", label: "Vendor creates invoice", stage: "invoicing", cases: 214920, events: 224117 },
  { id: "a_record_invoice_receipt", label: "Record Invoice Receipt", stage: "invoicing", cases: 214412, events: 228760 },
  { id: "a_cancel_invoice_receipt", label: "Cancel Invoice Receipt", stage: "invoicing", cases: 5920, events: 6312 },
  { id: "a_remove_payment_block", label: "Remove Payment Block", stage: "payment", cases: 58811, events: 61230 },
  { id: "a_clear_invoice", label: "Clear Invoice", stage: "payment", cases: 208893, events: 217480 },
];

const FOLLOWS: [string, string, number, number][] = [
  ["__start__", "a_create_purchase_order_item", 251734, 0],
  ["a_create_purchase_order_item", "a_record_goods_receipt", 180211, 12 * 24],
  ["a_create_purchase_order_item", "a_vendor_creates_invoice", 41830, 9 * 24],
  ["a_create_purchase_order_item", "a_change_price", 9800, 26],
  ["a_create_purchase_order_item", "a_record_service_entry_sheet", 18102, 15 * 24],
  ["a_change_price", "a_record_goods_receipt", 8102, 6 * 24],
  ["a_change_quantity", "a_record_goods_receipt", 6011, 5 * 24],
  ["a_create_purchase_order_item", "a_change_quantity", 7204, 30],
  ["a_record_goods_receipt", "a_record_goods_receipt", 61230, 4 * 24],
  ["a_record_goods_receipt", "a_vendor_creates_invoice", 158004, 6 * 24],
  ["a_record_service_entry_sheet", "a_vendor_creates_invoice", 17820, 7 * 24],
  ["a_vendor_creates_invoice", "a_record_invoice_receipt", 209911, 2 * 24],
  ["a_record_invoice_receipt", "a_cancel_invoice_receipt", 5920, 3 * 24],
  ["a_cancel_invoice_receipt", "a_record_invoice_receipt", 5100, 4 * 24],
  ["a_record_invoice_receipt", "a_remove_payment_block", 58811, 11 * 24],
  ["a_record_invoice_receipt", "a_clear_invoice", 132743, 36 * 24],
  ["a_remove_payment_block", "a_clear_invoice", 56102, 9 * 24],
  ["a_clear_invoice", "__end__", 208893, 0],
  ["a_record_invoice_receipt", "__end__", 14020, 0],
  ["a_record_goods_receipt", "__end__", 28821, 0],
];

const ID_BY_LABEL = Object.fromEntries(ACTIVITIES.map((a) => [a.label, a.id]));

/** A FlowGraph in the backend's shape (library metric names, stage groups, constraint overlays). */
export interface BuildFlowOptions {
  sliceKey?: string;
  slicing?: string;
  abstraction?: number;
  /** Share of the whole log the scene covers (a flow type, a filtered log); derived from the slice key when absent. */
  scale?: number;
  /** Activity id whose incoming and outgoing paths are returned in `paths` (CONTRACT_CYCLE2.md, flow additions). */
  focus?: string;
}

export function buildFlow(opts: BuildFlowOptions = {}): FlowGraph {
  const r = rng(`flow:${opts.slicing ?? ""}:${opts.sliceKey ?? "all"}`);
  const scale = opts.scale ?? (opts.sliceKey ? r.range(0.002, 0.05) : 1);
  const shift = opts.sliceKey ? r.range(1.1, 1.8) : 1;
  const abstraction = opts.abstraction ?? 0.05;
  const totalCases = Math.round(251734 * scale);
  const shares: Record<string, { shareViolated: number; meanViolation: number; casesEvaluated: number }> = {};
  for (const c of bpic19Norm.constraints) {
    const base = rng(`vio:${c.id}`).range(0.02, 0.6);
    const share = Math.min(0.99, round(base * shift, 4));
    shares[c.id] = { shareViolated: share, meanViolation: round(share * 0.8, 4), casesEvaluated: Math.round(totalCases * rng(`ev:${c.id}`).range(0.4, 1)) };
  }
  const violationOf: Record<string, number> = {};
  for (const c of bpic19Norm.constraints) {
    const acts = [...(c.params.activity as string[] | undefined) ?? [], ...((c.params.a as string[] | undefined) ?? []), ...((c.params.b as string[] | undefined) ?? [])];
    for (const a of acts) violationOf[a] = Math.max(violationOf[a] ?? 0, shares[c.id]!.shareViolated);
  }
  const kept = ACTIVITIES.filter((a) => a.cases / 251734 >= abstraction);
  const keptIds = new Set(kept.map((a) => a.id));
  const nodes: FlowGraph["nodes"] = [
    { id: "__start__", kind: "event", label: "start", metrics: { cases: totalCases, share: 1 }, tags: ["start"] },
    { id: "__end__", kind: "event", label: "end", metrics: { cases: totalCases, share: 1 }, tags: ["end"] },
    ...kept.map((a) => ({
      id: a.id,
      kind: "activity" as const,
      label: a.label,
      group: a.stage,
      metrics: {
        events: Math.round(a.events * scale),
        cases: Math.round(a.cases * scale),
        share: round(a.cases / 251734, 4),
        caseShare: round(a.cases / 251734, 4),
        eventsPerCase: round(a.events / a.cases, 3),
        violationShare: violationOf[a.label] ?? 0,
      },
      tags: [],
    })),
  ];
  const edges: FlowGraph["edges"] = FOLLOWS.filter(([s, t, n]) => (s === "__start__" || keptIds.has(s)) && (t === "__end__" || keptIds.has(t)) && n / 251734 >= abstraction).map(([s, t, n, hours]) => ({
    id: `f_${s.replace("__", "")}__${t.replace("__", "")}`,
    kind: "follows" as const,
    source: s,
    target: t,
    metrics: { count: Math.round(n * scale * 1.05), cases: Math.round(n * scale), share: round(n / 251734, 4), caseShare: round(n / 251734, 4), ...(hours ? { medianLagHours: hours, medianHours: hours } : {}) },
    tags: s === t ? ["selfLoop"] : s === "__start__" ? ["start"] : t === "__end__" ? ["end"] : [],
  }));
  const overlays: FlowGraph["overlays"] = [];
  const constraintsMeta: { description: Record<string, unknown>; stats: Record<string, unknown> }[] = [];
  for (const c of bpic19Norm.constraints) {
    const share = shares[c.id]!;
    const payload: Record<string, unknown> = {
      constraintId: c.id,
      constraintType: c.type,
      type: c.type,
      layer: c.layer,
      label: c.id,
      description: c.description,
      value: share.shareViolated,
      coverage: round(share.casesEvaluated / totalCases, 4),
      text: `${(c.description ?? c.id).replace(/\.$/, "")} — missed in ${Math.round(share.shareViolated * 100)} % of ${share.casesEvaluated.toLocaleString("en")} evaluated cases`,
      ...share,
    };
    const ids = (v: unknown) => ((v as string[] | undefined) ?? []).map((l) => ID_BY_LABEL[l]).filter((id): id is string => !!id && keptIds.has(id));
    const activities = ids(c.params.activity);
    const description: Record<string, unknown> = { id: c.id, type: c.type, label: c.id, layer: c.layer, description: c.description, activities, params: {} };
    if (c.type === "lag" || c.type === "precedence") {
      const a = ids(c.params.a);
      const b = ids(c.params.b);
      description.a = a;
      description.b = b;
      if (c.type === "lag") Object.assign(payload, { glyph: "⇒", threshold: c.params.delta, width: c.params.width, unit: c.params.unit });
      else Object.assign(payload, { glyph: "⇒", threshold: c.params.k, width: c.params.K });
      for (const s of a)
        for (const t of b) {
          const eid = `c_${c.id}__${s}__${t}`;
          edges.push({ id: eid, kind: "constraint", source: s, target: t, metrics: { ...share }, tags: [c.type], payload: { ...payload, source: s, target: t } });
          overlays.push({ kind: "arc", target: eid, payload: { ...payload, source: s, target: t } });
        }
    } else if (c.type === "exclusion") {
      Object.assign(payload, { glyph: "∅", threshold: 0 });
      for (const a of activities) overlays.push({ kind: "hatch", target: a, payload });
    } else if (c.type === "presence" || c.type === "singularity") {
      Object.assign(payload, c.type === "presence" ? { glyph: `≥${c.params.m ?? 1}`, threshold: c.params.m ?? 1 } : { glyph: `≤${c.params.k}`, threshold: c.params.k, width: c.params.K });
      for (const a of activities) overlays.push({ kind: "badge", target: a, payload });
    }
    if (share.shareViolated) for (const a of activities) overlays.push({ kind: "tint", target: a, payload: { constraintId: c.id, label: c.id, value: share.shareViolated, shareViolated: share.shareViolated } });
    constraintsMeta.push({ description, stats: { cases: totalCases, evaluated: share.casesEvaluated, violationShare: share.shareViolated, coverage: payload.coverage, meanViolation: share.meanViolation } });
  }
  const groups: FlowGraph["groups"] = STAGES.filter((s) => kept.some((a) => a.stage === s.id)).map((s) => ({ id: s.id, kind: "stage" as const, label: s.label }));
  const paths = opts.focus
    ? {
        incoming: FOLLOWS.filter(([, t]) => t === opts.focus && keptIds.has(t)).map(([s, , n, hours]) => ({ from: s, count: Math.round(n * scale * 1.05), cases: Math.round(n * scale), median_lag: hours ? round(hours / 24, 2) : null, violation_share: round(violationOf[ACTIVITIES.find((a) => a.id === s)?.label ?? ""] ?? 0, 4) })),
        outgoing: FOLLOWS.filter(([s]) => s === opts.focus && keptIds.has(s)).map(([, t, n, hours]) => ({ to: t, count: Math.round(n * scale * 1.05), cases: Math.round(n * scale), median_lag: hours ? round(hours / 24, 2) : null, violation_share: round(violationOf[ACTIVITIES.find((a) => a.id === t)?.label ?? ""] ?? 0, 4) })),
      }
    : undefined;
  return {
    nodes,
    edges,
    groups,
    overlays,
    ...(opts.focus ? { focus: opts.focus, paths } : {}),
    meta: {
      runId: "run_41",
      slicing: opts.slicing ? opts.slicing.split("+") : null,
      sliceKey: opts.sliceKey ? (JSON.parse(opts.sliceKey) as unknown) : null,
      process: "p2p",
      abstraction,
      cases: totalCases,
      events: Math.round(1595923 * scale),
      nodesTotal: 42,
      edgesTotal: 498,
      constraintsWithoutNodes: ["c_l6_high_exposure_memo", "c_l6_high_exposure_price_change", "c_l7_manual_touches", "c_l7_distinct_human_resources", "c_l7_total_events", "c_l7_manual_share", "c_l6_networth_volatility"],
      stages: STAGES,
      stagedActivities: kept.length,
      constraints: constraintsMeta,
    },
  };
}
