import type { BacklogRow, CaseTable, DatasetVersion, Job, NormVersion, Run, RunSummary, Table } from "@wise/api-schema";
import { buildBacklog, globalMeans } from "./fixtures/backlog";
import { activities, bpic19Columns, caseTableAttributes, caseTables as caseTableFixtures, datasets as datasetFixtures, readinessWarn } from "./fixtures/datasets";
import { bpic19Norm, normVersions } from "./fixtures/norm";
import { projects as projectFixtures } from "./fixtures/project";
import { runs as runFixtures, slicings, views } from "./fixtures/runs";
import { rng, round } from "./fixtures/seed";

export interface MockJob extends Job {
  /** Side effect applied when the job finishes. */
  effect?: { kind: "dataset" | "caseTable" | "run"; id: string };
  /** Progress per poll; jobs advance when they are observed (polling or SSE). */
  step: number;
}

export interface MockDb {
  projects: typeof projectFixtures;
  datasets: DatasetVersion[];
  caseTables: CaseTable[];
  norms: NormVersion[];
  runs: Run[];
  jobs: Map<string, MockJob>;
  counters: { dataset: number; caseTable: number; norm: number; run: number; job: number };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const db: MockDb = {
  projects: [],
  datasets: [],
  caseTables: [],
  norms: [],
  runs: [],
  jobs: new Map(),
  counters: { dataset: 1, caseTable: 1, norm: 8, run: 41, job: 41 },
};

export function resetDb() {
  db.projects = clone(projectFixtures);
  db.datasets = clone(datasetFixtures);
  db.caseTables = clone(caseTableFixtures);
  db.norms = clone(normVersions);
  db.runs = clone(runFixtures);
  db.jobs = new Map();
  db.counters = { dataset: 1, caseTable: 1, norm: 8, run: 41, job: 41 };
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
resetDb();

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
      if (project) project.latestRunId = run.id;
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
  const ct: CaseTable = { id, datasetId, mappingId, cases: 251734, events: 1595923, status: "building", readiness, activities: clone(activities), attributes: caseTableAttributes, createdAt: new Date().toISOString() };
  db.caseTables.push(ct);
  return ct;
}

const backlogCache = new Map<string, { rows: BacklogRow[]; globalMean: number }>();
export function backlogFor(runId: string, slicing: string, view: string, gamma: number, minCases: number) {
  const run = db.runs.find((r) => r.id === runId);
  const seedSuffix = run?.note && run.note !== "2018" ? `:${run.note}` : "";
  const k = `${slicing}|${view}|${gamma}|${minCases}${seedSuffix}`;
  let hit = backlogCache.get(k);
  if (!hit) {
    hit = buildBacklog(slicing, view, gamma, minCases);
    if (seedSuffix) {
      // other periods: perturb gaps deterministically so comparisons are not trivial
      const r = rng(k);
      hit.rows = hit.rows.map((row) => {
        const f = 1 + r.normal(0, 0.12);
        const gap = round(Math.max(0, row.gap * f), 8);
        const shrink = gamma > 0 ? row.n_cases / (row.n_cases + gamma) : 1;
        return { ...row, gap, PI: round(row.n_cases * gap, 4), stable_gap: round(gap * shrink, 8), stable_PI: round(row.n_cases * gap * shrink, 4) };
      });
    }
    backlogCache.set(k, hit);
  }
  return hit;
}

export function summaryFor(runId: string): RunSummary {
  const run = db.runs.find((r) => r.id === runId);
  const gamma = run?.gamma ?? 50;
  const minCases = run?.minCases ?? 20;
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
  return { means, scored: Object.fromEntries(viewList.map((v) => [v, 251734])), density: { evaluated: 0.762, inScope: 0.841 }, layers, concentration, agreement, cases: 251734, views: viewList };
}
