import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { analysisKey, draftFromSelection, draftSelection, useAnalysisSelection } from "@/lib/stores/analysisSelection";
import type { EDAMultiSelection } from "@/lib/api/eda";
import { ExactValues, NumericRangeControl, ContextHierarchy } from "./ExplorationControls";
import { compareDecimal } from "./selectionHelpers";
import { EventEvidence } from "./EventEvidence";

const scope = { projectId: "p", datasetId: "ds", caseTableId: "ct", selection: '{"eventRanges":[{"min":0}]}' };
function setup(component: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{component}</QueryClientProvider>);
}
const route = "*/api/v1/projects/:projectId/case-tables/:caseTableId/eda/query";

it("preserves decimal precision beyond binary numbers and distinguishes missing from zero", async () => {
  expect(compareDecimal("9007199254740993.01", "9007199254740993.02")).toBe(-1);
  expect(compareDecimal("-0.01", "0")).toBe(-1);
  const change = vi.fn();
  const { container } = setup(<NumericRangeControl field="amount" dataType="decimal128(20,2)" onChange={change} />);
  await userEvent.click(screen.getByText("Set a numeric range for amount"));
  await userEvent.type(screen.getByLabelText("amount ≥"), "9007199254740993.01");
  await userEvent.type(screen.getByLabelText("amount <"), "9007199254740993.02");
  await userEvent.click(screen.getByLabelText("Include missing / nonfinite amount"));
  await userEvent.click(screen.getByRole("button", { name: "Apply numeric range" }));
  expect(change).toHaveBeenCalledWith({ field: "amount", ranges: [{ min: "9007199254740993.01", max: "9007199254740993.02" }], missing: true });
  await expectNoSeriousA11yViolations(container);
  await userEvent.clear(screen.getByLabelText("amount <"));
  await userEvent.type(screen.getByLabelText("amount <"), "9007199254740993.00");
  await userEvent.click(screen.getByRole("button", { name: "Apply numeric range" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("minimum below maximum");
  expect(change).toHaveBeenCalledTimes(1);
});

it("searches every value in the fixed scope and submits literal exact values", async () => {
  const requests: unknown[] = [];
  server.use(http.post(route, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return HttpResponse.json({ values: { field: "vendor", query: body.valueSearch, page: 1, pageSize: 40, totalValues: 1, rows: [{ value: "Rare %_ vendor", total: 7, selected: 2, selectable: true }] } });
  }));
  const change = vi.fn();
  setup(<ExactValues scope={scope} field="vendor" choices={[{ key: "v1", label: "Large vendor" }]} onChange={change} />);
  await userEvent.click(screen.getByRole("button", { name: "Find any vendor value" }));
  await screen.findByText("Rare %_ vendor");
  await userEvent.type(screen.getByLabelText("Search vendor"), "%_");
  await userEvent.click(screen.getByRole("button", { name: "Search values" }));
  await waitFor(() => expect(requests).toContainEqual({ datasetId: "ds", selection: scope.selection, valueField: "vendor", valueSearch: "%_", valuePage: 1, page: 1, pageSize: 25 }));
  await userEvent.click(screen.getByRole("button", { name: /Rare %_ vendor/ }));
  expect(change).toHaveBeenCalledWith([{ key: "v1", label: "Large vendor" }, { key: "value:Rare %_ vendor", label: "Rare %_ vendor", value: "Rare %_ vendor" }]);
});

it("round-trips extended saved recipes and invalidates identity only on membership edits", () => {
  const recipe: EDAMultiSelection = {
    facets: [{ field: "vendor", keys: ["missing"], values: ["Rare vendor"] }],
    numericFacets: [{ field: "amount", ranges: [{ min: "-1.25", max: "9007199254740993.02" }], missing: true }],
    jointAny: [{ facets: [{ field: "company", keys: [], values: ["A"] }, { field: "flow", keys: ["v1"] }] }, { facets: [{ field: "company", keys: [], values: ["B"] }, { field: "flow", keys: ["v2"] }] }],
  };
  const draft = draftFromSelection(recipe, "vendor");
  expect(draftSelection(draft)).toEqual(recipe);
  const key = analysisKey("p", "ds", "ct");
  useAnalysisSelection.getState().activate(key, "saved", draft);
  useAnalysisSelection.getState().update(key, { ...draft, attribute: "company" });
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBe("saved");
  useAnalysisSelection.getState().update(key, { ...draft, facets: [{ field: "vendor", choices: [{ key: "value:different", label: "different", value: "different" }] }] });
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBeUndefined();
});

it("declares three levels and selects a whole conjunction without cross-combinations", async () => {
  const change = vi.fn();
  server.use(http.post(route, () => HttpResponse.json({ hierarchy: { fields: ["region", "company", "vendor"], cells: [
    { keys: ["v1", "v2", "other"], labels: ["Europe", "Company A", "Other categories"], total: 7, selected: 2 },
    { keys: ["v1", "v2", "missing"], labels: ["Europe", "Company A", "Unknown / missing"], total: 3, selected: 0 },
  ] } })));
  const { container } = setup(<ContextHierarchy scope={scope} attributes={["region", "company", "vendor"]} branches={[]} onToggle={change} />);
  await userEvent.click(screen.getByRole("button", { name: "Declare three levels" }));
  await userEvent.click(screen.getByRole("button", { name: "Build hierarchy" }));
  await userEvent.click(await screen.findByText("region: Europe · 2 / 10 cases"));
  await userEvent.click(screen.getByText("company: Company A · 2 / 10 cases"));
  await userEvent.click(screen.getByRole("button", { name: /vendor: Other categories/ }));
  expect(change).toHaveBeenCalledWith({ facets: [{ field: "region", keys: [], values: ["Europe"] }, { field: "company", keys: [], values: ["Company A"] }, { field: "vendor", keys: ["other"] }] });
  await expectNoSeriousA11yViolations(container);
});

it("shows zero-inclusive denominators, complete endpoint coverage and trace uncertainty", async () => {
  const requests: Record<string, unknown>[] = [];
  server.use(http.post(route, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return HttpResponse.json({ eventEvidence: {
      eligibleCases: 9, recordedEvents: 14, casesWithoutEvents: 1, missingActivityEvents: 1, undatedEvents: 2,
      activityPage: 1, activityPageSize: 40, totalActivities: 2,
      activities: [{ activity: "Start", occurrences: 7, cases: 6, repeatedCases: 1, zeroCases: 3, presenceRate: 6/9, repetitionRate: 1/9 }, { activity: "End", occurrences: 6, cases: 6, repeatedCases: 0, zeroCases: 3, presenceRate: 6/9, repetitionRate: 0 }],
      endpoints: body.endpointStart ? { startActivity: "Start", endActivity: "End", eligibleCases: 9, pairedCases: 2, startOnlyCases: 1, endOnlyCases: 1, neitherCases: 2, undatedEndpointCases: 1, reversedCases: 1, ambiguousCases: 1, medianDays: 1, p90Days: 1.8, rule: "Exactly one occurrence of each endpoint; elapsed calendar days." } : null,
      trace: { caseId: "c1", page: 1, pageSize: 100, total: 2, undatedEvents: 1, endpointStatus: null, endpointDays: null,
        events: [{ position: 1, activity: "Start", timestamp: "2024-01-01", lifecycle: null, resource: null, timestampTied: true }, { position: 2, activity: "End", timestamp: null, lifecycle: null, resource: null, timestampTied: false }] }, notes: ["Selected whole cases only"],
    } });
  }));
  const { container } = setup(<EventEvidence scope={scope} traceCaseId="c1" onCloseTrace={vi.fn()} />);
  expect(await screen.findByText(/including zero occurrences/)).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Cases with zero" })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Start activity"), "Start");
  await userEvent.type(screen.getByLabelText("End activity"), "End");
  await userEvent.click(screen.getByRole("button", { name: "Calculate endpoint coverage" }));
  await screen.findByText("2 of 9 selected cases have a defined pair");
  expect(screen.getByText("Repeated endpoint · ambiguous")).toBeInTheDocument();
  expect(screen.getByText("Unknown chronology")).toBeInTheDocument();
  expect(screen.getByText("Timestamp tie")).toBeInTheDocument();
  expect(requests.at(-1)).toEqual(expect.objectContaining({ datasetId: "ds", selection: scope.selection, eventInsight: true, traceCaseId: "c1", endpointStart: "Start", endpointEnd: "End" }));
  await expectNoSeriousA11yViolations(container);
});

it("allows closing a trace query rejected by the server", async () => {
  server.use(http.post(route, () => HttpResponse.json({ status: 422, detail: "Unknown case" }, { status: 422 })));
  const close = vi.fn();
  setup(<EventEvidence scope={scope} traceCaseId="outside" onCloseTrace={close} />);
  await userEvent.click(await screen.findByRole("button", { name: "Close unavailable trace" }));
  expect(close).toHaveBeenCalled();
});
