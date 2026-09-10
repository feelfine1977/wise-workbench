import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { facetsQuery, kpisQuery, periodWindow } from "./board";
import { notServed } from "./compatibility";

afterEach(() => vi.unstubAllGlobals());
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const comparison = { attribute: "flow_type", views: ["Finance"], types: [
  { name: "direct", cases: 8, share: 0.8, views: { Finance: { mean_score: 0.75, gap: 0.1 } }, topGroups: [{ stable_PI: 2 }, { stable_PI: 3 }], censoredShare: 0.25 },
  { name: "other", cases: 2, share: 0.2, views: {}, topGroups: [], censoredShare: null },
] };

it("keeps served facets and query-key omissions without deriving an answer", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ by: "attribute", values: [], cases: 10, filtered: false }));
  vi.stubGlobal("fetch", fetch);
  const params = { by: "attribute" as const, attribute: "company", gamma: 3, limit: 4, minCases: 2 };
  const query = facetsQuery("p /", "r?", params);
  expect(query.queryKey).toEqual(["projects", "p /", "runs", "r?", "facets", "attribute", "company", "", "", ""]);
  expect(facetsQuery("p /", "r?", { ...params, gamma: 9, limit: 99 }).queryKey).toEqual(query.queryKey);
  expect(query.staleTime).toBe(1_800_000);
  expect(await client().fetchQuery(query)).toEqual({ by: "attribute", values: [], cases: 10, filtered: false });
  const url = new URL(fetch.mock.calls[0]![0] as string);
  expect(url.pathname).toContain("/projects/p%20%2F/runs/r%3F/facets");
  expect(Object.fromEntries(url.searchParams)).toEqual({ by: "attribute", attribute: "company", gamma: "3", minCases: "2", limit: "4" });
});

it.each([404, 405, 501])("derives only flow-type facets for missing operation %s", async (status) => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("missing", { status })).mockResolvedValueOnce(Response.json(comparison));
  vi.stubGlobal("fetch", fetch);
  const result = await client().fetchQuery(facetsQuery("p", "r", { by: "flow_type", view: "unknown" }));
  expect(result).toMatchObject({ derived: true, filtered: false, cases: 10, casesTotal: 10, total: 2, shown: 2 });
  expect(result.values).toEqual([
    { value: "direct", label: "direct", cases: 8, share: 0.8, mean_score: 0.75, share_below_expectation: 0.25, priority_at_stake: 5, open_share: 0.25 },
    { value: "other", label: "other", cases: 2, share: 0.2, mean_score: null, share_below_expectation: null, priority_at_stake: null, open_share: null },
  ]);
  expect(new URL(fetch.mock.calls[1]![0] as string).pathname).toMatch(/\/compare-flow-types$/);
});

it.each([404, 405, 501, 422, 500])("never falls back for attribute facets (%s)", async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response("error", { status })); vi.stubGlobal("fetch", fetch);
  await expect(client().fetchQuery(facetsQuery("p", "r", { by: "attribute" }))).rejects.toMatchObject({ status });
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([422, 500, "network"] as const)("propagates non-compatibility errors (%s)", async (status) => {
  const failure = new TypeError("offline");
  const fetch = status === "network" ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(new Response("error", { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(client().fetchQuery(kpisQuery("p", "r", {}))).rejects.toBeInstanceOf(status === "network" ? TypeError : ApiError);
  expect(fetch).toHaveBeenCalledOnce();
  expect(notServed(status === "network" ? failure : new ApiError(status))).toBe(false);
});

it.each([404, 405, 501])("preserves KPI fallback population boundaries (%s)", async (status) => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (raw: string) => {
    const url = new URL(raw); requests.push(url);
    if (url.pathname.endsWith("/kpis")) return new Response("missing", { status });
    if (url.pathname.endsWith("/filters/preview")) return Response.json({ cases_in: 4, cases_out: 6 });
    if (url.pathname.endsWith("/summary")) return Response.json({ cases: 10, views: ["Finance"], means: { Finance: 0.8 } });
    if (url.pathname.endsWith("/backlog")) return Response.json({ rows: [{ stable_PI: 2 }, { stable_PI: null }, { stable_PI: 3 }] });
    throw new Error("Unexpected request: " + url.pathname);
  }));
  const result = await client().fetchQuery(kpisQuery("p", "r", { slicing: "company", filter: { and: [{ kind: "open", value: true }] }, openShare: 0.5, caseNoun: "items" }));
  expect(result).toMatchObject({ cases: 4, casesTotal: 10, casesScored: 4, casesBelowExpectation: 0, meanScore: 0.8, baseline: 0.8, priorityAtStake: 5, groups: 3, openCases: 2, derived: true });
  expect(result.tiles?.[1]?.text).toContain("whole run");
  const summary = requests.find(u => u.pathname.endsWith("/summary"))!;
  expect(summary.search).toBe("");
  const backlog = requests.find(u => u.pathname.endsWith("/backlog"))!;
  expect(Object.fromEntries(backlog.searchParams)).toEqual({ slicing: "company", minCases: "1", sort: "-stable_PI", page: "1", pageSize: "500", filter: '{"and":[{"kind":"open","value":true}]}' });
});

it("does not request a preview or backlog without filter/grouping", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ cases: 7, views: [], means: {} }));
  vi.stubGlobal("fetch", fetch);
  const result = await client().fetchQuery(kpisQuery("p", "r", {}));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ cases: 7, casesTotal: 7, meanScore: null, baseline: null, priorityAtStake: 0, groups: 0, openCases: null, derived: true });
});

it("keeps period windows", () => {
  expect(periodWindow("2024-Q1")).toEqual({ from: "2024-01-01", to: "2024-03-31" });
  expect(periodWindow("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  expect(periodWindow("2024-W01")).toEqual({ from: "2024-01-01", to: "2024-01-07" });
  expect(periodWindow("unknown")).toBeUndefined();
});
