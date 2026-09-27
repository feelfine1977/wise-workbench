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
