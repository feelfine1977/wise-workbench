import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { useWorkbench } from "@/app/context";
import { runRoute } from "@/app/router";
import type { RunTab } from "@/app/search";
import { flowTypeOf } from "@/lib/api/runs";
import { BackControl } from "@/components/guide/BackControl";
import { FreezeButton } from "@/components/guide/Freeze";
import { ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { CalibrationChip } from "@/components/badges";
import { Term } from "@/components/Term";
import { CompareFlowTypes } from "./CompareFlowTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Progress } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate, fmtDateTime, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { flowQuery } from "@/lib/api/flow";
import { jobTransport, useCancelJob, useJob } from "@/lib/queries";
import { runQuery } from "@/lib/api/runs";
import { runManifestQuery, type ManifestRow } from "@/lib/api/runs";
import { groupingLabel } from "@/lib/sentences";
import { plainReadiness } from "../data/ReadinessDecisions";
import { runStatusGlyph, runStatusVariant } from "./RunsPage";

/** A value the server serves: a machine stamp is read as a date and a time, anything else as it came (P1-13). */
function readableValue(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "–";
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) ? fmtDateTime(text.replace(" ", "T")) : text;
}

const FlowMap = lazy(() => import("@/components/flow/FlowMap"));

/** Run — the run monitor: parameters, job progress (over the event stream), the manifest, the process map of the whole log and the flow types side by side. */
export default function RunPage() {
  const ctx = useWorkbench();
  const { runId } = runRoute.useParams();
  const search = runRoute.useSearch();
  const navigate = useNavigate();
  const run = useQuery({ ...runQuery(ctx.projectId, runId), refetchInterval: (q) => (q.state.data?.status === "queued" || q.state.data?.status === "running" ? 1000 : false) });
  const job = useJob(run.data?.jobId ?? undefined);
  const cancel = useCancelJob();
  /** What the mapping calls one case — "purchase order items", never "cases" where a noun is set (R3-13). */
  const flow = useQuery({ ...flowQuery(ctx.projectId, runId, {}), enabled: run.data?.status === "done" && search.tab === "flow" });
  const manifest = useQuery({ ...runManifestQuery(ctx.projectId, runId), enabled: !!runId });
  const uncalibrated = manifest.data?.uncalibrated ?? [];
  // the plain block the server serves; without it the run's own fields say the same in the same words

  const caseNoun = manifest.data?.caseNoun ?? (ctx.caseTable?.readiness as { caseNoun?: string | null } | undefined)?.caseNoun ?? "cases";
  const casesScored = ctx.caseTable?.cases ?? (manifest.data?.technical as { cases?: number } | undefined)?.cases;
  const grouped = (run.data?.slicings ?? []).map((s) => groupingLabel(s.id ?? undefined, s.attributes)).join("; ");
  /**
   * The plain block the server serves, with the grouping row said in the reader's words (R3-13). The server
   * fills that row with the log's own column names — *case Company × case Spend area text* — and a column
   * name is not what a reader calls the thing it names.
   */
  const plainRows: ManifestRow[] = manifest.data?.plain?.length
    ? manifest.data.plain.map((row) => (/^(grouped by|grouping)$/i.test(row.label) && grouped ? { ...row, value: grouped } : row))
    : [
        { label: "Expectations", value: run.data?.normVersionId ? "the norm of this run" : "–", note: null },
        { label: "Perspective", value: (run.data?.views ?? []).join(", ") || "–", note: "the weighting of the expectation areas this run was read with" },
        // the log's column names are not the words a reader uses for the thing they name (R3-13)
        { label: "Grouped by", value: grouped || "–", note: null },
        { label: "Small groups", value: run.data?.gamma !== undefined && run.data?.gamma !== null ? `γ = ${fmtNum(run.data.gamma, 0)}` : "–", note: "a small group keeps less of its shortfall than a large one" },
        { label: "Scope", value: flowTypeOf(run.data) ? `${flowTypeOf(run.data)} flow only` : "the whole log", note: null },
        { label: "Run", value: fmtDateTime(run.data?.manifest?.finishedAt), note: null },
      ];
  const setTab = (tab: RunTab) => void navigate({ to: ".", search: { tab } });

  return (
    <QueryState query={run} rows={6}>
      {(r) => (
        <div className="flex flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
                <BackControl className="normal-case tracking-normal" />
                <span>Run</span>
              </div>
              <h1 className="flex items-center gap-3 text-2xl font-semibold">
                <span>{r.note?.trim() || "Run"}{r.manifest?.finishedAt ? ` · ${fmtDate(r.manifest.finishedAt)}` : ""}</span>
                <Badge variant={runStatusVariant[r.status]}>
                  <span aria-hidden>{runStatusGlyph[r.status]}</span>
                  {r.status}
                </Badge>
                {flowTypeOf(r) && <Badge variant="accent">{flowTypeOf(r)} flow only</Badge>}
              </h1>
              <p className="reading text-sm text-text-muted">
                {/* R3-13: the run's own noun, not "cases", wherever the mapping has set one */}
                {r.status === "done"
                  ? `${casesScored === undefined ? "Every one of the log's" : fmtInt(casesScored)} ${caseNoun} scored against the norm in ${(r.views ?? []).length} perspectives, small groups discounted with γ = ${fmtNum(r.gamma, 0)}.`
                  : r.note}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-no-capture>
              {r.status === "done" && <FreezeButton projectId={ctx.projectId} screen={search.tab === "compare" ? "compare-flow-types" : search.tab === "flow" ? "run-flow" : "run"} context={{ run_id: r.id, scope: (r.scope as never) ?? null }} data={{ manifest: r.manifest, params: { gamma: r.gamma, minCases: r.minCases, views: r.views, slicings: r.slicings } }} defaultTitle={`${r.note?.trim() || `Run of ${fmtDate(r.manifest?.finishedAt ?? r.createdAt)}`}${search.tab === "compare" ? " · flow types side by side" : search.tab === "flow" ? " · process map" : ""}`} />}
              {(r.status === "queued" || r.status === "running") && r.jobId && (
                <Button variant="outline" onClick={() => r.jobId && cancel.mutate(r.jobId)}>
                  Cancel
                </Button>
              )}
              {r.status === "done" && (
                <Button asChild>
                  <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: r.id }} search={{ slicing: r.slicings?.[0]?.id ?? undefined, view: r.views?.[0] }}>
                    Open the ranked list
                  </Link>
                </Button>
              )}
            </div>
          </header>

          {(r.status === "queued" || r.status === "running") && (
            <Card aria-live="polite">
              <CardTitle>Progress</CardTitle>
              <Progress value={job.data?.progress ?? 0} label="run progress" />
              <p className="mt-2 text-sm text-text-muted">
                {fmtPct(job.data?.progress ?? 0)} · {job.data?.message ?? "queued"} · attempt {job.data?.attempts ?? 1} · {jobTransport() === "stream" ? "live events" : "polling"}
              </p>
            </Card>
          )}
          {r.status === "failed" && (
            <Card>
              <CardTitle>Failure</CardTitle>
              <p className="text-sm text-danger">{job.data?.message ?? job.data?.error ?? r.error ?? "The job failed."}</p>
            </Card>
          )}

          <Tabs value={search.tab} onValueChange={(v) => setTab(v as RunTab)}>
            <TabsList aria-label="Run sections">
              <TabsTrigger value="monitor">Parameters and manifest</TabsTrigger>
              <TabsTrigger value="flow" disabled={r.status !== "done"}>
                <Term id="flow" primaryOnly />
              </TabsTrigger>
              <TabsTrigger value="compare" disabled={r.status !== "done" || !!flowTypeOf(r)}>
                Flow types side by side
              </TabsTrigger>
            </TabsList>
            <TabsContent value="compare">{r.status === "done" && !flowTypeOf(r) && <CompareFlowTypes projectId={ctx.projectId} runId={r.id} view={ctx.view ?? r.views?.[0]} slicing={r.slicings?.[0]?.id ?? undefined} runs={ctx.runs} />}</TabsContent>
            <TabsContent value="flow">
              <Card>
                <CardTitle>
                  <Term id="flow">Process map of the whole log</Term>
                </CardTitle>
                {/* a doorway, not a second map: the Flow step is where the map is the screen and its actions work (§3.1) */}
                <p className="reading mb-3 text-sm text-text-muted">
                  This is the map of {flowTypeOf(r) ? `the ${flowTypeOf(r)} flow` : "the whole log"} as a preview. The Flow step gives it the whole frame, with the filter bar, the paths, the model and the actions.{" "}
                  <Button asChild size="sm" className="ml-2">
                    <Link to="/p/$projectId/runs/$runId/flow" params={{ projectId: ctx.projectId, runId: r.id }} search={{ view: ctx.view, slicing: ctx.slicing, render: "map" as const }}>
                      Open the Flow step →
                    </Link>
                  </Button>
                </p>
                {flow.isPending && <LoadingBlock rows={6} />}
                {flow.isError && <ErrorBlock error={flow.error} retry={() => void flow.refetch()} />}
                {flow.data && (
                  <Suspense fallback={<LoadingBlock rows={6} />}>
                    <FlowMap graph={flow.data} frame="panel" height={420} title="Process map of the whole log with the expectations drawn on it" noun={(flow.data.meta as { caseNoun?: string } | undefined)?.caseNoun ?? "cases"} />
                  </Suspense>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="monitor">
              {/*
                The run in the reader's words first (R3-O7): what was read, against which expectations,
                in which perspectives, with which parameters in words, when and how long, and the caveats that
                travel with the numbers. Every fingerprint, hash, mapping id and job id sits behind
                "Technical details", closed on arrival — the first screenful of this step carries no id.
              */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardTitle>What this run is</CardTitle>
                  {manifest.isPending && <LoadingBlock rows={5} />}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="run-plain">
                    {plainRows.map((row) => (
                      <div key={row.label} className="contents">
                        <dt className="text-text-muted">{row.label}</dt>
                        <dd>
                          {/* a machine stamp is read as a date and a time, and the machine's own caveat
                              sentence loses its stamps and its `value(s)`, as the Data step reads them (P1-13) */}
                          <span className="text-text">{readableValue(row.value)}</span>
                          {row.note ? <span className="reading mt-0.5 block text-xs text-text-subtle">{plainReadiness(String(row.note))}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {uncalibrated.length > 0 && (
                    <div className="mt-4 flex flex-col gap-1" data-testid="run-uncalibrated">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">Expectations to calibrate</p>
                      <ul className="flex flex-col gap-1 text-sm text-text-muted">
                        {uncalibrated.map((u) => (
                          <li key={u.id} className="reading flex items-start gap-2">
                            <CalibrationChip text={u.text} />
                            <span>{u.text ?? u.plain_name ?? u.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
                <details className="surface px-4 py-3" data-testid="run-technical">
                  <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-subtle">Parameters</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <dt className="text-text-muted">case table</dt>
                        <dd className="font-mono text-xs">{r.caseTableId}</dd>
                        <dt className="text-text-muted">norm version</dt>
                        <dd>
                          <Link className="font-mono text-xs text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: r.normVersionId }} search={{ tab: "constraints" }}>
                            {r.normVersionId}
                          </Link>
                        </dd>
                        <dt className="text-text-muted">views</dt>
                        <dd>{r.views?.join(", ")}</dd>
                        <dt className="text-text-muted">slicings</dt>
                        <dd>{r.slicings?.map((s) => `${(s.attributes ?? []).join(" × ")} (id ${s.id})`).join("; ")}</dd>
                        <dt className="text-text-muted">γ</dt>
                        <dd className="tnum">{fmtNum(r.gamma, 0)}</dd>
                        <dt className="text-text-muted">min cases</dt>
                        <dd className="tnum">{fmtNum(r.minCases, 0)}</dd>
                        <dt className="text-text-muted">baseline run</dt>
                        <dd className="font-mono text-xs">{r.baselineRunId ?? "– (global mean of this run)"}</dd>
                        <dt className="text-text-muted">scope</dt>
                        <dd>{flowTypeOf(r) ? `${flowTypeOf(r)} flow type only` : "all flow types together"}</dd>
                      </dl>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-subtle">Manifest and provenance</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <dt className="text-text-muted">norm fingerprint</dt>
                        <dd className="font-mono text-xs">{r.manifest?.normFingerprint ?? "–"}</dd>
                        <dt className="text-text-muted">content hash</dt>
                        <dd className="font-mono text-xs">{r.manifest?.contentHash ?? "–"}</dd>
                        <dt className="text-text-muted">mapping</dt>
                        <dd className="font-mono text-xs">{r.manifest?.mappingId ?? "–"}</dd>
                        <dt className="text-text-muted">params hash</dt>
                        <dd className="font-mono text-xs">{r.manifest?.paramsHash ?? "–"}</dd>
                        <dt className="text-text-muted">wise version</dt>
                        <dd className="font-mono text-xs">{r.manifest?.wiseVersion ?? "–"}</dd>
                        <dt className="text-text-muted">started</dt>
                        <dd>{fmtDateTime(r.manifest?.startedAt)}</dd>
                        <dt className="text-text-muted">finished</dt>
                        <dd>{fmtDateTime(r.manifest?.finishedAt)}</dd>
                        <dt className="text-text-muted">job</dt>
                        <dd className="font-mono text-xs">{r.jobId ?? "–"}</dd>
                      </dl>
                      <p className="mt-3 text-xs text-text-muted">Same content hash + norm fingerprint + params hash → identical ranked list. Comparisons across different groupings are refused.</p>
                    </div>
                  </div>
                </details>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </QueryState>
  );
}
