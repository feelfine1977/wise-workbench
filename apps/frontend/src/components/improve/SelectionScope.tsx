import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { gatesQuery } from "@/lib/api/review";
import { fmtInt } from "@/lib/format";
import { count } from "./chartData";

/** Reuse the strictly checked selection response. Never substitute the run-wide filter-preview count. */
export function SelectionScope({ projectId, runId, slicing, sliceKey, view, filter, within, wholeGroupCases, noun, children }: {
  projectId: string; runId: string; slicing: string; sliceKey: string; view?: string; filter?: string; within?: string; wholeGroupCases?: number; noun: string; children?: ReactNode;
}) {
  const selected = filter !== undefined || within !== undefined;
  const checks = useQuery({ ...gatesQuery(projectId, runId, { slicing, sliceKey, view, filter }), enabled: !!slicing && !!sliceKey && filter !== undefined && within === undefined });
  const measured = selected && within === undefined && !checks.isError ? checks.data?.selection : undefined;
  const total = measured?.state === "measured" ? measured.wholeGroupCases : wholeGroupCases;
  return (
    <section aria-label="Assessment populations" className="rounded-lg border border-border bg-surface-sunken p-3" data-testid="selection-scope">
      <p className="text-sm" aria-live="polite">
        {selected && <>Selected in this group: <strong className="tnum">{measured?.state === "measured" ? fmtInt(measured.cases) : checks.isFetching ? "counting…" : "unavailable"}</strong> / </>}
        Whole group: <strong className="tnum">{count(total) ? fmtInt(total) : "unavailable"}</strong> {noun} · {view ?? "current view"}.
      </p>
      {selected && <p className="mt-1 text-xs text-text-muted">Selected-group rank, score and rank confidence are not supplied on this screen. Whole-group stability does not establish confidence in the selected {noun}.</p>}
      {within !== undefined && <p className="mt-1 text-xs text-text-muted">The parent-group selection stays in the address. An exact selected count is unavailable from the current checks contract.</p>}
      {selected && within === undefined && checks.isError && <p className="mt-1 text-xs text-text-muted">This exact selection could not be measured; no whole-group count has been substituted for it.</p>}
      {children && <div className="mt-2">{children}</div>}
    </section>
  );
}
