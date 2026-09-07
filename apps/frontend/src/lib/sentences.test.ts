import { describe, expect, it } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import { verifiedBacklog, verifiedSlicings } from "@/mocks/fixtures/verified";
import { belowExpectation, bracketIsDifference, comparisonSentence, groupLabel, missedPhrase, pageWideCaveats, readingSentence, sharedKeyValues } from "./sentences";

const rows = [
  { key: '["companyID_0000", "Packaging"]', keys: { "case Company": "companyID_0000", "case Spend area text": "Packaging" } },
  { key: '["companyID_0000", "Logistics"]', keys: { "case Company": "companyID_0000", "case Spend area text": "Logistics" } },
];

describe("the plain sentences of a group", () => {
  it("drops the part of the name most groups share and keeps it as a suffix on the others", () => {
    const shared = sharedKeyValues(rows);
    expect([...shared.entries()]).toEqual([["case Company", "companyID_0000"]]);
    expect(groupLabel(rows[0]!, shared)).toBe("Packaging");
    expect(groupLabel({ key: '["companyID_0003", "Real Estate"]', keys: { "case Company": "companyID_0003", "case Spend area text": "Real Estate" } }, shared)).toBe("Real Estate · company 0003");
    expect(sharedKeyValues([{ key: '["a"]', keys: { "case Vendor": "a" } }, { key: '["b"]', keys: { "case Vendor": "b" } }]).size).toBe(0);
    expect(groupLabel({ key: '["vendorID_0136"]' })).toBe("vendorID_0136");
    expect(groupLabel(rows[0]!)).toBe("companyID_0000 × Packaging");
  });
  it("rounds the share below expectation as the number rule says", () => {
    expect(belowExpectation({ gap: 0.008662 })).toBe("0.9 %");
    expect(belowExpectation({ gap: 0.1142 })).toBe("11 %");
  });
  it("prints the served comparison as it is given, trimmed and ended once (R3-04)", () => {
    // the bracket is the server's: the rule is kept where the sentence is written and where a stored one is
    // read back, so nothing is rewritten on the way to a card
    expect(comparisonSentence({ comparison: "Paid within terms: 83 days here against 55 elsewhere (+28 days)." })).toBe("Paid within terms: 83 days here against 55 elsewhere (+28 days).");
    expect(comparisonSentence({ comparison: "Received in few deliveries: 14 Record Goods Receipt events per purchase order item here against 1 elsewhere (+13)" })).toBe("Received in few deliveries: 14 Record Goods Receipt events per purchase order item here against 1 elsewhere (+13).");
    expect(comparisonSentence({ comparison: "No material difference on the top expectation (Few manual touches)..." })).toBe("No material difference on the top expectation (Few manual touches).");
    expect(comparisonSentence({ comparison: null })).toBeUndefined();
    expect(comparisonSentence({ comparison: "  " })).toBeUndefined();
  });

  it("reads a bracket back and says whether it is the difference of the two printed numbers (R3-04)", () => {
    expect(bracketIsDifference("Paid within terms: 83 days here against 55 elsewhere (+28 days).")).toBe(true);
    // the shift estimate the run was scored with, which the server must not serve
    expect(bracketIsDifference("Paid within terms: 83 days here against 55 elsewhere (+25 days).")).toBe(false);
    // the bracket is no more precise than the coarser of the two numbers on the screen
    expect(bracketIsDifference("Goods or service received: missed in 12 % of purchase order items here against 5.9 % elsewhere (+6 points).")).toBe(true);
    expect(bracketIsDifference("Goods or service received: missed in 12 % of purchase order items here against 5.9 % elsewhere (+5.9 points).")).toBe(false);
    expect(bracketIsDifference("Picked goods leave promptly: 1.2 days here against 1.9 elsewhere (-0.7 days).")).toBe(true);
    expect(bracketIsDifference("No material difference on the top expectation (Few manual touches).")).toBeUndefined();
    expect(bracketIsDifference(null)).toBeUndefined();
  });

  it("every comparison the verified run serves prints a bracket that is its own difference (R3-04)", () => {
    const sentences = verifiedSlicings.flatMap((slicing) =>
      ["Automation", "Finance"].flatMap((view) =>
        (verifiedBacklog(slicing, view)?.rows ?? []).flatMap((r) => [(r as BacklogRow).comparison, (r as BacklogRow).reading_plain]).filter((c): c is string => !!c),
      ),
    );
    expect(sentences.length).toBeGreaterThan(10);
    let checked = 0;
    for (const raw of sentences) {
      const verdict = bracketIsDifference(comparisonSentence({ comparison: raw }));
      if (verdict === undefined) continue;
      checked += 1;
      expect(verdict, `the run serves “${raw}”, whose bracket is not the difference of the two numbers it prints`).toBe(true);
    }
    expect(checked).toBeGreaterThan(5);
  });
  it("names what is missed from the guidance, the area or the expectation", () => {
    const row = { top_constraint: "c_l3_invoice_to_clear_days", layer_missed_label: "waiting too long between steps", top_constraint_plain: "Paid within terms" } as BacklogRow;
    expect(missedPhrase(row, [{ kind: "constraint", id: "c_l3_invoice_to_clear_days", plain_name: "Paid within terms", missed_label: "invoices cleared late", hub_node: null }])).toBe("invoices cleared late");
    expect(missedPhrase(row)).toBe("waiting too long between steps");
    expect(missedPhrase({ ...row, layer_missed_label: null })).toBe("paid within terms");
  });
  it("makes the reading sentence agree with the confidence word", () => {
    expect(readingSentence({ reading: "…; confidence in rank: not computed for this run; priority 945.7", stability: "stable" })).toBe("…; confidence in rank: high; priority 945.7");
    expect(readingSentence({ reading: "…; confidence in rank: not computed for this run", stability: "unknown" })).toContain("not computed");
  });
  it("finds the caveats that hold on nearly every group of a page", () => {
    const caveat = (id: string, share: number) => ({ id, share, status: "warn", text: id });
    const page = Array.from({ length: 10 }, (_, i) => ({ key: String(i), caveats: [caveat("window_edge", 0.1 + i / 100), ...(i < 3 ? [caveat("duplicates", 0.5)] : [])] })) as unknown as BacklogRow[];
    const wide = pageWideCaveats(page);
    expect(wide.map((c) => c.id)).toEqual(["window_edge"]);
    expect(wide[0]!.share).toBeCloseTo(0.15, 2);
  });
});
