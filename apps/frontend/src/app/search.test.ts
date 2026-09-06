import { describe, expect, it } from "vitest";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { BACKLOG_DEFAULTS, stripBacklogDefaults, validateBacklogSearch, validateSliceSearch } from "./search";

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
  it("defaults the slice tab", () => {
    expect(validateSliceSearch({ tab: "nope" } as unknown as Parameters<typeof validateSliceSearch>[0]).tab).toBe("drivers");
    expect(validateSliceSearch({ tab: "flow" } as unknown as Parameters<typeof validateSliceSearch>[0]).tab).toBe("flow");
    expect(validateSliceSearch({ tab: "cases", case: "x" } as unknown as Parameters<typeof validateSliceSearch>[0]).case).toBe("x");
  });
});
