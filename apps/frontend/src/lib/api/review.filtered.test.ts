import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { gatesQuery, useDecideGate, type Gates } from "./review";

afterEach(() => vi.unstubAllGlobals());

const scope = { slicing: "company", sliceKey: '["B"]', view: "Finance" };
const raw = ' { "and": [{"kind":"open","value":true}, {"kind":"open","value":true}] } ';
const measured = {
  runId: "r", slicing: scope.slicing, sliceKey: scope.sliceKey,
  filter: { and: [{ kind: "open", value: true }] },
  selection: { state: "measured", cases: 7, wholeGroupCases: 120, fingerprint: "selection-fingerprint" },
  cases: 7,
  gates: [{ id: "check", kind: "domain", scope: "group", status: "passed", text: "Selected check" }],
} satisfies Gates;
const wrapper = (client: QueryClient) => ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);

it("keys and sends the raw filter without canonicalizing it or changing measured counts", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(measured)); vi.stubGlobal("fetch", fetch);
  const query = gatesQuery("p", "r", { ...scope, filter: raw });
  const result = await new QueryClient().fetchQuery(query);
  expect(query.queryKey).toEqual(["projects", "p", "runs", "r", "gates", "company", '["B"]', "Finance", raw]);
  expect(query.queryKey).not.toEqual(gatesQuery("p", "r", { ...scope, filter: JSON.stringify(measured.filter) }).queryKey);
  expect(result).toEqual(measured);
  expect(Object.fromEntries(new URL(fetch.mock.calls[0]![0] as string).searchParams)).toEqual({ slicing: "company", key: '["B"]', view: "Finance", filter: raw });
});

it.each(["", "{", "7", '{"and":[]}', '{"and":[{"kind":"unknown","extra":true}]}'])("keeps refused raw filter %j distinct from unfiltered and never falls back", async (filter) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ detail: "Unsupported or empty selection" }, { status: 422 })); vi.stubGlobal("fetch", fetch);
  const query = gatesQuery("p", "r", { ...scope, filter });
  const whole = gatesQuery("p", "r", scope);
  const client = new QueryClient();
  client.setQueryData(whole.queryKey, { ...measured, selection: undefined, filter: undefined, cases: 120 });
  await expect(client.fetchQuery(query)).rejects.toMatchObject({ status: 422 });
  expect(query.queryKey).not.toEqual(whole.queryKey);
  expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get("filter")).toBe(filter);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
  expect(client.getQueryState(whole.queryKey)?.isInvalidated).toBe(false);
});

it.each([
  { label: "legacy whole-group response", data: { ...measured, filter: undefined, selection: undefined } },
  { label: "missing fingerprint", data: { ...measured, selection: { ...measured.selection, fingerprint: "" } } },
  { label: "empty selection", data: { ...measured, selection: { ...measured.selection, cases: 0 } } },
  { label: "invalid population counts", data: { ...measured, selection: { ...measured.selection, wholeGroupCases: 2 } } },
  { label: "unavailable measurement", data: { ...measured, selection: { ...measured.selection, state: "unavailable" } } },
])("rejects a $label instead of treating it as scoped evidence", async ({ data }) => {
  const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetch);
  await expect(new QueryClient().fetchQuery(gatesQuery("p", "r", { ...scope, filter: raw }))).rejects.toMatchObject({ status: 409 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("sends the raw filter on decisions and invalidates only its exact gate cache", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(measured)); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const filtered = gatesQuery("p", "r", { ...scope, filter: raw });
  const whole = gatesQuery("p", "r", scope);
  const other = gatesQuery("p", "r", { ...scope, filter: JSON.stringify(measured.filter) });
  for (const query of [filtered, whole, other]) client.setQueryData(query.queryKey, measured);
  const { result } = renderHook(() => useDecideGate("p", "r", { ...scope, filter: raw }), { wrapper: wrapper(client) });
  await act(async () => { expect(await result.current.mutateAsync({ gateId: "check /", status: "waived", note: "reason", author: "reviewer" })).toEqual(measured); });
  const [url, init] = fetch.mock.calls[0]!;
  expect(new URL(url as string).pathname).toContain("/gates/check%20%2F");
  expect(new URL(url as string).searchParams.get("filter")).toBe(raw);
  expect(init).toMatchObject({ method: "POST", body: '{"status":"waived","note":"reason","author":"reviewer"}' });
  expect(client.getQueryState(filtered.queryKey)?.isInvalidated).toBe(true);
  for (const query of [whole, other]) expect(client.getQueryState(query.queryKey)?.isInvalidated).toBe(false);
});

it.each([409, 422, 200])("does not retry a decision without its filter after an unusable %i response", async (status) => {
  const fetch = vi.fn().mockResolvedValue(Response.json(status === 200 ? { gates: [] } : { detail: "Selection unavailable" }, { status })); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useDecideGate("p", "r", { ...scope, filter: "" }), { wrapper: wrapper(client) });
  await act(async () => { await expect(result.current.mutateAsync({ gateId: "check", status: "passed", note: "reason", author: "reviewer" })).rejects.toMatchObject({ status: status === 200 ? 409 : status }); });
  expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get("filter")).toBe("");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
});
