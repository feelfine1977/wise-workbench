import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { variantsQuery } from "./variants";

afterEach(() => vi.unstubAllGlobals());

it("keys and sends the exact filter, slice, bands and bounds", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ totalSelectedCases: 2 }));
  vi.stubGlobal("fetch", fetch);
  const params = { filter: ' {"and":[{"kind":"open","value":true}]} ', slicing: "company,exposure", sliceKey: '["X","low"]', bands: '[{"attribute":"exposure","method":"cuts","cuts":[35]}]', limit: 7, exampleLimit: 2 };
  const query = variantsQuery("p /", "r /", params);
  await new QueryClient().fetchQuery(query);
  const url = new URL(fetch.mock.calls[0]![0] as string);
  expect(url.pathname).toBe("/api/v1/projects/p%20%2F/runs/r%20%2F/variants");
  expect(Object.fromEntries(url.searchParams)).toEqual({ ...params, limit: "7", exampleLimit: "2" });
  for (const change of [{ filter: undefined }, { filter: "" }, { sliceKey: '["Y","low"]' }, { bands: "[]" }, { limit: 8 }, { exampleLimit: 1 }]) {
    expect(variantsQuery("p /", "r /", { ...params, ...change }).queryKey).not.toEqual(query.queryKey);
  }
});

it.each(["", "{", '{"kind":"exact_variant","activities":["A"]}'])("does not replace rejected filter %j with an unfiltered request", async (filter) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ detail: "Unsupported filter", code: "filter.clause" }, { status: 422 }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const query = variantsQuery("p", "r", { filter });
  client.setQueryData<unknown>(variantsQuery("p", "r").queryKey, { totalSelectedCases: 200 });
  await expect(client.fetchQuery(query)).rejects.toMatchObject({ status: 422 });
  expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get("filter")).toBe(filter);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
});
