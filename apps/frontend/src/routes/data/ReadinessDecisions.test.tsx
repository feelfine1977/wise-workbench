import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };

describe("decisions on the data caveats (R2-O1)", () => {
  it("every item that allows a decision has a button; the preview shows cases and events; applying rebuilds the case table and lists the decision", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
    const report = await screen.findByTestId("readiness-decisions", {}, T);
    await within(report).findByRole("button", { name: /Decide how open cases count/ }, T);
    expect(within(report).getAllByRole("button", { name: /Drop the events outside the window|Treat placeholder dates|Collapse exact duplicates|Mark day-precise|Type the header events|Decide how open cases|Decide how items without a value|Assign the flow types/ }).length).toBe(8);
    await user.click(within(report).getByRole("button", { name: /Collapse exact duplicates/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Preview the effect" }));
    const preview = await within(dialog).findByTestId("decision-preview", {}, T);
    expect(preview).toHaveTextContent(/5,089 of 251,734 cases · 180,913 of 1,595,923 events affected/);
    expect(within(dialog).getByRole("button", { name: /Apply and rebuild/ })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("note *"), "duplicates come from the export, agreed with the owner");
    await user.type(within(dialog).getByLabelText("author"), "u.jessen");
    await user.click(within(dialog).getByRole("button", { name: /Apply and rebuild/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), T);
    const list = await screen.findByTestId("decisions-list", {}, T);
    expect(list).toHaveTextContent(/Collapse exact duplicates/);
    expect(list).toHaveTextContent(/u\.jessen/);
    expect(list).toHaveTextContent(/duplicates come from the export/);
    // the screen now shows the rebuilt case table, whose report carries the decision
    await waitFor(() => expect(screen.getByText(/Decided \(collapse exact duplicate events\)/)).toBeInTheDocument(), T);
    expect(screen.getByRole("region", { name: "Jobs" })).toHaveTextContent(/Rebuild the case table/);
  });
});

describe("the readiness report as a list of decisions (R3-19)", () => {
  it("puts what is still undecided first, worst first, and says the machine's sentence only behind a click", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
    const report = await screen.findByTestId("readiness-decisions", {}, T);
    await within(report).findByRole("button", { name: /Decide how open cases count/ }, T);
    const ids = [...report.querySelectorAll("[data-readiness-item]")].map((el) => el.getAttribute("data-readiness-item"));
    // the header replication (93 %) is the first thing a reader has to decide on this log
    expect(ids[0], `the report opens on ${String(ids[0])}`).toBe("header_event_replication");
    // and the readings that need no decision come after the ones that do
    const first = ids.indexOf("volume");
    expect(first).toBeGreaterThan(2);

    // the sentence a reader reads carries no ISO stamp and no `value(s)`; the exact one is behind a summary
    const rows = [...report.querySelectorAll("[data-readiness-item]")] as HTMLElement[];
    for (const row of rows) {
      const shown = row.cloneNode(true) as HTMLElement;
      for (const d of shown.querySelectorAll("details")) d.remove();
      const text = shown.textContent ?? "";
      expect(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.exec(text)?.[0], `“${text.slice(0, 90)}” prints a machine timestamp`).toBeUndefined();
      expect(/value\(s\)/.exec(text)?.[0], `“${text.slice(0, 90)}” prints value(s)`).toBeUndefined();
    }
    // the one that carries an evidence share says what it touches
    expect(within(report).getAllByText(/touches \d/).length).toBeGreaterThan(0);
  });
});
