import { describe, expect, it } from "vitest";
import { addClause, announceFilter, canonicalFilter, clauseForActivity, clauseForPath, clauseForValue, clauseKey, describeClause, filterHash, parseFilter, periodLabel, removeClause, serializeFilter, toggleClause } from "./filter";

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
    expect(describeClause(clauseForActivity("a_x", "keep"), labelOf)).toBe("with Record Goods Receipt");
    expect(describeClause(clauseForActivity("a_x", "exclude"), labelOf)).toBe("without Record Goods Receipt");
    expect(describeClause(clauseForPath("a_x", "a_y", "keep"), labelOf)).toBe("Record Goods Receipt → Clear Invoice");
    expect(describeClause({ kind: "lag", a: "a_x", b: "a_y", unit: "D", min: 30 }, labelOf)).toBe("Record Goods Receipt to Clear Invoice at least 30 days");
    expect(describeClause({ kind: "open", value: false })).toBe("closed items only");
    expect(describeClause({ kind: "attribute", field: "case Item Category", in: ["Consignment"] })).toBe("Item Category: Consignment");
    expect(describeClause({ kind: "attribute", field: "flow_type", in: ["DF2", "DF1"] })).toBe("flow type: DF2 or DF1");
    expect(describeClause({ kind: "count", activity: "a_x", min: 2 }, labelOf)).toBe("Record Goods Receipt at least 2 times");
    expect(describeClause({ kind: "time", field: "active", from: "2018-10-01", to: "2018-12-31" })).toBe("2018 Q4");
  });

  // the third release: one canonical filter behind the chips, the URL, the map and every board panel (§2.1)
  it("writes the same canonical form and the same hash for the same clauses in any order", () => {
    const a = clauseForActivity("Record Goods Receipt", "keep");
    const b = clauseForValue("flow_type", "DF2");
    const one = { and: [a, b] };
    const two = { and: [b, a] };
    expect(JSON.stringify(canonicalFilter(one))).toBe(JSON.stringify(canonicalFilter(two)));
    expect(filterHash(one)).toBe(filterHash(two));
    expect(filterHash(undefined)).toBeUndefined();
    // aliases and value order are resolved, duplicates removed
    const canonical = canonicalFilter({ and: [{ kind: "activity", op: "not_contains", activity: "x" }, { kind: "activity", op: "never", activity: "x" }, { kind: "attribute", field: "f", in: ["b", "a"] }] });
    expect(canonical.and).toHaveLength(2);
    expect(canonical.and.some((c) => c.kind === "attribute" && c.in?.join() === "a,b")).toBe(true);
  });

  it("toggles a clause off on the second click and reads two values of one field as OR (§4.5)", () => {
    const df2 = clauseForValue("flow_type", "DF2");
    const df1 = clauseForValue("flow_type", "DF1");
    let f = toggleClause(undefined, df2);
    expect(f?.and).toHaveLength(1);
    f = toggleClause(f, df1);
    expect(f?.and).toHaveLength(1);
    expect(describeClause(f!.and[0]!)).toBe("flow type: DF1 or DF2");
    f = toggleClause(f, df2);
    expect(describeClause(f!.and[0]!)).toBe("flow type: DF1");
    const activity = clauseForActivity("a_x", "keep");
    expect(toggleClause(toggleClause(undefined, activity), activity)).toBeUndefined();
  });

  it("says what happened after every change, including the action that removes nothing (§2.4)", () => {
    const added = [clauseForActivity("Record Goods Receipt", "keep")];
    expect(announceFilter({ added, removed: [] }, { casesIn: 108930, casesTotal: 251734 }, "purchase order items", { panels: 6 })).toBe(
      "Filter added: with Record Goods Receipt — 108,930 of 251,734 purchase order items remain; 6 panels updated.",
    );
    expect(announceFilter({ added, removed: [] }, { casesIn: 251734, casesTotal: 251734 }, "items", { removedNone: true })).toBe("Filter added: with Record Goods Receipt — no items removed.");
    expect(announceFilter({ added: [], removed: added }, { casesIn: 251734, casesTotal: 251734 }, "items")).toBe("Filter removed: with Record Goods Receipt — 251,734 of 251,734 items remain.");
    expect(announceFilter({ added: [], removed: [] }, undefined, "items")).toBeUndefined();
  });

  it("names a period window in words", () => {
    expect(periodLabel("2018-01-01", "2018-12-31")).toBe("2018");
    expect(periodLabel("2018-10-01", "2018-12-31")).toBe("2018 Q4");
    expect(periodLabel("2018-03-01", "2018-03-31")).toBe("March 2018");
    expect(periodLabel("2018-03-04", "2018-04-02")).toBe("2018-03-04 to 2018-04-02");
  });
});
