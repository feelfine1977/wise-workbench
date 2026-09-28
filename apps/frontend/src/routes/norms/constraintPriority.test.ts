import { describe, expect, it } from "vitest";
import type { ConstraintRelevance } from "@/lib/api/normRelevance";
import { constraintPriority, orderConstraints } from "./constraintPriority";
import type { Constraint } from "./Builder";
const row = (id: string, extra: Partial<ConstraintRelevance> = {}): ConstraintRelevance => ({ id, casesInScope: 100, observedCases: 100, missingActivities: [], issues: [], ...extra });
const rule = (id: string, weight = 1): Constraint => ({ id, type: "presence", layer: "l", weight, params: {} });
describe("guided evidence ordering", () => {
  it("defers missing payment and zero applicability ahead of neither supported nor unknown rules", () => {
    const docs = [rule("zero", 100), rule("payment", 90), rule("unknown"), rule("supported"), rule("partial", 100)];
    const evidence = new Map([row("zero", { casesInScope: 0, observedCases: 0 }), row("payment", { observedCases: 0, missingActivities: ["Pay"] }), row("supported"), row("partial", { missingActivities: ["Pay"] })].map(x => [x.id, x]));
    expect(orderConstraints(docs, evidence, true).map(x => x.id)).toEqual(["supported", "unknown", "partial", "payment", "zero"]);
    expect(orderConstraints(docs, evidence, false)).toEqual(docs);
    expect(docs[0]!.id).toBe("zero");
  });
  it("does not treat unknown, failed scope checks, or attribute-only rules as zero coverage", () => {
    expect(constraintPriority()).toEqual({ tier: 1, deferred: false, label: "Coverage not checked" });
    expect(constraintPriority(row("bad", { casesInScope: null, observedCases: null, issues: ["unknown attribute"] })).deferred).toBe(false);
    expect(constraintPriority(row("metric", { observedCases: null })).deferred).toBe(false);
  });
  it("uses saved importance then observed share inside an evidence tier without changing values", () => {
    const docs = [rule("small"), rule("large"), rule("important", 2)];
    const evidence = new Map([row("small", { observedCases: 1 }), row("large"), row("important", { observedCases: 3 })].map(x => [x.id, x]));
    expect(orderConstraints(docs, evidence, true).map(x => x.id)).toEqual(["important", "large", "small"]);
  });
  it("keeps absence rules available for manual inspection when their referenced event is not observed", () => {
    const noPay = row("no-pay", { observedCases: 0, missingActivities: ["Pay"] });
    expect(constraintPriority(noPay).label).toBe("No referenced activities observed");
    expect(noPay).not.toHaveProperty("passed");
  });
});


it("keeps unknown applicability separate even when activity observations are zero or missing", () => {
  const unknown = row("unknown", { casesInScope: null, observedCases: 0, missingActivities: ["Pay"] });
  expect(constraintPriority(unknown)).toEqual({ tier: 1, deferred: false, label: "Applicability unknown" });
  expect(constraintPriority(row("failed", { observedCases: 0, issues: ["Could not read activity scope"] }))).toEqual({ tier: 1, deferred: false, label: "Data issues to review" });
  expect(constraintPriority(row("attribute", { observedCases: null })).label).toBe("Activity coverage unavailable");
  expect(unknown).toEqual(row("unknown", { casesInScope: null, observedCases: 0, missingActivities: ["Pay"] }));
});


it("never treats an OR activity count covering every case as complete measurement evidence", () => {
  const partial = row("lag", { casesInScope: 100, observedCases: 100, missingActivities: ["Pay"] });
  expect(constraintPriority(partial)).toEqual({ tier: 2, deferred: true, label: "Some referenced activities not observed" });
  expect(partial.observedCases).toBe(100);
  expect(partial.missingActivities).toEqual(["Pay"]);
});
