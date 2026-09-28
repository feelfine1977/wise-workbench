import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConstraintPicker, ConstraintResultsList } from "./ConstraintPicker";
import type { ConstraintEvidence } from "./sceneEvidence";

const constraints: ConstraintEvidence[] = [
  { id: "order", name: "Purchase order must precede the invoice", description: "Chronology of purchase orders and invoices", layer: "L1_order", evaluated: 20, cases: 100, violationShare: 0.5 },
  { id: "completion", name: "Business completion", description: "Case must be complete", layer: "L1_order", evaluated: 40, cases: 100, violationShare: 0.1 },
  { id: "receipt", name: "Exactly one receipt", description: "No duplicate receipts", layer: "L2_receipt", evaluated: 8, cases: 100, violationShare: 0.25 },
  { id: "unknown", name: "Unmapped activity", description: "No supplied evaluation", evaluated: 0, cases: 100 },
];
function Picker() {
  const [selected, setSelected] = useState(["receipt"]);
  return <ConstraintPicker constraints={constraints} selected={selected} onChange={setSelected} />;
}

it("adds every layer constraint, supports checkbox refinement and preserves other layers", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.click(screen.getByRole("button", { name: "Choose constraints" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Business layer" }), "L1_order");
  expect(screen.getByText("3 selected")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: constraints[0]!.name })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Business completion" })).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Business completion" }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear shown" }));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Business layer" }), "");
  expect(screen.getByRole("checkbox", { name: "Exactly one receipt" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByText("0 selected")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Choose constraints" })).toHaveFocus();
});

it("searches full names and meaning, selects only matches, and deliberately selects all shown", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.click(screen.getByRole("button", { name: "Choose constraints" }));
  await user.type(screen.getByRole("searchbox", { name: "Search constraints" }), "chronology");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByText(constraints[0]!.name)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Select shown (1)" }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  await user.click(screen.getByRole("button", { name: "Select shown (4)" }));
  expect(screen.getByText("4 selected")).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "no such constraint");
  expect(screen.getByText("No matching constraints.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select shown (0)" })).toBeDisabled();
  expect(screen.getByText("4 selected")).toBeInTheDocument();
});

it("keeps a large selection bounded with separate results and unknown-denominator handling", async () => {
  const onFocus = vi.fn();
  const many = Array.from({ length: 42 }, (_, index) => ({ ...constraints[index % 4]!, id: String(index), name: `Full constraint name ${index}` }));
  many[5] = { ...many[5]!, evaluated: 101 };
  render(<ConstraintResultsList constraints={many} focusedId="0" onFocus={onFocus} noun="items" placement={(id) => id === "1" ? "Case result only; no map anchor" : "WISE map marks available"} />);
  const region = screen.getByRole("region", { name: "Selected constraint results" });
  expect(region).toHaveClass("h-28", "overflow-y-auto");
  expect(within(region).getAllByRole("button")).toHaveLength(42);
  expect(within(region).getAllByText("50.0% miss this constraint · 20 evaluated items")).toHaveLength(11);
  expect(within(region).getAllByText("No evaluated items; compliance unknown")).toHaveLength(10);
  expect(within(region).getByText("Evaluated denominator unavailable or inconsistent")).toBeInTheDocument();
  await userEvent.setup().click(within(region).getByRole("button", { name: /Full constraint name 1 / }));
  expect(onFocus).toHaveBeenCalledWith("1");
});


it("shows full business layer names and searches them without requiring the technical ids", async () => {
  const user = userEvent.setup();
  render(<ConstraintPicker constraints={[
    { ...constraints[0]!, layer: "L3", layerName: "Agreed payment deadlines" },
    { ...constraints[1]!, layer: "RP_settlement" },
    { ...constraints[2]!, layer: "L7_effort_automation" },
  ]} selected={[]} onChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Choose constraints" }));
  expect(screen.getByRole("option", { name: "Agreed payment deadlines (1)" })).toHaveValue("L3");
  expect(screen.getByRole("option", { name: "Settlement review candidates (1)" })).toHaveValue("RP_settlement");
  expect(screen.getByRole("option", { name: "Effort and automation friction (1)" })).toHaveValue("L7_effort_automation");
  await user.type(screen.getByRole("searchbox"), "Agreed payment deadlines");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByRole("checkbox", { name: constraints[0]!.name })).toBeInTheDocument();
});
