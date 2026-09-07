import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import tokens from "@wise/design-tokens";
import { useVocabulary } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFindingStore } from "@/lib/stores/findings";
import { returnTarget, useNavStore } from "@/lib/stores/nav";
import { GUIDED_STEPS, useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import type { WorkbenchContext } from "../context";
import { computeStages, type StageInfo, type StageState } from "./journey";

export type StepId = "data" | "norm" | "run" | "signals" | "flow" | "why" | "act";

interface Step {
  id: StepId;
  label: string;
  state: StageState;
  /** The amber caption of a gated step, at most five words. */
  caption?: string;
  hint?: string;
  later?: string;
}

/**
 * The step a screen belongs to. Sub-screens never occupy a step of their own: the norm's lens opened from a
 * reason screen stays under Why, the notebook stays under the step it was opened from (`origin` is the
 * pathname the reader came from, taken from the navigation stack).
 */
export function currentStep(pathname: string, origin?: string): StepId | undefined {
  if (/\/act$/.test(pathname)) return "act";
  if (/\/slices\//.test(pathname)) return "why";
  if (/\/(flow|board)$/.test(pathname)) return "flow";
  if (/\/backlog$/.test(pathname)) return "signals";
  if (/\/(notebook|knowledge)(\/|$)/.test(pathname)) return origin ? currentStep(origin) : undefined;
  if (/\/norms\/[^/]+$/.test(pathname) && origin && /\/slices\//.test(origin)) return "why";
  if (/\/runs/.test(pathname)) return "run";
  if (/\/norms/.test(pathname)) return "norm";
  if (/\/data/.test(pathname)) return "data";
  return undefined;
}

/** The current step of the shell, with the navigation stack's origin considered, and the dashboard on Signals once a run is scored. */
export function useCurrentStep(ctx: WorkbenchContext): StepId | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visited = useNavStore((s) => s.visited);
  const origin = returnTarget(visited, pathname)?.pathname;
  const step = currentStep(pathname, origin);
  if (step) return step;
  const dashboard = /^\/p\/[^/]+\/?$/.test(pathname);
  if (dashboard) return ctx.runs.some((r) => r.status === "done") ? "signals" : "data";
  return undefined;
}

/** The seventh step of the group the reader last opened: the reason screen's address with `/act` on its path. */
export function actHref(sliceHref: string): string {
  const [path = sliceHref, query] = sliceHref.split("?");
  return `${path.replace(/\/$/, "")}/act${query ? `?${query.replace(/(^|&)tab=[^&]*/g, "").replace(/^&/, "")}` : ""}`;
}

const STEP_GLYPH: Record<StageState | "current", string> = {
  done: tokens.semantic.stage.done.glyph,
  in_progress: tokens.semantic.stage.in_progress.glyph,
  gated: tokens.semantic.stage.gated.glyph,
  not_started: tokens.semantic.stage.not_started.glyph,
  current: "◉",
};

function StageLink({ stage, ctx, className, children }: { stage: StageInfo; ctx: WorkbenchContext; className?: string; children: React.ReactNode }) {
  const pid = ctx.projectId;
  const datasetId = ctx.caseTable?.datasetId ?? ctx.dataset?.id ?? ctx.datasets[0]?.id;
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
        <Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId }} search={{ caseTable: ctx.caseTable?.id, tab: "readiness" }} className={className}>
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
        <span className={cn(className, "cursor-default text-text-subtle")} aria-disabled="true">
          {children}
        </span>
      );
  }
}

/** The twelve stages of the method behind "All stages", for analysts. */
function AllStages({ ctx }: { ctx: WorkbenchContext }) {
  const { t } = useTranslation();
  const findings = useFindingStore((s) => s.findings);
  const stages = useMemo(() => {
    const all = Object.values(findings).filter((f) => f.projectId === ctx.projectId);
    return computeStages({ project: ctx.project, datasets: ctx.datasets, caseTable: ctx.caseTable, norms: ctx.norms, runs: ctx.runs, run: ctx.run, findings: all.length, dispositions: all.filter((f) => f.disposition).length, gatesPassed: 0 });
  }, [findings, ctx.projectId, ctx.project, ctx.datasets, ctx.caseTable, ctx.norms, ctx.runs, ctx.run]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-text-muted" aria-label="All stages of the method">
          <MoreHorizontal aria-hidden />
          All stages
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-subtle">{t("rail.title")} · the twelve stages</p>
        <ol className="flex flex-col gap-0.5" aria-label="All stages">
          {stages.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span aria-hidden className={cn("w-4 text-center font-mono text-xs", s.state === "done" ? "text-text" : s.state === "gated" ? "text-warning" : "text-text-subtle")}>
                {STEP_GLYPH[s.state]}
              </span>
              <StageLink stage={s} ctx={ctx} className="min-w-0 flex-1 truncate rounded-sm hover:underline">
                <span className="mr-1 font-mono text-xs text-text-subtle">{s.id}</span>
                {t(`rail.stages.${s.id}`)}
              </StageLink>
              <span className="text-xs text-text-subtle">{t(`rail.state.${s.state}`)}{s.later ? ` · ${s.later}` : ""}</span>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The analysis path across the top of every screen: Data ▶ Norm ▶ Run ▶ Signals ▶ Flow ▶ Why ▶ What to do.
 * States come from the data itself (a case table, a scored norm, a finished run, a group opened, a finding),
 * the current step carries the accent ring and "you are here", a sub-screen shows as a second line under its
 * step, and every step is a link to where its work happens. `Alt+1` … `Alt+7` press the steps.
 */
export function Stepper({ ctx }: { ctx: WorkbenchContext }) {
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  const router = useRouter();
  const current = useCurrentStep(ctx);
  const subline = useNavStore((s) => s.subline);
  const findings = useFindingStore((s) => s.findings);
  const lastSlice = useNavStore((s) => s.lastSlice);
  const guided = useUiStore((s) => s.mode === "guided");

  const doneRun = ctx.run?.status === "done" ? ctx.run : ctx.runs.find((r) => r.status === "done");
  const steps = useMemo<Step[]>(() => {
    const findingCount = Object.values(findings).filter((f) => f.projectId === ctx.projectId).length;
    const activeRun = ctx.runs.find((r) => r.status === "queued" || r.status === "running");
    const failedRun = !doneRun && ctx.runs.find((r) => r.status === "failed");
    const normScored = !!doneRun && ctx.norms.some((n) => n.id === doneRun.normVersionId);
    return [
      { id: "data", label: "Data", state: ctx.caseTable ? "done" : ctx.datasets.length ? "in_progress" : "not_started", hint: "log, case notion, flow types, data caveats", caption: !ctx.caseTable && ctx.datasets.length ? "needs a case table" : undefined },
      { id: "norm", label: "Norm", state: normScored ? "done" : ctx.norms.length ? "in_progress" : "not_started", hint: plain ? "the expectations and the perspectives" : "constraints, layers and views" },
      { id: "run", label: "Run", state: doneRun ? "done" : failedRun ? "gated" : activeRun ? "in_progress" : "not_started", hint: "score the cases against the norm", caption: failedRun ? "last run failed" : undefined },
      { id: "signals", label: plain ? "Signals" : "Backlog", state: doneRun ? (lastSlice || findingCount ? "done" : "in_progress") : ctx.runs.length ? "gated" : "not_started", hint: plain ? "where is it worst?" : "ranked slices", caption: !doneRun && ctx.runs.length ? "needs a finished run" : undefined },
      { id: "flow", label: "Flow", state: doneRun ? "in_progress" : ctx.runs.length ? "gated" : "not_started", hint: "the process map as the instrument; the board beside it", caption: !doneRun && ctx.runs.length ? "needs a finished run" : undefined },
      { id: "why", label: "Why", state: findingCount ? "done" : "not_started", hint: plain ? "the reasons behind one group" : "drivers, contrast, flow" },
      // the seventh step is a screen from cycle 4 on (R3-01): it opens for the group the reader last read
      { id: "act", label: plain ? "What can we do?" : "What to do", state: lastSlice ? "in_progress" : doneRun ? "gated" : "not_started", hint: "the drivers, their possible gain, the usual reasons and actions", caption: !lastSlice && doneRun ? "open a group first" : undefined },
    ];
  }, [findings, ctx.projectId, ctx.runs, ctx.norms, ctx.caseTable, ctx.datasets.length, doneRun, lastSlice, plain]);
  /**
   * Guided mode walks one path (R3-10): where is it worst, why is it worst there, and what can we do about
   * it. Loading a log, writing a norm and scoring a run are the analyst's work, and a reader who is shown
   * them as steps of their own path reads seven labels to find the three that are theirs.
   */
  const path = useMemo(() => (guided ? steps.filter((s) => (GUIDED_STEPS as readonly string[]).includes(s.id)) : steps), [guided, steps]);

  const pid = ctx.projectId;
  const datasetId = ctx.caseTable?.datasetId ?? ctx.dataset?.id ?? ctx.datasets[0]?.id;

  const linkOf = (id: StepId) => {
    switch (id) {
      case "data":
        return datasetId ? { to: "/p/$projectId/data/$datasetId" as const, params: { projectId: pid, datasetId }, search: { caseTable: ctx.caseTable?.id, tab: "readiness" as const } } : { to: "/p/$projectId/data" as const, params: { projectId: pid } };
      case "norm":
        return ctx.norm ? { to: "/p/$projectId/norms/$normVersionId" as const, params: { projectId: pid, normVersionId: ctx.norm.id }, search: { tab: "constraints" as const } } : { to: "/p/$projectId/norms" as const, params: { projectId: pid } };
      case "run":
        return ctx.run ? { to: "/p/$projectId/runs/$runId" as const, params: { projectId: pid, runId: ctx.run.id }, search: { tab: "monitor" as const } } : { to: "/p/$projectId/runs" as const, params: { projectId: pid } };
      case "signals":
        return doneRun ? { to: "/p/$projectId/runs/$runId/backlog" as const, params: { projectId: pid, runId: doneRun.id }, search: { slicing: ctx.slicing, view: ctx.view } } : { to: "/p/$projectId/runs" as const, params: { projectId: pid } };
      case "flow":
        return doneRun ? { to: "/p/$projectId/runs/$runId/flow" as const, params: { projectId: pid, runId: doneRun.id }, search: { slicing: ctx.slicing, view: ctx.view, render: "map" as const } } : { to: "/p/$projectId/runs" as const, params: { projectId: pid } };
      default:
        return undefined;
    }
  };

  return (
    <nav aria-label="Analysis path" className="border-b border-border bg-surface px-4" data-testid="stepper">
      <div className="flex items-start gap-2">
        <ol className="flex min-w-0 flex-1 flex-wrap items-start gap-y-1 py-2 text-sm">
          {path.map((s, i) => {
            const isCurrent = s.id === current;
            const glyph = isCurrent ? STEP_GLYPH.current : STEP_GLYPH[s.state];
            const cls = cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors duration-fast",
              isCurrent ? "bg-accent-subtle font-semibold text-accent-text ring-1 ring-accent/40" : "text-text-muted hover:bg-surface-sunken hover:text-text",
              s.later && "cursor-default opacity-60 hover:bg-transparent",
            );
            const inner = (
              <>
                <span aria-hidden data-step-glyph className={cn("font-mono text-xs", isCurrent ? "text-accent-text" : s.state === "done" ? "text-text" : s.state === "gated" ? "text-warning" : "text-text-subtle")}>
                  {glyph}
                </span>
                <span data-step-label>{s.label}</span>
                <span className="sr-only">
                  : {isCurrent ? "you are here" : s.state.replace("_", " ")}
                  {s.later ? `, ${s.later}` : ""}
                </span>
              </>
            );
            const link = linkOf(s.id);
            const caption = isCurrent ? "you are here" : s.caption;
            return (
              <li key={s.id} className="flex items-start" data-step={s.id} data-step-index={i + 1} aria-current={isCurrent ? "step" : undefined} title={s.later ? `${s.label}: ${s.later}` : s.hint}>
                <div className="flex flex-col items-start">
                  {s.id === "act" ? (
                    lastSlice ? (
                      <button type="button" className={cls} onClick={() => router.history.push(actHref(lastSlice.href))} title={`What can we do about ${lastSlice.label}?`}>
                        {inner}
                      </button>
                    ) : doneRun ? (
                      <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: pid, runId: doneRun.id }} search={{ slicing: ctx.slicing, view: ctx.view }} className={cls} title="Open a group first; What can we do? answers for one group">
                        {inner}
                      </Link>
                    ) : (
                      <span className={cls} aria-disabled="true">
                        {inner}
                      </span>
                    )
                  ) : s.id === "why" ? (
                    lastSlice ? (
                      <button type="button" className={cls} onClick={() => router.history.push(lastSlice.href)} title={`Back to ${lastSlice.label}`}>
                        {inner}
                      </button>
                    ) : doneRun ? (
                      <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: pid, runId: doneRun.id }} search={{ slicing: ctx.slicing, view: ctx.view }} className={cls} title="Pick a group on the signals list and press Why?">
                        {inner}
                      </Link>
                    ) : (
                      <span className={cls}>{inner}</span>
                    )
                  ) : link ? (
                    <Link to={link.to} params={link.params} search={link.search as never} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <span className={cls} aria-disabled="true">
                      {inner}
                    </span>
                  )}
                  {caption && (
                    <span aria-hidden className={cn("pl-2.5 text-[11px] leading-4", isCurrent ? "text-accent-text" : s.state === "gated" ? "text-warning" : "text-text-subtle")} data-testid={isCurrent ? "you-are-here" : undefined}>
                      {isCurrent ? "▲ you are here" : caption}
                    </span>
                  )}
                  {isCurrent && subline && (
                    <span className="max-w-[420px] truncate pl-2.5 text-xs text-text-muted" data-testid="step-subline" title={subline}>
                      └ {subline}
                    </span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <span aria-hidden className="mx-1 mt-1.5 text-[12px] leading-4 text-text-subtle">
                    ▶
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="py-1.5">
          <AllStages ctx={ctx} />
        </div>
      </div>
    </nav>
  );
}
