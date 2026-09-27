import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { viewColor } from "@/lib/viewColors";
import { ConstraintLayerMap } from "./ConstraintLayerMap";
import type { NormDocument } from "./normAuthoring";

const norm: NormDocument = {
  name: "Payments",
  layers: [{ id: "time", name: "Timing" }, { id: "quality", name: "Quality" }, { id: "empty", name: "Empty layer" }],
  constraints: [
    { id: "pay", layer: "time", type: "lag", description: "Pay on time", params: { delta: 30 }, weight: 2 },
    { id: "receipt", layer: "quality", type: "presence", description: "Record receipt", params: {}, weight: 0 },
  ],
  views: [
    { name: "Finance", layer_weights: { time: 2, quality: 0, empty: 4 } },
    { name: "Automation", constraint_weights: { pay: 0, receipt: 3 } },
  ],
  metadata: { calibration_pending: ["pay"] },
};
function setup(document: NormDocument = norm) {
  const onConstraint = vi.fn(); const onStructure = vi.fn();
  const result = render(<ConstraintLayerMap document={document} onConstraint={onConstraint} onStructure={onStructure} />);
  return { ...result, onConstraint, onStructure };
}
const layer = (name: string) => screen.getByRole("region", { name: `Layer: ${name}` });

describe("ConstraintLayerMap", () => {
  it("starts with all views, groups shared constraints, and uses identity colors with exact configured weights", () => {
    setup();
    expect(screen.getByRole("button", { name: "All views" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show Finance weights" })).toHaveStyle({ borderLeft: `3px solid ${viewColor("Finance")}` });
    expect(screen.getByRole("button", { name: "Show Automation weights" })).toHaveStyle({ borderLeft: `3px solid ${viewColor("Automation")}` });
    expect(within(layer("Timing")).getByText("Layer weight: 2")).toBeVisible();
    expect(within(layer("Timing")).getByText("Automation · Direct weight: 0 · Not weighted")).toBeVisible();
    expect(within(layer("Quality")).getByText("Layer weight: 0 · Not weighted")).toBeVisible();
    expect(within(layer("Empty layer")).getByText("No weighted constraints in this layer.")).toBeVisible();
    expect(screen.getByText(/not performance scores, causal effects or process flows/)).toBeVisible();
  });

  it("focuses a view and highlights a layer without changing the norm or firing navigation callbacks", async () => {
    const document = structuredClone(norm); const before = structuredClone(document);
    const { onConstraint, onStructure } = setup(document); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show Automation weights" }));
    await user.click(screen.getByRole("button", { name: "Highlight layer Timing" }));
    expect(screen.getByRole("button", { name: "Highlight layer Timing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Automation weights · Highlighted layer: Timing");
    expect(within(layer("Timing")).queryByText("Layer weight: 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Finance weights" })).toBeVisible();
    expect(onConstraint).not.toHaveBeenCalled(); expect(onStructure).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "All views" }));
    await user.click(screen.getByRole("button", { name: "Clear layer highlight" }));
    expect(within(layer("Timing")).getByText("Layer weight: 2")).toBeVisible();
    expect(document).toEqual(before);
  });

  it("keeps direct zero and omitted weights separate from layer weights, including an empty direct map", async () => {
    setup({ ...norm, views: [
      { name: "Both", layer_weights: { time: 999 }, constraint_weights: { pay: 0 } },
      { name: "Empty direct", layer_weights: { time: 888 }, constraint_weights: {} },
    ] });
    const user = userEvent.setup();
    expect(screen.getByText("Both · Direct weight: 0 · Not weighted")).toBeVisible();
    expect(within(layer("Timing")).getByText("Empty direct · Direct weight: 0 · Not weighted (not set)")).toBeVisible();
    expect(screen.queryByText(/999|888/)).not.toBeInTheDocument();
    await user.click(screen.getByText(/Configuration notes/));
    expect(screen.getAllByText(/both weight types are present/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Configured weight relationships" });
    expect(within(table).queryByText("Layer weight", { exact: true })).not.toBeInTheDocument();
    expect(within(table).getAllByText("Direct constraint weight").length).toBeGreaterThan(0);
  });

  it("routes explicit rule, layer and view actions through the provided callbacks", async () => {
    const { onConstraint, onStructure } = setup(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open constraint Pay on time" }));
    expect(onConstraint).toHaveBeenLastCalledWith("pay");
    await user.click(screen.getByRole("button", { name: "Edit layers" }));
    expect(onStructure).toHaveBeenLastCalledWith("layers");
    await user.click(screen.getByRole("button", { name: "Edit Finance weights for layer Timing" }));
    expect(onStructure).toHaveBeenLastCalledWith("views", "Finance");
    await user.click(screen.getByRole("button", { name: "Edit Automation weight for Pay on time" }));
    expect(onStructure).toHaveBeenLastCalledWith("views", "Automation");
    await user.click(screen.getByRole("button", { name: "Expand constraints in Quality" }));
    expect(screen.getByText("Automation · Direct weight: 3")).toBeVisible();
    expect(within(layer("Quality")).getByText("Weight within layer: 0 · Not weighted")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit view weights" }));
    expect(onStructure).toHaveBeenLastCalledWith("views");
    await user.click(screen.getByRole("button", { name: "Show Finance weights" }));
    await user.click(screen.getByRole("button", { name: "Edit view weights" }));
    expect(onStructure).toHaveBeenLastCalledWith("views", "Finance");
  });

  it("bounds long catalogues, finds names and IDs across pages, and restores manual collapse after search", async () => {
    const constraints = Array.from({ length: 125 }, (_, index) => ({ id: `c${index}`, layer: "time", type: "presence", description: `Constraint ${index}`, params: {} }));
    setup({ ...norm, constraints }); const user = userEvent.setup();
    const group = layer("Timing");
    expect(within(group).getAllByRole("button", { name: /Open constraint/ })).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Next constraints in Timing" }));
    expect(screen.getByRole("button", { name: "Open constraint Constraint 12" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Collapse constraints in Timing" }));
    expect(screen.queryByRole("button", { name: /Open constraint/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Find constraints or layers" }), "c124");
    expect(screen.getByRole("button", { name: "Open constraint Constraint 124" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 125 constraints");
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table")).toHaveTextContent("Constraint 124");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "Expand constraints in Timing" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Next weight relationships" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(25);
    await user.type(screen.getByRole("searchbox"), "no matching rule");
    expect(screen.getByText(/No matching constraints or layers/)).toBeVisible();
  });

  it("reports unknown references, unassigned constraints, invalid values and missing weight maps without fabricating weights", async () => {
    setup({
      layers: [{ id: "time", name: "Timing" }],
      constraints: [norm.constraints![0]!, { id: "orphan", layer: "missing", type: "presence", params: {}, description: "Orphan rule" }],
      views: [
        { name: "Unknown", layer_weights: { time: Number.NaN, ghost: 7 } },
        { name: "Missing" },
        { name: "Empty", layer_weights: {} },
        { name: "Direct", constraint_weights: { absent: 8 } },
      ],
    });
    const user = userEvent.setup();
    expect(screen.getByText("Layer weight: Invalid weight")).toBeVisible();
    expect(within(layer("Timing")).getByText("Layer weight: Not configured")).toBeVisible();
    expect(within(layer("Timing")).getByText("Layer weight: 0 · Not weighted (not set)")).toBeVisible();
    expect(layer("Unknown layer: missing")).toHaveTextContent("Layer assignment needs review");
    await user.click(screen.getByRole("button", { name: "Expand constraints in Unknown layer: missing" }));
    expect(screen.getByRole("button", { name: "Open constraint Orphan rule" })).toBeVisible();
    await user.click(screen.getByText(/Configuration notes/));
    expect(screen.getByText(/unknown layer “ghost” — 7/)).toBeVisible();
    expect(screen.getByText(/unknown constraint “absent” — 8/)).toBeVisible();
    expect(screen.getByText("Missing: weights are not configured.")).toBeVisible();
    expect(screen.getByText("Empty: no positive configured weight on an assigned constraint.")).toBeVisible();
  });

  it("offers an exact tabular alternative with separate layer and direct relationships and working navigation", async () => {
    const { onConstraint, onStructure } = setup(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Configured weight relationships" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(table).getAllByText("Layer weight", { exact: true })).toHaveLength(3);
    expect(within(table).getAllByText("Weight within layer", { exact: true })).toHaveLength(2);
    expect(within(table).getAllByText("Direct constraint weight", { exact: true })).toHaveLength(2);
    await user.click(within(table).getAllByRole("button", { name: "Pay on time" })[0]!);
    expect(onConstraint).toHaveBeenLastCalledWith("pay");
    await user.click(within(table).getAllByRole("button", { name: "Automation" })[0]!);
    expect(onStructure).toHaveBeenLastCalledWith("views", "Automation");
    await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Constraint, layer and view map" }));
  });

  it("supports keyboard disclosure and view selection with accessible names", async () => {
    setup(); const user = userEvent.setup();
    const collapse = screen.getByRole("button", { name: "Collapse constraints in Timing" });
    collapse.focus(); await user.keyboard("{Enter}");
    const expand = screen.getByRole("button", { name: "Expand constraints in Timing" });
    expect(expand).toHaveFocus(); expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Open constraint Pay on time" })).toBeVisible();
    const bookmark = screen.getByRole("button", { name: "Show Automation weights" });
    bookmark.focus(); await user.keyboard("{Enter}");
    expect(bookmark).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Constraint, layer and view map" }));
  });

  it("handles an empty norm and offers an explicit path to configure it", async () => {
    const { onStructure } = setup({}); const user = userEvent.setup();
    expect(screen.getByText(/No layers or constraints yet/)).toBeVisible();
    expect(screen.getByText("No views configured.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit layers" }));
    expect(onStructure).toHaveBeenCalledWith("layers");
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("No configured relationships to show.")).toBeVisible();
  });
});
