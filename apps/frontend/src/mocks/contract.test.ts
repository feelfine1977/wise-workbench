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
  "/projects/{projectId}/runs/{runId}/backlog": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/slices/{sliceKey}": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/diagnostics": `?slicing=${encodeURIComponent("case Vendor")}`,
  "/projects/{projectId}/runs/{runId}/slicings/preview": `?slicing=${encodeURIComponent("case Vendor,exposure")}&bands=${encodeURIComponent(JSON.stringify([{ attribute: "exposure", method: "quantile", q: 4 }]))}`,
  "/projects/{projectId}/runs/{runId}/filters/preview": `?filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "activity", op: "contains", activity: "Remove Payment Block" }] }))}`,
  "/projects/{projectId}/runs/{runId}/flow": "?focus=a_record_goods_receipt",
  "/projects/{projectId}/decisions": "?caseTableId=ct_1",
  "/projects/{projectId}/runs/{runId}/gates": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/gates/{gateId}": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/what-can-we-do": `?slicing=${encodeURIComponent("case Vendor")}&key=${encodeURIComponent('["vendorID_0136"]')}&view=Finance`,
  "/projects/{projectId}/norms/inventory": "?caseTableId=ct_1",
  "/projects/{projectId}/norms/applicability": "?caseTableId=ct_1",
  "/projects/{projectId}/runs/{runId}/facets": `?by=flow_type&view=Automation`,
  "/projects/{projectId}/runs/{runId}/kpis": `?view=Automation&grouping=${encodeURIComponent("case Company+case Spend area text")}`,
};
const bodies: Record<string, unknown> = {
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
