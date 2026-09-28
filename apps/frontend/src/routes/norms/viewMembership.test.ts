import { expect, it } from "vitest";
import { generalBenchmarkName, layerTotal, rawViewWeights, setViewConstraintIncluded, setViewLayerWeight, withGeneralBenchmark } from "./viewMembership";
import type { NormDocument } from "./normAuthoring";
const norm: NormDocument = { layers: [{ id: "a", name: "A" }, { id: "b", name: "B" }], constraints: [
  { id: "a1", layer: "a", type: "presence", params: {}, weight: 9 }, { id: "a2", layer: "a", type: "presence", params: {}, weight: 1 }, { id: "b1", layer: "b", type: "presence", params: {} },
], views: [{ name: "Ops", layer_weights: { a: 4, b: 1 } }, { name: "Finance", constraint_weights: { a1: 2, b1: 1 } }] };
it("removes only the selected-view membership, preserves the layer total and restores the constraint", () => {
  const before = structuredClone(norm); const ops = norm.views![0]!;
  const removed = setViewConstraintIncluded(norm, ops, "a1", false);
  expect(rawViewWeights(norm, removed)).toEqual({ a1: 0, a2: 4, b1: 1 });
  expect(layerTotal(norm, removed, "a")).toBe(4);
  expect(rawViewWeights(norm, setViewConstraintIncluded(norm, removed, "a1", true))).toEqual({ a1: 3.6, a2: .4, b1: 1 });
  expect(norm).toEqual(before);
});
it("toggles a whole layer in direct and layer-based views without changing another layer", () => {
  const direct = setViewLayerWeight(norm, norm.views![1]!, "a", 0);
  expect(rawViewWeights(norm, direct)).toEqual({ a1: 0, a2: 0, b1: 1 });
  expect(layerTotal(norm, setViewLayerWeight(norm, direct, "a", 1), "a")).toBe(1);
  expect(setViewLayerWeight(norm, norm.views![0]!, "a", 0).layer_weights).toEqual({ a: 0, b: 1 });
});
it("generates an equal-layer union, protects a user's General name and is idempotent", () => {
  const next = withGeneralBenchmark(norm); const name = generalBenchmarkName(next)!;
  expect(rawViewWeights(next, next.views!.find(v => v.name === name)!)).toEqual({ a1: .5, a2: .5, b1: 1 });
  expect(withGeneralBenchmark(next)).toEqual(next);
  expect(generalBenchmarkName(withGeneralBenchmark({ ...norm, views: [{ ...norm.views![0]!, name: "General" }] }))).toBe("General benchmark");
});
