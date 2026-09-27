import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import type { Run } from "@wise/api-schema";
import type { FlowGraph as LibraryGraph } from "@wise/flow";
import { ProcessVariants } from "@/components/flow/ProcessVariants";
import { useTrackJob } from "@/app/shell/JobTray";
import { flowTypeOf, selectionIdOf, flowTypesQuery, flowTypeDefinitionsQuery, useCreateScopedRun, type FlowType } from "@/lib/api/runs";
import { clauseForValue, filterHash, serializeFilter } from "@/lib/filter";
import { groupingLabel } from "@/lib/sentences";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { fmtInt, fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { flowTypeDefinition } from "./flowTypeDefinition";

const FlowComparison = lazy(() => import("@wise/flow/react").then((m) => ({ default: m.FlowComparison })));
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";

export interface YourProcessProps {
  projectId: string;
  caseTableId: string;
  /** The runs of the project: the unscoped done run is the "everything together" analysis, scoped runs the forks. */
  runs: Run[];
  /** The unscoped run the forks belong to. */
  parentRun?: Run;
  /** "data" (S2: the choice of the analysis path) or "dashboard" (the overview with the switch). */
  mode: "data" | "dashboard";
  caseNoun?: string;
  className?: string;
  selectionId?: string;
  canAnalyse?: boolean;
}


/**
 * "Your process" (R2-O7, R2-O10): the log split by flow type with counts, aligned activity and connection comparisons and the choice
 * between analysing everything together and forking one run per flow type. "Analyse this flow" opens the
 * flow type's own run (creating it when it does not exist yet); the ribbon then offers a flow-type switcher.
 */
export function YourProcess({ projectId, caseTableId, runs, parentRun, mode, caseNoun = "cases", className, selectionId: requestedSelectionId, canAnalyse = true }: YourProcessProps) {
  const navigate = useNavigate();
  const selectionId = requestedSelectionId ?? selectionIdOf(parentRun);
  const flowTypes = useQuery(flowTypesQuery(projectId, caseTableId, undefined, 0, selectionId));
  const definitions = useQuery(flowTypeDefinitionsQuery(projectId, caseTableId));
  const create = useCreateScopedRun(projectId);
  const track = useTrackJob(projectId);
  const [forking, setForking] = useState(false);
  // the latest unscoped run of the case table is the "everything together" analysis the forks belong to
  const newestFirst = (a: Run, b: Run) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  const parent = parentRun ?? runs.filter((r) => r.status === "done" && selectionIdOf(r) === selectionId && !flowTypeOf(r) && r.caseTableId === caseTableId).sort(newestFirst)[0];
  // API list order is not a recency contract; an unfinished rerun must not hide a usable completed flow.
  const scoped = runs.filter((r) => selectionIdOf(r) === selectionId && flowTypeOf(r) && r.caseTableId === caseTableId && (!parent || r.normVersionId === parent.normVersionId))
    .sort((a, b) => Number(b.status === "done") - Number(a.status === "done") || newestFirst(a, b));
  const runFor = (name: string) => scoped.find((r) => flowTypeOf(r) === name);
  const noun = flowTypes.data?.caseNoun ?? caseNoun;
  const largest = flowTypes.data?.types.reduce<FlowType | undefined>((best, t) => !best || t.cases > best.cases ? t : best, undefined);
  const filterFor = (t: FlowType) => ({ and: [clauseForValue((t.scope as { attribute?: string }).attribute ?? flowTypes.data?.attribute ?? "flow_type", t.name)] });

  const fork = async (types: FlowType[]) => {
    if (!parent || !canAnalyse) return;
    setForking(true);
    try {
      for (const t of types) {
        if (runFor(t.name)) continue;
        const run = await create.mutateAsync({ caseTableId: parent.caseTableId, normVersionId: parent.normVersionId, views: parent.views, slicings: parent.slicings, gamma: parent.gamma, minCases: parent.minCases, note: `${parent.note ?? parent.id} · ${t.name}`, scope: { ...(selectionId ? { selection_id: selectionId } : {}), flow_type: t.name, attribute: (t.scope as { attribute?: string }).attribute ?? flowTypes.data?.attribute ?? "flow_type" } });
        if (run.jobId) track({ id: run.jobId, kind: "score_run", status: "queued", progress: 0, attempts: 0, cancelRequested: false, createdAt: run.createdAt, updatedAt: run.createdAt }, `Score ${t.name} (${run.id})`, { kind: "run", id: run.id });
      }
    } catch {
      /* the mutation's error is shown below the buttons */
    } finally {
      setForking(false);
    }
  };

  /**
   * The card is the entry into the flow (R3-O5): the map of that flow type opens full width on the Flow step
   * — the flow type's own run when it has one, otherwise the whole run with the flow type as a chip, which
   * the map, the board and every export carry.
   */
  const openMap = (t: FlowType) => {
    const own = runFor(t.name);
    if (own?.status === "done") {
      void navigate({ to: "/p/$projectId/runs/$runId/flow", params: { projectId, runId: own.id }, search: { render: "map" as const } });
      return;
    }
    if (!parent) return;
    const filter = filterFor(t);
    void navigate({
      to: "/p/$projectId/runs/$runId/flow",
      params: { projectId, runId: parent.id },
      search: { render: "map" as const, filter: serializeFilter(filter), fh: filterHash(filter), slicing: parent.slicings?.[0]?.id ?? undefined, view: parent.views?.[0] },
    });
  };

  const analyse = (t: FlowType) => {
    const existing = runFor(t.name);
    if (existing?.status === "done") {
      void navigate({ to: "/p/$projectId/runs/$runId/backlog", params: { projectId, runId: existing.id }, search: { slicing: existing.slicings?.[0]?.id ?? undefined, view: existing.views?.[0] } });
      return;
    }
    if (existing) {
      void navigate({ to: "/p/$projectId/runs/$runId", params: { projectId, runId: existing.id }, search: { tab: "monitor" } });
      return;
    }
    if (!parent) {
      void navigate({ to: "/p/$projectId/runs", params: { projectId }, search: { new: true, caseTable: caseTableId, selection: selectionId, flowType: t.name } });
      return;
    }
    void fork([t]);
  };

  return (
    <section aria-labelledby="your-process-heading" className={cn("flex flex-col gap-4", className)} data-testid="your-process">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 id="your-process-heading" className="text-xl font-semibold">
          Your process
        </h2>
        <HowToReadToggle id="your-process" />
        {flowTypes.data && (
          <p className="reading basis-full text-base text-text-muted">
            {/* the attribute is named in words: the sentence read "by flow_type" on the dashboard and the data step (P1-13) */}
            Compare {flowTypes.data.types.length} flow types{flowTypes.data.attribute ? ` by ${groupingLabel(undefined, [flowTypes.data.attribute])}` : ""}; {largest?.name} contains{" "}
            {fmtPct(largest?.share ?? 0)} of the {fmtInt(flowTypes.data.cases)} {noun}.
          </p>
        )}
      </header>
      <HowToRead id="your-process">
        A flow type groups {noun} using the data mapping; it can contain many different activity sequences.
        The comparison below uses the same activity or connection in every column, with percentages of that flow type.
        Differences can be expected for different process types. Use <strong>Common process paths</strong> to inspect complete recorded sequences, or <strong>Open the map</strong> to explore activities, returns and repeats.
        WISE assessment also depends on the Process norm and its applicability.
      </HowToRead>
      {flowTypes.isPending && <LoadingBlock rows={3} />}
      {flowTypes.isError && <ErrorBlock error={flowTypes.error} retry={() => void flowTypes.refetch()} />}
      {flowTypes.data && (
        <>
          <Card className="min-w-0 space-y-3" data-testid="flow-type-comparison">
            <div><h3 className="text-lg font-semibold">What actually differs?</h3><p className="text-sm text-text-muted">Read the same activity or connection across the flow types. Each bar uses that type’s own number of {noun}.</p></div>
            <Suspense fallback={<LoadingBlock rows={5} />}>
              <FlowComparison noun={noun} cohorts={flowTypes.data.types.map((t) => ({ id: t.name, label: t.name, cases: t.cases, graph: t.map as unknown as LibraryGraph }))} onSelect={parent || scoped.some((r) => r.status === "done") ? (id) => { const t = flowTypes.data.types.find((t) => t.name === id); if (t) openMap(t); } : undefined} />
            </Suspense>
          </Card>
          <h3 className="text-lg font-semibold">Explore a flow type</h3>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4" aria-label="Flow types">
            {flowTypes.data.types.map((t) => {
              const run = runFor(t.name);
              const definition = flowTypeDefinition(definitions.data?.flowTyping?.find((r) => r.name === t.name)?.rule);
              return (
                <li key={t.name}>
                  <Card className="flex h-full flex-col gap-3" data-flow-type={t.name}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-lg font-semibold">{t.name}</h3>
                      <span className="tnum text-sm text-text-muted">
                        <strong className="text-text">{fmtInt(t.cases)}</strong> {noun} · {fmtPct(t.share, t.share < 0.1 ? 1 : 0)}
                      </span>
                    </div>
                    {/* the rule's own sentence: a data-quality variant (linking gap, child cases) must not read as a business variant */}
                    {t.note ? <p className="text-sm text-text-muted">{t.note}</p> : definition && <p className="text-sm text-text-muted"><strong className="text-text">{definition.value}</strong><br />Classified by {groupingLabel(undefined, [definition.attribute])}; the recorded path may differ.</p>}
                    <div role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={t.share} aria-label={`${t.name}: ${fmtPct(t.share, 1)} of the ${noun}`} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, t.share * 100)}%` }} />
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-text-muted">Recorded activities</dt><dd className="text-xl font-semibold tnum">{fmtInt(t.activities)}</dd></div>
                      <div><dt className="text-text-muted">Median recorded span</dt><dd className="text-xl font-semibold tnum">{t.readiness.medianDurationDays == null ? "Unavailable" : `${fmtNum(t.readiness.medianDurationDays, 1)} days`}</dd></div>
                    </dl>
                    <details className="text-xs text-text-muted"><summary className="cursor-pointer">Data coverage and cautions</summary><p className="mt-2">{t.readiness.headline}</p><p className="mt-1">The span runs from the first to the last recorded event; it is not necessarily completion time.</p></details>
                    {(t.readiness.censoredShare ?? 0) > 0.05 && (
                      <p className="text-xs text-warning">
                        <span aria-hidden>! </span>
                        {fmtPct(t.readiness.censoredShare ?? 0, 0)} flagged as potentially incomplete at the data cutoff
                      </p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => openMap(t)} disabled={!parent && !run} aria-label={`Open the map of the ${t.name} flow`}>
                        Open the map
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => analyse(t)} disabled={!canAnalyse} aria-label={`Analyse the ${t.name} flow`}>
                        {run?.status === "done" ? "Open this flow" : run ? "Run in progress…" : "Analyse this flow"}
                      </Button>
                      {(parent || run?.status === "done") && <ProcessVariants projectId={projectId} runId={run?.status === "done" ? run.id : parent!.id} filter={run?.status === "done" ? undefined : serializeFilter(filterFor(t))} />}
                      {parent && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: parent.id }} search={{ tab: "compare" }} aria-label={`Compare the ${t.name} flow with the others`}>
                            Compare
                          </Link>
                        </Button>
                      )}
                      {run && (
                        <Badge variant={run.status === "done" ? "success" : "info"}>
                          <span className="font-mono">{run.id}</span>
                        </Badge>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3" data-testid="flow-fork">
            <span className="text-sm font-medium">How do you want to analyse?</span>
            {parent ? (
              <Button asChild variant={mode === "dashboard" ? "outline" : "default"}>
                <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId, runId: parent.id }} search={{ slicing: parent.slicings?.[0]?.id ?? undefined, view: parent.views?.[0] }}>
                  Compare everything together
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/p/$projectId/runs" params={{ projectId }} search={{ new: true, caseTable: caseTableId, selection: selectionId }}>
                  Compare everything together (start a run)
                </Link>
              </Button>
            )}
            <Button variant="outline" disabled={!canAnalyse || !parent || forking || flowTypes.data.types.every((t) => runFor(t.name))} onClick={() => void fork(flowTypes.data!.types)}>
              {flowTypes.data.types.every((t) => runFor(t.name)) ? "Every flow type has its run" : forking ? "Forking…" : "Analyse per flow type"}
            </Button>
            {parent && (
              <Link className="text-sm text-accent-text underline" to="/p/$projectId/runs/$runId" params={{ projectId, runId: parent.id }} search={{ tab: "compare" }}>
                flow types side by side
              </Link>
            )}
            <span className="reading basis-full text-xs text-text-subtle">
              Forking creates one run per flow type with the same saved filter, norm, perspectives and groupings; the norm's applicability rules stay as they are. The ribbon gains a flow-type switcher when the runs are done.
            </span>
            {create.isError && <ErrorBlock error={create.error} className="basis-full" />}
          </div>
        </>
      )}
    </section>
  );
}
