import { expect, it } from "vitest";
import { groupingSignature, groupingSuggestionsQuery } from "./groupingSuggestions";

it("keys evidence by project, table, norm, selected views, saved scope, focus and minimum support", () => {
  const base = { normVersionId: "n1", views: ["B", "A"], minCases: 20 };
  const key = groupingSuggestionsQuery("p", "ct", base).queryKey;
  expect(groupingSuggestionsQuery("p", "ct", { ...base, views: ["A", "B"] }).queryKey).toEqual(key);
  for (const patch of [{ normVersionId: "n2" }, { views: ["A"] }, { minCases: 5 }, { scope: { selection_id: "saved" } }, { scope: { flow_type: "DF1" } }, { focusLayer: "time" }, { focusConstraint: "c1" }]) {
    expect(groupingSuggestionsQuery("p", "ct", { ...base, ...patch }).queryKey).not.toEqual(key);
  }
  expect(groupingSuggestionsQuery("p2", "ct", base).queryKey).not.toEqual(key);
  expect(groupingSuggestionsQuery("p", "ct2", base).queryKey).not.toEqual(key);
});

it("detects an already chosen suggestion independently of row IDs and column order", () => {
  expect(groupingSignature({ attributes: ["a", "b"], bands: [{ attribute: "b", method: "quantile" }] })).toBe(groupingSignature({ attributes: ["b", "a"], bands: [{ attribute: "b", method: "quantile", q: 4 }] }));
  expect(groupingSignature({ attributes: ["a"], bands: [{ attribute: "a", method: "quantile", q: 2 }] })).not.toBe(groupingSignature({ attributes: ["a"], bands: [{ attribute: "a", method: "quantile", q: 4 }] }));
});
