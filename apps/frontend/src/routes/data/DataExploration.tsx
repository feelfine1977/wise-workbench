import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  SlidersHorizontal,
  Layers3,
  ScanSearch,
  Clock3,
  X,
  RotateCcw,
} from "lucide-react";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { Button, Card, Input, Table, Td, Th } from "@/components/ui";
import {
  edaQuery,
  type EDAPeriod,
  type EDASpan,
  type EDACategory,
  type EDAJointPredicate,
} from "@/lib/api/eda";
import { fmtDays, fmtInt, fmtShare } from "@/lib/format";
import type { ExplorationPage } from "@/app/search";
import { AnalysisSelectionBar } from "./AnalysisSelectionBar";
import {
  analysisKey,
  draftSelection,
  emptyAnalysisDraft,
  useAnalysisSelection,
  type AnalysisDraft,
  type PeriodSelection,
  type SpanSelection,
  type ContextChoice,
} from "@/lib/stores/analysisSelection";
import { LinkedBars, LinkedDensity } from "./insights/LinkedCharts";
import { ConcentrationPlot } from "./insights/ConcentrationPlot";
import { ContextGraph } from "./insights/ContextGraph";
import { DataAtlas } from "./insights/DataAtlas";
import { ExactValues, NumericRangeControl, ContextHierarchy } from "./insights/ExplorationControls";
import { numericLabel, jointLabel, contextPath } from "./insights/selectionHelpers";
import { EventEvidence } from "./insights/EventEvidence";
import "./insights/exploration.css";

export interface DataExplorationProps {
  projectId: string;
  datasetId: string;
  caseTableId?: string | null;
  pageMode?: ExplorationPage;
  showHeading?: boolean;
  onPageChange?: (page: ExplorationPage) => void;
}
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString();
const periodChoice = (r: EDAPeriod): PeriodSelection => ({
  key: r.key,
  label: r.label,
  from: r.from ?? undefined,
  before: r.to ? nextDay(r.to.slice(0, 10)) : undefined,
  missing: r.from === null,
});
const spanChoice = (r: EDASpan): SpanSelection => ({
  key: r.key,
  label: r.label,
  min: r.min ?? undefined,
  max: r.max ?? undefined,
  missing: r.missing,
});
const toggle = <T extends { key: string }>(rows: T[], row: T) =>
  rows.some((r) => r.key === row.key)
    ? rows.filter((r) => r.key !== row.key)
    : [...rows, row];
const comparableTime = (value?: string) =>
  value
    ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
    : undefined;
const samePeriod = (a: PeriodSelection, b: PeriodSelection) =>
  Boolean(a.missing) === Boolean(b.missing) &&
  comparableTime(a.from) === comparableTime(b.from) &&
  comparableTime(a.before) === comparableTime(b.before);
const sameSpan = (a: SpanSelection, b: SpanSelection) =>
  Boolean(a.missing) === Boolean(b.missing) &&
  a.min === b.min &&
  a.max === b.max;
const toggleRange = <T,>(rows: T[], row: T, same: (a: T, b: T) => boolean) =>
  rows.some((r) => same(r, row))
    ? rows.filter((r) => !same(r, row))
    : [...rows, row];
const days = (n: number | null) => (n === null ? "Unknown" : fmtDays(n));
const pages = [
  {
    key: "atlas",
    name: "Data atlas",
    question: "What is in this log?",
    icon: BookOpen,
  },
  {
    key: "time",
    name: "Time & variation",
    question: "What stands out?",
    icon: Clock3,
  },
  {
    key: "context",
    name: "Context & concentration",
    question: "Where should I look?",
    icon: Layers3,
  },
  {
    key: "evidence",
    name: "Case evidence",
    question: "Which records explain it?",
    icon: ScanSearch,
  },
] as const;
function Cell({
  title,
  intro,
  children,
  className = "",
}: {
  title: string;
  intro: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`eda-cell ${className}`} aria-label={title}>
      <h3>{title}</h3>
      <p className="eda-caption">{intro}</p>
      {children}
    </section>
  );
}
function Exploration({
  projectId,
  datasetId,
  caseTableId,
  pageMode,
  showHeading = true,
  onPageChange,
}: DataExplorationProps & { caseTableId: string }) {
  const key = analysisKey(projectId, datasetId, caseTableId);
  const draft = useAnalysisSelection(
    (s) => s.entries[key]?.draft ?? emptyAnalysisDraft,
  );
  const [localMode, setLocalMode] = useState<ExplorationPage>("atlas");
  const mode = pageMode ?? localMode;
  const changePage = (p: ExplorationPage) => {
    setLocalMode(p);
    onPageChange?.(p);
  };
  const [compareAttribute, setCompareAttribute] = useState<string>();
  const [page, setPage] = useState(1);
  const [pairUnion, setPairUnion] = useState(false);
  const [traceCaseId, setTraceCaseId] = useState<string>();
  const [editor, setEditor] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [error, setError] = useState("");
  const rangeEdits = useRef(new Set<string>());
  const [undo, setUndo] = useState<AnalysisDraft>();
  const selection = draftSelection(draft);
  const hasSelection = Object.keys(selection).length > 0;
  const selectionJSON = hasSelection ? JSON.stringify(selection) : undefined;
  const explorerScope = { projectId, datasetId, caseTableId, attribute: draft.attribute, selection: selectionJSON };
  useEffect(() => { setTraceCaseId(undefined); }, [selectionJSON]);
  const query = useQuery(
    { ...edaQuery(projectId, caseTableId, {
      datasetId,
      attribute: draft.attribute,
      compareAttribute,
      insight: true,
      page,
      selection: hasSelection ? JSON.stringify(selection) : undefined,
    }), placeholderData: (previous) => previous },
  );
  const data = query.isError ? undefined : query.data;
  const isCurrent = Boolean(data) && !query.isPlaceholderData;
  const insights = data?.insights;
  // Display labels may be absent in a saved recipe; resolve them without changing membership.
  useEffect(() => {
    if (!insights || !isCurrent) return;
    const current = useAnalysisSelection.getState().entries[key]?.draft;
    if (!current?.facets?.length) return;
    const facets = current.facets.map((f) => ({
      ...f,
      choices: f.choices.map((c) => ({
        ...c,
        label:
          insights.facets
            .find((v) => v.field === f.field)
            ?.categories.find((v) => v.key === c.key)?.label ?? c.label,
      })),
    }));
    if (JSON.stringify(facets) !== JSON.stringify(current.facets))
      useAnalysisSelection.getState().update(key, { ...current, facets });
  }, [insights, key, isCurrent]);
  const results = useRef<HTMLDivElement>(null);
  const focusAfterLoad = useRef<{ chart: string; key: string } | null>(null);
  useLayoutEffect(() => {
    if (!data || !isCurrent || !focusAfterLoad.current) return;
    const target = focusAfterLoad.current;
    focusAfterLoad.current = null;
    if (document.activeElement !== document.body) return;
    const match = [
      ...(results.current?.querySelectorAll<SVGGElement>("[data-bar-key]") ??
        []),
    ].find(
      (el) =>
        el.getAttribute("data-bar-key") === target.key &&
        el.closest("svg")?.getAttribute("aria-label") === target.chart,
    );
    match?.focus({ preventScroll: true });
  }, [data, isCurrent]);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!data || !isCurrent || !results.current) return;
    const el = results.current;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [data, mode, isCurrent]);
  const update = (changes: Partial<AnalysisDraft>) => {
    const current =
      useAnalysisSelection.getState().entries[key]?.draft ?? emptyAnalysisDraft;
    const active = document.activeElement?.closest("[data-bar-key]");
    if (active && results.current?.contains(active))
      focusAfterLoad.current = {
        key: active.getAttribute("data-bar-key")!,
        chart: active.closest("svg")?.getAttribute("aria-label") ?? "",
      };
    setUndo(current);
    useAnalysisSelection.getState().update(key, { ...current, ...changes });
    setPage(1);
    setError("");
    rangeEdits.current.clear();
  };
  const facets = () => {
    const next = [...(draft.facets ?? [])];
    if (
      draft.categories.length &&
      draft.attribute &&
      !next.some((f) => f.field === draft.attribute)
    )
      next.push({
        field: draft.attribute,
        choices: draft.categories.map(({ key, label }) => ({ key, label })),
      });
    return next;
  };
  const chooseField = (attribute: string) => {
    if (compareAttribute === attribute) setCompareAttribute(undefined);
    update({ attribute, categories: [], facets: facets() });
  };
  const activeKeys = (field: string) => [
    ...(draft.facets
      ?.find((f) => f.field === field)
      ?.choices.map((c) => c.key) ?? []),
    ...(draft.attribute === field ? draft.categories.map((c) => c.key) : []),
  ];
  const setFacet = (field: string, choices: ContextChoice[]) =>
    update({
      categories: [],
      facets: [
        ...facets().filter((f) => f.field !== field),
        ...(choices.length ? [{ field, choices }] : []),
      ],
    });
  const selectCategory = (field: string, row: EDACategory) =>
    setFacet(
      field,
      toggle(facets().find((f) => f.field === field)?.choices ?? [], {
        key: row.key,
        label: row.label,
      }),
    );
  const toggleJoint = (branch: EDAJointPredicate) => {
    const previous = draft.jointAny ?? [];
    const encoded = JSON.stringify(branch);
    const exists = previous.some((b) => JSON.stringify(b) === encoded);
    if (!exists && previous.length >= 24) { setError("A context union supports up to 24 paths. Remove a path first."); return; }
    const fields = branch.facets.map((f) => f.field);
    update({
      ...(exists ? {} : { categories: [], facets: facets().filter((f) => !fields.includes(f.field)) }),
      jointAny: exists ? previous.filter((b) => JSON.stringify(b) !== encoded) : [...previous, branch],
    });
  };
  const pair = (leftKey: string, rightKey: string) => {
    const left = data?.attribute;
    const right = insights?.compareAttribute;
    if (!left || !right) return;
    if (pairUnion || draft.jointAny?.length) {
      toggleJoint(contextPath([left, right], [leftKey, rightKey], [insights?.facets.find((f) => f.field === left)?.categories.find((r) => r.key === leftKey)?.label ?? leftKey, insights?.facets.find((f) => f.field === right)?.categories.find((r) => r.key === rightKey)?.label ?? rightKey]));
      return;
    }
    const label = (f: string, k: string) =>
      insights?.facets
        .find((x) => x.field === f)
        ?.categories.find((x) => x.key === k)?.label ?? k;
    update({
      categories: [],
      facets: [
        ...facets().filter((f) => f.field !== left && f.field !== right),
        {
          field: left,
          choices: [{ key: leftKey, label: label(left, leftKey) }],
        },
        {
          field: right,
          choices: [{ key: rightKey, label: label(right, rightKey) }],
        },
      ],
    });
  };
  const selectPeriod = (k: string) => {
    const r = data?.trend.find((r) => r.key === k);
    if (r)
      update({
        periods: toggleRange(draft.periods, periodChoice(r), samePeriod),
        dates: { from: "", through: "" },
      });
  };
  const selectSpan = (k: string) => {
    const r = data?.spans.find((r) => r.key === k);
    if (r) update({ spans: toggleRange(draft.spans, spanChoice(r), sameSpan) });
  };
  const applyRanges = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const from = String(f.get("from") ?? ""),
      through = String(f.get("through") ?? "");
    if (
      (from && !Number.isFinite(Date.parse(`${from}T00:00:00Z`))) ||
      (through && !Number.isFinite(Date.parse(`${through}T00:00:00Z`))) ||
      (from && through && from > through)
    ) {
      setError("Choose valid dates with From on or before Through.");
      return;
    }
    const read = (name: string) =>
      f.get(name) ? Number(f.get(name)) : undefined;
    const min = read("min"),
      max = read("max"),
      emin = read("emin"),
      emax = read("emax");
    if (
      [min, max, emin, emax].some(
        (n) => n !== undefined && (!Number.isFinite(n) || n < 0),
      ) ||
      (min !== undefined && max !== undefined && min >= max) ||
      (emin !== undefined && emax !== undefined && emin >= emax) ||
      [emin, emax].some((n) => n !== undefined && !Number.isSafeInteger(n))
    ) {
      setError(
        "Use nonnegative bounds, with each minimum below its exclusive maximum. Event counts must be whole numbers.",
      );
      return;
    }
    const edited = (...names: string[]) =>
      names.some((name) => rangeEdits.current.has(name));
    update({
      ...(edited("from", "through")
        ? {
            dates: { from, through },
            periods:
              from || through
                ? [
                    {
                      key: "custom",
                      label: `${from || "Any start"} through ${through || "Any end"}`,
                      from: from ? `${from}T00:00:00Z` : undefined,
                      before: through ? nextDay(through) : undefined,
                    },
                  ]
                : [],
          }
        : {}),
      ...(edited("min", "max")
        ? {
            spans:
              min !== undefined || max !== undefined
                ? [
                    {
                      key: "custom",
                      label: `${min ?? 0} to ${max === undefined ? "any" : `<${max}`} days`,
                      min,
                      max,
                    },
                  ]
                : [],
          }
        : {}),
      ...(edited("emin", "emax")
        ? {
            eventRanges:
              emin !== undefined || emax !== undefined
                ? [
                    {
                      key: "custom",
                      label: `${emin ?? 0} to ${emax === undefined ? "any" : `<${emax}`} events`,
                      min: emin,
                      max: emax,
                    },
                  ]
                : [],
          }
        : {}),
    });
  };
  const chip = (id: string, label: string, remove: () => void) => (
    <button
      key={id}
      className="eda-chip"
      aria-label={`Remove ${label}`}
      onClick={remove}
    >
      {label}
      <X size={12} aria-hidden />
    </button>
  );
  const total = data?.summary.cases.total ?? 0;
  const n = data?.summary.cases.selected ?? 0;
  const unknownEvents =
    insights?.eventBins
      .filter((b) => b.missing)
      .reduce((sum, b) => sum + b.selected, 0) ?? 0;
  return (
    <section className="eda-workspace" aria-label="Explore dataset">
      <header className="eda-heading">
        <div className={showHeading ? undefined : "sr-only"}>
          <p className="mb-1 text-xs uppercase tracking-wide text-text-muted">Understand data</p>
          <h2>{pages.find((p) => p.key === mode)?.name ?? "Explore your event log"}</h2>
          <p>{pages.find((p) => p.key === mode)?.question}</p>
        </div>
        <details className="eda-explore-help">
          <summary>How to explore</summary>
          <div>
            <p>Start with the structure, follow a pattern, then inspect its records. No Process norm is needed.</p>
            <ul>{pages.map((p) => <li key={p.key}><strong>{p.name}:</strong> {p.question}</li>)}</ul>
            <p>One selection follows all four pages. Values within a field combine; different fields intersect.</p>
          </div>
        </details>
      </header>
      <nav className="eda-pages" aria-label="Exploration pages">
        {pages.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.question}
            aria-current={mode === p.key ? "page" : undefined}
            className={mode === p.key ? "active" : ""}
            onClick={() => changePage(p.key)}
          >
            <p.icon size={16} aria-hidden />
            <strong>{p.name}</strong>
          </button>
        ))}
      </nav>
      <div className="eda-scope" aria-label="Shared analysis selection">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong role="status" aria-live="polite">
              {isCurrent
                ? `${fmtInt(n)} of ${fmtInt(total)} cases selected`
                : query.isError
                  ? "Selection could not be evaluated"
                  : "Updating selection…"}
            </strong>
            <p className="text-xs text-text-muted">
              All charts use this selection. Change pages without losing filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                rangeEdits.current.clear();
                setEditor(!editor);
              }}
              aria-expanded={editor}
            >
              <SlidersHorizontal size={14} />
              Edit filters
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSaveOpen(!saveOpen)}
              aria-expanded={saveOpen}
            >
              Save / use selection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!undo}
              onClick={() => {
                if (undo) {
                  useAnalysisSelection.getState().update(key, undo);
                  setUndo(undefined);
                  setPage(1);
                }
              }}
            >
              <RotateCcw size={14} />
              Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasSelection}
              onClick={() => {
                setUndo(draft);
                useAnalysisSelection.getState().clear(key);
                setPage(1);
              }}
            >
              Reset selection
            </Button>
          </div>
        </div>
        {hasSelection && (
          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Current selection"
          >
            {draft.categories.map((r) =>
              chip(`legacy:${r.key}`, `${r.field}: ${r.label}`, () =>
                update({
                  categories: draft.categories.filter((x) => x.key !== r.key),
                }),
              ),
            )}
            {draft.facets?.map((f) =>
              chip(
                f.field,
                `${f.field}: ${f.choices.some((c) => /^v\d+$/.test(c.label)) ? `${f.choices.length} saved values` : f.choices.map((c) => c.label).join(" or ")}`,
                () => setFacet(f.field, []),
              ),
            )}
            {draft.numericFacets?.map((f) => chip(`numeric:${f.field}`, numericLabel(f), () => update({ numericFacets: draft.numericFacets?.filter((v) => v.field !== f.field) })))}
            {draft.jointAny?.map((b, i) => chip(`joint:${i}`, `OR path ${i + 1}: ${jointLabel(b)}`, () => update({ jointAny: draft.jointAny?.filter((_, index) => index !== i) })))}
            {draft.periods.map((r) =>
              chip(`time:${r.key}`, `First recorded: ${r.label}`, () =>
                update({
                  periods: draft.periods.filter((x) => x.key !== r.key),
                  dates: { from: "", through: "" },
                }),
              ),
            )}
            {draft.spans.map((r) =>
              chip(`span:${r.key}`, `Span: ${r.label}`, () =>
                update({ spans: draft.spans.filter((x) => x.key !== r.key) }),
              ),
            )}
            {draft.eventRanges?.map((r) =>
              chip(`events:${r.key}`, `Events: ${r.label}`, () =>
                update({
                  eventRanges: draft.eventRanges?.filter(
                    (x) => x.key !== r.key,
                  ),
                }),
              ),
            )}
          </div>
        )}
        {editor && (
          <form
            key={JSON.stringify([
              draft.dates,
              draft.periods,
              draft.spans,
              draft.eventRanges,
            ])}
            onChange={(e) => {
              if (e.target instanceof HTMLInputElement)
                rangeEdits.current.add(e.target.name);
            }}
            onSubmit={applyRanges}
            className="eda-filter-editor"
          >
            <p className="text-sm font-medium">Set exact ranges</p>
            <p className="text-xs text-text-muted">
              Only edited range groups change; all other filters stay active.
              Dates include both days; number maxima are exclusive. Use the
              chips above to remove a complete group.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label>
                First recorded · From
                <Input
                  name="from"
                  aria-label="From"
                  type="date"
                  defaultValue={draft.dates.from}
                />
              </label>
              <label>
                First recorded · Through
                <Input
                  name="through"
                  aria-label="Through"
                  type="date"
                  defaultValue={draft.dates.through}
                />
              </label>
              <div className="hidden lg:block" />
              <label>
                Recorded span ≥ days
                <Input
                  name="min"
                  aria-label="Recorded span ≥ days"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={
                    draft.spans.length === 1 ? draft.spans[0]!.min : ""
                  }
                />
              </label>
              <label>
                Recorded span &lt; days
                <Input
                  name="max"
                  aria-label="Recorded span < days"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={
                    draft.spans.length === 1 ? draft.spans[0]!.max : ""
                  }
                />
              </label>
              <span className="self-end pb-2 text-xs text-text-muted">
                Unknown spans stay separate from zero.
              </span>
              <label>
                Events ≥
                <Input
                  name="emin"
                  aria-label="Events at least"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={
                    draft.eventRanges?.length === 1
                      ? draft.eventRanges[0]!.min
                      : ""
                  }
                />
              </label>
              <label>
                Events &lt;
                <Input
                  name="emax"
                  aria-label="Events less than"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={
                    draft.eventRanges?.length === 1
                      ? draft.eventRanges[0]!.max
                      : ""
                  }
                />
              </label>
            </div>
            <Button size="sm" type="submit">
              Apply ranges
            </Button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        )}
        {saveOpen && (
          <div className="mt-4">
            <AnalysisSelectionBar
              projectId={projectId}
              datasetId={datasetId}
              caseTableId={caseTableId}
              selectedCases={isCurrent ? data?.summary.cases.selected : 0}
            />
          </div>
        )}
      </div>
      <div
        ref={results}
        aria-label="Exploration results"
        role="region"
        aria-busy={query.isPending || query.isFetching}
        style={{ minHeight: !isCurrent && height ? height : undefined }}
      >
        {(query.isPending || query.isPlaceholderData) && (
          <>
            <p role="status">
              Updating all charts and case details for this selection…
            </p>
            <LoadingBlock rows={8} />
          </>
        )}
        <section aria-label="Selected population summary" aria-busy={!isCurrent && !query.isError}>
        {data && <div hidden={!isCurrent}>
            <div className="eda-metrics">
              <div>
                <small>SELECTED CASES</small>
                <strong>{fmtInt(n)}</strong>
                <span>
                  {total ? fmtShare(n / total) : "—"} of prepared cases
                </span>
              </div>
              <div>
                <small>RECORDED EVENTS</small>
                <strong>
                  {n > 0 && unknownEvents === n
                    ? "Unknown"
                    : fmtInt(data.summary.events.selected)}
                </strong>
                <span>
                  {unknownEvents
                    ? `Known-count sum · ${fmtInt(unknownEvents)} cases have unknown event counts`
                    : "Within selected cases"}
                </span>
              </div>
              <div>
                <small>MEDIAN RECORDED SPAN</small>
                <strong>{days(data.summary.medianSpanDays)}</strong>
                <span>{fmtInt(data.summary.knownSpanCases)} known spans</span>
              </div>
              <div>
                <small>90TH PERCENTILE SPAN</small>
                <strong>{days(data.summary.p90SpanDays)}</strong>
                <span>
                  {fmtInt(data.summary.unknownSpanCases)} unknown spans
                </span>
              </div>
            </div>
        </div>}
        {!isCurrent && <p role="status" className="text-sm text-text-muted">{query.isError ? "Population summary unavailable for this selection." : "Updating selected-population summary…"}</p>}
      </section>
      {query.isError && (
          <ErrorBlock error={query.error} retry={() => void query.refetch()} />
        )}
        {data && (
          <div hidden={!isCurrent}>
            {n === 0 && (
              <div className="eda-empty">
                <strong>No cases match this selection</strong>
                <p>
                  Remove a filter above, use Undo, or reset to explore all
                  prepared cases.
                </p>
              </div>
            )}
            {mode === "atlas" && (
              <DataAtlas
                data={data}
                onExploreField={(field) => {
                  chooseField(field);
                  changePage("context");
                }}
                onMissingField={(field) => {
                  setFacet(field, [
                    { key: "missing", label: "Unknown / missing" },
                  ]);
                  changePage("context");
                }}
              />
            )}
            {mode === "time" && (
              <div className="eda-cells">
                <Cell
                  title="When do cases first appear?"
                  intro="Case arrivals by first recorded date. Drag across bars to select several periods, or toggle individual bars."
                >
                  {data.trendOmittedEmptyMonths > 0 && (
                    <p className="eda-note">
                      {fmtInt(data.trendOmittedEmptyMonths)} empty months
                      omitted. Gaps between bars are not to time scale; all
                      cases are retained.
                    </p>
                  )}
                  <LinkedBars
                    compact
                    title="Cases over time"
                    rows={data.trend}
                    color="var(--color-accent)"
                    activeKeys={data.trend
                      .filter((r) =>
                        draft.periods.some((v) =>
                          samePeriod(v, periodChoice(r)),
                        ),
                      )
                      .map((r) => r.key)}
                    onToggle={selectPeriod}
                    onRange={(keys) =>
                      update({
                        periods: data.trend
                          .filter((r) => keys.includes(r.key))
                          .map(periodChoice),
                        dates: { from: "", through: "" },
                      })
                    }
                  />
                  <p className="eda-note">
                    Each dated bar spans {data.trendMonthsPerBucket} month(s).
                    This counts first appearances, not completions. Use Edit
                    filters for exact dates. Aware timestamps use UTC; naive
                    timestamps retain their mapped clock.
                  </p>
                </Cell>
                <div className="eda-two">
                  <Cell
                    title="How widely do recorded spans vary?"
                    intro="First-to-last recorded time, in unequal day ranges. A long span is a question to investigate, not a measured delay."
                  >
                    <LinkedBars
                      compact
                      title="Recorded span"
                      rows={data.spans}
                      color="var(--color-accent)"
                      activeKeys={data.spans
                        .filter((r) =>
                          draft.spans.some((v) => sameSpan(v, spanChoice(r))),
                        )
                        .map((r) => r.key)}
                      onToggle={selectSpan}
                      onRange={(keys) =>
                        update({
                          spans: data.spans
                            .filter((r) => keys.includes(r.key))
                            .map(spanChoice),
                        })
                      }
                    />
                  </Cell>
                  {insights && (
                    <Cell
                      title="How much activity is recorded?"
                      intro="Recorded event counts per case. More records may reflect rework, richer logging, or a different process path."
                    >
                      <LinkedBars
                        compact
                        title="Events per case"
                        rows={insights.eventBins}
                        color="var(--color-accent)"
                        activeKeys={insights.eventBins
                          .filter((r) =>
                            draft.eventRanges?.some((v) =>
                              sameSpan(v, spanChoice(r)),
                            ),
                          )
                          .map((r) => r.key)}
                        onToggle={(k) => {
                          const r = insights.eventBins.find((r) => r.key === k);
                          if (r)
                            update({
                              eventRanges: toggleRange(
                                draft.eventRanges ?? [],
                                spanChoice(r),
                                sameSpan,
                              ),
                            });
                        }}
                        onRange={(keys) =>
                          update({
                            eventRanges: insights.eventBins
                              .filter((r) => keys.includes(r.key))
                              .map(spanChoice),
                          })
                        }
                      />
                    </Cell>
                  )}
                </div>
                {insights && (
                  <Cell
                    title="Where do long spans and dense records meet?"
                    intro="A full-population density map, not sampled case dots. Drag a rectangle to intersect span ranges with event-count ranges."
                  >
                    <LinkedDensity
                      compact
                      spans={data.spans}
                      events={insights.eventBins}
                      cells={insights.density}
                      onSelect={(spanKeys, eventKeys) =>
                        update({
                          spans: data.spans
                            .filter((r) => spanKeys.includes(r.key))
                            .map(spanChoice),
                          eventRanges: insights.eventBins
                            .filter((r) => eventKeys.includes(r.key))
                            .map(spanChoice),
                        })
                      }
                    />
                    <p className="eda-note">
                      Color shows selected case counts. Axes are discrete,
                      unequal ranges; unknown span has its own row. Selection
                      replaces both range groups and keeps context and date
                      filters.
                    </p>
                  </Cell>
                )}
              </div>
            )}
            {mode === "context" && (
              <div className="eda-context-layout">
                <div className="eda-context-controls">
                  <label>
                    Explore a context field
                    <select
                      value={data.attribute ?? ""}
                      onChange={(e) => chooseField(e.target.value)}
                    >
                      {data.attributes.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Connect it with
                    <select
                      value={insights?.compareAttribute ?? ""}
                      onChange={(e) => setCompareAttribute(e.target.value)}
                    >
                      <option value="" disabled>
                        Choose a second field
                      </option>
                      {data.attributes
                        .filter((a) => a !== data.attribute)
                        .map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                    </select>
                  </label>
                  <p>
                    Changing displayed fields keeps your existing filters.
                    Remove a chip to broaden the selection.
                  </p>
                </div>
                <div className="eda-context-facets">
                  {(
                    insights?.facets ??
                    (data.attribute
                      ? [{ field: data.attribute, categories: data.categories }]
                      : [])
                  ).map((f) => (
                    <Cell
                      key={f.field}
                      title={f.field}
                      intro="Select several values to combine them. Selections in the two fields intersect."
                    >
                      <LinkedBars
                        compact
                        title={f.field}
                        rows={f.categories.filter((r) => r.total > 0)}
                        horizontal
                        color={
                          "var(--color-accent)"
                        }
                        activeKeys={activeKeys(f.field)}
                        onToggle={(k) => {
                          const r = f.categories.find((r) => r.key === k);
                          if (r) selectCategory(f.field, r);
                        }}
                      />
                      <ExactValues scope={explorerScope} field={f.field} choices={facets().find((v) => v.field === f.field)?.choices ?? []} onChange={(choices) => setFacet(f.field, choices)} />
                      {insights?.fields.find((v) => v.name === f.field)?.numeric && <NumericRangeControl field={f.field} dataType={insights.fields.find((v) => v.name === f.field)!.dataType} current={draft.numericFacets?.find((v) => v.field === f.field)} onChange={(next) => update({ numericFacets: [...(draft.numericFacets ?? []).filter((v) => v.field !== f.field), ...(next ? [next] : [])] })} />}
                    </Cell>
                  ))}
                </div>
                {insights &&
                  insights.compareAttribute &&
                  insights.joint.length > 0 && (
                    <Cell
                      title="How are contexts connected?"
                      intro="Follow the same cases across two attributes. This is membership, not a sequence of process activities."
                    >
                      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={pairUnion || Boolean(draft.jointAny?.length)} onChange={(e) => setPairUnion(e.target.checked)} disabled={Boolean(draft.jointAny?.length)} /> Combine exact pairs with OR</label>
                      <p className="eda-note">{pairUnion || draft.jointAny?.length ? "Each selected connection is one complete pair. Different pairs join with OR, retaining unrelated filters. Remove OR-path chips to clear the union." : "Select one exact pair, or enable OR to retain several separate pairs without introducing cross-combinations."}</p>
                      <div className="overflow-x-auto">
                        <ContextGraph
                          left={insights.facets[0]!.categories}
                          right={insights.facets[1]!.categories}
                          rows={insights.joint}
                          leftField={data.attribute!}
                          rightField={insights.compareAttribute}
                          onPair={pair}
                        />
                      </div>
                    </Cell>
                  )}
                <div className="eda-cell">
                  <h3>Keep separate combinations together</h3>
                  <p className="eda-caption">Move one to three active context field filters into a single OR path. This also supports exact values found through search. Add another combination to expand the union; numeric and date restrictions still apply.</p>
                  <Button variant="outline" disabled={facets().length < 1 || facets().length > 3 || (draft.jointAny?.length ?? 0) >= 24} onClick={() => toggleJoint({ facets: facets().map((f) => ({ field: f.field, keys: f.choices.filter((c) => c.value === undefined && (c.key === "other" || c.key === "missing")).map((c) => c.key), ...(f.choices.some((c) => c.value !== undefined || (c.key !== "other" && c.key !== "missing")) ? { values: f.choices.flatMap((c) => c.value !== undefined ? [c.value] : c.key === "other" || c.key === "missing" ? [] : [c.label]) } : {}) })) })}>Keep field filters as one OR path</Button>
                </div>
                <ContextHierarchy scope={explorerScope} attributes={data.attributes} branches={draft.jointAny ?? []} onToggle={toggleJoint} />
                {insights && (
                  <Cell
                    title="Where are the longer recorded spans concentrated?"
                    intro="Compare groups within the current selection. Read case volume alongside median and tail; small groups can be unstable."
                  >
                    <ConcentrationPlot
                      rows={insights.concentration}
                      onSelect={(keys) =>
                        setFacet(
                          data.attribute!,
                          keys.map((key) => ({
                            key,
                            label:
                              insights.concentration.find((r) => r.key === key)
                                ?.label ?? key,
                          })),
                        )
                      }
                    />
                    <Table>
                      <thead>
                        <tr>
                          <Th>{data.attribute}</Th>
                          <Th numeric>Selected cases</Th>
                          <Th numeric>Share of selection</Th>
                          <Th numeric>Median span</Th>
                          <Th numeric>90th percentile</Th>
                          <Th numeric>Span coverage</Th>
                          <Th numeric>Events</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...insights.concentration]
                          .filter((r) => r.selected > 0)
                          .sort(
                            (a, b) =>
                              (b.p90SpanDays ?? -1) - (a.p90SpanDays ?? -1),
                          )
                          .map((r) => (
                            <tr key={r.key}>
                              <Td>
                                <button
                                  className="text-accent-text underline"
                                  onClick={() =>
                                    setFacet(data.attribute!, [
                                      { key: r.key, label: r.label },
                                    ])
                                  }
                                >
                                  {r.label}
                                </button>
                              </Td>
                              <Td numeric>{fmtInt(r.selected)}</Td>
                              <Td numeric>
                                {n ? fmtShare(r.selected / n) : "—"}
                              </Td>
                              <Td numeric>{days(r.medianSpanDays)}</Td>
                              <Td numeric>{days(r.p90SpanDays)}</Td>
                              <Td numeric>
                                {fmtInt(r.knownSpanCases)} known ·{" "}
                                {fmtInt(r.unknownSpanCases)} unknown
                              </Td>
                              <Td numeric>
                                {r.unknownEventCases === r.selected
                                  ? "Unknown"
                                  : fmtInt(r.events)}
                                {r.unknownEventCases > 0 && (
                                  <small className="block text-text-muted">
                                    {fmtInt(r.unknownEventCases)} unknown counts
                                  </small>
                                )}
                              </Td>
                            </tr>
                          ))}
                      </tbody>
                    </Table>
                    <p className="eda-note">
                      Ordered by recorded-span p90. This is an exploratory
                      association, not a root-cause ranking or a norm violation.
                    </p>
                  </Cell>
                )}
              </div>
            )}
            {mode === "evidence" && (
              <Cell
                title="Cases behind this selection"
                intro="Inspect the actual prepared cases before drawing a conclusion. Newest first-recorded date first; every page uses the same filter."
              >
                <div role="region" aria-label="Selected case details">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Case</Th>
                        <Th>{data.attribute ?? "Context"}</Th>
                        <Th numeric>Events</Th>
                        <Th>First recorded</Th>
                        <Th>Last recorded</Th>
                        <Th numeric>Recorded span</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.details.rows.map((r) => (
                        <tr key={r.caseId}>
                          <Td className="font-mono text-xs"><button className="text-accent-text underline" aria-label={`Inspect event trace for ${r.caseId}`} onClick={() => setTraceCaseId(r.caseId)}>{r.caseId}</button></Td>
                          <Td>{r.category ?? "Unknown"}</Td>
                          <Td numeric>
                            {r.events === null ? "Unknown" : fmtInt(r.events)}
                          </Td>
                          <Td className="text-xs">
                            {r.firstRecorded?.replace("T", " ") ?? "Unknown"}
                          </Td>
                          <Td className="text-xs">
                            {r.lastRecorded?.replace("T", " ") ?? "Unknown"}
                          </Td>
                          <Td numeric>{days(r.spanDays)}</Td>
                        </tr>
                      ))}
                      {!data.details.rows.length && (
                        <tr>
                          <Td colSpan={6}>No cases to display.</Td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                  <div className="mt-4 flex items-center justify-end gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous cases
                    </Button>
                    <span className="text-xs">
                      Page {page} of{" "}
                      {Math.max(
                        1,
                        Math.ceil(data.details.total / data.details.pageSize),
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        page * data.details.pageSize >= data.details.total
                      }
                      onClick={() => setPage(page + 1)}
                    >
                      Next cases
                    </Button>
                  </div>
                </div>
                <div className="eda-handoff">
                  <div>
                    <strong>Keep this population for your analysis</strong>
                    <p>
                      Save an exact case cohort, then explore its process flows
                      and assess it with a norm.
                    </p>
                  </div>
                  <Button onClick={() => setSaveOpen(true)}>
                    Save / use selection
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </Cell>
            )}
            {(mode === "evidence" || mode === "time") && <EventEvidence scope={explorerScope} traceCaseId={traceCaseId} onCloseTrace={() => setTraceCaseId(undefined)} />}
            {!insights && (
              <p className="eda-note">
                Detailed profiles are unavailable for this response. Time,
                context counts and case evidence remain available.
              </p>
            )}
            <div className="eda-footer">
              <p>
                Span = first-to-last recorded timestamp. Business completion is
                unknown.
                <br />
                All aggregates use the prepared case table; pale chart context
                retains the whole population.
              </p>
              {mode !== "evidence" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    changePage(
                      pages[pages.findIndex((p) => p.key === mode) + 1]!.key,
                    )
                  }
                >
                  Next:{" "}
                  {pages[pages.findIndex((p) => p.key === mode) + 1]!.name}
                  <ArrowRight size={14} />
                </Button>
              )}
            </div>
            <details className="eda-methods">
              <summary>Definitions, coverage and limits</summary>
              <ul>
                {data.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
export function DataExploration(props: DataExplorationProps) {
  if (!props.caseTableId)
    return (
      <Card role="region" aria-label="Explore dataset">
        <h2 className="font-semibold">Explore this dataset</h2>
        <p className="mt-2 text-sm text-text-muted">
          Build a case table from the column mapping to explore cases, recorded
          spans and categories. No norm is required.
        </p>
        <a
          className="mt-3 inline-block text-sm font-medium text-accent-text underline"
          href={`/p/${encodeURIComponent(props.projectId)}/data/${encodeURIComponent(props.datasetId)}?tab=mapping`}
        >
          Review column mapping
        </a>
      </Card>
    );
  return (
    <Exploration
      key={`${props.projectId}:${props.datasetId}:${props.caseTableId}`}
      {...props}
      caseTableId={props.caseTableId}
    />
  );
}
export default DataExploration;
