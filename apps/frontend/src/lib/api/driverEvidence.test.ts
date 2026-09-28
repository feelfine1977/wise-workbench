import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { driverEvidenceFixture as evidence } from "@/routes/act/driverEvidence.fixture";
import { driverEvidenceQuery } from "./driverEvidence";

const params = { constraintId: "lag", slicing: "company", sliceKey: '["A"]', view: "Finance" };
afterEach(() => vi.unstubAllGlobals());

it("keys every population input, sends the raw filter, and supplies an abort signal", async () => {
  const filter = ' {"and":[{"kind":"open","value":true}]} ';
  const answer = { ...evidence, scope: { ...evidence.scope, filtered: true, filter: JSON.parse(filter) } };
  const fetch = vi.fn().mockResolvedValue(Response.json(answer)); vi.stubGlobal("fetch", fetch);
  const query = driverEvidenceQuery("p", "r", { ...params, filter });
  expect(await new QueryClient().fetchQuery(query)).toEqual(answer);
  const [url, init] = fetch.mock.calls[0]!;
  expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ constraintId: "lag", slicing: "company", key: '["A"]', view: "Finance", filter });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  for (const changed of [{ constraintId: "other" }, { slicing: "vendor" }, { sliceKey: '["B"]' }, { view: "General" }, { filter: "" }]) expect(driverEvidenceQuery("p", "r", { ...params, filter, ...changed }).queryKey).not.toEqual(query.queryKey);
  expect(driverEvidenceQuery("p", "other", { ...params, filter }).queryKey).not.toEqual(query.queryKey);
});

it.each(["", "{", '{"and":[{"kind":"unknown"}]}'])("preserves refused filter %j and does not retry without it", async filter => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ detail: "Unsupported filter" }, { status: 422 })); vi.stubGlobal("fetch", fetch);
  await expect(new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", { ...params, filter }))).rejects.toMatchObject({ status: 422 });
  expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("filter")).toBe(filter);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  { label: "another run", answer: { ...evidence, source: { ...evidence.source, runId: "other" } } },
  { label: "another group", answer: { ...evidence, scope: { ...evidence.scope, key: ["B"] } } },
  { label: "another view", answer: { ...evidence, scope: { ...evidence.scope, view: "Other" } } },
  { label: "another constraint", answer: { ...evidence, constraintId: "other" } },
  { label: "missing fingerprint", answer: { ...evidence, scope: { ...evidence.scope, fingerprint: "" } } },
  { label: "invalid counts", answer: { ...evidence, scope: { ...evidence.scope, selectedCases: 500 } } },
  { label: "scored applicability subset", answer: { ...evidence, scope: { ...evidence.scope, ruleApplicabilityApplied: true } } },
])("refuses $label instead of presenting mismatched evidence", async ({ answer }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer)));
  await expect(new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", params))).rejects.toMatchObject({ status: 409 });
});

it("rejects a whole-group answer for a filtered request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(evidence)));
  await expect(new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", { ...params, filter: '{"and":[{"kind":"open","value":true}]}' }))).rejects.toMatchObject({ status: 409 });
});

it("preserves explicit empty-selection unavailability and zero counts", async () => {
  const answer = { ...evidence, status: "unavailable", reason: "No selected cases", duration: null, endpoints: null, endDayOfMonth: null, scope: { ...evidence.scope, selectedCases: 0, selectedEvents: 0 } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer)));
  expect(await new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", params))).toEqual(answer);
});

it("refuses a different filter even when the server marks it filtered", async () => {
  const answer = { ...evidence, scope: { ...evidence.scope, filtered: true, filter: { and: [{ kind: "open", value: false }] } } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer)));
  await expect(new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", { ...params, filter: '{"and":[{"kind":"open","value":true}]}' }))).rejects.toMatchObject({ status: 409 });
});

it.each([
  { filter: '{"value":true,"kind":"open"}', value: { and: [{ kind: "open", value: true }] }, filtered: true },
  { filter: ' {"and":[{"value":true,"kind":"open"}]} ', value: { and: [{ kind: "open", value: true }] }, filtered: true },
  { filter: '{"and":[]}', value: { and: [] }, filtered: false },
  { filter: '{}', value: { and: [] }, filtered: false },
])("accepts the documented normalization of $filter", async ({ filter, value, filtered }) => {
  const answer = { ...evidence, scope: { ...evidence.scope, filtered, filter: value } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer)));
  expect(await new QueryClient().fetchQuery(driverEvidenceQuery("p", "r", { ...params, filter }))).toEqual(answer);
});
