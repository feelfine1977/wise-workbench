import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/stores/ui";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const PACKAGING = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;

describe("Why? — the essential reason chain on Packaging (RG-3)", () => {
  beforeEach(() => useUiStore.getState().setVocabulary("plain"));

  it("one sentence with the concentration clause, Why first with the expectations, the lens and the map, caveats, no ids", async () => {
    const user = userEvent.setup();
    renderApp(PACKAGING);
    // the company every group shares is dropped from the name; the kind and the confidence sit once at the right
    await screen.findByRole("heading", { level: 1, name: /^Packaging\b/ }, T);
    const sentence = screen.getByTestId("why-sentence");
    expect(sentence).toHaveTextContent(/^109,199 purchase order items · 0\.9 % below expectation · invoices cleared late in 97\s?% of them; the shortfall is 93\s?% this one expectation\.$/);
    expect(screen.getByTestId("why-reason")).toHaveTextContent(/^Paid within terms: 83 days here against 55 elsewhere \(\+25 days\)\.$/);
    expect(screen.getAllByText(/confidence high/).length).toBe(1);
    // the compact strip: priority, rank, average met with everyone, one caveat
    const strip = screen.getByTestId("why-strip");
    expect(strip).toHaveTextContent(/priority946/);
    expect(strip).toHaveTextContent(/rank1 of 30/);
    expect(strip).toHaveTextContent(/average met84\s?% \(everyone 84\s?%\)/);
    expect(within(strip).getByRole("list", { name: "Data caveats for this group" })).toHaveTextContent(/14\s?%.*still open/);
    // six one-word tabs, Why first and selected
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Why", "Compared", "Flow", "Cases", "Data trust", "Gain"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // the six metric boxes are behind "more" in plain mode
    expect(screen.queryByTestId("method-strip")).not.toBeInTheDocument();
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    const items = within(drivers).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toHaveTextContent(/Paid within terms/);
    expect(items[0]).toHaveTextContent(/missed in 97\s?% of these purchase order items · explains 93\s?% of the shortfall/);
    expect(drivers).not.toHaveTextContent(/c_l3_invoice_to_clear_days/);
    // the comparison lens of the top expectation with its two sentences, and the map, embedded in the Why tab
    const lens = await screen.findByTestId("why-lens", {}, T);
    await waitFor(() => expect(within(lens).getByTestId("lens-sentences")).toHaveTextContent(/Paid within terms: 83 days here; everywhere else 55\./), T);
    expect(within(lens).getByTestId("lens-sentences")).toHaveTextContent(/97\s?% of Packaging's purchase order items miss it.*everyone else: 83\s?%/);
    expect(await screen.findByTestId("why-map", {}, T)).toBeInTheDocument();
    expect(await screen.findByTestId("flow-map", {}, T)).toBeInTheDocument();
    expect(screen.getByTestId("why-caveats")).toHaveTextContent(/14\s?% of purchase order items still open/);
    expect(screen.getByTestId("typical-causes")).toHaveTextContent(/Typical causes are not available yet/);
    expect(screen.getByTestId("typical-causes").textContent).not.toMatch(/cycle \d/);
    // the full picture stays behind "Show all"
    expect(screen.queryByTestId("drivers-table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show all \d+ expectations/ }));
    expect(await screen.findByTestId("drivers-table", {}, T)).toBeInTheDocument();
    // the sub-groups sit on the Cases tab
    await user.click(screen.getByRole("tab", { name: "Cases" }));
    expect(await screen.findByTestId("subgroups", {}, T)).toHaveTextContent(/vendorID_0136/);
    // possible gain in sentences
    await user.click(screen.getByRole("tab", { name: "Gain" }));
    expect(await screen.findByTestId("headroom-list", {}, T)).toHaveTextContent(/If Paid within terms were always met, this group would gain 4\.3 points \(100\s?% of its shortfall\)/);
    // no next step before a decision is saved
    expect(screen.queryByTestId("next-step")).not.toBeInTheDocument();
  });

  it("the method's terms return when the vocabulary is switched: metric boxes, ids and the method strip; the old tab value maps onto Why", async () => {
    useUiStore.getState().setVocabulary("method");
    renderApp(`${PACKAGING}&tab=drivers`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    expect(screen.getByRole("tab", { name: "Why" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("method-strip")).toBeInTheDocument();
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    await waitFor(() => expect(drivers).toHaveTextContent(/c_l3_invoice_to_clear_days/));
  });

  it("a filter in the address shows as a chip with cases in on every tab and is written as the object's JSON", async () => {
    const user = userEvent.setup();
    renderApp(`${PACKAGING}&tab=gain&filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "activity", op: "contains", activity: "Remove Payment Block" }] }))}`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    const bar = screen.getByTestId("filter-bar");
    expect(bar).toHaveTextContent(/purchase order items in:/);
    expect(within(bar).getByRole("list", { name: "Active filters" })).toHaveTextContent("with Remove Payment Block");
    await waitFor(() => expect(within(bar).getByTestId("filter-preview")).toHaveTextContent(/[\d,]+ of [\d,]+/), T);
    expect(screen.getByRole("tab", { name: "Gain" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(bar).getByRole("button", { name: /Remove filter: with Remove Payment Block/ }));
    await waitFor(() => expect(within(screen.getByTestId("filter-bar")).queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument());
  });

  it("after a saved decision the next step appears under the pane", async () => {
    const user = userEvent.setup();
    renderApp(`${PACKAGING}&tab=trust`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    await user.click(screen.getByRole("radio", { name: "Investigate" }));
    await user.type(screen.getByLabelText("note *"), "payment terms to be checked");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("next-step")).toHaveTextContent(/Freeze this screen for the notebook/);
    expect(screen.getByTestId("next-step")).toHaveTextContent(/What can we do\?/);
  });
});
