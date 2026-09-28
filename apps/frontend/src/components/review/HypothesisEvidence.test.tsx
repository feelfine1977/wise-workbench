import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HypothesisEvidence } from "./HypothesisEvidence";

describe("computed hypothesis evidence", () => {
  it("shows the saved nested comparison, confidence and populations", () => {
    render(<HypothesisEvidence test={{ constraint_id: "c2", reading: "Half of these items miss the target.", risk_difference: 0.25, interval: [-0.1, 0.5], confidence_level: 0.9, interval_method: "Newcombe/Wilson", n_group: 4, n_rest: 12 }} />);
    expect(screen.getByText("Half of these items miss the target.")).toBeVisible();
    expect(screen.getByText(/Difference.*\+25 percentage points/)).toBeVisible();
    expect(screen.getByText(/90% interval: -10 to \+50.*Newcombe\/Wilson/)).toBeVisible();
    expect(screen.getByText(/4 in this group · 12 in the rest/)).toBeVisible();
    expect(screen.getByText(/does not establish its cause/)).toBeVisible();
  });
  it("does not invent interval confidence for legacy records", () => {
    render(<HypothesisEvidence test={{ constraint_id: "c2", risk_difference: 0, interval: [0, 0.5], interval_method: "bootstrap percentile (analytics)" }} />);
    expect(screen.getByText(/Interval details are unavailable/)).toBeVisible();
    expect(screen.queryByText(/bootstrap/)).not.toBeInTheDocument();
  });
  it("explains an unassessed hypothesis", () => {
    render(<HypothesisEvidence test={null} />);
    expect(screen.getByText(/No computed comparison/)).toBeVisible();
  });
});
