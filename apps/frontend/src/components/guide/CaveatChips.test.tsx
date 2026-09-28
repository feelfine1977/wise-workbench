import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Caveat } from "@/lib/api/analytics";
import { CaveatChips, caveatWords, caveatFloor, runCaveatSentence } from "./CaveatChips";

describe("the data caveats of a group", () => {
  it("tells two chips of the same kind apart by the part of the group they name (P1-10)", () => {
    const chips = [
      { id: "subgroup_censoring", share: 1, status: "fail", text: "100 % of the 24 purchase order items with start_Q = 2019Q1 are still open at the end of the data.", subgroup: { attribute: "start_Q", value: "2019Q1", cases: 24 } },
      { id: "subgroup_censoring", share: 0.65, status: "fail", text: "65 % of the 23,130 purchase order items with start_Q = 2018Q4 are still open at the end of the data.", subgroup: { attribute: "start_Q", value: "2018Q4", cases: 23130 } },
    ] as unknown as Caveat[];
    expect(caveatWords(chips[0] as Caveat)).toBe("recent-unclosed diagnostic · start Q 2019Q1");
    expect(caveatWords(chips[1] as Caveat)).toBe("recent-unclosed diagnostic · start Q 2018Q4");
    // a caveat that names no part of the group keeps its own four words
    expect(caveatWords({ id: "censoring" } as Caveat)).toBe("recent-unclosed diagnostic");

    render(<CaveatChips caveats={chips} max={4} />);
    expect(screen.getByText(/start Q 2019Q1/)).toBeInTheDocument();
    expect(screen.getByText(/start Q 2018Q4/)).toBeInTheDocument();
  });

  it.each(["censoring", "right_censored", "subgroup_censoring"])("explains the WISE legacy flag without changing the supplied share or stored narrative (%s)", (id) => {
    const storedText = "Stored report wording.";
    const caveat = { id, share: 0.14, status: "warn", text: storedText } as Caveat;
    render(<CaveatChips caveats={[caveat]} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveTextContent(/14\s?%recent-unclosed diagnostic/);
    expect(chip).toHaveAccessibleName(/no configured closure observed and activity within the trailing window/);
    expect(chip).toHaveAccessibleName(/all assessed cases, regardless of closure applicability/);
    expect(chip).toHaveAccessibleName(/Not flagged does not mean closed/);
    expect(chip).not.toHaveTextContent(/still open/);
    expect(caveat).toMatchObject({ share: 0.14, text: storedText });
  });

  it("keeps concentration and header chips separate without changing their numeric visibility thresholds", () => {
    const ids = ["replication", "header_event_replication", "duplicates", "duplicate_events"];
    for (const id of ids) expect(caveatFloor(id)).toBe(0.01);
    expect(caveatFloor("censoring")).toBe(0.005);
    expect(caveatFloor("unmapped")).toBe(0.005);
    const caveats = ids.flatMap((id) => [
      { id, share: 0.01, status: "warn", text: "At the threshold." },
      { id, share: 0.0101, status: "warn", text: "Above the threshold." },
    ]) as Caveat[];
    render(<CaveatChips caveats={caveats} max={8} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText("timestamp concentration")).toBeInTheDocument();
    expect(screen.getByText("shared header timestamps")).toBeInTheDocument();
    expect(screen.queryByText("copied postings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more than two events per distinct timestamp/ })).toHaveAccessibleName(/does not prove copied postings/);
  });

  it("says what a run-wide caveat says, in words rather than by its id (P1-3)", () => {
    const said = runCaveatSentence("censoring", 0.1388, 0.90625, "purchase order items");
    expect(said).toMatch(/^On this run: recent-unclosed diagnostic, 14\s?% of purchase order items on average, up to 91\s?% on one group\.$/);
    expect(said).not.toMatch(/^censoring/);
    // without a share it still reads as a sentence rather than as the literal word "log-wide"
    expect(runCaveatSentence("duplicates", undefined, undefined, "cases")).toBe("On this run: duplicated events.");
  });
});
