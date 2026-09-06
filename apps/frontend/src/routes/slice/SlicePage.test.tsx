import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/stores/ui";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const PACKAGING = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;

describe("Why? — the essential reason chain on Packaging (RG-3)", () => {
  beforeEach(() => useUiStore.getState().setVocabulary("plain"));

  it("one sentence, the flow first, the top expectations in plain words with the real-unit comparison and the share, caveats, no ids", async () => {
    const user = userEvent.setup();
    renderApp(PACKAGING);
    await screen.findByRole("heading", { level: 1, name: /companyID_0000 × Packaging/ }, T);
    const sentence = screen.getByTestId("why-sentence");
    expect(sentence).toHaveTextContent(/109,199 purchase order items · 0\.9 points below the overall score of 84\.4 \(1 %\) · .*confidence high/);
    expect(screen.getByTestId("why-reason")).toHaveTextContent(/mostly waiting too long between steps — Paid within terms: 83 days here against 55 elsewhere \(\+25 days\)/);
    expect(screen.getByRole("list", { name: "Data caveats for this group" })).toHaveTextContent(/14\s?%.*still open/);
    // Flow first, selected by default
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Where in the flow");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("flow-map", {}, T)).toBeInTheDocument();
    // the six metric boxes are gone in plain mode
    expect(screen.queryByTestId("method-strip")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Which expectations are missed" }));
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    const items = within(drivers).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toHaveTextContent(/Paid within terms/);
    expect(items[0]).toHaveTextContent(/missed in 97\s?% of these purchase order items — explains 93\s?% of the shortfall/);
    expect(items[0]).toHaveTextContent(/83 days here against 55 elsewhere/);
    expect(drivers).not.toHaveTextContent(/c_l3_invoice_to_clear_days/);
    expect(screen.getByTestId("typical-causes")).toHaveTextContent(/Typical causes arrive with the knowledge hub in cycle 3/);
    expect(screen.getByTestId("subgroups")).toHaveTextContent(/vendorID_0136/);
    // the full picture stays behind "show all"
    expect(screen.queryByTestId("drivers-table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show all \d+ expectations/ }));
    expect(await screen.findByTestId("drivers-table", {}, T)).toBeInTheDocument();
    // possible gain in sentences
    await user.click(screen.getByRole("tab", { name: "Possible gain" }));
    expect(await screen.findByTestId("headroom-list", {}, T)).toHaveTextContent(/If Paid within terms were always met, this group would gain 4\.3 points \(100\s?% of its shortfall\)/);
  });

  it("the method's terms return when the vocabulary is switched: metric boxes, ids and the method strip", async () => {
    useUiStore.getState().setVocabulary("method");
    renderApp(`${PACKAGING}&tab=drivers`);
    await screen.findByRole("heading", { level: 1, name: /companyID_0000 × Packaging/ }, T);
    expect(screen.getByTestId("method-strip")).toBeInTheDocument();
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    await waitFor(() => expect(drivers).toHaveTextContent(/c_l3_invoice_to_clear_days/));
  });

  it("the map's filter actions write the filter model into the address and print cases in / out", async () => {
    renderApp(`${PACKAGING}&filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "activity", op: "contains", activity: "a_remove_payment_block" }] }))}`);
    await screen.findByRole("heading", { level: 1, name: /companyID_0000 × Packaging/ }, T);
    const preview = await screen.findByTestId("filter-preview", {}, T);
    expect(preview).toHaveTextContent(/purchase order items in · .* out with the current filter/);
  });
});
