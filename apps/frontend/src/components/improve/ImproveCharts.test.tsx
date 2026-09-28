import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { BacklogRow, Table } from "@wise/api-schema";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { ContributionIcicle } from "./ContributionIcicle";
import { EvidenceSupport } from "./EvidenceSupport";
import { MeasuredComparison } from "./MeasuredComparison";
import { PrioritySupport } from "./PrioritySupport";
import { contributionData, measuredPair, supportStages } from "./chartData";

const drivers: Table = { columns: ["constraint", "layer", "delta_gap"], rows: [["a", "one", .3], ["b", "one", -.1], ["c", "two", 0]] };
const row = (key: string, cases: number, priority: number): BacklogRow => ({ key, n_cases: cases, stable_PI: priority, gap: .2, stable_gap: .1, PI: 2, mean_score: .6, rank: 1 });

it("retains signed offsets and zero contributions without manufacturing a residual", () => {
  const data = contributionData(drivers, .2)!;
  expect(data.positive).toBe(.3);
  expect(data.offsets).toBe(.1);
  expect(data.drivers).toHaveLength(3);
  expect(contributionData(drivers, .3)).toBeUndefined();
  expect(contributionData(drivers, undefined)).toBeUndefined();
  expect(contributionData({ ...drivers, rows: [...drivers.rows, ["bad", "one", null]] }, .2)).toBeUndefined();
  expect(contributionData({ ...drivers, rows: [["a", "one", .1], ["a", "one", .1]] }, .2)).toBeUndefined();
});

it("lets keyboard users select the exact contribution ID even when labels match", async () => {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const { container } = render(<ContributionIcicle drivers={drivers} signedGap={.2} view="General" selected plainOf={() => "Shared label"} layerNames={{ one: "First area" }} onSelect={onSelect} />);
  expect(screen.getByTestId("contribution-icicle")).toHaveTextContent(/10.00 points of offsets ≈ 20.00 points/);
  expect(screen.getByText(/filters and parent selection do not rescore/)).toBeVisible();
  const offset = screen.getByRole("button", { name: "Shared label: −10.00 score points" });
  offset.focus();
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenLastCalledWith("b");
  await user.click(screen.getByText("Table alternative"));
  const table = screen.getByRole("table", { name: "Signed score contributions by expectation" });
  const zero = within(table).getAllByRole("button")[2]!;
  zero.focus();
  await user.keyboard(" ");
  expect(onSelect).toHaveBeenLastCalledWith("c");
  expect(table).toHaveTextContent("-10.000");
  await expectNoSeriousA11yViolations(container);
});

it("withholds icicle geometry when a complete additive breakdown cannot be verified", () => {
  render(<ContributionIcicle drivers={drivers} signedGap={.5} selected={false} plainOf={(id) => id} layerNames={{}} onSelect={vi.fn()} />);
  expect(screen.getByText(/exact additive breakdown is unavailable/)).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("keeps native units and measured zero, without using the shift estimate as a median difference", async () => {
  const { container } = render(<MeasuredComparison row={{ median_group: 0, median_elsewhere: 12, shift: 999, unit: "H", n_evaluated_group: 12, n_evaluated_elsewhere: 25 }} label="Waiting" selected view="Finance" />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Median: whole group 0.00 hours; rest of run 12.00 hours");
  expect(container).not.toHaveTextContent("999");
  expect(screen.getByText(/filters and parent selection do not apply/)).toBeVisible();
  await expectNoSeriousA11yViolations(container);
});

it("uses evaluated-case rates for binary expectations instead of unitless medians", () => {
  expect(measuredPair({ median_group: 0, median_elsewhere: 1, unit: null, share_missed_group: .25, share_missed_elsewhere: 0 })).toMatchObject({ here: 25, elsewhere: 0, measure: "Missed", unit: "% of evaluated cases" });
});

it.each([
  { median_group: null, median_elsewhere: 12, unit: "D" },
  { median_group: "0", median_elsewhere: 12, unit: "D" },
  { median_group: Infinity, median_elsewhere: 12, unit: "D" },
  { share_missed_group: .2, share_missed_elsewhere: null },
  { share_missed_group: 1.1, share_missed_elsewhere: .2 },
  { share_missed_group: .2, share_missed_elsewhere: .1, comparison: "group_vs_all" },
  { share_missed_group: .2, share_missed_elsewhere: .1, n_evaluated_elsewhere: 0 },
])("does not fabricate a measured comparison from %j", (value) => {
  expect(measuredPair(value)).toBeUndefined();
});

it.each([[100, null, 2], [100, 90, undefined], [100, 90, 91], [100, 101, 90], [100, 90, 2.5], [100, 90, -1]])("refuses non-nested or missing support (%s, %s, %s)", (group, scored, evaluated) => {
  expect(supportStages(group, scored, evaluated)).toBeUndefined();
});

it("shows exact nested support, including measured zero, without interpreting it as approval", async () => {
  const { container } = render(<EvidenceSupport group={100} scored={70} evaluated={0} label="Receipt" view="General" selected />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Whole group: 100 cases; Scored in this view: 70 cases; Evaluated for this expectation: 0 cases");
  expect(screen.getByText(/Coverage is not a conversion rate/)).toBeVisible();
  expect(screen.getByText(/filters and parent selection do not apply/)).toBeVisible();
  await expectNoSeriousA11yViolations(container);
});

it("labels partial loaded groups and uses exact keys from points and table with keyboard access", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const rows = [row('["A"]', 10, 1), row('["B"]', 20, 4), row('["Zero"]', 0, 0), row('["Missing"]', NaN, 1)];
  const { container } = render(<PrioritySupport rows={rows} total={1000} scope="This page · General" onSelect={onSelect} />);
  expect(screen.getByText(/4 of 1,000 matching groups loaded/)).toBeVisible();
  expect(screen.getByText(/1 groups lack valid counts/)).toBeVisible();
  expect(within(screen.getByRole("list", { name: "Highest priorities among loaded groups" })).getAllByRole("button")[0]).toHaveTextContent("B");
  screen.getByRole("button", { name: "Investigate B: 20 cases, priority 4.00" }).focus();
  await user.keyboard(" ");
  expect(onSelect).toHaveBeenLastCalledWith('["B"]');
  await user.click(screen.getByText("Table alternative"));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Zero" }));
  expect(onSelect).toHaveBeenLastCalledWith('["Zero"]');
  expect(screen.getByRole("button", { name: "Investigate Zero: 0 cases, priority 0.00" })).toBeVisible();
  await expectNoSeriousA11yViolations(container);
});
