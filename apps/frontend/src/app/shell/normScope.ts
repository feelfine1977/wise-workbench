import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { analysisSelectionsQuery } from "@/lib/api/analysisSelections";
import { selectionIdOf } from "@/lib/api/runs";
import type { WorkbenchContext } from "../context";

/** Norm evidence and new-run setup may share a cohort only within the fixed preparation. */
export function useNormScope(ctx: WorkbenchContext) {
  const pathname = useRouterState({select: state => state.location.pathname});
  const search = useRouterState({select: state => state.location.search as Record<string, unknown>});
  const defining = /\/norms\/[^/]+$/.test(pathname);
  const table = ctx.datasetBindingState === "bound" && !ctx.datasetBindingConflict
    && ctx.caseTable?.datasetId === ctx.datasetBinding?.datasetId
    && (!defining || !search.caseTable || search.caseTable === ctx.caseTable?.id) ? ctx.caseTable : undefined;
  const requested = defining ? typeof search.selection === "string" ? search.selection : undefined
    : table && ctx.run?.caseTableId === table.id ? selectionIdOf(ctx.run) : undefined;
  const selections = useQuery({...analysisSelectionsQuery(ctx.projectId, table?.id ?? ""), enabled: !!requested && !!table});
  const selection = !selections.isError && selections.data?.find(item => item.id === requested && item.caseTableId === table?.id && item.datasetId === table?.datasetId)?.id || undefined;
  const blockedReason = requested && !selection ? table && selections.isPending ? "Verifying the saved cohort for this preparation" : "Return to the norm evidence population and choose a cohort from this preparation" : undefined;
  return {defining, caseTableId: table?.id, selection, blockedReason};
}
