import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };

describe("your process: the flow-type fork (R2-O7, R2-O10)", () => {
  it("shows one card per flow type with counts, a small map and the choice of the analysis path", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    const list = await screen.findByRole("list", { name: "Flow types" }, T);
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent(/DF2/);
    expect(cards[0]).toHaveTextContent(/221,010 purchase order items · 88\s?%/);
    expect(await within(cards[0] as HTMLElement).findByTestId("mini-map", {}, T)).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent(/14\s?% still open/);
    expect(screen.getByTestId("your-process")).toHaveTextContent(/The log splits into 4 flow types by flow type; DF2 carries 88\s?% of the 251,734 purchase order items/);
    const fork = screen.getByTestId("flow-fork");
    expect(within(fork).getByRole("link", { name: "Compare everything together" })).toHaveAttribute("href", expect.stringContaining("/runs/run_41/backlog"));
    expect(within(fork).getByRole("button", { name: "Analyse per flow type" })).toBeEnabled();
  });

  it("forking creates one scoped run per flow type; the ribbon gains the flow-type switcher when they are done", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    await screen.findByRole("list", { name: "Flow types" }, T);
    await user.click(screen.getByRole("button", { name: "Analyse per flow type" }));
    const tray = await screen.findByRole("region", { name: "Jobs" }, T);
    await waitFor(() => expect(within(tray).getAllByText(/^Score (DF2|DF1|Consignment|2-way)/).length).toBe(4), T);
    // Both the status badge and the progress message say "done". Check each job
    // instead of a transient label count that can pass with only two jobs finished.
    await waitFor(() => {
      const jobs = within(tray).getAllByRole("listitem");
      expect(jobs).toHaveLength(4);
      for (const job of jobs) expect(job).toHaveAttribute("data-job-status", "done");
    }, T);
    await waitFor(() => expect(screen.getByText("Every flow type has its run")).toBeInTheDocument(), T);
    // the Data step's ribbon shows project and dataset only; the scope switcher belongs to the Signals step
    expect(screen.queryByRole("combobox", { name: "Switch scope" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("list", { name: "Flow types" })).getAllByRole("button", { name: /Analyse the .* flow|Open this flow/ })[0]!);
    await waitFor(() => expect(screen.getByRole("list", { name: "Signals" })).toBeInTheDocument(), T);
    expect(screen.getByText(/Signals · DF2 flow only/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Switch scope" })).toHaveTextContent("DF2 only"), T);
  });

  it("the run page compares the flow types side by side for a run without scope", async () => {
    renderApp("/p/p2p2018/runs/run_41?tab=compare");
    const section = await screen.findByTestId("compare-flow-types", {}, T);
    expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["DF2", "DF1", "Consignment", "2-way"]);
    expect(section).toHaveTextContent(/points against everyone/);
    expect(section).toHaveTextContent(/no run of its own yet/);
  });
  it("every card carries a thumbnail of its own flow and a sub-line that is not clipped (R3-18)", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    const list = await screen.findByRole("list", { name: "Flow types" }, T);
    const cards = within(list).getAllByRole("listitem") as HTMLElement[];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      // the card carries a thumbnail; that it draws its flow rather than a lane header is measured on the
      // real map in `e2e/flow-frame.spec.ts`, because the unit environment stands the flow library in
      await within(card).findByTestId("mini-map", {}, T);
      // and the sub-line says what the flow type is, in full: clamping it cut every card of the extract
      // mid-number
      const sub = [...card.querySelectorAll("p")].find((p) => /purchase order items \(/.test(p.textContent ?? ""));
      expect(sub, `${card.textContent?.slice(0, 12) ?? ""} has no sub-line`).toBeTruthy();
      expect(sub?.className ?? "", `${card.textContent?.slice(0, 12) ?? ""} clamps its sub-line`).not.toMatch(/clamp-/);
      expect(sub?.textContent ?? "").toMatch(/activities/);
    }
  });
});
