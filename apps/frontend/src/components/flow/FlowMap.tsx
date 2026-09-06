import { useMemo, useState } from "react";
import type { FlowGraph } from "@wise/api-schema";
import { canonicalOverlays, defaultStyle, diff, diffStyle, filterPositions, type FlowGraph as LibraryGraph } from "@wise/flow";
import { ProcessMap, useStableLayout } from "@wise/flow/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import "@xyflow/react/dist/style.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
import type { Filter, FilterPreview, FlowPath } from "@/lib/api/cycle2";
import { Button } from "@/components/ui/button";
import { fmtInt } from "@/lib/format";
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

/** The map's actions the screens answer beyond the filter (the library handles filter-to, exclude, paths, collapse itself). */
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
  /** The filter model of the screen (RF-01); the map's filter actions add clauses through `onFilterChange`. */
  filter?: Filter;
  preview?: FilterPreview;
  onFilterChange?: (filter: Filter | undefined) => void;
  /** Activity whose incoming and outgoing paths are highlighted and listed (RF-12). */
  focus?: string | null;
  onFocusChange?: (activity: string | undefined) => void;
  /** Paths of the focused activity from `GET …/flow?focus=` when the backend served them. */
  paths?: { incoming?: FlowPath[]; outgoing?: FlowPath[] } | null;
  /** Actions the map cannot answer itself: `lens` (the distribution of the expectations touching an activity), `worst-cases`. */
  onAction?: (action: MapAction) => void;
  /** Activities to highlight (the top drivers on the reason screen). */
  highlight?: string[];
  /** Stage lanes along the flow (0.3). */
  lanes?: "stages" | "none";
  /** Small map without controls, legend or menu (the flow-type cards). */
  compact?: boolean;
}

const labelOf = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;

/**
 * Process map from `GET /runs/{id}/flow` on the flow library 0.3: the union of the group and the whole log is
 * laid out once so that switching between them never moves an activity; the compare toggle colours the paths
 * by the difference in cases missing expectations; a right click (or Enter) opens the actions menu whose
 * filter actions write the screen's filter model and whose paths action focuses the activity.
 */
export function FlowMap({ graph, baseline, title, height = 540, className, filter, preview, onFilterChange, focus, onFocusChange, paths, onAction, highlight, lanes = "stages", compact }: FlowMapProps) {
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<"map" | "table">("map");
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
  const filterPreview = useMemo(
    () => (preview ? { casesIn: preview.cases_in, casesOut: preview.cases_out, perClause: (preview.per_clause ?? []).map((p) => ({ clause: Number(p.clause ?? 0), removedMarginally: Number(p.removed_marginally ?? 0) })), inScopeByConstraint: preview.in_scope_by_constraint } : undefined),
    [preview],
  );

  if (compact) {
    return (
      <div className={cn("overflow-hidden rounded-md border border-border bg-surface", className)} style={{ height }} data-testid="mini-map">
        <ProcessMap
          graph={shown}
          positions={positions}
          overlays={overlays}
          style={defaultStyle}
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

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="flow-map">
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <span>
          {fmtInt(meta.cases)} cases · {fmtInt(meta.events)} events · {shown.nodes.filter((n) => n.kind === "activity").length} of {meta.nodesTotal ?? "?"} activities shown
          {meta.stagedActivities ? ` · ${meta.stagedActivities} placed in stages` : ""}
        </span>
        {layout.status === "pending" && <span aria-live="polite">laying out…</span>}
        {layout.status === "error" && <span role="alert">layout failed: {layout.error?.message}</span>}
        <span className="ml-auto flex items-center gap-1">
          {baseline && (
            <Button variant={compare ? "default" : "outline"} size="sm" aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
              {compare ? "showing the difference to everyone else" : "compare with everyone else"}
            </Button>
          )}
          <Button variant="outline" size="sm" aria-pressed={view === "table"} onClick={() => setView((v) => (v === "map" ? "table" : "map"))}>
            {view === "map" ? "table alternative" : "map"}
          </Button>
        </span>
      </div>
      <div style={{ height }} className="overflow-hidden rounded-md border border-border bg-surface">
        <ProcessMap
          graph={shown}
          positions={positions}
          overlays={overlays}
          style={compare ? diffStyle : defaultStyle}
          defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true }}
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
          filters={filter && filter.and.length ? (filter as never) : undefined}
          filterPreview={filter ? filterPreview : undefined}
          onFilterChange={onFilterChange ? (f) => onFilterChange(f.and.length ? (f as unknown as Filter) : undefined) : undefined}
          onAction={(action, target) => {
            if (action.id === "lens" || action.id === "worst-cases") onAction?.({ id: action.id, ids: target.ids, label: target.label });
            if (action.id === "paths" && target.ids[0]) onFocusChange?.(target.ids[0]);
            if (action.id === "clear-focus") onFocusChange?.(undefined);
            return undefined;
          }}
          announce={filter?.and.length ? `${filter.and.length} filter clause${filter.and.length === 1 ? "" : "s"} active` : undefined}
        />
      </div>
      <p className="text-xs text-text-subtle">
        Right-click an activity or a path (or press Enter on it) for the actions: filter to it, exclude it, show its paths, open the distribution of the expectations touching it.
        {focus ? ` Paths of ${labelOf(graph, focus)} are shown; Escape clears them.` : ""}
      </p>
      {meta.constraintsWithoutNodes && meta.constraintsWithoutNodes.length > 0 && (
        <p className="text-xs text-text-subtle">{meta.constraintsWithoutNodes.length} expectations are about case attributes rather than activities and have no place on the map: {meta.constraintsWithoutNodes.join(", ")}.</p>
      )}
    </div>
  );
}

/** A small map for a card: activities and the strongest paths, no controls. */
export function MiniMap({ graph, title, height = 170, className }: { graph: FlowGraph; title: string; height?: number; className?: string }) {
  return <FlowMap graph={graph} title={title} height={height} className={className} compact lanes="none" />;
}

export default FlowMap;
