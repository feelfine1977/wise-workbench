/**
 * The board's sources as the third-release backend will serve them (`docs/panel/ui_design_cycle3_board.md`
 * §5.2): counts by facet under the canonical filter, the four tile numbers, and the period breakdown. The
 * numbers come from the verified run wherever the mocks hold it — the flow types of the case table, the
 * ranked groups of the slicing — so a click on a bar and a click on the map move the same rows; the shares a
 * filter leaves are the same seeded shares the rest of the mocks use, so every panel agrees.
 */
import type { Distribution, FlowGraph } from "@wise/api-schema";
import type { Facets, Kpis } from "@/lib/api/board";

/** One row of the `paths` block of a focused flow answer. */
interface PathRow {
  node: string;
  from: string;
  to: string;
  count: number;
  cases: number;
  median_lag: number | null;
  violation_share: number | null;
}
import type { Filter, FilterClause } from "@/lib/api/filter-types";
import { backlogFor, summaryFor } from "../db";
import { applyFilter, clauseKeepShare, filterKeepShare } from "./cycle2";
import { rng, round } from "./seed";
import { verifiedFlowTypes } from "./verified";

/** The value a filter demands for one case attribute: `undefined` when it says nothing about it. */
function selectedValues(filter: Filter | undefined, field: string): string[] | undefined {
  const clause = (filter?.and ?? []).find((c) => c.kind === "attribute" && c.field === field);
  return clause && clause.kind === "attribute" ? clause.in : undefined;
}

/** The share the other clauses keep, so a facet is not filtered away by its own selection. */
function keepExcept(filter: Filter | undefined, field: string): number {
  return (filter?.and ?? [])
    .filter((c: FilterClause) => !(c.kind === "attribute" && c.field === field))
    .reduce((s, c) => s * clauseKeepShare(c), 1);
}

const QUARTERS: { value: string; from: string; to: string; weight: number }[] = [
  { value: "2018 Q1", from: "2018-01-01", to: "2018-03-31", weight: 0.21 },
  { value: "2018 Q2", from: "2018-04-01", to: "2018-06-30", weight: 0.24 },
  { value: "2018 Q3", from: "2018-07-01", to: "2018-09-30", weight: 0.26 },
  { value: "2018 Q4", from: "2018-10-01", to: "2018-12-31", weight: 0.24 },
  { value: "2019 Q1", from: "2019-01-01", to: "2019-01-17", weight: 0.05 },
];

export function facetsFor(
  runId: string,
  params: { by: "flow_type" | "period" | "attribute"; attribute?: string; view?: string; slicing?: string; filter?: Filter },
): Facets {
  const total = summaryFor(runId).cases ?? 251734;
  const keep = filterKeepShare(params.filter);
  const casesIn = Math.round(total * keep);
  const noun = verifiedFlowTypes.caseNoun ?? "cases";

  if (params.by === "flow_type") {
    const field = verifiedFlowTypes.attribute ?? "flow_type";
    const chosen = selectedValues(params.filter, field);
    const rest = keepExcept(params.filter, field);
    const values = verifiedFlowTypes.types.map((t) => {
      const kept = chosen && !chosen.includes(t.name) ? 0 : Math.round(t.cases * rest);
      const missed = round(rng(`facet:flow:${t.name}`).range(0.02, 0.14), 4);
      return {
        value: t.name,
        label: t.name,
        field,
        cases: kept,
        share: kept / Math.max(casesIn, 1),
        mean_score: 1 - missed,
        cases_below: Math.round(kept * missed),
        share_below_expectation: kept ? missed : 0,
        gap: missed,
        priority_at_stake: Math.round(kept * missed),
        open_share: t.readiness.censoredShare ?? null,
      };
    });
    return { by: "flow_type", field, cases: casesIn, casesTotal: total, total: values.length, shown: values.length, values, params: { noun, filter: params.filter ?? null } };
  }

  if (params.by === "period") {
    const rest = keepExcept(params.filter, "__period");
    const window = (params.filter?.and ?? []).find((c) => c.kind === "time");
    const values = QUARTERS.map((q) => {
      const all = Math.round(total * q.weight);
      const inWindow = !window || (window.kind === "time" && (!window.from || window.from <= q.from) && (!window.to || window.to >= q.to));
      const kept = inWindow ? Math.round(all * rest) : 0;
      const missed = round(rng(`facet:period:${q.value}`).range(0.03, 0.16), 4);
      return { value: q.value, label: q.value, field: "case start", cases: kept, share: kept / Math.max(casesIn, 1), mean_score: 1 - missed, cases_below: Math.round(kept * missed), share_below_expectation: kept ? missed : 0, gap: missed, priority_at_stake: Math.round(kept * missed) };
    });
    return { by: "period", field: "case start", period: "quarter", cases: casesIn, casesTotal: total, total: values.length, shown: values.length, values, params: { noun, filter: params.filter ?? null } };
  }

  // any case attribute: the ranked groups of that attribute are the bars
  const attribute = params.attribute ?? "case Vendor";
  const source = backlogFor(runId, attribute, params.view ?? "Automation", 20, 1);
  const chosen = selectedValues(params.filter, attribute);
  const rest = keepExcept(params.filter, attribute);
  const rows = [...source.rows].sort((a, b) => b.n_cases - a.n_cases).slice(0, 12);
  const values = rows.map((r) => {
    const value = Object.values(r.keys ?? {})[0] ?? r.key;
    const kept = chosen && !chosen.includes(value) ? 0 : Math.round(r.n_cases * rest);
    return {
      value,
      label: value,
      field: attribute,
      cases: kept,
      share: kept / Math.max(casesIn, 1),
      mean_score: r.mean_score,
      cases_below: Math.round(kept * r.gap),
      share_below_expectation: kept ? round(r.gap, 4) : 0,
      gap: round(r.gap, 4),
      stable_gap: r.stable_gap,
      PI: r.PI,
      priority_at_stake: round(r.stable_PI * (kept / Math.max(r.n_cases, 1)), 2),
    };
  });
  return { by: "attribute", field: attribute, cases: casesIn, casesTotal: total, total: source.rows.length, shown: values.length, values, params: { noun, filter: params.filter ?? null } };
}

export function kpisFor(runId: string, params: { view?: string; slicing?: string; gamma?: number; minCases?: number; filter?: Filter }): Kpis {
  const total = summaryFor(runId).cases ?? 251734;
  const keep = filterKeepShare(params.filter);
  const casesIn = Math.round(total * keep);
  const slicing = params.slicing ?? "case Company+case Spend area text";
  const source = backlogFor(runId, slicing, params.view ?? "Automation", params.gamma ?? 20, params.minCases ?? 1);
  const weighted = (rows: { n_cases: number; gap: number }[]) => {
    const cases = rows.reduce((s, r) => s + r.n_cases, 0);
    return cases ? rows.reduce((s, r) => s + r.n_cases * r.gap, 0) / cases : 0;
  };
  // the filter keeps a seeded share of every group, exactly as the ranked list computes it, so the tiles agree
  const filtered = applyFilter(source.rows, params.filter, params.gamma ?? 20);
  const priority = filtered.reduce((s, r) => s + r.stable_PI, 0);
  const openAll = 0.139;
  const openShare = round(Math.min(0.99, openAll * (keep >= 1 ? 1 : rng(`open:${JSON.stringify(params.filter ?? {})}`).range(0.8, 1.25))), 4);
  const noun = verifiedFlowTypes.caseNoun ?? "cases";
  const shareBelow = round(weighted(filtered), 6);
  const mean = 1 - shareBelow;
  const baseline = 1 - round(weighted(source.rows), 6);
  return {
    cases: casesIn,
    casesTotal: total,
    casesScored: casesIn,
    casesBelowExpectation: Math.round(casesIn * shareBelow),
    meanScore: mean,
    baseline,
    priorityAtStake: round(priority, 2),
    groups: filtered.length,
    openCases: Math.round(casesIn * openShare),
    params: { view: params.view ?? null, filter: params.filter ?? null },
    tiles: [
      { id: "items", label: noun[0]?.toUpperCase() + noun.slice(1), value: casesIn, format: "count" as const, unit: noun, text: `${casesIn.toLocaleString("en")} ${noun} in this selection (${Math.round((casesIn / Math.max(total, 1)) * 100)} % of ${total.toLocaleString("en")}).` },
      { id: "share_below_expectation", label: "Below expectation", value: shareBelow, format: "share" as const, text: `${(shareBelow * 100).toFixed(1)} % of the ${casesIn.toLocaleString("en")} scored ${noun} miss at least one expectation.` },
      { id: "priority_at_stake", label: "Priority at stake", value: round(priority, 2), format: "index" as const, unit: "priority", text: `${priority.toFixed(1)} priority carried by the ${filtered.length} groups in this selection, small groups discounted.` },
      { id: "open_share", label: "Still open", value: openShare, format: "share" as const, text: `${(openShare * 100).toFixed(1)} % of these ${noun} are still open at the end of the data (2019-01-17).` },
      {
        id: "mean_score",
        label: "Score",
        value: round(mean * 100, 4),
        format: "points" as const,
        unit: "points",
        text: `${(mean * 100).toFixed(1)} points on average against ${(baseline * 100).toFixed(1)} over the whole run (${mean >= baseline ? "+" : "−"}${Math.abs((mean - baseline) * 100).toFixed(1)}).`,
      },
    ],
  };
}

/** The same distribution under a filter: the bins keep their edges, the counts follow the filter (§4.7). */
export function scaleDistribution(dist: Distribution, filter: Filter | undefined): Record<string, unknown> {
  const keep = filterKeepShare(filter);
  if (!filter || keep >= 1) return { ...dist, filter: (filter as unknown as Record<string, unknown>) ?? null };
  const scale = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * keep) : n);
  return {
    ...dist,
    bins: (dist.bins ?? []).map((b) => ({ ...b, n: scale(b.n) ?? 0 })),
    beyond: dist.beyond ? { ...dist.beyond, n: scale(dist.beyond.n) ?? 0 } : dist.beyond,
    below: dist.below ? { ...dist.below, n: scale(dist.below.n) ?? 0 } : dist.below,
    stats: { ...(dist.stats ?? {}), n: scale(dist.stats?.n as number | null | undefined) ?? undefined },
    filter: filter as unknown as Record<string, unknown>,
  };
}

/**
 * The paths of one activity from the full directly-follows relation (R3-O8): every path the relation holds,
 * not only the ones drawn at the level the graph was served at. An activity whose paths are all weak — the
 * owner's *Change Quantity* — therefore never reports "no paths"; the answer says how many are hidden.
 */
export function pathsForFocus(graph: FlowGraph, focus: string): { incoming: PathRow[]; outgoing: PathRow[]; hidden: number } {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const follows = graph.edges.filter((e) => e.kind === "follows");
  const drawn = new Set(follows.map((e) => `${e.source}→${e.target}`));
  const row = (source: string, target: string, e: (typeof follows)[number] | undefined, direction: "in" | "out"): PathRow => ({
    node: direction === "in" ? source : target,
    from: label(source),
    to: label(target),
    count: Math.round(e?.metrics?.count ?? 0),
    cases: Math.round(e?.metrics?.cases ?? 0),
    median_lag: e?.metrics?.medianLagHours !== undefined ? round(e.metrics.medianLagHours / 24, 2) : null,
    violation_share: null,
  });
  const incoming = follows.filter((e) => e.target === focus).map((e) => row(e.source, e.target, e, "in"));
  const outgoing = follows.filter((e) => e.source === focus).map((e) => row(e.source, e.target, e, "out"));
  // paths the abstraction dropped: the relation holds them, the drawing does not
  const neighbours = graph.nodes
    .filter((n) => n.kind === "activity" && n.id !== focus)
    .sort((a, b) => (b.metrics?.cases ?? 0) - (a.metrics?.cases ?? 0))
    .slice(0, 7);
  const weak: { list: PathRow[]; direction: "in" | "out" }[] = [
    { list: incoming, direction: "in" },
    { list: outgoing, direction: "out" },
  ];
  let hidden = 0;
  for (const { list, direction } of weak) {
    for (const n of neighbours) {
      const key = direction === "in" ? `${n.id}→${focus}` : `${focus}→${n.id}`;
      if (drawn.has(key)) continue;
      const r = rng(`hiddenpath:${key}`);
      const cases = Math.round(r.range(120, 2600));
      list.push({
        node: n.id,
        from: direction === "in" ? n.label : label(focus),
        to: direction === "in" ? label(focus) : n.label,
        count: cases,
        cases,
        median_lag: round(r.range(0.2, 40), 2),
        violation_share: round(r.range(0.1, 0.99), 4),
      });
      hidden += 1;
    }
  }
  return { incoming, outgoing, hidden };
}
