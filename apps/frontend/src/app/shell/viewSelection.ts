import { useRouterState } from "@tanstack/react-router";
import type { WorkbenchContext } from "../context";
import { flowTypeOf } from "@/lib/api/runs";
import { normViewNames } from "@/lib/viewColors";

type ViewContext = Pick<WorkbenchContext, "projectId" | "norm" | "run">;
export interface ViewSelection {
  kind: "structure" | "scored";
  names: string[];
}

/** Views select weighting definitions or assessed scores, not raw data or one constraint's signal. */
export function viewSelectionForRoute(ctx: ViewContext, pathname: string, tab: unknown): ViewSelection | undefined {
  const path = pathname.replace(/\/$/, "");
  const project = `/p/${encodeURIComponent(ctx.projectId)}`;
  if (ctx.norm && path === `${project}/norms/${encodeURIComponent(ctx.norm.id)}` && tab === "structure") {
    const names = normViewNames(ctx.norm.norm);
    return names.length ? { kind: "structure", names } : undefined;
  }

  const run = ctx.run;
  if (run?.status !== "done") return undefined;
  const runPath = `${project}/runs/${encodeURIComponent(run.id)}`;
  if (path !== runPath && !path.startsWith(`${runPath}/`)) return undefined;
  const screen = path.slice(runPath.length);
  const group = /^\/slices\/[^/]+$/.test(screen);
  const scored = screen === "/backlog" || screen === "/board"
    || (screen === "" && tab === "compare" && !flowTypeOf(run))
    || /^\/slices\/[^/]+\/act$/.test(screen)
    || (group && tab !== "compared" && tab !== "distributions");
  // Descriptive process questions/maps and run monitoring do not use view weights.
  // Never borrow a draft norm's views when the selected run has no scored views.
  return scored && run.views?.length ? { kind: "scored", names: run.views } : undefined;
}

export function useViewSelection(ctx: ViewContext): ViewSelection | undefined {
  const location = useRouterState({ select: (state) => state.location });
  return viewSelectionForRoute(ctx, location.pathname, (location.search as Record<string, unknown>).tab);
}
