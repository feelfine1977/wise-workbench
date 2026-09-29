/** Guided mode keeps the journey visible and offers controls and help on demand. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/stores/ui";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const RUN = "/p/p2p2018/runs/run_41";
const CSA = encodeURIComponent("case Company+case Spend area text");
const PACKAGING = encodeURIComponent('["companyID_0000", "Packaging"]');

const stepLabels = () => [...document.querySelectorAll("[data-testid='stepper'] [data-step-label]")].map((el) => el.textContent);

describe("guided mode (R3-10)", () => {
  beforeEach(() => useUiStore.getState().setMode("analyst"));

  it("is set by the address and leaves one path: where is it worst, why, and what can we do", async () => {
    renderApp(`${RUN}/backlog?tab=signals&slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await waitFor(() => expect(useUiStore.getState().mode).toBe("guided"), T);
    expect(screen.queryByTestId("guided-banner")).not.toBeInTheDocument();
    await waitFor(() => expect(stepLabels()).toEqual(["Project", "Understand data", "Process norm", "Run WISE", "Analyse", "Improve"]), T);
  });

  it("keeps the reader's context in the ribbon and puts the method's switchers away", async () => {
    renderApp(`${RUN}/backlog?tab=signals&slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const ribbon = (await screen.findByRole("navigation", { name: "Context" }, T)).closest("header") as HTMLElement;
    await waitFor(() => expect(within(ribbon).queryByLabelText(/perspective/i)).not.toBeInTheDocument(), T);
    expect(within(ribbon).queryByLabelText(/grouping/i)).not.toBeInTheDocument();
    // and no control on the screen asks the reader about γ
    expect(within(ribbon).queryByText(/γ/)).not.toBeInTheDocument();
  });

  it("keeps guidance available on demand and returns focus after closing", async () => {
    renderApp(`${RUN}/backlog?tab=signals&slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(screen.queryByTestId("how-to-read")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Show how to read this screen" });
    await userEvent.setup().click(trigger);
    expect(await screen.findByTestId("how-to-read", {}, T)).toBeVisible();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("offers three questions instead of the whole drawer", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/backlog?tab=signals&slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(screen.getByRole("button", { name: /Refine/ }));
    const drawer = await screen.findByTestId("guided-filters", {}, T);
    expect(within(drawer).getAllByRole("checkbox")).toHaveLength(3);
    // none of the method's own controls is in it
    expect(drawer.textContent ?? "").not.toMatch(/γ|gamma|stability|hotspot|layer/i);
  });

  it("reduces the decision pane to What next? and a note", async () => {
    renderApp(`${RUN}/slices/${PACKAGING}?slicing=${CSA}&view=Automation&tab=why&mode=guided`);
    await screen.findByTestId("why-strip", {}, T);
    const pane = await screen.findByLabelText("Decision", {}, T);
    expect(within(pane).getByRole("radiogroup", { name: "What next?" })).toBeInTheDocument();
    expect(within(pane).getByLabelText(/note/)).toBeInTheDocument();
    // the kind of problem is computed; the guided reader is not asked to type one
    expect(within(pane).queryByRole("radiogroup", { name: "kind of problem" })).not.toBeInTheDocument();
    expect(within(pane).queryByText(/Method terms/)).not.toBeInTheDocument();
  });

  it("switches to analyst mode from Settings and remembers it", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/backlog?tab=signals&slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(screen.getByRole("button", { name: "More context and settings" }));
    await user.click(screen.getByRole("button", { name: "Guided" }));
    await waitFor(() => expect(screen.queryByTestId("guided-banner")).not.toBeInTheDocument(), T);
    expect(useUiStore.getState().mode).toBe("analyst");
    await waitFor(() => expect(stepLabels().length).toBeGreaterThan(3), T);
  });
});
