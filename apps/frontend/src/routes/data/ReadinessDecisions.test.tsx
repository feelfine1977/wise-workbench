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
