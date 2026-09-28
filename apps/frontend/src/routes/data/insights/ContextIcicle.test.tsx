import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ContextIcicle } from "./ContextIcicle";
import { expectNoSeriousA11yViolations } from "@/test/utils";

const data = { fields: ["region", "company", "vendor"], cells: [
  { keys: ["v1", "v1", "v1"], labels: ["Europe", "A", "X"], total: 80, selected: 20 },
  { keys: ["v1", "v2", "v2"], labels: ["Europe", "B", "Y"], total: 20, selected: 10 },
] };
it("uses conserved full-population D3 partitions and proportional selected overlays", async () => {
  const onToggle = vi.fn();
  const { container, rerender } = render(<ContextIcicle data={data} branches={[]} onToggle={onToggle} />);
  const leaves = [...container.querySelectorAll('[data-depth="3"]')];
  expect(leaves.map((leaf) => Number(leaf.querySelector("rect")!.getAttribute("width")))).toEqual([720, 180]);
  expect(leaves.map((leaf) => Number(leaf.querySelector('[data-selected-overlay]')!.getAttribute("width")))).toEqual([180, 90]);
  const leaf = screen.getByRole("button", { name: /vendor = X;/ });
  fireEvent.keyDown(leaf, { key: "Enter" });
  expect(onToggle).toHaveBeenCalledWith({ facets: [{ field: "region", keys: [], values: ["Europe"] }, { field: "company", keys: [], values: ["A"] }, { field: "vendor", keys: [], values: ["X"] }] });
  await expectNoSeriousA11yViolations(container);
  rerender(<ContextIcicle data={{ ...data, cells: data.cells.map((c) => ({ ...c, selected: 0 })) }} branches={[]} onToggle={onToggle} />);
  expect([...container.querySelectorAll('[data-depth="3"]')].map((leaf) => Number(leaf.querySelector("rect")!.getAttribute("width")))).toEqual([720, 180]);
});
it("discloses the rendering limit without showing a partial hierarchy as complete", () => {
  render(<ContextIcicle data={{ ...data, cells: Array.from({ length: 501 }, () => data.cells[0]!) }} branches={[]} onToggle={vi.fn()} />);
  expect(screen.getByText(/supports up to 500 occupied leaf groups/)).toHaveTextContent("No cases or branches have been dropped");
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});
