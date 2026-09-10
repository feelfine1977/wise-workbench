import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { filterParam, canonicalParam, filterPreviewQuery, slicingPreviewQuery, runCaveats, uncalibratedById } from "./exploration";
import type { Filter } from "./filter-types";
import { flowFocusedQuery, bpmnUrl, pathsOf } from "./flow";
import { runManifestQuery, scopeOf, flowTypeOf } from "./runs";
import { notebookQuery, useCreateSnapshot, snapshotImageUrl } from "./notebook";
import { guidanceQuery, hubPageQuery, useSetOverlay } from "./knowledge";
import { gatesQuery, whatCanWeDoQuery, useDecideGate, useCreateReviewItem, useUpdateReviewItem, blockingGates, reviewQuery, isRunWide } from "./review";
import { inventoryQuery } from "./norms";

afterEach(() => vi.unstubAllGlobals());
const filter: Filter = { and: [{ kind: "attribute", field: "company", in: ["B", "A"] }, { kind: "open", value: true }] };
const wrapper = (client: QueryClient) => ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);

it.each(["actions", "hypotheses", "findings"] as const)("sends the scoped %s review key using the API spelling", async (collection) => {
  let params: Record<string, string> | undefined;
  server.use(http.get(`*/api/v1/projects/p/${collection}`, ({ request }) => {
    params = Object.fromEntries(new URL(request.url).searchParams);
    return HttpResponse.json([]);
  }));
  const query = reviewQuery("p", collection, { runId: "r", slicing: "company", sliceKey: '["B"]' });
  await new QueryClient().fetchQuery(query);
  expect(params).toEqual({ runId: "r", slicing: "company", key: '["B"]' });
  expect(query.queryKey).toEqual(["projects", "p", collection, "r", "company", '["B"]']);
});

it("keeps raw and canonical filters distinct, along with existing key options", async () => {
  expect(filterParam(filter)).toBe(JSON.stringify(filter));
  expect(canonicalParam(filter)).not.toBe(filterParam(filter));
  expect(filterParam({ and: [] })).toBeUndefined();
  const preview = filterPreviewQuery("p", "r", filter);
  expect(preview.queryKey).toEqual(["projects", "p", "runs", "r", "filters", "preview", JSON.stringify(filter)]);
  expect(preview.staleTime).toBe(1_800_000);
  const slicing = slicingPreviewQuery("p", "r", ["company", "vendor"], [], 0);
  expect(slicing.queryKey).toEqual(["projects", "p", "runs", "r", "slicings", "preview", "company,vendor", "", 0]);
  const focused = flowFocusedQuery("p", "r", { focus: "A", filter, abstraction: 0 });
  expect(focused.queryKey).toEqual(["projects", "p", "runs", "r", "flow", "focus", "", "", "A", JSON.stringify(filter)]);
  expect(flowFocusedQuery("p", "r", { focus: "A", filter, abstraction: 1 }).queryKey).toEqual(focused.queryKey);
  const fetch = vi.fn().mockResolvedValue(Response.json({ nodes: [], edges: [] })); vi.stubGlobal("fetch", fetch);
  await new QueryClient().fetchQuery(focused);
  expect(Object.fromEntries(new URL(fetch.mock.calls[0]![0] as string).searchParams)).toEqual({ focus: "A", filter: JSON.stringify(filter), abstraction: "0" });
  const url = new URL(bpmnUrl("p /", "r?", { detail: 0, filter }));
  expect(url.pathname).toContain("/projects/p%20%2F/runs/r%3F/flow/bpmn");
  expect(Object.fromEntries(url.searchParams)).toEqual({ scope: "flow", detail: "0", filter: canonicalParam(filter) });
});

it("keeps query retry/enabled/invalidations boundaries, including current key omissions", () => {
  expect(runManifestQuery("p", "r")).toMatchObject({ queryKey: ["projects", "p", "runs", "r", "manifest"], retry: false, staleTime: 1_800_000 });
  expect(notebookQuery("p").queryKey).toEqual(["projects", "p", "notebook"]);
  expect(inventoryQuery("p", "")).toMatchObject({ enabled: false, retry: false });
  expect(hubPageQuery("p", "node", "one").queryKey).toEqual(hubPageQuery("p", "node", "two").queryKey);
  expect(guidanceQuery("p", "layer", "", "norm")).toMatchObject({ enabled: false, retry: false, queryKey: ["projects", "p", "guidance", "layer", "", "norm"] });
  const params = { slicing: "company", sliceKey: '["B"]', view: "Finance" };
  expect(gatesQuery("p", "r", params)).toMatchObject({ queryKey: ["projects", "p", "runs", "r", "gates", "company", '["B"]', "Finance", null], staleTime: 0, retry: false });
  expect(whatCanWeDoQuery("p", "r", { ...params, top: 1 }).queryKey).toEqual(whatCanWeDoQuery("p", "r", { ...params, top: 9 }).queryKey);
});

it("preserves multipart snapshot input and notebook invalidation", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: "snapshot" })); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const { result } = renderHook(() => useCreateSnapshot("p /"), { wrapper: wrapper(client) });
  const image = new Blob(["png"], { type: "image/png" });
  await act(() => result.current.mutateAsync({ title: "Title", note: "Note", context: { screen: "flow", url: "/flow" }, image }));
  const [url, init] = fetch.mock.calls[0]!;
  expect(new URL(url as string).pathname).toContain("/projects/p%20%2F/notebook/snapshots");
  const form = (init as RequestInit).body as FormData;
  expect(form.get("payload")).toBe('{"title":"Title","note":"Note","context":{"screen":"flow","url":"/flow"},"data":null,"author":null}');
  expect((form.get("image") as File).name).toBe("screen.png");
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["projects", "p /", "notebook"] });
});

it("preserves overlay PUT and both invalidation prefixes", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ kind: "layer", id: "L" })); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const { result } = renderHook(() => useSetOverlay("p", "layer", "L /"), { wrapper: wrapper(client) });
  await act(() => result.current.mutateAsync({ note: "reviewed", author: "reader" }));
  const init = fetch.mock.calls[0]![1] as RequestInit;
  expect(init).toMatchObject({ method: "PUT", body: '{"note":"reviewed","author":"reader"}' });
  expect(init.headers).not.toHaveProperty("Idempotency-Key");
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([["projects", "p", "guidance", "layer", "L /"], ["projects", "p", "knowledge"]]);
});

it("preserves gate body/query spellings and both precise invalidations", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ gates: [] })); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const { result } = renderHook(() => useDecideGate("p", "r", { slicing: "company", sliceKey: '["B"]', view: "Finance" }), { wrapper: wrapper(client) });
  await act(() => result.current.mutateAsync({ gateId: "gate /", status: "waived", note: "reason", author: "reader" }));
  const [raw, init] = fetch.mock.calls[0]!;
  expect((init as RequestInit).body).toBe('{"status":"waived","note":"reason","author":"reader"}');
  expect(Object.fromEntries(new URL(raw as string).searchParams)).toEqual({ slicing: "company", key: '["B"]', view: "Finance" });
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: gatesQuery("p", "r", { slicing: "company", sliceKey: '["B"]', view: "Finance" }).queryKey, exact: true }],
    [{ queryKey: ["projects", "p", "runs", "r", "what-can-we-do", "company", '["B"]', "Finance"] }],
  ]);
});

it("preserves open review request bodies and collection invalidation", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ id: "item" })); vi.stubGlobal("fetch", fetch);
  const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const create = renderHook(() => useCreateReviewItem("p", "hypotheses"), { wrapper: wrapper(client) });
  const update = renderHook(() => useUpdateReviewItem("p", "hypotheses"), { wrapper: wrapper(client) });
  const body = { constraint_id: "c", expected_direction: "higher", custom_field: 0 };
  await act(() => create.result.current.mutateAsync(body));
  await act(() => update.result.current.mutateAsync({ id: "item /", body }));
  expect(fetch.mock.calls.map(([, init]) => (init as RequestInit).body)).toEqual([JSON.stringify(body), JSON.stringify(body)]);
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([["projects", "p", "hypotheses"], ["projects", "p", "hypotheses"]]);
});

it("keeps view helpers and run-wide gate classification", () => {
  expect(isRunWide({ id: "group", kind: "readiness", status: "passed", text: "Group", scope: "group" })).toBe(false);
  expect(isRunWide({ id: "run_readiness", kind: "readiness", status: "failed", text: "Whole run", scope: "run" })).toBe(true);
  expect(scopeOf(undefined)).toBeUndefined(); expect(flowTypeOf(undefined)).toBeUndefined();
  expect(runCaveats(undefined)).toBeUndefined();
  expect(runCaveats({ caveat_summary: { c: { share: 0.2, max: 0.4 } } })).toEqual([{ id: "c", share: 0.2, max: 0.4 }]);
  expect(uncalibratedById({ uncalibrated: [{ id: "c", text: "Check" }] }).get("c")?.text).toBe("Check");
  expect(pathsOf({ nodes: [], edges: [], paths: { incoming: [], outgoing: [] }, meta: { pathsHidden: 2 } }, "A")).toEqual({ focus: "A", incoming: [], outgoing: [], hidden: 2 });
  expect(snapshotImageUrl({ id: "s", projectId: "p", title: "T", note: "", context: {}, order: 0, createdAt: "now", updatedAt: "now", hasImage: false })).toBeUndefined();
  expect(blockingGates([{ id: "whole", kind: "readiness", status: "failed", text: "Whole run" }, { id: "group", kind: "readiness", status: "failed", text: "Group", evidence: { scope: "group" } }]).map(g => g.id)).toEqual(["group"]);
});
