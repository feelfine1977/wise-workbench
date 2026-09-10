import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { SliceDetail, WorstCase } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { ApiError } from "@/lib/api";
import { sliceRoute } from "@/app/router";
import type { SliceTab } from "@/app/search";
import { filterPreviewQuery, type BacklogRow as BacklogRowC2, type SliceDetail as SliceDetailC2 } from "@/lib/api/exploration";
import { flowFocusedQuery } from "@/lib/api/flow";
import type { Filter } from "@/lib/api/filter-types";
import type { RunWithScope as RunC2 } from "@/lib/api/runs";
import { runManifestQuery } from "@/lib/api/runs";
import { whatCanWeDoQuery } from "@/lib/api/review";
import { ReasonList } from "@/components/knowledge/HubTemplate";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { GatesBlock } from "@/components/review/Gates";
import { CalibrationChip, ConfidenceMark, KindBadge } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { Metric, backlogExplain } from "@/components/explain";
import { BackControl } from "@/components/guide/BackControl";
import { CaveatChips } from "@/components/guide/CaveatChips";
import { FilterChipsRow } from "@/components/guide/FilterChipsRow";
import { FreezeButton } from "@/components/guide/Freeze";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { EmptyState, ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addClause, addedClauses, describeClause, filterHash, parseFilter, serializeFilter } from "@/lib/filter";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery, sliceQuery } from "@/lib/api/exploration";
import { distributionQuery } from "@/lib/api/analytics";
import { flowQuery } from "@/lib/api/flow";
import { normQuery } from "@/lib/api/norms";
import { traceQuery } from "@/lib/queries";
import { belowExpectation, comparisonSentence, groupLabel, missedPhrase, sharedKeyValues } from "@/lib/sentences";
import { findingId, useFindingStore } from "@/lib/stores/findings";
import { useNavStore } from "@/lib/stores/nav";
import { cn, tableRecords } from "@/lib/utils";
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

const UNIT_WORD: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds", count: "postings" };

const plainConstraint = (d: { description?: string; constraint: string }) => (d.description ?? d.constraint).replace(/\.$/, "");

/**
 * The real-unit sentence of one contrast row: "83 days here against 55 elsewhere (+28 days)". The backend's
 * own sentence wins and is printed as it is served — the server keeps the bracket in agreement with the two
 * numbers beside it (R3-04); where the sentence is built here, the bracket is the difference of the two
 * numbers **as they are rounded for the screen** and never the shift estimate, which keeps its own labelled
 * row in the contrast table.
 */
function contrastSentence(c: Contrast | undefined, comparison: Comparison | undefined, noun: string): string | undefined {
  if (comparison?.sentence) return comparison.sentence;
  if (!c) return undefined;
  if (c.median_group !== null && c.median_group !== undefined && c.median_elsewhere !== null && c.median_elsewhere !== undefined) {
    const unit = UNIT_WORD[c.unit ?? ""] ?? c.unit ?? "";
    const digitsOf = (v: number) => (v >= 10 ? 0 : 1);
    const hereDigits = digitsOf(c.median_group);
    const elseDigits = digitsOf(c.median_elsewhere);
    const digits = Math.min(hereDigits, elseDigits);
    const difference = Number((Number(c.median_group.toFixed(hereDigits)) - Number(c.median_elsewhere.toFixed(elseDigits))).toFixed(digits));
    const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
    return `${fmtNum(c.median_group, hereDigits)} ${unit} here against ${fmtNum(c.median_elsewhere, elseDigits)} elsewhere (${sign}${fmtNum(Math.abs(difference), digits)} ${unit})`;
  }
  return `${fmtPct(c.share_missed_group, 0)} of these ${noun} miss it against ${fmtPct(c.share_missed_elsewhere, 0)} elsewhere`;
}

/**
 * The sentences above the lens, from the contrast row: the medians in real units, the shares beyond the
 * expectation, and — on a line of its own and named for what it is — the shift estimate, which is a third
 * number and not the difference of the two above it (R3-04).
 */
function lensSentences(c: Contrast | undefined, name: string, label: string, noun: string, threshold: number | null | undefined, unit: string | undefined) {
  if (!c) return undefined;
  const unitWord = UNIT_WORD[c.unit ?? unit ?? ""] ?? c.unit ?? unit ?? "";
  const medians = c.median_group !== null && c.median_group !== undefined && c.median_elsewhere !== null && c.median_elsewhere !== undefined;
  const shift = c.shift;
  const difference = medians ? Number(c.median_group!.toFixed(c.median_group! >= 10 ? 0 : 1)) - Number(c.median_elsewhere!.toFixed(c.median_elsewhere! >= 10 ? 0 : 1)) : undefined;
  // the shift only earns a line where it says something other than the subtraction the reader can do
  const shiftDiffers = medians && shift !== null && shift !== undefined && difference !== undefined && Math.abs(shift - difference) > Math.max(0.05, Math.abs(difference) * 0.02);
  return (
    <>
      {medians && (
        <p>
          {name}: <strong className="tnum">{fmtNum(c.median_group!, c.median_group! >= 10 ? 0 : 1)} {unitWord}</strong> here; everywhere else <strong className="tnum">{fmtNum(c.median_elsewhere!, c.median_elsewhere! >= 10 ? 0 : 1)}</strong>.
        </p>
      )}
      <p>
        <strong className="tnum">{fmtPct(c.share_missed_group, 0)}</strong> of {label}'s {noun} miss it{threshold !== null && threshold !== undefined && medians ? ` (expected ${fmtNum(threshold, threshold >= 10 ? 0 : 1)} ${unitWord})` : ""} — everyone else: <strong className="tnum">{fmtPct(c.share_missed_elsewhere, 0)}</strong>.
      </p>
      {shiftDiffers && (
        <p className="text-text-subtle" data-testid="shift-estimate">
          Typical difference between one item here and one elsewhere:{" "}
          <strong className="tnum">
            {shift! > 0 ? "+" : shift! < 0 ? "−" : ""}
            {fmtNum(Math.abs(shift!), Math.abs(shift!) >= 10 ? 0 : 1)} {unitWord}
          </strong>{" "}
          — an estimate over the whole distribution, not the difference of the two numbers above.
        </p>
      )}
    </>
  );
}

/**
 * The reason screen ("Why?"): one sentence for the group with the kind and the confidence once, a compact
 * strip, the filter chips on every tab, then six questions as tabs — Why (which expectations are missed,
 * with the comparison lens and the map embedded), Compared, Flow, Cases, Data trust, Gain — with the
 * decision pane within reach on the right and the next step after a saved decision.
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
  const setLastSlice = useNavStore((s) => s.setLastSlice);
  const [pendingAdd, setPendingAdd] = useState<{ key: string; text: string }>();
  const [paneOpen, setPaneOpen] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  // the map of the Why screen is the same instrument in a smaller frame (§3.13): it can fill the window too
  const [mapFull, setMapFull] = useState(false);
  const [mapRender, setMapRender] = useState<"map" | "model" | "table">("map");

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
  const lensWanted = !!constraint && (search.tab === "compared" || search.tab === "why");
  const dist = useQuery({ ...distributionQuery(ctx.projectId, runId, constraint ?? "", slicing, sliceKey), enabled: lensWanted });
  // the same expectation over the whole log: "everyone else" is the whole minus the group
  const distAll = useQuery({ ...distributionQuery(ctx.projectId, runId, constraint ?? ""), enabled: lensWanted });
  const selectedCase = search.case;
  const worst = slice.data?.worstCases ?? [];
  const trace = useQuery({ ...traceQuery(ctx.projectId, runId, selectedCase ?? ""), enabled: !!selectedCase && search.tab === "cases" });
  const mapWanted = !!run && (search.tab === "flow" || search.tab === "why");
  const flowGlobal = useQuery({ ...flowQuery(ctx.projectId, runId, { filter: search.filter }), enabled: mapWanted });
  const flowSlice = useQuery({ ...flowQuery(ctx.projectId, runId, { slicing, sliceKey, filter: search.filter }), enabled: mapWanted && !!slicing });
  const focused = useQuery({ ...flowFocusedQuery(ctx.projectId, runId, { slicing, sliceKey, focus: search.activity ?? "", filter }), enabled: mapWanted && !!search.activity });
  const preview = useQuery({ ...filterPreviewQuery(ctx.projectId, runId, filter), enabled: !!run && !!filter });
  // The first page of the list: it drops the part of the name every group shares, and it is where the rank's
  // population comes from. One run, one population (R3-09): the list said "57 groups" and this screen said
  // "1 of 69" for the same run, because the row's own `n_ranked` was computed under another `minCases`. The
  // rank is stated against the list the reader came from, and the row's own count only when there is no list.
  // the same request the ranked list makes, `minCases` included, or the two screens would count two
  // populations and print two different totals for one run
  const page1 = useQuery({ ...backlogQuery(ctx.projectId, runId, { slicing, view, sort: "-stable_PI", page: 1, pageSize: 10 }), enabled: !!run && !!slicing });
  const shared = useMemo(() => sharedKeyValues(page1.data?.rows ?? []), [page1.data]);
  const ranked = page1.data?.total;
  // the run's uncalibrated expectations, so a driver that separates no group is flagged here too
  const manifest = useQuery({ ...runManifestQuery(ctx.projectId, runId), enabled: !!run });
  const uncalibrated = useMemo(() => new Map((manifest.data?.uncalibrated ?? []).map((u) => [u.id, u])), [manifest.data]);
  // the reasons and actions of the seventh step, so the Why screen's "typical causes" block and the
  // "What can we do?" screen read one source (R3-01, RK-7)
  const actAnswer = useQuery({ ...whatCanWeDoQuery(ctx.projectId, runId, { slicing, sliceKey, view }), enabled: !!run && !!slicing && search.tab === "why" });
  const [highlight, setHighlight] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const findings = useFindingStore((s) => s.findings);
  const existingFinding = findings[findingId(runId, slicing, sliceKey)];

  const setTab = (tab: SliceTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectCase = (c: WorstCase) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "cases", case: c.caseId }) });
  const changeFilter = useCallback(
    (next: Filter | undefined) => {
      const added = addedClauses(filter, next);
      if (added.length) setPendingAdd({ key: serializeFilter(next) ?? "", text: added.map((c) => describeClause(c)).join("; ") });
      void navigate({ to: ".", search: (s) => ({ ...s, filter: serializeFilter(next), activity: next ? s.activity : undefined }) });
    },
    [filter, navigate],
  );
  // the announcement names what it counted: "234,479 of 251,734 purchase order items remain", never a bare
  // pair of numbers — the reader hears it without seeing the screen (§2.4)
  const announcedNoun = slice.data?.row.case_noun ?? ctx.caseTable?.readiness?.caseNoun ?? "cases";
  const announcement =
    pendingAdd && preview.data && (serializeFilter(filter) ?? "") === pendingAdd.key
      ? `Filter added: ${pendingAdd.text} — ${fmtInt(preview.data.cases_in)} of ${fmtInt(preview.data.cases_in + preview.data.cases_out)} ${announcedNoun} remain.`
      : undefined;

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

  const label = slice.data?.row ? groupLabel(slice.data.row, shared) : undefined;
  const href = `/p/${ctx.projectId}/runs/${runId}/slices/${encodeURIComponent(sliceKey)}?slicing=${encodeURIComponent(slicing)}${view ? `&view=${encodeURIComponent(view)}` : ""}`;
  useEffect(() => {
    if (label) setLastSlice(href, label);
  }, [label, href, setLastSlice]);

  if (!run) {
    return ctx.isLoading ? <LoadingBlock rows={8} /> : <EmptyState title="This run does not exist in this workspace." reason={`No group can be opened for ${runId}; the ribbon stays on the project's latest run.`} action={{ label: "Go to Runs", to: "/p/$projectId/runs", params: { projectId: ctx.projectId } }} />;
  }

  const backHref = { href: `/p/${ctx.projectId}/runs/${runId}/backlog?slicing=${encodeURIComponent(slicing)}${view ? `&view=${encodeURIComponent(view)}` : ""}`, label: plain ? "Where is it worst?" : "Backlog" };

  // R3-12: the reason screen ends on one sentence with one way out when the address carries a filter this
  // run does not understand
  if (slice.isError) {
    return (
      <ErrorBlock
        error={slice.error}
        retry={() => void slice.refetch()}
        action={
          filter
            ? { label: "Open this group without the filter", onClick: () => void navigate({ to: ".", search: (x) => ({ ...x, filter: undefined, fh: undefined }) }) }
            : { label: "Back to the ranked list", to: "/p/$projectId/runs/$runId/backlog" as const, params: { projectId: ctx.projectId, runId }, search: { slicing, view } }
        }
      />
    );
  }

  return (
    <QueryState query={slice} rows={8}>
      {(detail: SliceDetail) => {
        const row = detail.row as BacklogRowC2 | undefined;
        if (!row) return <EmptyState title="Group not found" reason="The group is not part of this run and grouping." />;
        const c2 = detail as SliceDetailC2;
        const name = groupLabel(row, shared);
        const noun = plain ? (row.case_noun ?? "cases") : "cases";
        const fmt = { num: fmtNum, int: fmtInt };
        const params = { globalMean: row.global_mean ?? row.mean_score + row.gap, gamma: run.gamma ?? 20, view, minCases: run.minCases ?? 1 };
        const validation = (detail.validation ?? {}) as Validation;
        const top = drivers.filter((d) => d.delta_gap > 0).slice(0, 3);
        const area = row.dominant_layer_name ?? layerNames[row.dominant_layer ?? ""];
        const caveats = c2.caveats ?? row.caveats;
        const refs = c2.guidance_refs;
        const plainOf = (id: string, fallback?: string) => refs?.find((g) => g.kind === "constraint" && g.id === id)?.plain_name ?? contrast.find((c) => c.constraint === id)?.plain ?? headroomRows.find((h) => h.constraint === id)?.plain ?? fallback ?? plainConstraint(drivers.find((d) => d.constraint === id) ?? { constraint: id });
        const missedOf = (id: string) => (refs?.find((g) => g.kind === "constraint" && g.id === id) as { missed_label?: string | null } | undefined)?.missed_label ?? undefined;
        const missed = missedPhrase(row, refs);
        const topShare = top[0]?.share_of_shortfall ?? (row.gap > 0 && top[0] ? top[0].delta_gap / row.gap : undefined);
        const comparison = plain ? comparisonSentence({ ...row, comparison: c2.comparison ?? row.comparison ?? contrastSentence(contrast.find((c) => c.constraint === top[0]?.constraint), comparisons.find((c) => c.constraint === top[0]?.constraint), noun) ?? null }) : (c2.comparison ?? row.comparison ?? undefined);
        const subgroups = tableRecords<{ attribute: string; value: string; cases: number; share: number }>(c2.subgroups);
        const flowMeta = (flowSlice.data?.meta ?? {}) as { constraints?: FlowConstraintMeta[] };
        const constraintsOfActivity = (id: string) => (flowMeta.constraints ?? []).filter((c) => [...(c.description?.activities ?? []), ...(c.description?.a ?? []), ...(c.description?.b ?? [])].includes(id)).map((c) => c.description?.id).filter((x): x is string => !!x);
        // the leading expectation of the card and of the reason screen must be the same one (R3-04): the
        // answer's own first driver wins, and the block says so when the two disagree
        const actDriver = (actAnswer.data?.drivers ?? []).find((d) => d.constraint_id === top[0]?.constraint) ?? actAnswer.data?.drivers?.[0];
        const actReasons = (actDriver?.usual_reasons ?? []).slice(0, 2);
        const topContrast = contrast.find((c) => c.constraint === constraint);
        const lensTitle = constraint ? plainOf(constraint) : "";
        const unitLabel = constraint ? `${UNIT_WORD[dist.data?.unit ?? topContrast?.unit ?? ""] ?? dist.data?.unit ?? ""} · ${lensTitle}` : undefined;
        const firstCaveat = (caveats ?? []).filter((c) => c.share === null || c.share === undefined || c.share > 0.005)[0];
        const mapProps = {
          graph: flowSlice.data,
          baseline: flowGlobal.data,
          filter,
          preview: preview.data,
          onFilterChange: changeFilter,
          chips: false,
          focus: search.activity ?? null,
          onFocusChange: (a: string | undefined) => void navigate({ to: ".", search: (s) => ({ ...s, activity: a }) }),
          paths: focused.data?.paths ?? undefined,
          highlight: topDriverActivities,
          plainOf: (id: string) => plainOf(id),
          noun,
          announce: announcement,
          frame: "panel" as const,
          // the Why screen's map is the same instrument in a smaller frame (§3.13): it keeps its legend
          legendOpen: true,
          full: mapFull,
          onFullChange: setMapFull,
          render: mapRender,
          onRenderChange: setMapRender,
          onAction: (a: { id: string; ids: string[] }) => {
            if (a.id === "lens") {
              const c = constraintsOfActivity(a.ids[0] ?? "").find((id) => lensConstraints.includes(id)) ?? lensConstraints[0];
              void navigate({ to: ".", search: (s) => ({ ...s, tab: "compared", constraint: c }) });
            }
            if (a.id === "worst-cases") void navigate({ to: ".", search: (s) => ({ ...s, tab: "cases" }) });
          },
        };
        // §3.11: a group whose map cannot be drawn is told so in one sentence with one next step. The
        // answer's status code and the server's own phrase never reach the screen.
        const noMap = flowSlice.isError && flowSlice.error instanceof ApiError && flowSlice.error.status === 404;
        const mapBlock = (height: number, embedded: boolean) => (
          <>
            {(flowSlice.isPending || flowGlobal.isPending) && <LoadingBlock rows={6} />}
            {noMap && (
              <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm" data-testid="no-map">
                <p className="reading text-text">No map can be drawn for {name}.</p>
                <p className="reading mt-1 text-text-muted">The run has no event of these {noun} left after the current chips, so there is no path to draw.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {filter?.and.length ? (
                    <Button variant="outline" size="sm" onClick={() => changeFilter(undefined)}>
                      Remove the chips
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => setTab("why")}>
                    Read the reasons instead
                  </Button>
                </div>
              </div>
            )}
            {/* R3-12: a filter the run does not understand ends this block on one sentence with one way out */}
            {flowSlice.isError && !noMap && (
              <ErrorBlock
                error={flowSlice.error}
                retry={() => void flowSlice.refetch()}
                action={filter ? { label: "Open this group without the filter", onClick: () => changeFilter(undefined) } : undefined}
              />
            )}
            {flowSlice.data && (
              <Suspense fallback={<LoadingBlock rows={6} />}>
                <FlowMap {...mapProps} graph={flowSlice.data} height={height} title={`Process map of ${name} with the expectations drawn on it`} />
              </Suspense>
            )}
            {embedded && (
              <button type="button" className="mt-2 self-end text-sm text-accent-text underline" onClick={() => setTab("flow")}>
                Open the full map →
              </button>
            )}
          </>
        );
        const lens = constraint && dist.data ? (
          <DistributionLens
            key={constraint}
            distribution={dist.data}
            rest={distAll.data}
            constraintId={constraint}
            mode={plain ? "plain" : "method"}
            sliders="method"
            title={lensTitle}
            noun={noun}
            groupName={name}
            unitLabel={plain ? unitLabel : undefined}
            sentences={plain ? lensSentences(topContrast, lensTitle, name, noun, dist.data.threshold, dist.data.unit ?? undefined) : undefined}
            height={search.tab === "why" ? 240 : 320}
          />
        ) : null;
        return (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
                <BackControl fallback={backHref} className="normal-case tracking-normal" />
                <span>{plain ? "Why?" : "Slice"}</span>
                {run.scope?.flow_type && <Badge variant="outline">{run.scope.flow_type} flow only</Badge>}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold" title={groupLabel(row)}>
                  <span>{name}</span>
                  <HowToReadToggle id="why" />
                </h1>
                <div className="flex flex-wrap items-center gap-3" data-no-capture>
                  <span className="flex items-center gap-2 text-sm">
                    <KindBadge kind={row.kind} hotspotType={row.hotspot_type} short={plain} className="text-sm" />
                    <ConfidenceMark value={row.stability} words className="text-sm" title={row.stability_reason ?? undefined} />
                  </span>
                  <FreezeButton projectId={ctx.projectId} screen="why" context={{ run_id: runId, slicing, view, slice_key: row.key, filters: filter ?? null, scope: run.scope ?? null }} data={{ row, drivers: top, contrast, validation }} defaultTitle={`${name} — ${missed ?? "why"}`} />
                </div>
              </div>
              <p className="reading headline text-text" data-testid="why-sentence" title={plain && row.gap > 0 ? distanceSentence(row, true) : undefined}>
                <strong className="tnum">{fmtInt(row.n_cases)}</strong> {noun} ·{" "}
                {row.gap > 0 ? (
                  plain ? (
                    <>
                      <strong className="tnum">{belowExpectation(row)}</strong> below expectation
                    </>
                  ) : (
                    distanceSentence(row, false)
                  )
                ) : (
                  "at or above the overall score"
                )}
                {row.gap > 0 && missed ? (
                  <>
                    {" · "}
                    {plain ? missed : area}
                    <WhatDoesThisMean
                      className="ml-1.5"
                      nodeId={refs?.find((g) => g.kind === "constraint" && g.id === row.top_constraint)?.hub_node}
                      kind={row.top_constraint ? "constraint" : "layer"}
                      entryId={row.top_constraint ?? row.dominant_layer ?? ""}
                      label={plain ? missed : area}
                    />
                    {row.top_constraint_share !== null && row.top_constraint_share !== undefined ? (
                      <>
                        {" "}
                        in <strong className="tnum">{fmtPct(row.top_constraint_share, 0)}</strong> of them
                      </>
                    ) : null}
                  </>
                ) : null}
                {topShare !== undefined && topShare > 0 ? (
                  <>
                    ; the shortfall is <strong className="tnum">{fmtPct(Math.min(topShare, 9.99), 0)}</strong> this one expectation
                  </>
                ) : null}
                .
              </p>
              {comparison && (
                <p className="reading text-base text-text-muted" data-testid="why-reason">
                  {comparison}
                </p>
              )}
              <div className="flex flex-wrap items-stretch gap-2 text-sm" data-testid="why-strip">
                <div className="flex min-w-[120px] flex-col rounded-md border border-border bg-surface px-3 py-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-subtle">{plain ? "priority" : t("stable_PI")}</span>
                  <span className="tnum font-semibold">{fmtNum(row.stable_PI, 0)}</span>
                </div>
                <div className="flex min-w-[120px] flex-col rounded-md border border-border bg-surface px-3 py-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-subtle">rank</span>
                  <span className="tnum font-semibold" title={ranked !== undefined && row.n_ranked && row.n_ranked !== ranked ? `${fmtInt(ranked)} groups are ranked at the list's smallest group size; the run scored ${fmtInt(row.n_ranked)}` : undefined}>
                    {row.rank}
                    {ranked !== undefined ? ` of ${fmtInt(ranked)}` : row.n_ranked ? ` of ${fmtInt(row.n_ranked)}` : ""}
                  </span>
                </div>
                <div className="flex min-w-[160px] flex-col rounded-md border border-border bg-surface px-3 py-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-subtle">{plain ? "average met" : t("mean_score")}</span>
                  <span className="tnum font-semibold">
                    {fmtPct(row.mean_score, 0)}
                    {row.global_mean !== null && row.global_mean !== undefined ? <span className="font-normal text-text-muted"> (everyone {fmtPct(row.global_mean, 0)})</span> : null}
                  </span>
                </div>
                <div className="flex min-w-[160px] flex-col justify-center rounded-md border border-border bg-surface px-3 py-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-subtle">data caveats</span>
                  {firstCaveat ? <CaveatChips caveats={[firstCaveat]} max={1} /> : <span className="text-text-muted">no data caveats</span>}
                </div>
                <button type="button" className="self-center text-xs text-text-muted underline" aria-expanded={showMetrics} onClick={() => setShowMetrics((v) => !v)}>
                  {showMetrics ? "less ▴" : "more ▾"}
                </button>
              </div>
              {(showMetrics || !plain) && (
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6" data-testid="method-strip">
                  <Metric label={t("n_cases")} value={fmtInt(row.n_cases)} explain={backlogExplain("n_cases", row, params, fmt)} size="sm" />
                  <Metric label={t("mean_score")} value={fmtNum(row.mean_score, 3)} explain={backlogExplain("mean_score", row, params, fmt)} size="sm" />
                  <Metric label={t("gap")} value={fmtNum(row.gap, 4)} explain={backlogExplain("gap", row, params, fmt)} size="sm" />
                  <Metric label={t("stable_gap")} value={fmtNum(row.stable_gap, 4)} explain={backlogExplain("stable_gap", row, params, fmt)} size="sm" />
                  <Metric label={t("PI")} value={fmtNum(row.PI, 1)} explain={backlogExplain("PI", row, params, fmt)} size="sm" />
                  <Metric label={t("stable_PI")} value={fmtNum(row.stable_PI, 1)} explain={backlogExplain("stable_PI", row, params, fmt)} size="sm" sub={row.PI_lower !== undefined && row.PI_lower !== null ? `${t("PI_lower")} ${fmtNum(row.PI_lower, 1)} · γ = ${fmtNum(run.gamma ?? 20, 0)}` : `γ = ${fmtNum(run.gamma ?? 20, 0)}`} />
                </div>
              )}
              <HowToRead id="why">
                One group, its reasons, one question per tab. <strong>Why</strong> lists the expectations behind the shortfall in plain words, with the comparison against everyone else for the top one and the group's process map. <strong>Compared</strong> shows one expectation
                in real units, <strong>Flow</strong> the full map (click an activity for its card; the filters travel with the address and scope every tab), <strong>Cases</strong> what kind of cases carry it, <strong>Data trust</strong> what could distort the reading,{" "}
                <strong>Gain</strong> what would be won. Your reading goes into the decision pane.
              </HowToRead>
              <FilterChipsRow filter={filter} preview={preview.data} noun={noun} onChange={changeFilter} />
              <p className="sr-only" aria-live="polite" data-testid="filter-announcement">
                {announcement}
              </p>
            </header>

            <div className={search.tab === "flow" ? "" : "xl:hidden"}>
              <Button variant="outline" size="sm" aria-expanded={paneOpen} onClick={() => setPaneOpen((v) => !v)}>
                Decision{existingFinding?.disposition ? ` · ${existingFinding.disposition.replace("_", " ")}` : ""}
              </Button>
            </div>

            <div className={cn("grid gap-5", search.tab === "flow" ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]")}>
              <div className="min-w-0">
                <Tabs value={search.tab} onValueChange={(v) => setTab(v as SliceTab)}>
                  <TabsList aria-label="Reasons" underline>
                    <TabsTrigger value="why">Why</TabsTrigger>
                    <TabsTrigger value="compared">Compared</TabsTrigger>
                    <TabsTrigger value="flow">Flow</TabsTrigger>
                    <TabsTrigger value="cases">Cases</TabsTrigger>
                    <TabsTrigger value="trust">Data trust</TabsTrigger>
                    <TabsTrigger value="gain">Gain</TabsTrigger>
                  </TabsList>

                  <TabsContent value="why" className="flex flex-col gap-4">
                    <Card>
                      <CardTitle>{plain ? "Which expectations are missed" : "Top drivers"}</CardTitle>
                      {/* never a borrowed reading (R2-05): a group without a scored case says so, and a group whose
                          header names a missed expectation never reads "no expectation is missed more here" alone */}
                      {top.length === 0 && (
                        <p className="reading text-sm text-text-muted" data-testid="no-drivers">
                          {drivers.length === 0
                            ? `No expectation was scored for these ${noun}, so nothing can be compared here. The data caveats below say what stands in the way.`
                            : missed
                              ? `${missed.charAt(0).toUpperCase()}${missed.slice(1)} is what these ${noun} miss most${row.top_constraint_share !== null && row.top_constraint_share !== undefined ? ` (${fmtPct(row.top_constraint_share, 0)} of them)` : ""}; still, no expectation is missed more here than in the whole log.`
                              : "No expectation is missed more here than in the whole log."}
                        </p>
                      )}
                      <ol className="flex flex-col gap-4" data-testid="top-drivers">
                        {top.map((d) => {
                          const share = d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0);
                          return (
                            <li key={d.constraint} className="flex flex-col gap-1.5">
                              <p className="reading text-base">
                                <strong title={plain ? `${plainConstraint(d)} (${d.constraint})` : plainConstraint(d)}>{plain ? plainOf(d.constraint) : plainConstraint(d)}</strong>
                                <WhatDoesThisMean className="ml-1.5" nodeId={refs?.find((g) => g.kind === "constraint" && g.id === d.constraint)?.hub_node} kind="constraint" entryId={d.constraint} label={plainOf(d.constraint)} />
                                {!plain && <span className="ml-2 font-mono text-[11px] text-text-subtle">{d.constraint}</span>}
                                {/* an expectation almost every case misses separates no group  */}
                                {uncalibrated.has(d.constraint) && <CalibrationChip className="ml-2 align-middle" text={uncalibrated.get(d.constraint)?.text} />}
                              </p>
                              <p className="text-sm text-text-muted">
                                missed in <strong className="tnum text-text">{fmtPct(d.share_violated, 0)}</strong> of these {noun} · explains <strong className="tnum text-text">{fmtPct(share, 0)}</strong> of the shortfall
                                {plain && missedOf(d.constraint) ? <span className="text-text-subtle"> · {missedOf(d.constraint)}</span> : null}
                              </p>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.max(0, Math.min(1, share))} aria-label={`${plainOf(d.constraint)} explains ${fmtPct(share, 0)} of the shortfall`}>
                                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <button type="button" className="mt-4 text-sm text-accent-text underline" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                        {showAll ? "hide the full picture" : `Show all ${drivers.length} expectations ▾`}
                      </button>
                    </Card>
                    {showAll && (
                      <>
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
                              {[...drivers]
                                .sort((a, b) => b.delta_gap - a.delta_gap)
                                .map((d) => (
                                  <tr key={d.constraint} className={cn(highlight === d.constraint && "bg-selection", d.delta_gap < 0 && "text-text-muted")} onMouseEnter={() => setHighlight(d.constraint)} onMouseLeave={() => setHighlight(undefined)}>
                                    <Td className="text-xs" title={plain ? `${plainConstraint(d)} (${d.constraint})` : d.constraint}>
                                      {plain ? plainOf(d.constraint) : d.constraint}
                                    </Td>
                                    <Td>{plain ? (layerNames[d.layer] ?? d.layer) : d.layer}</Td>
                                    {!plain && (
                                      <Td>
                                        <Badge variant="outline">{d.type}</Badge>
                                      </Td>
                                    )}
                                    <Td numeric>{fmtPct(d.share_of_shortfall ?? (row.gap > 0 ? d.delta_gap / row.gap : 0), 0)}</Td>
                                    {!plain && <Td numeric>{fmtNum(d.delta_gap, 4)}</Td>}
                                    <Td numeric>{fmtPct(d.share_violated, 1)}</Td>
                                    <Td numeric>{fmtPct(d.share_in_scope, 0)}</Td>
                                  </tr>
                                ))}
                            </tbody>
                          </Table>
                          <p className="mt-2 text-xs text-text-subtle">Expectations below zero are met better than everyone else here; shares can add to more than 100 % for that reason.</p>
                        </Card>
                        <Suspense fallback={<LoadingBlock rows={6} />}>
                          <Charts drivers={detail.drivers} layers={detail.layers} penaltyMass={detail.penaltyMass} penaltyMassBy={detail.penaltyMassBy ?? undefined} layerNames={layerNames} gap={row.gap} plainOf={(id: string) => plainOf(id)} onSelect={(c: string) => void navigate({ to: ".", search: (s) => ({ ...s, tab: "compared", constraint: c }) })} />
                        </Suspense>
                      </>
                    )}
                    {constraint && (
                      <Card data-testid="why-lens">
                        <CardTitle>Compared with everyone else, for the top expectation</CardTitle>
                        {dist.isPending && <LoadingBlock rows={4} />}
                        {dist.isError && <ErrorBlock error={dist.error} />}
                        {lens}
                        <button type="button" className="mt-2 text-sm text-accent-text underline" onClick={() => setTab("compared")}>
                          Open the full comparison →
                        </button>
                      </Card>
                    )}
                    <Card className="flex flex-col" data-testid="why-map">
                      <CardTitle>Where in the flow</CardTitle>
                      {mapBlock(400, true)}
                    </Card>
                    <Card data-testid="why-caveats">
                      <CardTitle>Can the data be trusted?</CardTitle>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {(caveats ?? []).filter((c) => c.share === null || c.share === undefined || c.share > 0.005).slice(0, 2).map((c) => (
                          <li key={c.id} className="flex items-start gap-2">
                            <span aria-hidden className={c.status === "fail" ? "text-danger" : "text-warning"}>
                              ⚠
                            </span>
                            <span className="reading text-text-muted">{c.text}</span>
                          </li>
                        ))}
                        {(caveats ?? []).length === 0 && (
                          <li className="flex items-start gap-2">
                            <span aria-hidden className="text-success">✓</span>
                            <span className="text-text-muted">No data caveat touches this group.</span>
                          </li>
                        )}
                      </ul>
                      <button type="button" className="mt-2 text-sm text-accent-text underline" onClick={() => setTab("trust")}>
                        All checks →
                      </button>
                    </Card>
                    {/* R3-01: the first two candidate reasons of the leading expectation, drawn from the same hub
                        pages as "What can we do?", with the way to that screen. */}
                    <Card data-testid="typical-causes">
                      <CardTitle>Typical causes for this pattern</CardTitle>
                      {actAnswer.isPending && <LoadingBlock rows={3} />}
                      {actReasons.length > 0 ? (
                        <>
                          <p className="text-xs text-text-subtle">Candidates to check, not findings — for {actDriver?.plain_name ?? plainOf(top[0]?.constraint ?? "")}.</p>
                          <ReasonList reasons={actReasons} className="mt-2" />
                        </>
                      ) : (
                        !actAnswer.isPending && (
                          <p className="reading text-sm text-text-muted">
                            This run's process pack carries no candidate reasons for the expectations of this group. What can we do? still lists the possible gain and the actions.
                          </p>
                        )
                      )}
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => void navigate({ to: "/p/$projectId/runs/$runId/slices/$sliceKey/act", params: { projectId: ctx.projectId, runId, sliceKey }, search: { slicing, view, constraint: top[0]?.constraint } })}>
                        What can we do? →
                      </Button>
                    </Card>
                  </TabsContent>

                  <TabsContent value="compared">
                    <Card>
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <CardTitle className="mb-0">{plain ? "Compared with everyone else" : "Distribution of the raw signal · slice"}</CardTitle>
                        <Select value={constraint ?? ""} onValueChange={(c) => void navigate({ to: ".", search: (s) => ({ ...s, constraint: c }) })}>
                          <SelectTrigger className={cn("w-80 text-xs", !plain && "font-mono")} aria-label={plain ? "expectation" : t("constraint")}>
                            <SelectValue placeholder={plain ? "expectation" : t("constraint")} />
                          </SelectTrigger>
                          <SelectContent>
                            {lensConstraints.map((c) => (
                              <SelectItem key={c} value={c}>
                                <span className={cn("text-xs", !plain && "font-mono")}>{plain ? plainOf(c) : c}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {!constraint && <p className="text-sm text-text-muted">No expectation with a threshold is missed in this group.</p>}
                      {constraint && dist.isPending && <LoadingBlock rows={5} />}
                      {constraint && dist.isError && <ErrorBlock error={dist.error} />}
                      {lens}
                      <p className="mt-3 text-xs text-text-muted">
                        {plain ? "The expectation line and the tolerance band come from the norm." : "Changing ϑ or W here is exploration."} Committing a threshold happens on the{" "}
                        <Link className="text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: run.normVersionId }} search={{ tab: "constraints", constraint }}>
                          norm's calibration lens
                        </Link>{" "}
                        (Recalibrate in the norm →) and asks for a note.
                      </p>
                    </Card>
                  </TabsContent>

                  <TabsContent value="flow">
                    <Card className="flex flex-col">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="mb-0">
                          <Term id="flow" primaryOnly={plain}>
                            {plain ? `Where in the flow · ${name}` : "Process map"}
                          </Term>
                        </CardTitle>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const scoped = addClause(filter, { kind: "slice", slicing, key: sliceKey });
                            void navigate({
                              to: "/p/$projectId/runs/$runId/flow",
                              params: { projectId: ctx.projectId, runId },
                              search: { view, slicing, render: "map" as const, filter: serializeFilter(scoped), fh: filterHash(scoped) } as never,
                            });
                          }}
                        >
                          Open full →
                        </Button>
                      </div>
                      {mapBlock(520, false)}
                      {topDriverActivities.length > 0 && <p className="mt-2 text-xs text-text-muted">Tinted activities belong to the top expectations behind the shortfall.</p>}
                    </Card>
                  </TabsContent>

                  <TabsContent value="cases" className="flex flex-col gap-4">
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
                    <Card>
                      <CardTitle>
                        <Term id="worst_cases" primaryOnly={plain} />
                      </CardTitle>
                      <Table data-testid="worst-cases">
                        <thead>
                          <tr>
                            <Th>case</Th>
                            <Th numeric>{plain ? "rules met" : <Term id="score">score</Term>}</Th>
                            <Th numeric>{plain ? "missed" : "violated"}</Th>
                            <Th>{plain ? "missed most" : <Term id="constraint">expectations missed</Term>}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {worst.slice(0, 10).map((c) => {
                            const violated = c.violated ?? [];
                            return (
                              <tr key={c.caseId} className={cn("cursor-pointer hover:bg-surface-sunken", selectedCase === c.caseId && "bg-selection")} onClick={() => selectCase(c)}>
                                <Td>
                                  <button type="button" className="font-mono text-xs text-accent-text underline" onClick={() => selectCase(c)} aria-pressed={selectedCase === c.caseId}>
                                    {c.caseId}
                                  </button>
                                </Td>
                                <Td numeric>{plain ? fmtPct(c.score, 0) : fmtNum(c.score, 3)}</Td>
                                <Td numeric>{violated.length}</Td>
                                <Td className="text-xs">
                                  {plain ? (
                                    <span>
                                      {violated
                                        .slice(0, 2)
                                        .map((v) => plainOf(v))
                                        .join(" · ")}
                                      {violated.length > 2 && (
                                        <details className="inline">
                                          <summary className="ml-1 inline cursor-pointer text-text-muted">+{violated.length - 2} more</summary>
                                          <span className="text-text-muted"> {violated.slice(2).map((v) => plainOf(v)).join(" · ")}</span>
                                        </details>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="flex flex-wrap gap-1">
                                      {violated.map((v) => (
                                        <Badge key={v} variant="danger" className="font-mono" title={v}>
                                          <span aria-hidden>▲</span>
                                          {v}
                                        </Badge>
                                      ))}
                                    </span>
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </Card>
                    <Card>
                      <CardTitle>
                        <Term id="trace" primaryOnly={plain} />
                      </CardTitle>
                      {!selectedCase && <p className="text-sm text-text-muted">Select a case to see what happened in it, with the expectations it missed marked.</p>}
                      {selectedCase && trace.isPending && <LoadingBlock rows={4} />}
                      {selectedCase && trace.isError && <ErrorBlock error={trace.error} />}
                      {selectedCase && trace.data && <TraceTimeline trace={trace.data} highlight={highlight} onHighlight={setHighlight} plainOf={plain ? (id: string) => plainOf(id) : undefined} />}
                    </Card>
                  </TabsContent>

                  <TabsContent value="trust">
                    <Card>
                      <CardTitle>{plain ? "Can the data be trusted?" : "Validation row"}</CardTitle>
                      {/*
                        P1-10 — one gate, one verdict, one list.

                        This tab drew the checks twice: a summary built here from the validation row, with
                        thresholds of its own, above the decision list the server computes. The same check on
                        the same group read "○ pending" in one block and "✓ passed" in the other. The list
                        below is the only one, and it is the one that can be decided.
                      */}
                      <CaveatChips caveats={caveats} className="mt-3" max={6} />
                      {/* R3-03: the gates of this group with pass · fail · waive, and the hypothesis they gate */}
                      <div className="mt-4 border-t border-border pt-4">
                        <CardTitle>Checks before acting, and what you want to test</CardTitle>
                        <GatesBlock
                          projectId={ctx.projectId}
                          runId={runId}
                          slicing={slicing}
                          sliceKey={sliceKey}
                          view={view}
                          constraints={drivers.filter((d) => d.delta_gap > 0).map((d) => ({ id: d.constraint, label: plainOf(d.constraint) }))}
                        />
                      </div>
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-text-muted">The four numbers</summary>
                        <dl className="tnum mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                          <dt className="text-text-muted">{plain ? "still open at the end of the data" : <Term id="censoring" primaryOnly />}</dt>
                          <dd>{fmtPct(validation.censored_share, 1)}</dd>
                          <dt className="text-text-muted">{plain ? "duplicated events" : <Term id="replication" primaryOnly />}</dt>
                          <dd>{fmtPct(validation.replicated_share, 1)}</dd>
                          <dt className="text-text-muted">{plain ? "shortfall kept when open cases are removed" : "gap retained"}</dt>
                          <dd>{fmtPct(validation.retained, 0)}</dd>
                          <dt className="text-text-muted">{plain ? "shortfall per case among closed cases" : "stable gap kept"}</dt>
                          <dd>{fmtPct(validation.stable_gap_kept, 1)}</dd>
                          {!plain && (
                            <>
                              <dt className="text-text-muted">reading</dt>
                              <dd>{validation.reading ?? "–"}</dd>
                            </>
                          )}
                        </dl>
                      </details>
                    </Card>
                  </TabsContent>

                  <TabsContent value="gain">
                    <Card>
                      <CardTitle>
                        <Term id="headroom" primaryOnly={plain}>
                          {plain ? "Possible gain" : "Headroom under the norm"}
                        </Term>
                      </CardTitle>
                      {headroomRows.some((h) => h.gain_points !== null && h.gain_points !== undefined) ? (
                        <>
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
                                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, h.gain_percent ?? 0))}%` }} />
                                  </div>
                                </li>
                              ))}
                          </ol>
                          <p className="mt-3 text-xs text-text-subtle">Each gain is computed on its own, as if that one expectation were met and nothing else changed; the gains do not add up.</p>
                        </>
                      ) : (
                        <p className="text-sm text-text-muted">The possible gain per expectation{area ? ` (starting with ${area})` : ""} arrives when the analytics have run for this run.</p>
                      )}
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
              <div className={cn("flex flex-col gap-3", paneOpen ? "block" : search.tab === "flow" ? "hidden" : "hidden xl:block")}>
                <DecisionPane projectId={ctx.projectId} runId={runId} slicing={slicing} row={row} layerName={area} missed={missed} focus={search.focus === "finding"} onSaved={() => setPaneOpen(false)} />
                {existingFinding && (
                  <NextStep
                    label="Freeze this screen for the notebook"
                    because="your reading is saved; a snapshot with a note keeps it for the report"
                    onClick={() => document.querySelector<HTMLElement>("[data-freeze-trigger]")?.click()}
                    alternative={{
                      label: "Open What can we do?",
                      onClick: () => void navigate({ to: "/p/$projectId/runs/$runId/slices/$sliceKey/act", params: { projectId: ctx.projectId, runId, sliceKey }, search: { slicing, view } }),
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}


