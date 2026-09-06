import { describe, expect, it } from "vitest";
import { buildBacklog, keyOf, pageBacklog } from "./fixtures/backlog";
import { buildDistribution } from "./fixtures/distribution";
import { buildFlow } from "./fixtures/flow";
import { buildSlice } from "./fixtures/slice";
import { buildTrace } from "./fixtures/trace";
import { tableColumn } from "@/lib/utils";

const VENDOR = "case Vendor";
const COMPANY_SPEND = "case Company+case Spend area text";

describe("mock backlog", () => {
  const { rows, globalMean } = buildBacklog(VENDOR, "Finance", 50, 20);

  it("has about 60 vendor slices with the library's columns and the plain fields", () => {
    expect(rows.length).toBeGreaterThanOrEqual(55);
    for (const r of rows) {
      expect(r).toMatchObject({ key: expect.any(String), n_cases: expect.any(Number), mean_score: expect.any(Number), gap: expect.any(Number), stable_gap: expect.any(Number), PI: expect.any(Number), stable_PI: expect.any(Number), rank: expect.any(Number), n_ranked: rows.length, global_mean: globalMean });
      expect(r.keys).toEqual({ [VENDOR]: JSON.parse(r.key)[0] });
      expect(r.reading).toContain(`${r.n_cases.toLocaleString("en")} cases`);
      if (r.hotspot_type) expect(r.kind).toBe({ severity: "acute", mechanism: "systematic", reservoir: "widespread" }[r.hotspot_type]);
      if (r.dominant_layer) expect(r.dominant_layer_name && r.top_constraint && r.top_constraint_description).toBeTruthy();
    }
  });
  it("carries the design panel's vendor example in the Finance view", () => {
    const v = (k: string) => rows.find((r) => r.key === keyOf([k]));
    expect(v("vendorID_0128")).toMatchObject({ n_cases: 945, gap: 0.18 });
    expect(v("vendorID_0128")?.PI).toBeCloseTo(170.1, 1);
    expect(v("vendorID_0093")?.PI).toBeCloseTo(61.7, 1);
  });
  it("reproduces Table XI by company × spend area (Automation, γ = 20): stable PI 945.7 / 294.2 / 50.6 at ranks 1, 2, 5", () => {
    const { rows: cs } = buildBacklog(COMPANY_SPEND, "Automation", 20, 1);
    const ranked = [...cs].sort((a, b) => a.rank - b.rank);
    expect(ranked[0]?.key).toBe(keyOf(["companyID_0000", "Packaging"]));
    expect(ranked[0]?.n_cases).toBe(109199);
    expect(ranked[0]?.stable_PI).toBeCloseTo(945.7, 1);
    expect(ranked[0]?.kind).toBe("widespread");
    expect(ranked[1]?.key).toBe(keyOf(["companyID_0000", "Logistics"]));
    expect(ranked[1]?.stable_PI).toBeCloseTo(294.2, 1);
    expect(ranked[4]?.key).toBe(keyOf(["companyID_0003", "Real Estate"]));
    expect(ranked[4]?.stable_PI).toBeCloseTo(50.6, 1);
  });
  it("applies the shrinkage form stable_gap = n/(n+γ)·gap and PI = n·gap", () => {
    for (const r of rows) {
      expect(r.PI).toBeCloseTo(r.n_cases * r.gap, 3);
      expect(r.stable_gap).toBeCloseTo((r.n_cases / (r.n_cases + 50)) * r.gap, 5);
      expect(r.gap).toBeCloseTo(Math.max(0, globalMean - r.mean_score), 5);
    }
  });
  it("types the top slices: one widespread, one acute, the rest systematic", () => {
    const typed = rows.filter((r) => r.kind);
    expect(typed.length).toBeGreaterThanOrEqual(3);
    expect(typed.filter((r) => r.kind === "widespread")).toHaveLength(1);
    expect(typed.filter((r) => r.kind === "acute")).toHaveLength(1);
    expect(rows.every((r) => ["stable", "fragile", "insufficient_support", "unknown"].includes(r.stability ?? ""))).toBe(true);
  });
  it("filters by kind (or the method's hotspot type), sorts and paginates server-side", () => {
    const page = pageBacklog(rows, globalMean, { slicing: VENDOR, view: "Finance", gamma: 50, minCases: 20, sort: "-stable_PI", kind: "systematic", page: 1, pageSize: 5 });
    expect(page.rows.length).toBeLessThanOrEqual(5);
    expect(page.rows.every((r) => r.kind === "systematic")).toBe(true);
    for (let i = 1; i < page.rows.length; i++) expect(page.rows[i - 1]!.stable_PI).toBeGreaterThanOrEqual(page.rows[i]!.stable_PI);
    const alias = pageBacklog(rows, globalMean, { slicing: VENDOR, view: "Finance", gamma: 50, minCases: 20, sort: "-stable_PI", hotspotType: "mechanism", page: 1, pageSize: 5 });
    expect(alias.rows.map((r) => r.key)).toEqual(page.rows.map((r) => r.key));
    const q = pageBacklog(rows, globalMean, { slicing: VENDOR, view: "Finance", gamma: 50, minCases: 20, sort: "key", q: "0128", page: 1, pageSize: 50 });
    expect(q.rows.map((r) => r.key)).toContain(keyOf(["vendorID_0128"]));
    expect(page.maxStablePI).toBe(Math.max(...rows.map((r) => r.stable_PI)));
  });
});

describe("mock slice detail", () => {
  const { rows, globalMean } = buildBacklog(VENDOR, "Finance", 50, 20);
  it("has expectation contributions that sum exactly to the gap, and layer deltas too", () => {
    for (const row of rows.slice(0, 15)) {
      const d = buildSlice(row, VENDOR, "Finance", globalMean);
      const deltas = tableColumn<number>(d.drivers, "delta_gap");
      expect(deltas.reduce((s, v) => s + v, 0)).toBeCloseTo(row.gap, 9);
      expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
      const layerDeltas = tableColumn<number>(d.layers, "delta");
      expect(layerDeltas.reduce((s, v) => s + v, 0)).toBeCloseTo(row.gap, 9);
      expect(d.layers.columns).toEqual(["layer", "slice_mean", "global_mean", "delta"]);
      expect(d.worstCases?.length).toBeGreaterThan(0);
      expect(d.reading).toContain("Expectations behind the shortfall:");
    }
  });
  it("gives a penalty Pareto keyed by `key` whose shares cumulate to one", () => {
    const d = buildSlice(rows[0]!, VENDOR, "Finance", globalMean);
    expect(d.penaltyMass.columns[0]).toBe("key");
    expect(d.penaltyMassBy).toBe("case Spend area text");
    const cum = tableColumn<number>(d.penaltyMass, "cum_share");
    expect(cum[cum.length - 1]).toBeCloseTo(1, 3);
  });
});

describe("mock trace, distribution and flow", () => {
  it("marks violated constraints on events", () => {
    const t = buildTrace("4507012345_00010", ["c_l3_invoice_to_clear_days", "c_l6_change_price"]);
    const violated = new Set((t.events ?? []).flatMap((e) => e.violates ?? []));
    expect(violated.has("c_l3_invoice_to_clear_days")).toBe(true);
    expect(violated.has("c_l6_change_price")).toBe(true);
    const ts = (t.events ?? []).map((e) => e.timestamp ?? "");
    expect([...ts].sort()).toEqual(ts);
  });
  it("builds a histogram whose ECDF ends at one and carries the norm's threshold", () => {
    const d = buildDistribution("c_l3_invoice_to_clear_days");
    expect(d.threshold).toBe(30);
    expect(d.width).toBe(60);
    expect(d.unit).toBe("days");
    const last = d.ecdf?.[d.ecdf.length - 1];
    expect(last?.[1]).toBeCloseTo(1, 5);
    const n = (d.bins ?? []).reduce((s, b) => s + (b.n ?? 0), 0);
    expect(n).toBe(d.stats?.n);
  });
  it("builds a flow graph in the library's format: stage groups, metric names, overlays with payloads", () => {
    const g = buildFlow();
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.source) && ids.has(e.target), e.id).toBe(true);
    for (const o of g.overlays ?? []) expect(ids.has(o.target) || g.edges.some((e) => e.id === o.target), o.target).toBe(true);
    const activity = g.nodes.find((n) => n.label === "Record Goods Receipt");
    expect(activity?.group).toBe("receiving");
    expect(Object.keys(activity?.metrics ?? {})).toEqual(expect.arrayContaining(["cases", "events", "share", "violationShare"]));
    expect(g.groups?.map((x) => x.id)).toEqual(["ordering", "receiving", "invoicing", "payment"]);
    const arc = g.overlays?.find((o) => o.kind === "arc");
    expect(arc?.payload).toMatchObject({ constraintId: expect.any(String), value: expect.any(Number), text: expect.any(String), source: expect.any(String), target: expect.any(String) });
    const slice = buildFlow({ slicing: "case Company+case Spend area text", sliceKey: '["companyID_0000","Packaging"]' });
    expect((slice.meta as { cases: number }).cases).toBeLessThan((g.meta as { cases: number }).cases);
  });
});
