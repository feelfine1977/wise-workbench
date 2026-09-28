import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { summarizeReadiness } from "@/app/shell/readiness";
import { normsQuery } from "@/lib/queries";
import { flowTypeOf, selectionIdOf } from "@/lib/api/runs";
import type { BacklogParams as BacklogParamsC2, BacklogRow as BacklogRowC2 } from "@/lib/api/exploration";
import { GateBadge, KindBadge } from "@/components/badges";
import { FreezeButton } from "@/components/guide/Freeze";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { ReadingSentence } from "@/components/reading";
import { EmptyState, LoadingBlock } from "@/components/states";
import { useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/misc";
import { useWorkbench } from "@/app/context";
import { fmtDateTime, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery } from "@/lib/api/exploration";
import { runSummaryQuery } from "@/lib/api/runs";
import { notServed } from "@/lib/api/compatibility";
import { reviewQuery, type ReviewItem } from "@/lib/api/review";
import { useFindingStore } from "@/lib/stores/findings";
import { comparisonSentence, groupLabel, missedPhrase, sharedKeyValues } from "@/lib/sentences";
import { sliceLabel, tableRecords } from "@/lib/utils";
import { plainReadiness } from "./data/ReadinessDecisions";
import { distanceSentence } from "./backlog/SignalCard";
import { YourProcess } from "./flow/YourProcess";

/** What a review record is, in words: the kinds the server keeps. */
const recordWords = (kind: string) => ({ action: "action", hypothesis: "to test", finding: "finding", gate: "check" })[kind] ?? kind;
/** The role a record names, wherever the kind writes it. */
const ownerOf = (r: ReviewItem) => {
  const own = r as { owner_role?: string | null; owner?: string | null };
  const value = own.owner_role ?? own.owner;
  return typeof value === "string" && value ? value : undefined;
};

/**
 * The dashboard (R2-O9): one dominant sentence — the top signal of the latest run — with the next step, then
 * "Your process" split by flow type (R2-O7, R2-O10), the data caveats in one line and the open findings.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  const ctx = useWorkbench();
  const run = ctx.run;
  const parent = (ctx.scopeRuns ?? []).find((r) => !flowTypeOf(r));
  const summary = useQuery({ ...runSummaryQuery(ctx.projectId, run?.id ?? ""), enabled: !!run && run.status === "done" });
  const slicing = ctx.slicing ?? "";
  const top = useQuery({ ...backlogQuery(ctx.projectId, run?.id ?? "", { slicing, view: ctx.view, minCases: run?.minCases ?? 20, sort: "-stable_PI", page: 1, pageSize: 10 }), enabled: !!run && run.status === "done" && !!slicing });
  /**
   * *Open findings* is what the **server** holds (P1-6).
   *
   * An action proposed on *What can we do?* was saved on the server and the dashboard read a different,
   * browser-local list, so the exit criterion's *appears on the dashboard* failed: the card said "No finding
   * yet" while the run held the action. It now reads the three review collections, so a record made in one
   * browser is on the dashboard of the next one and survives a restart. The local store is kept only for the
   * analyst's own slice disposition, which has no endpoint yet, and is shown beside them.
   */
  const actions = useQuery({ ...reviewQuery(ctx.projectId, "actions"), enabled: !!ctx.projectId });
  const hypotheses = useQuery({ ...reviewQuery(ctx.projectId, "hypotheses"), enabled: !!ctx.projectId });
  const serverFindings = useQuery({ ...reviewQuery(ctx.projectId, "findings"), enabled: !!ctx.projectId });
  const open = (rows: ReviewItem[] | undefined) => (rows ?? []).filter((r) => !["done", "dropped", "closed", "rejected"].includes(String(r.status)));
  const records = [...open(actions.data), ...open(hypotheses.data), ...open(serverFindings.data)].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const recordsUnavailable = notServed(actions.error) && notServed(hypotheses.error) && notServed(serverFindings.error);
  const findings = Object.values(useFindingStore((s) => s.findings)).filter((f) => f.projectId === ctx.projectId);
  const readiness = ctx.caseTable?.readiness;
  const readinessSummary = summarizeReadiness(readiness);
  const norms = useQuery(normsQuery(ctx.projectId));

  if (ctx.isLoading) return <LoadingBlock rows={6} />;
  const project = ctx.project;
  const concentration = tableRecords<{ threshold: number; top_k: number; share_of_slices: number }>(summary.data?.concentration?.[slicing]?.[ctx.view ?? ""]);
  const priorityConcentration = concentration.find((r) => r.threshold === 0.8) ?? concentration[0];
  const mean = summary.data?.means?.[ctx.view ?? ""];
  const scored = summary.data?.scored?.[ctx.view ?? ""];
  const meanKnown = typeof mean === "number" && Number.isFinite(mean) && mean >= 0 && mean <= 1;
  const resumeTable = ctx.datasetBindingConflict ? undefined : ctx.caseTable;
  const resumeNorm = ctx.norm;
  const savedSelection = run?.caseTableId === resumeTable?.id ? selectionIdOf(run) : undefined;
  const first = top.data?.rows[0] as BacklogRowC2 | undefined;
  // the part of the name every group shares (the company on BPIC 2019) is dropped
  const firstLabel = first ? groupLabel(first, sharedKeyValues(top.data?.rows ?? [])) : "";
  const params = (top.data?.params ?? {}) as BacklogParamsC2;
  const noun = plain ? (first?.case_noun ?? params.case_noun ?? "cases") : "cases";
  const warns = (readiness?.items ?? []).filter((i) => i.level === "warn");
  const fails = (readiness?.items ?? []).filter((i) => i.level === "fail");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-subtle">Steering question</p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              {project?.name}
              <HowToReadToggle id="dashboard" />
            </h1>
          </div>
          {run && run.status === "done" && (
            <div data-no-capture>
              <FreezeButton projectId={ctx.projectId} screen="dashboard" context={{ run_id: run.id, slicing, view: ctx.view, scope: (run.scope as never) ?? null }} data={{ top: first, means: summary.data?.means }} defaultTitle={`Dashboard · ${project?.name ?? ""}`} />
            </div>
          )}
        </div>
        <ReadingSentence text={project?.question ?? undefined} className="reading text-text-muted" />
        <HowToRead id="dashboard">
          The group under "Start with this group" has the largest ranked signal in this assessment: which group of {noun}, how far below the overall score, and the largest expectation shortfall. Follow the next step to its reasons, or start from <strong>Your process</strong> to
          decide whether to compare everything together or to analyse each flow type on its own.
        </HowToRead>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Project actions">
        {resumeTable ? (
          <Link to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: resumeTable.datasetId }} search={{ caseTable: resumeTable.id, tab: "understand" }} className="surface p-4 hover:border-accent"><strong className="text-accent-text">Understand your data</strong><p className="mt-1 text-sm text-text-muted">Resume the selected dataset and its prepared case table.</p></Link>
        ) : (
          <Link to="/p/$projectId/data" params={{ projectId: ctx.projectId }} className="surface p-4 hover:border-accent"><strong className="text-accent-text">Choose & understand data</strong><p className="mt-1 text-sm text-text-muted">Select a log, learn the process and explore recorded cases.</p></Link>
        )}
        {resumeNorm ? (
          <Link to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: resumeNorm.id }} search={{ caseTable: resumeTable?.id, selection: savedSelection, tab: "guide" }} className="surface p-4 hover:border-accent"><strong className="text-accent-text">Review your Process norm</strong><p className="mt-1 text-sm text-text-muted">Version {resumeNorm.version}{run?.normVersionId === resumeNorm.id ? " used in this assessment" : " in the current context"}. Reopen its expectations and priorities.</p></Link>
        ) : (
          <Link to="/p/$projectId/norms" params={{ projectId: ctx.projectId }} className="surface p-4 hover:border-accent"><strong className="text-accent-text">Create or edit a Process norm</strong><p className="mt-1 text-sm text-text-muted">Start with your purpose and data, then define expectations and priorities.</p></Link>
        )}
        <Link to="/p/$projectId/runs" params={{ projectId: ctx.projectId }} search={{ caseTable: resumeTable?.id, selection: savedSelection }} className="surface p-4 hover:border-accent"><strong className="text-accent-text">Run WISE & analyse</strong><p className="mt-1 text-sm text-text-muted">Start an assessment with this preparation, or reopen a previous run.</p></Link>
      </section>

      {!ctx.datasets.length && (
        <EmptyState
          title={t("empty.noDatasets")}
          reason={t("empty.noDatasetsReason")}
          action={{ label: "Drop an event log or load a public log", to: "/p/$projectId/data", params: { projectId: ctx.projectId }, why: "The data caveats tell you whether the log can carry a ranked list." }}
          alternative={{ label: "define your first expectation", to: "/p/$projectId/norms", params: { projectId: ctx.projectId } }}
        />
      )}

      {ctx.datasets.length > 0 && !run && (
        ctx.datasetBindingState !== "bound" || ctx.datasetBindingConflict || ctx.caseTable?.status !== "ready" ? <EmptyState
          title="Prepare your project data"
          reason="Choose the fixed project dataset and prepare a case table before assessing a Process norm."
          action={{ label: "Check mapping and readiness", to: "/p/$projectId/data", params: { projectId: ctx.projectId } }}
        /> : norms.isPending ? <LoadingBlock rows={2} /> : norms.isError ? <EmptyState
          title="Process norm versions unavailable"
          reason="Open Process norms to retry before starting an assessment."
          action={{ label: "Open Process norms", to: "/p/$projectId/norms", params: { projectId: ctx.projectId } }}
        /> : !norms.data?.length ? <EmptyState
          title={t("empty.noNorms")}
          reason={t("empty.noNormsReason")}
          action={{ label: "Define your first expectation", to: "/p/$projectId/norms", params: { projectId: ctx.projectId }, why: "An assessment needs a saved Process norm version to compare against the prepared data." }}
        /> : <EmptyState
          title={t("empty.noRuns")}
          reason={t("empty.noRunsReason")}
          action={{ label: "Create a run", to: "/p/$projectId/runs", params: { projectId: ctx.projectId }, why: "Choose a saved norm version. A draft can be assessed; its review status stays visible." }}
          alternative={{ label: "open Process norm versions", to: "/p/$projectId/norms", params: { projectId: ctx.projectId } }}
        />
      )}

      {ctx.caseTable && <aside aria-label="Data checks for this preparation" className="rounded-md border border-border bg-surface-sunken p-3 text-sm">
        <Link className="font-medium text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: ctx.caseTable.datasetId }} search={{caseTable: ctx.caseTable.id, tab: "readiness"}}>Data checks: {readinessSummary.label}</Link>
        {run?.status === "done" && <p className="mt-1 text-text-muted">Ranking stability describes the ordering within this assessment. It does not establish data fitness or a cause.</p>}
      </aside>}

      {run && run.status === "done" && (
        <section aria-labelledby="kpi-heading" className="flex flex-col gap-4">
          <Card className="flex flex-col gap-5">
            <div>
              <CardTitle as="h2" id="kpi-heading" className="mb-1 text-lg">Assessment overview</CardTitle>
              <p className="text-sm text-text-muted" title={run.id}>
                {run.note || "Latest assessment"} · {ctx.view ?? "Selected"} view
                {flowTypeOf(run) ? ` · ${flowTypeOf(run)} flow only` : selectionIdOf(run) ? " · saved selection" : ""}
                {run.manifest?.finishedAt && <> · finished {fmtDateTime(run.manifest.finishedAt)}</>}
              </p>
            </div>
            {summary.isPending ? <LoadingBlock rows={2} /> : summary.isError ? (
              <p role="alert" className="text-sm text-text-muted">Assessment summary unavailable. <button type="button" className="text-accent-text underline" onClick={() => void summary.refetch()}>Retry summary</button></p>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-3" aria-label="Assessment statistics">
                <div className="rounded-lg border border-accent/30 bg-accent/5 p-4" data-testid="mean-score-stat">
                  <dt className="text-sm font-medium text-text-muted">Mean WISE score</dt>
                  <dd className="mt-2 tnum text-3xl font-semibold text-text">{meanKnown ? <>{fmtNum(mean * 100, 1)} <span className="text-base font-normal text-text-muted">/ 100</span></> : <span className="text-lg">Unavailable</span>}</dd>
                  <dd className="mt-2 text-sm text-text-muted">{ctx.view ?? "Selected"} view{scored != null ? ` · ${fmtInt(scored)} scored cases` : ""}</dd>
                </div>
                <div className="rounded-lg border border-border bg-surface-sunken p-4" data-testid="case-count-stat">
                  <dt className="text-sm font-medium text-text-muted">Cases in this assessment</dt>
                  <dd className="mt-2 tnum text-3xl font-semibold text-text">{summary.data?.cases != null ? fmtInt(summary.data.cases) : <span className="text-lg">Unavailable</span>}</dd>
                  <dd className="mt-2 text-sm text-text-muted">{flowTypeOf(run) ? `${flowTypeOf(run)} flow only` : selectionIdOf(run) ? "Saved selection only" : "Within the saved run scope"}</dd>
                </div>
                <div className="rounded-lg border border-border bg-surface-sunken p-4" data-testid="priority-stat">
                  <dt className="text-sm font-medium text-text-muted">Priority concentration</dt>
                  <dd className="mt-2 tnum text-3xl font-semibold text-text">{priorityConcentration ? <>{fmtInt(priorityConcentration.top_k)} <span className="text-base font-normal text-text-muted">group{priorityConcentration.top_k === 1 ? "" : "s"}</span></> : <span className="text-lg">Unavailable</span>}</dd>
                  <dd className="mt-2 text-sm text-text-muted">{priorityConcentration ? `Account for ${fmtPct(priorityConcentration.threshold)} of ranked priority in this grouping.` : "No concentration summary for this grouping."}</dd>
                </div>
              </dl>
            )}
            <div className="border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-semibold text-text">Start with this group</h3>
              {first ? (
                <>
                  <p className="reading headline text-text" data-testid="top-signal">
                    <strong>{firstLabel}</strong> <KindBadge kind={first.kind} hotspotType={first.hotspot_type} short className="mx-1 align-baseline" /> — <strong className="tnum">{fmtInt(first.n_cases)}</strong> {noun}.{" "}
                    {Number.isFinite(first.gap) ? <><strong className="tnum">{fmtNum(Math.abs(first.gap) * 100, 2)} score points</strong> {first.gap < 0 ? "above" : "below"} this run’s mean.</> : "Score difference unavailable."}
                  </p>
                  {missedPhrase(first) && <p className="mt-1 text-sm text-text-muted">Largest expectation shortfall: {plain ? missedPhrase(first) : first.dominant_layer_name}.</p>}
                  {first.comparison && <p className="reading mt-1 text-base text-text-muted">{comparisonSentence(first)}</p>}
                </>
              ) : top.isPending ? <LoadingBlock rows={1} /> : <p className="text-sm text-text-muted">{top.isError ? "Ranked groups unavailable. Open the ranked list to retry." : "No ranked group meets the current assessment settings."}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/investigate" params={{projectId:ctx.projectId,runId:run.id}} search={{view:ctx.view,slicing:ctx.slicing}}>Investigate a process question</Link>
              <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: run.id }} search={{ slicing: ctx.slicing, view: ctx.view }}>
                {plain ? "Open the ranked list" : "Open backlog explorer"}
              </Link>
            </div>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-accent-text">Other view scores and method details</summary>
              <div className="mt-3 space-y-3 text-sm text-text-muted">
                <p>A mean WISE score averages the norm’s weighted case scores on a 0–100 scale. It is not the percentage of rules met, a causal finding or an estimate of money or time saved.</p>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Scores by view">
                  {Object.entries(summary.data?.means ?? {}).map(([view, score]) => (
                    <div key={view} className="rounded-md border border-border p-3"><dt>{view}</dt><dd className="tnum font-semibold text-text">{typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1 ? `${fmtNum(score * 100, 1)} / 100` : "Unavailable"}</dd></div>
                  ))}
                </dl>
                <p>Priority combines score shortfall, group size and ranking stability. Its concentration describes where to investigate; it does not estimate business impact.</p>
                {first && <p>Method values for the suggested group: {distanceSentence(first, false)}.</p>}
                <div className="flex flex-wrap gap-3">
                  <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: run.id }} search={{ tab: "monitor" }}>Manifest and provenance</Link>
                  <Link className="text-accent-text underline" to="/p/$projectId/notebook" params={{ projectId: ctx.projectId }} search={{}}>Notebook</Link>
                </div>
              </div>
            </details>
          </Card>
          {first && (
            <NextStep
              label={`Why? ${firstLabel}`}
              because={`it is the largest signal of the ${ctx.view ?? ""} perspective${first.stability === "stable" ? " and its rank is stable within this assessment" : ""}`}
              alternative={ctx.caseTable && readinessSummary.hasIssues ? { label: `review data checks: ${readinessSummary.label}`, to: "/p/$projectId/data/$datasetId", params: { projectId: ctx.projectId, datasetId: ctx.caseTable.datasetId }, search: { caseTable: ctx.caseTable.id, tab: "readiness" } } : undefined}
              to="/p/$projectId/runs/$runId/slices/$sliceKey"
              params={{ projectId: ctx.projectId, runId: run.id, sliceKey: first.key }}
              search={{ slicing: ctx.slicing, view: ctx.view, tab: "why" }}
            />
          )}
        </section>
      )}

      {ctx.caseTable && (
        <YourProcess projectId={ctx.projectId} caseTableId={ctx.caseTable.id} runs={ctx.runs} parentRun={parent} mode="dashboard" caseNoun={noun} />
      )}

      {run && run.status === "done" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle as="h2" className="flex items-baseline gap-2">
              {plain ? "What could distort this" : "Readiness"}
              {readiness && (
                <span className="text-xs font-normal text-text-muted">
                  {readinessSummary.label}
                </span>
              )}
            </CardTitle>
            {readiness ? (
              <>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {[...fails, ...warns].slice(0, 4).map((i) => (
                    <li key={i.id} className="flex items-start gap-2">
                      <GateBadge state={i.level === "fail" ? "failed" : "pending"} label={i.level} />
                      {/* the machine's own sentence carries ISO stamps and its `value(s)`; the reader's words
                          are the same sentence without them, as the Data step already reads them (P1-13) */}
                      <span className="clamp-2 text-text-muted">{plainReadiness(String(i.message)).split(";")[0]}</span>
                    </li>
                  ))}
                </ul>
                {ctx.caseTable && (
                  <Link className="mt-2 inline-block text-sm text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: ctx.caseTable.datasetId }} search={{ caseTable: ctx.caseTable.id, tab: "readiness" }}>
                    all {readiness.items?.length ?? 0} items and the decisions
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm text-text-muted">No case table yet.</p>
            )}
          </Card>
          <Card>
            <CardTitle as="h2">Open findings</CardTitle>
            {records.length > 0 && (
              <ul className="divide-y divide-border text-sm" data-testid="open-records">
                {records.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                    {r.runId && r.sliceKey ? (
                      <Link
                        className="font-medium text-accent-text underline"
                        to="/p/$projectId/runs/$runId/slices/$sliceKey"
                        params={{ projectId: ctx.projectId, runId: r.runId, sliceKey: r.sliceKey }}
                        search={{ slicing: r.evidenceContext?.slicing ?? r.slicing ?? undefined, view: r.evidenceContext?.view ?? r.view ?? undefined, filter: r.evidenceContext?.filter ? JSON.stringify(r.evidenceContext.filter) : undefined, tab: "why", focus: r.kind === "finding" ? "finding" : undefined }}
                      >
                        {sliceLabel({ key: r.sliceKey })}
                      </Link>
                    ) : (
                      <span className="font-medium">{sliceLabel({ key: r.sliceKey ?? "the run" })}</span>
                    )}
                    <Badge variant="outline">{recordWords(r.kind)}</Badge>
                    {r.evidenceContext?.filter && <Badge variant="outline">saved selection</Badge>}
                    <span className="reading text-text">{r.title || r.note || "no title"}</span>
                    {ownerOf(r) && <span className="text-text-muted">owner: {ownerOf(r)}</span>}
                    <Badge variant="accent">{String(r.status).replace(/_/g, " ")}</Badge>
                    {r.author && <span className="text-text-muted">{r.author}</span>}
                    <span className="ml-auto text-xs text-text-subtle">{fmtDateTime(r.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {records.length === 0 && recordsUnavailable && (
              <p className="reading text-sm text-text-muted">This backend does not keep findings, hypotheses and actions yet, so nothing recorded survives a restart.</p>
            )}
            {records.length === 0 && !recordsUnavailable && findings.length === 0 ? (
              <p className="reading text-sm text-text-muted">
                No finding yet. Findings are written on a group's decision pane; only human decisions ask for a note.{" "}
                <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: run.id }} search={{ slicing: ctx.slicing, view: ctx.view }}>
                  Start with the ranked list
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm" data-testid="local-dispositions">
                {findings.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link className="font-medium text-accent-text underline" to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId: ctx.projectId, runId: f.runId, sliceKey: f.key }} search={{ slicing: f.slicing, tab: "why" }}>
                      {sliceLabel({ key: f.key })}
                    </Link>
                    <KindBadge hotspotType={f.hotspotType ?? f.computedType} short />
                    {f.disposition && <Badge variant="accent">{f.disposition.replace("_", " ")}</Badge>}
                    {f.owner && <span className="text-text-muted">owner: {f.owner}</span>}
                    <span className="ml-auto text-xs text-text-subtle">{fmtDateTime(f.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {run && run.status !== "done" && (
        <Card>
          <CardTitle as="h2">Latest run · {run.id}</CardTitle>
          <p className="text-sm text-text-muted">
            The run is {run.status}.{" "}
            <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: run.id }} search={{ tab: "monitor" }}>
              Open the run monitor
            </Link>
            .
          </p>
        </Card>
      )}
    </div>
  );
}
