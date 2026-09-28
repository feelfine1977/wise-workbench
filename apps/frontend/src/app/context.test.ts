import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as Router from "@tanstack/react-router";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseTable, DatasetVersion, Run } from "@wise/api-schema";
import { projectBindingQuery } from "@/lib/api/projectBinding";
import { keys } from "@/lib/queries";
import { server } from "@/mocks/node";
import { groupingForRun, regroupSearch, selectScopeRuns, selectWorkbenchRunId, useWorkbench, workbenchRunDestination } from "./context";

const route = vi.hoisted(() => ({ projectId: "synthetic-project", datasetId: undefined as string | undefined, runId: undefined as string | undefined, sliceKey: undefined as string | undefined, pathname: "/p/synthetic-project", search: {} as Record<string, unknown>, navigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  useParams: () => route,
  useSearch: () => route.search,
  useRouterState: () => route.pathname,
  useNavigate: () => route.navigate,
}));

beforeEach(() => {
  route.runId = undefined;
  route.datasetId = undefined;
  route.sliceKey = undefined;
  route.pathname = "/p/synthetic-project";
  route.search = {};
  route.navigate.mockClear();
  server.use(http.get("*/api/v1/projects/synthetic-project/dataset-binding", () => HttpResponse.json({ projectId: route.projectId, datasetId: null, boundAt: null })));
});

function run(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    caseTableId: "synthetic-table",
    normVersionId: "synthetic-norm",
    status: "done",
    paramsHash: id,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const baseline = run("observed");
const scenario = run("scenario", { baselineRunId: baseline.id });
const runs = [scenario, baseline];
const scenarios = [scenario.id];

describe("run scope and grouping navigation", () => {
  const source = run("consignment", { views: ["Finance", "Automation"], slicings: [{ id: "company", attributes: ["Company"] }] });
  const target = run("df1", { views: ["Finance", "Automation"], slicings: [{ id: "company", attributes: ["Company"] }], scope: { flow_type: "DF1" } });
  const inline = 'group:{"attributes":["Vendor"],"bands":[]}';

  it.each(["flow", "monitor"])("preserves the RunPage %s tab during scope switches", (tab) => {
    expect(workbenchRunDestination("p", target.id, target, source, "/p/p/runs/consignment", { tab })).toEqual({ to: "/p/$projectId/runs/$runId", params: { projectId: "p", runId: "df1" }, search: { tab } });
  });

  it.each(["company", "Company,Vendor", inline])("preserves compatible grouping %s across same-table scopes", (slicing) => {
    const next = workbenchRunDestination("p", target.id, target, source, "/p/p/runs/consignment/flow", { slicing, view: "Automation", render: "model", detail: 3, filter: "old scope", fh: "old hash", activity: "old", sel: "old", scope: "Consignment" });
    expect(next).toEqual({ to: "/p/$projectId/runs/$runId/flow", params: { projectId: "p", runId: "df1" }, search: { slicing, view: "Automation", render: "model", detail: 3 } });
  });

  it("drops incompatible grouping and view on a different table", () => {
    const other = { ...target, caseTableId: "other", views: ["Logistics"], slicings: [{ id: "region", attributes: ["Region"] }] };
    const next = workbenchRunDestination("p", other.id, other, source, "/p/p/runs/consignment/flow", { slicing: inline, view: "Automation" });
    expect(next.search).toEqual({ slicing: "region", view: "Logistics" });
    expect(groupingForRun(other, source, "region")).toBe("region");
  });

  it.each(["flow", "board", "backlog", "investigate"])("stays on %s while clearing old group/filter selection", (page) => {
    const next = workbenchRunDestination("p", target.id, target, source, `/p/p/runs/consignment/${page}`, { view: "Automation", slicing: inline, group: "old", within: "old", filter: "old", pins: ["old"], row: "old", q: "old", page: 4 });
    expect(next.to).toBe(`/p/$projectId/runs/$runId/${page}`);
    expect(next.search).toEqual({ view: "Automation", slicing: inline, ...(page === "backlog" ? { minCases: target.minCases ?? undefined } : {}) });
  });

  it("does not reuse a group key in another scope, retaining a flow question as a whole-flow page", () => {
    expect(workbenchRunDestination("p", target.id, target, source, "/p/p/runs/consignment/slices/%5Bvendor%5D", { tab: "why" }).to).toBe("/p/$projectId/runs/$runId/backlog");
    expect(workbenchRunDestination("p", target.id, target, source, "/p/p/runs/consignment/slices/%5Bvendor%5D", { tab: "flow" }).to).toBe("/p/$projectId/runs/$runId/flow");
    expect(workbenchRunDestination("p", target.id, { ...target, status: "running" }, source, "/p/p/runs/consignment/flow", {}).to).toBe("/p/$projectId/runs/$runId");
  });

  it.each([undefined, 20])("run switching uses the destination minimum unless browsing supplied %s", (minCases) => {
    const next = workbenchRunDestination("p", target.id, {...target, minCases:1}, source, "/p/p/runs/consignment/backlog", {minCases});
    expect(next.search).toMatchObject({minCases: minCases ?? 1});
  });

  it("regroups without discarding case filters, perspective, or scoring controls", () => {
    const search = { view: "Automation", filter: "case-population", gamma: 0, minCases: 10, sort: "-gap", tab: "table", page: 3, row: "x", pins: ["x"], within: "x", q: "x", kind: "acute", layer: "x", confident: true, group: "x" };
    expect(regroupSearch(search, inline)).toEqual({ view: "Automation", filter: "case-population", gamma: 0, minCases: 10, sort: "-gap", tab: "table", slicing: inline });
    expect(search.page).toBe(3);
  });

  it.each(["backlog", "flow", "board", "slices/key"])("wires setSlicing correctly from %s using router location", (page) => {
    route.runId = source.id;
    route.sliceKey = page.startsWith("slices") ? "key" : undefined;
    route.pathname = `/p/synthetic-project/runs/${source.id}/${page}`;
    route.search = { slicing: "company", view: "Automation", filter: "case-population", gamma: 5, minCases: 10, within: "old", row: "old", tab: page.startsWith("slices") ? "why" : "table" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(keys.project(route.projectId), { id: route.projectId, latestRunId: source.id });
    client.setQueryData(keys.datasets(route.projectId), []);
    client.setQueryData(keys.caseTables(route.projectId), []);
    client.setQueryData(keys.norms(route.projectId), []);
    client.setQueryData(keys.runs(route.projectId), [source, target]);
    client.setQueryData(["projects", route.projectId, "scenarios"], []);
    client.setQueryData(keys.caseTable(route.projectId, source.caseTableId), {});
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
    const { result, unmount } = renderHook(() => useWorkbench(), { wrapper });
    try {
      result.current.setSlicing(inline);
      const navigation = route.navigate.mock.lastCall?.[0];
      expect(navigation.to).toBe(route.sliceKey ? "/p/$projectId/runs/$runId/backlog" : ".");
      const next = typeof navigation.search === "function" ? navigation.search(route.search) : navigation.search;
      expect(next).toMatchObject({ slicing: inline, view: "Automation", filter: "case-population", gamma: 5, minCases: 10 });
      expect(next.row).toBeUndefined();
      expect(next.within).toBeUndefined();
      if (route.sliceKey) expect(next.tab).toBeUndefined();
    } finally { unmount(); client.clear(); }
  });
});

describe("observed scope alternatives", () => {
  const parent = run("parent", { createdAt: "2026-09-26T00:00:00Z" });
  const df1 = run("df1", { scope: { flow_type: "DF1" }, createdAt: "2026-09-25T00:00:00Z" });
  const newerDf1 = run("df1-new", { scope: { flow_type: "DF1" }, createdAt: "2026-09-27T00:00:00Z" });
  const whatIf = run("df1-scenario", { scope: { flow_type: "DF1" }, createdAt: "2026-09-28T00:00:00Z" });
  const list = [run("parent-old"), df1, whatIf, parent, newerDf1,
    run("other-norm", { normVersionId: "other" }), run("other-table", { caseTableId: "other" }),
    run("pending", { status: "running", scope: { flow_type: "DF2" } })];

  it("chooses latest completed observations for the same table/norm and excludes scenarios", () => {
    expect(selectScopeRuns(list, parent, [whatIf.id]).map((r) => r.id)).toEqual([newerDf1.id, parent.id]);
  });

  it("retains the explicit current scoped observation even when a newer one exists", () => {
    expect(selectScopeRuns(list, df1, [whatIf.id]).map((r) => r.id)).toEqual([df1.id, parent.id]);
  });

  it("never retains the current scenario as an observed alternative", () => {
    expect(selectScopeRuns(list, whatIf, [whatIf.id]).map((r) => r.id)).toEqual([newerDf1.id, parent.id]);
  });

  it("waits for scenario membership and current context rather than guessing", () => {
    expect(selectScopeRuns(list, parent, undefined)).toEqual([]);
    expect(selectScopeRuns(list, undefined, [])).toEqual([]);
  });
});

describe("workbench run selection", () => {
  it("keeps the saved ordinary run when a newer scenario completes", () => {
    expect(selectWorkbenchRunId(runs, baseline.id, undefined, scenarios)).toBe(baseline.id);
  });

  it.each([undefined, null, "missing", scenario.id])("skips scenarios when the saved default is %s", (latest) => {
    expect(selectWorkbenchRunId(runs, latest, undefined, scenarios)).toBe(baseline.id);
  });

  it("honours a saved ordinary run even when another ordinary run is newer", () => {
    expect(selectWorkbenchRunId([run("newer"), ...runs], baseline.id, undefined, scenarios)).toBe(baseline.id);
  });

  it("selects the newest completed ordinary run as the fallback", () => {
    const list = [baseline, run("pending", { status: "running" }), scenario, run("newer", { createdAt: "2026-02-01T00:00:00Z" })];
    expect(selectWorkbenchRunId(list, undefined, undefined, scenarios)).toBe("newer");
  });

  it.each(["queued", "running", "failed", "cancelled"] as const)("rejects a %s saved run as the default", (status) => {
    const pending = run("unfinished", { status });
    expect(selectWorkbenchRunId([pending, ...runs], pending.id, undefined, scenarios)).toBe(baseline.id);
  });

  it("does not mistake an ordinary run with a comparison baseline for a scenario", () => {
    const comparison = run("comparison", { baselineRunId: baseline.id });
    const list = [scenario, comparison, baseline];
    expect(selectWorkbenchRunId(list, comparison.id, undefined, scenarios)).toBe(comparison.id);
    expect(selectWorkbenchRunId(list, undefined, undefined, scenarios)).toBe(comparison.id);
  });

  it("allows explicit navigation to a scenario", () => {
    expect(selectWorkbenchRunId(runs, baseline.id, scenario.id, scenarios)).toBe(scenario.id);
    expect(selectWorkbenchRunId(runs, baseline.id, scenario.id, undefined)).toBe(scenario.id);
  });

  it("allows explicit navigation to an unfinished run", () => {
    const pending = run("pending", { status: "queued" });
    expect(selectWorkbenchRunId([pending, ...runs], baseline.id, pending.id, scenarios)).toBe(pending.id);
  });

  it("falls back to an ordinary run when the requested run does not belong to the project", () => {
    expect(selectWorkbenchRunId(runs, scenario.id, "other-project-run", scenarios)).toBe(baseline.id);
  });

  it("leaves the default empty when there are only scenarios or unfinished runs", () => {
    expect(selectWorkbenchRunId([scenario, run("pending", { status: "running" })], scenario.id, undefined, scenarios)).toBeUndefined();
    expect(selectWorkbenchRunId([], undefined, undefined, [])).toBeUndefined();
  });

  it("waits for both lists before automatically using a saved pointer", () => {
    expect(selectWorkbenchRunId(undefined, scenario.id, undefined, scenarios)).toBeUndefined();
    expect(selectWorkbenchRunId(runs, scenario.id, undefined, undefined)).toBeUndefined();
  });

  it("preserves an explicit route while the lists load", () => {
    expect(selectWorkbenchRunId(undefined, baseline.id, scenario.id, undefined)).toBe(scenario.id);
  });
});

describe("workbench scenario query", () => {
  it.each([undefined, scenario.id])("uses the scenario list for route %s", async (requested) => {
    route.runId = requested;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(keys.project(route.projectId), { id: route.projectId, latestRunId: scenario.id });
    queryClient.setQueryData(keys.datasets(route.projectId), []);
    queryClient.setQueryData(keys.caseTables(route.projectId), [{ id: "synthetic-table", datasetId: "synthetic-dataset", status: "ready", createdAt: "2026-01-01" }]);
    const binding = { projectId: route.projectId, datasetId: "synthetic-dataset", boundAt: "2026-09-27T00:00:00Z" };
    queryClient.setQueryData(projectBindingQuery(route.projectId).queryKey, binding);
    server.use(http.get("*/api/v1/projects/synthetic-project/dataset-binding", () => HttpResponse.json(binding)));
    queryClient.setQueryData(keys.norms(route.projectId), []);
    queryClient.setQueryData(keys.runs(route.projectId), runs);
    queryClient.setQueryData(keys.caseTable(route.projectId, baseline.caseTableId), { datasetId: "synthetic-dataset" });
    server.use(http.get("*/projects/synthetic-project/scenarios", () => HttpResponse.json([
      { runId: scenario.id, baselineRunId: baseline.id, name: "Synthetic scenario", status: "done" },
    ])));
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, unmount } = renderHook(() => useWorkbench(), { wrapper });
    try {
      expect(result.current.runId).toBe(requested);
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.runId).toBe(requested ?? baseline.id);
      expect(result.current.run?.id).toBe(requested ?? baseline.id);
      expect(result.current.isScenario).toBe(requested === scenario.id);
      expect(result.current.periods.map(p => p.runId)).toEqual([baseline.id]);
      expect(result.current.scopeRuns?.map(r => r.id)).toEqual([baseline.id]);
    } finally {
      unmount();
      queryClient.clear();
    }
  });
});

describe("persistent project dataset context", () => {
  const datasets: DatasetVersion[] = [
    { id: "o2c", name: "O2C", status: "ready", createdAt: "2026-01-01" },
    { id: "p2p", name: "P2P", status: "ready", createdAt: "2026-09-27" },
  ];
  const tables: CaseTable[] = datasets.map((dataset) => ({ id: `ct-${dataset.id}`, datasetId: dataset.id, mappingId: `map-${dataset.id}`, status: "ready", createdAt: dataset.createdAt, cases: 50 }));
  const list = [run("o2c-run", { caseTableId: "ct-o2c" }), run("p2p-run", { caseTableId: "ct-p2p", createdAt: "2026-09-27" })];
  function mount(datasetId: string | null, latestRunId?: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const binding = { projectId: route.projectId, datasetId, boundAt: datasetId ? "2026-09-27T00:00:00Z" : null };
    server.use(http.get("*/api/v1/projects/synthetic-project/dataset-binding", () => HttpResponse.json(binding)));
    client.setQueryData(projectBindingQuery(route.projectId).queryKey, binding);
    client.setQueryData(keys.project(route.projectId), { id: route.projectId, latestRunId });
    client.setQueryData(keys.datasets(route.projectId), datasets);
    client.setQueryData(keys.caseTables(route.projectId), tables);
    client.setQueryData(keys.norms(route.projectId), []);
    client.setQueryData(keys.runs(route.projectId), list);
    client.setQueryData(["projects", route.projectId, "scenarios"], []);
    for (const table of tables) client.setQueryData(keys.caseTable(route.projectId, table.id), table);
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useWorkbench(), { wrapper });
    return { ...hook, client, close: () => { hook.unmount(); client.clear(); } };
  }
  it("never guesses a dataset from the newest upload or assessment in an unbound project", () => {
    const test = mount(null);
    expect(test.result.current.datasetBindingState).toBe("unbound");
    expect(test.result.current.dataset).toBeUndefined(); expect(test.result.current.caseTable).toBeUndefined();
    expect(test.result.current.runId).toBeUndefined(); expect(test.result.current.caseTableIds).toEqual([]); test.close();
  });
  it("allows an explicit unbound dataset preview without sending a binding mutation", async () => {
    route.datasetId = "o2c"; const put = vi.fn();
    server.use(http.put("*/api/v1/projects/synthetic-project/dataset-binding", () => { put(); return HttpResponse.json({}); }));
    const test = mount(null, "p2p-run");
    await waitFor(() => expect(test.result.current.isLoading).toBe(false));
    expect(test.result.current.dataset?.id).toBe("o2c"); expect(test.result.current.caseTable?.id).toBe("ct-o2c");
    expect(test.result.current.runId).toBeUndefined(); expect(test.result.current.datasetBindingState).toBe("unbound");
    expect(put).not.toHaveBeenCalled(); test.close();
  });
  it("keeps the bound dataset and table when a newer upload/run and an incompatible latest pointer exist", () => {
    const test = mount("o2c", "p2p-run");
    expect(test.result.current.datasets.map((d) => d.id)).toEqual(["o2c"]);
    expect(test.result.current.projectDataset?.id).toBe("o2c"); expect(test.result.current.dataset?.id).toBe("o2c");
    expect(test.result.current.caseTableIds).toEqual(["ct-o2c"]); expect(test.result.current.caseTable?.id).toBe("ct-o2c");
    expect(test.result.current.runId).toBe("o2c-run"); expect(test.result.current.projectRuns?.map((r) => r.id)).toEqual(["o2c-run"]);
    expect(test.result.current.periods.map((p) => p.runId)).toEqual(["o2c-run"]); test.close();
  });
  it.each(["ct-p2p", "unknown"])("rejects incompatible calibration/mapping search %s without falling back silently", (caseTable) => {
    route.search = { caseTable }; route.pathname = "/p/synthetic-project/norms/norm";
    const test = mount("o2c"); expect(test.result.current.caseTable).toBeUndefined();
    expect(test.result.current.datasetBindingConflict).toMatchObject({ kind: "case_table", boundDatasetId: "o2c" }); test.close();
  });
  it("flags a foreign dataset route and supplies no foreign default table", () => {
    route.datasetId = "p2p"; const test = mount("o2c");
    expect(test.result.current.datasetBindingConflict).toEqual({ kind: "dataset", datasetId: "p2p", boundDatasetId: "o2c" });
    expect(test.result.current.caseTable).toBeUndefined(); expect(test.result.current.projectDataset?.id).toBe("o2c"); test.close();
  });
  it("keeps a historical run's actual dataset and table despite the binding and stale mapping search", () => {
    route.runId = "p2p-run"; route.search = { caseTable: "ct-o2c" }; const test = mount("o2c");
    expect(test.result.current.runId).toBe("p2p-run"); expect(test.result.current.dataset?.id).toBe("p2p");
    expect(test.result.current.caseTable?.id).toBe("ct-p2p"); expect(test.result.current.projectDataset?.id).toBe("o2c");
    expect(test.result.current.datasetBindingConflict).toEqual({ kind: "run", datasetId: "p2p", boundDatasetId: "o2c" });
    expect(test.result.current.caseTableIds).toEqual(["ct-o2c"]); test.close();
  });
  it("derives an unbound legacy preview only from the saved selected run", () => {
    const test = mount(null, "o2c-run");
    expect(test.result.current.dataset?.id).toBe("o2c"); expect(test.result.current.datasetBindingState).toBe("unbound");
    expect(test.result.current.projectDataset).toBeUndefined(); test.close();
  });
  it("surfaces a binding error instead of guessing a dataset when the endpoint fails", async () => {
    const test = mount(null);
    server.use(http.get("*/api/v1/projects/synthetic-project/dataset-binding", () => HttpResponse.json({ detail: "unavailable" }, { status: 503 })));
    await test.client.invalidateQueries({ queryKey: projectBindingQuery(route.projectId).queryKey });
    await waitFor(() => expect(test.result.current.datasetBindingState).toBe("error"));
    expect(test.result.current.runId).toBeUndefined(); expect(test.result.current.caseTableIds).toEqual([]); test.close();
  });
});

it("flow alternatives preserve selection_id and cannot widen a saved cohort to all cases", () => {
  const scoped = (id: string, selection_id?: string, flow_type?: string) => run(id, { scope: { selection_id, flow_type } });
  const current = scoped("chosen-df1", "selection-a", "DF1");
  const whole = scoped("chosen-all", "selection-a");
  const df2 = scoped("chosen-df2", "selection-a", "DF2");
  const other = scoped("other-df2", "selection-b", "DF2");
  const unfiltered = scoped("unfiltered");
  const unfilteredDf1 = scoped("unfiltered-df1", undefined, "DF1");
  const list = [current, whole, df2, other, unfiltered, unfilteredDf1];
  expect(selectScopeRuns(list, current, []).map((r) => r.id).sort()).toEqual([current.id, whole.id, df2.id].sort());
  expect(selectScopeRuns(list, unfiltered, []).map((r) => r.id).sort()).toEqual([unfiltered.id, unfilteredDf1.id].sort());
});
