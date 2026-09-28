import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { NormHierarchyChart } from "./NormHierarchyChart";

it("uses rule counts, drills into a family without selecting a rule, and bounds the leaf list", async () => {
  const user = userEvent.setup(); const open = vi.fn();
  const groups = [{ id: "time", name: "Timeliness", matches: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, layer: "time", type: i < 20 ? "lag" : "presence", description: `Expectation ${i}`, params: {} })) }];
  const ui = render(<NormHierarchyChart groups={groups} onConstraint={open} />);
  expect(screen.getByText(/Area = number of visible rules/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Explore Timeliness / Time · 20 rules" }));
  expect(open).not.toHaveBeenCalled();
  const list = screen.getByRole("region", { name: "Expectations in selected area" });
  expect(within(list).getAllByRole("button", { name: /Expectation/ })).toHaveLength(8);
  await user.click(screen.getByRole("button", { name: "Next expectations" }));
  await user.click(screen.getByRole("button", { name: "Expectation 8" }));
  expect(open).toHaveBeenCalledWith("c8");
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Norm hierarchy overview" }));
  ui.rerender(<NormHierarchyChart groups={[{ ...groups[0]!, matches: [] }]} onConstraint={open} />);
  expect(screen.getByText(/No visible rules/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "Expectations in selected area" })).not.toBeInTheDocument();
  expect(ui.container.innerHTML).not.toContain("NaN");
});
