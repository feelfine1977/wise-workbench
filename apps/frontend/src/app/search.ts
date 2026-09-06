/** Typed URL search params: every filter lives in the URL (UX-1). Validators are hand-written and tolerant. */
import type { SearchSchemaInput } from "@tanstack/react-router";
import type { HotspotType, Kind } from "@wise/api-schema";
import { KIND_OF_HOTSPOT } from "@/lib/vocabulary";

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

export const SLICE_TABS = ["drivers", "distributions", "cases", "validation", "flow", "headroom"] as const;
export type SliceTab = (typeof SLICE_TABS)[number];

export interface SliceSearch {
  slicing?: string;
  view?: string;
  tab: SliceTab;
  case?: string;
  constraint?: string;
  focus?: "finding";
  pins?: string[];
}

export function validateSliceSearch(input: Partial<SliceSearch> & SearchSchemaInput): SliceSearch {
  const s = input as Record<string, unknown>;
  return {
    slicing: str(s.slicing),
    view: str(s.view),
    tab: oneOf(s.tab, SLICE_TABS) ?? "drivers",
    case: str(s.case),
    constraint: str(s.constraint),
    focus: oneOf(s.focus, ["finding"] as const),
    pins: list(s.pins)?.slice(0, 3),
  };
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

export interface DatasetSearch {
  caseTable?: string;
}
export function validateDatasetSearch(input: Partial<DatasetSearch> & SearchSchemaInput): DatasetSearch {
  const s = input as Record<string, unknown>;
  return { caseTable: str(s.caseTable) };
}

export const RUN_TABS = ["monitor", "flow"] as const;
export type RunTab = (typeof RUN_TABS)[number];
export interface RunSearch {
  tab: RunTab;
}
export function validateRunSearch(input: Partial<RunSearch> & SearchSchemaInput): RunSearch {
  const s = input as Record<string, unknown>;
  return { tab: oneOf(s.tab, RUN_TABS) ?? "monitor" };
}
