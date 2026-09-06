import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import tokens from "@wise/design-tokens";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFindingStore } from "@/lib/stores/findings";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import type { WorkbenchContext } from "../context";
import { computeStages, type StageInfo, type StageState } from "./journey";

const stateGlyph: Record<StageState, string> = {
  not_started: tokens.semantic.stage.not_started.glyph,
  in_progress: tokens.semantic.stage.in_progress.glyph,
  gated: tokens.semantic.stage.gated.glyph,
  done: tokens.semantic.stage.done.glyph,
};

const stateClass: Record<StageState, string> = {
  not_started: "text-text-subtle",
  in_progress: "text-accent-text",
  gated: "text-warning",
  done: "text-success",
};

function currentStage(pathname: string): string | undefined {
  if (/\/slices\//.test(pathname)) return "S7";
  if (/\/backlog$/.test(pathname)) return "S6";
  if (/\/runs/.test(pathname)) return "S5";
  if (/\/norms/.test(pathname)) return "S3";
  if (/\/data\/[^/]+/.test(pathname)) return "S2";
  if (/\/data$/.test(pathname)) return "S1";
  return "S0";
}

function StageLink({ stage, ctx, children, className }: { stage: StageInfo; ctx: WorkbenchContext; children: React.ReactNode; className?: string }) {
  const pid = ctx.projectId;
  const datasetId = ctx.dataset?.id ?? ctx.datasets[0]?.id;
  const runId = ctx.run?.status === "done" ? ctx.run.id : undefined;
  switch (stage.screen) {
    case "dashboard":
      return (
        <Link to="/p/$projectId" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    case "data":
      return (
        <Link to="/p/$projectId/data" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    case "dataset":
      return datasetId ? (
        <Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId }} search={{}} className={className}>
          {children}
        </Link>
      ) : (
        <Link to="/p/$projectId/data" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    case "norms":
      return (
        <Link to="/p/$projectId/norms" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    case "runs":
      return (
        <Link to="/p/$projectId/runs" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    case "backlog":
      return runId ? (
        <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: pid, runId }} search={{ slicing: ctx.slicing, view: ctx.view }} className={className}>
          {children}
        </Link>
      ) : (
        <Link to="/p/$projectId/runs" params={{ projectId: pid }} className={className}>
          {children}
        </Link>
      );
    default:
      return (
        <span className={cn(className, "cursor-default")} aria-disabled="true">
          {children}
        </span>
      );
  }
}

/** Journey rail (UX-2): twelve stages with states and "why gated"; stages can be visited in any order. */
export function JourneyRail({ ctx }: { ctx: WorkbenchContext }) {
  const { t } = useTranslation();
  const collapsed = useUiStore((s) => s.railCollapsed);
  const setCollapsed = useUiStore((s) => s.setRailCollapsed);
  const findings = useFindingStore((s) => s.findings);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = currentStage(pathname);

  const stages = useMemo(() => {
    const all = Object.values(findings).filter((f) => f.projectId === ctx.projectId);
    return computeStages({
      project: ctx.project,
      datasets: ctx.datasets,
      caseTable: ctx.caseTable,
      norms: ctx.norms,
      runs: ctx.runs,
      run: ctx.run,
      findings: all.length,
      dispositions: all.filter((f) => f.disposition).length,
      gatesPassed: 0,
    });
  }, [findings, ctx.projectId, ctx.project, ctx.datasets, ctx.caseTable, ctx.norms, ctx.runs, ctx.run]);

  return (
    <aside className={cn("sticky top-12 z-rail hidden h-[calc(100vh-48px)] shrink-0 flex-col border-r border-border bg-surface md:flex", collapsed ? "w-12" : "w-60")} aria-label={t("rail.title")}>
      <div className="flex items-center justify-between px-2 py-2">
        {!collapsed && <span className="text-xs font-medium uppercase tracking-wide text-text-subtle">{t("rail.title")}</span>}
        <Button variant="ghost" size="iconSm" aria-label={collapsed ? "Expand journey rail" : "Collapse journey rail"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto">
        <ol className="flex flex-col">
          {stages.map((s) => {
            const label = t(`rail.stages.${s.id}`);
            const stateLabel = t(`rail.state.${s.state}`);
            const isCurrent = s.id === current;
            return (
              <li key={s.id} className={cn("border-l-2", isCurrent ? "border-accent bg-selection/50" : "border-transparent")} aria-current={isCurrent ? "step" : undefined}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <StageLink stage={s} ctx={ctx} className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-sm text-sm hover:underline", s.later && "text-text-subtle no-underline hover:no-underline")}>
                    <span aria-hidden className={cn("w-4 text-center font-mono text-sm", stateClass[s.state])}>
                      {stateGlyph[s.state]}
                    </span>
                    {!collapsed && (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={label}>
                          <span className="mr-1 font-mono text-xs text-text-subtle">{s.id}</span>
                          {label}
                        </span>
                        <span className={cn("block text-xs", stateClass[s.state])}>
                          {stateLabel}
                          {s.later && ` · ${s.later}`}
                        </span>
                      </span>
                    )}
                    <span className="sr-only">
                      {s.id} {label}: {stateLabel}
                    </span>
                  </StageLink>
                  {s.state === "gated" && s.why && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="rounded-sm px-1 text-xs text-warning underline decoration-dotted" aria-label={`${t("rail.whyGated")}: ${label}`}>
                          {collapsed ? "?" : t("rail.whyGated")}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right">
                        <p className="mb-1 text-sm font-semibold">{t("rail.whyGated")}</p>
                        <p className="text-sm text-text-muted">{s.why}</p>
                        {s.fixAt && (
                          <p className="mt-2 text-sm">
                            {t("rail.fixAt")}:{" "}
                            <StageLink stage={{ ...s, screen: s.fixAt.screen }} ctx={ctx} className="text-accent-text underline">
                              {t(`rail.stages.${s.id}`)}
                            </StageLink>
                          </p>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
