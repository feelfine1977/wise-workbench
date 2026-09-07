/** Typed URL search params: every filter lives in the URL (UX-1). Validators are hand-written and tolerant. */
import { parseSearchWith, stringifySearchWith, type SearchSchemaInput } from "@tanstack/react-router";
import type { HotspotType, Kind } from "@wise/api-schema";
import { KIND_OF_HOTSPOT } from "@/lib/vocabulary";

/**
 * Search-param serialisation of the router: a string holding the JSON of an object (the filter model, the
 * drill-in group) is written as that JSON, not as a JSON string of a string; every other value keeps the
 * router's round trip (numbers, booleans, arrays and strings that look like them are quoted once).
 */
export const parseSearch = parseSearchWith(JSON.parse);
export const stringifySearch = stringifySearchWith(JSON.stringify, (value: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) throw new Error("object JSON is written as is");
  return parsed;
});

const HOTSPOTS: readonly HotspotType[] = ["severity", "mechanism", "reservoir"];
const KINDS: readonly Kind[] = ["acute", "systematic", "widespread"];
export const SORTABLE = ["key", "n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI", "PI_lower", "rank"] as const;
export type SortColumn = (typeof SORTABLE)[number];
export const BACKLOG_TABS = ["signals", "table", "scatter"] as const;
export type BacklogTab = (typeof BACKLOG_TABS)[number];

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (v: unknown): boolean | undefined => (v === true || v === "true" || v === "1" ? true : undefined);
const oneOf = <T extends string>(v: unknown, options: readonly T[]): T | undefined => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : undefined);
/**
 * A JSON object given as a string or already parsed by the router; kept as a string in the application. The
 * router writes it to the address as the object's JSON (`filter={"and":…}`, see `stringifySearch`).
 */
const json = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.length > 1) return v;
  if (v && typeof v === "object") return JSON.stringify(v);
  return undefined;
};
const list = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.length) return v.split(",").filter(Boolean);
  return undefined;
};

export interface BacklogSearch {
  slicing?: string;
  view?: string;
  gamma?: number;
  minCases: number;
  sort: string;
  /** Signals list (default), the metric table, or all groups at once (scatter). */
  tab: BacklogTab;
  /** Only this kind of problem; `hotspotType` in the URL is accepted as the method's alias. */
  kind?: Kind;
  layer?: string;
  /** Only high-confidence ranks. */
  confident?: boolean;
  q?: string;
  page: number;
  pageSize: number;
  pins?: string[];
  row?: string;
  /** The filter model (RF-01) as URL-safe JSON; scopes the list, the map and the analytics. */
  filter?: string;
  /** Drill into one group: a finer slicing restricted to the group's cases, as JSON `{slicing, key}`. */
  within?: string;
}

export const BACKLOG_DEFAULTS = { minCases: 20, sort: "-stable_PI", tab: "signals", page: 1, pageSize: 10 } as const;

export function validateBacklogSearch(input: Partial<BacklogSearch> & SearchSchemaInput): BacklogSearch {
  const s = input as Record<string, unknown>;
  const sort = str(s.sort);
  const sortCol = sort ? sort.replace(/^-/, "") : "";
  const hotspot = oneOf(s.hotspotType, HOTSPOTS);
  return {
    slicing: str(s.slicing),
    view: str(s.view),
    gamma: num(s.gamma),
    minCases: num(s.minCases) ?? BACKLOG_DEFAULTS.minCases,
    sort: sort && (SORTABLE as readonly string[]).includes(sortCol) ? sort : BACKLOG_DEFAULTS.sort,
    tab: oneOf(s.tab, BACKLOG_TABS) ?? BACKLOG_DEFAULTS.tab,
    kind: oneOf(s.kind, KINDS) ?? (hotspot ? KIND_OF_HOTSPOT[hotspot] : undefined),
    layer: str(s.layer),
    confident: bool(s.confident),
    q: str(s.q),
    page: Math.max(1, Math.floor(num(s.page) ?? BACKLOG_DEFAULTS.page)),
    pageSize: Math.min(500, Math.max(10, Math.floor(num(s.pageSize) ?? BACKLOG_DEFAULTS.pageSize))),
    pins: list(s.pins)?.slice(0, 3),
    row: str(s.row),
    filter: json(s.filter),
    within: json(s.within),
  };
}

/** Removes defaults so URLs stay short. */
export function stripBacklogDefaults(s: BacklogSearch): Partial<BacklogSearch> {
  const out: Partial<BacklogSearch> = { ...s };
  if (out.minCases === BACKLOG_DEFAULTS.minCases) delete out.minCases;
  if (out.sort === BACKLOG_DEFAULTS.sort) delete out.sort;
  if (out.tab === BACKLOG_DEFAULTS.tab) delete out.tab;
  if (out.page === BACKLOG_DEFAULTS.page) delete out.page;
  if (out.pageSize === BACKLOG_DEFAULTS.pageSize) delete out.pageSize;
  if (!out.pins?.length) delete out.pins;
  if (!out.confident) delete out.confident;
  for (const k of Object.keys(out) as (keyof BacklogSearch)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export const SLICE_TABS = ["why", "compared", "flow", "cases", "trust", "gain"] as const;
export type SliceTab = (typeof SLICE_TABS)[number];
/** The tab values of earlier links map onto the six questions of the reason screen. */
const OLD_SLICE_TABS: Record<string, SliceTab> = { drivers: "why", distributions: "compared", validation: "trust", headroom: "gain" };
export function sliceTabOf(raw: unknown): SliceTab {
  const direct = oneOf(raw, SLICE_TABS);
  if (direct) return direct;
  return (typeof raw === "string" && OLD_SLICE_TABS[raw]) || "why";
}

export interface SliceSearch {
  slicing?: string;
  view?: string;
  tab: SliceTab;
  case?: string;
  constraint?: string;
  focus?: "finding";
  pins?: string[];
  filter?: string;
  /** Activity whose paths are shown on the map. */
  activity?: string;
}

export function validateSliceSearch(input: Partial<SliceSearch> & SearchSchemaInput): SliceSearch {
  const s = input as Record<string, unknown>;
  return {
    slicing: str(s.slicing),
    view: str(s.view),
    tab: sliceTabOf(s.tab),
    case: str(s.case),
    constraint: str(s.constraint),
    focus: oneOf(s.focus, ["finding"] as const),
    pins: list(s.pins)?.slice(0, 3),
    filter: json(s.filter),
    activity: str(s.activity),
  };
}

export const RENDER_MODES = ["map", "model", "table"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];
export const BREAKDOWNS = ["flow_type", "period", "attribute"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/**
 * The Flow step and the board are two arrangements of one step, so they share their state (§3.1, §4.1):
 * context (perspective, grouping, scope), the canonical filter with its short hash, the detail level, the
 * rendering, the selection and the full window. `f` is accepted as the short name of `filter`.
 */
export interface FlowSearch {
  view?: string;
  slicing?: string;
  /** All flows, or one flow type. */
  scope?: string;
  detail?: number;
  /** The selected element, as `activity:<label>` or `path:<a>→<b>`. */
  sel?: string;
  /** The activity whose paths are drawn. */
  activity?: string;
  filter?: string;
  /** The short hash of the canonical filter, for share links and caches. */
  fh?: string;
  full?: boolean;
  render: RenderMode;
  /** The expectation the lens shows when it is open. */
  lens?: string;
}

export function validateFlowSearch(input: Partial<FlowSearch> & SearchSchemaInput): FlowSearch {
  const s = input as Record<string, unknown>;
  const detail = num(s.detail);
  return {
    view: str(s.view),
    slicing: str(s.slicing),
    scope: str(s.scope),
    detail: detail === undefined ? undefined : Math.max(0, Math.min(4, Math.round(detail))),
    sel: str(s.sel),
    activity: str(s.activity),
    filter: json(s.filter) ?? json(s.f),
    fh: str(s.fh),
    full: bool(s.full),
    render: oneOf(s.render, RENDER_MODES) ?? "map",
    lens: str(s.lens),
  };
}

export interface BoardSearch extends FlowSearch {
  /** The board's own selectors: period, expectation area, group (§4.4). */
  period?: string;
  area?: string;
  group?: string;
  /** Which dimension the breakdown shows, and which attribute in its third tab. */
  breakdown: Breakdown;
  attribute?: string;
  /** The panel opened to the full window. */
  panel?: string;
  /** The saved board this screen was opened from. */
  board?: string;
}

export function validateBoardSearch(input: Partial<BoardSearch> & SearchSchemaInput): BoardSearch {
  const s = input as Record<string, unknown>;
  return {
    ...validateFlowSearch(input),
    period: str(s.period),
    area: str(s.area),
    group: str(s.group),
    breakdown: oneOf(s.breakdown, BREAKDOWNS) ?? "flow_type",
    attribute: str(s.attribute),
    panel: str(s.panel),
    board: str(s.board),
  };
}

export interface CompareSearch {
  view?: string;
  slicing?: string;
}
export function validateCompareSearch(input: Partial<CompareSearch> & SearchSchemaInput): CompareSearch {
  const s = input as Record<string, unknown>;
  return { view: str(s.view), slicing: str(s.slicing) };
}

export interface NotebookSearch {
  snapshot?: string;
}
export function validateNotebookSearch(input: Partial<NotebookSearch> & SearchSchemaInput): NotebookSearch {
  const s = input as Record<string, unknown>;
  return { snapshot: str(s.snapshot) };
}

export const NORM_TABS = ["constraints", "json", "history"] as const;
export type NormTab = (typeof NORM_TABS)[number];
export interface NormSearch {
  tab: NormTab;
  constraint?: string;
}
export function validateNormSearch(input: Partial<NormSearch> & SearchSchemaInput): NormSearch {
  const s = input as Record<string, unknown>;
  return { tab: oneOf(s.tab, NORM_TABS) ?? "constraints", constraint: str(s.constraint) };
}

export const DATASET_TABS = ["readiness", "mapping", "flows"] as const;
export type DatasetTab = (typeof DATASET_TABS)[number];
export interface DatasetSearch {
  caseTable?: string;
  tab: DatasetTab;
}
export function validateDatasetSearch(input: Partial<DatasetSearch> & SearchSchemaInput): DatasetSearch {
  const s = input as Record<string, unknown>;
  return { caseTable: str(s.caseTable), tab: oneOf(s.tab, DATASET_TABS) ?? "readiness" };
}

/** The hub's search box keeps its word in the address, so a page of the hub can be shared as it was read. */
export interface KnowledgeSearch {
  q?: string;
}
export function validateKnowledgeSearch(input: Partial<KnowledgeSearch> & SearchSchemaInput): KnowledgeSearch {
  const s = input as Record<string, unknown>;
  return { q: str(s.q) };
}

/** *What can we do?* — the seventh step of one group; it carries the group's context, nothing else. */
export interface ActSearch {
  slicing?: string;
  view?: string;
  /** The expectation a reason or an action was opened from. */
  constraint?: string;
}
export function validateActSearch(input: Partial<ActSearch> & SearchSchemaInput): ActSearch {
  const s = input as Record<string, unknown>;
  return { slicing: str(s.slicing), view: str(s.view), constraint: str(s.constraint) };
}

export const RUN_TABS = ["monitor", "flow", "compare"] as const;
export type RunTab = (typeof RUN_TABS)[number];
export interface RunSearch {
  tab: RunTab;
}
export function validateRunSearch(input: Partial<RunSearch> & SearchSchemaInput): RunSearch {
  const s = input as Record<string, unknown>;
  return { tab: oneOf(s.tab, RUN_TABS) ?? "monitor" };
}
