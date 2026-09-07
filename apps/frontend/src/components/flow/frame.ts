/**
 * The geometry of the map's frame (`docs/panel/ui_design_cycle3_board.md` §3.2): the detail levels, which of
 * them a frame can draw with readable labels, the zoom a fit chooses, and the stretch that makes a wide
 * process graph the shape of its frame. Nothing here reads or writes the DOM, so all of it is testable and
 * none of it can take part in a resize loop.
 */
/**
 * The part of a scene this module reads, written structurally so that both the contract's `FlowGraph` and
 * the flow library's own graph satisfy it.
 */
export interface SceneNode {
  id: string;
  kind?: string;
  group?: string | null;
  metrics?: Record<string, number>;
}
export interface SceneEdge {
  id?: string;
  source: string;
  target: string;
  kind?: string;
  metrics?: Record<string, number>;
}
export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  groups?: { id: string; kind?: string }[];
  overlays?: { kind?: string; target?: string; payload?: unknown }[];
}

/** One control from "stages only" to "all that fit"; the paths follow the activities (§3.4). */
export const DETAIL: { label: string; abstraction: { minNodeShare: number; minEdgeShare: number; keepConnected: true; collapse?: "all" } }[] = [
  { label: "stages only", abstraction: { minNodeShare: 0, minEdgeShare: 0, keepConnected: true, collapse: "all" } },
  { label: "main activities", abstraction: { minNodeShare: 0.2, minEdgeShare: 0.2, keepConnected: true } },
  { label: "more activities", abstraction: { minNodeShare: 0.1, minEdgeShare: 0.1, keepConnected: true } },
  { label: "most activities", abstraction: { minNodeShare: 0.05, minEdgeShare: 0.05, keepConnected: true } },
  { label: "all that fit", abstraction: { minNodeShare: 0.02, minEdgeShare: 0.03, keepConnected: true } },
];
export const DEFAULT_DETAIL = 2;

/** The activity ids a level draws, by the node metric the library thresholds on. */
export function activitiesAt(graph: Scene, level: number): string[] {
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  if (level === 0) {
    const stages = (graph.groups ?? []).filter((g) => g.kind === "stage").map((g) => g.id);
    return stages.length ? stages : activities.map((n) => n.id);
  }
  const value = (n: SceneNode) => n.metrics?.cases ?? n.metrics?.events ?? n.metrics?.share ?? 0;
  const max = Math.max(1, ...activities.map(value));
  const min = DETAIL[level]?.abstraction.minNodeShare ?? 0;
  const kept = activities.filter((n) => value(n) / max >= min);
  return (kept.length ? kept : activities).map((n) => n.id);
}

/** How many activities a level draws. */
export function activityCountAt(graph: Scene, level: number): number {
  return activitiesAt(graph, level).length;
}

/** The label a node draws at zoom 1 (the flow library's `.wf-node` font size) and the smallest one worth offering. */
const LABEL_PX = 12;
const MIN_LABEL_PX = 11;
/** Padding the fit leaves: 4 % of the width, 8 % of the height (§3.2). */
const FIT_PAD_X = 0.96;
const FIT_PAD_Y = 0.92;
const MAX_ZOOM = 1.25;
/** The share of the frame's height the stretch aims at, leaving room for the badge above an activity. */
const BADGE_ROOM = 0.94;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The zoom a fit chooses: the drawing lies inside the canvas on all four sides, so it is the smaller
 * of the two ratios, never the larger. The empty band the smaller ratio would leave is taken out of the
 * drawing itself by `stretched` below, not out of the fit.
 */
export function fittedZoom(bounds: { width: number; height: number }, box: { width: number; height: number }): number {
  if (!bounds.width || !bounds.height || !box.width || !box.height) return 1;
  return Math.min(MAX_ZOOM, (box.width * FIT_PAD_X) / bounds.width, (box.height * FIT_PAD_Y) / bounds.height);
}

/** The box a set of laid-out elements occupies. */
export function boundsOf(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The room one activity needs in the layout: its box plus the spacing to the next one, across and down.
 * `FlowMap` hands the same numbers to the layout, so this is the layout's own cell, not a guess about it.
 */
export const CELL_WIDTH = 180 + 90;
export const CELL_HEIGHT = 48 + 110;

/**
 * How many columns a level's drawing takes: the longest chain of kept activities, plus the start and end
 * markers. A left-to-right process map is bound by its length, not by its area — eight activities in a chain
 * are twice as wide as eight in two branches — so this, and not the count, is what decides the fitted zoom.
 */
export function layersAt(graph: Scene, level: number): number {
  const kept = new Set(activitiesAt(graph, level));
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "follows" || e.source === e.target) continue;
    if (!kept.has(e.source) || !kept.has(e.target)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  }
  const depth = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 1;
    seen.add(id);
    const next = (out.get(id) ?? []).map((t) => walk(t, seen));
    seen.delete(id);
    const value = 1 + Math.max(0, ...next);
    depth.set(id, value);
    return value;
  };
  const longest = Math.max(1, ...[...kept].map((id) => walk(id, new Set())));
  // the start and end markers take a column each
  return longest + 2;
}

/**
 * The last detail level whose activity labels are still readable at the fitted zoom (§3.2).
 *
 * The stretch below gives the drawing the shape of its frame, so the fit is bound by the width: a level of
 * `L` columns is `L × 270` layout units across and the zoom is what the frame's width allows. The library
 * draws the activity's name at 12 px, so a level is offered while `12 × zoom` is at least 11 px. Levels above
 * it are not offered, and the caption sends the reader to the full window, where the frame is larger.
 */
export function readableMaxLevel(graph: Scene, box: { width: number; height: number }): number {
  if (!box.width || !box.height) return DETAIL.length - 1;
  for (let i = DETAIL.length - 1; i > 0; i--) {
    const zoom = Math.min(MAX_ZOOM, (box.width * FIT_PAD_X) / (layersAt(graph, i) * CELL_WIDTH));
    if (LABEL_PX * zoom >= MIN_LABEL_PX) return i;
  }
  return 0;
}

/**
 * The scene a detail level draws (§3.4). The level is applied to the graph before it is laid out, so the
 * drawing of a coarse level is a small drawing and its labels are large — a shared layout of every activity
 * would keep the same spread at every level and leave the labels unreadable whatever the level.
 * Structural nodes, constraint and flow edges are kept; an activity that would be left with no path keeps
 * its strongest one, as the library's own abstraction does.
 */
export function abstractAt<G extends Scene>(graph: G, level: number): G {
  const spec = DETAIL[level]?.abstraction;
  if (!spec || spec.collapse === "all") return graph;
  const keep = new Set(activitiesAt(graph, level));
  const nodes = graph.nodes.filter((n) => n.kind !== "activity" || keep.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  const follows = graph.edges.filter((e) => e.kind === "follows");
  const value = (e: SceneEdge) => e.metrics?.count ?? e.metrics?.cases ?? 0;
  const max = Math.max(1, ...follows.map(value));
  const inside = (e: SceneEdge) => ids.has(e.source) && ids.has(e.target);
  const kept = graph.edges.filter((e) => inside(e) && (e.kind !== "follows" || value(e) / max >= spec.minEdgeShare));
  const touched = new Set(kept.flatMap((e) => [e.source, e.target]));
  const extra = spec.keepConnected
    ? nodes
        .filter((n) => n.kind === "activity" && !touched.has(n.id))
        .map((n) => [...follows].filter((e) => inside(e) && (e.source === n.id || e.target === n.id)).sort((a, b) => value(b) - value(a))[0])
        .filter((e): e is G["edges"][number] => !!e)
    : [];
  const edges = [...kept, ...extra.filter((e, i) => !kept.includes(e) && extra.indexOf(e) === i)];
  const used = new Set(nodes.map((n) => n.group).filter((g): g is string => !!g));
  const groups = (graph.groups ?? []).filter((g) => used.has(g.id));
  const edgeIds = new Set(edges.map((e) => e.id));
  const overlays = (graph.overlays ?? []).filter((o) => {
    const payload = o.payload as { source?: unknown; target?: unknown } | undefined;
    if (o.kind === "arc" && typeof payload?.source === "string" && typeof payload?.target === "string") return ids.has(payload.source) && ids.has(payload.target);
    const target = o.target ?? "";
    return ids.has(target) || edgeIds.has(target) || used.has(target);
  });
  return { ...graph, nodes, edges, groups, overlays };
}

/** The shape of a laid-out scene, written structurally so the build without the flow library still compiles. */
export interface LaidOut {
  nodes: Record<string, Box>;
  groups: Record<string, Box>;
  edges: Record<string, { points: { x: number; y: number }[]; labelX?: number; labelY?: number }>;
  bounds: Box;
}

/**
 * The drawing filled into the frame's height (§3.2). A process graph is much wider than it is tall, so
 * a fit that keeps it inside the canvas on all four sides would leave a third of the frame empty above and
 * below. Rather than zoom past the edges, the stage lanes are stretched: every y is spread about the top of
 * the drawing until its shape is the frame's, so the fit then fills the frame and still overflows nowhere.
 * The factor comes from the frame, which the viewport fixes, so this can never be the cause of a resize.
 */
export function stretchToFrame(positions: LaidOut | undefined, drawn: Box | undefined, box: { width: number; height: number }): LaidOut | undefined {
  if (!positions || !drawn || !drawn.width || !drawn.height || !box.width || !box.height) return positions;
  // a little less than the frame's own shape: the badge above an activity is drawn outside its box, and the
  // drawing must stay inside the canvas on every side
  const want = (box.height * FIT_PAD_Y * BADGE_ROOM) / (box.width * FIT_PAD_X);
  const have = drawn.height / drawn.width;
  const factor = want / have;
  // only ever spread, never squeeze, and never beyond six times: a squeezed drawing would overlap itself
  if (!Number.isFinite(factor) || factor <= 1.02) return positions;
  const k = Math.min(6, factor);
  const y = (v: number) => drawn.y + (v - drawn.y) * k;
  const nodes: Record<string, Box> = {};
  for (const [id, b] of Object.entries(positions.nodes)) nodes[id] = { ...b, y: y(b.y) };
  const groups: Record<string, Box> = {};
  for (const [id, b] of Object.entries(positions.groups)) groups[id] = { ...b, y: y(b.y), height: b.height * k };
  const edges: LaidOut["edges"] = {};
  for (const [id, route] of Object.entries(positions.edges)) {
    edges[id] = { ...route, points: route.points.map((p) => ({ ...p, y: y(p.y) })), labelY: route.labelY === undefined ? undefined : y(route.labelY) };
  }
  return { ...positions, nodes, groups, edges, bounds: { ...positions.bounds, y: y(positions.bounds.y), height: positions.bounds.height * k } };
}
