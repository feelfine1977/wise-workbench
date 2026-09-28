import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { WorkbenchContext } from "../context";
import { api, unwrap } from "@/lib/api";
import { flowTypeOf, selectionIdOf } from "@/lib/api/runs";
import { fmtDate, fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type AssessmentContext = Pick<WorkbenchContext, "datasetBindingState" | "datasetBinding" | "datasetBindingConflict" | "caseTable" | "projectRuns">;

/** A navigation choice only; it never changes the explorer's population or assessment context. */
export function compatibleAssessments(ctx: AssessmentContext, scenarioRunIds: readonly string[] | undefined) {
  if (scenarioRunIds === undefined || ctx.datasetBindingState !== "bound" || ctx.datasetBindingConflict || !ctx.caseTable
      || ctx.caseTable.datasetId !== ctx.datasetBinding?.datasetId) return [];
  const scenarios = new Set(scenarioRunIds);
  return (ctx.projectRuns ?? []).filter(run => run.status === "done" && run.caseTableId === ctx.caseTable?.id && !scenarios.has(run.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function ExistingAssessments({ ctx }: { ctx: WorkbenchContext }) {
  const [open, setOpen] = useState(false);
  const scenarios = useQuery({
    queryKey: ["projects", ctx.projectId, "scenarios"],
    queryFn: async () => unwrap(await api.GET("/projects/{projectId}/scenarios", {params:{path:{projectId:ctx.projectId}}})).map(s => s.runId),
    enabled: !!ctx.projectId,
  });
  const runs = compatibleAssessments(ctx, scenarios.isError ? undefined : scenarios.data);
  if (!runs.length) return null;
  return <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 py-1 text-xs" data-testid="existing-assessments">
    <span className="text-text-muted">Exploring data · no assessment selected</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="outline">Open existing assessment ({runs.length})</Button></PopoverTrigger>
      <PopoverContent aria-label="Saved assessments" align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto">
        <h2 className="font-semibold">Saved assessments for this preparation</h2>
        <p className="mt-1 text-xs text-text-muted">Open recorded results for {ctx.projectDataset?.name ?? ctx.dataset?.name ?? "the project dataset"}. Explorer filters are not applied to a past assessment.</p>
        <ul className="mt-3 space-y-2">
          {runs.map(run => {
            const norm = ctx.norms.find(n => n.id === run.normVersionId);
            const scope = selectionIdOf(run) ? `Saved selection${flowTypeOf(run) ? ` · ${flowTypeOf(run)} flow only` : ""}` : flowTypeOf(run) ? `${flowTypeOf(run)} flow only` : run.scope && Object.keys(run.scope).length ? "Scoped assessment" : "All prepared cases";
            return <li key={run.id} className="rounded border border-border p-3">
              <Link className="break-words font-medium text-accent-text underline" to="/p/$projectId/runs/$runId" params={{projectId:ctx.projectId,runId:run.id}} search={{tab:"monitor"}} onClick={() => setOpen(false)}>{run.note?.trim() || `Assessment · ${fmtDate(run.createdAt)}`}</Link>
              <p className="mt-1 text-xs text-text-muted">{norm ? `${norm.name} · version ${norm.version}` : `Norm ${run.normVersionId}`} · {scope}{typeof run.manifest?.cases === "number" && Number.isFinite(run.manifest.cases) ? ` · ${fmtInt(run.manifest.cases)} assessed cases` : " · assessed count unavailable"}</p>
              <p className="mt-1 break-all text-xs text-text-subtle">Preparation: {run.caseTableId} · {fmtDate(run.createdAt)}</p>
            </li>;
          })}
        </ul>
      </PopoverContent>
    </Popover>
  </div>;
}
