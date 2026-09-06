import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { SliceDetail, WorstCase } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { sliceRoute } from "@/app/router";
import type { SliceTab } from "@/app/search";
import { ConfidenceMark, GateBadge, KindBadge, LayerChip, type GateState } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { Metric, backlogExplain } from "@/components/explain";
import { ReadingSentence } from "@/components/reading";
import { EmptyState, ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { distributionQuery, flowQuery, normQuery, sliceQuery, traceQuery } from "@/lib/queries";
import { cn, sliceLabel, tableRecords } from "@/lib/utils";
import { DecisionPane } from "./DecisionPane";
import { TraceTimeline } from "./TraceTimeline";

const Charts = lazy(() => import("./charts"));
const FlowMap = lazy(() => import("@/components/flow/FlowMap"));

type Driver = { constraint: string; layer: string; type: string; mean_penalty: number; mean_violation?: number; share_violated: number; share_in_scope: number; share_evaluated?: number; description?: string; delta_gap: number; share_of_shortfall?: number };
type Validation = { n_cases?: number; censored_share?: number; replicated_share?: number; retained?: number; stable_gap_kept?: number; reading?: string };

function WorstCases({ cases, selected, onSelect }: { cases: WorstCase[]; selected?: string; onSelect: (c: WorstCase) => void }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>case</Th>
          <Th numeric>
            <Term id="score">score</Term>
          </Th>
          <Th>
            <Term id="constraint">expectations missed</Term>
          </Th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c.caseId} className={cn("cursor-pointer hover:bg-surface-sunken", selected === c.caseId && "bg-selection")} onClick={() => onSelect(c)}>
            <Td>
              <button type="button" className="font-mono text-xs text-accent-text underline" onClick={() => onSelect(c)} aria-pressed={selected === c.caseId}>
                {c.caseId}
              </button>
            </Td>
            <Td numeric>{fmtNum(c.score, 3)}</Td>
            <Td className="text-xs">
              <span className="flex flex-wrap gap-1">
                {(c.violated ?? []).map((v) => (
                  <Badge key={v} variant="danger" className="font-mono">
                    <span aria-hidden>▲</span>
                    {v}
                  </Badge>
                ))}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Checks before acting, read from the validation row (display only until the review endpoints exist). */
function checksOf(v: Validation): { kind: string; state: GateState; evidence: string }[] {
  const out: { kind: string; state: GateState; evidence: string }[] = [];
  if (v.censored_share !== undefined) {
    out.push({ kind: "still open at the end of the data", state: v.censored_share > 0.1 ? "pending" : "passed", evidence: `${fmtPct(v.censored_share, 1)} of these cases were still open when the data was extracted${v.retained !== undefined ? `; without them the shortfall keeps ${fmtPct(v.retained, 0)} of its size` : ""}` });
  }
  if (v.replicated_share !== undefined) {
    out.push({ kind: "duplicated events", state: v.replicated_share >= 0.5 ? "failed" : "passed", evidence: `${fmtPct(v.replicated_share, 1)} of these cases carry events copied from a header document` });
  }
  out.push({ kind: "plausibility", state: "pending", evidence: "awaiting the owner's reading" });
  return out;
}

/** S6–S8 — "Why?": the group's sentence, the expectations behind the shortfall, comparisons, cases, checks and the flow. */
export default function SlicePage() {
  const { vocabulary, t } = useVocabulary();
  const ctx = useWorkbench();
  const { runId, sliceKey } = sliceRoute.useParams();
  const search = sliceRoute.useSearch();
  const navigate = useNavigate();
  const run = ctx.runs.find((r) => r.id === runId);
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? "";
  const view = search.view ?? run?.views?.[0];
  const plain = vocabulary === "plain";

  useEffect(() => {
    if (run && (search.slicing !== slicing || search.view !== view)) void navigate({ to: ".", search: (s) => ({ ...s, slicing, view }), replace: true });
  }, [run, search.slicing, search.view, slicing, view, navigate]);

  const slice = useQuery({ ...sliceQuery(ctx.projectId, runId, sliceKey, slicing, view), enabled: !!run && !!slicing });
  const norm = useQuery({ ...normQuery(ctx.projectId, run?.normVersionId ?? ""), enabled: !!run });
  const layers = useMemo(() => ((norm.data?.norm as { layers?: { id: string; name: string }[] } | undefined)?.layers ?? []), [norm.data]);
  const layerNames = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.name])), [layers]);
  const drivers = useMemo(() => tableRecords<Driver>(slice.data?.drivers), [slice.data]);
  const lensConstraints = useMemo(() => {
    const thresholdTypes = new Set(["lag", "metric", "singularity", "balance"]);
    return drivers.filter((d) => thresholdTypes.has(d.type)).map((d) => d.constraint);
  }, [drivers]);
  const constraint = search.constraint && lensConstraints.includes(search.constraint) ? search.constraint : lensConstraints[0];
  const dist = useQuery({ ...distributionQuery(ctx.projectId, runId, constraint ?? "", slicing, sliceKey), enabled: !!constraint && search.tab === "distributions" });
  const selectedCase = search.case;
  const worst = slice.data?.worstCases ?? [];
  const trace = useQuery({ ...traceQuery(ctx.projectId, runId, selectedCase ?? ""), enabled: !!selectedCase && search.tab === "cases" });
  const flowGlobal = useQuery({ ...flowQuery(ctx.projectId, runId, {}), enabled: !!run && search.tab === "flow" });
  const flowSlice = useQuery({ ...flowQuery(ctx.projectId, runId, { slicing, sliceKey }), enabled: !!run && !!slicing && search.tab === "flow" });
  const [highlight, setHighlight] = useState<string>();

  const setTab = (tab: SliceTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectCase = (c: WorstCase) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "cases", case: c.caseId }) });

  if (!run) return ctx.isLoading ? <LoadingBlock rows={8} /> : <ErrorBlock error={new Error(`Run ${runId} is not in this project.`)} />;

  return (
    <QueryState query={slice} rows={8}>
      {(detail: SliceDetail) => {
        const row = detail.row;
        if (!row) return <EmptyState title="Group not found" reason="The group is not part of this run and grouping." />;
        const label = sliceLabel(row);
        const fmt = { num: fmtNum, int: fmtInt };
        const params = { globalMean: row.global_mean ?? row.mean_score + row.gap, gamma: run.gamma ?? 50, view, minCases: run.minCases ?? 20 };
        const validation = (detail.validation ?? {}) as Validation;
        const top = drivers.filter((d) => d.delta_gap > 0).slice(0, 3);
        const area = row.dominant_layer_name ?? layerNames[row.dominant_layer ?? ""];
        return (
          <div className="flex flex-col gap-4">
            <header>
              <p className="text-xs uppercase tracking-wide text-text-subtle">
                S6–S8 · {plain ? "Why?" : "Slice"} ·{" "}
                <Link className="text-accent-text underline" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId }} search={{ slicing, view, pins: search.pins, row: row.key }}>
                  back to {plain ? "where is it worst" : "the backlog"}
                </Link>
              </p>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
                <span>{label}</span>
                <KindBadge kind={row.kind} hotspotType={row.hotspot_type} reading />
                <ConfidenceMark value={row.stability} words />
              </h1>
              <ReadingSentence text={detail.reading ?? row.reading ?? undefined} as="p" className="mt-1 max-w-4xl" />
              <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-6">
                <Metric label={t("n_cases")} value={fmtInt(row.n_cases)} explain={backlogExplain("n_cases", row, params, fmt)} size="sm" />
                <Metric label={t("mean_score")} value={fmtNum(row.mean_score, 3)} explain={backlogExplain("mean_score", row, params, fmt)} size="sm" />
                <Metric label={t("gap")} value={fmtPct(row.gap, 1)} explain={backlogExplain("gap", row, params, fmt)} size="sm" />
                <Metric label={t("stable_gap")} value={fmtPct(row.stable_gap, 1)} explain={backlogExplain("stable_gap", row, params, fmt)} size="sm" />
                <Metric label={t("PI")} value={fmtNum(row.PI, 1)} explain={backlogExplain("PI", row, params, fmt)} size="sm" />
                <Metric label={t("stable_PI")} value={fmtNum(row.stable_PI, 1)} explain={backlogExplain("stable_PI", row, params, fmt)} size="sm" sub={row.PI_lower !== undefined && row.PI_lower !== null ? `${t("PI_lower")} ${fmtNum(row.PI_lower, 1)}` : undefined} />
              </div>
            </header>

            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <Tabs value={search.tab} onValueChange={(v) => setTab(v as SliceTab)}>
                  <TabsList aria-label="Reasons">
                    <TabsTrigger value="drivers">{plain ? "Which expectations are missed" : "Drivers"}</TabsTrigger>
                    <TabsTrigger value="distributions">{plain ? "Compared with everyone else" : "Distributions"}</TabsTrigger>
                    <TabsTrigger value="cases">Cases</TabsTrigger>
                    <TabsTrigger value="validation">{plain ? "Can the data be trusted?" : "Validation"}</TabsTrigger>
                    <TabsTrigger value="flow">{plain ? "Where in the flow" : "Flow"}</TabsTrigger>
                    <TabsTrigger value="headroom">{plain ? "Possible gain" : "Headroom"}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="drivers" className="flex flex-col gap-4">
                    <Card>
                      <CardTitle>{plain ? "Which expectations are missed" : "Top drivers"}</CardTitle>
                      {top.length === 0 && <p className="text-sm text-text-muted">No expectation is missed more here than in the whole log.</p>}
                      <ol className="flex flex-col gap-2">
                        {top.map((d) => (
                          <li key={d.constraint} className="flex flex-col gap-1">
                            <p className="text-sm">
                              <strong>{(d.description ?? d.constraint).replace(/\.$/, "")}</strong>
                              <span className="text-text-muted"> — missed in {fmtPct(d.share_violated, 0)} of cases — explains {fmtPct(d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0), 0)} of the shortfall</span>
                              <span className="ml-2 font-mono text-[11px] text-text-subtle">{d.constraint}</span>
                            </p>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.max(0, Math.min(1, d.share_of_shortfall ?? 0))} aria-label={`${d.constraint} explains ${fmtPct(d.share_of_shortfall ?? 0, 0)} of the shortfall`}>
                              <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (d.share_of_shortfall ?? 0) * 100))}%`, background: `var(--layer-${Math.abs([...d.layer].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261)) % 8})` }} />
                            </div>
                          </li>
                        ))}
                      </ol>
                    </Card>
                    <Suspense fallback={<LoadingBlock rows={6} />}>
                      <Charts drivers={detail.drivers} layers={detail.layers} penaltyMass={detail.penaltyMass} penaltyMassBy={detail.penaltyMassBy ?? undefined} layerNames={layerNames} gap={row.gap} onSelect={(c: string) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "distributions", constraint: c }) })} />
                    </Suspense>
                    <Card>
                      <CardTitle>
                        <Term id="driver">{plain ? "All expectations" : "Constraint drivers"}</Term>
                      </CardTitle>
                      <Table>
                        <thead>
                          <tr>
                            <Th>
                              <Term id="constraint" />
                            </Th>
                            <Th>
                              <Term id="layer" />
                            </Th>
                            <Th>type</Th>
                            <Th numeric>
                              <Term id="contribution" />
                            </Th>
                            <Th numeric>Δ</Th>
                            <Th numeric>
                              <Term id="violation_share">{plain ? "missed in" : "violated"}</Term>
                            </Th>
                            <Th numeric>
                              <Term id="in_scope">{plain ? "applies to" : "in scope"}</Term>
                            </Th>
                          </tr>
                        </thead>
                        <tbody>
                          {drivers.map((d) => (
                            <tr key={d.constraint} className={cn(highlight === d.constraint && "bg-selection")} onMouseEnter={() => setHighlight(d.constraint)} onMouseLeave={() => setHighlight(undefined)}>
                              <Td className="text-xs" title={d.constraint}>
                                {plain ? (d.description ?? d.constraint) : d.constraint}
                                {plain && <span className="ml-1 font-mono text-[11px] text-text-subtle">{d.constraint}</span>}
                              </Td>
                              <Td>
                                <LayerChip id={d.layer} name={layerNames[d.layer]} />
                              </Td>
                              <Td>
                                <Badge variant="outline">{d.type}</Badge>
                              </Td>
                              <Td numeric className={d.delta_gap < 0 ? "text-success" : undefined}>
                                {fmtPct(d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0), 0)}
                              </Td>
                              <Td numeric className={d.delta_gap < 0 ? "text-success" : undefined}>
                                {fmtNum(d.delta_gap, 4)}
                              </Td>
                              <Td numeric>{fmtPct(d.share_violated, 1)}</Td>
                              <Td numeric>{fmtPct(d.share_in_scope, 0)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </Card>
                  </TabsContent>

                  <TabsContent value="distributions">
                    <Card>
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <CardTitle className="mb-0">{plain ? "This group compared with everyone else" : "Distribution of the raw signal · slice"}</CardTitle>
                        <Select value={constraint ?? ""} onValueChange={(c) => void navigate({ to: ".", search: (s) => ({ ...s, constraint: c }) })}>
                          <SelectTrigger className="w-80 font-mono text-xs" aria-label={t("constraint")}>
                            <SelectValue placeholder={t("constraint")} />
                          </SelectTrigger>
                          <SelectContent>
                            {lensConstraints.map((c) => (
                              <SelectItem key={c} value={c}>
                                <span className="font-mono text-xs">{c}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {!constraint && <p className="text-sm text-text-muted">No expectation with a threshold is missed in this group.</p>}
                      {constraint && dist.isPending && <LoadingBlock rows={5} />}
                      {constraint && dist.isError && <ErrorBlock error={dist.error} />}
                      {constraint && dist.data && <DistributionLens key={constraint} distribution={dist.data} constraintId={constraint} title={`${constraint} · ${label}`} />}
                      <p className="mt-2 text-xs text-text-muted">
                        Changing ϑ or W here is exploration; committing a threshold happens on the{" "}
                        <Link className="text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: run.normVersionId }} search={{ tab: "constraints", constraint }}>
                          norm's calibration lens
                        </Link>{" "}
                        and asks for a note.
                      </p>
                    </Card>
                  </TabsContent>

                  <TabsContent value="cases" className="flex flex-col gap-4">
                    <Card>
                      <CardTitle>
                        <Term id="worst_cases" />
                      </CardTitle>
                      <WorstCases cases={worst} selected={selectedCase} onSelect={selectCase} />
                    </Card>
                    <Card>
                      <CardTitle>
                        <Term id="trace" />
                      </CardTitle>
                      {!selectedCase && <p className="text-sm text-text-muted">Select a case to see what happened in it, with the expectations it missed marked.</p>}
                      {selectedCase && trace.isPending && <LoadingBlock rows={4} />}
                      {selectedCase && trace.isError && <ErrorBlock error={trace.error} />}
                      {selectedCase && trace.data && <TraceTimeline trace={trace.data} highlight={highlight} onHighlight={setHighlight} />}
                    </Card>
                  </TabsContent>

                  <TabsContent value="validation">
                    <Card>
                      <CardTitle>{plain ? "Can the data be trusted?" : "Validation row"}</CardTitle>
                      <p className="text-sm">
                        Reading: <strong>{validation.reading ?? "–"}</strong>
                      </p>
                      <dl className="tnum mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                        <dt className="text-text-muted">
                          <Term id="censoring" />
                        </dt>
                        <dd>{fmtPct(validation.censored_share, 1)}</dd>
                        <dt className="text-text-muted">
                          <Term id="replication" />
                        </dt>
                        <dd>{fmtPct(validation.replicated_share, 1)}</dd>
                        <dt className="text-text-muted">{plain ? "shortfall kept without open cases" : "gap retained"}</dt>
                        <dd>{fmtPct(validation.retained, 0)}</dd>
                        <dt className="text-text-muted">{plain ? "shortfall without open cases" : "stable gap kept"}</dt>
                        <dd>{fmtPct(validation.stable_gap_kept, 1)}</dd>
                      </dl>
                      <h4 className="mt-4 text-xs font-medium text-text-muted">
                        <Term id="gate">{plain ? "Checks before acting" : "Gates"}</Term>
                      </h4>
                      <ul className="mt-1 flex flex-col gap-1">
                        {checksOf(validation).map((g) => (
                          <li key={g.kind} className="flex items-center gap-2 text-sm">
                            <GateBadge state={g.state} />
                            <span className="font-medium">{g.kind}</span>
                            <span className="text-text-muted">{g.evidence}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-xs text-text-muted">Passing, failing or waiving a check with a note arrives with increment 2 (review endpoints). Hypotheses drafted before that are marked "blocked".</p>
                    </Card>
                  </TabsContent>

                  <TabsContent value="flow">
                    <Card>
                      <CardTitle>
                        <Term id="flow">{plain ? "Where in the flow" : "Process map"}</Term>
                      </CardTitle>
                      {(flowSlice.isPending || flowGlobal.isPending) && <LoadingBlock rows={6} />}
                      {flowSlice.isError && <ErrorBlock error={flowSlice.error} retry={() => void flowSlice.refetch()} />}
                      {flowSlice.data && (
                        <Suspense fallback={<LoadingBlock rows={6} />}>
                          <FlowMap graph={flowSlice.data} baseline={flowGlobal.data} title={`Process map of ${label} with the expectations drawn on it`} />
                        </Suspense>
                      )}
                    </Card>
                  </TabsContent>

                  <TabsContent value="headroom">
                    <Card>
                      <CardTitle>
                        <Term id="headroom">{plain ? "Possible gain" : "Headroom under the norm"}</Term>
                      </CardTitle>
                      <Table>
                        <thead>
                          <tr>
                            {(detail.headroom?.columns ?? []).map((c) => (
                              <Th key={c} numeric={c !== "layer" && c !== "constraint" && c !== "note"}>
                                {c === "layer" ? t("layer") : c === "headroom" ? t("headroom") : c.replace("_", " ")}
                              </Th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.headroom?.rows ?? []).map((r, i) => (
                            <tr key={i}>
                              {r.map((v, j) => (
                                <Td key={j} numeric={j > 0 && typeof v === "number"} className={j === 0 ? "text-xs" : undefined}>
                                  {j === 0 ? (layerNames[String(v)] ?? String(v)) : typeof v === "number" ? (Number.isInteger(v) ? fmtInt(v) : fmtNum(v, 4)) : v === null || v === undefined ? "–" : String(v)}
                                </Td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                      {area && <p className="mt-2 text-xs text-text-muted">The possible gain per expectation area (starting with {area}) arrives with the analytics package.</p>}
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
              <DecisionPane projectId={ctx.projectId} runId={runId} slicing={slicing} row={row} layerName={area} focus={search.focus === "finding"} />
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}
