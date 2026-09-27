import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Distribution } from "@wise/api-schema";
import { DistributionLens } from "./DistributionLens";

const data: Distribution = { threshold: 10, width: 20, unit: "D", direction: "high", bins: [{ x0: 0, x1: 30, n: 4 }], ecdf: [[5, 0], [25, 1]], stats: { n: 4, shareBeyondThreshold: 0.25, shareBeyondSaturation: 0 } };

it("replaces explored values with the selected saved distribution and labels estimates", () => {
  const props = { mode: "plain" as const, constraintId: "lag", title: "Invoice timing", groupName: "all items", noun: "items" };
  const view = render(<DistributionLens {...props} distribution={data} />);
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("25% of all items with a value are beyond the expected 10 days");
  fireEvent.change(screen.getByLabelText("Target (days)"), { target: { value: "15" } });
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("About 50%");
  expect(screen.getByText(/percentage is estimated/)).toBeVisible();
  view.rerender(<DistributionLens {...props} distribution={{ ...data, threshold: 12 }} />);
  expect(screen.getByLabelText("Target (days)")).toHaveValue(12);
  expect(screen.getByLabelText("Tolerance width (days)")).toHaveValue(20);
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("25% of all items with a value are beyond the expected 12 days");
  expect(screen.getByRole("img")).toHaveAccessibleName(/expected 12.00/);
  expect(screen.queryByText(/percentage is estimated/)).not.toBeInTheDocument();
  expect(screen.queryByText(/against everyone else/)).not.toBeInTheDocument();
});

it("keeps the target and full penalty readable outside the plot for either direction", () => {
  const props = { distribution: data, mode: "plain" as const };
  const view = render(<DistributionLens {...props} />);
  expect(screen.getByTestId("lens-target-summary")).toHaveTextContent("Target: at most 10 days · Full penalty: 30 days");
  view.rerender(<DistributionLens {...props} direction="low" threshold={30} width={5} />);
  expect(screen.getByTestId("lens-target-summary")).toHaveTextContent("Target: at least 30 days · Full penalty: 25 days");
});


it("keeps binary comparisons read-only but exposes numeric controls when committing calibration", () => {
  const binary: Distribution = { ...data, binary: true, threshold: 0, width: 1, unit: "events", type: "metric" };
  const commit = vi.fn();
  const view = render(<DistributionLens distribution={binary} sliders="never" />);
  expect(screen.getByTestId("lens-binary")).toBeVisible();
  expect(screen.queryByLabelText("Target (events)")).not.toBeInTheDocument();
  view.rerender(<DistributionLens distribution={binary} onCommit={commit} sliders="always" />);
  expect(screen.queryByTestId("lens-binary")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Target (events)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Commit as version…" }));
  expect(commit).toHaveBeenCalledWith({ threshold: 1, width: 1 });
});
