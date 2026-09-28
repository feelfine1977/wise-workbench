/**
 * Contract tests: every operation of packages/api-schema/openapi.yaml (regenerated from the backend) has a
 * mock handler, and each mocked response satisfies the response schema (required properties, enums,
 * primitive types, $ref/allOf/anyOf, nullable). Path parameters use the backend's formats: JSON-array slice
 * keys, slicing ids made of column names.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { db } from "./db";
import { server } from "./node";
import { http, HttpResponse } from "msw";
import type { components } from "@wise/api-schema";
import { edaCases } from "./fixtures/eda";
import { evaluateMockEda } from "./eda";

const here = dirname(fileURLToPath(import.meta.url));
const spec = parse(readFileSync(resolve(here, "../../../../packages/api-schema/openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
  components: { schemas: Record<string, unknown> };
};

type Schema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  additionalProperties?: Schema | boolean;
  prefixItems?: Schema[];
};

function deref(s: Schema): Schema {
  if (s.$ref) {
    const name = s.$ref.split("/").pop() as string;
    return deref(spec.components.schemas[name] as Schema);
  }
  if (s.allOf) {
    const merged: Schema = { type: "object", properties: {}, required: [] };
    for (const part of s.allOf) {
      const d = deref(part);
      Object.assign(merged.properties as object, d.properties ?? {});
      merged.required = [...(merged.required ?? []), ...(d.required ?? [])];
    }
    return merged;
  }
  return s;
}

function validate(value: unknown, schema: Schema, path: string, errors: string[]) {
  const s = deref(schema);
  const branches = s.anyOf ?? s.oneOf;
  if (branches) {
    const attempts = branches.map((b) => {
      const errs: string[] = [];
      validate(value, b, path, errs);
      return errs;
    });
    if (!attempts.some((e) => e.length === 0)) errors.push(`${path}: ${JSON.stringify(value)} matches none of ${branches.length} alternatives (${attempts.map((a) => a[0]).join(" | ")})`);
    return;
  }
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(s.enum)}`);
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (types.length === 0) return;
  const errs: string[] = [];
  for (const type of types) {
    const e: string[] = [];
    validateType(value, s, type, path, e);
    if (e.length === 0) return;
    errs.push(...e);
  }
  errors.push(...errs);
}

function validateType(value: unknown, s: Schema, type: string, path: string, errors: string[]) {
  switch (type) {
    case "null":
      if (value !== null) errors.push(`${path}: expected null`);
      return;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return errors.push(`${path}: expected object`);
      const obj = value as Record<string, unknown>;
      for (const req of s.required ?? []) if (!(req in obj) || obj[req] === undefined) errors.push(`${path}.${req}: required`);
      for (const [k, sub] of Object.entries(s.properties ?? {})) if (obj[k] !== undefined) validate(obj[k], sub, `${path}.${k}`, errors);
      if (s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) {
        for (const [k, v] of Object.entries(obj)) validate(v, s.additionalProperties, `${path}.${k}`, errors);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) return errors.push(`${path}: expected array`);
      if (s.items) value.forEach((v, i) => validate(v, s.items as Schema, `${path}[${i}]`, errors));
      return;
    }
    case "string":
      if (typeof value !== "string") errors.push(`${path}: expected string`);
      return;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path}: expected integer`);
      return;
    case "number":
      if (typeof value !== "number") errors.push(`${path}: expected number`);
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
      return;
    default:
      return;
  }
}

const base = "http://localhost/api/v1";
const params: Record<string, string> = {
  projectId: "p2p2018",
  datasetId: "ds_1",
  caseTableId: "ct_1",
  normVersionId: "nv_7",
  runId: "run_41",
  sliceKey: encodeURIComponent('["vendorID_0136"]'),
  caseId: "4507012345_00010",
  constraintId: "c_l3_invoice_to_clear_days",
  jobId: "job_41",
  presetId: "bpic2019",
  snapshotId: "snap_1",
  selectionId: "selection_contract",
  // the third release's operations
  // hub node ids carry their kind and their pack: `expectation:<template>:<constraint>`
  nodeId: "expectation:p2p_bpic19:c_l3_invoice_to_clear_days",
  kind: "constraint",
  entryId: "c_l3_invoice_to_clear_days",
  activityId: "a_record_goods_receipt",
  gateId: "censoring",
  itemId: "item_1",
};
const query: Record<string, string> = {
  "/projects/{projectId}/case-tables/{caseTableId}/eda": "?datasetId=ds_1",
  "/projects/{projectId}/runs/{runId}/backlog": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/slices/{sliceKey}": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/diagnostics": `?slicing=${encodeURIComponent("case Vendor")}`,
  "/projects/{projectId}/runs/{runId}/slicings/preview": `?slicing=${encodeURIComponent("case Vendor,exposure")}&bands=${encodeURIComponent(JSON.stringify([{ attribute: "exposure", method: "quantile", q: 4 }]))}`,
  "/projects/{projectId}/runs/{runId}/filters/preview": `?filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "activity", op: "contains", activity: "Remove Payment Block" }] }))}`,
  "/projects/{projectId}/runs/{runId}/flow": "?focus=a_record_goods_receipt",
  "/projects/{projectId}/decisions": "?caseTableId=ct_1",
  "/projects/{projectId}/runs/{runId}/gates": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/gates/{gateId}": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/driver-evidence": `?constraintId=c_l3_invoice_to_clear_days&slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/what-can-we-do": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/norms/{normVersionId}/relevance": "?caseTableId=ct_1",
  "/projects/{projectId}/norms/templates": "?caseTableId=ct_1",
  "/projects/{projectId}/norms/inventory": "?caseTableId=ct_1",
  "/projects/{projectId}/norms/{normVersionId}/signals/{constraintId}": "?caseTableId=ct_1",
  "/projects/{projectId}/norms/applicability": "?caseTableId=ct_1",
  "/projects/{projectId}/runs/{runId}/facets": `?by=flow_type&view=Automation`,
  "/projects/{projectId}/runs/{runId}/kpis": `?view=Automation&grouping=${encodeURIComponent("case Company+case Spend area text")}`,
};
const bodies: Record<string, unknown> = {
  "post /projects/{projectId}/case-tables/{caseTableId}/eda/query": { datasetId: "ds_1", insight: true, valueField: "vendor", valueSearch: "Vendor" },
  "post /projects/{projectId}/case-tables/{caseTableId}/grouping-suggestions": { normVersionId: "nv_1", views: ["Finance"], minCases: 20 },
  "post /projects/{projectId}/case-tables/{caseTableId}/selections": { name: "Contract-only synthetic selection", datasetId: "ds_1", selection: {} },
  "post /projects": { name: "New project", process: "p2p" },
  "post /projects/{projectId}/datasets/{datasetId}/mappings": { caseId: "case concept:name", activity: "event concept:name", timestamp: "event time:timestamp", headerEvents: ["Vendor creates invoice"] },
  "post /projects/{projectId}/norms": { norm: db.norms[2]?.norm, note: "contract test", parentId: "nv_7" },
  "patch /projects/{projectId}/norms/{normVersionId}": { status: "approved" },
  "post /projects/{projectId}/norms/{normVersionId}/check": { caseTableId: "ct_1" },
  "post /projects/{projectId}/runs": { caseTableId: "ct_1", normVersionId: "nv_7", gamma: 20, slicings: [{ attributes: ["case Vendor"] }], scope: { flow_type: "DF2", attribute: "flow_type" } },
  "post /projects/{projectId}/runs/{runId}/whatif": { name: "make-to-order items get their own threshold", transforms: [], norm: { constraints: [{ id: "c_l3_invoice_to_clear_days", delta: 30 }] }, note: "contract test", author: "tester" },
  "post /projects/{projectId}/runs/{runId}/whatif/preview": { transforms: [{ kind: "cap_lag", activity: "Clear Invoice", days: 30 }] },
  "post /projects/{projectId}/case-tables/{caseTableId}/decisions/preview": { kind: "collapse_duplicates", params: {} },
  "post /projects/{projectId}/case-tables/{caseTableId}/decisions": { kind: "open_cases", params: { handling: "exclude" }, note: "contract test", author: "tester" },
  "post /projects/{projectId}/notebook/reorder": { ids: ["snap_1"] },
  "patch /projects/{projectId}/notebook/snapshots/{snapshotId}": { title: "renamed", note: "edited" },
  "post /projects/{projectId}/norms/constraints/check": { caseTableId: "ct_1", constraint: { id: "c_l3_invoice_to_clear_days", type: "lag", layer: "L3_timeliness_ageing", activities: ["Record Invoice Receipt", "Clear Invoice"] } },
  "post /projects/{projectId}/runs/{runId}/gates/{gateId}": { status: "waived", note: "contract test" },
  "post /projects/{projectId}/hypotheses": { constraint_id: "c_l3_invoice_to_clear_days", run_id: "run_41", slicing: "case Vendor", slice_key: '["vendorID_0136"]', note: "contract test" },
  "post /projects/{projectId}/findings": { title: "contract test finding", run_id: "run_41" },
  "post /projects/{projectId}/actions": { title: "contract test action", run_id: "run_41" },
  "patch /projects/{projectId}/hypotheses/{itemId}": { status: "supported", note: "contract test" },
  "patch /projects/{projectId}/findings/{itemId}": { status: "closed", note: "contract test" },
  "patch /projects/{projectId}/actions/{itemId}": { status: "accepted", note: "contract test" },
};

/** The review entities are created before the operations that read or change one are called. */
const REVIEW_COLLECTIONS = ["hypotheses", "findings", "actions"] as const;
const needsReviewItem = (path: string) => path.includes("{itemId}");
async function createReviewItems(path: string) {
  for (const collection of REVIEW_COLLECTIONS) {
    const body = collection === "hypotheses" ? { constraint_id: "c_l3_invoice_to_clear_days" } : { title: `contract test ${collection}` };
    const res = await fetch(`${base}/projects/p2p2018/${collection}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(201);
    const item = (await res.json()) as { id: string };
    // the id of the collection this operation belongs to
    if (path.includes(`/${collection}/`)) params.itemId = item.id;
  }
}
/** Operations whose path names a snapshot first need one (the database is reset between tests). */
const needsSnapshot = (path: string) => path.includes("{snapshotId}") || path.endsWith("/notebook/reorder") || path.endsWith("/notebook/export");
async function createSnapshot() {
  const form = new FormData();
  form.append("payload", JSON.stringify({ title: "contract test", note: "n", context: { screen: "signals", url: "/p/p2p2018" } }));
  form.append("image", new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" }));
  const res = await fetch(`${base}/projects/p2p2018/notebook/snapshots`, { method: "POST", body: form });
  expect(res.status).toBe(201);
}

const fill = (p: string) => p.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? k);

describe("OpenAPI contract vs MSW mocks", () => {
  const ops = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).filter(([m]) => ["get", "post", "patch", "delete"].includes(m)).map(([method, op]) => ({ path, method, op })));

  it("covers every operation of the contract", () => {
    expect(ops.length).toBeGreaterThan(30);
  });

  for (const { path, method, op } of ops) {
    if (path === "/jobs/{jobId}/events") continue; // SSE: streamed, checked separately below
    it(`${method.toUpperCase()} ${path} (${op.operationId})`, async () => {
      const key = `${method} ${path}`;
      // Saved cohorts deliberately have no fabricated demo membership. Supply an explicit
      // contract-only fixture here, as the feature tests do; live behavior is tested by the API suite.
      if (path.startsWith("/projects/{projectId}/case-tables/{caseTableId}/selections")) {
        const selection: components["schemas"]["SavedSelection"] = {
          id: "selection_contract", name: "Contract-only synthetic selection", projectId: "p2p2018", datasetId: "ds_1", caseTableId: "ct_1", cases: 0,
          createdAt: "2026-09-27T00:00:00Z", selection: {}, membershipChecksum: "synthetic-empty", semanticsVersion: "eda-v1",
          source: { mappingId: "m1", mappingChecksum: "synthetic", casesChecksum: "synthetic", eventsChecksum: "synthetic" },
        };
        server.use(
          http.post("*/projects/:projectId/case-tables/:caseTableId/selections", () => HttpResponse.json(selection, { status: 201 })),
          http.get("*/projects/:projectId/case-tables/:caseTableId/selections/:selectionId", () => HttpResponse.json(selection)),
        );
      }
      if (path.endsWith("/grouping-suggestions")) {
        const fixture: components["schemas"]["GroupingSuggestionsResponse"] = {
          attributes: [], suggestions: [], search: {}, notice: "Contract-only synthetic fixture; no discovery was performed.",
          evidence: { kind: "pre_scoring_context_support", projectId: "p2p2018", datasetId: "ds_1", caseTableId: "ct_1", normVersionId: "nv_1",
            normFingerprint: "synthetic", effectiveNormFingerprint: "synthetic", views: ["Finance"], minCases: 20, cases: 0, fingerprint: "synthetic",
            source: { mappingId: "m1", mappingChecksum: "synthetic", casesChecksum: "synthetic", eventsChecksum: "synthetic" } },
        };
        server.use(http.post("*/projects/:projectId/case-tables/:caseTableId/grouping-suggestions", () => HttpResponse.json(fixture)));
      }
      if (path.endsWith("/preview/{constraintId}")) {
        // Explicit synthetic contract response only. Demo mode cannot evaluate real draft effects.
        const counts = { populationCases: 0, applicableCases: 0, evaluatedCases: 0, unknownCases: 0, violatingCases: 0, violationShare: null, meanPenalty: null };
        const fixture: components["schemas"]["NormConstraintPreview"] = {
          normVersionId: "nv_7", caseTableId: "ct_1", constraintId: "c_l3_invoice_to_clear_days", scope: { kind: "all_cases" },
          saved: { counts, note: "Contract-only empty fixture" }, proposed: { counts, note: "Contract-only empty fixture" },
        };
        server.use(http.post("*/projects/:projectId/norms/:normVersionId/preview/:constraintId", () => HttpResponse.json(fixture)));
      }
      if (needsSnapshot(path)) await createSnapshot();
      if (needsReviewItem(path)) await createReviewItems(path);
      let init: RequestInit = { method: method.toUpperCase() };
      if (key === "post /projects/{projectId}/datasets") {
        const form = new FormData();
        form.append("file", new File(["case,activity,time\n1,a,2018-01-01"], "log.csv", { type: "text/csv" }));
        init = { ...init, body: form };
      } else if (key === "post /projects/{projectId}/notebook/snapshots") {
        const form = new FormData();
        form.append("payload", JSON.stringify({ title: "frozen", note: "", context: { screen: "why", url: "/p/p2p2018" }, data: { rows: 1 } }));
        form.append("image", new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" }));
        init = { ...init, body: form };
      } else if (key === "post /projects/{projectId}/notebook/snapshots/{snapshotId}/image") {
        const form = new FormData();
        form.append("image", new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" }));
        init = { ...init, body: form };
      } else if (bodies[key]) {
        init = { ...init, body: JSON.stringify(bodies[key]), headers: { "Content-Type": "application/json" } };
      }
      const res = await fetch(`${base}${fill(path)}${query[path] ?? ""}`, init);
      const expected = Object.keys(op.responses ?? {}).filter((c) => c.startsWith("2"));
      expect(expected, "2xx documented").not.toHaveLength(0);
      expect(expected).toContain(String(res.status));
      const schema = op.responses?.[String(res.status)]?.content?.["application/json"]?.schema as Schema | undefined;
      const isJson = (res.headers.get("content-type") ?? "").includes("json");
      if (schema && isJson) {
        const body = await res.json();
        const errors: string[] = [];
        validate(body, schema, "$", errors);
        expect(errors).toEqual([]);
      }
    });
  }

  it("streams job events as text/event-stream and ends with a terminal done event", async () => {
    const res = await fetch(`${base}/jobs/job_41/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: progress");
    expect(text.trim().split("\n\n").at(-1)).toMatch(/^event: done/);
  });

  it("uses the backend's key formats: JSON-array slice keys and column-name slicings", async () => {
    const page = (await (await fetch(`${base}/projects/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&gamma=20&minCases=1`)).json()) as { rows: { key: string; keys: Record<string, string>; kind?: string; reading?: string; stability?: string; comparison?: string; points_below?: string; caveats?: unknown[] }[]; maxStablePI: number; params: Record<string, unknown> };
    expect(JSON.parse(page.rows[0]?.key ?? "[]")).toEqual(["companyID_0000", "Packaging"]);
    expect(page.rows[0]?.keys).toEqual({ "case Company": "companyID_0000", "case Spend area text": "Packaging" });
    expect(page.rows[0]?.kind).toBe("widespread");
    expect(page.rows[0]?.reading).toMatch(/^companyID_0000 × Packaging: 109,199 cases, 0\.9 % below expectation on average; widespread: many cases, slightly off;/);
    expect(page.maxStablePI).toBeCloseTo(945.7, 1);
    // the verified run's analytics fields (R1-01, R1-04, RG-20) travel with the row
    expect(page.rows[0]?.stability).toBe("stable");
    expect(page.rows[0]?.comparison).toBe("Paid within terms: 83 days here against 55 elsewhere (+28 days).");
    expect(page.rows[0]?.points_below).toBe("0.9 points below the overall score of 84.4 (1 %)");
    expect(page.rows[0]?.caveats).toHaveLength(2);
    expect(page.params.case_noun).toBe("purchase order items");
    expect(page.params.illustrative).toBe(false);
    const detail = await fetch(`${base}/projects/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000","Packaging"]')}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`);
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as { contrast: { columns: string[] }; comparison: string; guidance_refs: unknown[]; headroom: { columns: string[] } };
    expect(d.contrast.columns).toContain("median_elsewhere");
    expect(d.comparison).toMatch(/83 days here against 55 elsewhere/);
    expect(d.guidance_refs.length).toBeGreaterThan(0);
    expect(d.headroom.columns).toContain("gain_points");
    // illustrative slicings are marked
    const illustrative = (await (await fetch(`${base}/projects/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Item Type")}&view=Finance`)).json()) as { params: Record<string, unknown> };
    expect(illustrative.params.illustrative).toBe(true);
  });

  it("answers with RFC 9457 problems on unknown ids and missing parameters", async () => {
    const missing = await fetch(`${base}/projects/p2p2018/runs/run_41/backlog`);
    expect(missing.status).toBe(422);
    expect(missing.headers.get("content-type")).toContain("application/problem+json");
    const gone = await fetch(`${base}/projects/p2p2018/runs/nope`);
    expect(gone.status).toBe(404);
  });
});


/** Feature contract checks use the six illustrative cases, independently of the BPIC fixtures. */
describe("EDA insight contract", () => {
  type Result = components["schemas"]["EDAResponse"];
  const endpoint = `${base}/projects/p2p2018/case-tables/ct_1/eda`;
  const request = (params: Record<string, string | undefined> = {}) => fetch(`${endpoint}?${new URLSearchParams({ datasetId: "ds_1", ...Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`);
  async function get(params: Record<string, string> = {}) {
    const response = await request({ insight: "true", ...params });
    expect(response.status).toBe(200);
    const result = await response.json() as Result;
    expect(spec.components.schemas.EDAInsights, "Generate the backend insight contract before running this subset").toBeDefined();
    const errors: string[] = [];
    validate(result, { $ref: "#/components/schemas/EDAResponse" }, "$", errors);
    expect(errors).toEqual([]);
    return result;
  }
  const ids = (result: Result) => result.details.rows.map((row) => row.caseId).sort();
  const key = (result: Result, field: string, value: string) => result.insights!.facets.find((facet) => facet.field === field)!.categories.find((category) => category.value === value)!.key;
  const totals = (rows: { total: number; selected: number }[]) => rows.reduce((sum, row) => ({ total: sum.total + row.total, selected: sum.selected + row.selected }), { total: 0, selected: 0 });
  function conserved(result: Result) {
    const insights = result.insights!;
    for (const rows of [result.categories, result.trend, result.spans, insights.eventBins, insights.density, insights.concentration, ...insights.facets.map((facet) => facet.categories)]) expect(totals(rows)).toEqual(result.summary.cases);
    if (insights.joint.length) expect(totals(insights.joint)).toEqual(result.summary.cases);
    expect(insights.concentration.reduce((sum, row) => sum + row.events, 0)).toBe(result.summary.events.selected);
    expect(result.details.total).toBe(result.summary.cases.selected);
  }

  it("makes insights opt-in and computes profiles, complete domains and zero cells from the fixture", async () => {
    expect((await (await request()).json() as Result).insights).toBeNull();
    const all = await get();
    conserved(all);
    expect(all.summary.events).toEqual({ total: 17, selected: 17 });
    expect((await get({ selection: JSON.stringify({ eventMissing: true }) })).summary.cases.selected).toBe(0);
    expect((await get({ selection: JSON.stringify({ eventMissing: false }) })).summary.cases.selected).toBe(6);
    expect(all.insights!.compareAttribute).toBe("vendor");
    expect(all.insights!.facets.map((facet) => facet.field)).toEqual(["flow_type", "vendor"]);
    expect(all.insights!.facets[0]!.categories.map((c) => [c.key, c.value, c.total])).toEqual([
      ["v1", "DF1", 2], ["v2", "DF2", 2], ["v3", "Consignment", 1], ["other", null, 0], ["missing", null, 1],
    ]);
    expect(all.insights!.joint).toHaveLength(20);
    expect(all.insights!.joint.filter((cell) => cell.total === 0).length).toBeGreaterThan(0);
    expect(all.insights!.eventBins.map((bin) => bin.min)).toEqual([0, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500]);
    expect(all.insights!.eventBins.at(-1)!.max).toBeNull();
    expect(all.insights!.eventBins.find((bin) => bin.key === "missing")).toBeUndefined();
    expect(all.insights!.density).toHaveLength(all.spans.length * 11);
    expect(all.insights!.density.find((cell) => cell.spanKey === "missing" && cell.eventKey === "2")).toMatchObject({ total: 1, selected: 1 });
    expect(all.insights!.fields.map((field) => [field.name, field.role])).toEqual([
      ["caseId", "case_id"], ["n_events", "events"], ["first_ts", "timestamp"], ["last_ts", "timestamp"], ["flow_type", "attribute"], ["vendor", "attribute"],
    ]);
    expect(all.insights!.fields.find((f) => f.name === "n_events")).toMatchObject({ dataType: "int64", distinct: 5, missing: { total: 0, selected: 0 }, numeric: { min: 1, max: 5, median: 2.5, p90: 4.5 } });
    expect(all.insights!.fields.find((f) => f.name === "vendor")).toMatchObject({ dataType: "string", distinct: 2, missing: { total: 2, selected: 2 }, numeric: null });
    expect(all.insights!.fields.find((f) => f.name === "first_ts")).toMatchObject({ distinct: 5, missing: { total: 1, selected: 1 }, numeric: null });
    expect(all.insights!.concentration.find((c) => c.key === "v1")).toMatchObject({ selected: 2, events: 7, medianSpanDays: 1.5, p90SpanDays: 1.9 });
    expect(all.notes.join(" ")).toContain("full table");
  });

  it("ORs facet keys and event ranges, intersects every dimension and legacy filter, and preserves membership for saves", async () => {
    const all = await get();
    const selection = {
      facets: [{ field: "flow_type", keys: [key(all, "flow_type", "DF1"), "missing"] }, { field: "vendor", keys: [key(all, "vendor", "Vendor A"), "missing"] }],
      categoryKeys: [key(all, "flow_type", "DF1"), "missing"],
      eventRanges: [{ min: 2, max: 3 }, { min: 3, max: 5 }],
      timeRanges: [{ from: "2018-01-01", before: "2018-02-01" }, { from: "2018-02-01", before: "2018-03-01" }], timeMissing: true,
      spanRanges: [{ min: 1, max: 2 }, { min: 2, max: 3 }], spanMissing: true,
    };
    const params = { selection: JSON.stringify(selection) };
    const selected = await get(params);
    conserved(selected);
    expect(ids(selected)).toEqual(["demo-001", "demo-003", "demo-005"]);
    expect(selected.summary.events.selected).toBe(9);
    expect(ids(await get({ ...params, spanMin: "2" }))).toEqual(["demo-003"]);
    expect(ids(await get({ ...params, filter: JSON.stringify({ and: [{ kind: "time", from: "2018-01-01", to: "2018-01-31" }] }) }))).toEqual(["demo-001"]);
    expect(ids(evaluateMockEda(new URLSearchParams(params), "ds_1", "ct_1"))).toEqual(ids(selected));
    const narrowed = await get({ selection: JSON.stringify({ ...selection, eventRanges: [{ min: 3, max: 4 }] }) });
    expect(ids(narrowed)).toEqual(["demo-001"]);
    expect(selected.insights!.fields.find((f) => f.name === "n_events")).toMatchObject({ distinct: 5, numeric: { min: 2, max: 4, median: 3, p90: 3.8 } });
    expect(selected.insights!.fields.find((f) => f.name === "vendor")).toMatchObject({ distinct: 2, missing: { total: 2, selected: 1 } });
  });

  it("evaluates nondisplayed facets without insights and deduplicates a repeated comparison field", async () => {
    const all = await get();
    const params = { compareAttribute: "flow_type", selection: JSON.stringify({ facets: [{ field: "vendor", keys: [key(all, "vendor", "Vendor B")] }], eventRanges: [{ min: 2, max: 5 }] }) };
    const selected = await get(params);
    expect(ids(selected)).toEqual(["demo-006"]);
    expect(selected.insights!.compareAttribute).toBe("flow_type");
    expect(selected.insights!.facets.map((facet) => facet.field)).toEqual(["flow_type"]);
    expect(selected.insights!.joint).toEqual([]);
    conserved(selected);
    const plain = await get({ ...params, insight: "false" });
    expect(plain.insights).toBeNull();
    expect(ids(plain)).toEqual(ids(selected));
    expect((await get({ attribute: "vendor" })).insights!.compareAttribute).toBe("flow_type");
  });

  it("keeps full-table domains stable across selection and pagination and exposes empty-scope null statistics", async () => {
    const all = await get();
    const params = { selection: JSON.stringify({ eventRanges: [{ min: 2, max: 5 }] }), pageSize: "1" };
    const first = await get(params), second = await get({ ...params, page: "2" });
    expect(first.insights).toEqual(second.insights);
    expect(first.summary).toEqual(second.summary);
    expect(first.details.rows[0]!.caseId).not.toBe(second.details.rows[0]!.caseId);
    const domains = (result: Result) => result.insights!.facets.map((facet) => ({ field: facet.field, categories: facet.categories.map(({ selected: _selected, ...category }) => category) }));
    expect(domains(first)).toEqual(domains(all));
    const empty = await get({ selection: JSON.stringify({ facets: [{ field: "vendor", keys: ["other"] }] }) });
    conserved(empty);
    expect(empty.summary.cases.selected).toBe(0);
    expect(empty.insights!.fields.find((f) => f.name === "n_events")).toMatchObject({ distinct: 5, numeric: { min: null, max: null, median: null, p90: null } });
    expect(empty.insights!.concentration.every((row) => row.selected === 0 && row.events === 0 && row.medianSpanDays === null && row.p90SpanDays === null)).toBe(true);
    expect(domains(empty)).toEqual(domains(all));
    expect((await get({ selection: JSON.stringify({ facets: null, eventRanges: null, categoryKeys: null, timeRanges: null, spanRanges: null }) })).summary.cases.selected).toBe(6);
  });

  it("retains null event counts in bins/density and excludes them from ranges, sums and numeric statistics", async () => {
    const row = edaCases[0]!, before = row.events;
    try {
      row.events = null;
      const all = await get();
      conserved(all);
      expect(all.summary.events).toEqual({ total: 14, selected: 14 });
      expect(all.insights!.eventBins.at(-1)).toMatchObject({ key: "missing", missing: true, min: null, max: null, total: 1, selected: 1 });
      expect(all.insights!.density).toHaveLength(all.spans.length * 12);
      expect(all.details.rows.find((r) => r.caseId === row.caseId)!.events).toBeNull();
      expect(all.insights!.fields.find((f) => f.name === "n_events")).toMatchObject({ distinct: 4, missing: { total: 1, selected: 1 }, numeric: { min: 1, max: 5, median: 2, p90: 4.6 } });
      const ranged = await get({ selection: JSON.stringify({ eventRanges: [{ min: 0 }] }) });
      conserved(ranged);
      expect(ranged.summary.cases.selected).toBe(5);
      expect(ids(ranged)).not.toContain(row.caseId);
      const unknown = await get({ selection: JSON.stringify({ eventMissing: true }) });
      conserved(unknown);
      expect(ids(unknown)).toEqual([row.caseId]);
      expect(unknown.summary.events.selected).toBe(0);
      expect(unknown.insights!.fields.find((f) => f.name === "n_events")!.numeric).toEqual({ min: null, max: null, median: null, p90: null });
      const union = await get({ selection: JSON.stringify({ eventMissing: true, eventRanges: [{ min: 1, max: 2 }] }) });
      conserved(union);
      expect(ids(union)).toEqual(["demo-001", "demo-004"]);
    } finally { row.events = before; }
  });

  it("normalizes missing sentinels without conflating literal labels and retains long values in Other", async () => {
    const previous = edaCases.map((row) => row.vendor);
    try {
      ["", "(missing)", "Other categories", "Unknown / missing", "x".repeat(513)].forEach((value, i) => { edaCases[i]!.vendor = value; });
      const all = await get({ attribute: "vendor" });
      conserved(all);
      const facet = all.insights!.facets[0]!;
      expect(facet.categories.find((c) => c.key === "missing")).toMatchObject({ total: 2 });
      expect(facet.categories.find((c) => c.key === "other")).toMatchObject({ total: 1 });
      expect(facet.categories.find((c) => c.value === "Other categories")!.kind).toBe("value");
      expect(facet.categories.find((c) => c.value === "Unknown / missing")!.kind).toBe("value");
      expect(all.insights!.fields.find((f) => f.name === "vendor")).toMatchObject({ distinct: 4, missing: { total: 2, selected: 2 } });
      expect(ids(await get({ attribute: "vendor", selection: JSON.stringify({ facets: [{ field: "vendor", keys: ["missing", "other"] }] }) }))).toEqual(["demo-001", "demo-002", "demo-005"]);
    } finally { edaCases.forEach((row, i) => { row.vendor = previous[i]!; }); }
  });

  it("caps categories at the full-table top twenty, breaks count ties by value, and conserves the tail", async () => {
    // Test-only expansion of the in-memory fixture; the production fixture file remains unchanged.
    const length = edaCases.length;
    try {
      for (let i = 0; i < 24; i++) edaCases.push({ ...edaCases[0]!, caseId: `contract-tail-${i}`, vendor: `Tail ${String(i).padStart(2, "0")}` });
      const all = await get({ attribute: "vendor" });
      conserved(all);
      const facet = all.insights!.facets[0]!;
      expect(facet.categories).toHaveLength(22);
      expect(facet.categories.slice(0, 3).map((c) => c.value)).toEqual(["Vendor A", "Vendor B", "Tail 00"]);
      expect(facet.categories.find((c) => c.key === "other")).toMatchObject({ total: 6 });
      const tail = await get({ attribute: "vendor", selection: JSON.stringify({ facets: [{ field: "vendor", keys: ["other"] }] }) });
      conserved(tail);
      expect(ids(tail)).toEqual(Array.from({ length: 6 }, (_, i) => `contract-tail-${i + 18}`));
      expect(tail.insights!.facets[0]!.categories.map(({ selected: _selected, ...c }) => c)).toEqual(facet.categories.map(({ selected: _selected, ...c }) => c));
    } finally { edaCases.splice(length); }
  });

  it.each([
    { compareAttribute: "unknown" },
    { compareAttribute: "unknown", insight: "false" },
    { selection: JSON.stringify({ facets: [{ field: "unknown", keys: ["v1"] }] }) },
    { selection: JSON.stringify({ facets: [{ field: "vendor", keys: ["v99"] }] }) },
  ])("returns 400 for unknown insight fields or facet keys: %j", async (params) => {
    expect((await request(params)).status).toBe(400);
  });

  it.each([
    { facets: [] }, { eventRanges: [] }, { facets: "vendor" }, { eventRanges: {} },
    { facets: [null] }, { facets: [{ field: "vendor", keys: [] }] },
    { facets: [{ field: "vendor", keys: [1] }] }, { facets: [{ field: "vendor", keys: ["v1"], extra: true }] },
    { facets: [{ field: "vendor", keys: ["v1"] }, { field: "vendor", keys: ["v2"] }] },
    { facets: Array.from({ length: 17 }, (_, i) => ({ field: `field${i}`, keys: ["v1"] })) },
    { facets: [{ field: "vendor", keys: Array(23).fill("v1") }] },
    { eventRanges: Array(12).fill({ min: 0 }) }, { eventRanges: [null] }, { eventRanges: [{}] },
    { eventRanges: [{ min: null, max: null }] }, { eventRanges: [{ min: true }] },
    { eventRanges: [{ min: "1" }] }, { eventRanges: [{ min: -1 }] }, { eventRanges: [{ min: 1.5 }] },
    { eventRanges: [{ min: 2, max: 2 }] }, { eventRanges: [{ min: 3, max: 2 }] }, { eventRanges: [{ min: 0, inclusive: true }] },
    { eventMissing: 1 }, { eventMissing: "true" }, { eventMissing: null }, { spanRanges: [] }, { timeRanges: [{ from: "2018-01-01 garbage" }] },
  ])("rejects malformed new grammar with 422: %j", async (selection) => {
    expect((await request({ selection: JSON.stringify(selection) })).status).toBe(422);
  });

  it("validates int64 boundaries before rounding, unsupported query fields and insight flags", async () => {
    const valid = await get({ selection: '{"eventRanges":[{"min":9223372036854775806,"max":9223372036854775807}]}' });
    expect(valid.summary.cases.selected).toBe(0);
    expect((await get({ selection: '{"eventRanges":[{"min":0,"max":9223372036854775807}]}' })).summary.cases.selected).toBe(6);
    for (const selection of ['{"eventRanges":[{"max":9223372036854775808}]}', '{"eventRanges":[{"min":-9223372036854775809}]}']) expect((await request({ selection })).status).toBe(422);
    for (const params of [{ insight: "maybe" }, { compareAttribute: "" }, { unsupported: "true" }]) expect((await request(params)).status).toBe(422);
  });
});

describe("driver evidence demo contract", () => {
  type Evidence = components["schemas"]["DriverEvidence"];
  const endpoint = `${base}/projects/p2p2018/runs/run_41/driver-evidence`;
  const defaults = { constraintId: "c_l3_invoice_to_clear_days", slicing: "case Vendor", key: '["vendorID_0136"]', view: "Finance" };
  const request = (query: Record<string, string | undefined> = {}, url = endpoint) => fetch(`${url}?${new URLSearchParams({ ...defaults, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`);
  async function measured(query: Record<string, string> = {}) {
    const response = await request(query);
    expect(response.status).toBe(200);
    const body = await response.json() as Evidence;
    const errors: string[] = [];
    validate(body, { $ref: "#/components/schemas/DriverEvidence" }, "$", errors);
    expect(errors).toEqual([]);
    return body;
  }
  it("derives a labelled synthetic population and numerical evidence from actual example events", async () => {
    const answer = await measured();
    expect(answer.source).toMatchObject({ projectId: "p2p2018", runId: "run_41", caseTableId: "ct_1", datasetId: "ds_1", normVersionId: "nv_7", contentHash: "synthetic-six-case-event-fixture-v1" });
    expect(answer.scope).toMatchObject({ runCases: 6, groupCases: 3, selectedCases: 3, selectedEvents: 5, filter: null, filtered: false, key: ["vendorID_0136"], caseNoun: "synthetic example cases" });
    expect(answer.solutionCard!.intent).toContain("not measurements of BPIC");
    expect(answer.duration).toMatchObject({ pairedCases: 2, median: 16.5, p90: 23.3, partitions: { orderedCases: 2, missingEndOnlyCases: 1 } });
    expect(answer.endDayOfMonth!.buckets).toHaveLength(31);
    expect(answer.endDayOfMonth!.buckets.filter(b => b.eventCount)).toMatchObject([{ day: 26, eventCount: 1, caseCount: 1 }, { day: 28, eventCount: 1, caseCount: 1 }]);
    expect(Object.values(answer.duration!.partitions).reduce((a, b) => a + b, 0)).toBe(answer.scope.selectedCases);
  });
  it("intersects supported filters with the exact group and keeps an empty population unavailable", async () => {
    const all = await measured();
    const filter = { and: [{ kind: "open", value: true }] };
    const open = await measured({ filter: JSON.stringify(filter) });
    expect(open.scope).toMatchObject({ filter, filtered: true, selectedCases: 1, selectedEvents: 1, groupCases: 3, runCases: 6 });
    expect(open.scope.fingerprint).not.toBe(all.scope.fingerprint);
    expect(open.duration).toMatchObject({ status: "unavailable", pairedCases: 0, median: null, p90: null });
    expect(open.endDayOfMonth).toMatchObject({ eventCount: 0, topDay: null });
    const empty = await measured({ filter: '{"kind":"attribute","field":"case Vendor","eq":"vendorID_0137"}' });
    expect(empty.scope).toMatchObject({ filter: { and: [{ kind: "attribute", field: "case Vendor", eq: "vendorID_0137" }] }, selectedCases: 0, selectedEvents: 0 });
    expect(empty.status).toBe("unavailable");
    expect(empty.duration!.median).toBeNull();
    expect(empty.endDayOfMonth!.firstTimestamp).toBeNull();
  });
  it.each([
    { filter: "" }, { filter: "{" }, { filter: '{"and":[{"kind":"unknown"}]}' },
    { filter: '{"and":[{"kind":"open","value":true,"ignored":true}]}' },
    { filter: '{"and":[{"kind":"attribute","field":"unknown","eq":"x"}]}' },
    { slicing: "not_registered" }, { key: '["unknown-vendor"]' }, { key: '["vendorID_0136","extra"]' },
    { view: "not_registered" }, { constraintId: "another-constraint" }, { within: "another-group" }, { bands: "[]" },
  ])("explicitly refuses unsupported or malformed selection %j", async query => {
    const response = await request(query);
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).not.toHaveProperty("scope");
  });
  it("does not serve another project, run or saved cohort under the requested identity", async () => {
    expect((await request({}, endpoint.replace("p2p2018", "o2c"))).status).toBe(404);
    expect((await request({}, endpoint.replace("run_41", "unknown"))).status).toBe(404);
    expect((await request({}, endpoint.replace("run_41", "run_38"))).status).toBe(422);
    db.runs.find(r => r.id === "run_41")!.scope = { flow_type: "DF2", attribute: "flow_type" };
    expect((await request()).status).toBe(422);
  });
});
