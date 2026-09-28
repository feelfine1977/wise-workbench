import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { edaQuery, type EDAParams } from "./eda";

afterEach(() => vi.unstubAllGlobals());

it("encodes scope and exact selection and keys every linked view and detail page together", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ summary: { cases: { selected: 1, total: 10 } } }));
  vi.stubGlobal("fetch", fetch);
  const params: EDAParams = { datasetId: "ds/1", attribute: "Category", filter: '{"and":[{"kind":"attribute","field":"Category","eq":"A"}]}', selection: JSON.stringify({ categoryKeys: ["v1", "missing"], timeRanges: [{ from: "2024-01-01T00:00:00Z", before: "2024-02-01T00:00:00Z" }], spanRanges: [{ min: 1 }, { max: 0.5 }], timeMissing: true }), spanMin: 0, spanMax: 7, page: 2, pageSize: 25 };
  const query = edaQuery("p /", "ct /", params);
  await new QueryClient().fetchQuery(query);
  const url = new URL(fetch.mock.calls[0]![0] as string);
  expect(url.pathname).toBe("/api/v1/projects/p%20%2F/case-tables/ct%20%2F/eda");
  expect(Object.fromEntries(url.searchParams)).toEqual({ ...params, spanMin: "0", spanMax: "7", page: "2", pageSize: "25" });
  for (const change of [{ selection: undefined }, { selection: "{}" }, { selection: JSON.stringify({ timeMissing: true }) }, { datasetId: "another" }, { attribute: "flow_type" }, { filter: "" }, { spanMin: 1 }, { spanMax: undefined }, { spanMissing: 1 as const }, { timeMissing: 1 as const }, { categoryMode: "missing" as const }, { page: 1 }, { pageSize: 50 }]) {
    expect(edaQuery("p /", "ct /", { ...params, ...change }).queryKey).not.toEqual(query.queryKey);
  }
  expect(edaQuery("other", "ct /", params).queryKey).not.toEqual(query.queryKey);
  expect(edaQuery("p /", "other", params).queryKey).not.toEqual(query.queryKey);
});

it.each(["", "{", '{"and":[{"kind":"open","value":true}]}'])("keeps a rejected selection %j separate from unfiltered cached counts", async (filter) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ detail: "Unsupported filter", code: "filter.unsupported" }, { status: 422 }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  client.setQueryData<unknown>(edaQuery("p", "ct", { datasetId: "ds" }).queryKey, { summary: { cases: { total: 999 } } });
  const query = edaQuery("p", "ct", { datasetId: "ds", filter });
  await expect(client.fetchQuery(query)).rejects.toMatchObject({ status: 422 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get("filter")).toBe(filter);
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
});

it("rejects an empty union parameter instead of letting transport omit it", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(new QueryClient().fetchQuery(edaQuery("p", "ct", { datasetId: "ds", selection: "" }))).rejects.toThrow("must be JSON");
  expect(fetch).not.toHaveBeenCalled();
});
