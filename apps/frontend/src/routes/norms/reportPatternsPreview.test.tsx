import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DistributionLens } from "@/components/DistributionLens";
import { lensStats } from "@/components/lens";

// Real aggregate denominator pattern, no case IDs or event data. Native count
// includes missing vendor endpoints; WISE precedence uses missing_b='skip'.
const precedence = {
  constraintId: "rp_invoice_before_order", type: "precedence", direction: "high" as const,
  threshold: 0, width: 1, unit: "events", binary: false,
  bins: [{ x0: 0, x1: 1, n: 233543 }, { x0: 1, x1: 24, n: 3693 }],
  ecdf: [[0, 0.9844332226137685], [23, 1]],
  stats: { n: 237236, nCases: 237236,
    shareBeyondThreshold: 3693 / 237236,
    shareViolated: 3693 / 209946,
  },
};

it("keeps native-threshold shares distinct from WISE evaluated-case shares", () => {
  const stats = lensStats(precedence, 0, 1);
  expect(stats.n).toBe(237236);
  expect(stats.shareViolating).toBe(3693 / 237236);
  expect(stats.shareViolating).not.toBe(precedence.stats.shareViolated);
  render(createElement(DistributionLens, { distribution: precedence, mode: "plain", constraintId: precedence.constraintId, title: "Invoice-before-order candidates", groupName: "all items", noun: "items" }));
  const sentence = screen.getByTestId("lens-sentences");
  expect(sentence).toHaveTextContent("of all items with a value are beyond the expected 0.0 events");
  expect(sentence).not.toHaveTextContent(/WISE|violation|miss it/);
  expect(screen.getByText(/237,236 items with a value/)).toBeVisible();
  // The separate method-stat field retains the actual WISE share. It is not
  // substituted into the native histogram's finite-value denominator.
  expect(screen.getByTestId("lens-stats")).toHaveTextContent("1.8%");
});
