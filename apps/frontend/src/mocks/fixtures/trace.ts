import type { Trace } from "@wise/api-schema";
import { bpic19Norm } from "./norm";
import { rng } from "./seed";

const DAY = 86_400_000;

const EVENTFUL = [
  "c_l3_invoice_to_clear_days",
  "c_l3_df1_goods_to_invoice_days",
  "c_l3_df2_goods_to_rpb_days",
  "c_l4_goods_fragmentation",
  "c_l6_change_price",
  "c_l6_change_quantity",
  "c_l4_change_approval_repeats",
  "c_l2_df1_invoice_after_goods",
  "c_l4_repeated_invoice_receipt",
  "c_l5_cancel_invoice_receipt",
  "c_l5_debit_memo",
  "c_l7_manual_touches",
  "c_l7_total_events",
];

/**
 * The constraints a case violates, derived from the case id alone so the worst-case list of a slice
 * and the trace endpoint agree without passing state between them.
 */
export function violatedFor(caseId: string): string[] {
  const r = rng(`violated:${caseId}`);
  const k = r.int(1, 4);
  const out: string[] = [];
  let guard = 0;
  while (out.length < k && guard++ < 50) {
    const pick = r.pick(EVENTFUL);
    if (!out.includes(pick) && bpic19Norm.constraints.some((c) => c.id === pick)) out.push(pick);
  }
  return out;
}

/** A P2P trace whose events carry the violated constraint ids; shaped by the case id. */
export function buildTrace(caseId: string, violated?: string[]): Trace {
  if (!violated || violated.length === 0) violated = violatedFor(caseId);
  const r = rng(`trace:${caseId}`);
  const [doc = "4507000000", item = "00010"] = caseId.split("_");
  const t0 = Date.UTC(2018, r.int(0, 10), r.int(1, 28));
  const vio = new Set(violated);
  const at = (days: number) => new Date(t0 + days * DAY).toISOString();
  const human = () => `user_${String(r.int(1, 620)).padStart(3, "0")}`;
  const ev = (activity: string, canonicalId: string, days: number, resource: string, violates: string[] = [], lifecycle = "complete") => ({
    activity,
    canonicalId,
    timestamp: at(days),
    resource,
    lifecycle,
    violates,
  });
  const events = [ev("Create Purchase Order Item", "p2p.create_po_item", 0, human())];
  const grDays = r.int(5, 25);
  events.push(ev("Record Goods Receipt", "p2p.goods_receipt", grDays, human(), []));
  if (vio.has("c_l4_goods_fragmentation")) {
    events.push(ev("Record Goods Receipt", "p2p.goods_receipt", grDays + r.int(1, 6), human(), []));
    events.push(ev("Record Goods Receipt", "p2p.goods_receipt", grDays + r.int(7, 14), human(), ["c_l4_goods_fragmentation"]));
  }
  if (vio.has("c_l6_change_price")) events.push(ev("Change Price", "p2p.change_price", r.int(1, grDays), human(), ["c_l6_change_price", ...(vio.has("c_l6_high_exposure_price_change") ? ["c_l6_high_exposure_price_change"] : [])]));
  if (vio.has("c_l6_change_quantity")) events.push(ev("Change Quantity", "p2p.change_quantity", r.int(1, grDays), human(), ["c_l6_change_quantity"]));
  if (vio.has("c_l4_change_approval_repeats")) {
    events.push(ev("Change Approval for Purchase Order", "p2p.change_approval", r.int(1, 4), human(), []));
    events.push(ev("Change Approval for Purchase Order", "p2p.change_approval", r.int(5, 9), human(), ["c_l4_change_approval_repeats"]));
  }
  const invBefore = vio.has("c_l2_df1_invoice_after_goods");
  const invDays = invBefore ? Math.max(1, grDays - r.int(2, 8)) : grDays + (vio.has("c_l3_df1_goods_to_invoice_days") ? r.int(25, 60) : r.int(1, 9));
  events.push(ev("Vendor creates invoice", "p2p.vendor_invoice", invDays - 1, "batch_06", []));
  events.push(ev("Record Invoice Receipt", "p2p.invoice_receipt", invDays, human(), [...(invBefore ? ["c_l2_df1_invoice_after_goods"] : []), ...(vio.has("c_l3_df1_goods_to_invoice_days") ? ["c_l3_df1_goods_to_invoice_days"] : [])]));
  if (vio.has("c_l4_repeated_invoice_receipt")) events.push(ev("Record Invoice Receipt", "p2p.invoice_receipt", invDays + r.int(2, 10), human(), ["c_l4_repeated_invoice_receipt"]));
  if (vio.has("c_l5_cancel_invoice_receipt")) events.push(ev("Cancel Invoice Receipt", "p2p.cancel_invoice_receipt", invDays + r.int(1, 5), human(), ["c_l5_cancel_invoice_receipt"]));
  if (vio.has("c_l5_debit_memo")) events.push(ev("Vendor creates debit memo", "p2p.debit_memo", invDays + r.int(3, 20), "batch_06", ["c_l5_debit_memo", ...(vio.has("c_l6_high_exposure_memo") ? ["c_l6_high_exposure_memo"] : [])]));
  if (vio.has("c_l2_df2_release_after_goods") || vio.has("c_l3_df2_goods_to_rpb_days")) events.push(ev("Remove Payment Block", "p2p.remove_payment_block", grDays + r.int(12, 30), human(), [...(vio.has("c_l3_df2_goods_to_rpb_days") ? ["c_l3_df2_goods_to_rpb_days"] : [])]));
  const clearDays = invDays + (vio.has("c_l3_invoice_to_clear_days") ? r.int(45, 140) : r.int(5, 28));
  if (!vio.has("c_l1_clear_invoice_present")) events.push(ev("Clear Invoice", "p2p.clear_invoice", clearDays, "batch_02", vio.has("c_l3_invoice_to_clear_days") ? ["c_l3_invoice_to_clear_days"] : []));
  if (vio.has("c_l7_manual_touches") || vio.has("c_l7_total_events")) {
    for (let i = 0; i < 4; i++) events.push(ev("Change Delivery Indicator", "p2p.change_delivery_indicator", r.int(1, clearDays), human(), i === 3 ? ["c_l7_manual_touches", ...(vio.has("c_l7_total_events") ? ["c_l7_total_events"] : [])] : []));
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  // attach constraints that have no natural event to the last event so the trace still shows them
  const seen = new Set(events.flatMap((e) => e.violates));
  const rest = violated.filter((v) => !seen.has(v));
  if (rest.length && events.length) events[events.length - 1]!.violates.push(...rest);
  return {
    caseId,
    attributes: {
      "case Purchasing Document": doc,
      "case Item": item,
      "case Vendor": `vendorID_${String(r.int(1, 1999)).padStart(4, "0")}`,
      "case Company": `companyID_000${r.int(0, 3)}`,
      "case Spend area text": r.pick(["Packaging", "Logistics", "Facilities", "Marketing", "IT"]),
      "case Item Type": r.pick(["Standard", "Service", "Consignment"]),
      flow_type: invBefore ? "DF2" : "DF1",
      exposure: r.int(120, 48000),
    },
    events,
  };
}
