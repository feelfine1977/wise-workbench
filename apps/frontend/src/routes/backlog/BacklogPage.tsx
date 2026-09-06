import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "@/app/context";
import { backlogRoute } from "@/app/router";
import { BACKLOG_DEFAULTS, stripBacklogDefaults, type BacklogSearch, type BacklogTab } from "@/app/search";
import { Explain } from "@/components/explain";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery, normQuery } from "@/lib/queries";
import { rankingRule } from "@/lib/vocabulary";
import { BacklogTable } from "./BacklogTable";
import { ComparisonStrip } from "./ComparisonStrip";
import { Filters } from "./Filters";
import { SignalsList } from "./SignalsList";

const Charts = lazy(() => import("./BacklogCharts").then((m) => ({ default: ({ rows, activeKey, onSelect }: { rows: Parameters<typeof m.VolumeGapScatter>[0]["rows"]; activeKey?: string; onSelect: (k: string) => void }) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <Card>
      <CardTitle>
        cases × shortfall <span className="font-normal text-text-subtle">(whiskers = the cautious bound; shape = kind of problem; size = priority)</span>
      </CardTitle>
      <m.VolumeGapScatter rows={rows} activeKey={activeKey} onSelect={onSelect} />
    </Card>
    <Card>
      <CardTitle>how much of the priority the top groups carry</CardTitle>
      <m.ConcentrationCurve rows={rows} />
    </Card>
  </div>
) })));

const groupingLabel = (attributes: string[] | undefined, id: string | null | undefined) => (attributes ?? []).map((a) => a.replace(/^case /, "")).join(" × ") || (id ?? "");

/**
 * S6 — "Where is it worst?": the signals list (ranked sentence cards) is the default view; the metric table and
 * the scatter are secondary tabs. Every filter and the tab live in the URL; the three views share one page of rows.
 */
export default function BacklogPage() {
  const { t } = useTranslation();
  const { vocabulary, t: word } = useVocabulary();
  const ctx = useWorkbench();
  const { runId } = backlogRoute.useParams();
  const search = backlogRoute.useSearch();
  const navigate = useNavigate();
  const run = ctx.runs.find((r) => r.id === runId);
  const filterRef = useRef<HTMLInputElement>(null);
  const [activeKey, setActiveKey] = useState<string | undefined>(search.row);

  // Fill missing context (slicing, view) from the run so the URL is complete and shareable.
  useEffect(() => {
    if (!run) return;
    const slicing = search.slicing ?? run.slicings?.[0]?.id ?? undefined;
    const view = search.view ?? run.views?.[0];
    if (slicing !== search.slicing || view !== search.view) {
      void navigate({ to: ".", search: (s) => ({ ...s, slicing, view }), replace: true });
    }
  }, [run, search.slicing, search.view, navigate]);

  const patch = useCallback(
    (p: Partial<BacklogSearch>, replace = false) => void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), page: 1, ...p }) as BacklogSearch, replace }),
    [navigate],
  );

  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? "";
  const view = search.view ?? run?.views?.[0];
  const gamma = search.gamma ?? run?.gamma ?? 50;
  const query = useMemo(
    () => ({ slicing, view, gamma, minCases: search.minCases, sort: search.sort, kind: search.kind, layer: search.layer, q: search.q, page: search.page, pageSize: search.pageSize }),
    [slicing, view, gamma, search.minCases, search.sort, search.kind, search.layer, search.q, search.page, search.pageSize],
  );
  const enabled = !!run && run.status === "done" && !!slicing;
  const backlog = useQuery({ ...backlogQuery(ctx.projectId, runId, query), enabled });
  // "All groups at once" reads the whole backlog (up to the contract's page limit) with the same filters.
  const everything = useQuery({ ...backlogQuery(ctx.projectId, runId, { ...query, page: 1, pageSize: 500 }), enabled: enabled && search.tab === "scatter" });
  const norm = useQuery({ ...normQuery(ctx.projectId, run?.normVersionId ?? ""), enabled: !!run });
  const layers = useMemo(() => ((norm.data?.norm as { layers?: { id: string; name: string }[] } | undefined)?.layers ?? []), [norm.data]);
  const layerNames = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.name])), [layers]);

  const confident = !!search.confident;
  const rows = useMemo(() => {
    const all = backlog.data?.rows ?? [];
    return confident ? all.filter((r) => r.stability === "stable") : all;
  }, [backlog.data, confident]);
  const allRows = useMemo(() => {
    const all = everything.data?.rows ?? backlog.data?.rows ?? [];
    return confident ? all.filter((r) => r.stability === "stable") : all;
  }, [everything.data, backlog.data, confident]);
  const pins = useMemo(() => search.pins ?? [], [search.pins]);
  const togglePin = useCallback(
    (key: string) => {
      const next = pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key].slice(-3);
      void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), pins: next }) as BacklogSearch, replace: true });
    },
    [pins, navigate],
  );
  const open = useCallback(
    (key: string, focus?: "finding") =>
      void navigate({ to: "/p/$projectId/runs/$runId/slices/$sliceKey", params: { projectId: ctx.projectId, runId, sliceKey: key }, search: { slicing, view, tab: "drivers", focus, pins: pins.length ? pins : undefined } }),
    [navigate, ctx.projectId, runId, slicing, view, pins],
  );
  const setTab = (tab: BacklogTab) => void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), tab }) as BacklogSearch });

  if (!run) return ctx.isLoading ? <LoadingBlock rows={8} /> : <ErrorBlock error={new Error(`Run ${runId} is not in this project.`)} />;
  if (run.status !== "done") {
    return <EmptyState title={`Run ${run.id} is ${run.status}`} reason="The ranked list appears when scoring has finished." action={{ label: "Open the run monitor", to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId } }} />;
  }

  const total = backlog.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / search.pageSize));
  const maxPI = backlog.data?.maxStablePI ?? Math.max(0, ...rows.map((r) => r.stable_PI));
  const grouping = run.slicings?.find((s) => s.id === slicing);
  const groupingText = groupingLabel(grouping?.attributes, slicing);
  const noConfidenceComputed = confident && rows.length === 0 && (backlog.data?.rows ?? []).length > 0 && (backlog.data?.rows ?? []).every((r) => (r.stability ?? "unknown") === "unknown");
  const footer = (
    <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
      <span>
        {fmtInt(rows.length)} of {fmtInt(total)} {word("slice")}s · page {search.page} / {pageCount}
        {confident && " · high-confidence ranks only (filtered on this page)"}
      </span>
      <span className="flex gap-1">
        <Button variant="outline" size="sm" disabled={search.page <= 1} onClick={() => void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), page: search.page - 1 }) as BacklogSearch })}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={search.page >= pageCount} onClick={() => void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), page: search.page + 1 }) as BacklogSearch })}>
          Next
        </Button>
      </span>
      <span>
        keys: ↑↓ move · ↵ Why? · p pin · f finding · / filter <span className="text-text-subtle">(defaults: sort {BACKLOG_DEFAULTS.sort}, {BACKLOG_DEFAULTS.pageSize} per page)</span>
      </span>
    </footer>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-text-subtle">S6 · {vocabulary === "plain" ? "Where is it worst?" : "Backlog explorer"}</p>
            <h1 className="text-2xl font-semibold">
              <Term id="backlog" secondaryClassName="text-sm">{vocabulary === "plain" ? "Where is it worst?" : "Backlog"}</Term> <span className="font-mono text-base font-normal text-text-subtle">{run.id}</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">
              <Term id="gamma" primaryOnly>γ</Term> = {fmtNum(gamma, 0)}
              <Explain term="gamma" />
            </Badge>
            <Badge variant="outline">
              <Term id="global_mean" primaryOnly /> {fmtNum(backlog.data?.globalMean, 3)}
              <Explain term="global_mean" />
            </Badge>
            <Badge variant="outline">sorted by {search.sort.startsWith("-") ? `${word(search.sort.slice(1))} ↓` : `${word(search.sort)} ↑`}</Badge>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted" data-testid="ranking-rule">
          <span>{rankingRule(vocabulary, gamma)}</span>
          <span className="flex items-center gap-1">
            <Term id="view" primaryOnly />:
            <Select value={view ?? ""} onValueChange={(v) => ctx.setView(v)}>
              <SelectTrigger compact aria-label={`Switch ${word("view")}`} className="w-auto min-w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(run.views ?? []).map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
          <span className="flex items-center gap-1">
            {vocabulary === "plain" ? "grouping" : "slicing"}:
            <Select value={slicing} onValueChange={(v) => ctx.setSlicing(v)}>
              <SelectTrigger compact aria-label={`Switch ${vocabulary === "plain" ? "grouping" : "slicing"}`} className="w-auto min-w-[160px]">
                <SelectValue placeholder={groupingText} />
              </SelectTrigger>
              <SelectContent>
                {(run.slicings ?? []).map((s) => (
                  <SelectItem key={s.id ?? s.attributes.join("+")} value={s.id ?? s.attributes.join("+")}>
                    {groupingLabel(s.attributes, s.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
          {backlog.data && (
            <span className="text-text-subtle">
              {fmtInt(total)} {word("slice")}s ranked · {fmtPct(backlog.data.globalMean ?? 0, 1)} overall average score
            </span>
          )}
        </p>
        <details className="text-sm text-text-muted">
          <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-text-subtle">How to read this</summary>
          <p className="mt-1 max-w-3xl">
            Each card is one {word("slice")} of cases, ranked by {vocabulary === "plain" ? "priority: how many cases times how far they fall below expectation, with small groups discounted" : "stable PI"}. The card says how many cases,
            how far off on average, what kind of problem it is (acute: few cases, far off; systematic: one pattern behind it; widespread: many cases, slightly off), which expectation area is missed most and
            how sure the rank is. <strong>Why?</strong> opens the reasons behind the shortfall. The table and the scatter show the same list in the method's instruments.
          </p>
        </details>
      </header>

      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <aside className="surface h-fit p-3 lg:sticky lg:top-14">
          <Filters ref={filterRef} search={search} layers={layers} runGamma={run.gamma ?? 50} onChange={(p) => patch(p)} onReset={() => void navigate({ to: ".", search: { slicing, view, tab: search.tab } })} />
        </aside>
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={search.tab} onValueChange={(v) => setTab(v as BacklogTab)}>
            <TabsList aria-label="Views of the ranked list">
              <TabsTrigger value="signals">{vocabulary === "plain" ? "Signals" : "Hotspots"}</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="scatter">All groups at once</TabsTrigger>
            </TabsList>
            {backlog.isPending && <LoadingBlock rows={8} className="mt-3" />}
            {backlog.isError && <ErrorBlock error={backlog.error} retry={() => void backlog.refetch()} className="mt-3" />}
            {backlog.data && (
              <>
                <TabsContent value="signals" className="flex flex-col gap-3">
                  {pins.length > 0 && <ComparisonStrip projectId={ctx.projectId} runId={runId} slicing={slicing} view={view} pins={pins} rows={rows} layerNames={layerNames} onUnpin={togglePin} />}
                  {rows.length === 0 ? (
                    noConfidenceComputed ? (
                      <EmptyState title={t("empty.noConfidence")} reason={t("empty.noConfidenceReason")} action={{ label: "Show every rank", onClick: () => patch({ confident: undefined }) }} />
                    ) : (
                      <EmptyState title={t("empty.noRows")} reason={t("empty.noRowsReason")} action={{ label: "Reset filters", onClick: () => void navigate({ to: ".", search: { slicing, view } }) }} />
                    )
                  ) : (
                    <SignalsList rows={rows} maxPI={maxPI} view={view} layerNames={layerNames} pins={pins} activeKey={activeKey} onActive={setActiveKey} onTogglePin={togglePin} onOpen={open} onFocusFilter={() => filterRef.current?.focus()} />
                  )}
                  {footer}
                </TabsContent>
                <TabsContent value="table" className="flex flex-col gap-3">
                  <ComparisonStrip projectId={ctx.projectId} runId={runId} slicing={slicing} view={view} pins={pins} rows={rows} layerNames={layerNames} onUnpin={togglePin} />
                  {rows.length === 0 ? (
                    <EmptyState title={t("empty.noRows")} reason={t("empty.noRowsReason")} action={{ label: "Reset filters", onClick: () => void navigate({ to: ".", search: { slicing, view, tab: "table" } }) }} />
                  ) : (
                    <BacklogTable
                      rows={rows}
                      projectId={ctx.projectId}
                      runId={runId}
                      slicing={slicing}
                      view={view}
                      gamma={gamma}
                      minCases={search.minCases}
                      globalMean={backlog.data.globalMean ?? undefined}
                      sort={search.sort}
                      offset={(search.page - 1) * search.pageSize}
                      pins={pins}
                      activeKey={activeKey}
                      layerNames={layerNames}
                      onSort={(sort) => patch({ sort, tab: "table" })}
                      onActive={setActiveKey}
                      onTogglePin={togglePin}
                      onOpen={open}
                      onFocusFilter={() => filterRef.current?.focus()}
                    />
                  )}
                  {footer}
                </TabsContent>
                <TabsContent value="scatter" className="flex flex-col gap-3">
                  {everything.isPending && <LoadingBlock rows={4} />}
                  {(everything.data || backlog.data) && (
                    <Suspense fallback={<LoadingBlock rows={4} />}>
                      <Charts rows={allRows} activeKey={activeKey} onSelect={(key) => { setActiveKey(key); open(key); }} />
                    </Suspense>
                  )}
                  <p className="text-xs text-text-muted">
                    {fmtInt(allRows.length)} of {fmtInt(everything.data?.total ?? total)} {word("slice")}s drawn with the current filters; click a point to open its reasons.
                  </p>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
