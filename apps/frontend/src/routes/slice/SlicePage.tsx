import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { SliceDetail, WorstCase } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { sliceRoute } from "@/app/router";
import type { SliceTab } from "@/app/search";
import { filterPreviewQuery, flowFocusedQuery, type BacklogRowC2, type RunC2, type SliceDetailC2 } from "@/lib/api/cycle2";
import { ConfidenceMark, GateBadge, KindBadge, LayerChip, type GateState } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { Metric, backlogExplain } from "@/components/explain";
import { BackControl } from "@/components/guide/BackControl";
import { CaveatChips } from "@/components/guide/CaveatChips";
import { FreezeButton } from "@/components/guide/Freeze";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { EmptyState, ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseFilter, serializeFilter } from "@/lib/filter";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { distributionQuery, flowQuery, normQuery, sliceQuery, traceQuery } from "@/lib/queries";
import { cn, sliceLabel, tableRecords } from "@/lib/utils";
import { distanceSentence } from "../backlog/SignalCard";
import { DecisionPane } from "./DecisionPane";
import { TraceTimeline } from "./TraceTimeline";

const Charts = lazy(() => import("./charts"));
const FlowMap = lazy(() => import("@/components/flow/FlowMap"));

type Driver = { constraint: string; layer: string; type: string; mean_penalty: number; mean_violation?: number; share_violated: number; share_in_scope: number; share_evaluated?: number; description?: string; delta_gap: number; share_of_shortfall?: number };
type Contrast = { constraint: string; plain?: string; description: string; layer?: string; type?: string; share_missed_group: number; share_missed_elsewhere: number; risk_difference: number; rd_lo?: number; rd_hi?: number; median_group?: number | null; median_elsewhere?: number | null; shift?: number | null; unit?: string | null; pattern?: string | null; share_of_shortfall?: number };
type Comparison = { constraint: string; kind?: string; sentence?: string | null };
type Headroom = { constraint: string; plain?: string; description?: string; layer?: string; gain_points?: number | null; gain_percent?: number | null; share_violated?: number | null };
type Validation = { n_cases?: number; censored_share?: number; replicated_share?: number; retained?: number; stable_gap_kept?: number; reading?: string };
type FlowConstraintMeta = { description?: { id?: string; activities?: string[]; a?: string[]; b?: string[] } };

function WorstCases({ cases, selected, onSelect, plain }: { cases: WorstCase[]; selected?: string; onSelect: (c: WorstCase) => void; plain: boolean }) {
  return (
    <Table data-testid="worst-cases">
      <thead>
        <tr>
          <Th>case</Th>
          <Th numeric>{plain ? "rules met" : <Term id="score">score</Term>}</Th>
          <Th>{plain ? "rules missed" : <Term id="constraint">expectations missed</Term>}</Th>
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
            <Td numeric>{plain ? fmtPct(c.score, 0) : fmtNum(c.score, 3)}</Td>
            <Td className="text-xs">
              <span className="flex flex-wrap gap-1">
                {(c.violated ?? []).map((v) => (
                  <Badge key={v} variant="danger" className={plain ? undefined : "font-mono"} title={v}>
                    <span aria-hidden>▲</span>
                    {plain ? v.replace(/^c_l\d_/, "").replace(/_/g, " ") : v}
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
function checksOf(v: Validation, noun: string): { kind: string; state: GateState; evidence: string }[] {
  const out: { kind: string; state: GateState; evidence: string }[] = [];
  if (v.censored_share !== undefined) {
    out.push({ kind: "still open at the end of the data", state: v.censored_share > 0.1 ? "pending" : "passed", evidence: `${fmtPct(v.censored_share, 1)} of these ${noun} were still open when the data was extracted${v.retained !== undefined ? `; without them the shortfall keeps ${fmtPct(Math.min(v.retained, 9.99), 0)} of its size` : ""}` });
  }
  if (v.replicated_share !== undefined) {
    out.push({ kind: "duplicated events", state: v.replicated_share >= 0.5 ? "failed" : "passed", evidence: `${fmtPct(v.replicated_share, 1)} of these ${noun} carry postings copied from the order header` });
  }
  out.push({ kind: "plausibility", state: "pending", evidence: "awaiting the owner's reading" });
  return out;
}

const plainConstraint = (d: { description?: string; constraint: string }) => (d.description ?? d.constraint).replace(/\.$/, "");

const UNIT_WORD: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds", count: "postings" };

/** The real-unit sentence of one contrast row: "83 days here against 55 elsewhere (+25 days)"; the backend's own sentence wins. */
function contrastSentence(c: Contrast | undefined, comparison: Comparison | undefined, noun: string): string | undefined {
  if (comparison?.sentence) return comparison.sentence;
  if (!c) return undefined;
  if (c.median_group !== null && c.median_group !== undefined && c.median_elsewhere !== null && c.median_elsewhere !== undefined) {
    const unit = UNIT_WORD[c.unit ?? ""] ?? c.unit ?? "";
    const shift = c.shift ?? c.median_group - c.median_elsewhere;
    return `${fmtNum(c.median_group, c.median_group >= 10 ? 0 : 1)} ${unit} here against ${fmtNum(c.median_elsewhere, c.median_elsewhere >= 10 ? 0 : 1)} elsewhere (${shift >= 0 ? "+" : ""}${fmtNum(shift, Math.abs(shift) >= 10 ? 0 : 1)} ${unit})`;
  }
  return `${fmtPct(c.share_missed_group, 0)} of these ${noun} miss it against ${fmtPct(c.share_missed_elsewhere, 0)} elsewhere`;
}

/**
 * "Why?" — the essential reason chain (RG-3): the group's one sentence, where in the flow (first), which
 * expectations are missed in plain words with the real-unit comparison and the share of the shortfall, the
 * comparison lens, the cases, the data caveats and the possible gain; the decision pane stays on the right.
 */
export default function SlicePage() {
  const { vocabulary, t } = useVocabulary();
  const ctx = useWorkbench();
  const { runId, sliceKey } = sliceRoute.useParams();
  const search = sliceRoute.useSearch();
  const navigate = useNavigate();
  const run = ctx.runs.find((r) => r.id === runId) as RunC2 | undefined;
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? "";
  const view = search.view ?? run?.views?.[0];
  const plain = vocabulary === "plain";
  const filter = useMemo(() => parseFilter(search.filter), [search.filter]);

  useEffect(() => {
    if (run && (search.slicing !== slicing || search.view !== view)) void navigate({ to: ".", search: (s) => ({ ...s, slicing, view }), replace: true });
  }, [run, search.slicing, search.view, slicing, view, navigate]);

  const slice = useQuery({ ...sliceQuery(ctx.projectId, runId, sliceKey, slicing, view), enabled: !!run && !!slicing });
  const norm = useQuery({ ...normQuery(ctx.projectId, run?.normVersionId ?? ""), enabled: !!run });
  const layers = useMemo(() => (norm.data?.norm as { layers?: { id: string; name: string }[] } | undefined)?.layers ?? [], [norm.data]);
  const layerNames = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.name])), [layers]);
  const drivers = useMemo(() => tableRecords<Driver>(slice.data?.drivers), [slice.data]);
  const contrast = useMemo(() => tableRecords<Contrast>((slice.data as SliceDetailC2 | undefined)?.contrast), [slice.data]);
  const comparisons = useMemo(() => tableRecords<Comparison>((slice.data as SliceDetailC2 | undefined)?.comparisons), [slice.data]);
  const headroomRows = useMemo(() => tableRecords<Headroom>(slice.data?.headroom), [slice.data]);
  const lensConstraints = useMemo(() => {
    const thresholdTypes = new Set(["lag", "metric", "singularity", "balance"]);
    return drivers.filter((d) => thresholdTypes.has(d.type)).map((d) => d.constraint);
  }, [drivers]);
  const constraint = search.constraint && lensConstraints.includes(search.constraint) ? search.constraint : lensConstraints[0];
  const dist = useQuery({ ...distributionQuery(ctx.projectId, runId, constraint ?? "", slicing, sliceKey), enabled: !!constraint && search.tab === "distributions" });
  const selectedCase = search.case;
  const worst = slice.data?.worstCases ?? [];
  const trace = useQuery({ ...traceQuery(ctx.projectId, runId, selectedCase ?? ""), enabled: !!selectedCase && search.tab === "cases" });
  const flowGlobal = useQuery({ ...flowQuery(ctx.projectId, runId, { filter: search.filter }), enabled: !!run && search.tab === "flow" });
  const flowSlice = useQuery({ ...flowQuery(ctx.projectId, runId, { slicing, sliceKey, filter: search.filter }), enabled: !!run && !!slicing && search.tab === "flow" });
  const focused = useQuery({ ...flowFocusedQuery(ctx.projectId, runId, { slicing, sliceKey, focus: search.activity ?? "", filter }), enabled: !!run && !!search.activity && search.tab === "flow" });
  const preview = useQuery({ ...filterPreviewQuery(ctx.projectId, runId, filter), enabled: !!run && !!filter });
  const [highlight, setHighlight] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  const setTab = (tab: SliceTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectCase = (c: WorstCase) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "cases", case: c.caseId }) });

  // activities of the top drivers on the map, from the flow response's constraint descriptions
  const topDriverActivities = useMemo(() => {
    const meta = (flowSlice.data?.meta ?? {}) as { constraints?: FlowConstraintMeta[] };
    const top = drivers.filter((d) => d.delta_gap > 0).slice(0, 3).map((d) => d.constraint);
    const ids = new Set<string>();
    for (const c of meta.constraints ?? []) {
      const d = c.description;
      if (d?.id && top.includes(d.id)) for (const a of [...(d.activities ?? []), ...(d.a ?? []), ...(d.b ?? [])]) ids.add(a);
    }
    return [...ids];
  }, [flowSlice.data, drivers]);

  if (!run) return ctx.isLoading ? <LoadingBlock rows={8} /> : <ErrorBlock error={new Error(`Run ${runId} is not in this project.`)} />;

  const backHref = { href: `/p/${ctx.projectId}/runs/${runId}/backlog?slicing=${encodeURIComponent(slicing)}${view ? `&view=${encodeURIComponent(view)}` : ""}`, label: plain ? "Where is it worst?" : "Backlog" };

  return (
    <QueryState query={slice} rows={8}>
      {(detail: SliceDetail) => {
        const row = detail.row as BacklogRowC2 | undefined;
        if (!row) return <EmptyState title="Group not found" reason="The group is not part of this run and grouping." />;
        const c2 = detail as SliceDetailC2;
        const label = sliceLabel(row);
        const noun = plain ? (row.case_noun ?? "cases") : "cases";
        const fmt = { num: fmtNum, int: fmtInt };
        const params = { globalMean: row.global_mean ?? row.mean_score + row.gap, gamma: run.gamma ?? 20, view, minCases: run.minCases ?? 1 };
        const validation = (detail.validation ?? {}) as Validation;
        const top = drivers.filter((d) => d.delta_gap > 0).slice(0, 3);
        const area = row.dominant_layer_name ?? layerNames[row.dominant_layer ?? ""];
        const missed = row.layer_missed_label ?? area;
        const caveats = c2.caveats ?? row.caveats;
        const comparison = c2.comparison ?? row.comparison ?? contrastSentence(contrast.find((c) => c.constraint === top[0]?.constraint), comparisons.find((c) => c.constraint === top[0]?.constraint), noun);
        const plainOf = (id: string, fallback: string) => c2.guidance_refs?.find((g) => g.kind === "constraint" && g.id === id)?.plain_name ?? contrast.find((c) => c.constraint === id)?.plain ?? fallback;
        const subgroups = tableRecords<{ attribute: string; value: string; cases: number; share: number }>(c2.subgroups);
        const flowMeta = (flowSlice.data?.meta ?? {}) as { constraints?: FlowConstraintMeta[] };
        const constraintsOfActivity = (id: string) => (flowMeta.constraints ?? []).filter((c) => [...(c.description?.activities ?? []), ...(c.description?.a ?? []), ...(c.description?.b ?? [])].includes(id)).map((c) => c.description?.id).filter((x): x is string => !!x);
        return (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
                <BackControl fallback={backHref} className="normal-case tracking-normal" />
                <span>{plain ? "Why?" : "Slice"}</span>
                {run.scope?.flow_type && <Badge variant="outline">{run.scope.flow_type} flow only</Badge>}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold">
                  <span>{label}</span>
                  <KindBadge kind={row.kind} hotspotType={row.hotspot_type} short={plain} className="text-sm" />
                  <HowToReadToggle id="why" />
                </h1>
                <div data-no-capture>
                  <FreezeButton projectId={ctx.projectId} screen="why" context={{ run_id: runId, slicing, view, slice_key: row.key, filters: filter ?? null, scope: run.scope ?? null }} data={{ row, drivers: top, contrast, validation }} defaultTitle={`Why? · ${label}`} />
                </div>
              </div>
              <p className="reading headline text-text" data-testid="why-sentence">
                <strong className="tnum">{fmtInt(row.n_cases)}</strong> {noun} · {row.gap > 0 ? distanceSentence(row, plain) : "at or above the overall score"} · <ConfidenceMark value={row.stability} words className="text-lg" />
              </p>
              {(missed || comparison) && (
                <p className="reading text-base text-text-muted" data-testid="why-reason">
                  {missed && (
                    <>
                      {plain ? "mostly" : "dominant layer"} <strong className="font-medium text-text">{plain ? missed : area}</strong>
                    </>
                  )}
                  {comparison ? `${missed ? " — " : ""}${comparison}` : ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <CaveatChips caveats={caveats} />
                <span className="ml-auto flex min-w-[220px] items-center gap-2 text-xs text-text-muted">
                  <span role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={row.n_ranked ? 1 - (row.rank - 1) / row.n_ranked : 1} aria-label={`${t("PI")} ${fmtNum(row.stable_PI, 1)}, rank ${row.rank}${row.n_ranked ? ` of ${row.n_ranked}` : ""}`} className="h-2 min-w-[90px] flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(4, row.n_ranked ? (1 - (row.rank - 1) / row.n_ranked) * 100 : 100)}%`, background: row.kind ? `var(--kind-${row.kind}-solid)` : "var(--color-accent)" }} />
                  </span>
                  <span className="tnum whitespace-nowrap">
                    {plain ? "priority" : t("stable_PI")} {fmtNum(row.stable_PI, 1)} · rank {row.rank}
                    {row.n_ranked ? ` of ${fmtInt(row.n_ranked)}` : ""}
                    {view ? ` · ${view}` : ""}
                  </span>
                </span>
              </div>
              {!plain && (
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6" data-testid="method-strip">
                  <Metric label={t("n_cases")} value={fmtInt(row.n_cases)} explain={backlogExplain("n_cases", row, params, fmt)} size="sm" />
                  <Metric label={t("mean_score")} value={fmtNum(row.mean_score, 3)} explain={backlogExplain("mean_score", row, params, fmt)} size="sm" />
                  <Metric label={t("gap")} value={fmtNum(row.gap, 4)} explain={backlogExplain("gap", row, params, fmt)} size="sm" />
                  <Metric label={t("stable_gap")} value={fmtNum(row.stable_gap, 4)} explain={backlogExplain("stable_gap", row, params, fmt)} size="sm" />
                  <Metric label={t("PI")} value={fmtNum(row.PI, 1)} explain={backlogExplain("PI", row, params, fmt)} size="sm" />
                  <Metric label={t("stable_PI")} value={fmtNum(row.stable_PI, 1)} explain={backlogExplain("stable_PI", row, params, fmt)} size="sm" sub={row.PI_lower !== undefined && row.PI_lower !== null ? `${t("PI_lower")} ${fmtNum(row.PI_lower, 1)}` : undefined} />
                </div>
              )}
              <HowToRead id="why">
                One group, its reasons. <strong>Where in the flow</strong> shows the group's process map with the activities of its top expectations highlighted; right-click an activity to filter to it, exclude it or follow its paths — the filter travels
                with the address. <strong>Which expectations are missed</strong> lists the rules behind the shortfall in plain words with the real-unit comparison against everyone else. <strong>Can the data be trusted?</strong> lists what could distort the reading. Your reading goes into the decision pane.
              </HowToRead>
            </header>

            <NextStep label="Record your reading" because={`a finding with an owner turns this signal into work; "What can we do?" (the remedy screen) arrives in cycle 3`} onClick={() => void navigate({ to: ".", search: (s) => ({ ...s, focus: "finding" }) })} />

            <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <Tabs value={search.tab} onValueChange={(v) => setTab(v as SliceTab)}>
                  <TabsList aria-label="Reasons">
                    <TabsTrigger value="flow">{plain ? "Where in the flow" : "Flow"}</TabsTrigger>
                    <TabsTrigger value="drivers">{plain ? "Which expectations are missed" : "Drivers"}</TabsTrigger>
                    <TabsTrigger value="distributions">{plain ? "Compared with everyone else" : "Distributions"}</TabsTrigger>
                    <TabsTrigger value="cases">Cases</TabsTrigger>
                    <TabsTrigger value="validation">{plain ? "Can the data be trusted?" : "Validation"}</TabsTrigger>
                    <TabsTrigger value="headroom">{plain ? "Possible gain" : "Headroom"}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="flow">
                    <Card>
                      <CardTitle>
                        <Term id="flow" primaryOnly={plain}>
                          {plain ? "Where in the flow" : "Process map"}
                        </Term>
                      </CardTitle>
                      {filter && preview.data && (
                        <p className="mb-2 text-sm text-text-muted" data-testid="filter-preview">
                          <strong className="tnum text-text">{fmtInt(preview.data.cases_in)}</strong> {noun} in · {fmtInt(preview.data.cases_out)} out with the current filter ·{" "}
                          <button type="button" className="text-accent-text underline" onClick={() => void navigate({ to: ".", search: (s) => ({ ...s, filter: undefined, activity: undefined }) })}>
                            clear
                          </button>
                        </p>
                      )}
                      {(flowSlice.isPending || flowGlobal.isPending) && <LoadingBlock rows={6} />}
                      {flowSlice.isError && <ErrorBlock error={flowSlice.error} retry={() => void flowSlice.refetch()} />}
                      {flowSlice.data && (
                        <Suspense fallback={<LoadingBlock rows={6} />}>
                          <FlowMap
                            graph={flowSlice.data}
                            baseline={flowGlobal.data}
                            title={`Process map of ${label} with the expectations drawn on it`}
                            filter={filter}
                            preview={preview.data}
                            onFilterChange={(f) => void navigate({ to: ".", search: (s) => ({ ...s, filter: serializeFilter(f) }) })}
                            focus={search.activity ?? null}
                            onFocusChange={(a) => void navigate({ to: ".", search: (s) => ({ ...s, activity: a }) })}
                            paths={focused.data?.paths ?? undefined}
                            highlight={topDriverActivities}
                            onAction={(a) => {
                              if (a.id === "lens") {
                                const c = constraintsOfActivity(a.ids[0] ?? "").find((id) => lensConstraints.includes(id)) ?? lensConstraints[0];
                                void navigate({ to: ".", search: (s) => ({ ...s, tab: "distributions", constraint: c }) });
                              }
                              if (a.id === "worst-cases") void navigate({ to: ".", search: (s) => ({ ...s, tab: "cases" }) });
                            }}
                          />
                        </Suspense>
                      )}
                      {topDriverActivities.length > 0 && <p className="mt-2 text-xs text-text-muted">Tinted activities belong to the top expectations behind the shortfall.</p>}
                    </Card>
                  </TabsContent>

                  <TabsContent value="drivers" className="flex flex-col gap-4">
                    <Card>
                      <CardTitle>{plain ? "Which expectations are missed" : "Top drivers"}</CardTitle>
                      {top.length === 0 && <p className="text-sm text-text-muted">No expectation is missed more here than in the whole log.</p>}
                      <ol className="flex flex-col gap-4" data-testid="top-drivers">
                        {top.map((d) => {
                          const c = contrast.find((x) => x.constraint === d.constraint);
                          const sentence = contrastSentence(c, comparisons.find((x) => x.constraint === d.constraint), noun);
                          return (
                            <li key={d.constraint} className="flex flex-col gap-1.5">
                              <p className="reading text-base">
                                <strong title={plain ? `${plainConstraint(d)} (${d.constraint})` : undefined}>{plain ? plainOf(d.constraint, plainConstraint(d)) : plainConstraint(d)}</strong>
                                {plain && plainOf(d.constraint, "") && plainOf(d.constraint, "") !== plainConstraint(d) ? <span className="text-text-muted"> — {plainConstraint(d)}</span> : null}
                                <span className="text-text-muted">
                                  {" "}
                                  — missed in {fmtPct(d.share_violated, 0)} of these {noun} — explains {fmtPct(d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0), 0)} of the shortfall
                                </span>
                                {!plain && <span className="ml-2 font-mono text-[11px] text-text-subtle">{d.constraint}</span>}
                              </p>
                              {sentence && <p className="reading text-sm text-text-muted">{sentence}</p>}
                              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.max(0, Math.min(1, d.share_of_shortfall ?? 0))} aria-label={`${plainConstraint(d)} explains ${fmtPct(d.share_of_shortfall ?? 0, 0)} of the shortfall`}>
                                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (d.share_of_shortfall ?? 0) * 100))}%`, background: `var(--layer-${Math.abs([...d.layer].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261)) % 8})` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </Card>
                    {subgroups.length > 0 && (
                      <Card data-testid="subgroups">
                        <CardTitle>{plain ? "What kind of cases carry it" : "Sub-groups by penalty mass"}</CardTitle>
                        <ol className="flex flex-col gap-1.5 text-sm">
                          {subgroups.slice(0, 5).map((g) => (
                            <li key={`${g.attribute}:${g.value}`} className="flex flex-wrap items-baseline gap-2">
                              <span className="font-medium">{g.value}</span>
                              <span className="text-text-muted">
                                {g.attribute.replace(/^case /, "")} · {fmtInt(g.cases)} {noun} · {fmtPct(g.share, 0)} of the shortfall
                              </span>
                              <span role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={g.share} aria-label={`${g.value} carries ${fmtPct(g.share, 0)} of the shortfall`} className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-sunken">
                                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, g.share * 100)}%` }} />
                              </span>
                            </li>
                          ))}
                        </ol>
                      </Card>
                    )}
                    <Card className="border-dashed" data-testid="typical-causes">
                      <CardTitle>Typical causes for this pattern</CardTitle>
                      <p className="reading text-sm text-text-muted">Typical causes arrive with the knowledge hub in cycle 3: candidate reasons for the missed expectations, each with what to check in the log and what to ask outside it, and the button "What can we do?".</p>
                    </Card>
                    <button type="button" className="self-start text-sm text-accent-text underline" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "hide the full picture" : `show all ${drivers.length} expectations, the waterfall and the areas`}
                    </button>
                    {showAll && (
                      <>
                        <Suspense fallback={<LoadingBlock rows={6} />}>
                          <Charts drivers={detail.drivers} layers={detail.layers} penaltyMass={detail.penaltyMass} penaltyMassBy={detail.penaltyMassBy ?? undefined} layerNames={layerNames} gap={row.gap} onSelect={(c: string) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "distributions", constraint: c }) })} />
                        </Suspense>
                        <Card>
                          <CardTitle>
                            <Term id="driver" primaryOnly={plain}>
                              {plain ? "All expectations" : "Constraint drivers"}
                            </Term>
                          </CardTitle>
                          <Table data-testid="drivers-table">
                            <thead>
                              <tr>
                                <Th>{plain ? "expectation" : <Term id="constraint" />}</Th>
                                <Th>{plain ? "area" : <Term id="layer" />}</Th>
                                {!plain && <Th>type</Th>}
                                <Th numeric>{plain ? "share of the shortfall" : <Term id="contribution" />}</Th>
                                {!plain && <Th numeric>Δ</Th>}
                                <Th numeric>{plain ? "missed in" : <Term id="violation_share">violated</Term>}</Th>
                                <Th numeric>{plain ? "applies to" : <Term id="in_scope">in scope</Term>}</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {drivers.map((d) => (
                                <tr key={d.constraint} className={cn(highlight === d.constraint && "bg-selection")} onMouseEnter={() => setHighlight(d.constraint)} onMouseLeave={() => setHighlight(undefined)}>
                                  <Td className="text-xs" title={d.constraint}>
                                    {plain ? plainConstraint(d) : d.constraint}
                                  </Td>
                                  <Td>
                                    <LayerChip id={d.layer} name={layerNames[d.layer]} />
                                  </Td>
                                  {!plain && (
                                    <Td>
                                      <Badge variant="outline">{d.type}</Badge>
                                    </Td>
                                  )}
                                  <Td numeric className={d.delta_gap < 0 ? "text-success" : undefined}>
                                    {fmtPct(d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0), 0)}
                                  </Td>
                                  {!plain && (
                                    <Td numeric className={d.delta_gap < 0 ? "text-success" : undefined}>
                                      {fmtNum(d.delta_gap, 4)}
                                    </Td>
                                  )}
                                  <Td numeric>{fmtPct(d.share_violated, 1)}</Td>
                                  <Td numeric>{fmtPct(d.share_in_scope, 0)}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </Card>
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="distributions">
                    <Card>
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <CardTitle className="mb-0">{plain ? "This group compared with everyone else" : "Distribution of the raw signal · slice"}</CardTitle>
                        <Select value={constraint ?? ""} onValueChange={(c) => void navigate({ to: ".", search: (s) => ({ ...s, constraint: c }) })}>
                          <SelectTrigger className={cn("w-96 text-xs", !plain && "font-mono")} aria-label={plain ? "expectation" : t("constraint")}>
                            <SelectValue placeholder={plain ? "expectation" : t("constraint")} />
                          </SelectTrigger>
                          <SelectContent>
                            {lensConstraints.map((c) => {
                              const d = drivers.find((x) => x.constraint === c);
                              return (
                                <SelectItem key={c} value={c}>
                                  <span className={cn("text-xs", !plain && "font-mono")}>{plain && d ? plainConstraint(d) : c}</span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      {!constraint && <p className="text-sm text-text-muted">No expectation with a threshold is missed in this group.</p>}
                      {constraint && dist.isPending && <LoadingBlock rows={5} />}
                      {constraint && dist.isError && <ErrorBlock error={dist.error} />}
                      {constraint && dist.data && <DistributionLens key={constraint} distribution={dist.data} constraintId={constraint} title={`${plain ? plainConstraint(drivers.find((d) => d.constraint === constraint) ?? { constraint }) : constraint} · ${label}`} />}
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
                        <Term id="worst_cases" primaryOnly={plain} />
                      </CardTitle>
                      <WorstCases cases={worst} selected={selectedCase} onSelect={selectCase} plain={plain} />
                    </Card>
                    <Card>
                      <CardTitle>
                        <Term id="trace" primaryOnly={plain} />
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
                      <CaveatChips caveats={caveats} className="mb-3" max={6} />
                      <p className="text-sm">
                        Reading: <strong>{validation.reading ?? "–"}</strong>
                      </p>
                      <dl className="tnum mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                        <dt className="text-text-muted">
                          <Term id="censoring" primaryOnly={plain} />
                        </dt>
                        <dd>{fmtPct(validation.censored_share, 1)}</dd>
                        <dt className="text-text-muted">
                          <Term id="replication" primaryOnly={plain} />
                        </dt>
                        <dd>{fmtPct(validation.replicated_share, 1)}</dd>
                        <dt className="text-text-muted">{plain ? "shortfall kept without open cases" : "gap retained"}</dt>
                        <dd>{fmtPct(validation.retained, 0)}</dd>
                        <dt className="text-text-muted">{plain ? "shortfall without open cases" : "stable gap kept"}</dt>
                        <dd>{fmtPct(validation.stable_gap_kept, 1)}</dd>
                      </dl>
                      <h4 className="mt-4 text-xs font-medium text-text-muted">
                        <Term id="gate" primaryOnly={plain}>
                          {plain ? "Checks before acting" : "Gates"}
                        </Term>
                      </h4>
                      <ul className="mt-1 flex flex-col gap-1">
                        {checksOf(validation, noun).map((g) => (
                          <li key={g.kind} className="flex items-center gap-2 text-sm">
                            <GateBadge state={g.state} />
                            <span className="font-medium">{g.kind}</span>
                            <span className="text-text-muted">{g.evidence}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-xs text-text-muted">Passing, failing or waiving a check with a note arrives with the review endpoints (cycle 3). Hypotheses drafted before that are marked "blocked".</p>
                    </Card>
                  </TabsContent>

                  <TabsContent value="headroom">
                    <Card>
                      <CardTitle>
                        <Term id="headroom" primaryOnly={plain}>
                          {plain ? "Possible gain" : "Headroom under the norm"}
                        </Term>
                      </CardTitle>
                      {headroomRows.some((h) => h.gain_points !== null && h.gain_points !== undefined) ? (
                        <ol className="flex flex-col gap-3" data-testid="headroom-list">
                          {headroomRows
                            .filter((h) => h.gain_points !== null && h.gain_points !== undefined)
                            .slice(0, 6)
                            .map((h) => (
                              <li key={h.constraint} className="flex flex-col gap-1">
                                <p className="reading text-base">
                                  If <strong title={h.constraint}>{plain ? (h.plain ?? h.description ?? h.constraint) : h.constraint}</strong> were always met, this group would gain <strong className="tnum">{fmtNum(h.gain_points ?? 0, 1)} points</strong>
                                  {h.gain_percent !== null && h.gain_percent !== undefined ? ` (${fmtNum(h.gain_percent, 0)} % of its shortfall)` : ""}
                                  {h.share_violated !== null && h.share_violated !== undefined ? <span className="text-text-muted">; {fmtPct(h.share_violated, 0)} of these {noun} miss it today</span> : null}.
                                </p>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, h.gain_percent ?? 0)} aria-label={`${h.plain ?? h.constraint}: ${fmtNum(h.gain_percent ?? 0, 0)} % of the shortfall`}>
                                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(2, Math.min(100, h.gain_percent ?? 0))}%` }} />
                                </div>
                              </li>
                            ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-text-muted">The possible gain per expectation{area ? ` (starting with ${area})` : ""} arrives when the analytics have run for this run.</p>
                      )}
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
