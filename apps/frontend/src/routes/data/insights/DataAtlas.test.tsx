import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, it, vi } from "vitest";
import { DataAtlas, type DataAtlasProps } from "./DataAtlas";

type Field = NonNullable<DataAtlasProps["data"]["insights"]>["fields"][number];
const field = (name: string, overrides: Partial<Field> = {}): Field => ({
  name, role: "attribute", dataType: "string", distinct: 6,
  missing: { selected: 1, total: 3 }, numeric: null, ...overrides,
});
const fields: Field[] = [
  field("case_id", { role: "case_id", distinct: 20, missing: { selected: 0, total: 0 } }),
  field("n_events", { role: "events", dataType: "int64", missing: { selected: 0, total: 2 }, numeric: { min: 0, median: 2, p90: 8, max: 10 } }),
  field("first_ts", { role: "timestamp", dataType: "timestamp[ns]" }),
  field("region"),
  field("amount", { dataType: "double", numeric: { min: 0, median: null, p90: 0.000001, max: 1200 } }),
  field("complete_field", { missing: { selected: 0, total: 2 } }),
];
function answer(profiles: Field[] = fields): DataAtlasProps["data"] {
  return {
    datasetId: "dataset", caseTableId: "table", caseNoun: "purchase-order items", attribute: "region", attributes: ["region", "amount", "complete_field"],
    summary: { cases: { selected: 4, total: 20 }, events: { selected: 15, total: 80 }, knownSpanCases: 3, unknownSpanCases: 1, unknownStartCases: 1, medianSpanDays: 2, p90SpanDays: 4, firstRecorded: null, lastRecorded: null },
    categories: [], trend: [], trendMonthsPerBucket: 1, trendOmittedEmptyMonths: 0, spans: [],
    details: { rows: [], page: 1, pageSize: 25, total: 4 }, notes: [], insights: { fields: profiles },
  };
}
function setup(data = answer()) {
  const onExploreField = vi.fn();
  const onMissingField = vi.fn();
  return { ...render(<DataAtlas data={data} onExploreField={onExploreField} onMissingField={onMissingField} />), onExploreField, onMissingField };
}
function metric(label: string) {
  return screen.getByText(label, { selector: "dt" }).parentElement!;
}

it("explains composition with response counts and labels field-statistic scopes", () => {
  setup();
  expect(metric("Selected cases")).toHaveTextContent("4of 20 prepared cases");
  expect(metric("Recorded events")).toHaveTextContent("15");
  expect(metric("Context fields")).toHaveTextContent("3");
  expect(screen.getByText("Case unit: purchase-order items")).toBeInTheDocument();
  expect(screen.getByText("6 profiled fields · prepared case table")).toBeInTheDocument();
  const region = screen.getByRole("article", { name: "region" });
  expect(region).toHaveTextContent("6 distinct nonmissing values · all prepared cases");
  expect(region).toHaveTextContent("1 missing of 4 selected cases");
  expect(region).toHaveTextContent("75% recorded in this selection");
  expect(screen.getByText(/Missing is unknown, not zero/)).toBeInTheDocument();
  expect(screen.queryByText(/distinct activities/i)).not.toBeInTheDocument();
});

it("shows twelve fields initially, searches the whole inventory and supports show all", async () => {
  const user = userEvent.setup();
  setup(answer(Array.from({ length: 132 }, (_, index) => field(`field_${index}`, { dataType: index === 131 ? "decimal128" : "string" }))));
  expect(screen.getByText("132 profiled fields · prepared case table")).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(12);
  expect(screen.queryByRole("article", { name: "field_131" })).not.toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "DECIMAL128");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "field_131" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 of 1 matching fields · 132 in the full profile");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  await user.click(screen.getByRole("button", { name: "Show all 132 fields" }));
  expect(screen.getAllByRole("article")).toHaveLength(132);
  await user.click(screen.getByRole("button", { name: "Show first 12" }));
  expect(screen.getAllByRole("article")).toHaveLength(12);
  await user.type(screen.getByRole("searchbox"), "absent column");
  expect(screen.getByText(/No fields match/)).toBeInTheDocument();
});

it("exposes callbacks only for attributes and selected missing values, using native keyboard controls", async () => {
  const user = userEvent.setup();
  const { onExploreField, onMissingField } = setup();
  expect(within(screen.getByRole("article", { name: "case_id" })).queryByRole("button")).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "first_ts" })).queryByRole("button")).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "n_events" })).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select cases missing complete_field" })).not.toBeInTheDocument();
  screen.getByRole("button", { name: "Explore region" }).focus();
  await user.keyboard("{Enter}");
  expect(onExploreField).toHaveBeenCalledExactlyOnceWith("region");
  screen.getByRole("button", { name: "Select cases missing region" }).focus();
  await user.keyboard(" ");
  expect(onMissingField).toHaveBeenCalledExactlyOnceWith("region");
});

it("keeps numeric details progressive and distinguishes zero, unknown and small values", async () => {
  const user = userEvent.setup();
  setup();
  const amount = screen.getByRole("article", { name: "amount" });
  expect(within(amount).getByText("Numeric values in the current selection")).not.toBeVisible();
  await user.click(within(amount).getByText("Field details & numeric summary"));
  expect(within(amount).getByText("Numeric values in the current selection")).toBeVisible();
  expect(within(amount).getByText("Minimum").nextElementSibling).toHaveTextContent(/^0$/);
  expect(within(amount).getByText("Median").nextElementSibling).toHaveTextContent("Unknown");
  expect(within(amount).getByText("90th percentile").nextElementSibling).toHaveTextContent("0.000001");
  expect(amount).toHaveTextContent("3 missing of 20 prepared cases");
});

it("distinguishes unavailable profiles from an empty selection and never claims 100% completeness for no cases", () => {
  const missing = answer();
  missing.insights = null;
  const { rerender, onExploreField, onMissingField } = setup(missing);
  expect(metric("Context fields")).toHaveTextContent("Unavailable");
  expect(screen.getByText(/Field profiles are not available for this dataset view/)).toBeInTheDocument();
  const empty = answer([field("amount", { missing: { selected: 0, total: 3 }, numeric: { min: null, max: null, median: null, p90: null } })]);
  empty.summary.cases.selected = 0;
  empty.summary.events.selected = 0;
  rerender(<DataAtlas data={empty} onExploreField={onExploreField} onMissingField={onMissingField} />);
  expect(screen.getByText("No selected cases")).toBeInTheDocument();
  expect(screen.queryByText(/100% recorded/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Select cases missing/ })).not.toBeInTheDocument();
  expect(screen.getByText(/No cases match the current selection/)).toBeInTheDocument();
});

it("updates selected coverage and event-count unknowns without changing the dictionary inventory", () => {
  const data = answer();
  const { rerender, onExploreField, onMissingField } = setup(data);
  const changed = answer(fields.map((entry) => ({ ...entry, missing: { ...entry.missing, selected: entry.name === "n_events" ? 2 : 0 } })));
  changed.summary.cases.selected = 2;
  changed.summary.events.selected = 0;
  rerender(<DataAtlas data={changed} onExploreField={onExploreField} onMissingField={onMissingField} />);
  expect(metric("Recorded events")).toHaveTextContent("Unknown");
  expect(screen.getByRole("article", { name: "region" })).toHaveTextContent("0 missing of 2 selected cases");
  expect(screen.getByRole("article", { name: "region" })).toHaveTextContent("6 distinct nonmissing values · all prepared cases");
  expect(screen.getByText("6 profiled fields · prepared case table")).toBeInTheDocument();
});

it("provides named controls and a dictionary without serious accessibility violations", async () => {
  const { container } = setup();
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});
