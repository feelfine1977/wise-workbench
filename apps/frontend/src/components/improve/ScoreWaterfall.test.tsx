import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Table } from "@wise/api-schema";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { scoreWaterfallData } from "./chartData";
import { ScoreExplanation } from "./ScoreExplanation";
import { ScoreWaterfall } from "./ScoreWaterfall";

const drivers: Table = { columns: ["constraint", "layer", "delta_gap"], rows: [["worse", "timing", .3], ["better", "quality", -.1], ["zero", "quality", 0]] };
const names: Record<string, string> = { worse: "Invoice payment completed outside the agreed contractual payment terms", better: "Invoice and receipt amounts agree", zero: "No difference in recorded approvals" };
const props = { drivers, baseline: .8, groupScore: .6, groupName: "Packaging", view: "General", selected: true, noun: "purchase order items", plainOf: (id: string) => names[id] ?? id, layerNames: { timing: "Timing", quality: "Quality" }, onSelect: vi.fn() };

it("reverses penalty differences and exactly joins the measured score endpoints", () => {
  const data = scoreWaterfallData(drivers, .8, .6)!;
  expect(data.all.map(row => row.delta)).toEqual([-.3, .1, -0]);
  expect(data.all[0]).toMatchObject({ constraint: "worse", before: .8, after: .5 });
  expect(data.all[1]).toMatchObject({ constraint: "better", before: .5, after: .6 });
  expect(data.net).toBeCloseTo(-.2, 12);
  expect(data.all.at(-1)!.after).toBeCloseTo(data.groupScore, 12);
  const aboveBaseline = scoreWaterfallData({ ...drivers, rows: [["better", "quality", -.15]] }, .6, .75)!;
  expect(aboveBaseline.net).toBe(.15);
  expect(aboveBaseline.all[0]!.after).toBe(.75);
});

it.each([
  [drivers, undefined, .6], [drivers, null, .6], [drivers, "0.8", .6], [drivers, .8, NaN],
  [drivers, .8, 1.01], [drivers, -.2, .6], [drivers, .8, .61],
  [{ ...drivers, rows: [["missing", "timing", null]] }, .8, .8],
  [{ ...drivers, rows: [["wrong", "timing", Infinity]] }, .8, .6],
  [{ ...drivers, rows: [["duplicate", "timing", .1], ["duplicate", "quality", .1]] }, .8, .6],
  [{ ...drivers, rows: [["a", "timing", 1e308], ["b", "timing", 1e308], ["c", "quality", -1e308], ["d", "quality", -1e308]] }, .8, .8],
  [{ ...drivers, rows: [] }, .8, .8],
])("refuses unavailable or inconsistent means and contributions (%j, %j, %j)", (table, baseline, groupScore) => {
  expect(scoreWaterfallData(table as Table, baseline, groupScore)).toBeUndefined();
});

it("sums every remaining signed contribution, including offsets and zero, without a residual", () => {
  const rows = [.3, -.1, .03, -.02, .01, -.005, .004, -.003, .002, 0].map((value, index) => [`rule-${index}`, "area", value]);
  const data = scoreWaterfallData({ ...drivers, rows }, .85, .632)!;
  expect(data.remaining).toBe(4);
  expect(data.collapsed).toHaveLength(7);
  expect(data.collapsed.at(-1)!.delta).toBeCloseTo(-.003, 14);
  expect(data.all).toHaveLength(10);
  expect(data.collapsed.at(-1)!.after).toBeCloseTo(data.groupScore, 14);
  expect(data.all.at(-1)!.after).toBeCloseTo(data.groupScore, 14);
  expect(data.all.map(row => row.constraint)).toContain("rule-9");
});

it("shows full labels, signed magnitudes, whole-group scope, a keyboard path and a complete table", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const { container } = render(<ScoreWaterfall {...props} onSelect={onSelect} />);
  const down = screen.getByRole("button", { name: `Inspect ${names.worse}: −30.00 score points` });
  expect(down).toHaveTextContent(names.worse!);
  down.focus(); await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenLastCalledWith("worse");
  screen.getByRole("button", { name: `Inspect ${names.better}: +10.00 score points` }).focus();
  await user.keyboard(" ");
  expect(onSelect).toHaveBeenLastCalledWith("better");
  expect(screen.getByText(/Means use scored purchase order items/)).toBeVisible();
  expect(screen.getByText(/Filters and parent selection do not rescore/)).toBeVisible();
  expect(screen.getByRole("list", { name: "Score contribution key" })).toHaveTextContent("+ Higher score · lower penalty");
  await user.click(screen.getByText("Table alternative"));
  const table = screen.getByRole("table", { name: "Waterfall contributions and measured mean scores" });
  expect(table).toHaveTextContent("80.000000");
  expect(table).toHaveTextContent("60.000000");
  expect(table).toHaveTextContent("-30.000000");
  expect(table).toHaveTextContent("+10.000000");
  await user.click(within(table).getByRole("button", { name: names.zero }));
  expect(onSelect).toHaveBeenLastCalledWith("zero");
  await expectNoSeriousA11yViolations(container);
});

it("expands the exact remainder into individually selectable expectations", async () => {
  const user = userEvent.setup();
  const many: Table = { ...drivers, rows: Array.from({ length: 9 }, (_, index) => [`id-${index}`, "timing", .01]) };
  const onSelect = vi.fn();
  render(<ScoreWaterfall {...props} drivers={many} baseline={.8} groupScore={.71} onSelect={onSelect} />);
  const remainder = screen.getByRole("button", { name: "Expand Remaining 3 expectations: −3.00 score points" });
  remainder.focus(); await user.keyboard("{Enter}");
  expect(screen.queryByRole("button", { name: /^Expand Remaining/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Signed expectation contributions" })).getAllByRole("button")).toHaveLength(9);
  await user.click(screen.getByRole("button", { name: "Inspect id-8: −1.00 score points" }));
  expect(onSelect).toHaveBeenLastCalledWith("id-8");
  await user.click(screen.getByRole("button", { name: "Show six largest contributions" }));
  expect(screen.getByRole("button", { name: "Expand Remaining 3 expectations: −3.00 score points" })).toBeVisible();
});

it("defaults to score effects and retains the icicle as a separately labelled penalty view", async () => {
  const user = userEvent.setup();
  render(<ScoreExplanation {...props} />);
  expect(screen.getByTestId("score-waterfall")).toBeVisible();
  expect(screen.getByTestId("contribution-icicle")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Waterfall · score change" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Icicle · penalty breakdown" }));
  expect(screen.getByTestId("contribution-icicle")).toBeVisible();
  expect(screen.getByTestId("score-waterfall")).not.toBeVisible();
  await user.click(screen.getByRole("button", { name: "Waterfall · score change" }));
  expect(screen.getByTestId("score-waterfall")).toBeVisible();
});

it("does not draw a partial or invented waterfall when reconciliation fails", () => {
  render(<ScoreWaterfall {...props} groupScore={.5} />);
  expect(screen.getByText(/Both measured mean scores and all signed contributions must reconcile/)).toBeVisible();
  expect(screen.queryByRole("list", { name: "Signed expectation contributions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
