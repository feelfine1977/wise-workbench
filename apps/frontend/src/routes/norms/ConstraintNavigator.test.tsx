import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { ConstraintNavigator } from "./ConstraintNavigator";
import type { NormRelevance } from "@/lib/api/normRelevance";
import type { NormDocument } from "./normAuthoring";
const doc: NormDocument = {
  name: "Process reliability", metadata: { authoring: { goal: "Deliver the customer promise" } },
  layers: [{ id: "time", name: "Timeliness" }, { id: "quality", name: "Quality", description: "Check the evidence before judging performance" }],
  constraints: [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, layer: "time", type: "presence", description: `Timing expectation ${i}`, params: {} })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, layer: "quality", type: "presence", description: `Quality expectation ${i}`, params: {} })),
  ],
};
function Harness({ initial }: { initial?: string }) {
  const [selected, setSelected] = useState(initial);
  return <ConstraintNavigator document={doc} selected={doc.constraints!.find(c => c.id === selected)} overview={!selected} missing={["q19"]} warnings={new Map()} onSelect={setSelected} onOverview={() => setSelected(undefined)} />;
}
it("starts with purpose and two collapsed layers, then reveals only a bounded part of one layer", async () => {
  const user = userEvent.setup(); render(<Harness />);
  expect(screen.getByText("Deliver the customer promise")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Timing expectation/ })).not.toBeInTheDocument();
  screen.getByRole("button", { name: "Explore Quality" }).focus(); await user.keyboard("{Enter}");
  const list = screen.getByRole("region", { name: "Quality" });
  expect(within(list).getAllByRole("button", { name: /Quality expectation/ })).toHaveLength(8);
  expect(screen.queryByRole("button", { name: /Timing expectation/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByRole("button", { name: "Quality expectation 8" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "← All layers" }));
  expect(screen.getByRole("button", { name: "Explore Timeliness" })).toBeVisible();
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Constraint hierarchy" }));
});
it("filters unresolved work at both levels and provides global search without showing the whole catalogue", async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.click(screen.getByRole("checkbox", { name: /Needs review only/ }));
  expect(screen.queryByRole("button", { name: "Explore Timeliness" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Explore Quality" }));
  expect(screen.getByRole("checkbox", { name: /Needs review only/ })).toBeChecked();
  expect(screen.getByRole("button", { name: /^Quality expectation 19/ })).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByRole("button", { name: /^Quality expectation 19/ }));
  expect(screen.queryByRole("button", { name: "Quality expectation 0" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Needs review only/ }));
  await user.type(screen.getByRole("searchbox", { name: "Find a constraint" }), "Timing expectation 12");
  expect(screen.getByRole("status")).toHaveTextContent("1 matches across all layers");
  await user.click(screen.getByRole("button", { name: /Timing expectation 12/ }));
  expect(screen.getByRole("region", { name: "Timeliness" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Timing expectation 12" })).toHaveAttribute("aria-pressed", "true");
});
it("opens a deep link on the page containing its selected constraint", () => {
  render(<Harness initial="q19" />);
  expect(screen.getByRole("button", { name: /^Quality expectation 19/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("17–20 shown");
});

it("guided mode folds low-coverage rules away, search and expert mode recover them without deleting rules", async () => {
  const user = userEvent.setup();
  const rules = [
    { id: "pay", layer: "flow", type: "presence", description: "Record payment", params: { activity: "Pay" } },
    { id: "ship", layer: "flow", type: "presence", description: "Record shipment", params: { activity: "Ship" } },
    { id: "returns", layer: "flow", type: "presence", description: "Record returns", params: {}, applicability: { flow_type: "returns" } },
  ];
  const relevance = { normVersionId: "v", caseTableId: "t", cases: 100, constraints: [
    { id: "pay", casesInScope: 100, observedCases: 0, missingActivities: ["Pay"], issues: [] },
    { id: "ship", casesInScope: 100, observedCases: 85, missingActivities: [], issues: [] },
    { id: "returns", casesInScope: 0, observedCases: 0, missingActivities: [], issues: [] },
  ] };
  function EvidenceHarness() {
    const [selected, setSelected] = useState("ship");
    return <><NormAuthoringSettings /><ConstraintNavigator document={{ layers: [{ id: "flow", name: "Flow" }], constraints: rules }} selected={rules.find(c => c.id === selected)} overview={false} missing={[]} warnings={new Map()} onSelect={setSelected} onOverview={() => {}} relevance={relevance} evidenceState="ready" /></>;
  }
  render(<EvidenceHarness />);
  expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record shipment" })).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "Show lower-evidence constraints (2)" }));
  expect(screen.getByRole("button", { name: "Record payment" })).toBeVisible();
  expect(screen.getByText("0 applicable cases")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "expert");
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByLabelText("Current norm settings")).toHaveTextContent("Expert");
  expect(screen.getAllByRole("button", { name: /^Record/ }).map(el => el.getAttribute("aria-label"))).toEqual(["Record payment", "Record shipment", "Record returns"]);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "guided");
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("checkbox", { name: "Show lower-evidence constraints (2)" }));
  await user.type(screen.getByRole("searchbox"), "payment");
  await user.click(screen.getByRole("button", { name: "Record payment" }));
  expect(screen.getByText(/This selected rule stays visible/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Record payment" })).toHaveAttribute("aria-pressed", "true");
  expect(rules).toHaveLength(3);
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Constraint hierarchy" }));
});

it("keeps the open branch order stable when coverage changes until explicitly reordered", async () => {
  localStorage.setItem("wise-norm-authoring-preferences", JSON.stringify({ mode: "guided", advancedControls: true }));
  const user = userEvent.setup();
  const document: NormDocument = {
    layers: [{ id: "completion", name: "Completion" }],
    constraints: ["Invoice", "Receipt"].map(id => ({ id, layer: "completion", type: "presence", description: id, params: {} })),
  };
  const evidence = (invoice: number, receipt: number) => ({ normVersionId: "v", caseTableId: "t", cases: 100, constraints: [
    { id: "Invoice", casesInScope: 100, observedCases: invoice, missingActivities: [], issues: [] },
    { id: "Receipt", casesInScope: 100, observedCases: receipt, missingActivities: [], issues: [] },
  ] });
  const props = { document, overview: true, missing: [], warnings: new Map(), onSelect: () => {}, onOverview: () => {} };
  const { rerender } = render(<ConstraintNavigator {...props} relevance={evidence(90, 40)} />);
  await user.click(screen.getByRole("button", { name: "Explore Completion" }));
  const names = () => within(screen.getByRole("region", { name: "Completion" })).getAllByRole("button").map(el => el.getAttribute("aria-label"));
  expect(names()).toEqual(["Invoice", "Receipt"]);
  rerender(<ConstraintNavigator {...props} relevance={evidence(40, 90)} />);
  expect(names()).toEqual(["Invoice", "Receipt"]);
  await user.click(screen.getByRole("button", { name: "Reorder by relevance" }));
  expect(names()).toEqual(["Receipt", "Invoice"]);
});


it("identifies the coverage population for a named selection, an unnamed selection and all prepared cases", () => {
  const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 20,
    scope: { kind: "saved_selection", selectionName: "Late invoices" },
    constraints: [{ id: "t0", casesInScope: 10, observedCases: 10, missingActivities: [], issues: [] }],
  };
  const props = { document: doc, selected: doc.constraints![0], overview: false, missing: [], warnings: new Map(), onSelect: () => {}, onOverview: () => {} };
  const { rerender } = render(<ConstraintNavigator {...props} relevance={relevance} />);
  expect(screen.getByText(/Coverage population:/)).toHaveTextContent("Selected cases (Late invoices) · 20 cases");
  expect(screen.getByText(/Applicable:/)).toHaveTextContent("10 / 20 cases (50%)");
  expect(screen.queryByText(/all cases in the prepared dataset/i)).not.toBeInTheDocument();
  rerender(<ConstraintNavigator {...props} relevance={{ ...relevance, scope: { kind: "saved_selection" } }} />);
  expect(screen.getByText(/Coverage population:/)).toHaveTextContent("Selected cases (saved selection)");
  rerender(<ConstraintNavigator {...props} relevance={{ ...relevance, scope: undefined, cases: 100 }} />);
  expect(screen.getByText(/Coverage population:/)).toHaveTextContent("All cases in the prepared dataset · 100 cases");
  expect(screen.getByText(/Applicable:/)).toHaveTextContent("10 / 100 cases (10%)");
});


it.each([
  [1, 1_000_000, "<0.1%"],
  [35, 251_734, "<0.1%"],
  [961, 251_734, "0.4%"],
  [1, 1_000, "0.1%"],
  [249, 1_000, "24.9%"],
  [0, 1_000, "0%"],
  [1_000, 1_000, "100%"],
  [99_999, 100_000, ">99.9%"],
] as const)("shows %i of %i applicable cases as %s without losing rare positive evidence", (applicable, total, percentage) => {
  const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: total,
    scope: { kind: "saved_selection", selectionName: "Review population" },
    constraints: [{ id: "t0", casesInScope: applicable, observedCases: applicable, missingActivities: [], issues: [] }],
  };
  render(<ConstraintNavigator document={doc} selected={doc.constraints![0]} overview={false} missing={[]} warnings={new Map()} onSelect={() => {}} onOverview={() => {}} relevance={relevance} />);
  expect(screen.getByText(/Applicable:/)).toHaveTextContent(`Applicable: ${applicable.toLocaleString()} / ${total.toLocaleString()} cases (${percentage})`);
});

it("does not invent a percentage for an empty population or unknown applicability", () => {
  const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 0,
    constraints: [{ id: "t0", casesInScope: 0, observedCases: 0, missingActivities: [], issues: [] }],
  };
  const props = { document: doc, selected: doc.constraints![0], overview: false, missing: [], warnings: new Map(), onSelect: () => {}, onOverview: () => {} };
  const { rerender } = render(<ConstraintNavigator {...props} relevance={relevance} />);
  expect(screen.getByText(/Applicable:/).textContent).toBe("Applicable: 0 / 0 cases");
  rerender(<ConstraintNavigator {...props} relevance={{ ...relevance, cases: 100, constraints: [{ ...relevance.constraints[0]!, casesInScope: null }] }} />);
  expect(screen.queryByText(/Applicable:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\(0%\)/)).not.toBeInTheDocument();
});


it("prioritizes evidence arriving after load, separates unknowns, and keeps deferred decisions discoverable", async () => {
  const user = userEvent.setup();
  const document: NormDocument = { layers: [{ id: "flow", name: "Flow" }], constraints: [
    { id: "missing", layer: "flow", type: "presence", description: "Payment", params: { activity: "Pay" } },
    { id: "unknown", layer: "flow", type: "presence", description: "Scope unknown", params: { activity: "Check" } },
    { id: "available", layer: "flow", type: "lag", description: "Received within 30 days", params: { a: ["Order"], b: ["Receive"], delta: 12, width: 5, unit: "D" } },
    { id: "zero", layer: "flow", type: "presence", description: "Returns", params: { activity: "Return" } },
    { id: "not-returned", layer: "flow", type: "metric", description: "Value check", params: { attribute: "amount", threshold: 10 } },
  ] };
  const before = structuredClone(document);
  const props = { document, selected: document.constraints![2], overview: false, missing: ["missing"], warnings: new Map(), onSelect: () => {}, onOverview: () => {} };
  const { rerender } = render(<ConstraintNavigator {...props} evidenceState="loading" />);
  const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 100, scope: { kind: "saved_selection", selectionName: "Late invoices" }, constraints: [
    { id: "missing", casesInScope: 100, observedCases: 0, missingActivities: ["Pay"], issues: [] },
    { id: "unknown", casesInScope: null, observedCases: 0, missingActivities: ["Check"], issues: ["Scope column unavailable"] },
    { id: "available", casesInScope: 20, observedCases: 20, missingActivities: [], issues: [] },
    { id: "zero", casesInScope: 0, observedCases: 0, missingActivities: [], issues: [] },
  ] };
  rerender(<ConstraintNavigator {...props} relevance={relevance} evidenceState="ready" />);
  const applicable = screen.getByRole("region", { name: "Applicable constraints" });
  const unknown = screen.getByRole("region", { name: "Evidence to check" });
  expect(within(applicable).getByRole("button", { name: "Received within 30 days" })).toHaveAccessibleDescription("Rule: Receive follows Order within 12 days, with 5 days of tolerance");
  expect(within(unknown).getByRole("button", { name: "Scope unknown" })).toHaveTextContent("Applicability unknown");
  expect(unknown).toHaveTextContent("Scope column unavailable");
  expect(unknown).toHaveTextContent("No evidence was returned for this constraint");
  expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Applicable constraints", "Evidence to check"]);
  expect(screen.queryByRole("button", { name: /^Payment/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Returns" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Needs review only/ }));
  expect(screen.getByRole("button", { name: /^Payment/ })).toBeVisible();
  expect(screen.getByText(/Not observed in the chosen population: Pay/)).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: /Needs review only/ }));
  await user.type(screen.getByLabelText("Find a constraint"), "within 12 days");
  expect(screen.getByRole("button", { name: "Received within 30 days" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 matches across all layers");
  expect(document).toEqual(before);
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Constraint hierarchy" }));
});

it("keeps selected low-evidence rules visible and moves advanced list controls behind Settings", async () => {
  const user = userEvent.setup();
  const props = { document: doc, selected: doc.constraints![0], overview: false, missing: [], warnings: new Map(), onSelect: () => {}, onOverview: () => {}, onHideConstraint: () => {}, onHideLayer: () => {} };
  const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 10, constraints: [{ id: "t0", casesInScope: 0, observedCases: 0, missingActivities: [], issues: [] }] };
  render(<><NormAuthoringSettings /><ConstraintNavigator {...props} relevance={relevance} /></>);
  expect(screen.getByRole("button", { name: "Timing expectation 0" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/This selected rule stays visible/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Reorder by relevance" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Hide constraint/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Reorder by relevance" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Hide constraint Timing expectation 0 from picture" })).toBeVisible();
});


it("withholds stale coverage during a slow check or failed request without opening layers", () => {
  const props = { document: doc, overview: true, missing: [], warnings: new Map(), onSelect: () => {}, onOverview: () => {} };
  const oldEvidence: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 251734, scope: { kind: "saved_selection", selectionName: "Previous population" }, constraints: [
    { id: "t0", casesInScope: 0, observedCases: 0, missingActivities: [], issues: [] },
  ] };
  const { rerender } = render(<ConstraintNavigator {...props} relevance={oldEvidence} evidenceState="loading" />);
  expect(screen.getByRole("note")).toHaveTextContent("Checking applicability and activity coverage for the chosen population");
  expect(screen.queryByText(/Previous population/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0 applicable cases/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Explore Timeliness" })).toHaveAttribute("aria-expanded", "false");
  rerender(<ConstraintNavigator {...props} relevance={oldEvidence} evidenceState="error" />);
  expect(screen.getByRole("note")).toHaveTextContent("Coverage could not be checked");
  expect(screen.queryByText(/Previous population/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Explore Timeliness" })).toHaveAttribute("aria-expanded", "false");
  rerender(<ConstraintNavigator {...props} relevance={oldEvidence} evidenceState="ready" />);
  expect(screen.getByText(/Coverage population:/)).toHaveTextContent("Previous population");
  expect(screen.getByRole("button", { name: "Explore Timeliness" })).toHaveAttribute("aria-expanded", "false");
});
