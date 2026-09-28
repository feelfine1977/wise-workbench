import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient, renderApp } from "@/test/utils";
import type { ProcessVariantsResponse, VariantsParams } from "@/lib/api/variants";
import { ProcessVariants } from "./ProcessVariants";

const endpoint = "*/api/v1/projects/:project/runs/:run/variants";
const fixture: ProcessVariantsResponse = {
  runId: "r", totalSelectedCases: 10, excludedZeroEventCases: 1, totalVariants: 4,
  coveredCount: 5, coverage: 0.5, limit: 10, exampleLimit: 3,
  ordering: "Equal timestamps use the mapped order then stable stored event order. Recorded order does not establish business causality.",
  durationDescription: "Median observed first-to-last event span; descriptive elapsed time, not savings or active work time.",
  variants: [{ id: "v1", activities: ["A", "B", "B", "A", "C"], count: 5, share: 0.5, medianDurationHours: 6, durationCases: 4, exampleCaseIds: ["c1"] }],
};

function mount(params: VariantsParams = {}) {
  const client = makeTestQueryClient();
  const view = render(<QueryClientProvider client={client}><ProcessVariants projectId="p" runId="r" {...params} /></QueryClientProvider>);
  return { ...view, update: (next: VariantsParams) => view.rerender(<QueryClientProvider client={client}><ProcessVariants projectId="p" runId="r" {...next} /></QueryClientProvider>) };
}

it("fetches on open, shows partial coverage and exact repeated steps, then opens the existing sample timeline", async () => {
  const variants = vi.fn(() => HttpResponse.json(fixture));
  const trace = vi.fn(() => HttpResponse.json({
    caseId: "c1", attributes: {}, scores: {}, violations: {}, events: fixture.variants[0]!.activities.map((activity, i) => ({ activity, timestamp: `2024-01-01T0${i}:00:00Z`, violates: [], attributes: {} })),
  }));
  server.use(http.get(endpoint, variants), http.get("*/api/v1/projects/p/runs/r/cases/c1/trace", trace));
  const user = userEvent.setup();
  mount();
  expect(variants).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", { name: "Common process paths" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("status")).toHaveTextContent("Showing 1 of 4 paths · 5 of 10 selected cases (50% coverage)");
  expect(within(dialog).getByLabelText("Path 1 activity sequence")).toHaveTextContent("A→B→B→A→C");
  expect(dialog).toHaveTextContent("1 selected cases have no events");
  expect(dialog).toHaveTextContent("4 of 5 cases with complete timestamps");
  await user.click(screen.getByText("How paths and durations are counted"));
  expect(dialog).toHaveTextContent("does not establish business causality");
  expect(dialog).toHaveTextContent("not savings");
  expect(trace).not.toHaveBeenCalled();
  await expectNoSeriousA11yViolations(dialog);
  await user.click(screen.getByRole("button", { name: "Open sample c1" }));
  expect(await screen.findByRole("region", { name: "Timeline of case c1" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Events in time order for case c1" })).toBeInTheDocument();
  await user.click(screen.getByText("Event table", { exact: true }));
  expect(screen.getByRole("table", { name: "Events of case c1" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back to common paths" }));
  expect(screen.getByLabelText("Path 1 activity sequence")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Return to analysis" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("shows loading, an error with retry, and an empty selection", async () => {
  let calls = 0;
  server.use(http.get(endpoint, async () => {
    calls++;
    await delay(100);
    return calls === 1 ? HttpResponse.json({ detail: "Temporary failure" }, { status: 503 }) : HttpResponse.json({ ...fixture, totalSelectedCases: 0, excludedZeroEventCases: 0, totalVariants: 0, coveredCount: 0, coverage: 0, variants: [] });
  }));
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Common process paths" }));
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No cases match this selection.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("0% coverage");
});

it("distinguishes all zero-event cases and unavailable duration from measured zero", async () => {
  server.use(http.get(endpoint, () => HttpResponse.json({ ...fixture, variants: [], totalVariants: 0, excludedZeroEventCases: 10, coveredCount: 0, coverage: 0 })));
  const user = userEvent.setup();
  const view = mount();
  await user.click(screen.getByRole("button", { name: "Common process paths" }));
  expect(await screen.findByText("No event sequences are available for the selected cases.")).toBeInTheDocument();
  server.use(http.get(endpoint, () => HttpResponse.json({ ...fixture, variants: [
    { ...fixture.variants[0], medianDurationHours: null, durationCases: 0 },
    { ...fixture.variants[0], id: "zero", activities: [null], medianDurationHours: 0 },
  ] })));
  view.update({ filter: '{"kind":"open","value":true}' });
  expect(await screen.findByText(/Median first-to-last span: unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Median first-to-last span: 0 hours/)).toBeInTheDocument();
  expect(screen.getByText("(missing activity)")).toBeInTheDocument();
});

it("clears a sample when selection changes and keeps rejected filters out of the unfiltered cache", async () => {
  const filters: (string | null)[] = [];
  server.use(http.get(endpoint, ({ request }) => {
    const filter = new URL(request.url).searchParams.get("filter"); filters.push(filter);
    return filter === "{" ? HttpResponse.json({ detail: "Invalid filter", code: "filter.json" }, { status: 422 }) : HttpResponse.json(fixture);
  }), http.get("*/api/v1/projects/p/runs/r/cases/c1/trace", () => HttpResponse.json({ detail: "Trace failed" }, { status: 503 })));
  const user = userEvent.setup();
  const view = mount();
  await user.click(screen.getByRole("button", { name: "Common process paths" }));
  await user.click(await screen.findByRole("button", { name: "Open sample c1" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to common paths" })).toBeInTheDocument();
  view.update({ filter: "{" });
  expect(await screen.findByText("This link carries a filter this run does not understand.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Sample trace c1" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Showing 1 of 4/)).not.toBeInTheDocument();
  expect(filters).toEqual([null, "{"]);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens from FlowPage over the map with the raw URL filter", async () => {
  const raw = '{"and":[{"kind":"activity","op":"contains","activity":"Record Goods Receipt"}]}';
  const requested: (string | null)[] = [];
  server.use(http.get(endpoint, ({ request }) => { requested.push(new URL(request.url).searchParams.get("filter")); return HttpResponse.json(fixture); }));
  const user = userEvent.setup();
  renderApp(`/p/p2p2018/runs/run_41/flow?filter=${encodeURIComponent(raw)}`);
  await screen.findByTestId("flow-map", {}, { timeout: 8000 });
  await user.click(screen.getByRole("button", { name: "Common process paths" }));
  await screen.findByRole("button", { name: "Open sample c1" });
  expect(requested).toEqual([raw]);
  await user.click(screen.getByRole("button", { name: "Return to analysis" }));
  await waitFor(() => expect(screen.getByTestId("flow-map")).toBeVisible());
});

it("names sample violations using the norm pinned to that run", async () => {
  server.use(
    http.get(endpoint, () => HttpResponse.json(fixture)),
    http.get("*/api/v1/projects/p/runs/r", () => HttpResponse.json({ id: "r", normVersionId: "pinned-norm" })),
    http.get("*/api/v1/projects/p/norms/pinned-norm", () => HttpResponse.json({ id: "pinned-norm", norm: { constraints: [{ id: "timing_constraint", description: "Invoice should be cleared within the target time" }] } })),
    http.get("*/api/v1/projects/p/runs/r/cases/c1/trace", () => HttpResponse.json({ caseId: "c1", attributes: {}, scores: {}, violations: {}, events: [{ activity: "Clear invoice", timestamp: "2024-01-01T12:00:00Z", violates: ["timing_constraint"], attributes: {} }] })),
  );
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Common process paths" }));
  await user.click(await screen.findByRole("button", { name: "Open sample c1" }));
  expect(await screen.findByText("Invoice should be cleared within the target time")).toBeVisible();
  expect(within(screen.getByRole("list", { name: "Events in time order for case c1" })).getByRole("link", { name: "Constraint C1 details" })).toBeVisible();
});
