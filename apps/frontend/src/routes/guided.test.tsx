/**
 * R3-10 — Guided mode, first cut.
 *
 * The order-desk employee scored 67 % on the comprehension test in cycle 3, down from 72 % in cycle 2, on
 * screens built for an analyst: seven steps, a discount rate, a perspective switcher, a grouping switcher, a
 * drawer of eleven filters and a decision pane that asks for a hotspot type. Guided mode is a profile the
 * address can set — `?mode=guided` anywhere, remembered afterwards — that leaves one path, turns the
 * explanations on and puts the method's controls one click away rather than in the way.
 */
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
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await waitFor(() => expect(useUiStore.getState().mode).toBe("guided"), T);
    expect(await screen.findByTestId("guided-banner", {}, T)).toHaveTextContent(/One path through the question/);
    await waitFor(() => expect(stepLabels()).toEqual(["Signals", "Why", "What can we do?"]), T);
  });

  it("keeps the reader's context in the ribbon and puts the method's switchers away", async () => {
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const ribbon = (await screen.findByRole("navigation", { name: "Context" }, T)).closest("header") as HTMLElement;
    await waitFor(() => expect(within(ribbon).queryByLabelText(/perspective/i)).not.toBeInTheDocument(), T);
    expect(within(ribbon).queryByLabelText(/grouping/i)).not.toBeInTheDocument();
    // and no control on the screen asks the reader about γ
    expect(within(ribbon).queryByText(/γ/)).not.toBeInTheDocument();
  });

  it("turns the explanations on: the how-to-read paragraph opens with the screen", async () => {
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(await screen.findByTestId("how-to-read", {}, T)).toBeInTheDocument();
  });

  it("offers three questions instead of the whole drawer", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation&mode=guided`);
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

  it("gives the whole workbench back on one click, and remembers it", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation&mode=guided`);
    await screen.findByTestId("guided-banner", {}, T);
    await user.click(screen.getByRole("button", { name: "Show everything" }));
    await waitFor(() => expect(screen.queryByTestId("guided-banner")).not.toBeInTheDocument(), T);
    expect(useUiStore.getState().mode).toBe("analyst");
    await waitFor(() => expect(stepLabels().length).toBeGreaterThan(3), T);
  });
});
