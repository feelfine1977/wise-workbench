import { describe, expect, it } from "vitest";
import type { NormVersion, Run } from "@wise/api-schema";
import { viewSelectionForRoute } from "./viewSelection";

const norm: NormVersion = { id: "norm", normId: "process-norm", name: "Requests", version: 1, fingerprint: "norm", status: "draft", createdAt: "2026-09-27", norm: { views: [{ name: "Draft weighting" }] } };
const run: Run = { id: "assessment", status: "done", caseTableId: "table", normVersionId: "norm", paramsHash: "params", createdAt: "2026-09-27", views: ["Assessed weighting"] };
const ctx = { projectId: "project", norm, run };
const select = (path: string, tab?: string) => viewSelectionForRoute(ctx, path, tab);

type RouteCase = [path: string, tab: string | undefined];

describe("view controls belong to weighting and scored analysis", () => {
  it.each<RouteCase>([
    ["/", undefined],
    ["/projects", undefined],
    ["/p/project", undefined],
    ["/p/project/data", undefined],
    ...["understand", "overview", "mapping", "readiness", "flows"].map<RouteCase>(tab => ["/p/project/data/dataset", tab]),
    ["/p/project/norms", undefined],
    ...[undefined, "constraints", "review", "json", "history"].map<RouteCase>(tab => ["/p/project/norms/norm", tab]),
    ["/p/project/runs", undefined],
    ...[undefined, "monitor", "flow"].map<RouteCase>(tab => ["/p/project/runs/assessment", tab]),
    ["/p/project/runs/assessment/flow", undefined],
    ["/p/project/runs/assessment/investigate", undefined],
    ["/p/project/runs/assessment/slices/group", "compared"],
    ["/p/project/runs/assessment/slices/group", "distributions"],
    ["/p/project/notebook", undefined],
    ["/p/project/knowledge", undefined],
  ])("hides controls at %s, tab %s despite available views", (path, tab) => {
    expect(select(path, tab)).toBeUndefined();
  });

  it("uses the edited norm's views only on structure, including before the first assessment", () => {
    expect(viewSelectionForRoute({ ...ctx, run: undefined }, "/p/project/norms/norm", "structure"))
      .toEqual({ kind: "structure", names: ["Draft weighting"] });
    expect(select("/p/project/norms/norm/", "structure")?.kind).toBe("structure");
    expect(select("/p/project/norms/missing", "structure")).toBeUndefined();
    expect(viewSelectionForRoute({ ...ctx, norm: undefined }, "/p/project/norms/norm", "structure")).toBeUndefined();
    expect(viewSelectionForRoute({ ...ctx, norm: { ...norm, norm: {} } }, "/p/project/norms/norm", "structure")).toBeUndefined();
  });

  it.each<RouteCase>([
    ["/p/project/runs/assessment/backlog", "signals"],
    ["/p/project/runs/assessment/board", undefined],
    ["/p/project/runs/assessment", "compare"],
    ["/p/project/runs/assessment/slices/group", undefined],
    ...["why", "gain", "cases", "trust", "flow"].map<RouteCase>(tab => ["/p/project/runs/assessment/slices/group", tab]),
    ["/p/project/runs/assessment/slices/group/act", undefined],
  ])("offers only the selected run's scored views at %s, tab %s", (path, tab) => {
    expect(select(path, tab)).toEqual({ kind: "scored", names: ["Assessed weighting"] });
  });

  it.each(["queued", "running", "failed", "cancelled"] as const)("does not offer scored views for a %s assessment", status => {
    expect(viewSelectionForRoute({ ...ctx, run: { ...run, status } }, "/p/project/runs/assessment/backlog", undefined)).toBeUndefined();
  });

  it("never borrows another run, project or draft's views for an unavailable analysis", () => {
    for (const path of ["/p/project/runs/missing/backlog", "/p/project/runs/assessment-other/backlog", "/p/other/runs/assessment/backlog"]) {
      expect(select(path)).toBeUndefined();
    }
    for (const views of [undefined, []]) {
      expect(viewSelectionForRoute({ ...ctx, run: { ...run, views } }, "/p/project/runs/assessment/backlog", undefined)).toBeUndefined();
    }
    expect(viewSelectionForRoute({ ...ctx, run: undefined }, "/p/project/runs/assessment/backlog", undefined)).toBeUndefined();
    expect(viewSelectionForRoute({ ...ctx, run: { ...run, scope: { flow_type: "scoped" } } }, "/p/project/runs/assessment", "compare")).toBeUndefined();
  });
});
