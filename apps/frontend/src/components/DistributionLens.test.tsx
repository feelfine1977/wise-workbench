import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Distribution } from "@wise/api-schema";
import { DistributionLens } from "./DistributionLens";

const data: Distribution = { threshold: 10, width: 20, unit: "D", direction: "high", bins: [{ x0: 0, x1: 30, n: 4 }], ecdf: [[5, 0], [25, 1]], stats: { n: 4, shareBeyondThreshold: 0.25, shareBeyondSaturation: 0 } };

it("replaces explored values with the selected saved distribution and labels estimates", () => {
  const props = { mode: "plain" as const, constraintId: "lag", title: "Invoice timing", groupName: "all items", noun: "items" };
  const view = render(<DistributionLens {...props} distribution={data} />);
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("25% of all items with a value are beyond the expected 10 days");
  fireEvent.change(screen.getByLabelText("ϑ threshold (D)"), { target: { value: "15" } });
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("About 50%");
  expect(screen.getByText(/percentage is estimated/)).toBeVisible();
  view.rerender(<DistributionLens {...props} distribution={{ ...data, threshold: 12 }} />);
  expect(screen.getByLabelText("ϑ threshold (D)")).toHaveValue(12);
  expect(screen.getByLabelText("W width (D)")).toHaveValue(20);
  expect(screen.getByTestId("lens-sentences")).toHaveTextContent("25% of all items with a value are beyond the expected 12 days");
  expect(screen.getByRole("img")).toHaveAccessibleName(/expected 12.00/);
  expect(screen.queryByText(/percentage is estimated/)).not.toBeInTheDocument();
  expect(screen.queryByText(/against everyone else/)).not.toBeInTheDocument();
});
