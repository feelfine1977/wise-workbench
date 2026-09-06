import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Metric, backlogExplain } from "./explain";
import { fmtInt, fmtNum } from "@/lib/format";

const row = { n_cases: 5254, mean_score: 0.662, gap: 0.18, stable_gap: 0.1783, PI: 945.72, stable_PI: 936.8 };

describe("explain this number", () => {
  it("opens a popover with the PI formula and its inputs", async () => {
    const user = userEvent.setup();
    render(<Metric label="PI" value="945.7" explain={backlogExplain("PI", row, { globalMean: 0.842, gamma: 50, view: "Finance" }, { num: fmtNum, int: fmtInt })} />);
    await user.click(screen.getByRole("button", { name: /explain this number/i }));
    expect(await screen.findByText("PI = n · (μ̄ − μ_s)₊")).toBeInTheDocument();
    expect(screen.getByText("5,254")).toBeInTheDocument();
    expect(screen.getByText("0.8420")).toBeInTheDocument();
  });
  it("explains the shrinkage form for the stable gap with a caveat when n is small", async () => {
    const user = userEvent.setup();
    const small = { ...row, n_cases: 30 };
    render(<Metric label="stable gap" value="0.07" explain={backlogExplain("stable_gap", small, { globalMean: 0.842, gamma: 50 }, { num: fmtNum, int: fmtInt })} />);
    await user.click(screen.getByRole("button", { name: /explain this number/i }));
    expect(await screen.findByText(/μ̃_s = n\/\(n\+γ\)·μ_s \+ γ\/\(n\+γ\)·μ̄/)).toBeInTheDocument();
    expect(screen.getByText(/keeps only 38 % of its observed gap/)).toBeInTheDocument();
  });
});
