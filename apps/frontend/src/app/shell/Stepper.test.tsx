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

  it("maps sub-screens onto the step they were opened from", () => {
    expect(currentStep("/p/x/norms/nv_7", "/p/x/runs/run_41/slices/k")).toBe("why");
    expect(currentStep("/p/x/norms/nv_7", "/p/x/runs/run_41/backlog")).toBe("norm");
    expect(currentStep("/p/x/notebook", "/p/x/runs/run_41/slices/k")).toBe("why");
    expect(currentStep("/p/x/notebook")).toBeUndefined();
  });

  it("shows seven steps with states from the data, the current one with 'you are here', and links every step to its screen", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    const steps = within(stepper).getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"));
    const text = (li: HTMLElement) => `${li.querySelector("[data-step-glyph]")?.textContent}${li.querySelector("[data-step-label]")?.textContent}`;
    // the seventh step is a screen from this cycle on (R3-01): it opens for the group the reader last read
    expect(steps.map((s) => text(s as HTMLElement))).toEqual(["●Data", "●Norm", "●Run", "◉Signals", "◐Flow", "○Why", "⊘What can we do?"]);
    expect(steps[3]).toHaveAttribute("aria-current", "step");
    expect(within(steps[3] as HTMLElement).getByTestId("you-are-here")).toHaveTextContent("you are here");
    expect(within(steps[6] as HTMLElement).getAllByText(/open a group first/).length).toBeGreaterThan(0);
    expect(within(steps[6] as HTMLElement).getByRole("link")).toBeInTheDocument();
    // no user-visible string names a release
    expect(stepper.textContent).not.toMatch(/cycle \d/);
    // the twelve stages of the method sit behind "All stages"
    await user.click(within(stepper).getByRole("button", { name: "All stages of the method" }));
    expect(await screen.findByRole("list", { name: "All stages" })).toHaveTextContent(/Institutionalisation/);
    await user.keyboard("{Escape}");
    await user.click(within(steps[0] as HTMLElement).getByRole("link"));
    await screen.findByRole("heading", { level: 1, name: /BPI_Challenge_2019/ }, T);
    expect(within(screen.getByRole("navigation", { name: "Analysis path" })).getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"))[0]).toHaveAttribute("aria-current", "step");
  });

  it("the norm lens opened from a reason screen stays under Why with a second line; the back control cuts the stack so the list is one press away", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&minCases=1&kind=widespread`);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(within(within(list).getAllByRole("article")[0] as HTMLElement).getByRole("button", { name: /^Why\?/ }));
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    await user.click(screen.getByRole("tab", { name: "Compared" }));
    await user.click(await screen.findByRole("link", { name: /norm's calibration lens/ }, T));
    await screen.findByTestId("norm-builder", {}, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    const why = within(stepper).getAllByRole("listitem").find((li) => li.getAttribute("data-step") === "why") as HTMLElement;
    expect(why).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(within(why).getByTestId("step-subline")).toHaveTextContent(/Packaging · lens of/));
    expect(screen.getByTestId("back-control")).toHaveTextContent(/^Back to Why\?/);
    await user.click(screen.getByTestId("back-control"));
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    expect(screen.getByRole("tab", { name: "Compared" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("back-control")).toHaveTextContent("Back to Where is it worst? (page 1, widespread only)");
    await user.click(screen.getByTestId("back-control"));
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/widespread/);
  });

  it("a sub-screen's back control returns to the exact place the reader came from", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Logistics&minCases=30`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(within(screen.getByRole("navigation", { name: "Analysis path" })).getByRole("link", { name: /Norm/ }));
    await screen.findByTestId("norm-builder", {}, T);
    const back = screen.getByTestId("back-control");
    expect(back).toHaveTextContent("Back to Where is it worst? (page 1)");
    await user.click(back);
    await screen.findByRole("list", { name: "Signals" }, T);
    await waitFor(() => expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/Logistics/));
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/at least 30 purchase order items/);
  });
});
