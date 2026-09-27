import { expect, it } from "vitest";
import { flowTypeDefinition } from "./flowTypeDefinition";
it("reads dataset-defined categories without interpreting them as recorded event order", () => {
  expect(flowTypeDefinition({ attr: "Category", eq: "3-way match, invoice before GR" })).toEqual({ attribute: "Category", value: "3-way match, invoice before GR" });
  expect(flowTypeDefinition({ attr: "Channel", in: ["Online", "EDI"] })).toEqual({ attribute: "Channel", value: "Online or EDI" });
});
it("does not simplify away additional conditions or invent a definition", () => {
  for (const rule of [null, {}, { all: [{ attr: "A", eq: "B" }] }, { attr: "A", eq: "B", has: "C" }, { attr: "A", in: [] }, { attr: "A", in: [42] }]) expect(flowTypeDefinition(rule)).toBeUndefined();
});
