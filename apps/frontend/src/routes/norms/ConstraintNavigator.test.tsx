import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { ConstraintNavigator } from "./ConstraintNavigator";
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
it("starts with purpose and two layer cards, then reveals only a bounded part of one layer", async () => {
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
  expect(screen.getByRole("button", { name: /^Quality expectation 19/ })).toHaveAttribute("aria-pressed", "true");
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
