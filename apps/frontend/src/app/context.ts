/**
 * The workbench context: which project · dataset · mapping · norm · run · view · slice key · period a screen
 * is scoped to. Derived from route params and search params; nothing on a screen is ambiguous about its inputs.
 */
import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { CaseTable, DatasetVersion, NormVersion, Project, Run } from "@wise/api-schema";
import { caseTableQuery, caseTablesQuery, datasetsQuery, normsQuery, projectQuery, runsQuery } from "@/lib/queries";
import { api, unwrap } from "@/lib/api";
import { useViewPreference } from "@/lib/stores/viewPreference";
import { normViewNames } from "@/lib/viewColors";
import { projectBindingQuery, type ProjectDatasetBinding } from "@/lib/api/projectBinding";

/** Explicit routes may select scenarios; automatic selection needs a completed, observed run. */
export function selectWorkbenchRunId(
  runs: readonly Run[] | undefined,
  latestRunId: string | null | undefined,
  requestedRunId: string | undefined,
  scenarioRunIds: readonly string[] | undefined,
): string | undefined {
  if (requestedRunId && (!runs || runs.some((r) => r.id === requestedRunId))) return requestedRunId;
  // Wait for both lists before trusting a saved pointer, which may predate scenario isolation.
  if (!runs || !scenarioRunIds) return undefined;
  const scenarios = new Set(scenarioRunIds);
  const observed = runs.filter((r) => r.status === "done" && !scenarios.has(r.id));
  const newest = [...observed].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return observed.find((r) => r.id === latestRunId)?.id ?? newest?.id;
}

const pickSearch = (search: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((key) => search[key] !== undefined).map((key) => [key, search[key]]));

/** Completed observations only: scenario results must never masquerade as flow-type alternatives. */
export function selectScopeRuns(runs: readonly Run[], current: Run | undefined, scenarioRunIds: readonly string[] | undefined): Run[] {
  if (!current || !scenarioRunIds) return [];
  const scenarios = new Set(scenarioRunIds);
  const compatible = runs.filter((run) => run.status === "done" && !scenarios.has(run.id) && run.caseTableId === current.caseTableId && run.normVersionId === current.normVersionId && (run.scope?.selection_id ?? null) === (current.scope?.selection_id ?? null))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const scopeKey = (run: Run) => {
    const scope = run.scope as { flow_type?: string; attribute?: string; value?: string } | null | undefined;
    const value = scope?.flow_type ?? scope?.value;
    return value ? JSON.stringify([scope?.attribute ?? "flow_type", value]) : "";
  };
  const byScope = new Map<string, Run>();
  for (const run of compatible) if (!byScope.has(scopeKey(run))) byScope.set(scopeKey(run), run);
  const selected = compatible.find((run) => run.id === current.id);
  if (selected) byScope.set(scopeKey(selected), selected);
  return [...byScope.values()];
}

/** A grouping belongs to a case table; inline and attribute groupings need not be saved on a run. */
export function groupingForRun(target: Run, current: Run | undefined, requested: string | undefined): string | undefined {
  if (requested && (target.caseTableId === current?.caseTableId || target.slicings?.some((s) => s.id === requested))) return requested;
  return target.slicings?.[0]?.id ?? undefined;
}

/** Keep the analysis page, but never carry a previous run's selected group or case filter into its replacement. */
export function workbenchRunDestination(projectId: string, nextRunId: string, target: Run | undefined, current: Run | undefined, pathname: string, search: Record<string, unknown>, patch?: { view?: string; slicing?: string }) {
  const params = { projectId, runId: nextRunId };
  if (!target || target.status !== "done") return { to: "/p/$projectId/runs/$runId" as const, params, search: { tab: "monitor" } };
  const requestedView = patch?.view ?? (typeof search.view === "string" ? search.view : current?.views?.[0]);
  const requestedSlicing = patch?.slicing ?? (typeof search.slicing === "string" ? search.slicing : current?.slicings?.[0]?.id ?? undefined);
  const context = {
    view: target.views?.includes(requestedView ?? "") ? requestedView : target.views?.[0],
    slicing: groupingForRun(target, current, requestedSlicing),
  };
  const sameTable = target.caseTableId === current?.caseTableId;
  const sliceFlow = /\/slices\/[^/]+\/?$/.test(pathname) && search.tab === "flow";
  if (/\/flow\/?$/.test(pathname) || sliceFlow) return { to: "/p/$projectId/runs/$runId/flow" as const, params, search: { ...pickSearch(search, ["detail", "render", "full"]), ...context } };
  if (/\/board\/?$/.test(pathname)) return { to: "/p/$projectId/runs/$runId/board" as const, params, search: { ...pickSearch(search, ["detail", "render", "full", "breakdown", ...(sameTable ? ["attribute"] : [])]), ...context } };
  if (/\/investigate\/?$/.test(pathname)) return { to: "/p/$projectId/runs/$runId/investigate" as const, params, search: { ...pickSearch(search, ["family", "relation", ...(sameTable ? ["question", "activity", "source", "target"] : [])]), ...context } };
  if (/\/runs\/[^/]+\/?$/.test(pathname)) {
    const scope = target.scope as { flow_type?: string } | null | undefined;
    const tab = search.tab === "compare" && scope?.flow_type ? "flow" : search.tab;
    return { to: "/p/$projectId/runs/$runId" as const, params, search: { tab } };
  }
  return {
    to: "/p/$projectId/runs/$runId/backlog" as const,
    params,
    search: { ...pickSearch(search, /\/backlog\/?$/.test(pathname) ? ["gamma", "minCases", "sort", "tab", "pageSize"] : []), ...context },
  };
}

/** Changing the grouping invalidates group selection, not the selected case population or scoring controls. */
export function regroupSearch(search: Record<string, unknown>, slicing: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...search, slicing };
  for (const key of ["page", "row", "pins", "within", "q", "kind", "layer", "confident", "group", "case", "constraint", "focus", "activity", "sel", "lens"]) delete next[key];
  return next;
}

export interface WorkbenchContext {
  projectId: string;
  project: Project | undefined;
  datasets: DatasetVersion[];
  dataset: DatasetVersion | undefined;
  datasetBinding?: ProjectDatasetBinding;
  datasetBindingState?: "loading" | "error" | "unbound" | "bound";
  projectDataset?: DatasetVersion;
  datasetBindingConflict?: { kind: "dataset" | "case_table" | "run"; datasetId?: string; boundDatasetId: string };
  /** Runs from the fixed project dataset; historical runs remain available in runs. */
  projectRuns?: Run[];
  caseTable: CaseTable | undefined;
  caseTableIds: string[];
  norms: NormVersion[];
  norm: NormVersion | undefined;
  runs: Run[];
  /** Completed observed alternatives for this case table and norm; empty until scenario membership is known. */
  scopeRuns?: Run[];
  run: Run | undefined;
  runId: string | undefined;
  isScenario: boolean;
  view: string | undefined;
  slicing: string | undefined;
  period: string | undefined;
  periods: { label: string; runId: string }[];
  isLoading: boolean;
  navigateRun: (runId: string, patch?: { view?: string; slicing?: string }) => void;
  setView: (view: string) => void;
  setSlicing: (slicing: string) => void;
}

export function useWorkbench(): WorkbenchContext {
  const params = useParams({ strict: false }) as { projectId?: string; runId?: string; datasetId?: string; normVersionId?: string; sliceKey?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown> & { view?: string; slicing?: string; caseTable?: string };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const projectId = params.projectId ?? "";
  const preferredView = useViewPreference((s) => s.byProject[projectId]);
  const chooseView = useViewPreference((s) => s.choose);

  const project = useQuery({ ...projectQuery(projectId), enabled: !!projectId });
  const datasets = useQuery({ ...datasetsQuery(projectId), enabled: !!projectId });
  const binding = useQuery({ ...projectBindingQuery(projectId), enabled: !!projectId });
  const tables = useQuery({ ...caseTablesQuery(projectId), enabled: !!projectId });
  const norms = useQuery({ ...normsQuery(projectId), enabled: !!projectId });
  const runs = useQuery({ ...runsQuery(projectId), enabled: !!projectId });
  const scenarios = useQuery({
    queryKey: ["projects", projectId, "scenarios"],
    queryFn: async () => {
      const list = unwrap(await api.GET("/projects/{projectId}/scenarios", { params: { path: { projectId } } }));
      return list.map((scenario) => scenario.runId);
    },
    enabled: !!projectId,
  });

  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  const datasetBindingState = binding.isError ? "error" : !binding.data ? "loading" : binding.data.datasetId ? "bound" : "unbound";
  const boundDatasetId = binding.data?.datasetId ?? undefined;
  const projectDataset = datasets.data?.find((d) => d.id === boundDatasetId);
  const boundTables = (tables.data ?? []).filter((table) => table.datasetId === boundDatasetId);
  const projectRuns = boundDatasetId ? runList.filter((r) => boundTables.some((table) => table.id === r.caseTableId)) : [];
  // A legacy saved run pointer can supply a preview, never a persistent binding. Do not guess the newest dataset.
  const defaultRuns = datasetBindingState === "bound" ? projectRuns : datasetBindingState === "unbound" ? runList.filter((r) => r.id === project.data?.latestRunId) : [];
  const runId = params.runId
    ? selectWorkbenchRunId(runs.data, undefined, params.runId, undefined)
    : params.datasetId ? undefined : selectWorkbenchRunId(defaultRuns, project.data?.latestRunId, undefined, scenarios.data);
  const run = runList.find((r) => r.id === runId);
  const scopeRuns = useMemo(() => selectScopeRuns(runList, run, scenarios.data), [runList, run, scenarios.data]);
  const runTable = tables.data?.find((table) => table.id === run?.caseTableId);
  const previewDatasetId = params.datasetId ?? runTable?.datasetId;
  const contextDatasetId = boundDatasetId ?? (datasetBindingState === "unbound" ? previewDatasetId : undefined);
  const matchingTables = (tables.data ?? []).filter((table) => table.status === "ready" && table.datasetId === contextDatasetId);
  const latestTable = [...matchingTables].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const requestedTable = tables.data?.find((table) => table.id === search.caseTable);
  const datasetMismatch = !!boundDatasetId && !!params.datasetId && params.datasetId !== boundDatasetId;
  const tableMismatch = !!search.caseTable && (!requestedTable || requestedTable.datasetId !== contextDatasetId);
  // Explicit historical assessments always retain their own table, even if a stale search parameter disagrees.
  const caseTableId = params.runId ? run?.caseTableId : datasetMismatch || tableMismatch ? undefined
    : search.caseTable ?? run?.caseTableId ?? latestTable?.id;
  const caseTable = useQuery({ ...caseTableQuery(projectId, caseTableId ?? ""), enabled: !!projectId && !!caseTableId });
  const selectedTable = caseTableId ? caseTable.data ?? tables.data?.find((table) => table.id === caseTableId) : undefined;
  const datasetId = params.runId ? selectedTable?.datasetId : params.datasetId ?? selectedTable?.datasetId ?? boundDatasetId;
  const dataset = datasets.data?.find((d) => d.id === datasetId);
  const datasetBindingConflict: WorkbenchContext["datasetBindingConflict"] = !boundDatasetId ? undefined
    : params.runId && selectedTable && selectedTable.datasetId !== boundDatasetId ? { kind: "run", datasetId: selectedTable.datasetId, boundDatasetId }
    : datasetMismatch ? { kind: "dataset", datasetId: params.datasetId, boundDatasetId }
    : !params.runId && tableMismatch ? { kind: "case_table", datasetId: requestedTable?.datasetId, boundDatasetId } : undefined;
  const normId = params.normVersionId ?? run?.normVersionId ?? norms.data?.[0]?.id;
  const norm = (norms.data ?? []).find((n) => n.id === normId);

  const availableViews = params.runId || !norm ? run?.views ?? normViewNames(norms.data?.[0]?.norm) : normViewNames(norm.norm);
  const view = search.view ?? (preferredView && availableViews.includes(preferredView) ? preferredView : availableViews[0]);
  const explicitKnownView = search.view && availableViews.includes(search.view) ? search.view : undefined;
  useEffect(() => {
    // A valid shared analysis link should keep its business focus through later steps too.
    if (projectId && explicitKnownView) chooseView(projectId, explicitKnownView);
  }, [projectId, explicitKnownView, chooseView]);
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? undefined;
  const periods = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of runList) {
      if (r.status !== "done" || !scenarios.data || scenarios.data.includes(r.id) || !tables.data?.some((table) => table.id === r.caseTableId && table.datasetId === datasetId)) continue;
      const label = r.note?.trim() || r.id;
      if (!seen.has(label)) seen.set(label, r.id);
    }
    return [...seen.entries()].map(([label, id]) => ({ label, runId: id }));
  }, [runList, scenarios.data, tables.data, datasetId]);
  const period = run ? run.note?.trim() || run.id : undefined;
  const caseTableIds = matchingTables.map((table) => table.id);

  const navigateRun = (nextRunId: string, patch?: { view?: string; slicing?: string }) => {
    const target = runList.find((r) => r.id === nextRunId);
    void navigate(workbenchRunDestination(projectId, nextRunId, target, run, pathname, search, patch) as never);
  };

  const patchOrGo = (patch: { view?: string; slicing?: string }) => {
    if (!runId) return;
    if (params.runId && patch.slicing !== undefined && params.sliceKey) {
      // A group key is meaningful only under the grouping that produced it.
      void navigate({ to: "/p/$projectId/runs/$runId/backlog", params: { projectId, runId }, search: { ...regroupSearch(search, patch.slicing), tab: undefined } } as never);
    } else if (params.runId && (params.sliceKey || /\/(backlog|flow|board|investigate)\/?$/.test(pathname))) {
      void navigate({ to: ".", search: (prev: Record<string, unknown>) => patch.slicing !== undefined ? regroupSearch(prev, patch.slicing) : { ...prev, ...patch, page: undefined, row: undefined } } as never);
    } else {
      navigateRun(runId, patch);
    }
  };

  return {
    projectId,
    project: project.data,
    datasets: boundDatasetId ? (datasets.data ?? []).filter((d) => d.id === boundDatasetId) : datasetBindingState === "unbound" ? datasets.data ?? [] : [],
    datasetBinding: binding.data,
    datasetBindingState,
    datasetBindingConflict,
    projectDataset,
    projectRuns,
    dataset,
    caseTable: selectedTable,
    caseTableIds,
    norms: norms.data ?? [],
    norm,
    runs: runList,
    scopeRuns,
    run,
    runId,
    isScenario: !!runId && !!scenarios.data?.includes(runId),
    view,
    slicing,
    period,
    periods,
    isLoading: project.isPending || runs.isPending || scenarios.isPending || binding.isPending || tables.isPending || datasets.isPending,
    navigateRun,
    setView: (v) => {
      chooseView(projectId, v);
      // Preparing data or a norm must not unexpectedly navigate into a previous run.
      if (params.normVersionId) void navigate({ to: ".", search: (previous: Record<string, unknown>) => ({ ...previous, view: v }) } as never);
      else if (params.runId) patchOrGo({ view: v });
    },
    setSlicing: (s) => patchOrGo({ slicing: s }),
  };
}
