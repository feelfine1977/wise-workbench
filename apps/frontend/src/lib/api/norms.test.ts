import { createElement, type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { expect, expectTypeOf, it, vi } from "vitest";
import type { components } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { ApiError } from "@/lib/api";
import { normCalibrationQuery, useCreateNormVersion, useSetNormStatus, type NormCalibration, type CalibrationEntry, type NotApplicableEntry, type NormVersionCreate } from "./norms";

const wrapper = (client: QueryClient) => ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
it("uses generated decision DTOs and reads the version calibration under the norm invalidation prefix", async () => {
  expectTypeOf<NormCalibration>().toEqualTypeOf<components["schemas"]["NormCalibration"]>();
  expectTypeOf<CalibrationEntry>().toEqualTypeOf<components["schemas"]["CalibrationEntry"]>();
  expectTypeOf<NotApplicableEntry>().toEqualTypeOf<components["schemas"]["NotApplicableEntry"]>();
  let path = "";
  const data: NormCalibration = { normVersionId: "v /", status: "draft", thresholds: [{ constraint_id: "c", rationale: "reason", owner: "owner", decidedAt: "2026-09-10T08:15:00Z" }] };
  server.use(http.get("*/projects/:projectId/norms/:id/calibration", ({ request }) => { path = new URL(request.url).pathname; return HttpResponse.json(data); }));
  const query = normCalibrationQuery("p /", "v /");
  expect(query).toMatchObject({ queryKey: ["projects", "p /", "norms", "v /", "calibration"], retry: false, enabled: true });
  expect(normCalibrationQuery("p", "").enabled).toBe(false);
  expect(await new QueryClient().fetchQuery(query)).toEqual(data); expect(path).toContain("/projects/p%20%2F/norms/v%20%2F/calibration");
});

it("forwards calibration and exclusion fields unchanged and keeps signer PATCH separate", async () => {
  const requests: { method: string; body: unknown }[] = [];
  server.use(
    http.post("*/projects/p/norms", async ({ request }) => { requests.push({ method: request.method, body: await request.json() }); return HttpResponse.json({ id: "next" }, { status: 201 }); }),
    http.patch("*/projects/p/norms/next", async ({ request }) => { requests.push({ method: request.method, body: await request.json() }); return HttpResponse.json({ id: "next", status: "reviewed", author: "Signer" }); }),
  );
  const client = new QueryClient(); const invalidation = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const create = renderHook(() => useCreateNormVersion("p"), { wrapper: wrapper(client) });
  const sign = renderHook(() => useSetNormStatus("p"), { wrapper: wrapper(client) });
  const body: NormVersionCreate = { norm: { constraints: [{ id: "c" }, { id: "excluded" }] }, note: "Changed decision", parentId: "parent", calibration: { c: { rationale: "Reason", owner: "Owner" } }, notApplicable: { excluded: { note: "Cannot evaluate", author: "Decision author" } } };
  await act(() => create.result.current.mutateAsync(body));
  await act(() => sign.result.current.mutateAsync({ normVersionId: "next", status: "reviewed", author: "Signer" }));
  expect(requests).toEqual([{ method: "POST", body }, { method: "PATCH", body: { status: "reviewed", author: "Signer" } }]);
  expect(invalidation.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([["projects", "p", "norms"], ["projects", "p", "norms"]]);
});

it("propagates a calibration read refusal for the UI to distinguish from empty saved decisions", async () => {
  server.use(http.get("*/projects/p/norms/v/calibration", () => HttpResponse.json({ detail: "Unavailable", status: 503 }, { status: 503 })));
  await expect(new QueryClient().fetchQuery(normCalibrationQuery("p", "v"))).rejects.toBeInstanceOf(ApiError);
});
