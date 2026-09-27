import { describe, expect, it } from "vitest";
import type { CaseTable, NormVersion, Run } from "@wise/api-schema";
import { computeStages, type JourneyInput } from "./journey";
import { sliceMatchesContext } from "./Stepper";

const run: Run = { id: "assessment", status: "done", caseTableId: "table", normVersionId: "norm", paramsHash: "params", createdAt: "2026-09-27" };
const table: CaseTable = { id: "table", datasetId: "data", status: "ready", cases: 12, createdAt: "2026-09-27" };
const norm: NormVersion = { id: "norm", normId: "process-norm", name: "Request handling", version: 1, fingerprint: "norm", status: "draft", createdAt: "2026-09-27", norm: { constraints: [{ id: "rule" }], layers: [{ id: "layer" }], views: [{ name: "View" }] } };
const base: JourneyInput = { datasets: [], norms: [norm], runs: [run], run, caseTable: table };
const stage = (id: string, input: JourneyInput = base) => computeStages(input).find((row) => row.id === id)!;

describe("journey evidence and availability", () => {
  it("does not turn a completed assessment into reviewed data, constraints, evidence or actions", () => {
    expect(stage("run")).toMatchObject({ state: "available", status: "Results available" });
    expect(stage("data")).toMatchObject({ state: "not_started", status: "Checks unavailable" });
    expect(stage("norm")).toMatchObject({ state: "in_progress", status: "Draft constraints" });
    for (const id of ["weights", "context", "explore", "why", "act"]) expect(stage(id).state).toBe("available");
    expect(stage("pilot")).toMatchObject({ state: "planned", status: "Planned" });
    expect(stage("follow_up").screen).toBeUndefined();
  });

  it.each(["warn", "fail"] as const)("keeps %s readiness visible even with assessment results", (status) => {
    const input = { ...base, caseTable: { ...table, readiness: { status, items: [{ id: "coverage", level: status, message: "Check event coverage." }] } } };
    expect(stage("data", input)).toMatchObject({ state: "gated", description: "Review 1 data caveat on the readiness page before interpreting results.", screen: "data" });
    expect(stage("run", input).state).toBe("available");
  });

  it("uses explicit readiness and norm review records for their own stages only", () => {
    const input = { ...base, caseTable: { ...table, readiness: { status: "pass" as const } }, norm: { ...norm, status: "reviewed" as const } };
    expect(stage("data", input)).toMatchObject({ state: "done", status: "Checks passed" });
    expect(stage("norm", input)).toMatchObject({ state: "done", status: "Review recorded" });
    expect(stage("why", input).state).toBe("available");
    expect(stage("norm", { ...input, norm: { ...input.norm, uncalibrated: ["rule"] } }).status).toBe("Review needed");
  });

  it.each([undefined, "queued", "running", "failed", "cancelled"] as const)("does not borrow an older completed assessment when the selected assessment is %s", (status) => {
    const input = { ...base, run: status ? { ...run, id: "selected", status } : undefined };
    for (const id of ["explore", "why", "act"]) {
      expect(stage(id, input)).toMatchObject({ state: "not_started", status: "Needs completed assessment" });
      expect(stage(id, input).screen).toBeUndefined();
    }
    expect(stage("run", input).state).not.toBe("available");
  });

  it("does not borrow review status from a different Process norm", () => {
    const input = { ...base, norms: [{ ...norm, id: "other", status: "approved" as const }] };
    expect(stage("norm", input)).toMatchObject({ state: "not_started", status: "Define constraints" });
    expect(stage("weights", input).screen).toBeUndefined();
  });

  it("needs an actual question and keeps pilot and follow-up unavailable", () => {
    const project = { id: "project", name: "Service requests", question: "   ", createdAt: "2026-09-27" };
    expect(stage("goal", { ...base, project }).state).toBe("not_started");
    expect(stage("goal", { ...base, project: { ...project, question: "Why are requests repeated?" } }).status).toBe("Question recorded");
    expect(stage("pilot").screen).toBeUndefined();
    expect(stage("follow_up").screen).toBeUndefined();
  });
});

describe("remembered evidence context", () => {
  const ctx = { projectId: "project", run, view: "View", slicing: "team" };
  const href = "/p/project/runs/assessment/slices/group?view=View&slicing=team&filter=7";
  it("accepts the same group context with its original raw filter", () => expect(sliceMatchesContext(href, ctx)).toBe(true));
  it.each([
    { ...ctx, projectId: "other" },
    { ...ctx, run: { ...run, id: "other" } },
    { ...ctx, run: { ...run, status: "running" as const } },
    { ...ctx, view: "Other view" },
    { ...ctx, slicing: "other" },
  ])("rejects remembered evidence from a different selection", (changed) => expect(sliceMatchesContext(href, changed)).toBe(false));
});
