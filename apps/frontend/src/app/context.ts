/**
 * The workbench context: which project · dataset · mapping · norm · run · view · slice key · period a screen
 * is scoped to. Derived from route params and search params; nothing on a screen is ambiguous about its inputs.
 */
import { useMemo } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { CaseTable, DatasetVersion, NormVersion, Project, Run } from "@wise/api-schema";
import { caseTableQuery, datasetsQuery, normsQuery, projectQuery, runsQuery } from "@/lib/queries";

export interface WorkbenchContext {
  projectId: string;
  project: Project | undefined;
  datasets: DatasetVersion[];
  dataset: DatasetVersion | undefined;
  caseTable: CaseTable | undefined;
  caseTableIds: string[];
  norms: NormVersion[];
  norm: NormVersion | undefined;
  runs: Run[];
  run: Run | undefined;
  runId: string | undefined;
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
  const search = useSearch({ strict: false }) as { view?: string; slicing?: string; caseTable?: string };
  const navigate = useNavigate();
  const projectId = params.projectId ?? "";

  const project = useQuery({ ...projectQuery(projectId), enabled: !!projectId });
  const datasets = useQuery({ ...datasetsQuery(projectId), enabled: !!projectId });
  const norms = useQuery({ ...normsQuery(projectId), enabled: !!projectId });
  const runs = useQuery({ ...runsQuery(projectId), enabled: !!projectId });

  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  const runId = params.runId ?? project.data?.latestRunId ?? runList.find((r) => r.status === "done")?.id;
  const run = runList.find((r) => r.id === runId);
  const caseTableId = search.caseTable ?? run?.caseTableId;
  const caseTable = useQuery({ ...caseTableQuery(projectId, caseTableId ?? ""), enabled: !!projectId && !!caseTableId });

  const datasetId = params.datasetId ?? caseTable.data?.datasetId;
  const dataset = (datasets.data ?? []).find((d) => d.id === datasetId);
  const normId = params.normVersionId ?? run?.normVersionId;
  const norm = (norms.data ?? []).find((n) => n.id === normId);

  const view = search.view ?? run?.views?.[0];
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? undefined;
  const periods = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of runList) {
      if (r.status !== "done") continue;
      const label = r.note?.trim() || r.id;
      if (!seen.has(label)) seen.set(label, r.id);
    }
    return [...seen.entries()].map(([label, id]) => ({ label, runId: id }));
  }, [runList]);
  const period = run ? run.note?.trim() || run.id : undefined;
  const caseTableIds = useMemo(() => [...new Set(runList.map((r) => r.caseTableId).filter(Boolean))], [runList]);

  const navigateRun = (nextRunId: string, patch?: { view?: string; slicing?: string }) => {
    const target = runList.find((r) => r.id === nextRunId);
    const nextView = patch?.view ?? view;
    const nextSlicing = patch?.slicing ?? slicing;
    if (!target || target.status !== "done") {
      void navigate({ to: "/p/$projectId/runs/$runId", params: { projectId, runId: nextRunId } });
      return;
    }
    void navigate({
      to: "/p/$projectId/runs/$runId/backlog",
      params: { projectId, runId: nextRunId },
      search: {
        slicing: (target.slicings?.some((s) => s.id === nextSlicing) ? nextSlicing : target.slicings?.[0]?.id) ?? undefined,
        view: target.views?.includes(nextView ?? "") ? nextView : target.views?.[0],
      },
    });
  };

  const patchOrGo = (patch: { view?: string; slicing?: string }) => {
    if (!runId) return;
    if (params.runId && (params.sliceKey || location.pathname.endsWith("/backlog"))) {
      // stay on the current screen and re-scope it
      void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, ...patch, page: undefined, row: undefined }) } as never);
    } else {
      navigateRun(runId, patch);
    }
  };

  return {
    projectId,
    project: project.data,
    datasets: datasets.data ?? [],
    dataset,
    caseTable: caseTable.data,
    caseTableIds,
    norms: norms.data ?? [],
    norm,
    runs: runList,
    run,
    runId,
    view,
    slicing,
    period,
    periods,
    isLoading: project.isPending || runs.isPending,
    navigateRun,
    setView: (v) => patchOrGo({ view: v }),
    setSlicing: (s) => patchOrGo({ slicing: s }),
  };
}
