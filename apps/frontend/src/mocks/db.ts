import type { BacklogRow, CaseTable, DatasetVersion, Job, NormVersion, Run, RunSummary, Table } from "@wise/api-schema";
import type { Decision } from "@/lib/api/readiness";
import type { Notebook, Snapshot } from "@/lib/api/notebook";
import type { RunWithScope as RunC2, RunScope } from "@/lib/api/runs";
import { VERIFIED_CASE_NOUN, VERIFIED_WINDOW_END } from "./fixtures/verified";
import { buildBacklog, globalMeans } from "./fixtures/backlog";
import { activities, bpic19Columns, caseTableAttributes, caseTables as caseTableFixtures, datasets as datasetFixtures, readinessWarn } from "./fixtures/datasets";
import { bpic19Norm, normVersions } from "./fixtures/norm";
import { projects as projectFixtures } from "./fixtures/project";
import { runs as runFixtures, slicings, views } from "./fixtures/runs";
import { rng, round } from "./fixtures/seed";
import { VERIFIED_GAMMA, isVerifiedSlicing, verifiedBacklog } from "./fixtures/verified";

export interface MockJob extends Job {
  /** Side effect applied when the job finishes. */
  effect?: { kind: "dataset" | "caseTable" | "run"; id: string };
  /** Progress per poll; jobs advance when they are observed (polling or SSE). */
  step: number;
}

export interface MockSnapshot extends Snapshot {
  /** The PNG the client sent; served from `GET /notebook/snapshots/{id}/image`. */
  image?: Blob;
}

export interface MockDb {
  projects: typeof projectFixtures;
  datasets: DatasetVersion[];
  caseTables: CaseTable[];
  norms: NormVersion[];
  runs: RunC2[];
  jobs: Map<string, MockJob>;
  notebook: Omit<Notebook, "snapshots"> & { snapshots: MockSnapshot[] };
  decisions: Decision[];
  counters: { dataset: number; caseTable: number; norm: number; run: number; job: number; snapshot: number; decision: number };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const emptyNotebook = (): MockDb["notebook"] => ({ projectId: "p2p2018", snapshots: [], exportFormats: ["markdown"] });

export const db: MockDb = {
  projects: [],
  datasets: [],
  caseTables: [],
  norms: [],
  runs: [],
  jobs: new Map(),
  notebook: emptyNotebook(),
  decisions: [],
  counters: { dataset: 1, caseTable: 1, norm: 8, run: 41, job: 41, snapshot: 0, decision: 0 },
};

const backlogCache = new Map<string, BacklogSource>();

export function resetDb() {
  db.projects = clone(projectFixtures);
  db.datasets = clone(datasetFixtures);
  db.caseTables = clone(caseTableFixtures);
  db.norms = clone(normVersions);
  db.runs = clone(runFixtures);
  db.jobs = new Map();
  db.notebook = emptyNotebook();
  db.decisions = [];
  db.counters = { dataset: 1, caseTable: 1, norm: 8, run: 41, job: 41, snapshot: 0, decision: 0 };
  backlogCache.clear();
  for (const run of db.runs) {
    if (run.jobId) {
      db.jobs.set(run.jobId, {
        id: run.jobId,
        kind: "score_run",
        status: run.status === "failed" ? "failed" : "done",
        progress: run.status === "failed" ? 0.08 : 1,
        message: run.status === "failed" ? "Scoring stopped: γ = 200 exceeds the case count of 61 % of vendor slices; lower γ or raise min cases" : "done",
        attempts: 1,
        resultRef: `run:${run.id}`,
        error: run.status === "failed" ? "gamma_out_of_range" : undefined,
        createdAt: run.manifest?.startedAt ?? run.createdAt,
        updatedAt: run.manifest?.finishedAt ?? run.createdAt,
        projectId: "p2p2018",
        cancelRequested: false,
        step: 1,
      });
    }
  }
}

export const nextId = (kind: keyof MockDb["counters"], prefix: string) => `${prefix}_${++db.counters[kind]}`;

export function createJob(kind: string, message: string, effect?: MockJob["effect"], step = 0.22): MockJob {
  const id = nextId("job", "job");
  const now = new Date().toISOString();
  const job: MockJob = { id, kind, status: "queued", progress: 0, message, attempts: 1, createdAt: now, updatedAt: now, projectId: "p2p2018", cancelRequested: false, effect, step };
  db.jobs.set(id, job);
  return job;
}

const messages: Record<string, string[]> = {
  ingest: ["reading the source file", "profiling columns", "writing manifest"],
  build_cases: ["reading events", "building the event log", "data-readiness report", "writing the case table", "writing typed events"],
  score_run: ["loading the event log", "scoring cases", "writing per-case frames", "backlog case Vendor × Finance", "writing summary"],
  load_preset: ["hashing the log file", "ingest: reading the source file", "case table: building the event log", "norm version", "scoring: scoring cases"],
  apply_decision: ["reading the decision", "rebuilding the case table", "data-readiness report"],
};

/** Advances a job one step on observation; applies the side effect when it reaches 1. */
export function advanceJob(job: MockJob): MockJob {
  if (job.status !== "queued" && job.status !== "running") return job;
  const progress = Math.min(1, round((job.progress ?? 0) + job.step, 3));
  job.progress = progress;
  job.status = progress >= 1 ? "done" : "running";
  const list = messages[job.kind] ?? ["working"];
  job.message = progress >= 1 ? "done" : list[Math.min(list.length - 1, Math.floor(progress * list.length))];
  job.updatedAt = new Date().toISOString();
  if (job.status === "done" && job.effect) applyEffect(job);
  return job;
}

function applyEffect(job: MockJob) {
  const e = job.effect;
  if (!e) return;
  if (e.kind === "dataset") {
    const ds = db.datasets.find((d) => d.id === e.id);
    if (ds) {
      ds.status = "ready";
      ds.events = ds.events ?? 48210;
      ds.columns = ds.columns?.length ? ds.columns : clone(bpic19Columns);
      ds.contentHash = ds.contentHash ?? rng(ds.name).int(0x10000000, 0x7fffffff).toString(16).padStart(64, "0");
    }
    job.resultRef = `dataset:${e.id}`;
  } else if (e.kind === "caseTable") {
    const ct = db.caseTables.find((c) => c.id === e.id);
    if (ct) ct.status = "ready";
    job.resultRef = `case_table:${e.id}`;
  } else if (e.kind === "run") {
    const run = db.runs.find((r) => r.id === e.id);
    if (run) {
      run.status = "done";
      run.manifest = { ...run.manifest, finishedAt: new Date().toISOString() };
      const project = db.projects[0];
      if (project && !run.scope?.flow_type) project.latestRunId = run.id;
    }
    job.resultRef = `run:${e.id}`;
  }
}

export function cancelJob(job: MockJob) {
  if (job.status === "queued" || job.status === "running") {
    job.status = "cancelled";
    job.message = "cancelled on request";
    job.cancelRequested = true;
    job.updatedAt = new Date().toISOString();
    if (job.effect?.kind === "run") {
      const run = db.runs.find((r) => r.id === job.effect?.id);
      if (run) run.status = "cancelled";
    }
    if (job.effect?.kind === "dataset") {
      const ds = db.datasets.find((d) => d.id === job.effect?.id);
      if (ds) ds.status = "failed";
    }
  }
}

export function newCaseTable(datasetId: string, mappingId: string, headerEvents: string[]): CaseTable {
  const id = nextId("caseTable", "ct");
  const readiness = clone(readinessWarn);
  if (headerEvents.length) {
    // typing header events away resolves the replication caveat
    readiness.items = (readiness.items ?? []).filter((i) => i.id !== "header_event_replication");
    readiness.items.push({ id: "header_event_replication", level: "info", message: `Header events typed away: ${headerEvents.join(", ")} are attached to the purchasing document, not replicated per item.`, evidence: { headerEvents, replicatedShare: 0, casesFlagged: 0, ratioFlag: 2 } });
  }
  const ct: CaseTable = { id, datasetId, mappingId, cases: 251734, events: 1595923, status: "building", readiness: { ...readiness, windowEnd: VERIFIED_WINDOW_END, caseNoun: VERIFIED_CASE_NOUN }, activities: clone(activities), attributes: caseTableAttributes, createdAt: new Date().toISOString() };
  db.caseTables.push(ct);
  return ct;
}

export const FLOW_TYPE_SHARE: Record<string, number> = { DF2: 221010 / 251734, DF1: 15182 / 251734, Consignment: 14498 / 251734, "2-way": 1044 / 251734 };

/** Re-derives the shrinkage columns for another γ (the verified rows were computed with γ = 20). */
function withGamma(rows: BacklogRow[], gamma: number): BacklogRow[] {
  if (gamma === VERIFIED_GAMMA) return rows;
  const out = rows.map((row) => {
    const n = row.n_cases;
    const shrink = gamma > 0 ? n / (n + gamma) : 1;
    const stableGap = round(row.gap * shrink, 8);
    const se = row.se ?? 0;
    return { ...row, stable_gap: stableGap, stable_PI: round(n * stableGap, 4), PI_lower: round(n * Math.max(0, stableGap - 1.96 * se), 4), stable_mean: round((row.global_mean ?? 0) - stableGap, 6) };
  });
  out.sort((a, b) => b.stable_PI - a.stable_PI || b.n_cases - a.n_cases);
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/** Scopes rows to one flow type: illustrative scaling of the counts (the backend restricts the case table). */
function withScope(rows: BacklogRow[], scope: RunScope | null | undefined, gamma: number, seed: string): BacklogRow[] {
  const ft = scope?.flow_type;
  if (!ft) return rows;
  const share = FLOW_TYPE_SHARE[ft] ?? 0.1;
  const r = rng(`scope:${ft}:${seed}`);
  const out = rows
    .map((row) => {
      const n = Math.max(1, Math.round(row.n_cases * share * r.range(0.7, 1.3)));
      const gap = round(Math.max(0, row.gap * r.range(0.6, 1.5)), 8);
      const shrink = gamma > 0 ? n / (n + gamma) : 1;
      return { ...row, n_cases: n, volume: n, gap, PI: round(n * gap, 4), stable_gap: round(gap * shrink, 8), stable_PI: round(n * gap * shrink, 4), PI_lower: round(n * Math.max(0, gap * shrink - 1.96 * (row.se ?? 0)), 4), stability: "unknown" as const };
    })
    .sort((a, b) => b.stable_PI - a.stable_PI);
  out.forEach((row, i) => {
    row.rank = i + 1;
    row.n_ranked = out.length;
  });
  return out;
}

export interface BacklogSource {
  rows: BacklogRow[];
  globalMean: number;
  /** The backend's total for the slicing; larger than `rows.length` for the verified vendor page (top 50 of 1,975). */
  total?: number;
  illustrative: boolean;
}

/**
 * The backlog of a run: the verified run's rows for the company × spend area and vendor slicings (γ re-derived
 * when the run's differs), illustrative rows otherwise; other periods perturb the rows; scoped runs scale them.
 */
export function backlogFor(runId: string, slicing: string, view: string, gamma: number, minCases: number): BacklogSource {
  const run = db.runs.find((r) => r.id === runId);
  const seedSuffix = run?.note && run.note !== "2018" ? `:${run.note}` : "";
  const scopeSuffix = run?.scope?.flow_type ? `:scope=${run.scope.flow_type}` : "";
  void FLOW_TYPE_SHARE;
  const k = `${slicing}|${view}|${gamma}|${minCases}${seedSuffix}${scopeSuffix}`;
  let hit = backlogCache.get(k);
  if (!hit) {
    const verified = verifiedBacklog(slicing, view);
    if (verified && isVerifiedSlicing(slicing)) {
      const rows = withGamma(clone(verified.rows), gamma).filter((r) => r.n_cases >= minCases);
      hit = { rows, globalMean: verified.globalMean, total: rows.length === verified.rows.length ? verified.total : rows.length, illustrative: false };
    } else {
      const built = buildBacklog(slicing, view, gamma, minCases);
      hit = { rows: built.rows, globalMean: built.globalMean, illustrative: true };
    }
    if (seedSuffix) {
      // other periods: perturb gaps deterministically so comparisons are not trivial
      const r = rng(k);
      hit = {
        ...hit,
        rows: hit.rows.map((row) => {
          const f = 1 + r.normal(0, 0.12);
          const gap = round(Math.max(0, row.gap * f), 8);
          const shrink = gamma > 0 ? row.n_cases / (row.n_cases + gamma) : 1;
          return { ...row, gap, PI: round(row.n_cases * gap, 4), stable_gap: round(gap * shrink, 8), stable_PI: round(row.n_cases * gap * shrink, 4) };
        }),
      };
    }
    if (run?.scope?.flow_type) hit = { ...hit, rows: withScope(hit.rows, run.scope, gamma, k), total: undefined, illustrative: true };
    backlogCache.set(k, hit);
  }
  return hit;
}

export function summaryFor(runId: string): RunSummary {
  const run = db.runs.find((r) => r.id === runId);
  const gamma = run?.gamma ?? 20;
  const minCases = run?.minCases ?? 1;
  const viewList = run?.views ?? views;
  const slicingList = run?.slicings ?? slicings;
  const means = Object.fromEntries(viewList.map((v) => [v, globalMeans[v] ?? 0.84]));
  const concentration: RunSummary["concentration"] = {};
  const agreement: RunSummary["agreement"] = {};
  for (const s of slicingList) {
    const sid = s.id ?? s.attributes.join("+");
    concentration[sid] = {};
    for (const v of viewList) {
      const { rows } = backlogFor(runId, sid, v, gamma, minCases);
      const sorted = [...rows].sort((a, b) => b.stable_PI - a.stable_PI);
      const total = sorted.reduce((x, r) => x + r.stable_PI, 0) || 1;
      const table: Table = { columns: ["threshold", "top_k", "share_of_slices"], rows: [] };
      for (const threshold of [0.5, 0.8, 0.95]) {
        let cum = 0;
        let k = 0;
        for (const r of sorted) {
          cum += r.stable_PI / total;
          k += 1;
          if (cum >= threshold) break;
        }
        table.rows.push([threshold, k, round(k / Math.max(sorted.length, 1), 4)]);
      }
      concentration[sid][v] = table;
    }
    agreement[sid] = {
      columns: ["view_a", "view_b", "top20_overlap", "score_correlation"],
      rows: viewList.flatMap((a, i) => viewList.slice(i + 1).map((b) => [a, b, round(rng(`agr:${[a, b].sort().join()}`).range(0.5, 0.9), 4), round(rng(`sp:${[a, b].sort().join()}`).range(0.55, 0.95), 4)])),
    };
  }
  const r = rng(`summary:${runId}`);
  const layerIds = bpic19Norm.layers.map((l) => l.id);
  const layers: Table = {
    columns: ["view", ...layerIds],
    rows: viewList.map((v) => [v, ...layerIds.map(() => round(r.range(0.001, 0.11), 6))]),
  };
  const cases = run?.scope?.flow_type ? Math.round(251734 * (FLOW_TYPE_SHARE[run.scope.flow_type] ?? 0.1)) : 251734;
  return { means, scored: Object.fromEntries(viewList.map((v) => [v, cases])), density: { evaluated: 0.762, inScope: 0.841 }, layers, concentration, agreement, cases, views: viewList };
}

/** Creates a run (queued) with its scoring job; `scope` restricts it to one flow type (R2-O10). */
export function newRun(body: { caseTableId: string; normVersionId: string; views?: string[]; slicings?: Run["slicings"]; gamma?: number; minCases?: number; note?: string | null; baselineRunId?: string | null; scope?: RunScope }, parentRunId?: string): RunC2 {
  const id = nextId("run", "run");
  const job = createJob("score_run", body.scope?.flow_type ? `loading the ${body.scope.flow_type} items` : "loading the event log", { kind: "run", id }, 0.2);
  const norm = db.norms.find((n) => n.id === body.normVersionId);
  const runSlicings = (body.slicings?.length ? body.slicings : [{ attributes: ["case Vendor"] }]).map((s) => ({ ...s, id: s.id || s.attributes.join("+"), attributes: s.attributes }));
  const run: RunC2 = {
    caseTableId: body.caseTableId,
    normVersionId: body.normVersionId,
    baselineRunId: body.baselineRunId ?? undefined,
    note: body.note ?? undefined,
    views: body.views?.length ? body.views : (norm?.views ?? ["Finance", "Logistics", "Compliance", "Automation"]),
    slicings: runSlicings,
    gamma: body.gamma ?? 20,
    minCases: body.minCases ?? 1,
    id,
    status: "queued",
    jobId: job.id,
    paramsHash: ((Math.random() * 0xffffffff) >>> 0).toString(16).padStart(64, "0"),
    createdAt: new Date().toISOString(),
    manifest: { normFingerprint: norm?.fingerprint, contentHash: "51ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b64", mappingId: "map_2", wiseVersion: "0.1.0", startedAt: new Date().toISOString(), views: body.views ?? [], slicings: runSlicings },
    links: { self: `/api/v1/projects/p2p2018/runs/${id}`, summary: `/api/v1/projects/p2p2018/runs/${id}/summary` },
    scope: body.scope?.flow_type || body.scope?.value ? { flow_type: body.scope.flow_type ?? body.scope.value, attribute: body.scope.attribute ?? "flow_type", value: body.scope.value ?? body.scope.flow_type } : null,
  };
  void parentRunId;
  db.runs.push(run);
  return run;
}

resetDb();
