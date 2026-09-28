import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { AnalysisSelectionBar } from "./AnalysisSelectionBar";
import { analysisKey, draftFromSelection, draftSelection, useAnalysisSelection } from "@/lib/stores/analysisSelection";
import type { AnalysisSelection } from "@/lib/api/analysisSelections";
const key = analysisKey("p", "ds", "ct");
const selection = { categoryKeys: ["v1", "other"], timeRanges: [{ from: "2024-01-01T00:00:00Z", before: "2024-04-01T00:00:00Z" }], spanMissing: true };
const saved: AnalysisSelection = { id: "sel_1", name: "Q1 incomplete spans", datasetId: "ds", caseTableId: "ct", cases: 12, createdAt: "2026-09-27T00:00:00Z", attribute: "Company", selection };
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AnalysisSelectionBar projectId="p" datasetId="ds" caseTableId="ct" canRun={false} selectedCases={12} /></QueryClientProvider>); }
it("saves the exact multi-dimension recipe and restores it across navigation without affecting another dataset", async () => {
  const requests: unknown[] = []; let rows: AnalysisSelection[] = [];
  server.use(http.get("*/api/v1/projects/p/case-tables/ct/selections", () => HttpResponse.json(rows)), http.post("*/api/v1/projects/p/case-tables/ct/selections", async ({request}) => { requests.push(await request.json()); rows = [saved]; return HttpResponse.json(saved, {status: 201}); }));
  useAnalysisSelection.getState().update(key, draftFromSelection(selection, "Company"));
  const first = mount();
  await userEvent.type(screen.getByLabelText("Filter name"), saved.name);
  await userEvent.click(screen.getByRole("button", {name: "Save filter"}));
  await screen.findByText(/12 saved cases/);
  expect(requests).toEqual([{name: saved.name, datasetId: "ds", attribute: "Company", selection}]);
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBe("sel_1");
  first.unmount(); mount();
  expect(await screen.findByText(/12 saved cases/)).toBeInTheDocument();
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual(selection);
  expect(useAnalysisSelection.getState().entries[analysisKey("p", "other-dataset", "ct")]).toBeUndefined();
  expect(useAnalysisSelection.getState().entries[analysisKey("p", "ds", "other-preparation")]).toBeUndefined();
});
it("reopens a server saved filter and explicitly clears its scope", async () => {
  server.use(http.get("*/api/v1/projects/p/case-tables/ct/selections", () => HttpResponse.json([saved])));
  mount(); await screen.findByRole("option", {name: /Q1 incomplete/});
  fireEvent.change(screen.getByLabelText("Saved analysis filter"), {target: {value: "sel_1"}});
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual(selection);
  await userEvent.click(screen.getByRole("button", {name: "Use all cases"}));
  await waitFor(() => expect(useAnalysisSelection.getState().entries[key]?.savedId).toBeUndefined());
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual({});
});
it("keeps the draft after a save failure and never activates a failed save", async () => {
  useAnalysisSelection.getState().update(key, draftFromSelection(selection, "Company"));
  server.use(http.post("*/api/v1/projects/p/case-tables/ct/selections", () => HttpResponse.json({title: "Source changed", detail: "Refresh the source", status: 409}, {status: 409})));
  mount(); await userEvent.type(screen.getByLabelText("Filter name"), "Q1"); await userEvent.click(screen.getByRole("button", {name: "Save filter"}));
  await screen.findByText("Refresh the source");
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBeUndefined();
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual(selection);
});

it("saves and reopens the exact multi-field and event-count recipe", async () => {
  const recipe = { facets: [{field: "Company", keys: ["v1", "missing"]}, {field: "flow_type", keys: ["v2"]}], timeRanges: [{from: "2018-01-01T00:00:00Z", before: "2018-04-01T00:00:00Z"}], spanRanges: [{min: 7, max: 30}], eventRanges: [{min: 3, max: 20}], eventMissing: true };
  const richer = {...saved, id: "sel_richer", name: "Q1 joint cohort", selection: recipe};
  let rows: AnalysisSelection[] = [];
  let submitted: unknown;
  server.use(http.get("*/api/v1/projects/p/case-tables/ct/selections", () => HttpResponse.json(rows)), http.post("*/api/v1/projects/p/case-tables/ct/selections", async ({request}) => {submitted = await request.json(); rows = [richer]; return HttpResponse.json(richer, {status: 201});}));
  useAnalysisSelection.getState().update(key, draftFromSelection(recipe, "Company"));
  mount();
  await userEvent.type(screen.getByLabelText("Filter name"), richer.name);
  await userEvent.click(screen.getByRole("button", {name: "Save filter"}));
  await screen.findByText(/12 saved cases/);
  expect(submitted).toEqual({name: richer.name, datasetId: "ds", attribute: "Company", selection: recipe});
  await userEvent.click(screen.getByRole("button", {name: "Use all cases"}));
  await userEvent.selectOptions(screen.getByLabelText("Saved analysis filter"), richer.id);
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual(recipe);
  expect(useAnalysisSelection.getState().entries[key]!.savedId).toBe(richer.id);
});
