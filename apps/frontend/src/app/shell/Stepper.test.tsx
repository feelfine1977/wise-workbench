import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { currentStep } from "./Stepper";

const T = { timeout: 8000 };

describe("the analysis path (R2-O6)", () => {
  it("maps every screen onto its step", () => {
    expect(currentStep("/p/x/data")).toBe("data");
    expect(currentStep("/p/x/data/ds_1")).toBe("data");
    expect(currentStep("/p/x/norms/nv_7")).toBe("norm");
    expect(currentStep("/p/x/runs")).toBe("run");
    expect(currentStep("/p/x/runs/run_41")).toBe("run");
    expect(currentStep("/p/x/runs/run_41/backlog")).toBe("signals");
    expect(currentStep("/p/x/runs/run_41/slices/k")).toBe("why");
    expect(currentStep("/p/x")).toBeUndefined();
  });

  it("shows six steps with arrows, highlights the current one and links every step to its screen", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    const steps = within(stepper).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent?.replace(/:.*$/, "").trim())).toEqual(["⊘Data", "●Norm", "●Run", "◐Signals", "○Why", "○What to do"]);
    expect(steps[3]).toHaveAttribute("aria-current", "step");
    expect(within(steps[5] as HTMLElement).getByText(/arrives in cycle 3/)).toBeInTheDocument();
    await user.click(within(steps[0] as HTMLElement).getByRole("link"));
    await screen.findByRole("heading", { level: 1, name: /BPI_Challenge_2019/ }, T);
    expect(within(screen.getByRole("navigation", { name: "Analysis path" })).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
  });

  it("a sub-screen's back control returns to the exact place the reader came from", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Logistics&minCases=30`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(within(screen.getByRole("navigation", { name: "Analysis path" })).getByRole("link", { name: /Norm/ }));
    await screen.findByText(/Calibration lens/, {}, T);
    const back = screen.getByTestId("back-control");
    expect(back).toHaveTextContent("Back to Where is it worst?");
    await user.click(back);
    await screen.findByRole("list", { name: "Signals" }, T);
    await waitFor(() => expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/Logistics/));
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/at least 30 purchase order items/);
  });
});
