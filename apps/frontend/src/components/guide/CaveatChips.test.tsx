import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Caveat } from "@/lib/api/analytics";
import { CaveatChips, caveatWords, runCaveatSentence } from "./CaveatChips";

describe("the data caveats of a group", () => {
  it("tells two chips of the same kind apart by the part of the group they name (P1-10)", () => {
    const chips = [
      { id: "subgroup_censoring", share: 1, status: "fail", text: "100 % of the 24 purchase order items with start_Q = 2019Q1 are still open at the end of the data.", subgroup: { attribute: "start_Q", value: "2019Q1", cases: 24 } },
      { id: "subgroup_censoring", share: 0.65, status: "fail", text: "65 % of the 23,130 purchase order items with start_Q = 2018Q4 are still open at the end of the data.", subgroup: { attribute: "start_Q", value: "2018Q4", cases: 23130 } },
    ] as unknown as Caveat[];
    expect(caveatWords(chips[0] as Caveat)).toBe("subgroup censoring · start Q 2019Q1");
    expect(caveatWords(chips[1] as Caveat)).toBe("subgroup censoring · start Q 2018Q4");
    // a caveat that names no part of the group keeps its own four words
    expect(caveatWords({ id: "censoring" } as Caveat)).toBe("still open at the end");

    render(<CaveatChips caveats={chips} max={4} />);
    expect(screen.getByText(/start Q 2019Q1/)).toBeInTheDocument();
    expect(screen.getByText(/start Q 2018Q4/)).toBeInTheDocument();
  });

  it("says what a run-wide caveat says, in words rather than by its id (P1-3)", () => {
    const said = runCaveatSentence("censoring", 0.1388, 0.90625, "purchase order items");
    expect(said).toMatch(/^On this run: still open at the end, 14\s?% of purchase order items on average, up to 91\s?% on one group\.$/);
    expect(said).not.toMatch(/^censoring/);
    // without a share it still reads as a sentence rather than as the literal word "log-wide"
    expect(runCaveatSentence("duplicates", undefined, undefined, "cases")).toBe("On this run: duplicated events.");
  });
});
