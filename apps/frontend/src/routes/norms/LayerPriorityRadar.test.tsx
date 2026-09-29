import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { LayerPriorityRadar } from "./LayerPriorityRadar";
import { layerPriorityProfile } from "./layerPriorityProfiles";
import { withGeneralBenchmark } from "./viewMembership";
import type { NormDocument } from "./normAuthoring";

const document: NormDocument = withGeneralBenchmark({
  layers: [{ id: "a", name: "Completion" }, { id: "b", name: "Timing" }, { id: "c", name: "Quality" }],
  constraints: [
    { id: "invoice", layer: "a", type: "presence", params: {}, weight: 9 },
    { id: "receipt", layer: "a", type: "presence", params: {}, weight: 1 },
    { id: "lag", layer: "b", type: "lag", params: {}, weight: 1 },
    { id: "quality", layer: "c", type: "presence", params: {}, weight: 1 },
  ], views: [
    { name: "Operations", layer_weights: { a: 6, b: 2, c: 0 } },
    { name: "Finance", constraint_weights: { invoice: 3, receipt: 0, lag: 1, quality: 4 } },
    { name: "Service", layer_weights: { a: 1, b: 1, c: 1 } },
  ],
});

it("normalizes configured priorities by their declared basis without changing the norm", () => {
  const before = structuredClone(document);
  const operations = layerPriorityProfile(document, document.views![0]!);
  expect(operations.basis).toBe("Configured layer weights");
  expect(operations.values).toEqual([{ layer: "a", weight: 6, share: .75 }, { layer: "b", weight: 2, share: .25 }, { layer: "c", weight: 0, share: 0 }]);
  const finance = layerPriorityProfile(document, document.views![1]!);
  expect(finance.basis).toBe("Direct weights summed by layer");
  expect(finance.values.map(v => v.share)).toEqual([.375, .125, .5]);
  expect(layerPriorityProfile(document, document.views!.at(-1)!).values.map(v => v.share)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  expect(document).toEqual(before);
});

it("keeps zero-total, invalid and unresolved profiles unavailable rather than inventing a zero score", () => {
  const invalidWeights: Record<string, number>[] = [{ a: 0, b: 0, c: 0 }, { a: -1 }, { a: NaN }, { a: Infinity }, { a: Number.MAX_VALUE, b: Number.MAX_VALUE }, { missing: 1 }];
  for (const weights of invalidWeights) {
    const profile = layerPriorityProfile(document, { name: "Invalid", layer_weights: weights });
    expect(profile.unavailable).toBeTruthy();
    expect(profile.values.every(v => v.share === null)).toBe(true);
  }
  expect(layerPriorityProfile(document, { name: "Unknown", constraint_weights: { unknown: 1 } }).unavailable).toContain("unknown");
  expect(layerPriorityProfile(document, { name: "Mixed", constraint_weights: { invoice: 1 }, layer_weights: { a: 1 } }).unavailable).toContain("two weight schemes");
  expect(layerPriorityProfile({ ...document, constraints: [{ ...document.constraints![0]!, layer: "missing" }] }, document.views![0]!).unavailable).toContain("missing layer");
  expect(layerPriorityProfile({ ...document, constraints: [{ ...document.constraints![0]!, weight: NaN }] }, document.views![0]!).unavailable).toContain("invalid expectation");
  const invalidReference = { ...document, views: [{ name: "Broken", layer_weights: { a: NaN } }, document.views!.at(-1)!] };
  expect(layerPriorityProfile(invalidReference, invalidReference.views[1]!).unavailable).toContain("derived reference");
});

it("loads the optional radar on demand, limits comparison to three views, and offers exact ratios and keyboard drill-down", async () => {
  const user = userEvent.setup(); const onLayer = vi.fn();
  const ui = render(<LayerPriorityRadar document={document} onLayer={onLayer} />);
  expect(screen.queryByRole("region", { name: "Layer priority comparison" })).not.toBeInTheDocument();
  await user.click(screen.getByText("Compare layer priority profiles", { exact: false, selector: "summary" }));
  const region = screen.getByRole("region", { name: "Layer priority comparison" });
  expect(within(region).getByText(/Priorities, not performance/)).toBeVisible();
  expect(within(region).getByLabelText("Service")).toBeDisabled();
  const table = within(region).getByRole("table");
  const completion = within(table).getByRole("row", { name: /1. Completion/ });
  expect(completion).toHaveTextContent("33.33%1 / 3");
  expect(completion).toHaveTextContent("75.00%6 / 8");
  expect(completion).toHaveTextContent("37.50%3 / 8");
  const axis = screen.getByRole("button", { name: "Locate Timing in priority matrix" });
  axis.focus(); await user.keyboard("{Enter}");
  expect(onLayer).toHaveBeenCalledWith("b");
  await user.click(within(table).getByRole("button", { name: "3. Quality" }));
  expect(onLayer).toHaveBeenLastCalledWith("c");
  await user.click(within(region).getByLabelText("Operations"));
  expect(within(region).getByLabelText("Service")).toBeEnabled();
  await user.click(within(region).getByLabelText("Service"));
  expect(within(table).getByRole("columnheader", { name: /Service/ })).toBeVisible();
  expect(ui.container.querySelector('path[stroke-dasharray="7 4"]')).toBeTruthy();
  await expectNoSeriousA11yViolations(region);
});

it("uses the table for small/large structures and explains unavailable profiles without invalid SVG geometry", async () => {
  const user = userEvent.setup();
  const small = { ...document, layers: document.layers!.slice(0, 2), constraints: document.constraints!.slice(0, 3), views: [{ name: "Empty", layer_weights: { a: 0, b: 0 } }] };
  const ui = render(<LayerPriorityRadar document={small} onLayer={() => {}} />);
  await user.click(screen.getByText("Compare layer priority profiles", { exact: false, selector: "summary" }));
  expect(screen.queryByRole("button", { name: "Radar shape" })).not.toBeInTheDocument();
  expect(screen.getByText(/No positive priority weight/)).toBeVisible();
  expect(screen.getAllByRole("cell", { name: /Unavailable/ })).toHaveLength(2);
  ui.rerender(<LayerPriorityRadar document={{ ...small, layers: Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, name: `Layer ${i}` })) }} onLayer={() => {}} />);
  expect(screen.queryByRole("button", { name: "Radar shape" })).not.toBeInTheDocument();
  expect(ui.container.querySelector("svg.priority-radar")).toBeNull();
  expect(ui.container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("updates the table when draft weights change and permits an intentionally empty selection", async () => {
  const user = userEvent.setup();
  const ui = render(<LayerPriorityRadar document={document} onLayer={() => {}} />);
  await user.click(screen.getByText("Compare layer priority profiles", { exact: false, selector: "summary" }));
  const next = { ...document, views: document.views!.map(v => v.name === "Operations" ? { ...v, layer_weights: { a: 2, b: 6, c: 0 } } : v) };
  ui.rerender(<LayerPriorityRadar document={next} onLayer={() => {}} />);
  expect(screen.getByRole("row", { name: /1. Completion/ })).toHaveTextContent("25.00%2 / 8");
  for (const name of ["General", "Operations", "Finance"]) await user.click(screen.getByLabelText(name));
  expect(screen.getByText("Select a view to compare its layer priorities.")).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
