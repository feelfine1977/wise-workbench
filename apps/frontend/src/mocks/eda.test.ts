import { expect, it } from "vitest";
import type { EDAResult } from "@/lib/api/eda";

const endpoint = "http://localhost/api/v1/projects/p2p2018/case-tables/ct_1/eda";
async function get(params: Record<string, string> = {}) {
  const response = await fetch(`${endpoint}?${new URLSearchParams({ datasetId: "ds_1", ...params })}`);
  expect(response.status).toBe(200);
  const result = await response.json() as EDAResult;
  for (const chart of [result.trend, result.categories, result.spans]) {
    expect(chart.reduce((n, row) => n + row.selected, 0)).toBe(result.summary.cases.selected);
    expect(chart.reduce((n, row) => n + row.total, 0)).toBe(6);
  }
  expect(result.details.total).toBe(result.summary.cases.selected);
  return result;
}

it("serves a documented small fixture and intersects category, month and span without scaling counts", async () => {
  const all = await get();
  expect(all.summary.cases).toEqual({ selected: 6, total: 6 });
  expect(all.summary.events).toEqual({ selected: 17, total: 17 });
  expect(all.notes[0]).toContain("Illustrative mock fixture");
  const filter = JSON.stringify({ and: [{ kind: "attribute", field: "flow_type", eq: "DF1" }, { kind: "time", field: "case_start", from: "2018-01-01", to: "2018-01-31T23:59:59.999999999" }] });
  const selected = await get({ filter, spanMin: "1", spanMax: "2" });
  expect(selected.summary.events.selected).toBe(3);
  expect(selected.details.rows.map((r) => r.caseId)).toEqual(["demo-001"]);
  expect(selected.trendOmittedEmptyMonths).toBeGreaterThan(800);
  expect(selected.trend.map(({ selected: _selected, ...rest }) => rest)).toEqual(all.trend.map(({ selected: _selected, ...rest }) => rest));
});

it("preserves unknowns and paginates details while all summaries describe the full selection", async () => {
  const unknown = await get({ spanMissing: "1", categoryMode: "missing" });
  expect(unknown.summary.unknownSpanCases).toBe(1);
  expect(unknown.summary.medianSpanDays).toBeNull();
  expect(unknown.summary.events.selected).toBe(2);
  const first = await get({ pageSize: "2" }), second = await get({ pageSize: "2", page: "2" });
  expect(first.summary).toEqual(second.summary);
  expect(first.details.rows).toHaveLength(2);
  expect(second.details.rows.every((r) => !first.details.rows.some((s) => r.caseId === s.caseId))).toBe(true);
});

it("requires dataset identity and rejects unsupported filters instead of returning unfiltered totals", async () => {
  expect((await fetch(endpoint)).status).toBe(422);
  expect((await fetch(`${endpoint}?datasetId=wrong`)).status).toBe(404);
  const invalid: Record<string, string>[] = [{ filter: "" }, { filter: "{" }, { filter: '{"and":[{"kind":"open","value":true}]}' }, { spanMin: "3", spanMax: "1" }, { pageSize: "101" }];
  for (const params of invalid) {
    expect((await fetch(`${endpoint}?${new URLSearchParams({ datasetId: "ds_1", ...params })}`)).status).toBe(422);
  }
});

it("measures category/time/span unions together, including unknowns, and preserves legacy intersections", async () => {
  const all = await get();
  const df1 = all.categories.find((r) => r.value === "DF1")!.key;
  const selection = JSON.stringify({
    categoryKeys: [df1, "missing"],
    timeRanges: [{ from: "2018-01-01T00:00:00Z", before: "2018-02-01T00:00:00Z" }, { from: "2018-02-01T00:00:00Z", before: "2018-03-01T00:00:00Z" }],
    timeMissing: true, spanRanges: [{ min: 1, max: 2 }, { min: 2, max: 3 }], spanMissing: true,
  });
  const result = await get({ selection });
  expect(result.details.rows.map((r) => r.caseId).sort()).toEqual(["demo-001", "demo-003", "demo-005"]);
  expect(result.summary.events.selected).toBe(9);
  expect(result.summary.unknownSpanCases).toBe(1);
  const first = await get({ selection, pageSize: "1" }), second = await get({ selection, pageSize: "1", page: "2" });
  expect(first.summary).toEqual(second.summary);
  expect(first.details.rows[0]!.caseId).not.toBe(second.details.rows[0]!.caseId);
  expect((await get({ selection, spanMin: "2" })).details.rows.map((r) => r.caseId)).toEqual(["demo-003"]);
  for (const invalid of ["", "null", "[]", '{"activity":"Approve"}', '{"categoryKeys":[]}', '{"categoryKeys":["other"]}', '{"timeRanges":[{"from":"2018-02-01","before":"2018-01-01"}]}', '{"spanRanges":[{"min":2,"max":1}]}']) {
    expect((await fetch(`${endpoint}?${new URLSearchParams({ datasetId: "ds_1", selection: invalid })}`)).status).toBe(422);
  }
});
