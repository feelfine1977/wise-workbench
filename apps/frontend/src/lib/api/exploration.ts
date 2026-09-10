/** Feature API: exploration. Generated DTOs remain the wire contract. */
import type { RunScope } from "./runs";
import type { Filter } from "./filter-types";
import { canonicalFilter, filterHash } from "@/lib/filter";
import { queryOptions } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const explorationKeys = {
  filterPreview: (p: string, r: string, filter: string) => ["projects", p, "runs", r, "filters", "preview", filter] as const,
  slicingPreview: (p: string, r: string, slicing: string, bands: string, minCases: number) => ["projects", p, "runs", r, "slicings", "preview", slicing, bands, minCases] as const,
};

export type BandSpec = S["BandSpec"];

export type SlicingSpec = S["SlicingSpec"];

export type FilterPreview = S["FilterPreview"];

export type SlicingPreview = S["SlicingPreview"];

/** The `params` block of a backlog page as the backend fills it in this cycle. */
export interface BacklogParams {
  slicing?: string;
  attributes?: string[];
  bands?: unknown[];
  view?: string;
  gamma?: number;
  minCases?: number;
  window_end?: string | null;
  case_noun?: string | null;
  scope?: RunScope | null;
  drill?: { slicing: string; attributes: string[]; key: unknown[] } | null;
  filter?: Filter | null;
  /** Cases the filter (or the drill) keeps. */
  cases?: number | null;
  analytics_record_ids?: Record<string, string>;
  analytics_available?: boolean;
  stability_applies?: boolean;
  /** Set by the mocks on slicings whose rows are made up rather than read from the verified run. */
  illustrative?: boolean;
  /** Expectations whose threshold needs calibrating on this log (R2-09): the run's own list. */
  uncalibrated?: UncalibratedExpectation[];
  /**
   * The data caveats of the **whole run** (R3-09), keyed by caveat id, so the page-wide line reads the same
   * on every page of a ranked list instead of the caveats of whichever fifty rows are on the screen.
   */
  caveat_summary?: Record<string, RunCaveat> | RunCaveat[] | null;
}

/** One entry of `params.caveat_summary`: what a caveat looks like over the whole run. */
export interface RunCaveat {
  id?: string;
  /** Groups the caveat touches, and how many groups the run ranked. */
  groups?: number | null;
  groupsTotal?: number | null;
  /** The share it holds on across the run, and the largest share on any one group. */
  share?: number | null;
  max?: number | null;
  /** The share above which the caveat is worth stating. */
  threshold?: number | null;
  text?: string | null;
  status?: string | null;
}

/** The same entry as the server writes it (`page_share`, `max_share`); the two namings are read as one. */
interface ServedCaveat extends RunCaveat {
  page_share?: number | null;
  max_share?: number | null;
}

/**
 * The run's caveats as one list, whichever shape the backend serves them in (R3-09). `undefined` means this
 * backend does not compute the summary yet — the caller then says which population its line describes,
 * rather than printing a run-wide sentence built from one page.
 */
export function runCaveats(params: BacklogParams | undefined): RunCaveat[] | undefined {
  const raw = params?.caveat_summary;
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, v]) => ({ id, ...(v as ServedCaveat) }));
  return list
    .filter((c): c is ServedCaveat & { id: string } => typeof c.id === "string" && c.id.length > 0)
    .map((c) => ({ ...c, share: c.share ?? c.page_share ?? null, max: c.max ?? c.max_share ?? null }));
}

/** One entry of `params.uncalibrated`: an expectation that separates no group on this log. */
export interface UncalibratedExpectation {
  id: string;
  layer?: string;
  plain_name?: string | null;
  description?: string | null;
  share_violated?: number;
  evaluated?: number;
  reason?: string;
  text?: string;
}

/** The run's uncalibrated expectations by id, for the chips that flag them wherever they are named. */
export function uncalibratedById(params: BacklogParams | undefined): Map<string, UncalibratedExpectation> {
  return new Map((params?.uncalibrated ?? []).map((u) => [u.id, u]));
}

/** Drill into one group (R2-O2): the finer slicing is restricted to the group's cases. */
export interface Within {
  slicing: string;
  key: string;
}

export const filterParam = (f: Filter | undefined): string | undefined => (f && f.and.length ? JSON.stringify(f) : undefined);

export const bandsParam = (bands: BandSpec[] | undefined): string | undefined => (bands && bands.length ? JSON.stringify(bands) : undefined);

/** The canonical form goes to the server, so the same clicks always produce the same request (§2.3). */
export const canonicalParam = (f: Filter | undefined): string | undefined => filterParam(canonicalFilter(f));

/** The share link of a scene: the canonical filter's short hash (§2.3). */
export const sceneHash = (filter: Filter | undefined): string | undefined => filterHash(filter);

export const filterPreviewQuery = (projectId: string, runId: string, filter: Filter | undefined) => {
  const f = filterParam(filter) ?? "";
  return queryOptions({
    queryKey: explorationKeys.filterPreview(projectId, runId, f),
    queryFn: () => http.get<FilterPreview>(`/projects/${enc(projectId)}/runs/${enc(runId)}/filters/preview`, { filter: f }),
    staleTime: IMMUTABLE,
  });
};

export const slicingPreviewQuery = (projectId: string, runId: string, attributes: string[], bands: BandSpec[] | undefined, minCases: number) => {
  const slicing = attributes.join(",");
  const b = bandsParam(bands) ?? "";
  return queryOptions({
    queryKey: explorationKeys.slicingPreview(projectId, runId, slicing, b, minCases),
    queryFn: () => http.get<SlicingPreview>(`/projects/${enc(projectId)}/runs/${enc(runId)}/slicings/preview`, { slicing, bands: b || undefined, minCases }),
    staleTime: IMMUTABLE,
  });
};

export type { BacklogRow, SliceDetail } from "@wise/api-schema";
export { backlogQuery, sliceQuery } from "@/lib/queries";
