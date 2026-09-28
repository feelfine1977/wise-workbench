import { describe, expect, it } from "vitest";
import { chartSelection, calibrationSearch, scoreOn100 } from "./sliceContext";
import { flowQuery, distributionQuery } from "@/lib/queries";

const slicings = [{ id: "company-supplier", attributes: ["company", "supplier"] }];
const parent = (slicing: string, values: unknown[]) => JSON.stringify({ slicing, key: JSON.stringify(values) });
const time = { kind: "time", field: "case_start", from: "2018-01-01", to: "2018-06-30" };

describe("exact chart population", () => {
  it("keeps the date filter AND every parent dimension, then adds the current group for a full map", () => {
    const selected = chartSelection(JSON.stringify({ and: [time] }), parent("company", ["A"]), slicings);
    expect(selected).toEqual({ supported: true, filterText: JSON.stringify({ and: [time, { kind: "attribute", field: "company", in: ["A"] }] }), filter: { and: [time, { kind: "attribute", field: "company", in: ["A"] }] } });
    if (!selected.supported) throw Error("unsupported");
    const full = chartSelection(selected.filterText, parent("supplier", ["X"]), slicings);
    expect(full.supported && full.filter?.and).toEqual([time, { kind: "attribute", field: "company", in: ["A"] }, { kind: "attribute", field: "supplier", in: ["X"] }]);
    const next = chartSelection(undefined, parent("company", ["B"]), slicings);
    if (!next.supported) throw Error("unsupported");
    expect(flowQuery("p", "r", { filter: selected.filterText }).queryKey).not.toEqual(flowQuery("p", "r", { filter: next.filterText }).queryKey);
    expect(distributionQuery("p", "r", "c", "supplier", '["X"]', selected.filterText).queryKey).not.toEqual(distributionQuery("p", "r", "c", "supplier", '["X"]', next.filterText).queryKey);
  });
  it("resolves saved aliases and inline 1–3 dimensional groupings without guessing ID meaning", () => {
    expect(chartSelection(undefined, parent("company-supplier", ["A", "X"]), slicings)).toMatchObject({ supported: true, filter: { and: [{ field: "company", in: ["A"] }, { field: "supplier", in: ["X"] }] } });
    expect(chartSelection(undefined, parent('group:{"attributes":["company","supplier","region"],"bands":[]}', ["A", "X", "EU"]), slicings)).toMatchObject({ supported: true, filter: { and: [{ field: "company" }, { field: "supplier" }, { field: "region" }] } });
  });
  it.each([null, "(missing)"])("retains all native missing-key forms for %s", value => {
    expect(chartSelection(undefined, parent("company", [value]), slicings)).toMatchObject({ supported: true, filter: { and: [{ field: "company", in: ["(missing)", ""] }] } });
  });
  it.each([
    "bad JSON", "null", "{}", JSON.stringify({ slicing: "company", key: JSON.stringify(["A"]), extra: true }),
    parent("unknown-alias", ["A"]), parent("company-supplier", ["A"]), parent("company", [""]),
    parent("company", [true]), parent("company", [1]),
    parent('group:{"attributes":["amount"],"bands":[{}]}', ["0–100"]),
  ])("withholds ambiguous or unsupported parent context: %s", within => {
    expect(chartSelection(undefined, within, slicings).supported).toBe(false);
  });
  it("withholds saved banded groupings and malformed filters even without a parent", () => {
    expect(chartSelection(undefined, parent("banded", ["0–100"]), [{ id: "banded", attributes: ["amount"], bands: [{} as never] }]).supported).toBe(false);
    for (const filter of ["7", "bad", '{"and":[null]}', '{"and":[],"or":[]}']) expect(chartSelection(filter, undefined, slicings).supported).toBe(false);
  });
  it("does not discard unknown qualifiers or duplicate user clauses before server validation", () => {
    const raw = '{"and":[{"kind":"open","value":true,"unknown":1},{"kind":"open","value":true}]}';
    expect(chartSelection(raw, undefined, slicings)).toMatchObject({ supported: true, filterText: raw });
    const combined = chartSelection(raw, parent("company", ["A"]), slicings);
    expect(combined.supported && combined.filter?.and).toEqual([...JSON.parse(raw).and, { kind: "attribute", field: "company", in: ["A"] }]);
  });
});

it("recalibration preserves the saved case table/population but not flow or temporary scope", () => {
  expect(calibrationSearch({ caseTableId: "ct-original", scope: { selection_id: "selected-quarter", flow_type: "standard" } }, "rule")).toEqual({ caseTable: "ct-original", selection: "selected-quarter", tab: "constraints", constraint: "rule" });
  expect(calibrationSearch({ caseTableId: "ct-all" })).toMatchObject({ caseTable: "ct-all", selection: undefined });
});
it("uses score points, including partial penalties, without inventing a pass percentage", () => {
  expect(scoreOn100(.9)).toBe("90.0");
  expect(scoreOn100(.8356)).toBe("83.6");
  expect(scoreOn100(0)).toBe("0.0");
  expect(scoreOn100(1)).toBe("100.0");
  for (const score of [null, undefined, NaN, Infinity, -.1, 1.1]) expect(scoreOn100(score)).toBe("Unavailable");
});
