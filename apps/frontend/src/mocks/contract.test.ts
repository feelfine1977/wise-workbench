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
  sliceKey: encodeURIComponent('["vendorID_0128"]'),
  caseId: "4507012345_00010",
  constraintId: "c_l3_invoice_to_clear_days",
  jobId: "job_41",
  presetId: "bpic2019",
};
const query: Record<string, string> = {
  "/projects/{projectId}/runs/{runId}/backlog": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/slices/{sliceKey}": `?slicing=${encodeURIComponent("case Vendor")}&view=Finance`,
  "/projects/{projectId}/runs/{runId}/diagnostics": `?slicing=${encodeURIComponent("case Vendor")}`,
};
const bodies: Record<string, unknown> = {
  "post /projects": { name: "New project", process: "p2p" },
  "post /projects/{projectId}/datasets/{datasetId}/mappings": { caseId: "case concept:name", activity: "event concept:name", timestamp: "event time:timestamp", headerEvents: ["Vendor creates invoice"] },
  "post /projects/{projectId}/norms": { norm: db.norms[2]?.norm, note: "contract test", parentId: "nv_7" },
  "patch /projects/{projectId}/norms/{normVersionId}": { status: "approved" },
  "post /projects/{projectId}/norms/{normVersionId}/check": { caseTableId: "ct_1" },
  "post /projects/{projectId}/runs": { caseTableId: "ct_1", normVersionId: "nv_7", gamma: 50, slicings: [{ attributes: ["case Vendor"] }] },
};

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
      let init: RequestInit = { method: method.toUpperCase() };
      if (key === "post /projects/{projectId}/datasets") {
        const form = new FormData();
        form.append("file", new File(["case,activity,time\n1,a,2018-01-01"], "log.csv", { type: "text/csv" }));
        init = { ...init, body: form };
      } else if (bodies[key]) {
        init = { ...init, body: JSON.stringify(bodies[key]), headers: { "Content-Type": "application/json" } };
      }
      const res = await fetch(`${base}${fill(path)}${query[path] ?? ""}`, init);
      const expected = Object.keys(op.responses ?? {}).filter((c) => c.startsWith("2"));
      expect(expected, "2xx documented").not.toHaveLength(0);
      expect(expected).toContain(String(res.status));
      const schema = op.responses?.[String(res.status)]?.content?.["application/json"]?.schema as Schema | undefined;
      if (schema) {
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
    const page = (await (await fetch(`${base}/projects/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&gamma=20&minCases=1`)).json()) as { rows: { key: string; keys: Record<string, string>; kind?: string; reading?: string }[]; maxStablePI: number };
    expect(page.rows[0]?.key).toBe('["companyID_0000","Packaging"]');
    expect(page.rows[0]?.keys).toEqual({ "case Company": "companyID_0000", "case Spend area text": "Packaging" });
    expect(page.rows[0]?.kind).toBe("widespread");
    expect(page.rows[0]?.reading).toMatch(/^companyID_0000 × Packaging: 109,199 cases, 0\.9 % below expectation on average; widespread: many cases, slightly off;/);
    expect(page.maxStablePI).toBeCloseTo(945.7, 1);
    const detail = await fetch(`${base}/projects/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000","Packaging"]')}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`);
    expect(detail.status).toBe(200);
  });

  it("answers with RFC 9457 problems on unknown ids and missing parameters", async () => {
    const missing = await fetch(`${base}/projects/p2p2018/runs/run_41/backlog`);
    expect(missing.status).toBe(422);
    expect(missing.headers.get("content-type")).toContain("application/problem+json");
    const gone = await fetch(`${base}/projects/p2p2018/runs/nope`);
    expect(gone.status).toBe(404);
  });
});
