import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient, renderApp } from "@/test/utils";
import { ApplicabilityEditor, RuleEditor, ruleSentence, type Constraint } from "./Builder";
import { NormAuthoringSettings } from "./NormAuthoringSettings";

const source: Constraint = {
  id: "timing", layer: "time", type: "lag", plain_name: "Payment within 30 days", description: "Older authored label",
  params: { a: ["Order"], b: ["Pay"], delta: 12, width: 4, unit: "D", pairing: "first", on_missing: "ignore" },
  applicability: { all: [{ attr: "company", in: ["A"] }, { attr: "vendor", in: ["Rare supplier"] }] },
};
const inventory = { caseTableId: "t", caseNoun: "items", cases: 100, events: 200, activities: [{ label: "Order", cases: 100, events: 100, share: 1 }], attributes: [] };
function setup(options: { fail?: boolean; gate?: Promise<void> } = {}) {
  const changed = vi.fn(); let fail = options.fail;
  server.use(http.get("*/projects/guided-editor/norms/inventory", async () => {
    if (options.gate) await options.gate;
    if (fail) { fail = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
    return HttpResponse.json(inventory);
  }));
  function Harness() {
    const [constraint, setConstraint] = useState(source);
    const [applicability, setApplicability] = useState(false);
    const change = (next: Constraint) => { changed(next); setConstraint(next); };
    return <><NormAuthoringSettings /><button onClick={() => setApplicability(previous => !previous)}>Switch editor</button>
      {applicability ? <ApplicabilityEditor constraint={constraint} exclusion={{ excluded: false, note: "" }} onExclusionChange={() => {}} flowTypes={[]} attributes={[]} caseNoun="items" onChange={change} />
        : <RuleEditor projectId="guided-editor" caseTableId="t" constraint={constraint} caseNoun="items" onChange={change} />}
    </>;
  }
  render(<QueryClientProvider client={makeTestQueryClient()}><Harness /></QueryClientProvider>);
  return { changed };
}

it("shows the generated current rule beside the older name and preserves unedited parameters and scope", async () => {
  const original = structuredClone(source); const api = setup(); const user = userEvent.setup();
  await screen.findByLabelText("Constraint name");
  expect(screen.getByLabelText("Constraint name")).toHaveValue("Payment within 30 days");
  expect(screen.getByRole("region", { name: "Rule from current settings" })).toHaveTextContent("Pay follows Order within 12 days, with 4 days of tolerance");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByText(/Not found in this prepared table’s activity catalogue: Pay/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit activities" }));
  expect(screen.getByRole("button", { name: "Remove Pay" })).toBeVisible();
  expect(api.changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Hide activity choices" }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Advanced rule parameters", { exact: true })).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("within")); await user.type(screen.getByLabelText("within"), "9");
  expect(screen.getByTestId("rule-sentence")).toHaveTextContent("within 9 days");
  expect(screen.getByLabelText("Constraint name")).toHaveValue("Payment within 30 days");
  expect(api.changed.mock.lastCall?.[0]).toEqual({ ...source, params: { ...source.params, delta: 9 } });
  expect(source).toEqual(original);
  await expectNoSeriousA11yViolations(screen.getByTestId("rule-editor"));
});

it("makes advanced rule and compound-scope controls available only after an explicit Settings choice", async () => {
  const api = setup(); const user = userEvent.setup(); await screen.findByLabelText("Constraint name");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByText("Advanced rule parameters", { exact: true }));
  const parameters = screen.getByLabelText("Rule parameters (JSON object)");
  expect(JSON.parse((parameters as HTMLTextAreaElement).value)).toEqual(source.params);
  await user.clear(parameters); await user.click(parameters); await user.paste("[]");
  await user.click(screen.getByRole("button", { name: "Apply parameters to form" }));
  expect(screen.getByRole("alert")).toHaveTextContent("current rule is unchanged");
  expect(api.changed).not.toHaveBeenCalled();
  await user.clear(parameters); await user.click(parameters); await user.paste(JSON.stringify({ ...source.params, delta: 7 }));
  await user.click(screen.getByRole("button", { name: "Apply parameters to form" }));
  expect(screen.getByTestId("rule-sentence")).toHaveTextContent("within 7 days");
  await user.click(screen.getByRole("button", { name: "Switch editor" }));
  await user.click(screen.getByText("Advanced applicability clause", { exact: true }));
  expect(JSON.parse((screen.getByLabelText("Applicability (JSON object)") as HTMLTextAreaElement).value)).toEqual(source.applicability);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByLabelText("Applicability (JSON object)")).not.toBeInTheDocument();
  expect(api.changed).toHaveBeenCalledTimes(1);
  expect(api.changed.mock.lastCall?.[0].applicability).toEqual(source.applicability);
});

it("keeps the actual rule readable during a slow inventory request and never replaces it with zero evidence", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = setup({ gate });
  expect(screen.getByTestId("rule-sentence")).toHaveTextContent("within 12 days");
  expect(screen.queryByText(/0 activities/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Constraint name")).not.toBeInTheDocument();
  await act(async () => { release(); await gate; });
  await screen.findByLabelText("Constraint name");
  expect(api.changed).not.toHaveBeenCalled();
});

it("keeps the generated rule on an inventory error and retries without modifying the rule", async () => {
  const api = setup({ fail: true }); const user = userEvent.setup();
  await screen.findByTestId("inventory-unavailable");
  expect(screen.getByTestId("rule-sentence")).toHaveTextContent("Pay follows Order within 12 days");
  await user.click(screen.getByRole("button", { name: "Retry activities and attributes" }));
  await screen.findByLabelText("Constraint name");
  expect(api.changed).not.toHaveBeenCalled();
});

it("retains an attribute absent from the picker catalogue and makes missing summary parameters explicit", async () => {
  server.use(http.get("*/projects/guided-metric/norms/inventory", () => HttpResponse.json(inventory)));
  const onChange = vi.fn();
  render(<QueryClientProvider client={makeTestQueryClient()}><RuleEditor projectId="guided-metric" caseTableId="t" constraint={{ id: "value", layer: "l", type: "metric", params: { attribute: "rare_attribute", threshold: 0.7, width: 0.1 } }} caseNoun="items" onChange={onChange} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Which value of the item" })).toHaveValue("rare_attribute"));
  expect(screen.getByRole("option", { name: "rare attribute — not in the available catalogue" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Rule from current settings" })).getByText(/rare attribute stays at or below 0.7/)).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
  expect(ruleSentence({ ...source, params: {} })).toContain("activity not set");
  expect(ruleSentence({ ...source, params: {} })).not.toContain("undefined");
  expect(ruleSentence({ ...source, type: "custom", description: "Old title says 100", params: {} })).toContain("generated summary is not available");
  expect(ruleSentence({ ...source, type: "custom", description: "Old title says 100", params: {} })).not.toContain("Old title says 100");
});

it("keeps JSON behind Settings in Guided mode and reveals it on request", async () => {
  const user = userEvent.setup(); renderApp("/p/p2p2018/norms/nv_7?tab=constraints&constraint=c_l3_invoice_to_clear_days");
  await screen.findByRole("tab", { name: "Constraints" }, { timeout: 8000 });
  expect(screen.queryByRole("tab", { name: "JSON" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("tab", { name: "JSON" })).toBeVisible();
});

it("honours an explicitly bookmarked JSON tab even in Guided mode", async () => {
  renderApp("/p/p2p2018/norms/nv_7?tab=json");
  expect(await screen.findByRole("tab", { name: "JSON" }, { timeout: 8000 })).toHaveAttribute("aria-selected", "true");
});
