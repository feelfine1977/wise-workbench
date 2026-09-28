import { beforeEach, describe, expect, it } from "vitest";
import type { FlowGraph } from "@wise/flow";
import { activityReferenceScope, readActivityReferences, readLabelPreferences, saveActivityReferences, saveLabelPreferences } from "./activityLabels";

const graph = (ids: string[]): FlowGraph => ({ nodes: ids.map((id) => ({ id, kind: "activity", label: `Change ${id}` })), edges: [] });
beforeEach(() => window.localStorage.clear());

describe("activity identity across views", () => {
  it("uses the same dictionary across project runs and flow scopes", () => {
    expect(activityReferenceScope("/p/project/runs/run/flow")).toBe("/p/project");
    expect(activityReferenceScope("/p/project/runs/run/slices/company")).toBe("/p/project");
    expect(activityReferenceScope("/p/project/runs/another/flow")).toBe(activityReferenceScope("/p/project/runs/run/flow"));
  });
  it("retains references when a flow scope is assessed in a different run", () => {
    const all = readActivityReferences(graph(["b", "c"]), activityReferenceScope("/p/scopes/runs/all/flow"));
    const scope = readActivityReferences(graph(["c"]), activityReferenceScope("/p/scopes/runs/subset/flow"));
    expect(scope.c).toBe(all.c);
  });
  it("does not renumber a surviving activity when filters remove earlier activities", () => {
    const all = readActivityReferences(graph(["price", "quantity", "receipt"]), "run");
    saveActivityReferences("run", all);
    const subset = readActivityReferences(graph(["receipt"]), "run");
    expect(subset.receipt).toBe(all.receipt);
    saveActivityReferences("run", subset);
    const expanded = readActivityReferences(graph(["approval", "receipt", "quantity", "price"]), "run");
    expect(expanded.price).toBe(all.price);
    expect(expanded.quantity).toBe(all.quantity);
    expect(expanded.receipt).toBe(all.receipt);
    expect(new Set(Object.values(expanded)).size).toBe(Object.keys(expanded).length);
  });
  it("restores explicit display preferences and ignores invalid stored modes", () => {
    expect(readLabelPreferences()).toEqual({ mode: "names", showCounts: true });
    saveLabelPreferences({ mode: "ids", showCounts: false });
    expect(readLabelPreferences()).toEqual({ mode: "ids", showCounts: false });
    window.localStorage.setItem("wise.map.labels.v1", '{"mode":"unexpected"}');
    expect(readLabelPreferences()).toEqual({ mode: "names", showCounts: true });
  });
  it("reserves distinct IDs for maps mounted before persistence effects run", () => {
    const first = readActivityReferences(graph(["price"]), "multiple-panels");
    const second = readActivityReferences(graph(["quantity"]), "multiple-panels");
    expect(first.price).not.toBe(second.quantity);
    expect(second.price).toBe(first.price);
    saveActivityReferences("multiple-panels", first);
    expect(readActivityReferences(graph(["quantity"]), "multiple-panels").quantity).toBe(second.quantity);
  });
});
