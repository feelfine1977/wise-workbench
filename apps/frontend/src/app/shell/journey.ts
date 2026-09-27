import type { CaseTable, DatasetVersion, NormVersion, Project, Run } from "@wise/api-schema";

export type StageState = "not_started" | "in_progress" | "gated" | "done" | "available" | "planned";
export type JourneyScreen = "dashboard" | "data" | "context" | "norms" | "weights" | "runs" | "investigate" | "signals" | "flow" | "why" | "act";

export interface StageInfo {
  id: string;
  label: string;
  description: string;
  state: StageState;
  /** A measured fact or an explicit prerequisite, never inferred completion of a feature. */
  status: string;
  screen?: JourneyScreen;
}

export interface JourneyInput {
  project?: Project;
  datasets: DatasetVersion[];
  caseTable?: CaseTable;
  norms: NormVersion[];
  norm?: NormVersion;
  runs: Run[];
  run?: Run;
}

/** Navigation availability and recorded facts for the selected context, not a completion checklist. */
export function computeStages({ project, datasets, caseTable, norms, norm: selectedNorm, runs, run }: JourneyInput): StageInfo[] {
  const readiness = caseTable?.readiness;
  const issues = (readiness?.items ?? []).filter((item) => item.level === "warn" || item.level === "fail");
  const dataFailed = caseTable?.status === "failed" || readiness?.status === "fail" || issues.some((item) => item.level === "fail");
  const dataWarning = readiness?.status === "warn" || issues.length > 0;
  const tableReady = caseTable?.status === "ready";
  const dataState: StageState = dataFailed || dataWarning ? "gated" : tableReady && readiness?.status === "pass" ? "done" : datasets.length ? "in_progress" : "not_started";
  const norm = selectedNorm ?? norms.find((candidate) => candidate.id === run?.normVersionId);
  const constraints = norm?.norm.constraints;
  const hasConstraints = Array.isArray(constraints) && constraints.length > 0;
  const normWarnings = !!(norm?.validation?.length || norm?.warnings?.length || norm?.uncalibrated?.length);
  const normReviewed = norm?.status === "reviewed" || norm?.status === "approved";
  const assessed = run?.status === "done";
  const running = run?.status === "running" || run?.status === "queued";
  const assessmentFailed = run?.status === "failed" || run?.status === "cancelled";
  const analysisState: StageState = assessed ? "available" : "not_started";
  const analysisStatus = assessed ? "Available" : "Needs completed assessment";

  return [
    { id: "goal", label: "Goal and question", description: "Name the decision you want to make and the process you want to understand.", state: project?.question?.trim() ? "done" : "not_started", status: project?.question?.trim() ? "Question recorded" : "Define the question", screen: "dashboard" },
    { id: "data", label: "Data and readiness", description: issues.length ? `Review ${issues.length} data ${issues.length === 1 ? "caveat" : "caveats"} on the readiness page before interpreting results.` : "Load the event log and check what its timestamps, activities and missing data can support.", state: dataState, status: dataFailed ? "Checks need attention" : dataWarning ? "Review data caveats" : tableReady && readiness?.status === "pass" ? "Checks passed" : caseTable?.status === "building" ? "Preparing data" : tableReady ? "Checks unavailable" : datasets.length ? "Check mapping and readiness" : "Add data", screen: "data" },
    { id: "context", label: "Case and flow context", description: "Check what one case represents, which events belong to it, and which flow types belong together.", state: tableReady ? "available" : "not_started", status: tableReady ? "Review available" : "Needs a case table", screen: tableReady ? "context" : undefined },
    { id: "norm", label: "Process norm · constraints", description: "Start with the purpose and available evidence, then define expectations, priorities and review decisions.", state: normWarnings ? "gated" : hasConstraints && normReviewed ? "done" : hasConstraints ? "in_progress" : "not_started", status: normWarnings ? "Review needed" : hasConstraints && normReviewed ? "Review recorded" : hasConstraints ? "Draft constraints" : "Define constraints", screen: "norms" },
    { id: "weights", label: "Layers and views", description: "Inspect how constraints are grouped into layers and weighted in each view. Edit membership and weights in the structure editor; changes create a new version.", state: norm ? "available" : "not_started", status: norm ? "Definition available" : "Choose a Process norm", screen: norm ? "weights" : undefined },
    { id: "run", label: "Assessment", description: "Score the selected data against the Process norm. Results describe that assessment, not a validated explanation or an improvement.", state: assessmentFailed ? "gated" : running ? "in_progress" : assessed ? "available" : "not_started", status: assessmentFailed ? "Assessment did not finish" : running ? "Assessment in progress" : assessed ? "Results available" : runs.length ? "Choose an assessment" : "Run an assessment", screen: "runs" },
    { id: "explore", label: "Explore and ask process questions", description: "Explore recorded behavior, comparisons, paths and individual cases. Check which questions the available data can answer.", state: analysisState, status: analysisStatus, screen: assessed ? "investigate" : undefined },
    { id: "why", label: "Evidence and hypotheses", description: "Open a group, inspect its evidence, and record a question to test. A saved finding or an assessment alone does not validate a cause.", state: analysisState, status: assessed ? "Choose or revisit a group" : analysisStatus, screen: assessed ? "why" : undefined },
    { id: "act", label: "Recommendations", description: "Record a proposed action, owner and rationale for a group. Acceptance requires evidence and the relevant checks.", state: analysisState, status: assessed ? "Proposals available" : analysisStatus, screen: assessed ? "act" : undefined },
    { id: "pilot", label: "Pilot and outcome measures", description: "Agree a test, comparison, outcome measures and balancing measures before claiming improvement. A dedicated pilot workflow is planned.", state: "planned", status: "Planned" },
    { id: "follow_up", label: "Follow-up", description: "Compare measured outcomes over time and decide whether to adopt, adjust or stop a change. A dedicated follow-up workflow is planned.", state: "planned", status: "Planned" },
  ];
}
