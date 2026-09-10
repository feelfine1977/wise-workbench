import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { boardRoute } from "@/app/router";
import { BACKLOG_DEFAULTS, type BoardSearch, type Breakdown } from "@/app/search";
import { filterPreviewQuery, uncalibratedById, type BacklogParams as BacklogParamsC2 } from "@/lib/api/exploration";
import type { Filter, FilterClause, SliceClause, TimeClause } from "@/lib/api/filter-types";
import type { RunWithScope as RunC2 } from "@/lib/api/runs";
import { distributionFilteredQuery } from "@/lib/api/analytics";
import { facetsQuery, kpisQuery, periodWindow } from "@/lib/api/board";
import { CalibrationChip } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { FilterChipsRow } from "@/components/guide/FilterChipsRow";
import { FreezeButton } from "@/components/guide/Freeze";
import { useFilterFeedback } from "@/components/flow/useFilterFeedback";
import { EmptyState, ErrorBlock, LoadingBlock, errorReading } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clauseForPeriod, clauseForValue, clauseKey, filterHash, parseFilter, periodLabel, serializeFilter, toggleClause } from "@/lib/filter";
import { fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { backlogQuery } from "@/lib/api/exploration";
import { flowQuery } from "@/lib/api/flow";
import { filterCount, groupLabel, groupingLabel, sharedKeyValues } from "@/lib/sentences";
import { useNavStore } from "@/lib/stores/nav";
import { useSceneStore } from "@/lib/stores/scenes";
import { PANELS, Panel } from "./panel";
import { BreakdownBars, KpiTiles, RankedRows, barsOf, belowExpectationSentence } from "./panels";
import { StepHeader } from "../flow/StepHeader";

const FlowMap = lazy(() => import("@/components/flow/FlowMap"));

interface ConstraintMeta {
  description?: { id?: string; type?: string; layer?: string; description?: string };
  stats?: { violationShare?: number };
}

const LENS_TYPES = new Set(["lag", "metric", "singularity", "balance"]);
const PANEL_COUNT = 6;

/**
 * The explore board (R3-O12, §4): one screen where the map and the numbers that explain it answer the same
 * selection. The four selectors, a click on the map, on a group, on a bar or beyond the expectation line all
 * write into one canonical filter; every panel reads it, the chips are its only representation, and the
 * address reproduces the board. Panels never move while numbers change: the bars keep the unfiltered order,
 * the bin edges and the map's positions come from the unfiltered population, and every panel shows its
 * *all items* twin.
 */
export default function BoardPage() {
  const ctx = useWorkbench();
  const { runId } = boardRoute.useParams();
  const search = boardRoute.useSearch();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  const run = ctx.runs.find((r) => r.id === runId) as RunC2 | undefined;
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? undefined;
  const view = search.view ?? run?.views?.[0];
  const filter = useMemo(() => parseFilter(search.filter), [search.filter]);
  const setSubline = useNavStore((s) => s.setSubline);
  const saveBoard = useSceneStore((s) => s.saveBoard);
  const boards = useSceneStore((s) => s.boards);
  const [saveOpen, setSaveOpen] = useState(false);
  const [boardName, setBoardName] = useState("");

  const enabled = !!run && run.status === "done";
  /**
   * One run, one population (P1-12): the board counts the groups the ranked list counts.
   *
   * The board asked with the run's own `minCases` (one on this run) and the signals list with the twenty it
   * starts from, so one run read *10 of 30* on the board and *23 groups* on the list. The board now asks with
   * the same number, and a run scored with a larger one keeps it.
   */
  const minCases = Math.max(run?.minCases ?? 1, BACKLOG_DEFAULTS.minCases);
  const backlogParams = { slicing: slicing ?? "", view, gamma: run?.gamma ?? undefined, minCases, sort: "-stable_PI", page: 1, pageSize: 10 };
  const ranked = useQuery({ ...backlogQuery(ctx.projectId, runId, { ...backlogParams, filter: search.filter }), enabled: enabled && !!slicing });
  const rankedAll = useQuery({ ...backlogQuery(ctx.projectId, runId, { ...backlogParams, pageSize: 30 }), enabled: enabled && !!slicing });
  const flow = useQuery({ ...flowQuery(ctx.projectId, runId, { filter: search.filter }), enabled });
  const preview = useQuery({ ...filterPreviewQuery(ctx.projectId, runId, filter), enabled: enabled && !!filter });
  const kpiParams = { view, grouping: slicing, gamma: run?.gamma ?? undefined, minCases, openShare: openShareOf(ctx.caseTable?.readiness), caseNoun: (flow.data?.meta as { caseNoun?: string } | undefined)?.caseNoun };
  const kpis = useQuery({ ...kpisQuery(ctx.projectId, runId, { ...kpiParams, filter }), enabled });
  // the unfiltered twin of every tile: a filtered number is never shown without it (§4.7)
  const kpisAll = useQuery({ ...kpisQuery(ctx.projectId, runId, kpiParams), enabled });
  const facetParams = { by: search.breakdown as Breakdown, attribute: search.breakdown === "attribute" ? (search.attribute ?? defaultAttribute(run)) : undefined, view, gamma: run?.gamma ?? undefined, period: "quarter" as const, minCases: 1 };
  const facets = useQuery({ ...facetsQuery(ctx.projectId, runId, { ...facetParams, filter }), enabled });
  const facetsAll = useQuery({ ...facetsQuery(ctx.projectId, runId, facetParams), enabled });
  const flowTypes = useQuery({ ...facetsQuery(ctx.projectId, runId, { by: "flow_type", view }), enabled });
  const periods = useQuery({ ...facetsQuery(ctx.projectId, runId, { by: "period", view, period: "quarter" }), enabled });

  const graph = flow.data;
  const meta = (graph?.meta ?? {}) as { cases?: number; events?: number; caseNoun?: string; constraints?: ConstraintMeta[] };
  const noun = meta.caseNoun ?? ranked.data?.rows[0]?.case_noun ?? ctx.caseTable?.readiness?.caseNoun ?? "cases";
  const casesTotal = preview.data && filter ? preview.data.cases_in + preview.data.cases_out : (kpis.data?.casesTotal ?? meta.cases ?? 0);
  const casesIn = filter ? preview.data?.cases_in : (kpis.data?.cases ?? meta.cases ?? 0);
  const feedback = useFilterFeedback({ filter, casesIn, casesTotal, noun, panels: PANEL_COUNT });

  const areas = useMemo(() => {
    const byArea = new Map<string, { id: string; label: string; constraints: { id: string; type?: string; share: number }[] }>();
    for (const c of meta.constraints ?? []) {
      const layer = c.description?.layer;
      const id = c.description?.id;
      if (!layer || !id) continue;
      const entry = byArea.get(layer) ?? { id: layer, label: layer.replace(/^L\d+_/, "").replace(/_/g, " "), constraints: [] };
      entry.constraints.push({ id, type: c.description?.type, share: c.stats?.violationShare ?? 0 });
      byArea.set(layer, entry);
    }
    return [...byArea.values()];
  }, [meta.constraints]);

  const plainOf = useCallback(
    (id: string) => ((meta.constraints ?? []).find((c) => c.description?.id === id)?.description?.description ?? id).replace(/\.$/, ""),
    [meta.constraints],
  );

  // the expectation the distribution shows: the most-missed one of the chosen area, else of the run
  const constraint = useMemo(() => {
    const pool = (search.area ? areas.find((a) => a.id === search.area)?.constraints : areas.flatMap((a) => a.constraints)) ?? [];
    const withThreshold = pool.filter((c) => LENS_TYPES.has(c.type ?? ""));
    return [...(withThreshold.length ? withThreshold : pool)].sort((a, b) => b.share - a.share)[0]?.id;
  }, [areas, search.area]);
  const dist = useQuery({ ...distributionFilteredQuery(ctx.projectId, runId, constraint ?? "", { filter }), enabled: enabled && !!constraint });
  const distAll = useQuery({ ...distributionFilteredQuery(ctx.projectId, runId, constraint ?? "", {}), enabled: enabled && !!constraint && !!filter });

  // the board shows as the second line under the Flow step (§4.1)
  useEffect(() => {
    setSubline("Board");
    return () => setSubline(undefined);
  }, [setSubline]);

  const patch = useCallback((p: Partial<BoardSearch>) => void navigate({ to: ".", search: (s) => ({ ...(s as BoardSearch), ...p }) }), [navigate]);
  /**
   * The selection itself is refused, so the board has no numbers at all (P1-11).
   *
   * A filter the run cannot read is refused for every panel, and each of them drew the same sentence and the
   * same way out — three alerts on one screen — under four tiles that stayed on *the numbers of this
   * selection are being counted…*. One error of that kind puts the whole board in that state: it is said
   * once, and no number is printed beside it.
   */
  const boardError = [kpis, flow, ranked, dist, facets].map((q) => (q.isError ? q.error : undefined)).find((e) => e && errorReading(e).kind === "filter") ?? (kpis.isError ? kpis.error : undefined);
  const changeFilter = useCallback((next: Filter | undefined) => patch({ filter: serializeFilter(next), fh: filterHash(next) }), [patch]);
  const toggle = useCallback((clause: FilterClause) => changeFilter(toggleClause(filter, clause)), [changeFilter, filter]);
  /** The way out of a panel that a filter in the address broke (R3-12): the board without that filter. */
  const clearFilterAction = useMemo(() => (filter ? { label: "Open the board without the filter", onClick: () => changeFilter(undefined) } : undefined), [filter, changeFilter]);

  const flowTypeField = flowTypes.data?.field ?? "flow_type";
  const currentFlowType = valueOf(filter, flowTypeField);
  const currentPeriod = (filter?.and ?? []).find((c): c is TimeClause => c.kind === "time");
  const currentGroup = (filter?.and ?? []).find((c): c is SliceClause => c.kind === "slice");
  const shared = useMemo(() => sharedKeyValues(rankedAll.data?.rows ?? []), [rankedAll.data]);
  // an expectation whose threshold separates no group is flagged where the board names it
  const uncalibrated = uncalibratedById(rankedAll.data?.params as BacklogParamsC2 | undefined);

  if (!run) {
    return ctx.isLoading ? <LoadingBlock rows={8} /> : <EmptyState title="This run does not exist in this workspace." reason={`No board can be shown for ${runId}.`} action={{ label: "Go to Runs", to: "/p/$projectId/runs", params: { projectId: ctx.projectId } }} />;
  }
  if (run.status !== "done") {
    return <EmptyState title="Nothing scored yet, so there is nothing to explore." reason="The board reads a finished run: its groups, its flow and its numbers." action={{ label: "Open the run monitor", to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId } }} />;
  }

  const rows = ranked.data?.rows ?? [];
  const maxPI = rankedAll.data?.maxStablePI ?? Math.max(1, ...rows.map((r) => r.stable_PI));
  const top = rows[0];
  const scope = run.scope?.flow_type;
  const bars = barsOf(facets.data, facetsAll.data, currentFlowType ? [currentFlowType] : []);
  const sharedState = { view, slicing, scope: search.scope, detail: search.detail, sel: search.sel, activity: search.activity, filter: search.filter, fh: search.fh, render: search.render, full: search.full };
  const expanded = (id: string) => search.panel === id;
  const expand = (id: string) => patch({ panel: search.panel === id ? undefined : id });
  const openWhy = (row: BacklogRow) =>
    void navigate({ to: "/p/$projectId/runs/$runId/slices/$sliceKey", params: { projectId: ctx.projectId, runId, sliceKey: row.key }, search: { slicing, view, tab: "why", filter: search.filter } as never });

  // where the board's numbers come from, in the reader's words: no id, the run by its own label, the scope
  // named even when it is every flow, the grouping without its column suffixes, the filters counted
  const runLabel = run.note?.trim() || `Run of ${fmtDate(run.manifest?.finishedAt ?? run.createdAt)}`;
  const sourceLine = [
    runLabel,
    view,
    groupingLabel(slicing, run.slicings?.find((s) => s.id === slicing)?.attributes ?? undefined),
    scope ? `${scope} flow only` : "all flows",
    filterCount(filter?.and.length ?? 0),
    `${fmtInt(casesIn ?? 0)} ${noun}`,
    `computed ${fmtDateTime(ranked.dataUpdatedAt || undefined)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <StepHeader
        projectId={ctx.projectId}
        runId={runId}
        title="Explore"
        // the share the second tile no longer carries on its face is said once, here, in the server's words
        sentence={["what changes when you select", belowExpectationSentence(kpis.data)].filter(Boolean).join(" · ")}
        active="board"
        search={sharedState}
        backFallback={{ href: `/p/${ctx.projectId}/runs/${runId}/backlog?slicing=${encodeURIComponent(slicing ?? "")}${view ? `&view=${encodeURIComponent(view)}` : ""}`, label: "Where is it worst?" }}
        actions={
          <FreezeButton
            projectId={ctx.projectId}
            screen="board"
            context={{ run_id: runId, slicing, view, filters: filter ?? null, scope: run.scope ?? null }}
            data={{ kpis: kpis.data, groups: rows.slice(0, 5), breakdown: bars }}
            defaultTitle={`Explore · ${scope ?? "all flows"}${filter?.and.length ? ` · ${filter.and.length} filters` : ""}`}
          />
        }
      />

      <div className="sticky top-0 z-10 flex flex-col gap-1 bg-bg pb-1" data-testid="board-selectors">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Selector
            label="flow type"
            value={currentFlowType}
            options={(flowTypes.data?.values ?? []).map((v) => ({ value: v.value, label: `${v.label} — ${fmtInt(v.cases)} ${noun}${v.share ? ` · ${fmtPct(v.share, v.share < 0.1 ? 1 : 0)}` : ""}` }))}
            onChange={(v) => toggle(clauseForValue(flowTypeField, v))}
            onClear={currentFlowType ? () => toggle(clauseForValue(flowTypeField, currentFlowType)) : undefined}
          />
          <Selector
            label="period"
            value={currentPeriod ? periodLabel(currentPeriod.from, currentPeriod.to) : undefined}
            options={(periods.data?.values ?? []).map((v) => ({ value: v.value, label: `${v.label} — ${fmtInt(v.cases)} ${noun}` }))}
            onChange={(v) => {
              const window = periodWindow(v);
              if (window) toggle(clauseForPeriod(window.from, window.to));
            }}
            onClear={currentPeriod ? () => changeFilter({ and: (filter?.and ?? []).filter((c) => c.kind !== "time") }) : undefined}
          />
          <Selector
            label="expectation area"
            value={search.area}
            options={areas.map((a) => ({ value: a.id, label: a.label }))}
            onChange={(v) => patch({ area: v })}
            onClear={search.area ? () => patch({ area: undefined }) : undefined}
          />
          <Selector
            label="group"
            value={currentGroup ? String(currentGroup.key ?? "") : undefined}
            options={(rankedAll.data?.rows ?? []).slice(0, 30).map((r) => ({ value: r.key, label: groupLabel(r, shared) }))}
            onChange={(v) => toggle({ kind: "slice", slicing: slicing ?? "", key: v })}
            onClear={currentGroup ? () => changeFilter({ and: (filter?.and ?? []).filter((c) => c.kind !== "slice") }) : undefined}
          />
          <button type="button" className="ml-auto text-xs text-text-muted underline" onClick={() => patch({ filter: undefined, fh: undefined, area: undefined, sel: undefined, activity: undefined })}>
            Reset all
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FilterChipsRow filter={filter} preview={preview.data} noun={noun} onChange={changeFilter} counts={false} className="min-w-0 flex-1" />
          {/* a board that could not be counted prints no count: it said "in 0 of 0" beside its own error */}
          {!boardError && (
            <span className="tnum whitespace-nowrap text-sm text-text-muted" data-testid="count-line">
              in <strong className="text-text">{fmtInt(casesIn ?? 0)}</strong> of {fmtInt(casesTotal)} {noun}
              {filter?.and.length ? ` · ${fmtInt(Math.max(0, casesTotal - (casesIn ?? 0)))} out` : ""}
              {feedback.noneRemoved ? <span className="ml-2 text-warning">no {noun} removed</span> : null}
            </span>
          )}
        </div>
      </div>

      {/*
        R3-12, P1-11 — one board, one state.

        When the selection cannot be counted at all, every panel drew the same sentence and the same way out —
        three alerts on one screen — while the four tiles stayed on *the numbers of this selection are being
        counted…*, which nothing was ever going to end. The board says it once, offers the way out once, and
        draws no numbers it does not have.
      */}
      {boardError ? (
        <ErrorBlock
          error={boardError}
          retry={() => void kpis.refetch()}
          action={
            filter?.and.length
              ? { label: "Open the board without the filter", onClick: () => patch({ filter: undefined, fh: undefined, sel: undefined, activity: undefined }) }
              : { label: "Back to Where is it worst?", to: "/p/$projectId/runs/$runId/backlog" as const, params: { projectId: ctx.projectId, runId }, search: { slicing, view } }
          }
        />
      ) : (
        <KpiTiles kpis={kpis.data} baseline={kpisAll.data} filtered={!!filter?.and.length} updating={kpis.isFetching && !kpis.isPending} />
      )}

      {!boardError && (
      <div className="grid gap-3 xl:grid-cols-12">
        <Panel
          spec={PANELS["flow-map"]}
          className="xl:col-span-7"
          sentence={<>Click an activity or a path to filter the whole board to the {noun} that pass through it.</>}
          expanded={expanded("flow-map")}
          onExpand={() => expand("flow-map")}
          loading={flow.isPending}
          error={flow.isError ? flow.error : undefined}
          errorAction={clearFilterAction}
          onRetry={() => void flow.refetch()}
          updating={flow.isFetching && !flow.isPending}
          bodyHeight={300}
        >
          {graph && (
            <Suspense fallback={<LoadingBlock rows={5} />}>
              <FlowMap
                graph={graph}
                title="Where in the flow"
                frame="panel"
                height={expanded("flow-map") ? Math.round(window.innerHeight * 0.7) : 300}
                filter={filter}
                preview={preview.data}
                onFilterChange={changeFilter}
                chips={false}
                counts={{ casesIn: casesIn ?? 0, casesTotal }}
                noun={noun}
                plainOf={plainOf}
                detail={search.detail}
                onDetailChange={(d) => patch({ detail: d })}
                render={search.render}
                onRenderChange={(m) => patch({ render: m })}
                clickFilters
                footnote={false}
                announce={feedback.announcement}
              />
            </Suspense>
          )}
        </Panel>

        <Panel
          spec={PANELS["worst-groups"]}
          className="xl:col-span-5"
          sentence={
            top ? (
              <>
                <strong>{groupLabel(top, shared)}</strong> carries the largest shortfall of the {fmtInt(ranked.data?.total ?? rows.length)} groups in view.
              </>
            ) : undefined
          }
          count={<span className="tnum text-xs text-text-muted" data-testid="ranked-count">{fmtInt(rows.length)} of {fmtInt(ranked.data?.total ?? 0)}</span>}
          expanded={expanded("worst-groups")}
          onExpand={() => expand("worst-groups")}
          loading={ranked.isPending}
          error={ranked.isError ? ranked.error : undefined}
          errorAction={clearFilterAction}
          onRetry={() => void ranked.refetch()}
          updating={ranked.isFetching && !ranked.isPending}
          bodyHeight={300}
        >
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">No group is left under these chips.</p>
          ) : (
            <>
              <RankedRows rows={rows} shared={shared} noun={noun} maxPI={maxPI} selected={currentGroup ? String(currentGroup.key ?? "") : undefined} onSelect={(r) => toggle({ kind: "slice", slicing: slicing ?? "", key: r.key })} onWhy={openWhy} />
              <p className="pt-1 text-xs text-text-subtle">Click a group to filter · Why? opens its reasons · ranked within the filter.</p>
            </>
          )}
        </Panel>

        <Panel
          spec={PANELS.distribution}
          className="xl:col-span-6"
          actions={constraint && uncalibrated.has(constraint) ? <CalibrationChip text={uncalibrated.get(constraint)?.text} /> : undefined}
          sentence={constraint ? <>How far the {noun} in view are from this expectation.</> : undefined}
          lock={filter?.and.length && dist.data && !(dist.data as { filter?: unknown }).filter ? "this backend serves the distribution over all items" : undefined}
          expanded={expanded("distribution")}
          onExpand={() => expand("distribution")}
          loading={dist.isPending && !!constraint}
          error={dist.isError ? dist.error : undefined}
          errorAction={clearFilterAction}
          onRetry={() => void dist.refetch()}
          updating={dist.isFetching && !dist.isPending}
          bodyHeight={220}
        >
          {/* one state, one sentence: the empty sentence is never printed above a drawn chart  */}
          {!constraint ? (
            <p className="text-sm text-text-muted">This run has no expectation with a threshold, so there is nothing to draw.</p>
          ) : (
            dist.data && (
              <DistributionLens
                distribution={dist.data}
                rest={distAll.data}
                constraintId={constraint}
                title={plainOf(constraint)}
                mode="plain"
                sliders="never"
                height={expanded("distribution") ? 420 : 200}
                noun={noun}
                groupName={filter?.and.length ? "the items in view" : "all items"}
              />
            )
          )}
        </Panel>

        <Panel
          spec={PANELS.breakdown}
          className="xl:col-span-6"
          sentence={<>How the {noun} in view split by {(facets.data?.field ?? search.breakdown).replace(/^case /, "").replace(/_/g, " ")}.</>}
          actions={
            <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Breakdown by">
              {(["flow_type", "period", "attribute"] as Breakdown[]).map((b) => (
                <button key={b} type="button" aria-pressed={search.breakdown === b} onClick={() => patch({ breakdown: b })} className={search.breakdown === b ? "bg-accent-subtle px-2 py-1 text-xs font-medium text-accent-text" : "px-2 py-1 text-xs text-text-muted hover:bg-surface-sunken"}>
                  {b.replace("_", " ")}
                </button>
              ))}
            </span>
          }
          lock={facets.data?.filtered === false ? "this backend serves the counts over all items" : undefined}
          expanded={expanded("breakdown")}
          onExpand={() => expand("breakdown")}
          loading={facets.isPending}
          error={facets.isError ? facets.error : undefined}
          errorAction={clearFilterAction}
          onRetry={() => void facets.refetch()}
          updating={facets.isFetching && !facets.isPending}
          bodyHeight={220}
        >
          {bars.length === 0 ? (
            <p className="text-sm text-text-muted">{search.breakdown === "period" ? "This run has no period column, so the period breakdown is empty." : "Nothing to break down for this selection."}</p>
          ) : (
            <BreakdownBars
              rows={bars}
              noun={noun}
              onSelect={(row) => {
                const window = search.breakdown === "period" ? periodWindow(row.value) : undefined;
                if (window) toggle(clauseForPeriod(window.from, window.to));
                else toggle(clauseForValue(facets.data?.field ?? facetsAll.data?.field ?? "flow_type", row.value));
              }}
            />
          )}
        </Panel>
      </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2 text-xs text-text-muted" data-testid="board-source">
        <span>{sourceLine}</span>
        <span className="flex items-center gap-2" data-no-capture>
          <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
            Save as…
          </Button>
          {top && (
            <Button size="sm" onClick={() => openWhy(top)}>
              Why? {groupLabel(top, shared)} →
            </Button>
          )}
        </span>
      </footer>
      {boards.filter((b) => b.projectId === ctx.projectId).length > 0 && (
        <p className="text-xs text-text-subtle" data-testid="saved-boards">
          saved boards:{" "}
          {boards
            .filter((b) => b.projectId === ctx.projectId)
            .map((b) => (
              <button key={b.id} type="button" className="mr-2 text-accent-text underline" onClick={() => void navigate({ to: b.href })}>
                {b.name}
                {b.href !== href ? "" : " · open"}
              </button>
            ))}
        </p>
      )}
      <p className="sr-only" aria-live="polite" data-testid="filter-announcement">
        {feedback.announcement}
      </p>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this board</DialogTitle>
          </DialogHeader>
          <Field label="name" htmlFor="board-name">
            <Input id="board-name" value={boardName} onChange={(e) => setBoardName(e.target.value)} placeholder="Late clearing, DF2" />
          </Field>
          <p className="text-xs text-text-muted">The board is saved with its context and its chips; nothing autosaves. Boards are kept in this browser until the backend keeps them per project.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!boardName.trim()}
              onClick={() => {
                saveBoard({ projectId: ctx.projectId, runId, href, name: boardName.trim(), label: boardName.trim(), chips: (filter?.and ?? []).map((c) => clauseKey(c)), withSelection: !!filter?.and.length });
                setSaveOpen(false);
                setBoardName("");
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Selector({ label, value, options, onChange, onClear }: { label: string; value?: string; options: { value: string; label: string }[]; onChange: (v: string) => void; onClear?: () => void }) {
  return (
    <span className="flex items-center gap-1 text-text-muted">
      {label}
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger compact aria-label={`Select a ${label}`} className="w-auto min-w-[130px]">
          <SelectValue placeholder="all" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onClear && (
        <button type="button" aria-label={`Clear the ${label}`} className="rounded-full px-1 text-text-subtle hover:bg-surface-sunken" onClick={onClear}>
          ×
        </button>
      )}
    </span>
  );
}

/** The value a filter holds for one case attribute (the selectors read the filter, so a removed chip clears them). */
function valueOf(filter: Filter | undefined, field: string): string | undefined {
  const clause = (filter?.and ?? []).find((c) => c.kind === "attribute" && c.field === field);
  return clause && clause.kind === "attribute" ? clause.in?.[0] : undefined;
}

/** The share of items still open, from the case table's readiness, for the fourth tile on a backend without KPIs. */
function openShareOf(readiness: { items?: { id: string; evidence?: Record<string, unknown> | null }[] } | null | undefined): number | null {
  const item = readiness?.items?.find((i) => i.id === "right_censored");
  const share = (item?.evidence ?? {}).share;
  return typeof share === "number" ? share : null;
}

/** The case attribute the third breakdown tab starts with. */
function defaultAttribute(run: RunC2 | undefined): string {
  const attributes = run?.slicings?.[0]?.attributes ?? [];
  return attributes[attributes.length - 1] ?? "case Vendor";
}
