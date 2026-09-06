import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { flowTypeOf, type BacklogParamsC2, type BacklogRowC2 } from "@/lib/api/cycle2";
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
import { backlogQuery, runSummaryQuery } from "@/lib/queries";
import { useFindingStore } from "@/lib/stores/findings";
import { sliceLabel, tableRecords } from "@/lib/utils";
import { distanceSentence } from "./backlog/SignalCard";
import { YourProcess } from "./flow/YourProcess";

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
  const findings = Object.values(useFindingStore((s) => s.findings)).filter((f) => f.projectId === ctx.projectId);
  const readiness = ctx.caseTable?.readiness;

  if (ctx.isLoading) return <LoadingBlock rows={6} />;
  const project = ctx.project;
  const concentration = tableRecords<{ threshold: number; top_k: number; share_of_slices: number }>(summary.data?.concentration?.[slicing]?.[ctx.view ?? ""]);
  const eighty = concentration.find((r) => r.threshold === 0.8) ?? concentration[0];
  const first = top.data?.rows[0] as BacklogRowC2 | undefined;
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
              <span className="font-mono text-xs font-normal text-text-subtle">
                {run.id}
                {flowTypeOf(run) ? ` · ${flowTypeOf(run)} flow only` : ""}
                {run.note ? ` · ${run.note}` : ""}
              </span>
            </CardTitle>
            {first ? (
              <>
                <p className="reading headline text-text" data-testid="top-signal">
                  <strong>{sliceLabel(first)}</strong> <KindBadge kind={first.kind} hotspotType={first.hotspot_type} short className="mx-1 align-baseline" /> {fmtInt(first.n_cases)} {noun}, {distanceSentence(first, plain)}
                  {first.layer_missed_label ?? first.dominant_layer_name ? `, mostly ${plain ? (first.layer_missed_label ?? first.dominant_layer_name) : first.dominant_layer_name}` : ""} · rank 1{first.n_ranked ? ` of ${fmtInt(first.n_ranked)}` : ""}
                  {ctx.view ? ` in the ${ctx.view} perspective` : ""}.
                </p>
                {first.comparison && <p className="reading text-base text-text-muted">{first.comparison}</p>}
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
              label={`Why? ${sliceLabel(first)}`}
              because={`it is the largest signal of the ${ctx.view ?? ""} perspective${first.stability === "stable" ? " and its rank is reliable" : ""}`}
              to="/p/$projectId/runs/$runId/slices/$sliceKey"
              params={{ projectId: ctx.projectId, runId: run.id, sliceKey: first.key }}
              search={{ slicing: ctx.slicing, view: ctx.view, tab: "flow" }}
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
                      <span className="clamp-2 text-text-muted">{i.message.split(";")[0]}</span>
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
            {findings.length === 0 ? (
              <p className="reading text-sm text-text-muted">
                No finding yet. Findings are written on a group's decision pane; only human decisions ask for a note.{" "}
                <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: run.id }} search={{ slicing: ctx.slicing, view: ctx.view }}>
                  Start with the ranked list
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {findings.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link className="font-medium text-accent-text underline" to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId: ctx.projectId, runId: f.runId, sliceKey: f.key }} search={{ slicing: f.slicing, tab: "flow" }}>
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
