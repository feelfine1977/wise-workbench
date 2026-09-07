import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "@/app/context";
import { backlogRoute } from "@/app/router";
import { stripBacklogDefaults, type BacklogSearch, type BacklogTab } from "@/app/search";
import { filterPreviewQuery, runCaveats, uncalibratedById, type BacklogParamsC2, type RunC2, type Within } from "@/lib/api/cycle2";
import { Explain } from "@/components/explain";
import { FreezeButton } from "@/components/guide/Freeze";
import { CaveatChips, caveatFloor, caveatShort, runCaveatSentence } from "@/components/guide/CaveatChips";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Term, useVocabulary } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseFilter } from "@/lib/filter";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery, normQuery } from "@/lib/queries";
import { groupLabel, groupingLabel, pageWideCaveats, sharedKeyValues } from "@/lib/sentences";
import { useNavStore } from "@/lib/stores/nav";
import { useUiStore } from "@/lib/stores/ui";
import { rankingRule } from "@/lib/vocabulary";
import { drillAttributeFor, sliceLabel } from "@/lib/utils";
import { BacklogTable } from "./BacklogTable";
import { ComparisonStrip } from "./ComparisonStrip";
import { Refine } from "./Refine";
import { SignalsList } from "./SignalsList";

const Charts = lazy(() =>
  import("./BacklogCharts").then((m) => ({
    default: ({ rows, activeKey, onSelect }: { rows: Parameters<typeof m.VolumeGapScatter>[0]["rows"]; activeKey?: string; onSelect: (k: string) => void }) => (
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
    ),
  })),
);


function parseWithin(raw: string | undefined): Within | undefined {
  if (!raw) return undefined;
  try {
    const w = JSON.parse(raw) as Within;
    return w && typeof w.slicing === "string" && typeof w.key === "string" ? w : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Signals — "Where is it worst?": one sentence says what is ranked and how; the ranked cards are the dominant
 * element; filters sit behind "Refine" with the active ones as chips (R2-O9); the table and the scatter are
 * secondary tabs. Every filter, the filter model and the drill-in group live in the URL (UX-1, RF-01).
 */
export default function BacklogPage() {
  const { t } = useTranslation();
  const { vocabulary, t: word } = useVocabulary();
  const plain = vocabulary === "plain";
  const ctx = useWorkbench();
  const { runId } = backlogRoute.useParams();
  const search = backlogRoute.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const run = ctx.runs.find((r) => r.id === runId) as RunC2 | undefined;
  const filterRef = useRef<HTMLInputElement>(null);
  const [activeKey, setActiveKey] = useState<string | undefined>(search.row);
  const setLastSlice = useNavStore((s) => s.setLastSlice);

  // Fill missing context (slicing, view) from the run so the URL is complete and shareable.
  useEffect(() => {
    if (!run) return;
    const slicing = search.slicing ?? run.slicings?.[0]?.id ?? undefined;
    const view = search.view ?? run.views?.[0];
    if (slicing !== search.slicing || view !== search.view) {
      void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), slicing, view }) as BacklogSearch, replace: true });
    }
  }, [run, search.slicing, search.view, navigate]);

  const patch = useCallback(
    // `hotspotType` is the method's alias of `kind` in old links; a change of the kind clears it too.
    (p: Partial<BacklogSearch>, replace = false) => void navigate({ to: ".", search: (s) => ({ ...stripBacklogDefaults({ ...(s as BacklogSearch), page: 1, ...p }), ...("kind" in p ? { hotspotType: undefined } : {}) }) as BacklogSearch, replace }),
    [navigate],
  );

  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? "";
  const view = search.view ?? run?.views?.[0];
  const gamma = search.gamma ?? run?.gamma ?? 20;
  const filter = useMemo(() => parseFilter(search.filter), [search.filter]);
  const within = useMemo(() => parseWithin(search.within), [search.within]);
  const query = useMemo(
    () => ({ slicing, view, gamma, minCases: search.minCases, sort: search.sort, kind: search.kind, layer: search.layer, q: search.q, page: search.page, pageSize: search.pageSize, filter: search.filter, drillFrom: within?.slicing, drillKey: within?.key }),
    [slicing, view, gamma, search.minCases, search.sort, search.kind, search.layer, search.q, search.page, search.pageSize, search.filter, within],
  );
  const enabled = !!run && run.status === "done" && !!slicing;
  const backlog = useQuery({ ...backlogQuery(ctx.projectId, runId, query), enabled });
  // "All groups at once" reads the whole backlog (up to the contract's page limit) with the same filters.
  const everything = useQuery({ ...backlogQuery(ctx.projectId, runId, { ...query, page: 1, pageSize: 500 }), enabled: enabled && search.tab === "scatter" });
  const preview = useQuery({ ...filterPreviewQuery(ctx.projectId, runId, filter), enabled: enabled && !!filter });
  const norm = useQuery({ ...normQuery(ctx.projectId, run?.normVersionId ?? ""), enabled: !!run });
  const layers = useMemo(() => (norm.data?.norm as { layers?: { id: string; name: string }[] } | undefined)?.layers ?? [], [norm.data]);
  const layerNames = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.name])), [layers]);

  const guided = useUiStore((s) => s.mode === "guided");
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
    (key: string, focus?: "finding") => {
      const label = groupLabel(rows.find((r) => r.key === key) ?? { key }, sharedKeyValues(rows));
      const target = {
        to: "/p/$projectId/runs/$runId/slices/$sliceKey" as const,
        params: { projectId: ctx.projectId, runId, sliceKey: key },
        search: { slicing, view, tab: "why" as const, focus, pins: pins.length ? pins : undefined, filter: search.filter },
      };
      setLastSlice(router.buildLocation(target).href, label);
      void navigate(target);
    },
    [navigate, router, ctx.projectId, runId, slicing, view, pins, rows, search.filter, setLastSlice],
  );
  // Drill into a group (R2-O2): the finer slicing (the backend's default drill-down attribute) restricted to the group's cases.
  const drill = useCallback((key: string) => patch({ within: JSON.stringify({ slicing, key }), slicing: drillAttributeFor(slicing), page: 1, row: undefined }), [patch, slicing]);
  const setTab = (tab: BacklogTab) => void navigate({ to: ".", search: (s) => stripBacklogDefaults({ ...(s as BacklogSearch), tab }) as BacklogSearch });
  const reset = () => void navigate({ to: ".", search: { slicing, view, tab: search.tab } });

  if (!run) {
    return ctx.isLoading ? <LoadingBlock rows={8} /> : <EmptyState title="This run does not exist in this workspace." reason={`Nothing is ranked for ${runId}; the ribbon stays on the project's latest run.`} action={{ label: "Go to Runs", to: "/p/$projectId/runs", params: { projectId: ctx.projectId } }} />;
  }
  if (run.status !== "done") {
    return <EmptyState title={`Run ${run.id} is ${run.status}`} reason="The ranked list appears when scoring has finished." action={{ label: "Open the run monitor", to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId } }} />;
  }

  const params = (backlog.data?.params ?? {}) as BacklogParamsC2 & { attributes?: string[] };
  const caseNoun = plain ? (params.case_noun ?? "cases") : "cases";
  const total = backlog.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / search.pageSize));
  const maxPI = backlog.data?.maxStablePI ?? Math.max(0, ...rows.map((r) => r.stable_PI));
  const grouping = run.slicings?.find((s) => s.id === slicing);
  const groupingText = groupingLabel(slicing, grouping?.attributes ?? (params.attributes as string[] | undefined));
  // the run's uncalibrated expectations, so every card that names one flags it
  const uncalibrated = uncalibratedById(params);
  const noConfidenceComputed = confident && rows.length === 0 && (backlog.data?.rows ?? []).length > 0 && (backlog.data?.rows ?? []).every((r) => (r.stability ?? "unknown") === "unknown");
  const scope = run.scope?.flow_type;
  /**
   * The caveat line above the list (R3-09). It is read from the **run's own** summary, so it is the same
   * sentence on page 1, page 2 and page 3 of one ranked list; before this it was recomputed over whichever
   * fifty rows were on the screen and read *up to 44 %* on the first page and *up to 91 %* on the second, for
   * one run. A backend that does not serve the summary yet falls back to the page's own rows, and the line
   * then says which population it describes rather than implying the run.
   */
  const summary = runCaveats(params);
  /**
   * *On nearly every group of this run* has to be true of what follows it: only a caveat that touches at
   * least four groups in five is stated there. Read without the rule, the line said *duplicated events* of a
   * run where six groups of twenty-three carry them, and *copied postings* of five.
   */
  const runWideCaveats = summary?.filter((c) => (c.share ?? 0) > caveatFloor(String(c.id)) && (!total || (c.groups ?? 0) >= 0.8 * total));
  const pageCaveats =
    runWideCaveats?.map((c) => ({
      id: String(c.id),
      share: c.share ?? undefined,
      max: c.max ?? undefined,
      // the chip's tooltip and its accessible name are a sentence about the run, never the caveat's id
      text: c.text ?? runCaveatSentence(String(c.id), c.share ?? undefined, c.max ?? undefined, caseNoun),
      groups: c.groups ?? undefined,
    })) ?? pageWideCaveats(rows).map((c) => ({ ...c, groups: undefined as number | undefined }));
  // a group whose share lies far outside the run-wide range keeps its own chip (R2-06)
  const hideCaveats = new Map(pageCaveats.map((c) => [c.id, c.share]));

  const footer = (
    <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
      <span>
        {fmtInt(rows.length)} of {fmtInt(total)} {plain ? "groups" : word("slice") + "s"} · page {search.page} / {pageCount}
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
      <span>keys: ↑↓ move · ↵ Why? · p pin · f finding · / refine</span>
    </footer>
  );

  const switchers = (
    <>
      <span className="flex items-center gap-1 text-sm text-text-muted">
        <Term id="view" primaryOnly />
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
      <span className="flex items-center gap-1 text-sm text-text-muted">
        {plain ? "grouping" : "slicing"}
        <Select value={slicing} onValueChange={(v) => ctx.setSlicing(v)}>
          <SelectTrigger compact aria-label={`Switch ${plain ? "grouping" : "slicing"}`} className="w-auto min-w-[160px]">
            <SelectValue placeholder={groupingText} />
          </SelectTrigger>
          <SelectContent>
            {[...(run.slicings ?? []), ...(within && !run.slicings?.some((s) => s.id === slicing) ? [{ id: slicing, attributes: slicing.split("+") }] : [])].map((s) => (
              <SelectItem key={s.id ?? s.attributes.join("+")} value={s.id ?? s.attributes.join("+")}>
                {groupingLabel(s.id ?? undefined, s.attributes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-text-subtle">
              Signals{scope ? ` · ${scope} flow only` : ""}
              {params.illustrative && (
                <Badge variant="warning" className="ml-2 normal-case tracking-normal" title="These rows are made up by the mocks; the verified run's rows are read for company × spend area and vendor">
                  illustrative
                </Badge>
              )}
            </p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Term id="backlog" secondaryClassName="text-sm" primaryOnly={plain}>
                {plain ? "Where is it worst?" : "Backlog"}
              </Term>
              <HowToReadToggle id="signals" />
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-no-capture>
            <FreezeButton projectId={ctx.projectId} screen="signals" context={{ run_id: runId, slicing, view, filters: filter ?? null, scope: run.scope ?? null }} data={{ rows: rows.slice(0, 10), params }} defaultTitle={`Where is it worst? · ${groupingText} · ${view ?? ""}`} />
          </div>
        </div>
        <p className="reading headline text-text" data-testid="ranking-rule">
          {backlog.data ? (
            <>
              <strong>{fmtInt(total)}</strong> groups of {caseNoun} by <strong>{groupingText}</strong>
              {within ? ` inside ${sliceLabel({ key: within.key })}` : ""}, ranked by{" "}
              {plain ? (
                <>
                  how many × how far below the overall score, <span title={`caution against small groups: γ = ${fmtNum(gamma, 0)}`}>small groups discounted</span>
                </>
              ) : (
                `stable PI (γ = ${fmtNum(gamma, 0)})`
              )}
              , in the <strong>{view}</strong> {plain ? "perspective" : "view"}.
            </>
          ) : (
            rankingRule(vocabulary, gamma)
          )}
        </p>
        {pageCaveats.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted" data-testid="page-caveats">
            <span>{runWideCaveats ? `On nearly every group of this run:` : `On nearly every group on this page:`}</span>
            <CaveatChips caveats={pageCaveats.map((c) => ({ id: c.id, share: c.share ?? null, status: "warn", text: c.text }))} max={4} />
            <span className="text-xs text-text-subtle" data-testid="page-caveat-range">
              {pageCaveats
                .filter((c) => c.share !== undefined && c.max !== undefined)
                .map(
                  (c) =>
                    `${caveatShort(c.id)}: ${fmtPct(c.share ?? 0, (c.share ?? 0) < 0.1 ? 1 : 0)} on average, up to ${fmtPct(c.max ?? 0, (c.max ?? 0) < 0.1 ? 1 : 0)}${
                      c.groups !== undefined ? ` on ${fmtInt(c.groups)} of ${fmtInt(total)} groups` : ""
                    }`,
                )
                .join(" · ")}
            </span>
          </div>
        )}
        {!plain && backlog.data && (
          <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="method-strip">
            <Badge variant="outline">
              <Term id="gamma" primaryOnly>γ</Term> = {fmtNum(gamma, 0)}
              <Explain term="gamma" />
            </Badge>
            <Badge variant="outline">
              <Term id="global_mean" primaryOnly /> {fmtNum(backlog.data.globalMean, 3)}
              <Explain term="global_mean" />
            </Badge>
            <Badge variant="outline">sorted by {search.sort.startsWith("-") ? `${word(search.sort.slice(1))} ↓` : `${word(search.sort)} ↑`}</Badge>
            {params.window_end && <Badge variant="outline">window end {params.window_end.slice(0, 10)}</Badge>}
          </p>
        )}
        <HowToRead id="signals">
          Each card is one group of {caseNoun}. Its sentence carries the three numbers that matter: how many {caseNoun}, how far the group's score sits below the overall score, and the expectation missed most with the share of {caseNoun} missing it. The
          muted line under it is the real-unit comparison with everyone else where the backend has computed one. The bar is the priority (how many × how far) with the confidence in the rank beside it; <strong>Why?</strong> opens the reasons behind one group.
          Filters sit behind <strong>Refine</strong>; every active one shows as a chip you can remove.
        </HowToRead>
      </header>

      <Refine ref={filterRef} search={search} layers={layers} runGamma={run.gamma ?? 20} filter={filter} preview={preview.data} within={within} onChange={(p) => patch(p)} onReset={reset} caseNoun={caseNoun}>
        {/* the ribbon owns the switchers; guided mode has already put them away, so this row does not put
            them back beside the list (R3-10, R3-30) */}
        {guided ? null : switchers}
      </Refine>

      <Tabs value={search.tab} onValueChange={(v) => setTab(v as BacklogTab)}>
        <TabsList aria-label="Views of the ranked list">
          <TabsTrigger value="signals">{plain ? "Signals" : "Hotspots"}</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="scatter">All groups at once</TabsTrigger>
        </TabsList>
        {backlog.isPending && <LoadingBlock rows={8} className="mt-3" />}
        {backlog.isError && <ErrorBlock error={backlog.error} retry={() => void backlog.refetch()} className="mt-3" />}
        {backlog.data && (
          <>
            <TabsContent value="signals" className="flex flex-col gap-4">
              {pins.length > 0 && <ComparisonStrip projectId={ctx.projectId} runId={runId} slicing={slicing} view={view} pins={pins} rows={rows} layerNames={layerNames} onUnpin={togglePin} />}
              {rows.length === 0 ? (
                noConfidenceComputed ? (
                  <EmptyState title={t("empty.noConfidence")} reason={t("empty.noConfidenceReason")} action={{ label: "Show every rank", onClick: () => patch({ confident: undefined }) }} />
                ) : (
                  <EmptyState title={t("empty.noRows")} reason={t("empty.noRowsReason")} action={{ label: "Reset filters", onClick: reset }} />
                )
              ) : (
                <SignalsList uncalibrated={uncalibrated} rows={rows} maxPI={maxPI} view={view} layerNames={layerNames} caseNoun={caseNoun} hideCaveats={hideCaveats} pins={pins} activeKey={activeKey} onActive={setActiveKey} onTogglePin={togglePin} onOpen={open} onDrill={within ? undefined : drill} onFocusFilter={() => filterRef.current?.focus()} />
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
                  <Charts
                    rows={allRows}
                    activeKey={activeKey}
                    onSelect={(key) => {
                      setActiveKey(key);
                      open(key);
                    }}
                  />
                </Suspense>
              )}
              <p className="text-xs text-text-muted">
                {fmtInt(allRows.length)} of {fmtInt(everything.data?.total ?? total)} {plain ? "groups" : word("slice") + "s"} drawn with the current filters; click a point to open its reasons.
              </p>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
