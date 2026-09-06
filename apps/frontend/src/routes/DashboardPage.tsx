import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GateBadge, KindBadge } from "@/components/badges";
import { Metric } from "@/components/explain";
import { ReadingSentence } from "@/components/reading";
import { EmptyState, LoadingBlock } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/misc";
import { useWorkbench } from "@/app/context";
import { fmtDateTime, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery, runSummaryQuery } from "@/lib/queries";
import { useFindingStore } from "@/lib/stores/findings";
import { sliceLabel, tableRecords } from "@/lib/utils";

/** S0 — project dashboard: charter, the latest run's numbers, the top signal, open findings and data caveats. */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { vocabulary, t: word } = useVocabulary();
  const ctx = useWorkbench();
  const run = ctx.run;
  const summary = useQuery({ ...runSummaryQuery(ctx.projectId, run?.id ?? ""), enabled: !!run && run.status === "done" });
  const slicing = ctx.slicing ?? "";
  const top = useQuery({ ...backlogQuery(ctx.projectId, run?.id ?? "", { slicing, view: ctx.view, minCases: run?.minCases ?? 20, sort: "-stable_PI", page: 1, pageSize: 10 }), enabled: !!run && run.status === "done" && !!slicing });
  const findings = Object.values(useFindingStore((s) => s.findings)).filter((f) => f.projectId === ctx.projectId);
  const readiness = ctx.caseTable?.readiness;

  if (ctx.isLoading) return <LoadingBlock rows={6} />;
  const project = ctx.project;
  const concentration = tableRecords<{ threshold: number; top_k: number; share_of_slices: number }>(summary.data?.concentration?.[slicing]?.[ctx.view ?? ""]);
  const eighty = concentration.find((r) => r.threshold === 0.8) ?? concentration[0];
  const first = top.data?.rows[0];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-text-subtle">S0 · Steering question and scope</p>
        <h1 className="text-2xl font-semibold">{project?.name}</h1>
        <ReadingSentence text={project?.question ?? undefined} className="mt-1 max-w-3xl text-text-muted" />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">process: {project?.process ?? "–"}</Badge>
          {ctx.norm && (
            <Badge variant="outline">
              norm v{ctx.norm.version} · {ctx.norm.status}
            </Badge>
          )}
          {run && (
            <Badge variant="outline">
              latest run {run.id}
              {run.note ? ` · ${run.note}` : ""} · γ = {run.gamma}
            </Badge>
          )}
        </div>
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
        <section aria-labelledby="kpi-heading" className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle id="kpi-heading">{vocabulary === "plain" ? "Where is it worst?" : "Latest run"} · {run.id}</CardTitle>
            {first ? (
              <p className="mb-3 text-sm">
                <strong>{sliceLabel(first)}</strong> <KindBadge kind={first.kind} hotspotType={first.hotspot_type} reading className="mx-1 align-baseline" /> {fmtInt(first.n_cases)} cases, {fmtPct(first.gap, 1)} below expectation on average
                {first.dominant_layer_name ? `, mostly ${first.dominant_layer_name}` : ""} · {word("stable_PI")} {fmtNum(first.stable_PI, 1)}, rank 1{first.n_ranked ? ` of ${fmtInt(first.n_ranked)}` : ""}.
              </p>
            ) : (
              top.isPending && <LoadingBlock rows={1} />
            )}
            {summary.isPending && <LoadingBlock rows={3} />}
            {summary.data && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Object.entries(summary.data.means ?? {}).map(([view, mean]) => (
                  <Metric key={view} label={`${word("global_mean")} · ${view}`} value={fmtNum(mean, 3)} explain={{ term: "global_mean", inputs: [{ label: word("view"), value: view }] }} size="sm" />
                ))}
                <Metric
                  label="cases evaluated"
                  value={fmtPct(summary.data.density?.evaluated)}
                  explain={{ term: "applicability", inputs: [{ label: word("in_scope"), value: fmtPct(summary.data.density?.inScope) }, { label: "evaluated", value: fmtPct(summary.data.density?.evaluated) }] }}
                  size="sm"
                />
                <Metric label="cases" value={fmtInt(summary.data.cases ?? ctx.caseTable?.cases)} explain={{ term: "n_cases" }} size="sm" />
                {eighty && <Metric label="80 % of the priority sits in" value={`${fmtInt(eighty.top_k)} ${word("slice")}${eighty.top_k === 1 ? "" : "s"}`} sub={`${fmtPct(eighty.share_of_slices)} of the ranked groups`} explain={{ term: "stable_PI", title: "Concentration", formula: "smallest k with Σ_{i≤k} stable_PI_i / Σ stable_PI ≥ 0.8" }} size="sm" />}
                <Metric label="finished" value={<span className="text-sm">{fmtDateTime(run.manifest?.finishedAt)}</span>} size="sm" />
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button asChild>
                <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: run.id }} search={{ slicing: ctx.slicing, view: ctx.view }}>
                  {vocabulary === "plain" ? "Open the ranked list" : "Open backlog explorer"}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: run.id }} search={{ tab: "monitor" }}>
                  Manifest and provenance
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: run.id }} search={{ tab: "flow" }}>
                  <Term id="flow" primaryOnly />
                </Link>
              </Button>
            </div>
          </Card>
          <Card>
            <CardTitle>
              <Term id="readiness" />
            </CardTitle>
            {readiness ? (
              <ul className="flex flex-col gap-1 text-sm">
                {(readiness.items ?? []).map((i) => (
                  <li key={i.id} className="flex items-start gap-2">
                    <GateBadge state={i.level === "fail" ? "failed" : i.level === "warn" ? "pending" : "passed"} label={i.level} />
                    <span className="text-text-muted">{i.message.split(";")[0]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">No case table yet.</p>
            )}
          </Card>
          <Card className="lg:col-span-3">
            <CardTitle>Open findings</CardTitle>
            {findings.length === 0 ? (
              <p className="text-sm text-text-muted">
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
                    <Link className="font-medium text-accent-text underline" to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId: ctx.projectId, runId: f.runId, sliceKey: f.key }} search={{ slicing: f.slicing, tab: "drivers" }}>
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
        </section>
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
