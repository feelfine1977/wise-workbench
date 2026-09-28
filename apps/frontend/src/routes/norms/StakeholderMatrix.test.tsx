import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { StakeholderMatrix } from "./StakeholderMatrix";
import { membershipBatch } from "./membershipBatch";
import { layerTotal, rawViewWeights, withGeneralBenchmark } from "./viewMembership";
import type { NormDocument } from "./normAuthoring";

const document: NormDocument = withGeneralBenchmark({
  layers: [{ id: "a", name: "Completion" }, { id: "b", name: "Timing" }],
  constraints: [
    { id: "invoice", layer: "a", type: "presence", description: "Invoice present", params: {}, weight: 9 },
    { id: "receipt", layer: "a", type: "presence", description: "Receipt present", params: {}, weight: 1 },
    { id: "lag", layer: "b", type: "lag", description: "Pay on time", params: {}, weight: 1 },
  ], views: [{ name: "Operations", layer_weights: { a: 4, b: 2 } }, { name: "Finance", constraint_weights: { invoice: 3, receipt: 0, lag: 1 } }],
});

it("applies memberships as a set, preserves totals and ratios, and leaves unselected views and rules intact", () => {
  const before = structuredClone(document);
  const result = membershipBatch(document, ["Operations", "General"], ["invoice", "unknown"], false);
  expect(result.changes).toEqual([{ view: "Operations", constraint: "invoice", included: false }]);
  expect(rawViewWeights(result.document, result.document.views![0]!)).toEqual({ invoice: 0, receipt: 4, lag: 2 });
  expect(result.document.views![1]).toEqual(document.views![1]);
  expect(result.document.constraints).toEqual(document.constraints);
  const restored = membershipBatch(result.document, ["Operations"], ["invoice", "receipt"], true);
  expect(rawViewWeights(restored.document, restored.document.views![0]!)).toEqual({ invoice: 3.6, receipt: .4, lag: 2 });
  expect(layerTotal(restored.document, restored.document.views![0]!, "a")).toBe(4);
  expect(membershipBatch(restored.document, ["Operations"], ["invoice", "receipt"], true).changes).toEqual([]);
  expect(document).toEqual(before);
});

it("recomputes General after the last membership disappears, without keeping stale included constraints", () => {
  const result = membershipBatch(document, ["Operations", "Finance"], ["invoice", "receipt", "lag"], false);
  expect(rawViewWeights(result.document, result.document.views!.at(-1)!)).toEqual({ invoice: 0, receipt: 0, lag: 0 });
  const added = membershipBatch(result.document, ["Finance"], ["invoice", "receipt"], true);
  expect(rawViewWeights(added.document, added.document.views![1]!)).toEqual({ invoice: .9, receipt: .1, lag: 0 });
});

it("previews selected rows and columns before editing, keeps General read-only, and undoes the draft change", async () => {
  const user = userEvent.setup(); const changed = vi.fn(); const edit = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(document);
    return <StakeholderMatrix document={draft} onChange={next => { changed(next); setDraft(next); }} onEdit={edit} onConstraint={() => {}} />;
  }
  render(<Harness />);
  expect(screen.getAllByRole("columnheader")[1]).toHaveTextContent("General");
  await user.click(screen.getByRole("button", { name: "Change several memberships" }));
  expect(screen.queryByRole("checkbox", { name: "Select view General" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Select view Operations" }));
  await user.click(screen.getByRole("button", { name: "Expand matrix layer Completion" }));
  await user.click(screen.getByRole("checkbox", { name: "Select constraint Invoice present" }));
  expect(screen.getByRole("checkbox", { name: "Select layer Completion" })).toBePartiallyChecked();
  await user.click(screen.getByRole("button", { name: "Preview exclusion" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("list", { name: "Membership changes" })).toHaveTextContent("Operations · Invoice present → excluded");
  expect(changed).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Preview exclusion" }));
  await user.click(screen.getByRole("button", { name: "Apply to draft" }));
  const next = changed.mock.calls[0]![0] as NormDocument;
  expect(next.views![1]).toEqual(document.views![1]);
  expect(rawViewWeights(next, next.views!.at(-1)!)).toEqual({ invoice: .5, receipt: .5, lag: 1 });
  await user.click(screen.getByRole("button", { name: "Undo membership change" }));
  expect(changed.mock.calls[1]![0]).toEqual(document);
  await user.click(screen.getByRole("button", { name: "Edit Finance: Timing" }));
  expect(edit).toHaveBeenCalledWith("Finance", "b");
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Stakeholder weighting matrix" }));
});

it("bounds long expanded lists, selects all pages deliberately, and retains row identity for focus", async () => {
  const user = userEvent.setup(); const edit = vi.fn(); const change = vi.fn();
  const large = withGeneralBenchmark({ ...document, constraints: Array.from({ length: 125 }, (_, i) => ({ id: `c${i}`, layer: "a", type: "presence", description: `Expectation ${i}`, params: {}, weight: 1 })), views: [{ name: "Operations", layer_weights: { a: 1 } }] });
  const ui = render(<StakeholderMatrix document={large} onChange={change} onEdit={edit} onConstraint={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Expand matrix layer Completion" }));
  expect(screen.getAllByRole("button", { name: /^Expectation \d+ c\d+$/ })).toHaveLength(12);
  await user.click(screen.getByRole("button", { name: "Next expectations in Completion" }));
  expect(screen.getByRole("button", { name: "Expectation 12 c12" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit Operations: Expectation 12" }));
  expect(edit).toHaveBeenCalledWith("Operations", "a", "c12");
  await user.click(screen.getByRole("button", { name: "Change several memberships" }));
  await user.click(screen.getByLabelText("Select layer Completion"));
  await user.click(screen.getByLabelText("Select view Operations"));
  expect(screen.getByText("125 constraints · 1 views selected")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Preview exclusion" }));
  expect(within(screen.getByRole("list", { name: "Membership changes" })).getAllByRole("listitem")).toHaveLength(125);
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  ui.rerender(<StakeholderMatrix document={large} focusRequest={{ layer: "b", revision: 1 }} onChange={change} onEdit={edit} onConstraint={() => {}} />);
  expect(screen.getByRole("button", { name: "Expand matrix layer Timing" })).toHaveFocus();
});

it("marks invalid weights, prevents bulk editing, and reports orphaned expectations", async () => {
  const user = userEvent.setup();
  const invalid = { ...document, views: [{ name: "Operations", layer_weights: { a: NaN, b: 1 } }], constraints: [...document.constraints!, { ...document.constraints![0]!, id: "orphan", layer: "missing" }] };
  render(<StakeholderMatrix document={invalid} onChange={() => {}} onEdit={() => {}} onConstraint={() => {}} />);
  expect(screen.getByText(/1 expectations have no matching layer/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit Operations: Completion" })).toHaveTextContent("Invalid weight");
  await user.click(screen.getByRole("button", { name: "Change several memberships" }));
  await user.click(screen.getByLabelText("Select layer Completion"));
  await user.click(screen.getByLabelText("Select view Operations"));
  expect(screen.getByRole("button", { name: "Preview exclusion" })).toBeDisabled();
});

it("does not offer undo after another draft edit", async () => {
  const user = userEvent.setup(); const change = vi.fn();
  const ui = render(<StakeholderMatrix document={document} onChange={change} onEdit={() => {}} onConstraint={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Change several memberships" }));
  await user.click(screen.getByLabelText("Select layer Completion"));
  await user.click(screen.getByLabelText("Select view Operations"));
  await user.click(screen.getByRole("button", { name: "Preview exclusion" }));
  await user.click(screen.getByRole("button", { name: "Apply to draft" }));
  const next = change.mock.calls[0]![0] as NormDocument;
  ui.rerender(<StakeholderMatrix document={{ ...next, name: "Subsequent edit" }} onChange={change} onEdit={() => {}} onConstraint={() => {}} />);
  expect(screen.queryByRole("button", { name: "Undo membership change" })).not.toBeInTheDocument();
});
