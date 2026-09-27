import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch, validateFlowSearch } from "./search";

const validate = (value: Record<string, unknown>) => validateFlowSearch(value as Parameters<typeof validateFlowSearch>[0]);

describe("Flow preserves exact filter input for server validation", () => {
  it.each(["", "{", "7", "null", "false", '{"and":[null,{"kind":"open","value":true}]}'])("preserves %s through URL parsing and does not use the alias", (filter) => {
    const parsed = parseSearch(stringifySearch({ filter, f: '{"and":[]}' }));
    expect(validate(parsed).filter).toBe(filter);
  });
  it.each([null, false, 7, { and: [{ kind: "count", activity: "Review", min: 2 }] }])("serializes parsed filter %j without falling back", (filter) => {
    expect(validate({ filter, f: '{"and":[]}' }).filter).toBe(JSON.stringify(filter));
  });
  it("uses the alias only when filter is undefined", () => {
    expect(validate({ f: "7" }).filter).toBe("7");
    expect(validate({ filter: undefined, f: { and: [] } }).filter).toBe('{"and":[]}');
    expect(validate({}).filter).toBeUndefined();
  });
});
