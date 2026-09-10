import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { flowTypeOf } from "@/lib/api/runs";
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
import { fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { backlogQuery } from "@/lib/api/exploration";
import { runSummaryQuery } from "@/lib/api/runs";
import { notServed } from "@/lib/api/compatibility";
import { reviewQuery, type ReviewItem } from "@/lib/api/review";
import { useFindingStore } from "@/lib/stores/findings";
import { belowExpectation, comparisonSentence, groupLabel, missedPhrase, sharedKeyValues } from "@/lib/sentences";
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
  const parent = run && !flowTypeOf(run) ? run : [...ctx.runs].reverse().find((r) => r.status === "done" && !flowTypeOf(r) && r.caseTableId === run?.caseTableId);
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

  if (ctx.isLoading) return <LoadingBlock rows={6} />;
  const project = ctx.project;
  const concentration = tableRecords<{ threshold: number; top_k: number; share_of_slices: number }>(summary.data?.concentration?.[slicing]?.[ctx.view ?? ""]);
  const eighty = concentration.find((r) => r.threshold === 0.8) ?? concentration[0];
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
          The one sentence under "Where is it worst?" is the largest signal of the latest run: which group of {noun}, how far below the overall score, and what is mostly wrong. Follow the next step to its reasons, or start from <strong>Your process</strong> to
          decide whether to compare everything together or to analyse each flow type on its own.
        </HowToRead>
      </header>

      {!ctx.datasets.length && (
        <EmptyState
          title={t("empty.noDatasets")}
          reason={t("empty.noDatasetsReason")}
          action={{ label: "Drop an event log or load a public log", to: "/p/$projectId/data", params: { projectId: ctx.projectId }, why: "The data caveats tell you whether the log can carry a ranked list." }}
          alternative={{ label: "look at the reference norm first", to: "/p/$projectId/norms", params: { projectId: ctx.projectId } }}
        />
      )}

      {ctx.datasets.length > 0 && !run && (
        <EmptyState
          title={t("empty.noRuns")}
          reason={t("empty.noRunsReason")}
          action={{ label: "Create a run", to: "/p/$projectId/runs", params: { projectId: ctx.projectId }, why: "Scoring writes a manifest with the norm fingerprint so the ranked list is reproducible." }}
          alternative={{ label: "review the norm", to: "/p/$projectId/norms", params: { projectId: ctx.projectId } }}
        />
      )}

      {run && run.status === "done" && (
        <section aria-labelledby="kpi-heading" className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <CardTitle id="kpi-heading" className="mb-0 flex flex-wrap items-baseline gap-2">
              {plain ? "Where is it worst?" : "Latest run"}
              <span className="text-xs font-normal text-text-subtle" title={run.id}>
                {run.note ?? "latest run"}
                {flowTypeOf(run) ? ` · ${flowTypeOf(run)} flow only` : ""}
              </span>
            </CardTitle>
            {first ? (
              <>
                <p className="reading headline text-text" data-testid="top-signal" title={plain ? distanceSentence(first, true) : undefined}>
                  <strong>{firstLabel}</strong> <KindBadge kind={first.kind} hotspotType={first.hotspot_type} short className="mx-1 align-baseline" /> — <strong className="tnum">{fmtInt(first.n_cases)}</strong> {noun},{" "}
                  {plain ? (
                    <>
                      <strong className="tnum">{belowExpectation(first)}</strong> below expectation
                    </>
                  ) : (
                    distanceSentence(first, false)
                  )}
                  {missedPhrase(first) ? `, mostly ${plain ? missedPhrase(first) : first.dominant_layer_name}` : ""}.
                </p>
                {first.comparison && <p className="reading text-base text-text-muted">{comparisonSentence(first)}</p>}
              </>
            ) : (
              top.isPending && <LoadingBlock rows={1} />
            )}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              {summary.data?.means && Object.entries(summary.data.means).map(([view, mean]) => (
                <span key={view} className="tnum">
                  {view} <strong className="text-text">{fmtPct(mean, 1)}</strong>
                  {plain ? " of the rules met" : " mean score"}
                </span>
              ))}
              {summary.data && (
                <span className="tnum">
                  {fmtInt(summary.data.cases ?? ctx.caseTable?.cases)} {noun}
                </span>
              )}
              {eighty && (
                <span className="tnum">
                  80 % of the priority sits in {fmtInt(eighty.top_k)} group{eighty.top_k === 1 ? "" : "s"}
                </span>
              )}
              <span>finished {fmtDateTime(run.manifest?.finishedAt)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: run.id }} search={{ slicing: ctx.slicing, view: ctx.view }}>
                {plain ? "Open the ranked list" : "Open backlog explorer"}
              </Link>
              <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: run.id }} search={{ tab: "monitor" }}>
                Manifest and provenance
              </Link>
              <Link className="text-accent-text underline" to="/p/$projectId/notebook" params={{ projectId: ctx.projectId }} search={{}}>
                Notebook
              </Link>
            </div>
          </Card>
          {first && (
            <NextStep
              label={`Why? ${firstLabel}`}
              because={`it is the largest signal of the ${ctx.view ?? ""} perspective${first.stability === "stable" ? " and its rank is reliable" : ""}`}
              alternative={ctx.caseTable && warns.length ? { label: `read the ${warns.length} data caveats first`, to: "/p/$projectId/data/$datasetId", params: { projectId: ctx.projectId, datasetId: ctx.caseTable.datasetId }, search: { caseTable: ctx.caseTable.id, tab: "readiness" } } : undefined}
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
            <CardTitle className="flex items-baseline gap-2">
              {plain ? "What could distort this" : "Readiness"}
              {readiness && (
                <span className="text-xs font-normal text-text-muted">
                  {fails.length ? `${fails.length} blocking, ` : ""}
                  {warns.length} caveat{warns.length === 1 ? "" : "s"}
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
            <CardTitle>Open findings</CardTitle>
            {records.length > 0 && (
              <ul className="divide-y divide-border text-sm" data-testid="open-records">
                {records.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                    {r.runId && r.sliceKey ? (
                      <Link
                        className="font-medium text-accent-text underline"
                        to="/p/$projectId/runs/$runId/slices/$sliceKey"
                        params={{ projectId: ctx.projectId, runId: r.runId, sliceKey: r.sliceKey }}
                        search={{ slicing: r.slicing ?? ctx.slicing, view: r.view ?? ctx.view, tab: "why" }}
                      >
                        {sliceLabel({ key: r.sliceKey })}
                      </Link>
                    ) : (
                      <span className="font-medium">{sliceLabel({ key: r.sliceKey ?? "the run" })}</span>
                    )}
                    <Badge variant="outline">{recordWords(r.kind)}</Badge>
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
          <CardTitle>Latest run · {run.id}</CardTitle>
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
