import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { RuleEditor, type Constraint } from "./Builder";

const total = 251734;
const activities = [
  { label: "Record Goods Receipt", cases: total, events: total, share: 1 },
  { label: "Release Purchase Order", cases: 961, events: 1000, share: 961 / total },
  { label: "Change Currency", cases: 35, events: 35, share: 35 / total },
  { label: "No recorded occurrence", cases: 0, events: 0, share: 0 },
  { label: "Share not supplied", cases: 20, events: 20 },
];
const original: Constraint = { id: "lag", layer: "time", type: "lag", params: { a: ["Record Goods Receipt"], b: [], delta: 30, width: 10, unit: "D" } };
function setup(inventory: Record<string, unknown> = { cases: total, events: 300000, activities }) {
  const changed = vi.fn();
  const reads: string[] = [];
  server.use(http.get("*/projects/p/norms/inventory", ({ request }) => {
    reads.push(new URL(request.url).searchParams.get("caseTableId")!);
    return HttpResponse.json({ ...inventory, caseTableId: "ct_picker", caseNoun: "purchase order items", attributes: [] });
  }));
  function Harness() {
    const [constraint, setConstraint] = useState(original);
    return <RuleEditor projectId="p" caseTableId="ct_picker" constraint={constraint} caseNoun="cases" onChange={next => { changed(next); setConstraint(next); }} />;
  }
  render(<QueryClientProvider client={makeTestQueryClient()}><Harness /></QueryClientProvider>);
  return { changed, reads };
}

it("uses roving focus, arrows and Home/End without changing selection; Enter/Space toggle and Tab leaves each list", async () => {
  const before = structuredClone(original); const { changed, reads } = setup(); const user = userEvent.setup();
  const first = await screen.findByRole("listbox", { name: "First this: the activities of this log" });
  const options = within(first).getAllByRole("option");
  expect(first).toHaveAttribute("aria-multiselectable", "true");
  expect(options.filter(option => option.tabIndex === 0)).toHaveLength(1);
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  options[0]!.focus(); await user.keyboard("{ArrowDown}"); expect(options[1]).toHaveFocus();
  await user.keyboard("{End}"); expect(options.at(-1)).toHaveFocus();
  await user.keyboard("{ArrowUp}"); expect(options.at(-2)).toHaveFocus();
  await user.keyboard("{Home}"); expect(options[0]).toHaveFocus();
  expect(changed).not.toHaveBeenCalled();
  await user.keyboard("{ArrowDown} ");
  expect(options[1]).toHaveAttribute("aria-selected", "true");
  expect(changed.mock.lastCall?.[0].params.a).toEqual(["Record Goods Receipt", "Release Purchase Order"]);
  await user.keyboard("{Enter}");
  expect(options[1]).toHaveAttribute("aria-selected", "false");
  expect(changed.mock.lastCall?.[0].params.a).toEqual(["Record Goods Receipt"]);
  await user.tab();
  const secondSearch = screen.getByLabelText("Then this: search the activities of this log");
  expect(secondSearch).toHaveFocus();
  await user.keyboard("{ArrowDown}{End}{Home}{Enter}");
  const second = screen.getByRole("listbox", { name: "Then this: the activities of this log" });
  expect(within(second).getAllByRole("option")[0]).toHaveFocus();
  expect(within(second).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  expect(changed.mock.lastCall?.[0].params.b).toEqual(["Record Goods Receipt"]);
  expect(changed.mock.lastCall?.[0].params.a).toEqual(["Record Goods Receipt"]);
  await user.tab(); expect(screen.getByLabelText("within")).toHaveFocus();
  expect(original).toEqual(before); expect(reads).toEqual(["ct_picker"]);
  await expectNoSeriousA11yViolations(screen.getByTestId("rule-editor"));
});

it("keeps focus in search while filtering, exposes a single reachable result, and keeps empty-result semantics valid", async () => {
  const { changed } = setup(); const user = userEvent.setup();
  const first = await screen.findByRole("listbox", { name: "First this: the activities of this log" });
  const search = screen.getByLabelText("First this: search the activities of this log");
  await user.type(search, "Currency");
  expect(search).toHaveFocus();
  const currency = within(first).getByRole("option", { name: /Change Currency/ });
  expect(currency).toHaveAttribute("tabindex", "0");
  await user.tab(); expect(currency).toHaveFocus();
  await user.keyboard(" "); expect(currency).toHaveAttribute("aria-selected", "true");
  await user.tab({ shift: true }); expect(search).toHaveFocus();
  await user.clear(search); await user.type(search, "no match for this");
  expect(within(first).queryByRole("option")).not.toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "First this" })).getByRole("status")).toHaveTextContent("No activity of this log carries that word.");
  await user.keyboard("{ArrowDown}"); expect(search).toHaveFocus();
  await user.tab(); expect(first).toHaveFocus();
  await user.tab(); expect(screen.getByLabelText("Then this: search the activities of this log")).toHaveFocus();
  expect(changed).toHaveBeenCalledTimes(1);
  await expectNoSeriousA11yViolations(screen.getByTestId("rule-editor"));
});

it("shows rare positive shares as less than one percent, preserves true zero and unknown, and exposes exact counts and denominator", async () => {
  const { changed } = setup();
  const first = await screen.findByRole("listbox", { name: "First this: the activities of this log" });
  for (const activity of activities.slice(1, 3)) {
    const option = within(first).getByRole("option", { name: new RegExp(activity.label) });
    expect(option).toHaveTextContent("<1%");
    expect(option).not.toHaveTextContent("0%");
    expect(option.title).toContain(`${activity.cases} / ${total}`);
    expect(option.title).toContain(`reported share: ${activity.share}`);
  }
  expect(within(first).getByRole("option", { name: /No recorded occurrence/ })).toHaveTextContent("0 purchase order items · 0%");
  expect(within(first).getByRole("option", { name: /Share not supplied/ })).toHaveTextContent("20 purchase order items · share unknown");
  expect(within(first).getByRole("option", { name: /Record Goods Receipt/ })).toHaveTextContent("100%");
  expect(within(screen.getByRole("group", { name: "First this" })).getByText(/Total: 251,734 purchase order items/)).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
});

it("does not invent counts, shares or a denominator when the inventory omits them", async () => {
  setup({ activities: [
    { label: "Unknown measurements", events: 1, share: null },
    { label: "Rounded source share", cases: 35, events: 35, share: 0 },
    { label: "Extremely rare", cases: 1, events: 1, share: 1e-12 },
  ] });
  const first = await screen.findByRole("listbox", { name: "First this: the activities of this log" });
  expect(within(first).getByRole("option", { name: /Unknown measurements/ })).toHaveTextContent("count unknown · share unknown");
  expect(within(first).getByRole("option", { name: /Rounded source share/ })).toHaveTextContent("35 purchase order items · share unknown");
  expect(within(first).getByRole("option", { name: /Extremely rare/ })).toHaveTextContent("<1%");
  expect(within(screen.getByRole("group", { name: "First this" })).getByText(/Total: unknown/)).toBeVisible();
});
