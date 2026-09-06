import { describe, expect, it } from "vitest";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { BACKLOG_DEFAULTS, parseSearch, stringifySearch, stripBacklogDefaults, validateBacklogSearch, validateSliceSearch } from "./search";

const input = (v: Record<string, unknown>) => v as unknown as Parameters<typeof validateBacklogSearch>[0] & SearchSchemaInput;

describe("typed search params", () => {
  it("fills defaults and rejects unknown values", () => {
    const s = validateBacklogSearch(input({ slicing: "case Vendor", kind: "bogus", sort: "-nope", page: "3", pageSize: 5000, tab: "nope" }));
    expect(s.slicing).toBe("case Vendor");
    expect(s.kind).toBeUndefined();
    expect(s.sort).toBe(BACKLOG_DEFAULTS.sort);
    expect(s.tab).toBe("signals");
    expect(s.page).toBe(3);
    expect(s.pageSize).toBe(500);
    expect(s.minCases).toBe(20);
  });
  it("accepts the method's hotspot type as an alias of the kind", () => {
    expect(validateBacklogSearch(input({ hotspotType: "severity" })).kind).toBe("acute");
    expect(validateBacklogSearch(input({ kind: "widespread", hotspotType: "severity" })).kind).toBe("widespread");
    expect(validateBacklogSearch(input({ confident: "true" })).confident).toBe(true);
  });
  it("accepts pins as array or comma list, max three", () => {
    expect(validateBacklogSearch(input({ pins: "a,b,c,d" })).pins).toEqual(["a", "b", "c"]);
    expect(validateBacklogSearch(input({ pins: ["x"] })).pins).toEqual(["x"]);
  });
  it("strips defaults so URLs stay short", () => {
    const s = validateBacklogSearch(input({ slicing: "case Vendor", view: "Finance" }));
    expect(stripBacklogDefaults(s)).toEqual({ slicing: "case Vendor", view: "Finance" });
    expect(stripBacklogDefaults({ ...s, sort: "-gap", page: 2, tab: "table" })).toEqual({ slicing: "case Vendor", view: "Finance", sort: "-gap", page: 2, tab: "table" });
  });
  it("defaults the slice tab to Why and maps the earlier tab values onto the six questions", () => {
    const tab = (v: string) => validateSliceSearch({ tab: v } as unknown as Parameters<typeof validateSliceSearch>[0]).tab;
    expect(tab("nope")).toBe("why");
    expect(tab("flow")).toBe("flow");
    expect(tab("drivers")).toBe("why");
    expect(tab("distributions")).toBe("compared");
    expect(tab("validation")).toBe("trust");
    expect(tab("headroom")).toBe("gain");
    expect(validateSliceSearch({ tab: "cases", case: "x" } as unknown as Parameters<typeof validateSliceSearch>[0]).case).toBe("x");
  });
  it("writes the filter model to the address as the object's JSON and reads it back", () => {
    const filter = '{"and":[{"kind":"activity","op":"contains","activity":"Record Goods Receipt"}]}';
    const search = stringifySearch({ filter, row: '["companyID_0000", "Packaging"]', page: 2, slicing: "case Vendor" });
    expect(search).toContain("filter=%7B%22and%22");
    expect(search).not.toContain("filter=%22%7B");
    const parsed = parseSearch(search) as Record<string, unknown>;
    expect(validateBacklogSearch(input(parsed)).filter).toBe(filter);
    expect(validateBacklogSearch(input(parsed)).row).toBe('["companyID_0000", "Packaging"]');
    expect(validateBacklogSearch(input(parsed)).page).toBe(2);
    expect(validateBacklogSearch(input(parsed)).slicing).toBe("case Vendor");
  });
});
