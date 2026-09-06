import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowGraph } from "@wise/api-schema";
import { canonicalOverlays, defaultStyle, diff, diffStyle, filterPositions, palettes, type FlowGraph as LibraryGraph } from "@wise/flow";
import { ProcessMap, useStableLayout, type Selection } from "@wise/flow/react";
import { useNodesInitialized, useReactFlow } from "@xyflow/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import "@xyflow/react/dist/style.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
import type { Filter, FilterClause, FilterPreview, FlowPath } from "@/lib/api/cycle2";
import { FilterChipsRow } from "@/components/guide/FilterChipsRow";
import { Button } from "@/components/ui/button";
import { addClause, clauseForActivity, describeClause, mapActivities } from "@/lib/filter";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The contract's FlowGraph is the library's model; nulls become undefined. */
export function toLibraryGraph(g: FlowGraph): LibraryGraph {
  return {
    nodes: g.nodes.map((n) => ({ ...n, group: n.group ?? undefined })),
    edges: g.edges.map((e) => ({ ...e })),
    groups: (g.groups ?? []).map((x) => ({ ...x, parent: x.parent ?? undefined })),
    overlays: g.overlays ?? [],
    meta: g.meta,
  } as unknown as LibraryGraph;
}

/** The map's actions the screens answer beyond the filter (the library handles paths and collapse itself). */
export interface MapAction {
  id: string;
  /** Activity ids the action concerns. */
  ids: string[];
  label: string;
}

export interface FlowMapProps {
  /** The scene to show (the whole log or one group). */
  graph: FlowGraph;
  /** The whole log when `graph` is a group: positions are shared and a compare toggle draws the difference. */
  baseline?: FlowGraph;
  title: string;
  height?: number;
  className?: string;
  /** The filter model of the screen; the map's filter actions add clauses (activity labels, as the backend expects) through `onFilterChange`. */
  filter?: Filter;
  preview?: FilterPreview;
  onFilterChange?: (filter: Filter | undefined) => void;
  /** Show the chips row in the bar above the map (off when the screen shows the row itself). */
  chips?: boolean;
  /** Activity whose incoming and outgoing paths are highlighted and listed. */
  focus?: string | null;
  onFocusChange?: (activity: string | undefined) => void;
  /** Paths of the focused activity from `GET …/flow?focus=` when the backend served them. */
  paths?: { incoming?: FlowPath[]; outgoing?: FlowPath[] } | null;
  /** Actions the map cannot answer itself: `lens` (the distribution of the expectations touching an activity), `worst-cases`. */
  onAction?: (action: MapAction) => void;
  /** Activities to highlight (the top drivers on the reason screen). */
  highlight?: string[];
  /** Stage lanes along the flow. */
  lanes?: "stages" | "none";
  /** Small map without controls, legend or menu (the flow-type cards). */
  compact?: boolean;
  /** The plain phrase of an expectation, for the footnote and the selected card. */
  plainOf?: (constraintId: string) => string;
  /** The business name of a case. */
  noun?: string;
  /** Text for the map's live region. */
  announce?: string;
}

export const labelOf = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
const idOf = (g: FlowGraph, label: string) => g.nodes.find((n) => n.label === label)?.id ?? label;

/** One control from "stages only" to "all activities"; the paths follow the activities. */
const DETAIL: { label: string; abstraction: { minNodeShare: number; minEdgeShare: number; keepConnected: true; collapse?: "all" } }[] = [
  { label: "stages only", abstraction: { minNodeShare: 0, minEdgeShare: 0, keepConnected: true, collapse: "all" } },
  { label: "the main activities", abstraction: { minNodeShare: 0.2, minEdgeShare: 0.2, keepConnected: true } },
  { label: "the frequent activities", abstraction: { minNodeShare: 0.1, minEdgeShare: 0.1, keepConnected: true } },
  { label: "most activities", abstraction: { minNodeShare: 0.05, minEdgeShare: 0.05, keepConnected: true } },
  { label: "nearly all activities", abstraction: { minNodeShare: 0.02, minEdgeShare: 0.03, keepConnected: true } },
  { label: "all activities", abstraction: { minNodeShare: 0, minEdgeShare: 0, keepConnected: true } },
];
const DEFAULT_DETAIL = 4;

/** Fits the view to the laid-out graph (5 % padding) and again whenever the map's box changes size. */
function FitToView({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const rf = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized) return;
    const handle = window.setTimeout(() => void rf.fitView({ padding: 0.05, duration: 0 }), 500);
    return () => window.clearTimeout(handle);
  }, [initialized, rf]);
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      void rf.fitView({ padding: 0.05, duration: 0 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, rf]);
  return null;
}

/** The legend as a fixed column: only the encodings in use, with a glyph or a label beside every colour. */
function MapLegend({ graph, compare, className }: { graph: LibraryGraph; compare: boolean; className?: string }) {
  const counts = graph.edges.filter((e) => (e as { kind?: string }).kind === "follows").map((e) => Number((e as { metrics?: Record<string, number> }).metrics?.count ?? NaN)).filter((n) => Number.isFinite(n));
  const min = counts.length ? Math.min(...counts) : 0;
  const max = counts.length ? Math.max(...counts) : 0;
  const kinds = new Set((graph.overlays ?? []).map((o) => (o as { kind: string }).kind));
  const selfLoops = graph.edges.some((e) => e.source === e.target);
  const stops = compare ? palettes.diverging : palettes.sequential;
  return (
    <aside className={cn("flex w-[200px] shrink-0 flex-col gap-3 rounded-md border border-border bg-surface p-3 text-xs text-text-muted", className)} aria-label="Legend" data-testid="map-legend">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">Legend</p>
      {counts.length > 0 && (
        <div>
          <p className="font-medium text-text">path width</p>
          <p>cases on the path</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="block h-px w-8 bg-text-muted" aria-hidden />
            <span className="tnum">{fmtInt(min)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="block h-2 w-8 rounded-sm bg-text-muted" aria-hidden />
            <span className="tnum">{fmtInt(max)}</span>
          </div>
        </div>
      )}
      <div>
        <p className="font-medium text-text">path colour</p>
        <p>{compare ? "difference to everyone else" : "share of cases missing an expectation"}</p>
        <div className="mt-1 h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }} aria-hidden />
        <div className="flex justify-between">
          {compare ? (
            <>
              <span>better here</span>
              <span>same</span>
              <span>worse here</span>
            </>
          ) : (
            <>
              <span>0 %</span>
              <span>100 % missed</span>
            </>
          )}
        </div>
      </div>
      {(kinds.has("badge") || kinds.has("arc") || kinds.has("hatch") || selfLoops) && (
        <dl className="flex flex-col gap-1">
          {kinds.has("badge") && (
            <div className="flex gap-2">
              <dt aria-hidden>▲</dt>
              <dd>badge: the worst expectation at this activity, with its share</dd>
            </div>
          )}
          {kinds.has("arc") && (
            <div className="flex gap-2">
              <dt aria-hidden>⌒</dt>
              <dd>arc: a waiting-time or order expectation between two activities</dd>
            </div>
          )}
          {selfLoops && (
            <div className="flex gap-2">
              <dt aria-hidden>↻</dt>
              <dd>repeated execution</dd>
            </div>
          )}
          {kinds.has("hatch") && (
            <div className="flex gap-2">
              <dt aria-hidden>▨</dt>
              <dd>outside the expectation's scope</dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-text-subtle">Lanes are the stages of the process, in their order; an activity sits in its stage.</p>
    </aside>
  );
}

/**
 * Process map from `GET /runs/{id}/flow` on the flow library 0.3, the map first: the union of the group and
 * the whole log is laid out once so that switching between them never moves an activity; one detail control
 * and the count of cases sit in a bar above the map, the legend in a column beside it, nothing floats over
 * it. A single click selects an activity and opens its card under the map with the four actions; a right
 * click (or Enter) opens the full menu. The filter actions write the screen's filter model with activity
 * labels (the backend's contract), the paths action focuses the activity.
 */
export function FlowMap({ graph, baseline, title, height = 560, className, filter, preview, onFilterChange, chips = true, focus, onFocusChange, paths, onAction, highlight, lanes = "stages", compact, plainOf, noun = "cases", announce }: FlowMapProps) {
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<"map" | "table">("map");
  const [detail, setDetail] = useState(DEFAULT_DETAIL);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
  const container = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => toLibraryGraph(graph), [graph]);
  const base = useMemo(() => (baseline ? toLibraryGraph(baseline) : undefined), [baseline]);
  const scenes = useMemo(() => (base ? [base, scene] : [scene]), [base, scene]);
  const layout = useStableLayout(scenes, { elkWorkerUrl });
  const shown = useMemo(() => (compare && base ? diff(base, scene) : scene), [compare, base, scene]);
  const positions = useMemo(() => (layout.positions ? filterPositions(layout.positions, shown) : undefined), [layout.positions, shown]);
  const overlays = useMemo(() => {
    const own = canonicalOverlays(shown.overlays ?? []);
    if (!highlight?.length) return own;
    // a tint on the activities of the top drivers, on top of the constraint overlays
    return [...own, ...highlight.map((id) => ({ kind: "tint" as const, target: id, payload: { label: "top driver", value: 1, text: "activity of a top expectation behind the shortfall" } }))];
  }, [shown, highlight]);
  const meta = (graph.meta ?? {}) as { cases?: number; events?: number; nodesTotal?: number; stagedActivities?: number; constraintsWithoutNodes?: string[] };
  const libraryPaths = useMemo(() => {
    if (!focus || !paths) return undefined;
    const clean = (p: FlowPath) => ({ ...p, median_lag: p.median_lag ?? undefined, violation_share: p.violation_share ?? undefined });
    return { focus, incoming: (paths.incoming ?? []).map(clean), outgoing: (paths.outgoing ?? []).map(clean) };
  }, [focus, paths]);
  // stage colours are not an encoding: white boxes, the lane says the stage
  const style = useMemo(() => (compare ? { ...diffStyle, nodeColor: undefined } : { ...defaultStyle, nodeColor: undefined }), [compare]);
  const plain = useCallback((id: string) => plainOf?.(id) ?? id, [plainOf]);

  const applyClauses = useCallback(
    (clauses: FilterClause[]): string | undefined => {
      if (!onFilterChange) return undefined;
      // the map speaks in node ids; the backend's filter expects activity labels
      const labelled = clauses.map((c) => mapActivities(c, (id) => labelOf(graph, id)));
      let next = filter;
      for (const c of labelled) next = addClause(next, c);
      onFilterChange(next && next.and.length ? next : undefined);
      return `Filter added: ${labelled.map((c) => describeClause(c)).join("; ")}.`;
    },
    [filter, graph, onFilterChange],
  );

  if (compact) {
    return (
      <div className={cn("overflow-hidden rounded-md border border-border bg-surface", className)} style={{ height }} data-testid="mini-map">
        <ProcessMap
          graph={shown}
          positions={positions}
          overlays={overlays}
          style={style}
          defaultAbstraction={{ minNodeShare: 0.08, minEdgeShare: 0.12, keepConnected: true }}
          controls={false}
          legend={false}
          minimap={false}
          contextMenu={false}
          selfLoops={false}
          lod={{ labels: 0, edgeLabels: 99, badges: 99, arcs: 99, chips: 99, hatch: 99, selfLoops: 99 }}
          locale="en"
          layout={{ elkWorkerUrl }}
          ariaLabel={title}
          containerStyle={{ height: "100%" }}
        />
      </div>
    );
  }

  const shownActivities = shown.nodes.filter((n) => (n as { kind?: string }).kind === "activity").length;
  const selectedId = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId && n.kind === "activity") : undefined;
  const selectedWorst = selected
    ? (graph.overlays ?? [])
        .filter((o) => o.target === selected.id && o.kind === "badge" && typeof o.payload?.constraintId === "string" && typeof o.payload?.value === "number")
        .sort((a, b) => Number(b.payload?.value) - Number(a.payload?.value))[0]
    : undefined;
  const cases = meta.cases ?? 0;

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="flow-map">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-testid="flow-bar">
        {chips && onFilterChange ? (
          <FilterChipsRow filter={filter} preview={preview} noun={noun} onChange={onFilterChange} className="min-w-0 flex-1" />
        ) : (
          <span className="tnum text-text-muted">
            {noun} in: <strong className="text-text">{fmtInt(preview && filter?.and.length ? preview.cases_in : cases)}</strong> of {fmtInt(preview && filter?.and.length ? preview.cases_in + preview.cases_out : cases)}
          </span>
        )}
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <span>detail</span>
          <input
            type="range"
            min={0}
            max={DETAIL.length - 1}
            step={1}
            value={detail}
            aria-label="Detail of the map, from stages only to all activities"
            aria-valuetext={DETAIL[detail]?.label}
            onChange={(e) => setDetail(Number(e.target.value))}
            className="w-32 accent-[var(--color-accent)]"
          />
          <span className="whitespace-nowrap" data-testid="detail-label">
            {DETAIL[detail]?.label} · {shownActivities} of {meta.nodesTotal ?? shownActivities}
          </span>
        </label>
        {layout.status === "pending" && <span aria-live="polite">placing {shownActivities} activities…</span>}
        {layout.status === "error" && <span role="alert">layout failed: {layout.error?.message}</span>}
        <span className="ml-auto flex items-center gap-1">
          {baseline &&
            (compare ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle py-0.5 pl-2.5 pr-1 text-xs text-accent-text" data-testid="compare-state">
                showing the difference to everyone else
                <button type="button" aria-label="Stop comparing with everyone else" onClick={() => setCompare(false)} className="rounded-full px-1 hover:bg-surface">
                  ×
                </button>
              </span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setCompare(true)}>
                compare with everyone else
              </Button>
            ))}
          <Button variant="outline" size="sm" aria-pressed={view === "table"} onClick={() => setView((v) => (v === "map" ? "table" : "map"))}>
            {view === "map" ? "table alternative" : "map"}
          </Button>
        </span>
      </div>
      <div className="flex items-stretch gap-3">
        <div ref={container} style={{ height }} className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-surface">
          <ProcessMap
            graph={shown}
            positions={positions}
            overlays={overlays}
            style={style}
            abstraction={DETAIL[detail]?.abstraction}
            controls={false}
            legend={false}
            minimap={false}
            view={view}
            onViewChange={setView}
            locale="en"
            layout={{ elkWorkerUrl }}
            ariaLabel={title}
            containerStyle={{ height: "100%" }}
            lanes={lanes}
            focus={focus === undefined ? undefined : (focus ?? null)}
            onFocusChange={(f) => onFocusChange?.(typeof f === "string" ? f : Array.isArray(f) ? f[0] : undefined)}
            paths={libraryPaths}
            onSelect={setSelection}
            onAction={(action, target) => {
              if ((action.id === "filter-to" || action.id === "exclude") && action.clause) return applyClauses((Array.isArray(action.clause) ? action.clause : [action.clause]) as unknown as FilterClause[]);
              if (action.id === "lens" || action.id === "worst-cases") onAction?.({ id: action.id, ids: target.ids, label: target.label });
              if (action.id === "paths" && target.ids[0]) onFocusChange?.(target.ids[0]);
              if (action.id === "clear-focus") onFocusChange?.(undefined);
              return undefined;
            }}
            announce={announce}
          >
            <FitToView container={container} />
          </ProcessMap>
        </div>
        <MapLegend graph={shown} compare={compare} />
      </div>
      {selected && (
        <div className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="selected-activity">
          <p className="reading min-w-0 flex-1">
            <strong>{selected.label}</strong>
            {" — "}
            {selected.metrics?.cases !== undefined ? (
              <>
                <span className="tnum">{fmtInt(selected.metrics.cases)}</span> {noun}
                {cases > 0 ? ` (${fmtPct(selected.metrics.cases / cases, selected.metrics.cases / cases < 0.1 ? 1 : 0)})` : ""}
              </>
            ) : null}
            {selected.metrics?.eventsPerCase !== undefined ? ` · ${fmtNum(selected.metrics.eventsPerCase, 1)} events per case` : ""}
            {selectedWorst ? ` · worst expectation touching it: ${plain(String(selectedWorst.payload?.constraintId))} (missed in ${fmtPct(Number(selectedWorst.payload?.value), 0)})` : ""}
          </p>
          <span className="flex flex-wrap gap-2">
            {onFilterChange && (
              <>
                <Button variant="outline" size="sm" onClick={() => applyClauses([clauseForActivity(selected.id, "keep")])}>
                  Filter to cases with it
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyClauses([clauseForActivity(selected.id, "exclude")])}>
                  Exclude cases with it
                </Button>
              </>
            )}
            {onFocusChange && (
              <Button variant="outline" size="sm" onClick={() => onFocusChange(focus === selected.id ? undefined : selected.id)}>
                {focus === selected.id ? "Hide the paths" : "Paths in / out"}
              </Button>
            )}
            {onAction && (
              <Button variant="outline" size="sm" onClick={() => onAction({ id: "lens", ids: [selected.id], label: selected.label })}>
                Lens
              </Button>
            )}
          </span>
        </div>
      )}
      <p className="text-xs text-text-subtle">
        Click an activity for its card; right-click it or a path (or press Enter on it) for every action.
        {focus ? ` Paths of ${labelOf(graph, focus)} are shown; Escape clears them.` : ""}
      </p>
      {meta.constraintsWithoutNodes && meta.constraintsWithoutNodes.length > 0 && (
        <p className="text-xs text-text-subtle" data-testid="map-footnote">
          {meta.constraintsWithoutNodes.length} expectations are about case attributes rather than activities and have no place on the map: {meta.constraintsWithoutNodes.map((id) => plain(id)).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** A small map for a card: activities and the strongest paths, no controls. */
export function MiniMap({ graph, title, height = 170, className }: { graph: FlowGraph; title: string; height?: number; className?: string }) {
  return <FlowMap graph={graph} title={title} height={height} className={className} compact lanes="none" />;
}

/** The activity ids a filter refers to, for hosts that still hold labels: labels back to ids of this graph. */
export function filterWithIds(graph: FlowGraph, filter: Filter | undefined): Filter | undefined {
  return filter ? { and: filter.and.map((c) => mapActivities(c, (label) => idOf(graph, label))) } : undefined;
}

export default FlowMap;
