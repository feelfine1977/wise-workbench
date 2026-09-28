import { expect, it } from "vitest";
import { comparableThresholds } from "./NormThresholdChanges";
import type { NormDocument } from "./normAuthoring";
const source: NormDocument = { constraints: [{ id: "lag", type: "lag", layer: "time", params: { a: ["Start"], b: ["End"], delta: 10, width: 3, unit: "D" } }] };
const target: NormDocument = { constraints: [{ ...source.constraints![0]!, params: { ...source.constraints![0]!.params, delta: 12 } }] };
it("only connects thresholds with identical measurement and scope definitions", () => {
  expect(comparableThresholds(source, target)).toHaveLength(1);
  for (const params of [{ unit: "H" }, { b: ["Other"] }, { missing_b: "skip" }, { delta: Infinity }]) {
    expect(comparableThresholds(source, { constraints: [{ ...target.constraints![0]!, params: { ...target.constraints![0]!.params, ...params } }] })).toHaveLength(0);
  }
  expect(comparableThresholds(source, { constraints: [{ ...target.constraints![0]!, applicability: { flow_type: ["A"] } }] })).toHaveLength(0);
  expect(comparableThresholds(source, { ...target, derived_attributes: [{ name: "different", kind: "lag" }] })).toHaveLength(0);
  expect(comparableThresholds(source, source)).toHaveLength(0);
});
