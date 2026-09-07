import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, MoreHorizontal, X } from "lucide-react";
import type { FlowGraph } from "@wise/api-schema";
import { canonicalOverlays, defaultStyle, diff, diffStyle, filterPositions, palettes, type FlowGraph as LibraryGraph, type Overlay } from "@wise/flow";
import { ProcessMap, useStableLayout, type Selection } from "@wise/flow/react";
import { getNodesBounds, useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import "@xyflow/react/dist/style.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
import type { Filter, FilterClause, FilterPreview, FlowPath } from "@/lib/api/cycle2";
import { FilterChipsRow } from "@/components/guide/FilterChipsRow";
import { LoadingBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addClause, clauseForActivity, clauseForConstraint, clauseForStage, describeClause, mapActivities, toggleClause } from "@/lib/filter";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CELL_HEIGHT, CELL_WIDTH, DEFAULT_DETAIL, DETAIL, LABEL_PX, MIN_LABEL_CHARS, NODE_HEIGHT, NODE_WIDTH, abstractAt, activityCountAt, boundsOf, drawnNodeBox, fittedZoom, labelScreenPx, labelUnitsAt, drawingRoom, laneOvershootAt, mapScaleAt, readableMaxLevel, smallLabelUnitsAt, stretchToFrame, withRoom, withoutRoutes, type Box, type LaidOut } from "./frame";

const ModelView = lazy(() => import("./ModelView"));

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

/** The three renderings of one scene (§3.9); the toggle never changes the filter, the selection or the detail. */
export type RenderMode = "map" | "model" | "table";

/** Where the instrument is placed (§3.1): the Flow step, a panel on the board or the Why screen, a card's small map. */
export type FrameKind = "page" | "panel" | "compact";

export interface FlowMapProps {
  /** The scene to show (the whole log or one group). */
  graph: FlowGraph;
  /** The whole log when `graph` is a group: positions are shared and a compare toggle draws the difference. */
  baseline?: FlowGraph;
  title: string;
  frame?: FrameKind;
  /** Height of a `panel` frame; a `page` frame measures the viewport itself (the 60 % rule, §3.2). */
  height?: number;
  className?: string;
  /** The filter model of the screen; the map's filter actions add clauses (activity labels, as the backend expects) through `onFilterChange`. */
  filter?: Filter;
  preview?: FilterPreview;
  onFilterChange?: (filter: Filter | undefined) => void;
  /** Show the chips row in the filter bar (off when the screen shows the row itself). */
  chips?: boolean;
  /** The count line's numbers when the host knows them (the run's total, the filter's result). */
  counts?: { casesIn: number; casesTotal: number };
  /** True for two seconds after an action that removed no case (§2.4). */
  noneRemoved?: boolean;
  /** Activity whose incoming and outgoing paths are highlighted and listed. */
  focus?: string | null;
  onFocusChange?: (activity: string | undefined) => void;
  /** Paths of the focused activity from `GET …/flow?focus=` (the full directly-follows relation, R3-O8). */
  paths?: { incoming?: FlowPath[]; outgoing?: FlowPath[] } | null;
  /** Actions the map cannot answer itself: `lens`, `worst-cases`, `pin`, `add-constraint`, `path-analysis`. */
  onAction?: (action: MapAction) => void;
  /** Activities to highlight (the top drivers on the reason screen). */
  highlight?: string[];
  /** Stage lanes along the flow. */
  lanes?: "stages" | "none";
  /** Small map without controls, legend or menu (the flow-type cards) — the same as `frame="compact"`. */
  compact?: boolean;
  /** The plain phrase of an expectation, for the footnote and the selected card. */
  plainOf?: (constraintId: string) => string;
  /** The business name of a case. */
  noun?: string;
  /** Text for the map's live region. */
  announce?: string;
  /** Detail level (0 … 4); controlled by the host so it can live in the address. */
  detail?: number;
  onDetailChange?: (detail: number) => void;
  /** `Map | Model | Table`; controlled by the host so it can live in the address. */
  render?: RenderMode;
  onRenderChange?: (mode: RenderMode) => void;
  /** Full-window mode (§3.8); controlled so `full=1` survives a share link and a snapshot. */
  full?: boolean;
  onFullChange?: (full: boolean) => void;
  /** On the board a click on an element adds its clause at once (§4.5) instead of opening the card. */
  clickFilters?: boolean;
  /** What the selected element is, for hosts that show it elsewhere. */
  onSelectionChange?: (selected: { kind: "node" | "edge" | "group"; id: string; label: string } | undefined) => void;
  /** The selected activity, when the host keeps it (in the address, so a shared link reproduces it). */
  selectedId?: string | null;
  /** One line under the frame: what has no place on the map. */
  footnote?: boolean;
  /** `GET …/runs/{id}/flow/bpmn` for this scene; without it the model is generated in the browser. */
  bpmnHref?: string;
  /** Whether the legend column starts open; by default a panel starts on its rail, a page with the legend. */
  legendOpen?: boolean;
}

export const labelOf = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
const idOf = (g: FlowGraph, label: string) => g.nodes.find((n) => n.label === label)?.id ?? label;

/** The only thing that overlaps the drawing (§3.2): zoom in, zoom out, full window, fit — 32 px, translucent. */
function ZoomControls({ onFull, full }: { onFull?: () => void; full?: boolean }) {
  const rf = useReactFlow();
  const button = "size-8 rounded-md border border-border bg-surface/85 text-sm text-text-muted hover:bg-surface";
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1" data-testid="zoom-controls">
      <button type="button" className={button} aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 0 })}>
        +
      </button>
      <button type="button" className={button} aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 0 })}>
        −
      </button>
      {onFull && (
        <button type="button" className={button} aria-label={full ? "Leave the full window" : "Fill the window with the map"} onClick={onFull}>
          ⛶
        </button>
      )}
      <button type="button" className={button} aria-label="Fit the map to the frame" onClick={() => void rf.fitView({ padding: 0.04, duration: 0 })}>
        0
      </button>
    </div>
  );
}

/**
 * Activity names at a constant size on the screen (R3-06).
 *
 * The library writes a name at 12 layout units inside a pane it scales by the zoom, so the same code drew
 * 11.0 px on a five-activity map and 4.7 px on an eight-activity, six-lane one. This counter-scales the name
 * by the inverse of the zoom the fit chose and gives the box the room to hold it, as three custom properties
 * the library's own stylesheet already reads (`--wf-node-width`, `--wf-node-height`) or that the sheet in
 * `globals.css` reads (`--wise-label-units`). Nothing here changes the layout — the boxes the layout reserves
 * stay 180 × 48 and the drawn box grows into the gap its cell already leaves — so the zoom cannot depend on
 * the label size and this can never be the cause of a refit.
 *
 * The properties are written straight onto the element rather than through React state: the zoom changes on
 * every frame of a pan and a state write would re-render the whole map with it.
 */
function ConstantLabels({ container, boxes }: { container: React.RefObject<HTMLDivElement | null>; boxes: Box[] }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const units = labelUnitsAt(zoom);
    // the box grows only as far as the room the drawing left: one that grew into its neighbour would trade
    // one unreadable name for two overlapping ones
    const box = drawnNodeBox(units, boxes);
    el.style.setProperty("--wise-label-units", `${units.toFixed(2)}px`);
    // every other text drawn on the canvas — the stage header, the item count, the start and end markers, the
    // path labels and both halves of a badge — at eleven pixels on the screen, and the shapes that hold them
    // grown by the same factor so the text still sits inside them (P1-4)
    el.style.setProperty("--wise-small-units", `${smallLabelUnitsAt(zoom).toFixed(2)}px`);
    el.style.setProperty("--wise-map-scale", mapScaleAt(zoom).toFixed(3));
    el.style.setProperty("--wise-lane-overshoot", `${laneOvershootAt(zoom, (box.height - NODE_HEIGHT) / 2).toFixed(1)}px`);
    el.style.setProperty("--wf-node-width", `${box.width.toFixed(1)}px`);
    el.style.setProperty("--wf-node-height", `${box.height.toFixed(1)}px`);
    el.style.setProperty("--wise-node-lines", String(box.lines));
    el.style.setProperty("--wise-node-grow-x", `${((box.width - NODE_WIDTH) / 2).toFixed(1)}px`);
    el.style.setProperty("--wise-node-grow-y", `${((box.height - NODE_HEIGHT) / 2).toFixed(1)}px`);
    // the name and the count share a line at the library's own size and stack once the name is counter-scaled
    el.dataset.scaled = units > LABEL_PX ? "1" : "0";
    el.dataset.labelPx = labelScreenPx(units, zoom).toFixed(1);
  }, [container, zoom, boxes]);
  return null;
}

/** Changes under this many pixels are noise: they never refit and never re-measure (§3.2). */
const MIN_RESIZE = 2;
/** Layout units the badge above an activity reaches over its own box. */
const BADGE_OVERHANG = 24;
/** What one badge takes across the screen once its text is at eleven pixels: the glyph, the share and the pill. */
const BADGE_WIDTH_PX = 62;
/** When a fit is attempted after the drawn graph changes, in milliseconds. */
const FIT_ATTEMPTS = [120, 350, 800, 1600];

/**
 * Fits the view to the laid-out graph and again whenever the map's box changes size; `fitKey` refits after a
 * detail change, a filter, a selection and every other change of the drawn graph.
 *
 * The observer coalesces into one `requestAnimationFrame`, ignores changes under two pixels and never refits
 * while a fit is already running, so a refit can never be the cause of the next one.
 */
function FitToView({ container, fitKey, bounds: given }: { container: React.RefObject<HTMLDivElement | null>; fitKey: string; bounds?: { x: number; y: number; width: number; height: number } }) {
  const rf = useReactFlow();
  const initialized = useNodesInitialized();
  const fitting = useRef(false);
  const fit = useCallback(() => {
    const el = container.current;
    const nodes = rf.getNodes();
    if (!el || nodes.length === 0 || fitting.current) return;
    // the laid-out box when the scene is placed by us: it carries the stage lanes, which `getNodesBounds`
    // measures only once React Flow has sized them and which the fit would otherwise leave hanging out.
    // The badge of an activity is drawn above its box, so the box the fit is given reaches that far up.
    // the given box already carries the room the lane and the badge take (`drawingRoom`); a measured one is
    // the boxes alone, so the badge over an activity is added to it here
    const measured = given ?? getNodesBounds(nodes);
    const bounds = given ? measured : { ...measured, y: measured.y - BADGE_OVERHANG, height: measured.height + BADGE_OVERHANG };
    const box = el.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !box.width || !box.height) return;
    fitting.current = true;
    try {
      // the drawing lies inside the canvas on all four sides; the empty band a wide graph would leave
      // is taken out by stretching the lanes before the fit, not by zooming past the edges
      const zoom = fittedZoom(bounds, box);
      rf.setViewport(
        { x: -bounds.x * zoom + (box.width - bounds.width * zoom) / 2, y: -bounds.y * zoom + (box.height - bounds.height * zoom) / 2, zoom },
        { duration: 0 },
      );
    } finally {
      // the viewport is written synchronously; the flag is released on the next turn of the loop. A timer,
      // not an animation frame: a hidden tab paints no frames and the flag would never be released there.
      window.setTimeout(() => {
        fitting.current = false;
      }, 0);
    }
  }, [container, rf, given]);
  // The drawing arrives in pieces — the lanes first, then the activities, then their measured boxes — and
  // `useNodesInitialized` stays false while a lane has no size of its own, so waiting for it alone left the
  // map un-fitted and overflowing. A bounded set of attempts fits as soon as there is something to
  // fit and again once it has settled; a repeated fit on the same bounds writes the same viewport, so the
  // attempts cannot chase each other.
  useEffect(() => {
    const handles = FIT_ATTEMPTS.map((delay) => window.setTimeout(fit, delay));
    return () => handles.forEach((h) => window.clearTimeout(h));
  }, [initialized, fit, fitKey]);
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    let last = el.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = el.getBoundingClientRect();
        if (Math.abs(rect.width - last.width) < MIN_RESIZE && Math.abs(rect.height - last.height) < MIN_RESIZE) return;
        last = rect;
        fit();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [container, fit]);
  return null;
}

/**
 * Every path in and out of the focused activity (§3.6, R3-O8, R3-11).
 *
 * It was a 264 px column **inside** the frame holding 1,175 px of rows: opening it shrank the canvas from
 * 1,158 to 894 px and the activity names with it, the flow library drew the same list a second time in its
 * own panel, and the *hidden at this detail level* sentence was printed three times. It is now a sheet over
 * the map — the canvas keeps its width — sortable by items and by median wait, with every row acting as
 * *filter to this path*, and `Escape` closes it.
 */
type PathSort = "items" | "wait";

function PathSheet({
  focusLabel,
  incoming,
  outgoing,
  labelOfId,
  isDrawn,
  noun,
  onShowHidden,
  onClose,
  onFilter,
  canShowHidden,
}: {
  focusLabel: string;
  incoming: FlowPath[];
  outgoing: FlowPath[];
  labelOfId: (id: string) => string;
  /** Whether the current scene draws this path; the ones it does not sit under the divider. */
  isDrawn: (path: FlowPath, direction: "in" | "out") => boolean;
  noun: string;
  onShowHidden?: () => void;
  onClose: () => void;
  /** Keep only the items that take this path; without it the rows are read-only. */
  onFilter?: (path: FlowPath, direction: "in" | "out") => void;
  canShowHidden: boolean;
}) {
  const [sort, setSort] = useState<PathSort>("items");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const items = (p: FlowPath) => p.cases ?? p.count ?? 0;
  const wait = (p: FlowPath) => (p.median_lag === null || p.median_lag === undefined ? -1 : p.median_lag);
  const rows = [...incoming.map((p) => ({ p, direction: "in" as const })), ...outgoing.map((p) => ({ p, direction: "out" as const }))].sort((a, b) =>
    sort === "items" ? items(b.p) - items(a.p) : wait(b.p) - wait(a.p),
  );
  const drawn = rows.filter(({ p, direction }) => isDrawn(p, direction));
  const hidden = rows.filter(({ p, direction }) => !isDrawn(p, direction));
  const other = (p: FlowPath, direction: "in" | "out") => {
    const raw = direction === "in" ? p.from : p.to;
    return typeof raw === "string" && raw ? raw : labelOfId(String(p.node ?? ""));
  };
  const line = ({ p, direction }: { p: FlowPath; direction: "in" | "out" }, key: string, dim = false) => (
    <tr key={key} className={cn("border-b border-border last:border-0", dim && "opacity-70")}>
      <td className="py-0.5 pr-2 align-top">
        <span aria-hidden className="mr-1 text-text-subtle">
          {direction === "in" ? "→" : "←"}
        </span>
        {other(p, direction)}
      </td>
      <td className="tnum py-0.5 pr-2 text-right align-top">{fmtInt(items(p))}</td>
      <td className="tnum py-0.5 pr-2 text-right align-top">{p.median_lag !== null && p.median_lag !== undefined ? `${fmtNum(p.median_lag / 24, 1)} d` : "–"}</td>
      <td className="py-0.5 text-right align-top">
        {onFilter && (
          <button type="button" className="text-accent-text underline" onClick={() => onFilter(p, direction)}>
            filter to this path
          </button>
        )}
      </td>
    </tr>
  );
  /** The rows split into the columns the sheet draws them in, so the whole answer fits without scrolling. */
  const split = <T,>(rows: T[]): T[][] => (rows.length > 12 ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows]);
  const columns = split(drawn);
  const hiddenColumns = split(hidden);
  const head = (
    <thead>
      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-subtle">
        <th className="py-0.5 pr-2 text-left font-medium">the other end</th>
        <th className="py-0.5 pr-2 text-right font-medium">
          <button type="button" aria-pressed={sort === "items"} className={cn("underline-offset-2", sort === "items" ? "text-text underline" : "hover:underline")} onClick={() => setSort("items")}>
            {noun}
          </button>
        </th>
        <th className="py-0.5 pr-2 text-right font-medium">
          <button type="button" aria-pressed={sort === "wait"} className={cn("underline-offset-2", sort === "wait" ? "text-text underline" : "hover:underline")} onClick={() => setSort("wait")}>
            median wait
          </button>
        </th>
        <th className="py-0.5" />
      </tr>
    </thead>
  );
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 max-h-full overflow-y-auto border-t border-border bg-surface/97 px-3 py-2 text-[11px] leading-tight text-text shadow-lg backdrop-blur-sm"
      role="dialog"
      aria-label={`Paths in and out of ${focusLabel}`}
      data-testid="path-panel"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="reading text-[11px] text-text-muted">
          <strong className="text-text">{focusLabel}</strong> has {incoming.length} {incoming.length === 1 ? "path" : "paths"} in and {outgoing.length} out. Escape closes this.
        </p>
        <button type="button" className="rounded-sm px-1 text-text-muted hover:bg-surface-sunken" aria-label="Hide the paths" onClick={onClose}>
          ×
        </button>
      </div>
      {/* two columns on a wide frame: forty-two paths in one column is a scroll, and the whole answer has to
          be on the screen at once (R3-11) */}
      <div className={cn("grid gap-x-6", drawn.length > 12 ? "lg:grid-cols-2" : "")}>
        {columns.map((rows, c) => (
          <table key={c} className="w-full self-start" data-testid={c === 0 ? "path-list" : undefined}>
            {head}
            <tbody>{rows.map((r, i) => line(r, `d-${c}-${i}`))}</tbody>
          </table>
        ))}
      </div>
      {hidden.length > 0 && (
        <>
          <p className="flex items-center gap-2 border-t border-border pt-1.5 text-[11px] text-text-subtle" data-testid="paths-divider">
            hidden at this detail level ({hidden.length})
            {canShowHidden && onShowHidden && (
              <button type="button" className="text-accent-text underline" onClick={onShowHidden}>
                Show them
              </button>
            )}
          </p>
          <div className={cn("grid gap-x-6", hidden.length > 12 ? "lg:grid-cols-2" : "")}>
            {hiddenColumns.map((rows, c) => (
              <table key={c} className="w-full self-start">
                <tbody>{rows.map((r, i) => line(r, `h-${c}-${i}`, true))}</tbody>
              </table>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface AreaEntry {
  id: string;
  label: string;
  constraints: string[];
}

/**
 * The legend as a column beside the canvas (§3.5): only the encodings in use, each with its twin, ramps
 * labelled in units, every entry clickable to switch its overlay off and on, the expectation areas with a
 * checkbox each and the action that filters to the items violating one of them.
 */
function MapLegend({
  graph,
  compare,
  hidden,
  onToggle,
  areas,
  hiddenAreas,
  onToggleArea,
  onFilterArea,
  open,
  onOpenChange,
  className,
}: {
  graph: LibraryGraph;
  compare: boolean;
  hidden: Set<string>;
  onToggle: (kind: string) => void;
  areas: AreaEntry[];
  hiddenAreas: Set<string>;
  onToggleArea: (id: string) => void;
  onFilterArea?: (area: AreaEntry) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const counts = graph.edges.filter((e) => (e as { kind?: string }).kind === "follows").map((e) => Number((e as { metrics?: Record<string, number> }).metrics?.count ?? NaN)).filter((n) => Number.isFinite(n));
  const min = counts.length ? Math.min(...counts) : 0;
  const max = counts.length ? Math.max(...counts) : 0;
  const kinds = new Set((graph.overlays ?? []).map((o) => (o as { kind: string }).kind));
  const selfLoops = graph.edges.some((e) => e.source === e.target);
  const stops = compare ? palettes.diverging : palettes.sequential;
  if (!open) {
    return (
      <button
        type="button"
        className={cn("flex w-8 shrink-0 items-center justify-center border-l border-border bg-surface text-xs text-text-muted hover:bg-surface-sunken", className)}
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
        aria-label="Show the legend"
        data-testid="legend-rail"
      >
        <span className="[writing-mode:vertical-rl]">legend</span>
      </button>
    );
  }
  const entry = (kind: string, glyph: string, text: string) => (
    <li key={kind}>
      <button type="button" onClick={() => onToggle(kind)} aria-pressed={!hidden.has(kind)} className={cn("flex w-full gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-surface-sunken", hidden.has(kind) && "text-text-subtle line-through")}>
        <span aria-hidden>{glyph}</span>
        <span>{text}</span>
      </button>
    </li>
  );
  return (
    <aside className={cn("flex w-[200px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-3 text-xs text-text-muted", className)} aria-label="Legend" data-testid="map-legend">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">Legend</p>
        <button type="button" className="rounded-sm px-1 text-text-muted hover:bg-surface-sunken" aria-label="Hide the legend" aria-expanded onClick={() => onOpenChange(false)}>
          ▾
        </button>
      </div>
      {counts.length > 0 && (
        <div>
          <p className="font-medium text-text">path width</p>
          <p>items on the path</p>
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
        <p>{compare ? "difference to everyone else" : "share of items missing an expectation"}</p>
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
      {(kinds.size > 0 || selfLoops) && (
        <ul className="flex flex-col gap-0.5">
          {kinds.has("badge") && entry("badge", "▲", "badge: the worst expectation at this activity, with its share")}
          {kinds.has("arc") && entry("arc", "⌒", "arc: a waiting-time or order expectation between two activities")}
          {selfLoops && entry("selfLoop", "↻", "repeated execution")}
          {kinds.has("hatch") && entry("hatch", "▨", "outside the expectation's scope")}
          {kinds.has("tint") && entry("tint", "▧", "activity of a top expectation behind the shortfall")}
        </ul>
      )}
      {areas.length > 0 && (
        <div>
          <p className="font-medium text-text">expectation areas</p>
          <ul className="mt-1 flex flex-col gap-1">
            {areas.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-1.5">
                <input id={`area-${a.id}`} type="checkbox" checked={!hiddenAreas.has(a.id)} onChange={() => onToggleArea(a.id)} className="size-3" />
                <label htmlFor={`area-${a.id}`} className="min-w-0 flex-1 truncate" title={a.label}>
                  {a.label}
                </label>
                {onFilterArea && (
                  <button type="button" className="text-accent-text underline" onClick={() => onFilterArea(a)} title={`Filter to items violating an expectation of ${a.label}`}>
                    filter
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-text-subtle">Lanes are the stages of the process, in their order; an activity sits in its stage.</p>
    </aside>
  );
}

/**
 * The frame's own size, **read and never written** (§3.2). A `page` frame takes the height the layout
 * gives it — the rest of the viewport, since the step does not scroll — so nothing measured here can change
 * it back. The reading exists only for the things that need a number (the model's canvas, how many activities
 * fit); it is coalesced into one animation frame and ignores changes under two pixels, so a one-pixel
 * rounding difference cannot start a second pass.
 */
function useFrameBox(ref: React.RefObject<HTMLDivElement | null>, fallbackHeight: number, key = ""): { width: number; height: number } {
  const [box, setBox] = useState({ width: 1200, height: fallbackHeight });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      setBox((prev) => (Math.abs(prev.width - rect.width) < MIN_RESIZE && Math.abs(prev.height - rect.height) < MIN_RESIZE ? prev : { width: Math.round(rect.width), height: Math.round(rect.height) }));
    };
    const ro = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    });
    ro.observe(el);
    read();
    return () => {
      ro.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, key]);
  return box;
}

const LEGEND_KEY = "wise.map.legend";
const readLegend = () => {
  try {
    return window.localStorage.getItem(LEGEND_KEY) !== "closed";
  } catch {
    return true;
  }
};

/**
 * The process map as the instrument of the analysis (`docs/panel/ui_design_cycle3_board.md` §3): the map
 * fills its frame, the only chrome above it is one filter bar with the items in and out, the chips, the
 * detail slider, the `Map | Model | Table` toggle and full window; the legend is a column beside the canvas
 * and nothing floats over the drawing. A click selects an element and opens its card under the map with the
 * six actions (on the board a click adds the filter at once); every action changes the count, a chip and the
 * live region, including the ones that remove no item. The same component serves the Flow step, the Flow tab
 * of the Why screen and the board's map panel — only the frame differs.
 */
export function FlowMap({
  graph,
  baseline,
  title,
  frame = "panel",
  height = 560,
  className,
  filter,
  preview,
  onFilterChange,
  chips = true,
  counts,
  noneRemoved,
  focus,
  onFocusChange,
  paths,
  onAction,
  highlight,
  lanes = "stages",
  compact,
  plainOf,
  noun = "cases",
  announce,
  detail,
  onDetailChange,
  render,
  onRenderChange,
  full,
  onFullChange,
  clickFilters,
  onSelectionChange,
  selectedId: selectedFromHost,
  footnote = true,
  bpmnHref,
  legendOpen: legendOpenDefault,
}: FlowMapProps) {
  const kind: FrameKind = compact ? "compact" : frame;
  const [compare, setCompare] = useState(false);
  const [innerDetail, setInnerDetail] = useState(DEFAULT_DETAIL);
  const [innerRender, setInnerRender] = useState<RenderMode>("map");
  const [innerFull, setInnerFull] = useState(false);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
  const [hiddenOverlays, setHiddenOverlays] = useState<Set<string>>(new Set());
  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(() => readLegend() && (legendOpenDefault ?? frame !== "panel"));
  const container = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const level = detail ?? innerDetail;
  const mode = render ?? innerRender;
  const isFull = full ?? innerFull;
  const setLevel = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(DETAIL.length - 1, next));
      setInnerDetail(clamped);
      onDetailChange?.(clamped);
    },
    [onDetailChange],
  );
  const setMode = useCallback(
    (next: RenderMode) => {
      setInnerRender(next);
      onRenderChange?.(next);
    },
    [onRenderChange],
  );
  const setFull = useCallback(
    (next: boolean) => {
      setInnerFull(next);
      onFullChange?.(next);
    },
    [onFullChange],
  );

  // the frame's size is read, never written: on a `page` frame the layout gives the height
  const frameBox = useFrameBox(frameRef, height);
  const canvasBox = useFrameBox(container, height, mode);
  const frameHeight = kind === "page" ? frameBox.height : height;
  // the last level whose activity labels still reach 11 px in this frame (§3.2); above it the bar says
  // so and points at the full window, where the frame — and with it the zoom — is larger
  const maxLevel = useMemo(() => (kind === "compact" ? DETAIL.length - 1 : readableMaxLevel(graph, canvasBox)), [kind, graph, canvasBox]);
  const drawnLevel = level;

  // the frame is much taller than a left-to-right process graph is by nature: the nodes of one layer are
  // spread so the drawing fills the frame instead of sitting as a thin ribbon in the middle of it (§3.2)
  const layoutOptions = useMemo(() => ({ elkWorkerUrl, spacing: { node: CELL_HEIGHT - 48, layer: CELL_WIDTH - 180 } }), []);
  const whole = useMemo(() => toLibraryGraph(graph), [graph]);
  const wholeBase = useMemo(() => (baseline ? toLibraryGraph(baseline) : undefined), [baseline]);
  // the detail level is applied before the layout, so a coarse level is a small drawing with large labels
  //; the levels that collapse to the stages are left to the library, which builds that scene itself
  const collapsing = DETAIL[drawnLevel]?.abstraction.collapse === "all";
  const scene = useMemo(() => (collapsing ? whole : abstractAt(whole, drawnLevel)), [whole, drawnLevel, collapsing]);
  const base = useMemo(() => (wholeBase && !collapsing ? abstractAt(wholeBase, drawnLevel) : wholeBase), [wholeBase, drawnLevel, collapsing]);
  const scenes = useMemo(() => (base ? [base, scene] : [scene]), [base, scene]);
  const layout = useStableLayout(scenes, layoutOptions);
  const shown = useMemo(() => (compare && base ? diff(base, scene) : scene), [compare, base, scene]);
  const positions = useMemo(() => (layout.positions ? filterPositions(layout.positions, shown) : undefined), [layout.positions, shown]);
  const laidOut = positions as unknown as LaidOut | undefined;
  const areas = useMemo<AreaEntry[]>(() => {
    const byArea = new Map<string, AreaEntry>();
    for (const o of (graph.overlays ?? []) as { payload?: { layer?: string; constraintId?: string; label?: string } }[]) {
      const id = o.payload?.layer;
      const constraint = o.payload?.constraintId;
      if (!id || !constraint) continue;
      const found = byArea.get(id) ?? { id, label: id.replace(/^L\d+_/, "").replace(/_/g, " "), constraints: [] };
      if (!found.constraints.includes(constraint)) found.constraints.push(constraint);
      byArea.set(id, found);
    }
    return [...byArea.values()];
  }, [graph.overlays]);
  const plain = useCallback((id: string) => plainOf?.(id) ?? id, [plainOf]);
  const overlays = useMemo(() => {
    const own = canonicalOverlays((shown.overlays ?? []) as Overlay[])
      .filter((o) => {
        if (hiddenOverlays.has(o.kind)) return false;
        const layer = (o.payload as { layer?: string } | undefined)?.layer;
        return !(layer && hiddenAreas.has(layer));
      })
      // the badge and the tint are titled with the expectation's own name: the answer carries the id there,
      // and an id has no place in a tooltip or an accessible name
      .map((o) => {
        const payload = o.payload as { label?: string; constraintId?: string; description?: string } | undefined;
        if (!payload) return o;
        const id = payload.constraintId ?? payload.label;
        if (!id || !/^[ac]_/.test(String(payload.label ?? ""))) return o;
        return { ...o, payload: { ...payload, label: payload.description?.replace(/\.$/, "") ?? plain(String(id)) } };
      });
    if (!highlight?.length || hiddenOverlays.has("tint")) return own;
    // a tint on the activities of the top drivers, on top of the constraint overlays
    return [...own, ...highlight.map((id) => ({ kind: "tint" as const, target: id, payload: { label: "top driver", value: 1, text: "activity of a top expectation behind the shortfall" } }))];
  }, [shown, highlight, hiddenOverlays, hiddenAreas, plain]);
  const meta = (graph.meta ?? {}) as { cases?: number; events?: number; nodesTotal?: number; stagedActivities?: number; constraintsWithoutNodes?: string[]; pathsHidden?: number };
  const libraryPaths = useMemo(() => {
    if (!focus || !paths) return undefined;
    const clean = (p: FlowPath) => ({ ...p, median_lag: p.median_lag ?? undefined, violation_share: p.violation_share ?? undefined });
    return { focus, incoming: (paths.incoming ?? []).map(clean), outgoing: (paths.outgoing ?? []).map(clean) };
  }, [focus, paths]);
  // stage colours are not an encoding: white boxes, the lane says the stage
  const style = useMemo(() => (compare ? { ...diffStyle, nodeColor: undefined } : { ...defaultStyle, nodeColor: undefined }), [compare]);

  const applyClauses = useCallback(
    (clauses: FilterClause[], toggle = false): string | undefined => {
      if (!onFilterChange) return undefined;
      // the map speaks in node ids; the backend's filter expects activity labels
      const labelled = clauses.map((c) => mapActivities(c, (id) => labelOf(graph, id)));
      let next = filter;
      for (const c of labelled) next = (toggle ? toggleClause(next, c) : addClause(next, c)) ?? { and: [] };
      onFilterChange(next && next.and.length ? next : undefined);
      return `Filter added: ${labelled.map((c) => describeClause(c)).join("; ")}.`;
    },
    [filter, graph, onFilterChange],
  );

  const selectedId = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedEdgeId = selection.edges.length === 1 && selection.nodes.length === 0 ? selection.edges[0] : undefined;
  const selectedEdge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : undefined;
  const selectedGroupId = selection.groups.length === 1 ? selection.groups[0] : undefined;
  const selectedGroup = selectedGroupId ? graph.groups?.find((g) => g.id === selectedGroupId) : undefined;

  /**
   * A selection the reader made: the map keeps it and the host is told once, so the address can carry it.
   * The report happens in the event, never in an effect — a host that writes the address would otherwise be
   * called again on every render it causes.
   */
  const select = useCallback(
    (next: Selection) => {
      setSelection((prev) => (sameSelection(prev, next) ? prev : next));
      if (!onSelectionChange) return;
      const nodeId = next.nodes.length === 1 && next.edges.length === 0 ? next.nodes[0] : undefined;
      const edgeId = next.edges.length === 1 && next.nodes.length === 0 ? next.edges[0] : undefined;
      const groupId = next.groups.length === 1 ? next.groups[0] : undefined;
      const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
      const edge = edgeId ? graph.edges.find((e) => e.id === edgeId) : undefined;
      const group = groupId ? graph.groups?.find((g) => g.id === groupId) : undefined;
      if (node) onSelectionChange({ kind: "node", id: node.id, label: node.label });
      else if (edge) onSelectionChange({ kind: "edge", id: edge.id, label: `${labelOf(graph, edge.source)} → ${labelOf(graph, edge.target)}` });
      else if (group) onSelectionChange({ kind: "group", id: group.id, label: group.label });
      else onSelectionChange(undefined);
    },
    [graph, onSelectionChange],
  );

  // on the board a click is the filter itself (§4.5); the selection never lingers
  useEffect(() => {
    if (!clickFilters) return;
    if (selected?.kind === "activity") {
      applyClauses([clauseForActivity(selected.id, "keep")], true);
      setSelection({ nodes: [], edges: [], groups: [] });
    } else if (selectedEdge && selectedEdge.kind === "follows") {
      applyClauses([{ kind: "follows", a: selectedEdge.source, b: selectedEdge.target, directly: true }], true);
      setSelection({ nodes: [], edges: [], groups: [] });
    }
  }, [clickFilters, selected, selectedEdge, applyClauses]);


  const cases = counts?.casesTotal ?? meta.cases ?? 0;
  const casesIn = counts?.casesIn ?? (preview && filter?.and.length ? preview.cases_in : (meta.cases ?? 0));
  const casesTotal = counts?.casesTotal ?? (preview && filter?.and.length ? preview.cases_in + preview.cases_out : (meta.cases ?? 0));

  const shownActivities = activityCountAt(graph, drawnLevel);
  const totalActivities = meta.nodesTotal ?? graph.nodes.filter((n) => n.kind === "activity").length;
  /**
   * The drawing stretched to the shape of its frame and the lanes drawn to it (§3.2, §6.1, P1-5).
   *
   * Both halves read the box of the **activities**: the stretch spreads them until their shape is the frame's,
   * and the lane is then redrawn around them. Measured on the lanes instead, the shape was already the frame's,
   * so nothing was spread, and the lane's own room for its name was counted as drawing: 45 % of the canvas
   * height above the graph, and every map fitted at 0.38 for a drawing that fits at 0.46.
   */
  const drawnBounds = useMemo(() => boundsOf(Object.values(laidOut?.nodes ?? {})), [laidOut]);
  /** Whether the library draws stage lanes for this scene; without them the drawing is its own box. */
  const hasLanes = (shown.groups ?? []).some((g) => g.kind === "stage" && !g.parent);
  const drawnPositions = useMemo(() => {
    if (kind === "compact" || collapsing) return positions;
    // the zoom the activities alone would be fitted at says how large the counter-scaled lane name and the
    // badge over an activity are drawn, and so how much room the drawing needs around it; one pass, from the
    // frame and the layout only, so nothing here depends on what is then drawn
    const rough = fittedZoom(drawnBounds ?? { width: 0, height: 0 }, canvasBox);
    const grow = Math.max(0, (drawnNodeBox(labelUnitsAt(rough), Object.values(laidOut?.nodes ?? {})).height - NODE_HEIGHT) / 2);
    const room = drawingRoom(rough, hasLanes, grow);
    const spread = withoutRoutes(stretchToFrame(laidOut, drawnBounds, canvasBox, { x: room.x, y: room.top + room.bottom }));
    if (!spread) return positions;
    const bounds = withRoom(boundsOf(Object.values(spread.nodes)), room) ?? spread.bounds;
    return { ...spread, bounds } as unknown as typeof positions;
  }, [kind, collapsing, positions, laidOut, drawnBounds, canvasBox, hasLanes]);
  // the boxes as they are drawn, which say how far a counter-scaled name may grow before it touches its
  // neighbour (R3-06); the layout is never moved for a label, only read
  const drawnBoxes = useMemo<Box[]>(() => Object.values(((drawnPositions as unknown as LaidOut | undefined)?.nodes ?? {}) as Record<string, Box>), [drawnPositions]);
  /**
   * How much of a name this level can show. The zoom is the one the fit will choose — the same arithmetic
   * `FitToView` runs, on the same box — so the answer is known before anything is drawn and no reading of the
   * DOM takes part in it. Where the drawing leaves the boxes too little room for eighteen characters, the bar
   * says so and offers the full window rather than drawing a row of two-letter stubs (R3-06).
   */
  /** The zoom the fit will choose for this drawing in this frame: the same arithmetic `FitToView` runs. */
  const fitZoom = useMemo(() => {
    const bounds = (drawnPositions as unknown as LaidOut | undefined)?.bounds;
    if (kind === "compact" || !bounds) return undefined;
    return fittedZoom(bounds, canvasBox);
  }, [kind, drawnPositions, canvasBox]);
  const nameRoom = useMemo(() => (fitZoom === undefined ? undefined : drawnNodeBox(labelUnitsAt(fitZoom), drawnBoxes)), [fitZoom, drawnBoxes]);
  const namesFit = !nameRoom || nameRoom.chars >= MIN_LABEL_CHARS;
  /**
   * The badges one activity may carry, at the size they are now drawn (P1-4).
   *
   * A badge is a pill of counter-scaled text laid along the top edge of the box, growing leftwards from its
   * right corner: at eleven pixels, three of them are wider than the box and reach over the activity beside
   * it — on the extract five of them read `≤1 0 % - ≤1 0 % - ≥1 5 % - ≥1 5 % ⇒ 89 %` in one illegible row.
   * A badge that cannot be drawn inside its own box is dropped rather than drawn over its neighbour, worst
   * share first, which is also what the legend promises: *the worst expectation at this activity*.
   */
  const badgesPerNode = useMemo(() => {
    if (kind === "compact" || !fitZoom || !nameRoom) return Infinity;
    return Math.max(1, Math.floor((nameRoom.width * fitZoom) / BADGE_WIDTH_PX));
  }, [kind, fitZoom, nameRoom]);
  const drawnOverlays = useMemo(() => {
    if (!Number.isFinite(badgesPerNode)) return overlays;
    // one arc between two activities, as the legend describes it: a second arc over the same pair puts its
    // words on the same pixels as the first and neither can be read
    const seenArcs = new Set<string>();
    const share = (o: { payload?: unknown }) => Number((o.payload as { value?: number } | undefined)?.value ?? 0);
    const kept = new Set<unknown>();
    const byTarget = new Map<string, typeof overlays>();
    for (const o of overlays) {
      if (o.kind !== "badge") continue;
      const target = String(o.target ?? "");
      byTarget.set(target, [...(byTarget.get(target) ?? []), o]);
    }
    for (const list of byTarget.values()) for (const o of [...list].sort((a, b) => share(b) - share(a)).slice(0, badgesPerNode)) kept.add(o);
    return overlays.filter((o) => {
      if (o.kind === "badge") return kept.has(o);
      if (o.kind !== "arc") return true;
      const p = o.payload as { source?: string; target?: string; value?: number } | undefined;
      const key = `${String(p?.source ?? "")}→${String(p?.target ?? "")}`;
      if (seenArcs.has(key)) return false;
      seenArcs.add(key);
      return true;
    });
  }, [overlays, badgesPerNode]);
  /** What a thumbnail is a picture of: its activities and the paths between them, never its lanes (R3-18). */
  const compactBounds = useMemo(() => (kind === "compact" ? boundsOf(drawnBoxes) : undefined), [kind, drawnBoxes]);
  /** Below this width the legend's fixed column is a fifth of the frame; it becomes a pop-over (R3-22). */
  const legendOverCanvas = kind !== "compact" && frameBox.width > 0 && frameBox.width < 1200;

  // the full window is a mode of its own: focus moves into it so Escape and the accelerators are heard
  useEffect(() => {
    if (isFull) root.current?.focus();
  }, [isFull]);

  // a selection the host keeps (a shared link, a frozen snapshot) is the one the map shows
  useEffect(() => {
    if (selectedFromHost === undefined) return;
    setSelection((s) => {
      const next = { nodes: selectedFromHost ? [selectedFromHost] : [], edges: [], groups: [] };
      return sameSelection(s, next) ? s : next;
    });
  }, [selectedFromHost]);

  // keyboard (§3.10): the accelerators of the actions, the detail level, the rendering and the full window
  useEffect(() => {
    if (kind === "compact") return;
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const id = selected?.id;
      const act = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      switch (e.key) {
        case "f":
          if (id) act(() => applyClauses([clauseForActivity(id, "keep")]));
          break;
        case "x":
          if (id) act(() => applyClauses([clauseForActivity(id, "exclude")]));
          break;
        case "i":
          if (id) act(() => onFocusChange?.(focus === id ? undefined : id));
          break;
        case "d":
          if (id && selected) act(() => onAction?.({ id: "lens", ids: [id], label: selected.label }));
          break;
        case "w":
          if (id && selected) act(() => onAction?.({ id: "worst-cases", ids: [id], label: selected.label }));
          break;
        case "p":
          if (id && selected) act(() => onAction?.({ id: "pin", ids: [id], label: selected.label }));
          break;
        case "[":
          act(() => setLevel(level - 1));
          break;
        case "]":
          act(() => setLevel(Math.min(maxLevel, level + 1)));
          break;
        case "M":
        case "m":
          act(() => setMode(mode === "map" ? "model" : mode === "model" ? "table" : "map"));
          break;
        case "F":
          act(() => setFull(!isFull));
          break;
        case "Escape":
          if (selection.nodes.length || selection.edges.length || selection.groups.length) act(() => select({ nodes: [], edges: [], groups: [] }));
          else if (isFull) act(() => setFull(false));
          break;
        default:
          break;
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [kind, selected, focus, level, mode, isFull, selection, maxLevel, applyClauses, onAction, onFocusChange, select, setLevel, setMode, setFull]);

  if (kind === "compact") {
    return (
      <div ref={container} className={cn("wise-map overflow-hidden rounded-md border border-border bg-surface", className)} style={{ height }} data-testid="mini-map">
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
          // R3-18: a thumbnail draws its flow, not its lanes. The stage lanes are 1,475 layout units tall
          // against a 48-unit activity, so a fit that had to hold them drew a lane header and a row of specks
          // — two of the three thumbnails on the extract showed nothing else.
          lanes={lanes}
          lod={{ labels: 0, edgeLabels: 99, badges: 99, arcs: 99, chips: 99, hatch: 99, selfLoops: 99 }}
          locale="en"
          layout={{ elkWorkerUrl }}
          ariaLabel={title}
          containerStyle={{ height: "100%" }}
        >
          {/* the small map is fitted to its activities and paths, which is what the card is a picture of */}
          <FitToView container={container} fitKey={`compact-${shown.nodes.length}-${height}-${drawnBoxes.length}`} bounds={compactBounds} />
          {/* a thumbnail is a picture of the flow, and a picture with unreadable names is not one (R3-06, R3-18) */}
          <ConstantLabels container={container} boxes={drawnBoxes} />
        </ProcessMap>
      </div>
    );
  }

  const selectedWorst = selected
    ? (graph.overlays ?? [])
        .filter((o) => o.target === selected.id && o.kind === "badge" && typeof o.payload?.constraintId === "string" && typeof o.payload?.value === "number")
        .sort((a, b) => Number(b.payload?.value) - Number(a.payload?.value))[0]
    : undefined;
  const stageOf = (id: string | undefined) => graph.groups?.find((g) => g.id === id)?.label;
  // paths of the focused activity that the current detail level does not draw (R3-O8, §3.6)
  const follows = graph.edges.filter((e) => e.kind === "follows");
  const edgeValue = (e: FlowGraph["edges"][number]) => e.metrics?.count ?? e.metrics?.cases ?? 0;
  const maxEdge = Math.max(1, ...follows.map(edgeValue));
  const minEdgeShare = DETAIL[drawnLevel]?.abstraction.minEdgeShare ?? 0;
  const drawnPathIds = new Set(follows.filter((e) => edgeValue(e) / maxEdge >= minEdgeShare).map((e) => `${e.source}→${e.target}`));
  // what the scene actually draws, which is what the path list divides on
  const drawnEdgeKeys = new Set((shown.edges as { source: string; target: string; kind?: string }[]).filter((e) => e.kind === "follows").map((e) => `${e.source}→${e.target}`));
  const otherEnd = (p: FlowPath, direction: "in" | "out") => String(p.node ?? idOf(graph, String((direction === "in" ? p.from : p.to) ?? "")));
  const pathRows = [...(paths?.incoming ?? []).map((p) => ({ p, direction: "in" as const })), ...(paths?.outgoing ?? []).map((p) => ({ p, direction: "out" as const }))];
  const hiddenPaths =
    meta.pathsHidden ??
    (focus ? pathRows.filter(({ p, direction }) => !drawnPathIds.has(direction === "in" ? `${otherEnd(p, direction)}→${focus}` : `${focus}→${otherEnd(p, direction)}`)).length : 0);

  // the scene carries the overlays the map draws, so the names in a tooltip and in an accessible name are
  // the ones the legend and the card use — never the id the answer carries beside them
  const sceneForMap = { ...shown, overlays: overlays as typeof shown.overlays };

  // the fit follows the drawn graph, not only the detail level: a filter, a selection and a change of scene
  // all draw a different picture and all must be fitted again
  const drawnNodeKey = shown.nodes.map((n: { id: string }) => n.id).join(",");
  // What the drawing is told is selected: only elements it draws. A selection the level does not draw would
  // otherwise be announced by its id — "Selected: a_change_quantity" — because the library has no label for
  // an element it never received; the screen says so in words instead (§3.11).
  const drawnIds = new Set<string>([...shown.nodes.map((n: { id: string }) => n.id), ...shown.edges.map((e: { id?: string }) => e.id ?? ""), ...((shown.groups ?? []) as { id: string }[]).map((g) => g.id)]);
  const librarySelection: Selection = { nodes: selection.nodes.filter((id) => drawnIds.has(id)), edges: selection.edges.filter((id) => drawnIds.has(id)), groups: selection.groups.filter((id) => drawnIds.has(id)) };
  const notDrawn = selected && !drawnIds.has(selected.id) ? selected.label : selectedEdge && !drawnIds.has(selectedEdge.id) ? `${labelOf(graph, selectedEdge.source)} → ${labelOf(graph, selectedEdge.target)}` : undefined;
  const fitKey = `${drawnLevel}|${mode}|${isFull}|${layout.status}|${frameHeight}|${compare}|${focus ?? ""}|${selectedId ?? ""}|${drawnNodeKey}`;

  /**
   * The legend, wherever it is placed. Below 1200 px it costs the canvas a fifth of its width — and with it a
   * fifth of the zoom, which is a fifth of every activity name — so on a narrow frame it becomes a button in
   * the bar with a pop-over over the canvas instead of a fixed column beside it (R3-22, and R3-06's own
   * acceptance at 1024 × 768).
   */
  const legend = (open: boolean, onOpenChange: (open: boolean) => void, className?: string) => (
    <MapLegend
      graph={shown}
      compare={compare}
      hidden={hiddenOverlays}
      onToggle={(k) => setHiddenOverlays((s) => toggleSet(s, k))}
      areas={areas}
      hiddenAreas={hiddenAreas}
      onToggleArea={(a) => setHiddenAreas((s) => toggleSet(s, a))}
      onFilterArea={onFilterChange ? (a) => applyClauses([{ kind: "any", clauses: a.constraints.map((c) => clauseForConstraint(c, "violating", plain(c))) }]) : undefined}
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    />
  );

  const filterBar = (
    <div className={cn("flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-1.5 text-sm", isFull ? "px-2" : "px-1")} data-testid="flow-bar">
      {chips !== false && (
        <span className="tnum whitespace-nowrap text-text-muted" data-testid="count-line">
          in <strong className="text-text">{fmtInt(casesIn)}</strong> of {fmtInt(casesTotal)} {noun}
          {filter?.and.length ? ` · ${fmtInt(Math.max(0, casesTotal - casesIn))} out` : ""}
          {noneRemoved ? <span className="ml-2 text-warning">no {noun} removed</span> : null}
        </span>
      )}
      {chips && onFilterChange && (
        // the chips take a line of their own as soon as there is one: squeezed between the count and the
        // detail slider, a long chip overflowed its box and covered the × that removes it
        <FilterChipsRow filter={filter} preview={preview} noun={noun} onChange={onFilterChange} counts={false} className={cn("min-w-0", filter?.and.length ? "basis-full" : undefined)} />
      )}
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <span>detail</span>
        <input
          type="range"
          min={0}
          max={DETAIL.length - 1}
          step={1}
          value={drawnLevel}
          aria-label="Detail of the map, from stages only to all that fit"
          aria-valuetext={DETAIL[drawnLevel]?.label}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="w-28 accent-[var(--color-accent)]"
        />
        <span className="whitespace-nowrap" data-testid="detail-label">
          {DETAIL[drawnLevel]?.label} · {shownActivities} of {totalActivities} activities
        </span>
      </label>
      {(level > maxLevel || !namesFit) && !isFull && (
        <span className="text-xs text-warning" data-testid="detail-warning">
          the names are cut at this level — open the full window
        </span>
      )}
      {layout.status === "pending" && <span aria-live="polite">placing {shownActivities} activities…</span>}
      {layout.status === "error" && <span role="alert">layout failed: {layout.error?.message}</span>}
      <span className="ml-auto flex items-center gap-1">
        {mode !== "table" && legendOverCanvas && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="legend-button">
                ▤ legend
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] p-0">
              {legend(true, () => undefined, "w-full border-l-0")}
            </PopoverContent>
          </Popover>
        )}
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
        <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="How the process is drawn">
          {(["map", "model", "table"] as RenderMode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn("px-2 py-1 text-xs capitalize", mode === m ? "bg-accent-subtle font-medium text-accent-text" : "text-text-muted hover:bg-surface-sunken")}
            >
              {m}
            </button>
          ))}
        </span>
        <Button variant="outline" size="sm" aria-pressed={isFull} onClick={() => setFull(!isFull)} title={isFull ? "Leave the full window (Escape)" : "Fill the window (F)"} aria-label={isFull ? "Leave the full window" : "Fill the window with the map"} data-testid="full-window">
          {isFull ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="More about this map">
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 text-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-subtle">Export</p>
            <button type="button" className="block w-full rounded-sm px-1 py-1 text-left hover:bg-surface-sunken" onClick={() => void downloadBpmn(shown, DETAIL[drawnLevel]?.abstraction, title, bpmnHref)}>
              BPMN 2.0 (.bpmn)
            </button>
            <p className="mt-3 text-xs text-text-subtle">
              Keys: <span className="font-mono">f</span> filter to · <span className="font-mono">x</span> exclude · <span className="font-mono">i</span> paths · <span className="font-mono">d</span> distribution ·{" "}
              <span className="font-mono">w</span> worst cases · <span className="font-mono">p</span> pin · <span className="font-mono">[ ]</span> detail · <span className="font-mono">M</span> map, model, table ·{" "}
              <span className="font-mono">F</span> full window.
            </p>
          </PopoverContent>
        </Popover>
      </span>
    </div>
  );

  const card = (selected || selectedEdge || selectedGroup) && (
    <div className={cn("flex items-center gap-3 overflow-x-auto border-t border-border bg-surface px-3 py-2 text-sm", isFull && "bg-surface/95")} data-testid="selected-activity">
      <p className="reading min-w-0 flex-1 truncate">
        {selected && (
          <>
            <strong>{selected.label}</strong>
            {stageOf(selected.group ?? undefined) ? ` · ${stageOf(selected.group ?? undefined)} stage` : ""}
            {selected.metrics?.cases !== undefined ? (
              <>
                {" · "}
                <span className="tnum">{fmtInt(selected.metrics.cases)}</span> {noun}
                {cases > 0 ? ` (${fmtPct(selected.metrics.cases / cases, selected.metrics.cases / cases < 0.1 ? 1 : 0)})` : ""}
              </>
            ) : null}
            {selected.metrics?.eventsPerCase !== undefined ? ` · ${fmtNum(selected.metrics.eventsPerCase, 1)} events each` : ""}
            {selectedWorst ? ` · worst expectation here: ${plain(String(selectedWorst.payload?.constraintId))} (${fmtPct(Number(selectedWorst.payload?.value), 0)})` : ""}
          </>
        )}
        {selectedEdge && (
          <>
            <strong>
              {labelOf(graph, selectedEdge.source)} → {labelOf(graph, selectedEdge.target)}
            </strong>
            {selectedEdge.metrics?.cases !== undefined ? (
              <>
                {" · "}
                <span className="tnum">{fmtInt(selectedEdge.metrics.cases)}</span> {noun}
              </>
            ) : null}
            {selectedEdge.metrics?.medianLagHours !== undefined ? ` · ${fmtNum(selectedEdge.metrics.medianLagHours / 24, 1)} days median wait` : ""}
          </>
        )}
        {selectedGroup && (
          <>
            <strong>{selectedGroup.label}</strong> · stage
          </>
        )}
      </p>
      <span className="flex shrink-0 gap-2">
        {onFilterChange && selected && (
          <>
            <Button variant="outline" size="sm" onClick={() => applyClauses([clauseForActivity(selected.id, "keep")])} title="Only the items that pass through it (f)">
              Filter to
            </Button>
            <Button variant="outline" size="sm" onClick={() => applyClauses([clauseForActivity(selected.id, "exclude")])} title="Drop the items that pass through it (x)">
              Exclude
            </Button>
          </>
        )}
        {onFilterChange && selectedEdge && (
          <>
            <Button variant="outline" size="sm" onClick={() => applyClauses([{ kind: "follows", a: selectedEdge.source, b: selectedEdge.target, directly: true }])}>
              Filter to items with this connection
            </Button>
            <Button variant="outline" size="sm" onClick={() => applyClauses([{ kind: "follows", a: selectedEdge.source, b: selectedEdge.target, directly: true, never: true }])}>
              Exclude
            </Button>
          </>
        )}
        {onFilterChange && selectedGroup && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyClauses(clauseForStage(graph.nodes.filter((n) => n.group === selectedGroup.id && n.kind === "activity").map((n) => n.id), "keep"))}
          >
            Filter to items entering this stage
          </Button>
        )}
        {selected && onFocusChange && (
          <Button variant="outline" size="sm" onClick={() => onFocusChange(focus === selected.id ? undefined : selected.id)} title="Every path in and out, from the full relation (i)">
            {focus === selected.id ? "Hide the paths" : "Paths in / out"}
          </Button>
        )}
        {selected && onAction && (
          <>
            <Button variant="outline" size="sm" onClick={() => onAction({ id: "lens", ids: [selected.id], label: selected.label })} title="The distribution behind this activity (d)">
              Distribution
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAction({ id: "worst-cases", ids: [selected.id], label: selected.label })} title="The worst cases through here (w)">
              Worst cases
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAction({ id: "pin", ids: [selected.id], label: selected.label })} title="Keep this scene in the comparison strip (p)">
              Pin
            </Button>
          </>
        )}
        {selected && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Every action for ${selected.label}`}>
                ≡
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 text-sm">
              <ul className="flex flex-col gap-1">
                <li>
                  <button type="button" className="w-full rounded-sm px-1 py-1 text-left hover:bg-surface-sunken" onClick={() => applyClauses([{ kind: "activity", op: "starts_with", activity: selected.id }])}>
                    Analyse only the items that start here
                  </button>
                </li>
                <li>
                  <button type="button" className="w-full rounded-sm px-1 py-1 text-left hover:bg-surface-sunken" onClick={() => onAction?.({ id: "add-constraint", ids: [selected.id], label: selected.label })}>
                    Add an expectation here
                  </button>
                </li>
                <li>
                  <button type="button" disabled title="Filtering events inside a case arrives with the event-level filter" className="w-full cursor-not-allowed rounded-sm px-1 py-1 text-left text-text-subtle">
                    Exclude the event, keep the items
                  </button>
                </li>
              </ul>
            </PopoverContent>
          </Popover>
        )}
        <button type="button" aria-label="Clear the selection" className="rounded-sm p-1 text-text-muted hover:bg-surface-sunken" onClick={() => select({ nodes: [], edges: [], groups: [] })}>
          <X className="size-4" aria-hidden />
        </button>
      </span>
    </div>
  );

  const body =
    mode === "model" ? (
      <Suspense fallback={<LoadingBlock rows={5} className="p-4" />}>
        <ModelView scene={shown} abstraction={DETAIL[drawnLevel]?.abstraction} overlays={overlays} selected={selected?.id} onSelect={(id) => setSelection({ nodes: id ? [id] : [], edges: [], groups: [] })} height={frameHeight} graph={graph} />
      </Suspense>
    ) : (
      <div ref={container} className="wise-map min-w-0 flex-1 overflow-hidden">
        <ProcessMap
          graph={sceneForMap}
          positions={drawnPositions}
          overlays={drawnOverlays}
          style={style}
          abstraction={DETAIL[drawnLevel]?.abstraction}
          controls={false}
          legend={false}
          minimap={false}
          view={mode === "table" ? "table" : "map"}
          onViewChange={(v) => setMode(v === "table" ? "table" : "map")}
          locale="en"
          layout={{ elkWorkerUrl }}
          ariaLabel={title}
          containerStyle={{ height: "100%" }}
          lanes={lanes}
          focus={focus === undefined ? undefined : (focus ?? null)}
          onFocusChange={(f) => onFocusChange?.(typeof f === "string" ? f : Array.isArray(f) ? f[0] : undefined)}
          paths={libraryPaths}
          // the flow library lists the same paths in a panel of its own; one answer, drawn once (R3-11)
          pathList={false}
          selection={librarySelection}
          onSelect={select}
          onAction={(action, target) => {
            if ((action.id === "filter-to" || action.id === "exclude") && action.clause) return applyClauses((Array.isArray(action.clause) ? action.clause : [action.clause]) as unknown as FilterClause[]);
            if (action.id === "lens" || action.id === "worst-cases" || action.id === "pin" || action.id === "add-constraint") onAction?.({ id: action.id, ids: target.ids, label: target.label });
            if (action.id === "paths" && target.ids[0]) onFocusChange?.(target.ids[0]);
            if (action.id === "clear-focus") onFocusChange?.(undefined);
            return undefined;
          }}
          announce={announce}
        >
          <FitToView container={container} fitKey={fitKey} bounds={(drawnPositions as unknown as LaidOut | undefined)?.bounds} />
          {/* the names are drawn at a constant size on the screen, whatever the width of the process (R3-06) */}
          <ConstantLabels container={container} boxes={drawnBoxes} />
          <ZoomControls onFull={() => setFull(!isFull)} full={isFull} />
        </ProcessMap>
      </div>
    );

  // a frame the layout sizes: the Flow step and the full window. Everywhere else the host names the height.
  const fluid = kind === "page" || isFull;
  // §3.11: the selection the level does not draw is named in words, with the one step that shows it
  const notDrawnLine = notDrawn ? (
    <p className="truncate px-1 pt-1 text-xs text-warning" data-testid="not-drawn">
      {notDrawn} is not drawn at this level.{" "}
      {level < DETAIL.length - 1 && (
        <button type="button" className="text-accent-text underline" onClick={() => setLevel(level + 1)}>
          Raise the detail
        </button>
      )}
    </p>
  ) : null;
  // one answer, one sentence: while the sheet lists the paths it says how many are hidden, so the line under
  // the frame does not say it a second time (R3-11)
  const pathsShown = mode !== "table" && !!focus && !!paths && !!(paths.incoming?.length || paths.outgoing?.length);
  const hiddenPathsLine =
    focus && hiddenPaths > 0 && !pathsShown ? (
      <p className="truncate px-1 pt-1 text-xs text-text-muted" data-testid="paths-hidden">
        {hiddenPaths} {hiddenPaths === 1 ? "path is" : "paths are"} below this detail level.{" "}
        <button type="button" className="text-accent-text underline" onClick={() => setLevel(maxLevel)}>
          Show them
        </button>
      </p>
    ) : null;
  const footnoteLine =
    footnote && !isFull && meta.constraintsWithoutNodes && meta.constraintsWithoutNodes.length > 0 ? (
      <p className="truncate px-1 pt-1 text-xs text-text-subtle" data-testid="map-footnote">
        {meta.constraintsWithoutNodes.length} expectations are about the case as a whole and have no place on the map (
        {meta.constraintsWithoutNodes.slice(0, 3).map((id) => plain(id)).join(", ")}
        {meta.constraintsWithoutNodes.length > 3 ? ", …" : ""}). Open them in the board.
      </p>
    ) : null;
  const underFrame = fluid ? (
    <div className="h-[22px] shrink-0 overflow-hidden" data-testid="under-frame">
      {notDrawnLine ?? hiddenPathsLine ?? footnoteLine}
    </div>
  ) : (
    <>
      {notDrawnLine}
      {hiddenPathsLine}
      {footnoteLine}
    </>
  );

  return (
    <div
      ref={root}
      tabIndex={-1}
      className={cn("flex min-w-0 flex-col outline-none", isFull ? "fixed inset-0 z-overlay bg-bg" : "", className)}
      data-testid="flow-map"
      data-full={isFull ? "1" : undefined}
      role={isFull ? "dialog" : undefined}
      aria-label={isFull ? `${title} — full window` : undefined}
    >
      {filterBar}
      <div
        ref={frameRef}
        className={cn("relative flex min-h-0 min-w-0 items-stretch overflow-hidden border border-border bg-surface", isFull ? "rounded-none" : "rounded-md", fluid && "flex-1")}
        style={fluid ? undefined : { height: frameHeight }}
        data-testid="map-frame"
      >
        {body}
        {pathsShown ? (
          <PathSheet
            focusLabel={labelOf(graph, focus)}
            incoming={paths.incoming ?? []}
            outgoing={paths.outgoing ?? []}
            labelOfId={(id) => labelOf(graph, id)}
            isDrawn={(p, direction) => {
              const end = String(p.node ?? idOf(graph, String((direction === "in" ? p.from : p.to) ?? "")));
              return drawnEdgeKeys.has(direction === "in" ? `${end}\u2192${focus}` : `${focus}\u2192${end}`);
            }}
            noun={noun}
            canShowHidden={level < DETAIL.length - 1}
            onShowHidden={() => setLevel(DETAIL.length - 1)}
            onClose={() => onFocusChange?.(undefined)}
            onFilter={
              onFilterChange
                ? (p, direction) => {
                    const end = String(p.node ?? idOf(graph, String((direction === "in" ? p.from : p.to) ?? "")));
                    applyClauses([{ kind: "follows", a: direction === "in" ? end : focus, b: direction === "in" ? focus : end, directly: true }]);
                  }
                : undefined
            }
          />
        ) : null}
        {mode !== "table" && !legendOverCanvas && legend(legendOpen, (o) => {
          setLegendOpen(o);
          try {
            window.localStorage.setItem(LEGEND_KEY, o ? "open" : "closed");
          } catch {
            /* a browser without storage keeps the legend open for this visit only */
          }
        })}
        {isFull && card && <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur-sm">{card}</div>}
      </div>
      {/* The card's band is reserved whether or not something is selected: opening it must never resize the
          frame. The same holds for the line under the frame. In the full window the card
          overlays the bottom of the map instead, so that the frame keeps the whole window (§3.8). */}
      {isFull ? null : fluid ? (
        <div className="h-[52px] shrink-0 overflow-hidden" data-testid="card-band">
          {card}
        </div>
      ) : (
        card
      )}
      {isFull ? null : underFrame}
    </div>
  );
}

/** Two selections are the same when they name the same elements; identity alone would loop the controlled map. */
function sameSelection(a: Selection, b: Selection): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return same(a.nodes, b.nodes) && same(a.edges, b.edges) && same(a.groups, b.groups);
}

function toggleSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** The scene as BPMN 2.0, generated from the log at the current detail level and saved as a file (§3.9). */
async function downloadBpmn(scene: LibraryGraph, abstraction: { minNodeShare: number; minEdgeShare: number; keepConnected: true; collapse?: "all" } | undefined, title: string, href?: string) {
  const save = (xml: string) => {
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.bpmn`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // the server exports the same scene when it serves the operation; otherwise the browser generates it
  if (href) {
    try {
      const res = await fetch(href);
      if (res.ok) {
        save(await res.text());
        return;
      }
    } catch {
      /* fall through to the diagram generated in the browser */
    }
  }
  const { liteFromGraph, exportBpmn } = await import("@wise/flow/bpmn");
  const lite = liteFromGraph(scene, { abstraction, lanes: "groups", selfLoops: "marker" });
  const { xml } = await exportBpmn(lite, { name: title, format: true });
  save(xml);
}

/** A small map for a card: activities and the strongest paths, no controls. */
export function MiniMap({ graph, title, height = 170, className }: { graph: FlowGraph; title: string; height?: number; className?: string }) {
  return <FlowMap graph={graph} title={title} height={height} className={className} frame="compact" lanes="none" />;
}

/** The activity ids a filter refers to, for hosts that still hold labels: labels back to ids of this graph. */
export function filterWithIds(graph: FlowGraph, filter: Filter | undefined): Filter | undefined {
  return filter ? { and: filter.and.map((c) => mapActivities(c, (label) => idOf(graph, label))) } : undefined;
}

export default FlowMap;
