import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { db, resetDb } from "@/mocks/db";
import { bindProjectDataset, projectBindingQuery, useBindProjectDataset } from "./projectBinding";

afterEach(() => vi.unstubAllGlobals());
const saved = { projectId: "p /", datasetId: "o2c", boundAt: "2026-09-27T00:00:00Z" };
it("encodes the project identity and PUTs only the explicit dataset choice", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(saved)); vi.stubGlobal("fetch", fetch);
  expect(await bindProjectDataset(saved.projectId, saved.datasetId)).toEqual(saved);
  const [url, init] = fetch.mock.calls[0]!;
  expect(new URL(url as string).pathname).toBe("/api/v1/projects/p%20%2F/dataset-binding");
  expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ datasetId: "o2c" }) });
  expect(projectBindingQuery("other").queryKey).not.toEqual(projectBindingQuery(saved.projectId).queryKey);
});
it.each([null, {}, { ...saved, projectId: "other" }, { ...saved, datasetId: null }, { ...saved, boundAt: "bad" }])("rejects unverifiable binding responses %j", async (value) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
  await expect(new QueryClient().fetchQuery(projectBindingQuery(saved.projectId))).rejects.toThrow("could not be verified");
});
it("never converts a missing endpoint into an unbound project", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "Not found" }, { status: 404 })));
  await expect(new QueryClient().fetchQuery(projectBindingQuery("p"))).rejects.toMatchObject({ status: 404 });
});
it("mock binding is explicit, idempotent, rejects rebind, and resets with fixtures", async () => {
  const client = new QueryClient(); const query = projectBindingQuery("p2p2018");
  expect(await client.fetchQuery(query)).toEqual({ projectId: "p2p2018", datasetId: null, boundAt: null });
  const first = await bindProjectDataset("p2p2018", "ds_1");
  expect(await bindProjectDataset("p2p2018", "ds_1")).toEqual(first);
  db.datasets.push({ ...db.datasets[0]!, id: "o2c" });
  await expect(bindProjectDataset("p2p2018", "o2c")).rejects.toMatchObject({ status: 409, problem: { code: "project.dataset_already_bound" } });
  expect(await client.fetchQuery(query)).toEqual(first);
  resetDb(); expect((await client.fetchQuery(query)).datasetId).toBeNull(); client.clear();
});
it("writes server confirmation to cache and invalidates dependent project lists", async () => {
  const client = new QueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
  const { result, unmount } = renderHook(() => useBindProjectDataset("p2p2018"), { wrapper });
  await act(async () => { await result.current.mutateAsync("ds_1"); });
  expect(client.getQueryData(projectBindingQuery("p2p2018").queryKey)).toMatchObject({ datasetId: "ds_1" });
  for (const key of ["datasets", "case-tables", "runs"]) expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects", "p2p2018", key] });
  unmount(); client.clear();
});
it("a rejected mutation does not replace the cached binding and requests a refresh", async () => {
  const client = new QueryClient(); const key = projectBindingQuery("p2p2018").queryKey;
  const binding = { ...saved, projectId: "p2p2018" }; client.setQueryData(key, binding);
  server.use(http.put("*/api/v1/projects/p2p2018/dataset-binding", () => HttpResponse.json({ code: "project.dataset_already_bound" }, { status: 409 })));
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result, unmount } = renderHook(() => useBindProjectDataset("p2p2018"), { wrapper });
  await act(async () => { await expect(result.current.mutateAsync("p2p")).rejects.toMatchObject({ status: 409 }); });
  expect(client.getQueryData(key)).toEqual(binding); expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  unmount(); client.clear();
});
