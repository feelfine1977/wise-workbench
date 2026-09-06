import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { useWorkbench } from "@/app/context";
import { runRoute } from "@/app/router";
import type { RunTab } from "@/app/search";
import { flowTypeOf } from "@/lib/api/cycle2";
import { BackControl } from "@/components/guide/BackControl";
import { NextStep } from "@/components/guide/NextStep";
import { ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Term } from "@/components/Term";
import { CompareFlowTypes } from "./CompareFlowTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Progress } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { flowQuery, jobTransport, runQuery, useCancelJob, useJob } from "@/lib/queries";
import { runStatusGlyph, runStatusVariant } from "./RunsPage";

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
  const flow = useQuery({ ...flowQuery(ctx.projectId, runId, {}), enabled: run.data?.status === "done" && search.tab === "flow" });
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
                <span className="font-mono">{r.id}</span>
                <Badge variant={runStatusVariant[r.status]}>
                  <span aria-hidden>{runStatusGlyph[r.status]}</span>
                  {r.status}
                </Badge>
                {flowTypeOf(r) && <Badge variant="accent">{flowTypeOf(r)} flow only</Badge>}
              </h1>
              <p className="text-sm text-text-muted">{r.note}</p>
            </div>
            <div className="flex gap-2">
              {(r.status === "queued" || r.status === "running") && r.jobId && (
                <Button variant="outline" onClick={() => r.jobId && cancel.mutate(r.jobId)}>
                  Cancel
                </Button>
              )}
              {r.status === "done" && (
                <Button asChild>
                  <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: r.id }} search={{ slicing: r.slicings?.[0]?.id ?? undefined, view: r.views?.[0] }}>
                    Open backlog
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

          {r.status === "done" && <NextStep label="Open the ranked list" because="scoring is done; the signals list is where the analysis starts" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: r.id }} search={{ slicing: r.slicings?.[0]?.id ?? undefined, view: r.views?.[0] }} />}

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
                {flow.isPending && <LoadingBlock rows={6} />}
                {flow.isError && <ErrorBlock error={flow.error} retry={() => void flow.refetch()} />}
                {flow.data && (
                  <Suspense fallback={<LoadingBlock rows={6} />}>
                    <FlowMap graph={flow.data} title="Process map of the whole log with the expectations drawn on it" />
                  </Suspense>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="monitor">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Parameters</CardTitle>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-text-muted">case table</dt>
                <dd className="font-mono">{r.caseTableId}</dd>
                <dt className="text-text-muted">norm version</dt>
                <dd>
                  <Link className="font-mono text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: r.normVersionId }} search={{ tab: "constraints" }}>
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
                <dd className="font-mono">{r.baselineRunId ?? "– (global mean of this run)"}</dd>
                <dt className="text-text-muted">scope</dt>
                <dd>{flowTypeOf(r) ? `${flowTypeOf(r)} flow type only` : "all flow types together"}</dd>
              </dl>
            </Card>
            <Card>
              <CardTitle>Manifest and provenance</CardTitle>
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
            </Card>
          </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </QueryState>
  );
}
