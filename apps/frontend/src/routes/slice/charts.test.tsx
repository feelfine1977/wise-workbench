import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Table } from "@wise/api-schema";
import type { EChartProps } from "@/components/charts/EChart";
import type { ECharts } from "@/components/charts/echarts";
import { GapWaterfall, LayerBars, PenaltyPareto } from "./charts";

const probe = vi.hoisted(() => ({ props: undefined as EChartProps | undefined }));
vi.mock("@/components/charts/EChart", () => ({
  EChart: (props: EChartProps) => {
    probe.props = props;
    return <div role="img" aria-label={props.ariaLabel} />;
  },
}));
interface SliceChartOption {
  yAxis: { data: string[]; axisLabel: { overflow: string; interval: number } };
  series: { data: unknown[]; xAxisIndex?: number }[];
  tooltip: { formatter: (params: unknown) => string };
}
function chart() {
  if (!probe.props) throw new Error("Chart not rendered");
  return { ...probe.props, option: probe.props.option as unknown as SliceChartOption };
}

it("preserves signed waterfall contributions and selects the correct ID even for identical display labels", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const drivers: Table = { columns: ["constraint", "delta_gap"], rows: [["a", 0.25], ["b", -0.1], ["c", 0.03], ["d", 0.02], ["invalid", null]] };
  render(<GapWaterfall drivers={drivers} gap={0.2} maxBars={2} onSelect={onSelect} plainOf={() => "A shared expectation label"} />);
  const { option, onEvents } = chart();
  expect(option.yAxis.data).toEqual(["A shared expectation label", "A shared expectation label", "other (2)", "the shortfall"]);
  expect(option.series[0]!.data).toEqual([0, 0.75, 0.75, 0]);
  expect((option.series[1]!.data as { value: number }[]).map((d) => d.value)).toEqual([1.25, 0, 0.25, 1]);
  expect(option.series[2]!.data).toEqual([0, 0.5, 0, 0]);
  onEvents?.click?.({ dataIndex: 1, name: "A shared expectation label" }, {} as ECharts);
  expect(onSelect).toHaveBeenLastCalledWith("b");
  onEvents?.click?.({ dataIndex: 2 }, {} as ECharts);
  onEvents?.click?.({ dataIndex: 3 }, {} as ECharts);
  expect(onSelect).toHaveBeenCalledTimes(1);
  await user.click(screen.getByText("Table alternative"));
  const table = screen.getByRole("table", { name: "Expectation shares of the shortfall" });
  const buttons = within(table).getAllByRole("button");
  buttons[1]!.focus();
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenLastCalledWith("b");
  expect(within(table).getByRole("row", { name: "the shortfall 100%" })).toBeVisible();
  expect(screen.getByText(/The shortfall is 20.00 score points/)).toBeVisible();
});

it("keeps full long labels and tooltip text, with height that grows instead of truncating labels", () => {
  const label = "<Receipt & approval> must precede every invoice from the international services department";
  render(<GapWaterfall drivers={{ columns: ["constraint", "delta_gap"], rows: [[label, 0.2], [label + " again", 0.1]] }} gap={0.3} height={180} />);
  const { option, height } = chart();
  expect(option.yAxis.data[0]).toBe(label);
  expect(option.yAxis.axisLabel).toMatchObject({ overflow: "break", interval: 0 });
  expect(height).toBeGreaterThan(400);
  expect(option.tooltip.formatter([{ axisValue: label, dataIndex: 0 }])).toContain("&lt;Receipt &amp; approval&gt;");
});

it("preserves Pareto ordering, the tail aggregation and the cumulative values in its table", async () => {
  const user = userEvent.setup();
  const penaltyMass: Table = {
    columns: ["key", "n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "rank"],
    rows: [["Small", 5, 1, 0.2, 0.1, 1, 3], ["Long supplier name without truncation", 20, 6, 0.3, 0.6, 0.6, 1], ["Medium", 10, 3, 0.3, 0.3, 0.9, 2]],
  };
  const original = structuredClone(penaltyMass);
  render(<PenaltyPareto penaltyMass={penaltyMass} top={1} by="suppliers" />);
  const { option } = chart();
  expect(option.yAxis.data).toEqual(["Long supplier name without truncation", "other suppliers (2)"]);
  expect(option.series[0]!.data).toEqual([0.6, 0.4]);
  expect(option.series[1]!.data).toEqual([0.6, 1]);
  expect(option.series[1]!.xAxisIndex).toBe(1);
  expect(penaltyMass).toEqual(original);
  await user.click(screen.getByText("Table alternative"));
  expect(screen.getByRole("table", { name: "Shortfall by sub-group" })).toHaveTextContent("other suppliers (2)1540.0%100.0%");
});

it("exposes full area names and labels absolute differences as score points", async () => {
  const user = userEvent.setup();
  const name = "International commercial approval and complete documentation";
  render(<LayerBars layers={{ columns: ["layer", "slice_mean", "global_mean", "delta"], rows: [["area", 0.15, 0.1, 0.05]] }} layerNames={{ area: name }} />);
  expect(within(screen.getByRole("list")).getByText(name)).not.toHaveClass("truncate");
  expect(screen.getAllByRole("meter").map((meter) => meter.getAttribute("aria-valuenow"))).toEqual(["0.15", "0.1"]);
  await user.click(screen.getByText("Table alternative"));
  expect(screen.getByRole("columnheader", { name: "difference (score points)" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "5.00" })).toBeVisible();
});
