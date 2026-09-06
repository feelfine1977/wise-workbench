import type { CaseTable, DatasetVersion, NormVersion, Project, Run } from "@wise/api-schema";

export type StageState = "not_started" | "in_progress" | "gated" | "done";

export interface StageInfo {
  id: string;
  index: number;
  state: StageState;
  /** Why the stage is gated and where to fix it. */
  why?: string;
  fixAt?: { screen: "data" | "dataset" | "norms" | "runs" | "backlog"; id?: string };
  screen?: "dashboard" | "data" | "dataset" | "norms" | "runs" | "backlog";
  /** Free text for stages that arrive in a later increment. */
  later?: string;
}

export interface JourneyInput {
  project?: Project;
  datasets: DatasetVersion[];
  caseTable?: CaseTable;
  norms: NormVersion[];
  runs: Run[];
  run?: Run;
  findings: number;
  dispositions: number;
  gatesPassed: number;
}

/** Stage states for the journey rail (UX-2). Gates record where evidence is missing; they never block exploration. */
export function computeStages(input: JourneyInput): StageInfo[] {
  const { project, datasets, caseTable, norms, runs, run, findings, dispositions, gatesPassed } = input;
  const readiness = caseTable?.readiness;
  const items = readiness?.items ?? [];
  const fails = items.filter((i) => i.level === "fail");
  const replication = items.find((i) => i.id === "header_event_replication" && i.level === "warn");
  const censoring = items.find((i) => i.id === "right_censored" && i.level === "warn");
  const anyRunDone = runs.some((r) => r.status === "done");
  const activeRun = runs.find((r) => r.status === "queued" || r.status === "running");
  const failedRun = !anyRunDone && runs.find((r) => r.status === "failed");

  const s0: StageInfo = { id: "S0", index: 0, state: project?.question ? "done" : project ? "in_progress" : "not_started", screen: "dashboard" };

  let s1: StageInfo = { id: "S1", index: 1, state: "not_started", screen: "data" };
  if (datasets.some((d) => d.status === "ingesting")) s1 = { ...s1, state: "in_progress" };
  else if (datasets.some((d) => d.status === "ready")) s1 = { ...s1, state: "done" };
  if (fails.length) s1 = { ...s1, state: "gated", why: fails.map((f) => f.message).join(" "), fixAt: { screen: "dataset", id: caseTable?.datasetId } };

  let s2: StageInfo = { id: "S2", index: 2, state: caseTable ? "done" : datasets.length ? "in_progress" : "not_started", screen: "dataset" };
  if (caseTable && replication) {
    s2 = { ...s2, state: "gated", why: `Duplicated header events: ${replication.message}`, fixAt: { screen: "dataset", id: caseTable.datasetId } };
  }

  const s3: StageInfo = {
    id: "S3",
    index: 3,
    state: norms.some((n) => n.status === "approved" || n.status === "reviewed") ? "done" : norms.length ? "in_progress" : "not_started",
    screen: "norms",
  };
  const normViews = (norms.find((n) => n.status === "approved") ?? norms[0])?.norm as { views?: unknown[] } | undefined;
  const s4: StageInfo = { id: "S4", index: 4, state: normViews?.views?.length ? "done" : norms.length ? "in_progress" : "not_started", screen: "norms" };

  let s5: StageInfo = { id: "S5", index: 5, state: anyRunDone ? "done" : activeRun ? "in_progress" : "not_started", screen: "runs" };
  if (failedRun) s5 = { ...s5, state: "gated", why: `Run ${failedRun.id} failed; open it for the message and start a new run.`, fixAt: { screen: "runs" } };

  const s6: StageInfo = {
    id: "S6",
    index: 6,
    state: !anyRunDone ? "not_started" : dispositions >= 3 ? "done" : "in_progress",
    screen: "backlog",
  };

  let s7: StageInfo = { id: "S7", index: 7, state: findings ? (gatesPassed ? "in_progress" : "not_started") : "not_started", screen: "backlog" };
  if (anyRunDone && (replication || censoring) && !gatesPassed) {
    const parts = [
      replication ? `duplicated events on ${Math.round(((replication.evidence?.replicatedShare as number | undefined) ?? 0) * 100)} % of header events` : "",
      censoring ? `${(((censoring.evidence?.cases as number | undefined) ?? 0)).toLocaleString("en")} cases still open at the end of the data` : "",
    ].filter(Boolean);
    s7 = { ...s7, state: "gated", why: `Checks before acting await a reading: ${parts.join(", ")}. Pass, fail or waive them with a note on the group's "Can the data be trusted?" tab.`, fixAt: { screen: "backlog" } };
  }

  const later = (id: string, index: number, when: string): StageInfo => ({ id, index, state: "not_started", later: when });
  void run;
  return [s0, s1, s2, s3, s4, s5, s6, s7, later("S8", 8, "increment 1"), later("S9", 9, "increment 2"), later("S10", 10, "increment 2"), later("S11", 11, "increment 2"), later("S12", 12, "v1")];
}
