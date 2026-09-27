import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { Trace } from "@wise/api-schema";
import { TraceTimeline } from "./TraceTimeline";

const firstConstraint = "synthetic_constraint_with_a_long_technical_identifier_for_the_first_recorded_check";
const secondConstraint = "synthetic_constraint_with_a_long_technical_identifier_for_an_independent_check";
const activity = "Repeat the complete synthetic activity name without clipping or abbreviating its final words";
const sample: Trace = {
  caseId: "synthetic-case",
  scores: { example: 0.4 }, violations: { [firstConstraint]: 0.6 },
  events: [
    { activity: "Finish the synthetic case", timestamp: "2026-04-03T08:00:00Z", resource: "finisher" },
    { activity, timestamp: "2026-04-01T08:00:00Z", resource: "first repeat", violates: [firstConstraint] },
    { activity: "Begin the synthetic case", timestamp: "2026-04-01T07:59:59.500Z", resource: "starter" },
    { activity, timestamp: "2026-04-01T08:00:00Z", resource: "-", violates: [secondConstraint, firstConstraint] },
    { activity, timestamp: "2026-04-01T08:00:00.001Z", resource: "last repeat", violates: [secondConstraint] },
    { activity: "Review the synthetic case", timestamp: "2026-04-01T08:01:00Z" },
  ],
};

function rows(caseId = sample.caseId) {
  return within(screen.getByRole("list", { name: `Events in time order for case ${caseId}` })).getAllByRole("listitem");
}

function field(row: HTMLElement, label: string) {
  return within(row).getByText(label, { selector: "dt" }).nextElementSibling;
}

function traceWith(events: Trace["events"]): Trace {
  return { caseId: "edge-case", events };
}

describe("TraceTimeline readability", () => {
  it("shows all six full event names and repeats in chronological rows, with separate measured gaps", async () => {
    const user = userEvent.setup();
    const unchanged = structuredClone(sample);
    render(<TraceTimeline trace={sample} />);
    const events = rows();
    expect(events).toHaveLength(6);
    expect(events.map((row) => within(row).getByText(/synthetic activity|synthetic case/, { selector: "p" }).textContent)).toEqual([
      "Begin the synthetic case", activity, activity, activity, "Review the synthetic case", "Finish the synthetic case",
    ]);
    expect(events.map((row) => field(row, "Since previous event")?.textContent)).toEqual([
      "First timed event", "500 ms", "0 s", "1 ms", "59 s 999 ms", "1 d 23 h 59 min",
    ]);
    expect(screen.getByText("First-to-last span: 2 d 500 ms")).toBeVisible();
    expect(screen.getByText(/Distances are not to scale/)).toBeVisible();
    expect(field(events[1]!, "Resource")).toHaveTextContent("first repeat");
    expect(field(events[2]!, "Resource")).toHaveTextContent(/^-$/);
    expect(field(events[4]!, "Resource")).toHaveTextContent("Not recorded");
    expect(events[2]).not.toHaveTextContent(firstConstraint);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByText("Event table", { selector: "summary" }));
    const table = screen.getByRole("table", { name: "Events of case synthetic-case" });
    const tableRows = within(table).getAllByRole("row").slice(1);
    expect(tableRows).toHaveLength(6);
    tableRows.forEach((row, index) => {
      const cells = within(row).getAllByRole("cell");
      expect(cells[2]?.textContent).toBe(field(events[index]!, "Timestamp")?.textContent);
      expect(cells[3]?.textContent).toBe(field(events[index]!, "Since previous event")?.textContent);
      expect(cells[4]?.textContent).toBe(field(events[index]!, "Resource")?.textContent);
    });
    expect(within(tableRows[2]!).getAllByRole("cell")[5]).toHaveTextContent("C2C1");
    expect(table).not.toHaveTextContent(firstConstraint);
    expect(table).not.toHaveTextContent(secondConstraint);
    expect(sample).toEqual(unchanged);
  });

  it("retains every occurrence beyond the old 24-event density cutoff", () => {
    const events = Array.from({ length: 40 }, (_, index) => ({ activity, timestamp: "2026-04-01T08:00:00Z", resource: `occurrence ${index + 1}` }));
    render(<TraceTimeline trace={traceWith(events)} />);
    const items = rows("edge-case");
    expect(items).toHaveLength(40);
    items.forEach((row, index) => {
      expect(within(row).getByText(activity)).toBeVisible();
      expect(field(row, "Resource")).toHaveTextContent(`occurrence ${index + 1}`);
    });
    expect(screen.getByText("First-to-last span: 0 s")).toBeVisible();
  });

  it("compares instants across offsets and retains exact date, seconds, fraction and offset in both views", async () => {
    const user = userEvent.setup();
    render(<TraceTimeline trace={traceWith([
      { activity: "Later instant", timestamp: "2026-03-28T23:30:00.123456Z" },
      { activity: "Earlier instant", timestamp: "2026-03-29T00:30:00.123455+02:00" },
    ])} />);
    const items = rows("edge-case");
    expect(items[0]).toHaveTextContent("Earlier instant");
    expect(field(items[0]!, "Timestamp")).toHaveTextContent("2026-03-29T00:30:00.123455+02:00");
    expect(field(items[1]!, "Since previous event")).toHaveTextContent("1 h 1 µs");
    await user.click(screen.getByText("Event table", { selector: "summary" }));
    const table = screen.getByRole("table");
    expect(table.querySelectorAll("time")[0]).toHaveAttribute("datetime", "2026-03-29T00:30:00.123455+02:00");
    expect(table.querySelectorAll("time")[0]?.textContent).toBe(items[0]?.querySelector("time")?.textContent);
    expect(table.querySelectorAll("time")[1]?.textContent).toBe(items[1]?.querySelector("time")?.textContent);
  });

  it("supports offset-free recorded clock times without assigning the browser's timezone", () => {
    render(<TraceTimeline trace={traceWith([
      { activity: "Later", timestamp: "2026-03-29T03:30:00" },
      { activity: "Earlier", timestamp: "2026-03-29T01:30:00" },
    ])} />);
    const items = rows("edge-case");
    expect(items[0]).toHaveTextContent("Earlier");
    expect(field(items[0]!, "Timestamp")).toHaveTextContent("2026-03-29T01:30:00");
    expect(field(items[1]!, "Recorded clock gap")).toHaveTextContent("2 h");
    expect(screen.getByText("First-to-last recorded clock span: 2 h")).toBeVisible();
    expect(screen.getByText(/Timezone not supplied/)).toHaveTextContent("daylight-saving adjustments are unknown");
    expect(items[0]?.querySelector("time")).toHaveAttribute("datetime", "2026-03-29T01:30:00");
  });

  it("does not invent ordering or elapsed time when timezone information is mixed", () => {
    render(<TraceTimeline trace={traceWith([
      { activity: "Recorded first", timestamp: "2026-04-01T11:00:00" },
      { activity: "Recorded second", timestamp: "2026-04-01T10:00:00Z" },
      { activity: "Recorded third", timestamp: null },
    ])} />);
    const items = within(screen.getByRole("list", { name: "Events in recorded order for case edge-case" })).getAllByRole("listitem");
    expect(items.map((row) => row.querySelector("p")?.textContent)).toEqual(["Recorded first", "Recorded second", "Recorded third"]);
    items.forEach((row) => expect(field(row, "Since previous event")).toHaveTextContent("Unavailable"));
    expect(screen.getByText("First-to-last span: unavailable (mixed timezone information)")).toBeVisible();
    expect(screen.getByText(/Recorded event order;/)).toHaveTextContent("chronological order is unknown");
  });

  it("keeps missing and invalid times visible without claiming a complete span or zero duration", () => {
    render(<TraceTimeline trace={traceWith([
      { activity: "Missing", timestamp: null },
      { activity: "Later", timestamp: "2026-04-01T12:00:00Z" },
      { activity: "Invalid", timestamp: "not-a-date" },
      { activity: "Earlier", timestamp: "2026-04-01T10:00:00Z" },
      { activity: "Impossible date", timestamp: "2026-02-30T10:00:00Z" },
      { activity: "Empty", timestamp: " " },
    ])} />);
    const items = rows("edge-case");
    expect(items.map((row) => row.querySelector("p")?.textContent)).toEqual(["Earlier", "Later", "Missing", "Invalid", "Impossible date", "Empty"]);
    expect(field(items[1]!, "Since previous event")).toHaveTextContent("2 h");
    for (const row of items.slice(2)) expect(field(row, "Since previous event")).toHaveTextContent("Unavailable");
    expect(field(items[2]!, "Timestamp")).toHaveTextContent("Timestamp not recorded");
    expect(field(items[3]!, "Timestamp")).toHaveTextContent("Invalid timestamp: not-a-date");
    expect(field(items[4]!, "Timestamp")).toHaveTextContent("Invalid timestamp: 2026-02-30T10:00:00Z");
    expect(screen.getByText(/4 events have no usable timestamp/)).toHaveTextContent("chronological position and elapsed time are unknown");
    expect(screen.getByText("First-to-last span: unavailable (some timestamps are unavailable)")).toBeVisible();
    expect(screen.getByRole("region", { name: "Timeline of case edge-case" })).not.toHaveTextContent(/NaN|Invalid Date/);
  });

  it.each([undefined, []])("handles an empty trace (%j)", (events) => {
    render(<TraceTimeline trace={traceWith(events)} />);
    expect(screen.getByText("Case edge-case · 0 events")).toBeVisible();
    expect(screen.getByText("No events recorded for this case.")).toBeVisible();
    expect(screen.getByText("First-to-last span: unavailable (no events)")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each([undefined, "bad", "2026-04-01T08:00:00Z"])("handles one event without a fabricated first-to-last duration (%s)", (timestamp) => {
    render(<TraceTimeline trace={traceWith([{ timestamp }])} />);
    expect(rows("edge-case")).toHaveLength(1);
    expect(screen.getByText("Case edge-case · 1 event")).toBeVisible();
    expect(screen.getByText("First-to-last span: unavailable (at least two timed events needed)")).toBeVisible();
    expect(within(rows("edge-case")[0]!).getByText("Activity not recorded")).toBeVisible();
  });

  it("keeps sub-millisecond ordering and elapsed differences instead of reporting a false zero", () => {
    render(<TraceTimeline trace={traceWith([
      { activity: "Second", timestamp: "2026-04-01T08:00:00.000000002Z" },
      { activity: "First", timestamp: "2026-04-01T08:00:00.000000001Z" },
    ])} />);
    const items = rows("edge-case");
    expect(items[0]).toHaveTextContent("First");
    expect(field(items[1]!, "Since previous event")).toHaveTextContent("1 ns");
    expect(screen.getByText("First-to-last span: 1 ns")).toBeVisible();
  });

  it("provides keyboard toggles for every constraint with controlled, shared selection and full plain names", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    function Controlled() {
      const [highlight, setHighlight] = useState<string>();
      return <TraceTimeline trace={sample} highlight={highlight} onHighlight={(value) => { changed(value); setHighlight(value); }} plainOf={(key) => key === firstConstraint ? "First readable expectation" : "Second readable expectation"} />;
    }
    render(<Controlled />);
    const key = screen.getByRole("region", { name: "Constraint key" });
    expect(within(key).getByText("First readable expectation")).toBeVisible();
    expect(within(key).getByText(firstConstraint)).toBeVisible();
    expect(within(key).getByText(secondConstraint)).toBeVisible();
    expect(key).toHaveTextContent("they do not establish the cause");
    const first = screen.getAllByRole("button", { name: "Highlight constraint C1" })[0]!;
    expect(first).toHaveAccessibleDescription(new RegExp(firstConstraint));
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith(firstConstraint);
    screen.getAllByRole("button", { name: "Highlight constraint C1" }).forEach((button) => expect(button).toHaveAttribute("aria-pressed", "true"));
    await user.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith(undefined);
    await user.tab();
    const second = screen.getAllByRole("button", { name: "Highlight constraint C2" })[0]!;
    expect(second).toHaveFocus();
    await user.keyboard(" ");
    expect(changed).toHaveBeenLastCalledWith(secondConstraint);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByText("Event table", { selector: "summary" }));
    const table = screen.getByRole("table");
    within(table).getAllByRole("button", { name: "Highlight constraint C2" }).forEach((button) => expect(button).toHaveAttribute("aria-pressed", "true"));
  });

  it("links short references to visible complete keys without requiring a highlight callback or plain names", async () => {
    const user = userEvent.setup();
    const { container } = render(<><TraceTimeline trace={sample} /><TraceTimeline trace={{ ...sample, caseId: "another-case" }} /></>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Constraint C1 details" });
    await user.tab();
    expect(links[0]).toHaveFocus();
    for (const link of links) {
      const target = document.getElementById(link.getAttribute("href")!.slice(1));
      expect(target).toBeVisible();
      expect(target).toHaveTextContent(firstConstraint);
      expect(target).toHaveAttribute("tabindex", "-1");
      expect(link.getAttribute("aria-describedby")).toBe(target?.id);
    }
    const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps duplicate summary metadata and every additional field in one compact disclosure", async () => {
    const user = userEvent.setup();
    render(<TraceTimeline trace={{ ...sample, attributes: { n_events: 6, first_ts: "supplied first", last_ts: "supplied last", "case Group": "Example group", one: 1, two: 2, three: 3, final: "Beyond the old six-field cutoff" } }} />);
    const summary = screen.getByText("Case metadata (8 fields)", { selector: "summary" });
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("n_events")).not.toBeVisible();
    expect(screen.getByText("first_ts")).not.toBeVisible();
    expect(screen.getByText("last_ts")).not.toBeVisible();
    await user.tab();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("Beyond the old six-field cutoff")).toBeVisible();
    expect(screen.getByText("Group", { selector: "dt" })).toBeVisible();
  });

  it("has no serious accessibility violations with the event table and constraint key open", async () => {
    const user = userEvent.setup();
    const { container } = render(<TraceTimeline trace={sample} plainOf={() => "A readable expectation"} onHighlight={vi.fn()} />);
    await user.click(screen.getByText("Event table", { selector: "summary" }));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  });
});
