import { LABEL_PX, labelUnitsAt, mapScaleAt, smallLabelUnitsAt } from "@wise/flow";

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

/** Padding the fit leaves: 4 % of the width, 8 % of the height (§3.2). */
const FIT_PAD_X = 0.96;
const FIT_PAD_Y = 0.92;
const MAX_ZOOM = 1.25;
/** The most the lanes are ever spread; beyond this the drawing is a column of rows rather than a process. */
const MAX_SPREAD = 24;

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
 * The last detail level whose activity names are still readable at the fitted zoom (§3.2, R3-06).
 *
 * The stretch below gives the drawing the shape of its frame, so the fit is bound by the width: a level of
 * `L` columns is `L × 270` layout units across and the zoom is what the frame's width allows. The name is
 * then counter-scaled to that zoom (`labelUnitsAt`), so it is always drawn at eleven pixels or more; what a
 * finer level costs is no longer the size of the name but the room its box has for it. A level is offered
 * while the box can still show eighteen characters. Before the counter-scale the test read `12 × zoom ≥ 11`,
 * which no process of more than four columns ever passed. Levels above the one returned are still drawn if
 * the reader asks for them; the bar then says the process is wider than this screen and offers the full
 * window, where the frame — and with it the zoom — is larger.
 */
export function readableMaxLevel(graph: Scene, box: { width: number; height: number }): number {
  if (!box.width || !box.height) return DETAIL.length - 1;
  for (let i = DETAIL.length - 1; i > 0; i--) {
    const zoom = Math.min(MAX_ZOOM, (box.width * FIT_PAD_X) / (layersAt(graph, i) * CELL_WIDTH));
    if (drawnNodeBox(labelUnitsAt(zoom)).chars >= MIN_LABEL_CHARS) return i;
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

// ---------------------------------------------------------------- names at a constant size (R3-06)

/** The activity box the layout reserves, in layout units; the drawn box grows inside its cell, never past it. */
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 48;
/** The widest and tallest a drawn activity box may become: its cell, less the room a path needs to reach it. */
const MAX_NODE_WIDTH = 216;
const MAX_NODE_HEIGHT = 232;
/** The room the label has inside the box: the band on the left and the padding. */
const LABEL_INSET = 40;
/** Layout units one character of a name takes at a font size of one unit (Inter at its average width). */
const CHAR_WIDTH = 0.52;
/** The characters of a name a level must be able to show before it counts as readable (R3-06). */
export const MIN_LABEL_CHARS = 18;

/** Layout units left between two drawn boxes, so a path can still be seen to arrive at one. */
const BOX_MARGIN = 16;
/** The name wraps over at most this many lines; below it the box would be a paragraph, not a label. */
const MAX_LINES = 3;
/** The item count sits under the name at this share of its size, on a line of its own. */
const META_LINE = 0.72;
/** Line height and the padding above and below, in units of the font size and in layout units. */
const LINE_HEIGHT = 1.25;
const BOX_PADDING = 12;

/** The gaps between every pair of laid-out boxes, on each axis; negative where they already overlap. */
function gapsBetween(boxes: Box[]): { dx: number; dy: number }[] {
  const pairs: { dx: number; dy: number }[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      pairs.push({
        dx: Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)),
        dy: Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)),
      });
    }
  }
  return pairs;
}

/**
 * How much taller every drawn box may be once it has been widened by `grownX`, without any two of them
 * touching. Two boxes collide only when they grow into each other on **both** axes, so width costs height:
 * widening every box by 25 units brings a pair 20 units apart across into contention, and the height they may
 * then take is the distance between them down the page.
 */
export function heightRoom(pairs: { dx: number; dy: number }[], grownX: number): number {
  let room = Infinity;
  for (const p of pairs) {
    if (p.dx >= grownX + BOX_MARGIN) continue;
    room = Math.min(room, p.dy - BOX_MARGIN);
  }
  return room;
}

/**
 * The box a drawn activity takes, and how many lines of its name it shows.
 *
 * The layout keeps its 180 × 48 cell — moving it would move the zoom, which would move the label with it —
 * so the drawn box grows about its own centre into the space the drawing already left free, and no further:
 * a box that grew into its neighbour would trade one unreadable name for two overlapping ones. Three widths
 * are tried and the one that shows the most characters wins, so a drawing whose activities sit above one
 * another keeps its width and one whose activities sit side by side keeps its height.
 *
 * `chars` is the length of the names to plan for; the acceptance asks for eighteen.
 */
export function drawnNodeBox(units: number, boxes: Box[] = [], chars = 18): { width: number; height: number; lines: number; chars: number } {
  if (units <= LABEL_PX) return { width: NODE_WIDTH, height: NODE_HEIGHT, lines: 1, chars: Math.floor((NODE_WIDTH - LABEL_INSET) / (units * CHAR_WIDTH)) };
  const pairs = boxes.length > 1 ? gapsBetween(boxes) : [];
  const lineHeight = units * LINE_HEIGHT;
  let best = { width: NODE_WIDTH, height: NODE_HEIGHT, lines: 1, chars: 0 };
  for (const width of [NODE_WIDTH, (NODE_WIDTH + MAX_NODE_WIDTH) / 2, MAX_NODE_WIDTH]) {
    const perLine = Math.max(1, Math.floor((width - LABEL_INSET) / (units * CHAR_WIDTH)));
    const wantLines = Math.max(1, Math.min(MAX_LINES, Math.ceil(chars / perLine)));
    const wantHeight = Math.min(MAX_NODE_HEIGHT, (wantLines + META_LINE) * lineHeight + BOX_PADDING);
    const grownX = width - NODE_WIDTH;
    const room = pairs.length ? heightRoom(pairs, grownX) : Infinity;
    const height = Math.max(NODE_HEIGHT, Math.min(wantHeight, NODE_HEIGHT + room));
    // the same rule the other way round: a pair the layout left 200 units apart cannot both be drawn 216
    // wide, whatever the height. The cell is 270 units, but a layout is free to place two boxes closer than
    // its cell, and on the extract two activities of one row then overlapped by fourteen pixels.
    if (grownX > 0 && pairs.some((p) => p.dy < height - NODE_HEIGHT + BOX_MARGIN && p.dx < grownX + BOX_MARGIN)) continue;
    // the lines that fit the height the drawing actually allows; the 0.02 absorbs the rounding of a division
    const lines = Math.max(1, Math.min(wantLines, Math.floor((height - BOX_PADDING - META_LINE * lineHeight) / lineHeight + 0.02)));
    const shown = perLine * lines;
    if (shown > best.chars) best = { width, height, lines, chars: shown };
  }
  return best;
}

/** The shape of a laid-out scene, written structurally so the build without the flow library still compiles. */
export interface LaidOut {
  nodes: Record<string, Box>;
  groups: Record<string, Box>;
  edges: Record<string, { points: { x: number; y: number }[]; labelX?: number; labelY?: number }>;
  bounds: Box;
}

/**
 * The margin and the header band the flow library draws a stage lane with (`core/lanes.ts`, its own defaults):
 * the lane is the drawing plus this margin on three sides and the margin plus the header above it.
 */
export const LANE_PAD = 24;
export const LANE_LABEL = 32;

/** The band the library keeps above the drawing for a lane: its margin and its label space together. */
export const LANE_BAND = LANE_PAD + LANE_LABEL;
/**
 * Layout units the badge over an activity reaches above the **layout** box, once its text is at eleven pixels.
 * `grow` is how far the drawn box has grown above that box to hold its counter-scaled name: the badge sits on
 * the drawn box and the lane is drawn around the laid-out one, so the two are only in step when it is counted.
 */
export const badgeAboveAt = (zoom: number, grow = 0) => 22 * mapScaleAt(zoom) + 4 + grow;
/** How far that badge reaches above the lane's own top edge, which is where the lane's name has to start. */
export const laneOvershootAt = (zoom: number, grow = 0) => Math.max(0, badgeAboveAt(zoom, grow) - LANE_BAND);
/** The room the lane's name takes, drawn above the lane rather than inside it so no badge can reach it. */
export const laneNameHeightAt = (zoom: number) => 1.2 * smallLabelUnitsAt(zoom) + 6;

/**
 * The room around the activities that is drawn but is not the drawing (§6.1, P1-5).
 *
 * The lanes are not laid out with the activities: the library draws each stage band across the whole content
 * of the map and gives it a margin and a header band of its own, and the badge over an activity is drawn
 * outside its box. All of it has to be inside the canvas, so all of it is counted — once, here — both when
 * the drawing is spread to the shape of its frame and when the fit is told what it must hold. Before this the
 * fit was handed the box of everything the layout produced, routed paths included: a path that detoured far
 * above the activities made the lanes tall, the lanes made the zoom small, and 45 % of the canvas height
 * above the graph was lane and detour rather than process.
 */
export function drawingRoom(zoom: number, lanes: boolean, grow = 0): { top: number; bottom: number; x: number } {
  const badge = badgeAboveAt(zoom, grow);
  if (!lanes) return { top: badge, bottom: Math.max(8, grow), x: 16 };
  // below, the lane's own margin and the room the box grew into are the same room, counted once
  return { top: LANE_BAND + laneOvershootAt(zoom, grow) + laneNameHeightAt(zoom), bottom: Math.max(LANE_PAD, grow), x: 2 * LANE_PAD };
}

/** The box the fit must hold: the activities and the room around them. */
export function withRoom(nodes: Box | undefined, room: { top: number; bottom: number; x: number }): Box | undefined {
  if (!nodes) return undefined;
  return { x: nodes.x - room.x / 2, y: nodes.y - room.top, width: nodes.width + room.x, height: nodes.height + room.top + room.bottom };
}

/**
 * The same drawing with the layout's routed paths dropped, so each path is drawn as a curve between the two
 * boxes it joins (P1-5).
 *
 * The routes are computed by the layout engine for the positions it chose, and `stretchToFrame` then spreads
 * every y by up to six: an orthogonal detour of a hundred units became a six-hundred-unit excursion above and
 * below the activities, which the lanes covered and the fit had to hold. A route that no longer describes the
 * drawing it belongs to is worse than no route, and the library falls back on a curve between the handles.
 */
export function withoutRoutes(positions: LaidOut | undefined): LaidOut | undefined {
  if (!positions) return positions;
  const edges: LaidOut["edges"] = {};
  for (const [id, route] of Object.entries(positions.edges ?? {})) edges[id] = { ...route, points: [] };
  return { ...positions, edges };
}

/**
 * The drawing filled into the frame's height (§3.2). A process graph is much wider than it is tall, so
 * a fit that keeps it inside the canvas on all four sides would leave a third of the frame empty above and
 * below. Rather than zoom past the edges, the stage lanes are stretched: every y is spread about the top of
 * the drawing until its shape is the frame's, so the fit then fills the frame and still overflows nowhere.
 * The factor comes from the frame, which the viewport fixes, so this can never be the cause of a resize.
 *
 * `drawn` is the box of the **activities**, not of the lanes around them: measured on the lanes, the shape was
 * already the frame's and the spread never happened, which is the other half of P1-5.
 */
export function stretchToFrame(
  positions: LaidOut | undefined,
  drawn: Box | undefined,
  box: { width: number; height: number },
  margin: { x: number; y: number } = { x: 0, y: 0 },
): LaidOut | undefined {
  if (!positions || !drawn || !drawn.width || !drawn.height || !box.width || !box.height) return positions;
  // the shape the frame asks of everything drawn — the activities, and the room the lane, its name and the
  // badge above an activity take around them — so the fit is bound on both sides at once and fills the frame
  const shape = (box.height * FIT_PAD_Y) / (box.width * FIT_PAD_X);
  const target = Math.max(drawn.height, shape * (drawn.width + margin.x) - margin.y);
  // the spread moves each box down, it does not make it taller, so the drawing ends up shorter than the
  // factor suggests: the largest spread that keeps every box inside the target is the smallest of the
  // factors the boxes themselves allow. Read as a ratio of heights instead, the drawing came out an eighth
  // short of its frame and the fit was bound by the width alone.
  const factors = Object.values(positions.nodes)
    .filter((b) => b.y > drawn.y + 1e-6)
    .map((b) => (target - b.height) / (b.y - drawn.y));
  const factor = factors.length ? Math.min(...factors) : 1;
  // only ever spread, never squeeze: a squeezed drawing would overlap itself, while a spread one only opens
  // the gaps between its rows. A flat graph — eight activities over 2,700 layout units and 120 down — needs a
  // factor of ten to reach the shape of its frame, and a cap of six left an eighth of the canvas empty.
  if (!Number.isFinite(factor) || factor <= 1.02) return positions;
  const k = Math.min(MAX_SPREAD, factor);
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
