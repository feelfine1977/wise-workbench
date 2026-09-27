import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import type { NormRelevance } from "@/lib/api/normRelevance";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { NormDisplayControls } from "./NormDisplayControls";
import { ConstraintLayerMap } from "./ConstraintLayerMap";
import { allNormItems, constraintVisible } from "./normVisibility";
import type { NormDocument } from "./normAuthoring";
const document: NormDocument = { layers: [{ id: "a", name: "Delivery" }, { id: "b", name: "Payment" }], views: [{ name: "Finance", layer_weights: { a: 0, b: 3 } }], constraints: [
  { id: "c1", layer: "a", type: "presence", description: "Delivered", params: {}, weight: 2 },
  { id: "c2", layer: "b", type: "presence", description: "Invoice paid", params: {} },
  { id: "c3", layer: "b", type: "metric", description: "Unknown measure", params: {} },
] };
const relevance: NormRelevance = { normVersionId: "v", caseTableId: "t", cases: 1000, constraints: [
  { id: "c1", casesInScope: 800, observedCases: 400, missingActivities: [], issues: [] },
  { id: "c2", casesInScope: 799, observedCases: 799, missingActivities: [], issues: [] },
  { id: "c3", casesInScope: null, observedCases: null, missingActivities: [], issues: ["Missing column"] },
] };
function Harness() {
  const [visibility, setVisibility] = useState(allNormItems);
  return <><NormAuthoringSettings><NormDisplayControls document={document} relevance={relevance} visibility={visibility} onChange={setVisibility} /></NormAuthoringSettings>
    <NormDisplayControls compact document={document} relevance={relevance} visibility={visibility} onChange={setVisibility} />
    <ConstraintLayerMap document={document} relevance={relevance} visibility={visibility} onConstraint={() => {}} onStructure={() => {}} /></>;
}
it("filters exact unrounded applicability at arbitrary percentages, excluding unknown and empty evidence", () => {
  const visible = (minApplicability: number, data = relevance) => document.constraints!.filter(c => constraintVisible(c, { ...allNormItems, minApplicability }, data)).map(c => c.id);
  expect(visible(80)).toEqual(["c1"]);
  expect(visible(79.9)).toEqual(["c1", "c2"]);
  expect(visible(80.1)).toEqual([]);
  expect(visible(0)).toEqual(["c1", "c2", "c3"]);
  expect(visible(1, { ...relevance, cases: 0 })).toEqual([]);
  expect(constraintVisible(document.constraints![0]!, { ...allNormItems, minApplicability: 1 })).toBe(false);
});
it("lets users choose a flexible cutoff and removes empty layers from the map without changing weights", async () => {
  const user = userEvent.setup(); render(<Harness />);
  expect(screen.queryByRole("spinbutton", { name: /Minimum applicability/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.clear(screen.getByRole("spinbutton", { name: /Minimum applicability/ }));
  await user.type(screen.getByRole("spinbutton", { name: /Minimum applicability/ }), "80");
  expect(screen.getByRole("slider", { name: "Minimum applicability slider" })).toHaveValue("80");
  expect(screen.getByRole("spinbutton", { name: /Minimum applicability/ })).toHaveValue(80);
  expect(screen.getByRole("region", { name: "Layer: Delivery", hidden: true })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Layer: Payment", hidden: true })).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText("1 / 3 constraints match")).toBeVisible();
  const number = screen.getByRole("spinbutton", { name: /Minimum applicability/ });
  await user.clear(number); await user.type(number, "79.9");
  expect(screen.getByRole("region", { name: "Layer: Payment", hidden: true })).toBeVisible();
  expect(screen.queryByText(/unknown layer/)).not.toBeInTheDocument();
  expect(document.views![0]!.layer_weights).toEqual({ a: 0, b: 3 });
  await user.click(screen.getByRole("button", { name: "Show everything again" }));
  expect(screen.getByText("3 / 3 constraints match")).toBeVisible();
});
it("hides and restores layers and individual rules separately, without removing them from the saved norm", async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByText("Choose layers and constraints to show"));
  const panel = screen.getByRole("region", { name: "Simplify the norm picture" });
  await user.click(within(panel).getByRole("checkbox", { name: "Delivery" }));
  expect(screen.queryByRole("region", { name: "Layer: Delivery" })).not.toBeInTheDocument();
  await user.click(within(panel).getByRole("checkbox", { name: "Invoice paid" }));
  await expectNoSeriousA11yViolations(screen.getByRole("dialog"));
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Expand constraints in Payment" }));
  expect(screen.queryByRole("button", { name: "Open constraint Invoice paid" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open constraint Unknown measure" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Show everything again" }));
  expect(screen.getByRole("button", { name: "Open constraint Invoice paid" })).toBeVisible();
  expect(document.constraints).toHaveLength(3);
  expect(screen.getByLabelText("Norm display status")).toHaveTextContent("No display filters");
});
