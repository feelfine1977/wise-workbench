import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import type { EChartProps } from "@/components/charts/EChart";
import type { ECharts } from "@/components/charts/echarts";
import { ConcentrationCurve, VolumeGapScatter } from "./BacklogCharts";

const probe = vi.hoisted(() => ({ props: undefined as EChartProps | undefined }));
vi.mock("@/components/charts/EChart", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    EChart: forwardRef(function Mock(props: EChartProps, ref) {
      probe.props = props;
      useImperativeHandle(ref, () => ({ instance: () => undefined }), []);
      return <div role="img" aria-label={props.ariaLabel} />;
    }),
  };
});
interface BacklogChartOption {
  series: { data: (string | number)[][] }[];
  xAxis: { min: number; axisLabel: { formatter: (value: number) => string } };
  yAxis: { axisLabel: { formatter: (value: number) => string } };
  tooltip: { formatter: (params: unknown) => string };
}
function chart() {
  if (!probe.props) throw new Error("Chart not rendered");
  return { ...probe.props, option: probe.props.option as unknown as BacklogChartOption };
}
function row(key: string, n_cases: number, stable_PI: number): BacklogRow {
  return { key, n_cases, stable_PI, gap: 0.12, stable_gap: 0.1, mean_score: 0.7, PI: n_cases * 0.12, rank: 1, PI_lower: n_cases * 0.05, kind: "systematic" };
}

it("keeps scatter data and point selection intact while making large ticks and score-point units readable", async () => {
  const user = userEvent.setup();
  const rows = [row("<Large & long group name>", 1000000, 2000), row("Small", 4, 1)];
  const onSelect = vi.fn();
  render(<VolumeGapScatter rows={rows} activeKey="Small" onSelect={onSelect} />);
  const { option, onEvents, onReady } = chart();
  expect(option.series[1]!.data).toEqual([
    [1000000, 0.12, 2000, "<Large & long group name>", "systematic", 0.05, "<Large & long group name>"],
    [4, 0.12, 1, "Small", "systematic", 0.05, "Small"],
  ]);
  expect(option.xAxis.min).toBeLessThanOrEqual(4);
  expect(option.xAxis.axisLabel.formatter(1000000)).toBe("1M");
  expect(option.yAxis.axisLabel.formatter(0.12)).toBe("12.0");
  const tooltip = option.tooltip.formatter({ data: option.series[1]!.data[0] });
  expect(tooltip).toContain("&lt;Large &amp; long group name&gt;");
  expect(tooltip).toContain("1,000,000");
  expect(tooltip).toContain("12.0 score points");
  expect(tooltip).toContain("5.0 score points");
  onEvents?.click?.({ data: option.series[1]!.data[1] }, {} as ECharts);
  expect(onSelect).toHaveBeenLastCalledWith("Small");
  const dispatchAction = vi.fn();
  onReady?.({ dispatchAction } as unknown as ECharts);
  expect(dispatchAction).toHaveBeenLastCalledWith({ type: "highlight", seriesIndex: 1, dataIndex: 1 });
  await user.click(screen.getByText("Table alternative"));
  const table = screen.getByRole("table", { name: "Cases and shortfall by group" });
  const button = within(table).getByRole("button", { name: "Small", pressed: true });
  button.focus();
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(within(table).getByRole("button", { name: "<Large & long group name>" })).toBeVisible();
  expect(table).toHaveTextContent("1,000,000");
});

it("retains concentration ordering and positive-priority filtering, with full labels available without hover", async () => {
  const user = userEvent.setup();
  const rows = [row("Smaller", 20, 1), row("Zero", 50, 0), row("<Largest & group>", 10, 3)];
  const original = structuredClone(rows);
  render(<ConcentrationCurve rows={rows} />);
  const { option } = chart();
  expect(option.series[0]!.data).toEqual([[1, 0.75, "<Largest & group>"], [2, 1, "Smaller"]]);
  expect(rows).toEqual(original);
  expect(option.tooltip.formatter([{ data: [1, 0.75, "<Largest & group>"] }])).toContain("&lt;Largest &amp; group&gt;");
  expect(screen.getByText(/Top 2 groups: 100%/)).toBeVisible();
  await user.click(screen.getByText("Table alternative"));
  const table = screen.getByRole("table", { name: "Cumulative priority by group rank" });
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["<Largest & group>", "Smaller"]);
  expect(table).toHaveTextContent("75.0%");
});

it("describes an empty concentration curve without claiming ten groups exist", () => {
  render(<ConcentrationCurve rows={[]} />);
  expect(screen.getByText(/No groups with positive priority/)).toBeVisible();
  expect(chart().option.series[0]!.data).toEqual([]);
});
