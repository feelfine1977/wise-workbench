import { describe, expect, it } from "vitest";
import { addClause, clauseForActivity, clauseForPath, clauseKey, describeClause, parseFilter, removeClause, serializeFilter } from "./filter";

describe("the filter model in the URL (RF-01)", () => {
  it("parses and serialises the contract's JSON object and ignores junk", () => {
    const f = parseFilter('{"and":[{"kind":"activity","op":"contains","activity":"a_x"}]}');
    expect(f?.and).toHaveLength(1);
    expect(serializeFilter(f)).toBe('{"and":[{"kind":"activity","op":"contains","activity":"a_x"}]}');
    expect(parseFilter("not json")).toBeUndefined();
    expect(parseFilter('{"and":[]}')).toBeUndefined();
    expect(parseFilter({ and: [{ kind: "open", value: false }] })?.and[0]).toEqual({ kind: "open", value: false });
    expect(serializeFilter(undefined)).toBeUndefined();
  });
  it("adds a clause once and removes by index", () => {
    const a = clauseForActivity("a_x", "keep");
    let f = addClause(undefined, a);
    f = addClause(f, a);
    expect(f.and).toHaveLength(1);
    f = addClause(f, clauseForPath("a_x", "a_y", "exclude"));
    expect(f.and).toHaveLength(2);
    expect(clauseKey(f.and[1]!)).toBe(clauseKey({ kind: "follows", b: "a_y", a: "a_x", never: true, directly: true }));
    expect(removeClause(f, 0)?.and).toEqual([{ kind: "follows", a: "a_x", b: "a_y", directly: true, never: true }]);
    expect(removeClause({ and: [a] }, 0)).toBeUndefined();
  });
  it("describes clauses in plain words with activity labels", () => {
    const labelOf = (id: string) => ({ a_x: "Record Goods Receipt", a_y: "Clear Invoice" })[id] ?? id;
    expect(describeClause(clauseForActivity("a_x", "keep"), labelOf)).toBe("cases with Record Goods Receipt");
    expect(describeClause(clauseForActivity("a_x", "exclude"), labelOf)).toBe("cases without Record Goods Receipt");
    expect(describeClause(clauseForPath("a_x", "a_y", "keep"), labelOf)).toBe("Record Goods Receipt directly followed by Clear Invoice");
    expect(describeClause({ kind: "lag", a: "a_x", b: "a_y", unit: "D", min: 30 }, labelOf)).toBe("Record Goods Receipt to Clear Invoice at least 30 days");
    expect(describeClause({ kind: "open", value: false })).toBe("closed cases only");
    expect(describeClause({ kind: "attribute", field: "case Item Category", in: ["Consignment"] })).toBe("Item Category is Consignment");
    expect(describeClause({ kind: "count", activity: "a_x", min: 2 }, labelOf)).toBe("Record Goods Receipt at least 2 times");
  });
});
