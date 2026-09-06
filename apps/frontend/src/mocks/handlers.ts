import { http, HttpResponse, delay } from "msw";
import type { BacklogRow, ColumnMapping, HotspotType, Kind, NormVersionCreate, Preset, RunCreate } from "@wise/api-schema";
import { pageBacklog } from "./fixtures/backlog";
import { buildDistribution } from "./fixtures/distribution";
import { buildFlow } from "./fixtures/flow";
import { bpic19Norm } from "./fixtures/norm";
import { buildSlice } from "./fixtures/slice";
import { buildTrace } from "./fixtures/trace";
import { advanceJob, backlogFor, cancelJob, createJob, db, newCaseTable, nextId, summaryFor } from "./db";

const API = "*/api/v1";

/** Small latency so loading states are visible; zero in tests. */
export let latency = import.meta.env?.MODE === "test" ? 0 : 120;
export function setLatency(ms: number) {
  latency = ms;
}

function problem(status: number, title: string, detail?: string, code?: string) {
  return HttpResponse.json({ type: code ? `urn:wise-workbench:problem:${code}` : "about:blank", title, status, detail, code, errors: [] }, { status, headers: { "Content-Type": "application/problem+json" } });
}

const num = (v: string | null, fallback: number) => (v === null || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

function runOr404(runId: string) {
  return db.runs.find((r) => r.id === runId);
}

/** The BPIC 2019 preset as the backend describes it (`GET /datasets/presets`). */
const BPIC_MAPPING: ColumnMapping = {
  caseId: "case concept:name",
  activity: "event concept:name",
  timestamp: "event time:timestamp",
  timestampFormat: "%d-%m-%Y %H:%M:%S.%f",
  dayfirst: true,
  resource: "event org:resource",
  order: "eventID",
  eventId: "eventID",
  caseAttributes: ["case Company", "case Spend area text", "case Vendor", "case Item Type", "case Purchasing Document", "case Document Type", "case Item Category"],
  exposure: "event Cumulative net worth (EUR)",
  exposureAgg: "max",
  exposureAbs: true,
  headerEvents: ["Create Purchase Order Item", "Vendor creates invoice", "Record Invoice Receipt", "Clear Invoice", "Remove Payment Block"],
  closureActivities: ["Clear Invoice"],
  flowTyping: [
    { name: "DF1", rule: { attr: "case Item Category", eq: "3-way match, invoice after GR" } },
    { name: "DF2", rule: { attr: "case Item Category", eq: "3-way match, invoice before GR" } },
    { name: "2-way", rule: { attr: "case Item Category", eq: "2-way match" } },
    { name: "Consignment", rule: { attr: "case Item Category", eq: "Consignment" } },
  ],
  flowTypeDefault: "other",
  note: "BPI Challenge 2019 preset",
};

export const presets: Preset[] = [
  {
    id: "bpic2019",
    name: "BPI Challenge 2019 (purchase-to-pay)",
    description: "251,734 purchase order items and 1,595,923 events; the paper's norm with 29 expectations in seven areas; groups by company × spend area in the Automation perspective with γ = 20.",
    available: true,
    source: "~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv",
    norm: "~/code/PhD/WISE/wise-lib/examples/bpic19_norm.json",
    mapping: BPIC_MAPPING,
    slicing: ["case Company", "case Spend area text"],
    view: "Automation",
    gamma: 20,
    minCases: 1,
    process: "p2p",
  },
];

/** The backend's column-name heuristics, for the mapping screen's prefill. */
function suggestMapping(columns: string[]): { mapping: ColumnMapping; source: "bpic2019" | "pm4py" | "heuristic"; notes: string[] } {
  const have = new Set(columns);
  if (have.has("case concept:name") && have.has("event concept:name") && have.has("event time:timestamp")) {
    return { mapping: { ...BPIC_MAPPING, caseAttributes: BPIC_MAPPING.caseAttributes?.filter((a) => have.has(a)) }, source: "bpic2019", notes: ["Column names match the BPI Challenge 2019 export."] };
  }
  if (have.has("case:concept:name") && have.has("concept:name") && have.has("time:timestamp")) {
    return { mapping: { caseId: "case:concept:name", activity: "concept:name", timestamp: "time:timestamp" }, source: "pm4py", notes: ["Column names follow the XES / pm4py convention."] };
  }
  const pick = (patterns: RegExp[], taken: Set<string>) => {
    for (const p of patterns) {
      const hit = columns.find((c) => !taken.has(c) && p.test(c));
      if (hit) return hit;
    }
    return "";
  };
  const taken = new Set<string>();
  const caseId = pick([/^case[_ ]?id$/i, /^case$/i, /case.?id/i, /^case /i], taken);
  taken.add(caseId);
  const activity = pick([/^activity$/i, /activity/i, /^event$/i], taken);
  taken.add(activity);
  const timestamp = pick([/^timestamp$/i, /timestamp/i, /^time$/i, /time/i], taken);
  taken.add(timestamp);
  const resource = pick([/^resource$/i, /resource/i, /user/i], taken);
  if (resource) taken.add(resource);
  const notes = [caseId ? "" : "no column looks like the caseId; choose one", activity ? "" : "no column looks like the activity; choose one", timestamp ? "" : "no column looks like the timestamp; choose one"].filter(Boolean);
  return { mapping: { caseId, activity, timestamp, ...(resource ? { resource } : {}), caseAttributes: columns.filter((c) => !taken.has(c)).slice(0, 8) }, source: "heuristic", notes: notes.length ? notes : ["Guessed from column names; check every role."] };
}

const KIND_FILTER = (v: string | null): Kind | undefined => (v === "acute" || v === "systematic" || v === "widespread" ? v : undefined);

export const handlers = [
  http.get(`${API}/system/health`, () => HttpResponse.json({ status: "ok", workspace: "mock", inprocessWorker: true })),
  http.get(`${API}/system/ready`, () => HttpResponse.json({ status: "ready", database: "ok", workspaceWritable: true })),
  http.get(`${API}/system/version`, () => HttpResponse.json({ workbench: "0.1.0-mock", wise: "0.1.0", duckdb: "1.5.5" })),

  http.get(`${API}/projects`, async () => {
    await delay(latency);
    return HttpResponse.json(db.projects);
  }),
  http.post(`${API}/projects`, async ({ request }) => {
    const body = (await request.json()) as { name: string; process?: string; question?: string };
    const project = { ...body, id: `p_${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
    db.projects.push(project);
    return HttpResponse.json(project, { status: 201 });
  }),
  http.get(`${API}/projects/:projectId`, async ({ params }) => {
    await delay(latency);
    const p = db.projects.find((x) => x.id === params.projectId);
    return p ? HttpResponse.json(p) : problem(404, "Not Found", `No project ${String(params.projectId)}`, "project.not_found");
  }),

  http.get(`${API}/projects/:projectId/datasets`, async () => {
    await delay(latency);
    return HttpResponse.json(db.datasets);
  }),
  http.post(`${API}/projects/:projectId/datasets`, async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file");
    const name = (form.get("name") as string | null) || (file instanceof File ? file.name : "upload.csv");
    const id = nextId("dataset", "ds");
    db.datasets.unshift({ id, name, status: "ingesting", createdAt: new Date().toISOString(), sourceKind: "csv", events: file instanceof File ? Math.max(1000, Math.round(file.size / 96)) : undefined });
    const job = createJob("ingest", `ingesting ${name}`, { kind: "dataset", id });
    return HttpResponse.json({ ...job, resultRef: `dataset:${id}` }, { status: 202 });
  }),
  http.get(`${API}/projects/:projectId/datasets/presets`, async () => {
    await delay(latency);
    return HttpResponse.json(presets);
  }),
  http.post(`${API}/projects/:projectId/datasets/presets/:presetId`, async ({ params }) => {
    const preset = presets.find((p) => p.id === params.presetId);
    if (!preset) return problem(404, "Not Found", `unknown preset ${String(params.presetId)}`, "preset.not_found");
    const done = db.runs.find((r) => r.status === "done");
    const job = createJob("load_preset", "hashing the log file", done ? { kind: "run", id: done.id } : undefined, 0.15);
    return HttpResponse.json(job, { status: 202 });
  }),
  http.get(`${API}/projects/:projectId/datasets/:datasetId`, async ({ params }) => {
    await delay(latency);
    const ds = db.datasets.find((d) => d.id === params.datasetId);
    return ds ? HttpResponse.json(ds) : problem(404, "Not Found", "dataset not found", "dataset.not_found");
  }),
  http.get(`${API}/projects/:projectId/datasets/:datasetId/preview`, async ({ params, request }) => {
    await delay(latency);
    const ds = db.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return problem(404, "Not Found", "dataset not found", "dataset.not_found");
    const rows = num(new URL(request.url).searchParams.get("rows"), 50);
    const columns = (ds.columns ?? []).map((c) => c.name);
    return HttpResponse.json({ columns, rows: Array.from({ length: Math.min(rows, 5) }, (_, i) => (ds.columns ?? []).map((c) => c.sample?.[i % Math.max(1, c.sample.length)] ?? null)) });
  }),
  http.get(`${API}/projects/:projectId/datasets/:datasetId/mapping-suggestion`, async ({ params }) => {
    await delay(latency);
    const ds = db.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return problem(404, "Not Found", "dataset not found", "dataset.not_found");
    if (ds.status !== "ready") return problem(422, "Unprocessable Content", `dataset ${ds.id} is ${ds.status}`, "dataset.not_ready");
    return HttpResponse.json(suggestMapping((ds.columns ?? []).map((c) => c.name)));
  }),
  http.get(`${API}/projects/:projectId/datasets/:datasetId/mappings`, async ({ params }) => {
    await delay(latency);
    const tables = db.caseTables.filter((c) => c.datasetId === params.datasetId);
    return HttpResponse.json(tables.map((t) => ({ ...BPIC_MAPPING, id: t.mappingId ?? "map_2", datasetId: t.datasetId, createdAt: t.createdAt })));
  }),
  http.post(`${API}/projects/:projectId/datasets/:datasetId/mappings`, async ({ params, request }) => {
    const mapping = (await request.json()) as ColumnMapping;
    const missing = (["caseId", "activity", "timestamp"] as const).filter((k) => !mapping[k]);
    if (missing.length) return problem(422, "Unprocessable Content", `mapping is incomplete: ${missing.join(", ")}`, "mapping.incomplete");
    const ct = newCaseTable(String(params.datasetId), `map_${db.caseTables.length + 1}`, mapping.headerEvents ?? []);
    const job = createJob("build_cases", `mapping ${ct.mappingId} validated on 200,000 events; building the case table`, { kind: "caseTable", id: ct.id }, 0.2);
    return HttpResponse.json({ ...job, resultRef: `case_table:${ct.id}` }, { status: 202 });
  }),
  http.get(`${API}/projects/:projectId/case-tables`, async () => {
    await delay(latency);
    return HttpResponse.json(db.caseTables);
  }),
  http.get(`${API}/projects/:projectId/case-tables/:caseTableId`, async ({ params }) => {
    await delay(latency);
    const ct = db.caseTables.find((c) => c.id === params.caseTableId);
    return ct ? HttpResponse.json(ct) : problem(404, "Not Found", "case table not found", "case_table.not_found");
  }),
  http.get(`${API}/projects/:projectId/case-tables/:caseTableId/mapping`, async ({ params }) => {
    await delay(latency);
    const ct = db.caseTables.find((c) => c.id === params.caseTableId);
    if (!ct) return problem(404, "Not Found", "case table not found", "case_table.not_found");
    return HttpResponse.json({ ...BPIC_MAPPING, id: ct.mappingId ?? "map_2", datasetId: ct.datasetId, createdAt: ct.createdAt });
  }),

  http.get(`${API}/projects/:projectId/norms`, async () => {
    await delay(latency);
    return HttpResponse.json(db.norms);
  }),
  http.post(`${API}/projects/:projectId/norms`, async ({ request }) => {
    const body = (await request.json()) as NormVersionCreate;
    if (!body.note || !body.note.trim()) return problem(422, "Unprocessable Content", "A norm version needs a one-line note.", "norm.note");
    const parent = db.norms.find((n) => n.id === body.parentId);
    const version = Math.max(0, ...db.norms.map((n) => n.version)) + 1;
    const id = nextId("norm", "nv");
    const doc = body.norm as { name?: string; views?: { name: string }[] };
    const created = {
      id,
      version,
      fingerprint: `${(Date.now() % 0xffffffff).toString(16).padStart(8, "0")}${version.toString(16).padStart(8, "0")}`.padEnd(64, "0"),
      status: "draft" as const,
      note: body.note,
      author: body.author ?? "u.jessen",
      parentId: parent?.id,
      norm: body.norm,
      validation: [],
      createdAt: new Date().toISOString(),
      normId: parent?.normId ?? `norm_${id}`,
      name: doc.name ?? "norm",
      views: (doc.views ?? []).map((v) => v.name),
    };
    db.norms.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(`${API}/projects/:projectId/norms/:normVersionId`, async ({ params }) => {
    await delay(latency);
    const n = db.norms.find((x) => x.id === params.normVersionId);
    return n ? HttpResponse.json(n) : problem(404, "Not Found", "norm version not found", "norm.not_found");
  }),
  http.patch(`${API}/projects/:projectId/norms/:normVersionId`, async ({ params, request }) => {
    const n = db.norms.find((x) => x.id === params.normVersionId);
    if (!n) return problem(404, "Not Found", "norm version not found", "norm.not_found");
    const body = (await request.json()) as { status: "draft" | "reviewed" | "approved" };
    if (n.status === "approved" && body.status !== "approved") return problem(409, "Conflict", "an approved version stays approved", "norm.transition");
    n.status = body.status;
    return HttpResponse.json(n);
  }),
  http.post(`${API}/projects/:projectId/norms/:normVersionId/check`, async () => {
    await delay(latency);
    return HttpResponse.json({
      constraints: bpic19Norm.constraints.map((c, i) => ({ id: c.id, layer: c.layer, type: c.type, activitiesMissing: i === 11 ? ["Change Approval for Purchase Order"] : [], casesInScope: 251734 - i * 3000, casesEvaluated: 251734 - i * 3000 - (i % 3) * 1200 })),
      issues: [],
      cases: 251734,
      fingerprint: db.norms[2]?.fingerprint,
    });
  }),

  http.get(`${API}/projects/:projectId/runs`, async () => {
    await delay(latency);
    return HttpResponse.json(db.runs);
  }),
  http.post(`${API}/projects/:projectId/runs`, async ({ request }) => {
    const body = (await request.json()) as RunCreate;
    if (!body.caseTableId || !body.normVersionId) return problem(422, "Unprocessable Content", "caseTableId and normVersionId are required.", "run.incomplete");
    const id = nextId("run", "run");
    const job = createJob("score_run", "loading the event log", { kind: "run", id }, 0.2);
    const norm = db.norms.find((n) => n.id === body.normVersionId);
    const slicings = (body.slicings?.length ? body.slicings : [{ attributes: ["case Vendor"] }]).map((s) => ({ id: s.id || s.attributes.join("+"), attributes: s.attributes }));
    const run = {
      ...body,
      views: body.views?.length ? body.views : norm?.views ?? ["Finance", "Logistics", "Compliance", "Automation"],
      slicings,
      gamma: body.gamma ?? 50,
      minCases: body.minCases ?? 20,
      id,
      status: "queued" as const,
      jobId: job.id,
      paramsHash: (Math.random() * 0xffffffff >>> 0).toString(16).padStart(64, "0"),
      createdAt: new Date().toISOString(),
      manifest: { normFingerprint: norm?.fingerprint, contentHash: "51ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b64", mappingId: "map_2", wiseVersion: "0.1.0", startedAt: new Date().toISOString(), views: body.views ?? [], slicings },
      links: { self: `/api/v1/projects/p2p2018/runs/${id}`, summary: `/api/v1/projects/p2p2018/runs/${id}/summary` },
    };
    db.runs.push(run);
    return HttpResponse.json(run, { status: 202 });
  }),
  http.get(`${API}/projects/:projectId/runs/:runId`, async ({ params }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    return run ? HttpResponse.json(run) : problem(404, "Not Found", "run not found", "run.not_found");
  }),
  http.post(`${API}/projects/:projectId/runs/:runId/cancel`, async ({ params }) => {
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const job = run.jobId ? db.jobs.get(run.jobId) : undefined;
    if (job) cancelJob(job);
    if (run.status === "queued") run.status = "cancelled";
    return HttpResponse.json(run);
  }),
  http.get(`${API}/projects/:projectId/runs/:runId/summary`, async ({ params }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    return run ? HttpResponse.json(summaryFor(run.id)) : problem(404, "Not Found", "run not found", "run.not_found");
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/backlog`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    if (run.status !== "done") return problem(409, "Conflict", `run ${run.id} is ${run.status}; results are available once it is done`, "run.not_done");
    const u = new URL(request.url);
    const slicing = u.searchParams.get("slicing");
    if (!slicing) return problem(422, "Unprocessable Content", "slicing must name at least one case attribute", "backlog.slicing");
    const known = run.slicings?.some((s) => s.id === slicing) || slicing.split(",").every((a) => a.trim().length > 0);
    if (!known) return problem(422, "Unprocessable Content", `unknown slice attributes ${slicing}`, "backlog.attribute");
    const view = u.searchParams.get("view") || run.views?.[0] || "Finance";
    if (!run.views?.includes(view)) return problem(422, "Unprocessable Content", `view ${view} is not part of this run; available: ${run.views?.join(", ")}`, "backlog.view");
    const gamma = num(u.searchParams.get("gamma"), run.gamma ?? 50);
    const minCases = num(u.searchParams.get("minCases"), 20);
    const { rows, globalMean } = backlogFor(run.id, slicing, view, gamma, minCases);
    const page = pageBacklog(rows, globalMean, {
      slicing,
      view,
      gamma,
      minCases,
      sort: u.searchParams.get("sort") || "-PI",
      hotspotType: (u.searchParams.get("hotspotType") as HotspotType | null) ?? undefined,
      kind: KIND_FILTER(u.searchParams.get("kind")),
      layer: u.searchParams.get("layer") ?? undefined,
      q: u.searchParams.get("q") ?? undefined,
      page: Math.max(1, num(u.searchParams.get("page"), 1)),
      pageSize: Math.min(500, Math.max(1, num(u.searchParams.get("pageSize"), 50))),
    });
    return HttpResponse.json(page);
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/slices/:sliceKey`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const u = new URL(request.url);
    const slicing = u.searchParams.get("slicing");
    if (!slicing) return problem(422, "Unprocessable Content", "slicing is required", "backlog.slicing");
    const view = u.searchParams.get("view") || run.views?.[0] || "Finance";
    const { rows, globalMean } = backlogFor(run.id, slicing, view, run.gamma ?? 50, 1);
    // the key is a JSON array (URL-encoded in the path); a bare value is accepted for single-attribute slicings
    const raw = String(params.sliceKey);
    let key = raw;
    try {
      key = decodeURIComponent(raw);
    } catch {
      key = raw;
    }
    if (!key.startsWith("[")) key = JSON.stringify([key]);
    const row: BacklogRow | undefined = rows.find((r) => r.key === key);
    if (!row) return problem(404, "Not Found", `slice ${key} not found in slicing ${slicing}`, "slice.not_found");
    return HttpResponse.json(buildSlice(row, slicing, view, globalMean));
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/cases/:caseId/trace`, async ({ params, request }) => {
    await delay(latency);
    const u = new URL(request.url);
    const violated = u.searchParams.get("violated")?.split(",").filter(Boolean) ?? [];
    return HttpResponse.json(buildTrace(String(params.caseId), violated));
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/diagnostics`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const slicing = new URL(request.url).searchParams.get("slicing") || "case Vendor";
    const { rows } = backlogFor(run.id, slicing, run.views?.[0] ?? "Finance", run.gamma ?? 50, run.minCases ?? 20);
    const attributes = slicing.split("+");
    return HttpResponse.json({
      columns: [...attributes, "n_cases", "stable_gap", "stable_PI", "censored_share", "replicated_share", "retained", "reading"],
      rows: rows.slice(0, 30).map((r) => [...attributes.map((a) => r.keys?.[a] ?? ""), r.n_cases, r.stable_gap, r.stable_PI, 0.06, 0.2, 0.9, "stable signal"]),
    });
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/signals/:constraintId`, async ({ params, request }) => {
    await delay(latency);
    const u = new URL(request.url);
    const sliceKey = u.searchParams.get("sliceKey") ?? undefined;
    if (!bpic19Norm.constraints.some((c) => c.id === params.constraintId)) return problem(404, "Not Found", "constraint not found", "constraint.not_found");
    return HttpResponse.json(buildDistribution(String(params.constraintId), sliceKey));
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/flow`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const u = new URL(request.url);
    return HttpResponse.json(buildFlow({ slicing: u.searchParams.get("slicing") ?? undefined, sliceKey: u.searchParams.get("sliceKey") ?? undefined, abstraction: num(u.searchParams.get("abstraction"), 0.05) }));
  }),

  http.get(`${API}/jobs`, async ({ request }) => {
    const u = new URL(request.url);
    const state = u.searchParams.get("state");
    const list = [...db.jobs.values()].filter((j) => !state || j.status === state).map(({ effect: _e, step: _s, ...dto }) => dto);
    return HttpResponse.json(list);
  }),
  http.get(`${API}/jobs/:jobId`, async ({ params }) => {
    const job = db.jobs.get(String(params.jobId));
    if (!job) return problem(404, "Not Found", "job not found", "job.not_found");
    await delay(latency ? 60 : 0);
    const { effect: _e, step: _s, ...dto } = advanceJob(job);
    return HttpResponse.json(dto);
  }),
  http.delete(`${API}/jobs/:jobId`, ({ params }) => {
    const job = db.jobs.get(String(params.jobId));
    if (!job) return problem(404, "Not Found", "job not found", "job.not_found");
    cancelJob(job);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${API}/jobs/:jobId/events`, ({ params }) => {
    const job = db.jobs.get(String(params.jobId));
    if (!job) return problem(404, "Not Found", "job not found", "job.not_found");
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("retry: 2000\n\n"));
        const tick = () => {
          const { effect: _e, step: _s, ...dto } = advanceJob(job);
          controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(dto)}\n\n`));
          if (dto.status === "queued" || dto.status === "running") setTimeout(tick, 400);
          else {
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(dto)}\n\n`));
            controller.close();
          }
        };
        tick();
      },
    });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }),
];
