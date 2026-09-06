import { useMemo, useState } from "react";
import type { FlowGraph } from "@wise/api-schema";
import { canonicalOverlays, defaultStyle, diff, diffStyle, filterPositions, type FlowGraph as LibraryGraph } from "@wise/flow";
import { ProcessMap, useStableLayout } from "@wise/flow/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import "@xyflow/react/dist/style.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
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

export interface FlowMapProps {
  /** The scene to show (the whole log or one group). */
  graph: FlowGraph;
  /** The whole log when `graph` is a group: positions are shared and a compare toggle draws the difference. */
  baseline?: FlowGraph;
  title: string;
  height?: number;
  className?: string;
}

/**
 * Process map from `GET /runs/{id}/flow` on the flow library: the union of the group and the whole log is
 * laid out once so that switching between them never moves an activity; the compare toggle colours the
 * paths by the difference in cases missing expectations; the library's controls offer abstraction sliders
 * and the table alternative.
 */
export function FlowMap({ graph, baseline, title, height = 540, className }: FlowMapProps) {
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<"map" | "table">("map");
  const scene = useMemo(() => toLibraryGraph(graph), [graph]);
  const base = useMemo(() => (baseline ? toLibraryGraph(baseline) : undefined), [baseline]);
  const scenes = useMemo(() => (base ? [base, scene] : [scene]), [base, scene]);
  const layout = useStableLayout(scenes, { elkWorkerUrl });
  const shown = useMemo(() => (compare && base ? diff(base, scene) : scene), [compare, base, scene]);
  const positions = useMemo(() => (layout.positions ? filterPositions(layout.positions, shown) : undefined), [layout.positions, shown]);
  const overlays = useMemo(() => canonicalOverlays(shown.overlays ?? []), [shown]);
  const meta = (graph.meta ?? {}) as { cases?: number; events?: number; nodesTotal?: number; stagedActivities?: number; constraintsWithoutNodes?: string[] };

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
        />
      </div>
      {meta.constraintsWithoutNodes && meta.constraintsWithoutNodes.length > 0 && (
        <p className="text-xs text-text-subtle">{meta.constraintsWithoutNodes.length} expectations are about case attributes rather than activities and have no place on the map: {meta.constraintsWithoutNodes.join(", ")}.</p>
      )}
    </div>
  );
}

export default FlowMap;
