/**
 * Third-release sources: the numbers the Flow step and the explore board read beside the flow and the ranked
 * list — counts by facet under the canonical filter, the four tile numbers, and the period breakdown
 * (`docs/panel/ui_design_cycle3_board.md` §5.2). The backend of this cycle serves them at
 * `GET …/runs/{id}/facets` and `GET …/runs/{id}/kpis`; they are not in `packages/api-schema/openapi.yaml`
 * yet, so the shapes are written here by hand and the queries fall back to what the second-release contract
 * already serves (the filter preview, the run summary, the ranked list, the flow-type comparison) so a board
 * is never empty on a backend that does not know the new operations. A fallback answer carries `derived` and
 * the panels then show the lock chip and the words *all items* (§4.7).
 */
import { queryOptions } from "@tanstack/react-query";
import type { BacklogPage, Distribution, FacetValue as GeneratedFacetValue, Facets as GeneratedFacets, FlowGraph, KpiTile as GeneratedKpiTile, Kpis as GeneratedKpis, ManifestRow as GeneratedManifestRow, RunManifestView as GeneratedRunManifestView, RunSummary } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import { c2, filterParam, type Filter, type FilterPreview, type FlowTypeComparison, type FlowTypeComparisonEntry, type UncalibratedExpectation } from "@/lib/api/cycle2";
import { apiBase } from "@/lib/config";
import { canonicalFilter, filterHash } from "@/lib/filter";

const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

/** The canonical form goes to the server, so the same clicks always produce the same request (§2.3). */
export const canonicalParam = (f: Filter | undefined): string | undefined => filterParam(canonicalFilter(f));

// ---------------------------------------------------------------- shapes (packages/api-schema/openapi.yaml)

/**
 * The board's shapes come from the contract now that it carries the operations: `Facets`, `FacetValue`,
 * `Kpis`, `KpiTile` and `RunManifestView` are generated from `packages/api-schema/openapi.yaml`
 * (`npm run generate`). Only the two flags the client itself sets are written here.
 */
export type FacetBy = NonNullable<GeneratedFacets["by"]>;
export type PeriodKind = "month" | "quarter" | "year" | "week";
export type FacetValue = GeneratedFacetValue;
export type KpiTile = GeneratedKpiTile;

/** A facet answer, with what the client adds when it had to assemble one from the older operations. */
export type Facets = GeneratedFacets & {
  /** Set by the client when the answer was assembled from the second-release endpoints. */
  derived?: boolean;
  /** False when the numbers are the unfiltered ones because the source cannot filter (lock chip, *all items*). */
  filtered?: boolean;
};

export type Kpis = GeneratedKpis & { derived?: boolean };

/** `graph.paths` of `GET …/flow?focus=`, with what the backend says about paths below the detail level. */
export interface ActivityPaths {
  focus: string;
  incoming: Record<string, unknown>[];
  outgoing: Record<string, unknown>[];
  /** Paths of the activity that the current detail level does not draw (R3-O8). */
  hidden: number;
}

// ---------------------------------------------------------------- keys

export const keys3 = {
  facets: (p: string, r: string, by: FacetBy, attribute: string, view: string, period: string, filter: string) => ["projects", p, "runs", r, "facets", by, attribute, view, period, filter] as const,
  kpis: (p: string, r: string, view: string, grouping: string, filter: string) => ["projects", p, "runs", r, "kpis", view, grouping, filter] as const,
};

const notServed = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);

// ---------------------------------------------------------------- facets (counts by flow type, period or attribute)

export interface FacetParams {
  by: FacetBy;
  /** The case attribute for `by: "attribute"`. */
  attribute?: string;
  view?: string;
  gamma?: number;
  period?: PeriodKind;
  minCases?: number;
  limit?: number;
  filter?: Filter;
}

async function facetsFromFlowTypes(projectId: string, runId: string, view: string | undefined): Promise<Facets> {
  const cmp = await c2.get<FlowTypeComparison>(`/projects/${enc(projectId)}/runs/${enc(runId)}/compare-flow-types`);
  const types = cmp.types as unknown as FlowTypeComparisonEntry[];
  const v = view && cmp.views.includes(view) ? view : (cmp.views[0] ?? "");
  const total = types.reduce((s, t) => s + t.cases, 0);
  return {
    by: "flow_type",
    field: cmp.attribute,
    cases: total,
    casesTotal: total,
    total: types.length,
    shown: types.length,
    derived: true,
    filtered: false,
    values: types.map((t) => ({
      value: t.name,
      label: t.name,
      cases: t.cases,
      share: t.share,
      mean_score: t.views[v]?.mean_score ?? null,
      share_below_expectation: t.views[v] ? 1 - t.views[v].mean_score : null,
      priority_at_stake: t.topGroups.reduce((s, g) => s + (g.stable_PI ?? 0), 0) || null,
      open_share: t.censoredShare ?? null,
    })),
  };
}

export const facetsQuery = (projectId: string, runId: string, params: FacetParams) => {
  const f = canonicalParam(params.filter) ?? "";
  return queryOptions({
    queryKey: keys3.facets(projectId, runId, params.by, params.attribute ?? "", params.view ?? "", params.period ?? "", f),
    queryFn: async (): Promise<Facets> => {
      try {
        const served = await c2.get<Facets>(`/projects/${enc(projectId)}/runs/${enc(runId)}/facets`, {
          by: params.by,
          attribute: params.attribute,
          view: params.view,
          gamma: params.gamma,
          period: params.period,
          minCases: params.minCases,
          limit: params.limit,
          filter: f || undefined,
        });
        return { ...served, filtered: served.filtered ?? true };
      } catch (error) {
        if (params.by === "flow_type" && notServed(error)) return facetsFromFlowTypes(projectId, runId, params.view);
        throw error;
      }
    },
    staleTime: IMMUTABLE,
    placeholderData: (prev: Facets | undefined) => prev,
  });
};

/** The window a period bar stands for, from the label the facet carries ("2018-10", "2018-Q4", "2018", "2018-W42"). */
export function periodWindow(label: string): { from: string; to: string } | undefined {
  const end = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const year = /^(\d{4})$/.exec(label);
  if (year) return { from: `${year[1]}-01-01`, to: `${year[1]}-12-31` };
  const quarter = /^(\d{4})-Q([1-4])$/.exec(label);
  if (quarter) {
    const y = Number(quarter[1]);
    const m = (Number(quarter[2]) - 1) * 3;
    return { from: `${quarter[1]}-${String(m + 1).padStart(2, "0")}-01`, to: end(y, m + 2) };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]) - 1;
    return { from: `${month[1]}-${month[2]}-01`, to: end(y, m) };
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(label);
  if (week) {
    const jan4 = new Date(Date.UTC(Number(week[1]), 0, 4));
    const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (Number(week[2]) - 1) * 7 * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  return undefined;
}

// ---------------------------------------------------------------- the four tiles

export interface KpiParams {
  view?: string;
  gamma?: number;
  grouping?: string;
  slicing?: string;
  sliceKey?: string;
  minCases?: number;
  filter?: Filter;
  /** Share of items still open, from the case table's readiness, for the fallback's fourth tile. */
  openShare?: number | null;
  caseNoun?: string;
}

/** The tiles a backend without `GET …/kpis` allows: from the filter preview, the summary and the ranked list. */
async function kpisDerived(projectId: string, runId: string, params: KpiParams): Promise<Kpis> {
  const f = canonicalParam(params.filter);
  const base = `/projects/${enc(projectId)}/runs/${enc(runId)}`;
  const noun = params.caseNoun ?? "cases";
  const [preview, summary] = await Promise.all([
    f ? c2.get<FilterPreview>(`${base}/filters/preview`, { filter: f }) : Promise.resolve(undefined),
    c2.get<RunSummary>(`${base}/summary`),
  ]);
  const view = params.view ?? summary.views?.[0] ?? "";
  const mean = (summary.means ?? {})[view] ?? null;
  const total = summary.cases ?? (preview ? preview.cases_in + preview.cases_out : 0);
  const cases = preview ? preview.cases_in : total;
  let priority = 0;
  let groups = 0;
  const grouping = params.grouping ?? params.slicing;
  if (grouping) {
    const page = await c2.get<BacklogPage>(`${base}/backlog`, { slicing: grouping, view: params.view, gamma: params.gamma, minCases: params.minCases ?? 1, sort: "-stable_PI", page: 1, pageSize: 500, filter: f });
    priority = page.rows.reduce((s, r) => s + (r.stable_PI ?? 0), 0);
    groups = page.rows.length;
  }
  const openShare = params.openShare ?? null;
  return {
    cases,
    casesTotal: total,
    casesScored: cases,
    casesBelowExpectation: 0,
    meanScore: mean,
    baseline: mean,
    priorityAtStake: priority,
    groups,
    openCases: openShare === null ? null : Math.round(cases * openShare),
    derived: true,
    tiles: [
      { id: "items", label: noun[0]?.toUpperCase() + noun.slice(1), value: cases, format: "count", unit: noun, text: `${cases} ${noun} in this selection.` },
      { id: "share_below_expectation", label: "Below expectation", value: mean === null ? null : 1 - mean, format: "share", text: "The average shortfall against the expectations of this perspective; this backend serves it for the whole run." },
      { id: "priority_at_stake", label: "Priority at stake", value: priority, format: "index", unit: "priority", text: `Priority carried by the ${groups} groups the chips keep, small groups discounted.` },
      { id: "open_share", label: "Still open", value: openShare, format: "share", text: openShare === null ? "Open cases cannot be told apart on this backend." : "The share of items still open at the end of the data, from the readiness report." },
    ],
  };
}

export const kpisQuery = (projectId: string, runId: string, params: KpiParams) => {
  const f = canonicalParam(params.filter) ?? "";
  return queryOptions({
    queryKey: keys3.kpis(projectId, runId, params.view ?? "", params.grouping ?? params.slicing ?? "", f),
    queryFn: async (): Promise<Kpis> => {
      try {
        return await c2.get<Kpis>(`/projects/${enc(projectId)}/runs/${enc(runId)}/kpis`, {
          view: params.view,
          gamma: params.gamma,
          grouping: params.grouping ?? params.slicing,
          minCases: params.minCases,
          filter: f || undefined,
        });
      } catch (error) {
        if (notServed(error)) return kpisDerived(projectId, runId, params);
        throw error;
      }
    },
    staleTime: IMMUTABLE,
    placeholderData: (prev: Kpis | undefined) => prev,
  });
};

/** The flow as BPMN 2.0 from the server (§3.9); the map generates one from the log when this is not served. */
export const bpmnUrl = (projectId: string, runId: string, params: { detail?: number; slicing?: string; sliceKey?: string; filter?: Filter; scope?: "flow" | "stages" }) => {
  const url = new URL(`${apiBase}/projects/${enc(projectId)}/runs/${enc(runId)}/flow/bpmn`);
  const f = canonicalParam(params.filter);
  const query: Record<string, string | number | undefined> = { scope: params.scope ?? "flow", detail: params.detail, slicing: params.slicing, sliceKey: params.sliceKey, filter: f };
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
};

// ---------------------------------------------------------------- one expectation's distribution under the filter

/**
 * `GET …/runs/{id}/signals/{constraint}` with the canonical filter. A backend that does not filter the
 * distribution answers without echoing the filter; the panel then draws the unfiltered shape with the lock
 * chip and the words *all items*, so a filtered number is never shown beside an unfiltered one unnamed.
 */
export const distributionFilteredQuery = (projectId: string, runId: string, constraintId: string, params: { filter?: Filter; slicing?: string; sliceKey?: string }) => {
  const f = canonicalParam(params.filter) ?? "";
  return queryOptions({
    queryKey: ["projects", projectId, "runs", runId, "signals", constraintId, params.slicing ?? "", params.sliceKey ?? "", f] as const,
    queryFn: () =>
      c2.get<Distribution & { filter?: Filter | null }>(`/projects/${enc(projectId)}/runs/${enc(runId)}/signals/${enc(constraintId)}`, {
        slicing: params.slicing,
        sliceKey: params.sliceKey,
        filter: f || undefined,
      }),
    staleTime: IMMUTABLE,
    placeholderData: (prev: (Distribution & { filter?: Filter | null }) | undefined) => prev,
  });
};

// ---------------------------------------------------------------- paths of one activity, from the full relation

/**
 * The paths block of `GET …/flow?focus=`: every incoming and outgoing path of the activity from the complete
 * directly-follows relation (R3-O8). `hidden` counts the ones the current detail level does not draw; the
 * backend may say so in `meta.pathsHidden`, otherwise the screen counts them against the drawn graph.
 */
export function pathsOf(graph: FlowGraph | undefined, focus: string): ActivityPaths | undefined {
  if (!graph) return undefined;
  const paths = (graph as { paths?: { incoming?: Record<string, unknown>[]; outgoing?: Record<string, unknown>[] } }).paths;
  if (!paths) return undefined;
  const meta = (graph.meta ?? {}) as { pathsHidden?: number };
  return { focus, incoming: paths.incoming ?? [], outgoing: paths.outgoing ?? [], hidden: meta.pathsHidden ?? 0 };
}

/** The share link of a scene: the canonical filter's short hash (§2.3). */
export const sceneHash = (filter: Filter | undefined): string | undefined => filterHash(filter);

// ---------------------------------------------------------------- the run in plain words (R3-O7)

/** One line of the run's plain manifest: what it is, what it was, and one note in the reader's words. */
export type ManifestRow = GeneratedManifestRow;

/** `GET …/runs/{id}/manifest`: the run a person reads, with the fingerprints kept apart. */
export type RunManifestView = Omit<GeneratedRunManifestView, "uncalibrated"> & { uncalibrated?: UncalibratedExpectation[] };

/**
 * The run's own account of itself. A backend that does not serve it answers 404 and the screen falls back to
 * the fields of the run record, so the plain block is never the reason a screen is empty.
 */
export const runManifestQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: ["projects", projectId, "runs", runId, "manifest"] as const,
    queryFn: () => c2.get<RunManifestView>(`/projects/${enc(projectId)}/runs/${enc(runId)}/manifest`),
    staleTime: IMMUTABLE,
    retry: false,
  });
