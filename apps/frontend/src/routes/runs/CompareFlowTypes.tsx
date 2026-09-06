import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Run } from "@wise/api-schema";
import { compareFlowTypesQuery, flowTypeOf, type FlowTypeComparisonEntry } from "@/lib/api/cycle2";
import { KindBadge } from "@/components/badges";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/misc";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { sliceLabel } from "@/lib/utils";

/**
 * Flow types side by side (R2-O10): for a run without scope, one column per flow type with its cases, its
 * average score against the overall one in the chosen perspective, its largest groups and the expectation
 * it misses most. Columns whose flow type has a run of its own link to that run.
 */
export function CompareFlowTypes({ projectId, runId, view, slicing, runs, caseNoun = "cases" }: { projectId: string; runId: string; view?: string; slicing?: string; runs: Run[]; caseNoun?: string }) {
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  const q = useQuery(compareFlowTypesQuery(projectId, runId));
  if (q.isPending) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const data = q.data;
  const noun = data.caseNoun ?? caseNoun;
  const v = view && data.views.includes(view) ? view : (data.views[0] ?? "");
  const overall = (data.overall as Record<string, { mean_score?: number; cases?: number }>)[v];
  const parent = runs.find((r) => r.id === runId);
  const runFor = (name: string) => runs.find((r) => r.status === "done" && flowTypeOf(r) === name && r.caseTableId === parent?.caseTableId && r.normVersionId === parent?.normVersionId)?.id;
  const types = data.types as unknown as FlowTypeComparisonEntry[];
  const column = (t: FlowTypeComparisonEntry) => {
    const own = t.views[v];
    const delta = own && overall?.mean_score !== undefined ? (own.mean_score - overall.mean_score) * 100 : undefined;
    const scopedRun = t.runId ?? runFor(t.name);
    return (
      <Card key={t.name} className="flex flex-col gap-3" data-flow-type={t.name}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">{t.name}</h3>
          <span className="tnum text-sm text-text-muted">
            {fmtInt(t.cases)} {noun} · {fmtPct(t.share, t.share < 0.1 ? 1 : 0)}
          </span>
        </div>
        {own && (
          <p className="reading text-base">
            {plain ? "rules met" : "mean score"} <strong className="tnum">{fmtPct(own.mean_score, 1)}</strong>
            {delta !== undefined && (
              <span className={delta < 0 ? "text-danger" : "text-success"}>
                {" "}
                ({delta >= 0 ? "+" : ""}
                {fmtNum(delta, 1)} points against everyone)
              </span>
            )}
          </p>
        )}
        {t.mostMissed && (
          <p className="reading text-sm text-text-muted">
            missed most: <strong className="text-text">{plain ? (t.mostMissed.plain_name ?? t.mostMissed.description) : t.mostMissed.constraint}</strong> in {fmtPct(t.mostMissed.share, 0)} of {noun}
          </p>
        )}
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-subtle">largest groups</p>
          <ol className="flex flex-col gap-1.5 text-sm">
            {t.topGroups.slice(0, 3).map((row) => (
              <li key={row.key} className="flex flex-wrap items-baseline gap-2">
                {scopedRun ? (
                  <Link className="font-medium text-accent-text underline" to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId, runId: scopedRun, sliceKey: row.key }} search={{ slicing: data.slicing ?? slicing, view: v, tab: "flow" }}>
                    {sliceLabel(row)}
                  </Link>
                ) : (
                  <span className="font-medium">{sliceLabel(row)}</span>
                )}
                <KindBadge kind={row.kind} short />
                <span className="tnum text-text-muted">
                  {fmtInt(row.n_cases)} · {fmtNum(row.gap * 100, 1)} points below
                </span>
              </li>
            ))}
          </ol>
        </div>
        {(t.censoredShare ?? 0) > 0.05 && (
          <p className="text-xs text-warning">
            <span aria-hidden>! </span>
            {fmtPct(t.censoredShare ?? 0, 0)} still open at the end of the data
          </p>
        )}
        {scopedRun ? (
          <Link className="mt-auto text-sm text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId, runId: scopedRun }} search={{ slicing: data.slicing ?? slicing, view: v }}>
            open the {t.name} run
          </Link>
        ) : (
          <Badge variant="outline" className="mt-auto self-start">
            no run of its own yet
          </Badge>
        )}
      </Card>
    );
  };
  return (
    <section aria-label="Flow types side by side" className="flex flex-col gap-3" data-testid="compare-flow-types">
      <p className="reading text-sm text-text-muted">
        {types.length} flow types by {data.attribute.replace(/^case /, "")} in the {v} perspective{data.slicing ? `, grouped by ${data.slicing.replace(/case /g, "").replace(/\+/g, " × ")}` : ""}; the overall score is {fmtPct(overall?.mean_score ?? 0, 1)} over {fmtInt(overall?.cases)} {noun}. Columns with a run of their own link to it.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{types.map(column)}</div>
    </section>
  );
}
