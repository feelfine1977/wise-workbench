import { describe, expect, it } from "vitest";
import { abstract, buildScales, defaultStyle, MAP_TARGET, type FlowGraph } from "@wise/flow";
import { describeEdge, describeNode } from "@wise/flow/react";
import { constraintEvidence, observedProcessGraph, overlaysForConstraint, overlaysForConstraints } from "./sceneEvidence";

function graph(): FlowGraph {
  return {
    nodes: ["a", "b"].map((id) => ({ id, kind: "activity", label: id, metrics: { cases: 100 } })),
    edges: [
      { id: "route", kind: "follows", source: "a", target: "b", metrics: { count: 40, cases: 30 } },
      { id: "repeat", kind: "follows", source: "a", target: "a", metrics: { count: 120, cases: 10 } },
      { id: "flow", kind: "flow", source: "b", target: "a" },
      { id: "rule-edge", kind: "constraint", source: "b", target: "a" },
    ],
    overlays: [
      { kind: "arc", target: "rule-edge", payload: { constraintId: "order", source: "b", target: "a", value: 0.8 } },
      { kind: "badge", target: "a", payload: { constraintId: "repeat", value: 0.1 } },
      { kind: "chip", target: MAP_TARGET, payload: { constraintId: "global" } },
    ],
    meta: { constraints: [
      { description: { id: "order", label: "Invoice order", description: "A purchase order must precede the invoice." }, stats: { evaluated: 40, violationShare: 0.4 } },
      { description: { id: "repeat", label: "One receipt" }, stats: { evaluated: 100, violationShare: 0.1 } },
      { description: { id: "unmapped", label: "Missing activity" }, stats: { evaluated: 0, violationShare: 1 } },
      { description: { id: "global", label: "Case measure" }, stats: { evaluated: 15, violationShare: 0 } },
    ] },
  };
}

describe("observed process and WISE evidence separation", () => {
  it("removes aggregate violation metrics from accessible labels while preserving observations and scoped evidence", () => {
    const input = graph();
    input.nodes[0]!.metrics = { cases: 100, events: 180, share: 0.8, eventsPerCase: 1.8, starts: 0, violationShare: 0.52, a_violationShare: 0.6, delta_violationShare: -0.08 };
    input.edges[0]!.metrics = { count: 40, cases: 30, share: 0.3, medianLagHours: 24, p90LagHours: 48, violationShare: 0.52, violation_share: 0.52, shareViolated: 0.52, meanViolation: 0.3 };
    const before = structuredClone(input);
    expect(describeNode(input.nodes[0]!, [], "en")).toMatch(/expectation shortfall/);
    const observed = observedProcessGraph(input);
    expect(observed.nodes[0]!.metrics).toEqual({ cases: 100, events: 180, share: 0.8, eventsPerCase: 1.8, starts: 0 });
    expect(observed.edges[0]!.metrics).toEqual({ count: 40, cases: 30, share: 0.3, medianLagHours: 24, p90LagHours: 48 });
    expect(describeNode(observed.nodes[0]!, [], "en")).not.toMatch(/expectation shortfall/);
    expect(describeEdge(observed.edges[0]!, observed, "en")).not.toMatch(/expectation shortfall/);
    // Turning on one rule adds its own evidence, never the old aggregate node metric.
    const selected = overlaysForConstraint(input, observed, "order");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.payload?.value).toBe(0.8);
    expect(constraintEvidence(input)[0]).toMatchObject({ evaluated: 40, violationShare: 0.4 });
    expect(input).toEqual(before);
  });

  it("excludes constraint edges and overlays without mutating inputs or losing observed loops", () => {
    const input = graph();
    const before = structuredClone(input);
    const observed = observedProcessGraph(input);
    expect(observed.edges.map((e) => e.id)).toEqual(["route", "repeat", "flow"]);
    expect(observed.overlays).toEqual([]);
    expect(input).toEqual(before);
    const scales = buildScales(observed, { ...defaultStyle, edgeColor: undefined });
    expect(scales.edgeWidth(observed.edges[1]!)).toBeGreaterThan(scales.edgeWidth(observed.edges[0]!));
  });

  it("keeps a chosen arc through the library abstraction without creating an observed edge", () => {
    const input = graph();
    const observed = observedProcessGraph(input);
    const overlays = overlaysForConstraint(input, observed, "order");
    const rendered = abstract({ ...observed, overlays }, { minEdgeShare: 0, minNodeShare: 0 });
    expect(rendered.overlays).toEqual(overlays);
    expect(overlays).toHaveLength(1);
    expect(rendered.edges.some((e) => e.kind === "constraint")).toBe(false);
    expect(overlaysForConstraint(input, { ...observed, nodes: observed.nodes.slice(0, 1) }, "order")).toEqual([]);
    expect(overlaysForConstraint(input, observed)).toEqual([]);
    expect(overlaysForConstraint(input, observed, "global")[0]?.target).toBe(MAP_TARGET);
  });

  it("offers constraints without drawable endpoints and preserves their own evaluated denominator", () => {
    const choices = constraintEvidence(graph());
    expect(choices.map((c) => c.id)).toEqual(["order", "repeat", "global", "unmapped"]);
    expect(choices[0]).toMatchObject({ name: "Invoice order", evaluated: 40, violationShare: 0.4 });
    expect(choices[3]).toMatchObject({ evaluated: 0, violationShare: 1 });
    expect(overlaysForConstraint(graph(), observedProcessGraph(graph()), "unmapped")).toEqual([]);
  });

  it("does not relabel a raw overlay value as WISE violation or invent an evaluated denominator", () => {
    const input = graph();
    input.meta = { cases: 999 };
    const choice = constraintEvidence(input).find((c) => c.id === "order");
    expect(choice?.violationShare).toBeUndefined();
    expect(choice?.evaluated).toBeUndefined();
    expect(overlaysForConstraint(input, observedProcessGraph(input), "order")[0]?.payload?.displayLabel).toBe("WISE result unavailable");
  });

  it("labels arcs from the selected WISE result and preserves original payloads", () => {
    const input = graph();
    const before = structuredClone(input);
    const arc = overlaysForConstraint(input, observedProcessGraph(input), "order")[0];
    expect(arc?.payload).toMatchObject({ value: 0.8, displayLabel: "40.0% miss constraint" });
    expect(input).toEqual(before);
  });

  it("rejects invalid shares and counts instead of rendering plausible results", () => {
    const input = graph();
    input.overlays = [];
    input.meta = { cases: 10, constraints: [{ description: { id: "invalid" }, stats: { evaluated: -1, violationShare: 1.2, meanViolation: NaN } }] };
    expect(constraintEvidence(input)[0]).toMatchObject({ cases: 10, evaluated: undefined, violationShare: undefined, meanViolation: undefined });
  });
});


it("keeps each selected constraint's own overlay and denominator, including shared endpoints and case-only results", () => {
  const input = graph();
  input.overlays!.push({ kind: "arc", target: "another-rule", payload: { constraintId: "repeat", source: "b", target: "a", value: 0.1 } });
  const before = structuredClone(input);
  const observed = observedProcessGraph(input);
  const selected = overlaysForConstraints(input, observed, ["order", "repeat", "global", "unmapped", "repeat"]);
  expect(selected).toHaveLength(4);
  expect(selected.filter((overlay) => overlay.kind === "arc").map((overlay) => overlay.payload?.displayLabel)).toEqual(["40.0% miss constraint", "10.0% miss constraint"]);
  expect(constraintEvidence(input).filter((constraint) => ["order", "repeat"].includes(constraint.id)).map((constraint) => constraint.evaluated)).toEqual([40, 100]);
  expect(overlaysForConstraints(input, observed, [])).toEqual([]);
  expect(input).toEqual(before);
});


it("uses supplied business layer names ahead of bundled names, including bare layer ids and report patterns", () => {
  const input = graph();
  input.overlays = [];
  input.meta = { layers: [{ id: "L3", name: "Agreed payment deadlines" }], constraints: [
    { description: { id: "custom", layer: "L3" } },
    { description: { id: "timing", layer: "L3_timeliness_ageing" } },
    { description: { id: "closure", layer: "L1" } },
    { description: { id: "settlement", layer: "RP_settlement" } },
  ] };
  const names = Object.fromEntries(constraintEvidence(input).map((constraint) => [constraint.id, constraint.layerName]));
  expect(names).toEqual({ custom: "Agreed payment deadlines", timing: "Handovers and ageing", closure: "Layer L1", settlement: "Settlement review candidates" });
  input.meta.layers = { RP_settlement: { name: "Treasury settlement checks" } };
  expect(constraintEvidence(input).find((constraint) => constraint.id === "settlement")?.layerName).toBe("Treasury settlement checks");
});
