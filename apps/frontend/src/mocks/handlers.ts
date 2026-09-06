import { http, HttpResponse, delay } from "msw";
import type { BacklogRow, ColumnMapping, HotspotType, Kind, NormVersionCreate, Preset, RunCreate, Stability } from "@wise/api-schema";
import type { DecisionRequest, Snapshot, SnapshotContext, Within } from "@/lib/api/cycle2";
import { parseFilter } from "@/lib/filter";
import { pageBacklog } from "./fixtures/backlog";
import { applyFilter, backlogParamsC2, compareFlowTypesFor, decisionKinds, decisionPreviewFor, decisionRecord, drillInto, enrichRow, filterKeepShare, filterPreviewFor, flowTypesFor, readinessAfterDecision, sliceC2, slicingPreviewFor } from "./fixtures/cycle2";
import { buildDistribution } from "./fixtures/distribution";
import { buildFlow } from "./fixtures/flow";
import { bpic19Norm } from "./fixtures/norm";
import { buildSlice } from "./fixtures/slice";
import { buildTrace } from "./fixtures/trace";
import { VERIFIED_CASE_NOUN, VERIFIED_PACKAGING_KEY, verifiedAnalytics, verifiedDistributionPackaging, verifiedFlowAll, verifiedFlowFocusedOnGoodsReceipt, verifiedFlowPackaging, verifiedSlice } from "./fixtures/verified";
import { advanceJob, backlogFor, cancelJob, createJob, db, newCaseTable, newRun, nextId, summaryFor, type MockSnapshot } from "./db";

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

/** JSON-array slice keys compare by value, not by spacing. */
const canonical = (k: string) => {
  try {
    return JSON.stringify(JSON.parse(k));
  } catch {
    return k;
  }
};

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
  caseNoun: VERIFIED_CASE_NOUN,
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
const STABILITIES: Stability[] = ["stable", "fragile", "insufficient_support", "unknown"];

const snapshotDto = ({ image: _i, ...s }: MockSnapshot): Snapshot => s;
/** Form parts are files from the runtime's own FormData (undici in Node, the browser's in the app); duck-typed, not `instanceof Blob`. */
const isBlob = (v: unknown): v is Blob => !!v && typeof v === "object" && typeof (v as Blob).arrayBuffer === "function";

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

  // ---------------------------------------------------------------- flow types of a case table (R2-O10)
  http.get(`${API}/projects/:projectId/case-tables/:caseTableId/flow-types`, async ({ params }) => {
    await delay(latency);
    const ct = db.caseTables.find((c) => c.id === params.caseTableId);
    if (!ct) return problem(404, "Not Found", "case table not found", "case_table.not_found");
    return HttpResponse.json(flowTypesFor(ct.id));
  }),

  // ---------------------------------------------------------------- readiness decisions (R2-O1)
  http.get(`${API}/projects/:projectId/decisions/kinds`, async () => {
    await delay(latency);
    return HttpResponse.json(decisionKinds());
  }),
  http.get(`${API}/projects/:projectId/decisions`, async ({ request }) => {
    await delay(latency);
    const ct = new URL(request.url).searchParams.get("caseTableId");
    return HttpResponse.json(db.decisions.filter((d) => !ct || d.caseTableId === ct || d.resultCaseTableId === ct));
  }),
  http.post(`${API}/projects/:projectId/case-tables/:caseTableId/decisions/preview`, async ({ params, request }) => {
    await delay(latency);
    const ct = db.caseTables.find((c) => c.id === params.caseTableId);
    if (!ct) return problem(404, "Not Found", "case table not found", "case_table.not_found");
    const body = (await request.json()) as DecisionRequest;
    const preview = decisionPreviewFor(body.kind, body.params ?? {}, ct.readiness, ct.id, db.decisions.filter((d) => d.caseTableId === ct.id).length + 1);
    if (!preview) return problem(422, "Unprocessable Content", `unknown decision kind ${String(body.kind)}`, "decision.kind");
    return HttpResponse.json(preview);
  }),
  http.post(`${API}/projects/:projectId/case-tables/:caseTableId/decisions`, async ({ params, request }) => {
    const ct = db.caseTables.find((c) => c.id === params.caseTableId);
    if (!ct) return problem(404, "Not Found", "case table not found", "case_table.not_found");
    const body = (await request.json()) as DecisionRequest;
    const preview = decisionPreviewFor(body.kind, body.params ?? {}, ct.readiness, ct.id, db.decisions.filter((d) => d.caseTableId === ct.id).length + 1);
    if (!preview) return problem(422, "Unprocessable Content", `unknown decision kind ${String(body.kind)}`, "decision.kind");
    // the decision is a versioned mapping decision: a child mapping, a new case table built from it (job)
    const next = newCaseTable(ct.datasetId, `${ct.mappingId ?? "map_2"}.${preview.version}`, []);
    next.readiness = readinessAfterDecision(ct.readiness ?? { status: "warn", items: [] }, body.kind, preview);
    const numbers = preview.preview as { cases: number; events: number };
    next.cases = body.kind === "open_cases" && body.params?.handling === "exclude" ? ct.cases - numbers.cases : ct.cases;
    next.events = (ct.events ?? 0) - (body.kind === "drop_outside_window" || body.kind === "collapse_duplicates" ? numbers.events : 0);
    const job = createJob("apply_decision", `applying ${preview.label.toLowerCase()}`, { kind: "caseTable", id: next.id }, 0.34);
    const decision = decisionRecord(nextId("decision", "dec"), ct, next, preview, body);
    db.decisions.push(decision);
    return HttpResponse.json({ decision, caseTable: next, job }, { status: 202 });
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
    const run = newRun({ ...body, scope: body.scope ?? undefined });
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
    const known = run.slicings?.some((s) => s.id === slicing) || slicing.split(/[+,]/).every((a) => a.trim().length > 0);
    if (!known) return problem(422, "Unprocessable Content", `unknown slice attributes ${slicing}`, "backlog.attribute");
    const view = u.searchParams.get("view") || run.views?.[0] || "Finance";
    if (!run.views?.includes(view)) return problem(422, "Unprocessable Content", `view ${view} is not part of this run; available: ${run.views?.join(", ")}`, "backlog.view");
    const gamma = num(u.searchParams.get("gamma"), run.gamma ?? 20);
    const minCases = num(u.searchParams.get("minCases"), 20);
    const filter = parseFilter(u.searchParams.get("filter"));
    const drillFrom = u.searchParams.get("drillFrom");
    const drillKey = u.searchParams.get("drillKey");
    const source = backlogFor(run.id, slicing, view, gamma, minCases);
    let rows = source.rows;
    let illustrative = source.illustrative;
    let attributes: string[] | undefined;
    let drill: { slicing: string; attributes: string[]; key: unknown[] } | null = null;
    let cases: number | null = null;
    if (drillFrom && drillKey) {
      // drill into one group (R2-O2): the finer slicing restricted to the group's cases
      const parentSource = backlogFor(run.id, drillFrom, view, gamma, 1);
      const parent = parentSource.rows.find((r) => canonical(r.key) === canonical(drillKey));
      if (!parent) return problem(404, "Not Found", `group ${drillKey} not found in ${drillFrom}`, "slice.not_found");
      const detail = verifiedSlice(parent.key, view) ?? buildSlice(parent, drillFrom, view, parentSource.globalMean);
      const within: Within = { slicing: drillFrom, key: parent.key };
      const drilled = drillInto(parent, within, detail, gamma, view);
      rows = drilled.rows.filter((r) => r.n_cases >= minCases);
      attributes = drilled.attributes;
      illustrative = drilled.illustrative;
      drill = { slicing: drillFrom, attributes: Object.keys(parent.keys ?? {}), key: JSON.parse(parent.key) as unknown[] };
      cases = parent.n_cases;
    }
    rows = applyFilter(rows, filter, gamma);
    if (filter) cases = Math.round((cases ?? summaryFor(run.id).cases ?? 251734) * filterKeepShare(filter));
    const stability = u.searchParams.get("stability");
    if (stability && STABILITIES.includes(stability as Stability)) rows = rows.filter((r) => (r.stability ?? "unknown") === stability);
    const page = pageBacklog(rows, source.globalMean, {
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
    const unfiltered = !filter && !drill && !stability && !u.searchParams.get("kind") && !u.searchParams.get("hotspotType") && !u.searchParams.get("layer") && !u.searchParams.get("q");
    return HttpResponse.json({
      ...page,
      rows: page.rows.map((r) => enrichRow(r, view, illustrative)),
      total: unfiltered && source.total ? source.total : page.total,
      params: { ...page.params, ...(attributes ? { attributes } : {}), bands: [], ...backlogParamsC2(illustrative, { gamma, filter: filter ?? null, drill, scope: run.scope ?? null, cases }) },
    });
  }),
  http.get(`${API}/projects/:projectId/runs/:runId/slicings/preview`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const u = new URL(request.url);
    const slicing = u.searchParams.get("slicing") ?? "";
    if (!slicing) return problem(422, "Unprocessable Content", "slicing is required", "backlog.slicing");
    let bands: { attribute: string; method?: string; q?: number | null; cuts?: number[] | null }[] | undefined;
    const raw = u.searchParams.get("bands");
    if (raw) {
      try {
        bands = JSON.parse(raw) as typeof bands;
      } catch {
        return problem(422, "Unprocessable Content", "bands must be a JSON list", "run.bands");
      }
    }
    const attributes = slicing.split(/[+,]/).map((a) => a.trim()).filter(Boolean);
    const bad = (bands ?? []).find((b) => !attributes.includes(b.attribute));
    if (bad) return problem(422, "Unprocessable Content", `band attribute '${bad.attribute}' is not one of the slicing's attributes ${JSON.stringify(attributes)}`, "run.band_attribute");
    return HttpResponse.json(slicingPreviewFor(attributes, bands, num(u.searchParams.get("minCases"), 20), summaryFor(run.id).cases ?? 251734));
  }),
  http.get(`${API}/projects/:projectId/runs/:runId/filters/preview`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const filter = parseFilter(new URL(request.url).searchParams.get("filter"));
    return HttpResponse.json(filterPreviewFor(filter, summaryFor(run.id).cases ?? 251734));
  }),
  http.get(`${API}/projects/:projectId/runs/:runId/analytics`, async ({ params }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const verified = run.note === "2018" && !run.scope?.flow_type;
    return HttpResponse.json(verified ? { ...verifiedAnalytics, runId: run.id } : { runId: run.id, status: "not_requested", package: { available: true, version: "0.2.0", reason: null }, jobId: null, windowEnd: null, manifest: {} });
  }),
  http.post(`${API}/projects/:projectId/runs/:runId/analytics`, async ({ params }) => {
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const job = createJob("analytics", "resampling the backlog", undefined, 0.25);
    return HttpResponse.json(job, { status: 202 });
  }),
  http.get(`${API}/projects/:projectId/runs/:runId/compare-flow-types`, async ({ params }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    if (run.scope?.flow_type) return problem(409, "Conflict", `run ${run.id} is scoped to ${run.scope.flow_type}; compare from a run without scope`, "run.scoped");
    const scoped = Object.fromEntries(db.runs.filter((r) => r.status === "done" && r.scope?.flow_type && r.caseTableId === run.caseTableId && r.normVersionId === run.normVersionId).map((r) => [r.scope!.flow_type as string, r.id]));
    return HttpResponse.json(compareFlowTypesFor(scoped));
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/slices/:sliceKey`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const u = new URL(request.url);
    const slicing = u.searchParams.get("slicing");
    if (!slicing) return problem(422, "Unprocessable Content", "slicing is required", "backlog.slicing");
    const view = u.searchParams.get("view") || run.views?.[0] || "Finance";
    const source = backlogFor(run.id, slicing, view, run.gamma ?? 20, 1);
    // the key is a JSON array (URL-encoded in the path); a bare value is accepted for single-attribute slicings
    const raw = String(params.sliceKey);
    let key = raw;
    try {
      key = decodeURIComponent(raw);
    } catch {
      key = raw;
    }
    if (!key.startsWith("[")) key = JSON.stringify([key]);
    let row: BacklogRow | undefined = source.rows.find((r) => canonical(r.key) === canonical(key));
    let illustrative = source.illustrative;
    if (!row) {
      // a drilled group (R2-O2): the vendors inside Packaging are verified, other drill-ins illustrative
      for (const parentSlicing of ["case Company+case Spend area text", "case Vendor"]) {
        const parentSource = backlogFor(run.id, parentSlicing, view, run.gamma ?? 20, 1);
        for (const parent of parentSource.rows) {
          const detail = verifiedSlice(parent.key, view) ?? buildSlice(parent, parentSlicing, view, parentSource.globalMean);
          const drilled = drillInto(parent, { slicing: parentSlicing, key: parent.key }, detail, run.gamma ?? 20, view);
          row = drilled.rows.find((r) => canonical(r.key) === canonical(key));
          if (row) {
            illustrative = drilled.illustrative;
            break;
          }
        }
        if (row) break;
      }
    }
    if (!row) return problem(404, "Not Found", `slice ${key} not found in slicing ${slicing}`, "slice.not_found");
    const verified = !illustrative && !run.scope?.flow_type ? verifiedSlice(row.key, view) : undefined;
    const detail = verified ?? buildSlice(row, slicing, view, source.globalMean);
    return HttpResponse.json({ ...sliceC2(detail, view, !verified), params: { ...(detail.params ?? {}), scope: run.scope ?? null } });
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
    const { rows } = backlogFor(run.id, slicing, run.views?.[0] ?? "Finance", run.gamma ?? 20, run.minCases ?? 1);
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
    if (params.constraintId === verifiedDistributionPackaging.constraintId && sliceKey && canonical(sliceKey) === canonical(VERIFIED_PACKAGING_KEY)) return HttpResponse.json(verifiedDistributionPackaging);
    return HttpResponse.json(buildDistribution(String(params.constraintId), sliceKey));
  }),

  http.get(`${API}/projects/:projectId/runs/:runId/flow`, async ({ params, request }) => {
    await delay(latency);
    const run = runOr404(String(params.runId));
    if (!run) return problem(404, "Not Found", "run not found", "run.not_found");
    const u = new URL(request.url);
    const filter = parseFilter(u.searchParams.get("filter"));
    const sliceKey = u.searchParams.get("sliceKey") ?? undefined;
    const slicing = u.searchParams.get("slicing") ?? undefined;
    const focus = u.searchParams.get("focus") ?? undefined;
    const keep = filterKeepShare(filter);
    const verified = run.note === "2018" && !run.scope?.flow_type && !filter;
    const extra = { filter: filter ?? null, filterCases: filter ? Math.round(251734 * keep) : null, scope: run.scope ?? null, caseNoun: VERIFIED_CASE_NOUN };
    if (verified && !sliceKey && !focus) return HttpResponse.json({ ...verifiedFlowAll, meta: { ...verifiedFlowAll.meta, runId: run.id, ...extra } });
    if (verified && !sliceKey && focus === "a_record_goods_receipt") return HttpResponse.json({ ...verifiedFlowFocusedOnGoodsReceipt, meta: { ...verifiedFlowFocusedOnGoodsReceipt.meta, runId: run.id, ...extra } });
    if (verified && sliceKey && canonical(sliceKey) === canonical(VERIFIED_PACKAGING_KEY) && !focus) return HttpResponse.json({ ...verifiedFlowPackaging, meta: { ...verifiedFlowPackaging.meta, runId: run.id, ...extra } });
    const scopeShare = run.scope?.flow_type ? ({ DF2: 0.878, DF1: 0.06, Consignment: 0.058, "2-way": 0.004 } as Record<string, number>)[run.scope.flow_type] ?? 0.1 : 1;
    const base = sliceKey ? undefined : keep * scopeShare;
    const graph = buildFlow({ slicing, sliceKey, abstraction: num(u.searchParams.get("abstraction"), 0.05), focus, ...(base !== undefined && base < 1 ? { scale: base } : {}) });
    return HttpResponse.json({ ...graph, meta: { ...graph.meta, runId: run.id, ...extra, illustrative: true } });
  }),

  // ---------------------------------------------------------------- analysis notebook (R2-O11)
  http.get(`${API}/projects/:projectId/notebook`, async () => {
    await delay(latency);
    return HttpResponse.json({ ...db.notebook, snapshots: [...db.notebook.snapshots].sort((a, b) => a.order - b.order).map(snapshotDto) });
  }),
  http.post(`${API}/projects/:projectId/notebook/snapshots`, async ({ request }) => {
    await delay(latency);
    const form = await request.formData();
    const payloadRaw = form.get("payload");
    let body: { title?: string; note?: string; context?: SnapshotContext; data?: unknown; author?: string | null } = {};
    if (typeof payloadRaw === "string" && payloadRaw) {
      try {
        body = JSON.parse(payloadRaw) as typeof body;
      } catch {
        return problem(422, "Unprocessable Content", "payload is not valid JSON", "snapshot.payload");
      }
    } else if (isBlob(payloadRaw)) {
      body = JSON.parse(await payloadRaw.text()) as typeof body;
    }
    const title = (body.title ?? (form.get("title") as string | null) ?? "").trim();
    if (!title) return problem(422, "Unprocessable Content", "A snapshot needs a title.", "snapshot.title");
    const image = form.get("image");
    const id = nextId("snapshot", "snap");
    const now = new Date().toISOString();
    const snapshot: MockSnapshot = {
      id,
      projectId: "p2p2018",
      title,
      note: body.note ?? (form.get("note") as string | null) ?? "",
      context: (body.context ?? { screen: "unknown", url: "" }) as unknown as Record<string, unknown>,
      data: body.data ?? null,
      hasImage: isBlob(image),
      imageUrl: isBlob(image) ? `/api/v1/projects/p2p2018/notebook/snapshots/${id}/image` : null,
      order: db.notebook.snapshots.length,
      author: body.author ?? "u.jessen",
      createdAt: now,
      updatedAt: now,
      image: isBlob(image) ? image : undefined,
    };
    db.notebook.snapshots.push(snapshot);
    return HttpResponse.json(snapshotDto(snapshot), { status: 201 });
  }),
  http.get(`${API}/projects/:projectId/notebook/snapshots/:id/image`, async ({ params }) => {
    const snap = db.notebook.snapshots.find((s) => s.id === params.id);
    if (!snap?.image) return problem(404, "Not Found", "no image for this snapshot", "snapshot.image");
    return new HttpResponse(snap.image, { headers: { "Content-Type": "image/png" } });
  }),
  http.post(`${API}/projects/:projectId/notebook/snapshots/:id/image`, async ({ params, request }) => {
    const snap = db.notebook.snapshots.find((s) => s.id === params.id);
    if (!snap) return problem(404, "Not Found", "snapshot not found", "snapshot.not_found");
    const form = await request.formData();
    const image = form.get("image");
    if (!isBlob(image)) return problem(422, "Unprocessable Content", "image is required", "snapshot.image");
    snap.image = image;
    snap.hasImage = true;
    snap.imageUrl = `/api/v1/projects/p2p2018/notebook/snapshots/${snap.id}/image`;
    snap.updatedAt = new Date().toISOString();
    return HttpResponse.json(snapshotDto(snap));
  }),
  http.get(`${API}/projects/:projectId/notebook/snapshots/:id`, async ({ params }) => {
    const snap = db.notebook.snapshots.find((s) => s.id === params.id);
    if (!snap) return problem(404, "Not Found", "snapshot not found", "snapshot.not_found");
    return HttpResponse.json(snapshotDto(snap));
  }),
  http.patch(`${API}/projects/:projectId/notebook/snapshots/:id`, async ({ params, request }) => {
    const snap = db.notebook.snapshots.find((s) => s.id === params.id);
    if (!snap) return problem(404, "Not Found", "snapshot not found", "snapshot.not_found");
    const body = (await request.json()) as { title?: string | null; note?: string | null };
    if (body.title !== undefined && body.title !== null) snap.title = body.title;
    if (body.note !== undefined && body.note !== null) snap.note = body.note;
    snap.updatedAt = new Date().toISOString();
    return HttpResponse.json(snapshotDto(snap));
  }),
  http.delete(`${API}/projects/:projectId/notebook/snapshots/:id`, ({ params }) => {
    const i = db.notebook.snapshots.findIndex((s) => s.id === params.id);
    if (i < 0) return problem(404, "Not Found", "snapshot not found", "snapshot.not_found");
    db.notebook.snapshots.splice(i, 1);
    db.notebook.snapshots.forEach((s, j) => (s.order = j));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${API}/projects/:projectId/notebook/reorder`, async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    const rank = new Map((body.ids ?? []).map((id, i) => [id, i]));
    db.notebook.snapshots.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
    db.notebook.snapshots.forEach((s, j) => (s.order = j));
    return HttpResponse.json({ ...db.notebook, snapshots: db.notebook.snapshots.map(snapshotDto) });
  }),
  http.get(`${API}/projects/:projectId/notebook/export`, ({ request }) => {
    const format = new URL(request.url).searchParams.get("format") ?? "markdown";
    if (format !== "markdown") return problem(422, "Unprocessable Content", `export format ${format} arrives in cycle 4`, "notebook.format");
    const lines = ["# Analysis notebook · P2P 2018 (BPIC 2019)", ""];
    for (const s of [...db.notebook.snapshots].sort((a, b) => a.order - b.order)) {
      const ctx = s.context as Partial<SnapshotContext> | undefined;
      lines.push(`## ${s.order + 1}. ${s.title}`, "", s.note ?? "", "", s.hasImage ? `![${s.title}](images/${s.id}.png)` : "_(no image)_", "", `_${ctx?.screen ?? ""} · run ${ctx?.run_id ?? "–"} · ${ctx?.slicing ?? ""} · ${ctx?.view ?? ""} · ${ctx?.url ?? ""}_`, "");
    }
    // the backend answers with a zip (notebook.md plus images/); the mock ships the Markdown alone under the same media type
    return new HttpResponse(new Blob([lines.join("\n")], { type: "application/zip" }), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="notebook.zip"' } });
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
