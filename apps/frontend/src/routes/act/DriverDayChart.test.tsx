import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { DriverDayChart } from "./DriverDayChart";
import { eventShare } from "./driverEvidenceFormat";

const buckets = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, events: i === 25 ? 6 : i === 27 ? 2 : 0, cases: i === 25 ? 4 : i === 27 ? 2 : 0 }));

it("shows measured record counts and an accessible exact table without summing daily distinct cases", async () => {
  const { container } = render(<DriverDayChart buckets={buckets} eventTotal={8} caseTotal={5} activityLabel="Clear Invoice" />);
  expect(screen.getByTestId("driver-calendar-reading")).toHaveTextContent("8 dated end-event records across 5 distinct cases. Largest daily bucket: day 26 — 6 records (75.0%)");
  expect(screen.getByRole("group", { name: /end-event records by day of month/ })).toHaveAccessibleName(/Clear Invoice end-event records by day of month/);
  await userEvent.click(screen.getByText("Exact day-of-month table"));
  const table = screen.getByRole("table");
  expect(table).toHaveTextContent("Case denominator: 5 distinct cases");
  expect(table).toHaveTextContent("daily case counts are not additive");
  expect(within(table).getAllByRole("row")).toHaveLength(32);
  const day = within(table).getByRole("rowheader", { name: "26" }).closest("tr")!;
  expect(within(day).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["6", "75.0%", "4"]);
  expect(screen.getByText(/A cluster is a pattern/)).toHaveTextContent("not proof of a scheduled batch");
  await expectNoSeriousA11yViolations(container);
});

it("keeps a zero denominator unavailable, without drawing invented evidence", async () => {
  render(<DriverDayChart buckets={buckets.map(b => ({ ...b, events: 0, cases: 0 }))} eventTotal={0} caseTotal={0} activityLabel="End activity" />);
  expect(screen.queryByRole("group", { name: /end-event records by day of month/ })).not.toBeInTheDocument();
  expect(screen.getByText(/No dated end-event records/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Exact day-of-month table"));
  expect(screen.getAllByRole("cell", { name: "Unavailable" })).toHaveLength(31);
  expect(screen.queryByText(/Largest daily bucket/)).not.toBeInTheDocument();
});

it("keeps tiny positive record shares visible and distinguishes them from zero", () => {
  expect(eventShare(1, 100000)).toBe("<0.1%");
  expect(eventShare(0, 100000)).toBe("0.0%");
  expect(eventShare(1, 0)).toBe("Unavailable");
});


it("inspects individual days without presenting a chart highlight as a case filter", async () => {
  render(<DriverDayChart buckets={buckets} eventTotal={8} caseTotal={5} activityLabel="Clear Invoice" />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Inspect a calendar day"), "26");
  expect(screen.getByTestId("driver-day-inspection")).toHaveTextContent("Day 26: 6 records · 75.0% of dated records · 4 distinct cases");
  expect(screen.getByText(/highlights this chart only/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Inspect a calendar day"), "1");
  expect(screen.getByTestId("driver-day-inspection")).toHaveTextContent("Day 1: 0 records · 0.0% of dated records · 0 distinct cases");
  await user.selectOptions(screen.getByLabelText("Inspect a calendar day"), "");
  expect(screen.getByTestId("driver-day-inspection")).toHaveTextContent("Select a day");
});
