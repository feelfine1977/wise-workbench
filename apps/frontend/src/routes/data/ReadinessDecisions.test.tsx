import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { readinessCoverage, readinessShare } from "./ReadinessDecisions";

const T = { timeout: 8000 };

describe("decisions on the data caveats (R2-O1)", () => {
  it("every item that allows a decision has a button; the preview shows cases and events; applying rebuilds the case table and lists the decision", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
    const report = await screen.findByTestId("readiness-decisions", {}, T);
    await within(report).findByRole("button", { name: /Review recent-unclosed handling/ }, T);
    expect(within(report).getAllByRole("button", { name: /Drop the events outside the window|Treat placeholder dates|Remove identical prepared event rows|Mark day-precise|Type the header events|Review recent-unclosed handling|Decide how items without a value|Assign the flow types/ }).length).toBe(8);
    await user.click(within(report).getByRole("button", { name: /Remove identical prepared event rows/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Preview the effect" }));
    const preview = await within(dialog).findByTestId("decision-preview", {}, T);
    expect(preview).toHaveTextContent(/5,089 of 251,734 cases · 180,913 of 1,595,923 events affected/);
    expect(within(dialog).getByRole("button", { name: /Apply and rebuild/ })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("note *"), "duplicates come from the export, agreed with the owner");
    await user.type(within(dialog).getByLabelText("author"), "u.jessen");
    await user.click(within(dialog).getByRole("button", { name: /Apply and rebuild/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), T);
    const list = await screen.findByTestId("decisions-list", {}, T);
    expect(list).toHaveTextContent(/Remove identical prepared event rows/);
    expect(list).toHaveTextContent(/u\.jessen/);
    expect(list).toHaveTextContent(/duplicates come from the export/);
    // the screen now shows the rebuilt case table, whose report carries the decision
    await waitFor(() => expect(screen.getByText(/Decided \(collapse exact duplicate events\)/)).toBeInTheDocument(), T);
    expect(screen.getByRole("region", { name: "Jobs" })).toHaveTextContent(/Rebuild the case table/);
  });
});

describe("the readiness report as a list of decisions (R3-19)", () => {
  it("puts what is still undecided first, worst first, and says the machine's sentence only behind a click", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
    const report = await screen.findByTestId("readiness-decisions", {}, T);
    await within(report).findByRole("button", { name: /Review recent-unclosed handling/ }, T);
    const ids = [...report.querySelectorAll("[data-readiness-item]")].map((el) => el.getAttribute("data-readiness-item"));
    // the header replication (93 %) is the first thing a reader has to decide on this log
    expect(ids[0], `the report opens on ${String(ids[0])}`).toBe("header_event_replication");
    // and the readings that need no decision come after the ones that do
    const first = ids.indexOf("volume");
    expect(first).toBeGreaterThan(2);

    // the sentence a reader reads carries no ISO stamp and no `value(s)`; the exact one is behind a summary
    const rows = [...report.querySelectorAll("[data-readiness-item]")] as HTMLElement[];
    for (const row of rows) {
      const shown = row.cloneNode(true) as HTMLElement;
      for (const d of shown.querySelectorAll("details")) d.remove();
      const text = shown.textContent ?? "";
      expect(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.exec(text)?.[0], `“${text.slice(0, 90)}” prints a machine timestamp`).toBeUndefined();
      expect(/value\(s\)/.exec(text)?.[0], `“${text.slice(0, 90)}” prints value(s)`).toBeUndefined();
    }
    // the one that carries an evidence share says what it touches
    expect(within(report).getAllByText(/touches \d/).length).toBeGreaterThan(0);
  });
});


it("states that censoring keeps per-rule policies and exclusion uses the legacy diagnostic", async () => {
  const user = userEvent.setup();
  renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
  const report = await screen.findByTestId("readiness-decisions", {}, T);
  await user.click(await within(report).findByRole("button", { name: /Review recent-unclosed handling/ }, T));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("combobox"));
  expect(await screen.findByRole("option", { name: /Set the observation window.*each rule keeps its missing-event policy/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Exclude cases flagged recently unclosed.*not all unfinished cases/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Keep cases and use each rule’s missing-event policy/ })).toBeInTheDocument();
  expect(screen.queryByText(/ignore the missing closures|not counted as late/)).not.toBeInTheDocument();
});

it("does not display an event collision fraction as a share of cases", () => {
  expect(readinessShare({ id: "event_key_collisions", level: "warn", message: "Collision",
    evidence: { events: 1, share: 0.25, casesShare: 1 } }, 1)).toBe(1);
  expect(readinessShare({ id: "duplicate_events", level: "warn", message: "Identical",
    evidence: { events: 1, share: 0.25, casesShare: 1 } }, 1)).toBe(1);
});

it("keeps each readiness denominator explicit, including unknown and zero populations", () => {
  const item = (id: string, evidence: Record<string, unknown>) => ({ id, level: "warn" as const, message: "Evidence", evidence });
  expect(readinessCoverage(item("missing_timestamps", { events: 1, share: 1 / 44 }), 10)).toEqual({ share: 1 / 44, population: "recorded events" });
  expect(readinessCoverage(item("header_event_replication", { replicatedShare: 0.594, casesFlagged: 0 }), 10)).toEqual({ share: 0.594, population: "header events" });
  expect(readinessCoverage(item("tied_timestamps", { share: 0.174, casesShare: 0.31 }), 10)).toEqual({ share: 0.31, population: "cases" });
  expect(readinessCoverage(item("right_censored", { share: 0.2, cases: 2 }), 10)).toEqual({ share: 0.2, population: "cases" });
  expect(readinessCoverage(item("new_diagnostic", { share: 0.6 }), 10)).toBeUndefined();
  expect(readinessCoverage(item("new_diagnostic", { cases: 0 }), 0)).toBeUndefined();
  expect(readinessCoverage(item("new_diagnostic", { casesShare: 0 }), 10)).toEqual({ share: 0, population: "cases" });
  expect(readinessCoverage(item("new_diagnostic", { casesShare: Number.NaN }), 10)).toBeUndefined();
});

it("renders event and header-event shares without relabelling them as cases", async () => {
  renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
  const report = await screen.findByTestId("readiness-decisions", {}, T);
  await within(report).findByRole("button", { name: /Review recent-unclosed handling/ }, T);
  const row = (id: string) => report.querySelector(`[data-readiness-item="${id}"]`) as HTMLElement;
  expect(row("header_event_replication")).toHaveTextContent(/touches 93\.1% of the header events/);
  expect(row("timestamp_outliers")).toHaveTextContent(/of the recorded events/);
  expect(row("tied_timestamps")).toHaveTextContent(/touches 31% of the cases/);
  expect(row("header_event_replication")).not.toHaveTextContent(/touches 93(?:\.1)?% of the (?:cases|purchase order items)/);
});
