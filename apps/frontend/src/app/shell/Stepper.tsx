import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useNormScope } from "./normScope";
import { ExistingAssessments } from "./ExistingAssessments";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isAnalysisNormLens, returnTarget, useNavStore } from "@/lib/stores/nav";
import { cn } from "@/lib/utils";
import type { WorkbenchContext } from "../context";
import { selectionParam } from "../search";
import { computeStages, mainJourney, type JourneyScreen, type StageInfo } from "./journey";

// Keep the existing analysis-step identities for the ribbon and keyboard navigation.
export type StepId = "goal" | "data" | "norm" | "run" | "signals" | "flow" | "why" | "act";

export function currentStep(pathname: string, origin?: string, search: { tab?: unknown; constraint?: unknown } = {}): StepId | undefined {
  if (/\/act$/.test(pathname)) return "act";
  if (/\/slices\//.test(pathname)) return "why";
  if (/\/(flow|board)$/.test(pathname)) return "flow";
  if (/\/(backlog|investigate)$/.test(pathname)) return "signals";
  if (/\/(notebook|knowledge)(\/|$)/.test(pathname)) return origin ? currentStep(origin) : undefined;
  if (isAnalysisNormLens(pathname, origin, search)) return "why";
  if (/\/runs/.test(pathname)) return "run";
  if (/\/norms/.test(pathname)) return "norm";
  if (/\/data/.test(pathname)) return "data";
  if (/^\/p\/[^/]+\/?$/.test(pathname)) return "goal";
  return undefined;
}

export function useCurrentStep(_ctx: WorkbenchContext): StepId | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const visited = useNavStore((s) => s.visited);
  return currentStep(pathname, returnTarget(visited, pathname)?.pathname, search);
}

/** Preserve the exact group selection when moving from evidence to recommendations. */
export function actHref(sliceHref: string): string {
  const [path = sliceHref, query] = sliceHref.split("?");
  return `${path.replace(/\/$/, "")}/act${query ? `?${query.replace(/(^|&)tab=[^&]*/g, "").replace(/^&/, "")}` : ""}`;
}

/** A remembered group from another project, assessment or view must not replace this context. */
export function sliceMatchesContext(href: string, ctx: Pick<WorkbenchContext, "projectId" | "run" | "view" | "slicing">): boolean {
  if (ctx.run?.status !== "done") return false;
  try {
    const url = new URL(href, "http://localhost");
    return url.pathname.startsWith(`/p/${encodeURIComponent(ctx.projectId)}/runs/${encodeURIComponent(ctx.run.id)}/slices/`)
      && (!ctx.view || url.searchParams.get("view") === ctx.view)
      && (!ctx.slicing || url.searchParams.get("slicing") === ctx.slicing);
  } catch {
    return false;
  }
}

/** A new assessment may inherit only a saved cohort verified against this preparation. */
function RunSetupLink({ctx, className, children, onNavigate}: {ctx: WorkbenchContext; className?: string; children: React.ReactNode; onNavigate?: () => void}) {
  const scope = useNormScope(ctx);
  if (scope.defining && scope.blockedReason) return <span className={cn(className, "cursor-default text-text-subtle")} aria-disabled="true" tabIndex={0} title={scope.blockedReason}>{children}</span>;
  return <Link to="/p/$projectId/runs" params={{projectId:ctx.projectId}} search={scope.defining ? {new:true,caseTable:scope.caseTableId,selection:scope.selection} : {}} className={className} onClick={onNavigate}>{children}</Link>;
}

function StageLink({ screen, ctx, className, children, onNavigate }: { screen?: JourneyScreen; ctx: WorkbenchContext; className?: string; children: React.ReactNode; onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const filter = useRouterState({ select: (s) => selectionParam((s.location.search as Record<string, unknown>).filter) });
  const browsingMinimum = useRouterState({ select: (s) => (s.location.search as Record<string, unknown>).minCases });
  const minCases = typeof browsingMinimum === "number" ? browsingMinimum : ctx.run?.minCases ?? undefined;
  const normScope = useNormScope(ctx);
  const remembered = useNavStore((s) => s.lastSlice);
  const lastSlice = remembered && sliceMatchesContext(remembered.href, ctx) ? remembered : undefined;
  const pid = ctx.projectId;
  // Preparation returns to the fixed project dataset, even from a historical assessment.
  // An unbound project needs an explicit preview; array order is not a dataset choice.
  const datasetId = ctx.datasetBinding?.datasetId ?? ctx.dataset?.id;
  const caseTableId = ctx.caseTable?.datasetId === datasetId ? ctx.caseTable?.id : undefined;

  const runId = ctx.run?.status === "done" ? ctx.run.id : undefined;
  const common = { className, onClick: onNavigate };
  const search = { slicing: ctx.slicing, view: ctx.view, filter };
  switch (screen) {
    case "dashboard":
      return <Link to="/p/$projectId" params={{ projectId: pid }} {...common}>{children}</Link>;
    case "data":
    case "context":
      return datasetId ? <Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId }} search={{ caseTable: caseTableId, tab: screen === "context" ? "flows" : "readiness" }} {...common}>{children}</Link>
        : <Link to="/p/$projectId/data" params={{ projectId: pid }} {...common}>{children}</Link>;
    case "norms":
    case "weights":
      if (normScope.blockedReason) return <span className={cn(className, "cursor-default text-text-subtle")} aria-disabled="true" tabIndex={0} title={normScope.blockedReason}>{children}</span>;
      return ctx.norm ? <Link to="/p/$projectId/norms/$normVersionId" params={{ projectId: pid, normVersionId: ctx.norm.id }} search={{ caseTable: caseTableId, selection: normScope.selection, tab: screen === "weights" ? "structure" : "guide" }} {...common}>{children}</Link>
        : <Link to="/p/$projectId/norms" params={{ projectId: pid }} {...common}>{children}</Link>;
    case "runs":
      if (/\/norms\/[^/]+$/.test(pathname)) return <RunSetupLink ctx={ctx} className={className} onNavigate={onNavigate}>{children}</RunSetupLink>;
      return ctx.run ? <Link to="/p/$projectId/runs/$runId" params={{ projectId: pid, runId: ctx.run.id }} search={{ tab: "monitor" }} {...common}>{children}</Link>
        : <Link to="/p/$projectId/runs" params={{ projectId: pid }} {...common}>{children}</Link>;
    case "investigate":
      if (runId) return <Link to="/p/$projectId/runs/$runId/investigate" params={{ projectId: pid, runId }} search={search} {...common}>{children}</Link>;
      break;
    case "flow":
      if (runId) return <Link to="/p/$projectId/runs/$runId/flow" params={{ projectId: pid, runId }} search={{ ...search, render: "map" }} {...common}>{children}</Link>;
      break;
    case "why":
    case "act":
      if (lastSlice) return <button type="button" className={className} onClick={() => { router.history.push(screen === "act" ? actHref(lastSlice.href) : lastSlice.href); onNavigate?.(); }} title={`${screen === "act" ? "What can we do about" : "Evidence for"} ${lastSlice.label}?`}>{children}</button>;
      // The prerequisite is named beside this link; the ranked list is where a group is chosen.
      if (runId) return <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: pid, runId }} search={{ ...search, minCases }} title="Choose a group to inspect evidence and propose an action" {...common}>{children}</Link>;
      break;
    case "signals":
      if (runId) return <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: pid, runId }} search={{ ...search, minCases }} {...common}>{children}</Link>;
      break;
  }
  return <span className={cn(className, "cursor-default text-text-subtle")} aria-disabled="true">{children}</span>;
}

function AllStages({ ctx, stages }: { ctx: WorkbenchContext; stages: StageInfo[] }) {
  const [open, setOpen] = useState(false);
  const step = useCurrentStep(ctx);
  const tab = useRouterState({ select: (s) => String((s.location.search as Record<string, unknown>).tab ?? "") });
  const current = step === "signals" || step === "flow" ? "explore" : step === "norm" && tab === "structure" ? "weights" : step === "data" && tab === "flows" ? "context" : step;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-text-muted" aria-label="All stages of your journey"><MoreHorizontal aria-hidden />All stages</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="All stages of your journey" align="end" className="max-h-[75vh] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        <p className="font-semibold">Your journey</p>
        <p className="mb-3 mt-1 text-xs text-text-muted">Open any available stage. Availability does not mean the work is completed.</p>
        <ol className="flex flex-col gap-3" aria-label="All stages">
          {stages.map((stage) => (
            <li key={stage.id} data-stage={stage.id} data-stage-state={stage.state} aria-current={current === stage.id ? "step" : undefined} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <StageLink screen={stage.screen} ctx={ctx} onNavigate={() => setOpen(false)} className={cn("rounded-sm font-medium", stage.screen && "text-accent-text hover:underline")}>
                  {stage.label}
                </StageLink>
                <span className={cn("text-xs", stage.state === "gated" ? "text-warning" : "text-text-subtle")}>{stage.status}</span>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">{stage.description}</p>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

/** Main decisions stay visible; only the current stage's substeps expand. */
export function Stepper({ ctx }: { ctx: WorkbenchContext }) {
  const current = useCurrentStep(ctx);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = useRouterState({ select: (s) => String((s.location.search as Record<string, unknown>).tab ?? "") });
  const remembered = useNavStore((s) => s.lastSlice);
  const hasGroup = !!remembered && sliceMatchesContext(remembered.href, ctx);
  const subline = useNavStore((s) => s.subline);
  const stages = computeStages(ctx);
  const stage = (id: string) => stages.find((s) => s.id === id)!;
  const phase = current === "signals" || current === "flow" || current === "why" || (current === "run" && tab === "flow") ? "analyse" : current;
  const pid = ctx.projectId;

  const assessed = ctx.run?.status === "done";
  const links: { id: string; label: string; screen?: JourneyScreen; status: StageInfo }[] = [
    { id: "goal", label: "Project", screen: "dashboard", status: stage("goal") },
    { id: "data", label: "Understand data", screen: "data", status: stage("data") },
    { id: "norm", label: "Process norm", screen: "norms", status: stage("norm") },
    { id: "run", label: "Run WISE", screen: "runs", status: stage("run") },
    { id: "analyse", label: "Analyse", screen: assessed ? "investigate" : undefined, status: stage("explore") },
    { id: "act", label: "Improve", screen: assessed ? "act" : undefined, status: stage("act") },
  ];
  const subClass = (active = false) => cn("inline-flex rounded-md px-3 py-1.5 text-sm", active ? "bg-accent-subtle font-semibold text-accent-text" : "text-text-muted hover:bg-surface-sunken hover:text-text");
  return <nav aria-label="Analysis path" className="shrink-0 border-b border-border bg-surface px-4" data-testid="stepper">
    <div className="flex flex-wrap items-center gap-2">
      <ol className="flex min-w-0 flex-1 flex-wrap gap-1 py-2" aria-label="Main steps">
        {links.map((item, index) => <li key={item.id} data-step={item.id} data-step-index={index + 1} data-step-state={item.status.state} aria-current={phase === item.id ? "step" : undefined} title={item.status.description}>
          {item.id === "run" ? <RunSetupLink ctx={ctx} className={cn(subClass(phase === item.id), "gap-2", phase === item.id && "text-base ring-1 ring-accent/40")}><span aria-hidden className="text-xs opacity-70">{index + 1}</span><span data-step-label>{mainJourney.find(step => step.id === item.id)?.label ?? item.label}</span></RunSetupLink>
            : <StageLink screen={item.screen} ctx={ctx} className={cn(subClass(phase === item.id), "gap-2", phase === item.id && "text-base ring-1 ring-accent/40")}>
              <span aria-hidden className="text-xs opacity-70">{index + 1}</span><span data-step-label>{mainJourney.find(step => step.id === item.id)?.label ?? item.label}</span>
            </StageLink>}
          {phase === item.id && subline && <span className="block max-w-[30rem] truncate px-3 text-xs text-text-muted" data-testid="step-subline" title={subline}>{subline}</span>}
        </li>)}
      </ol>
      <AllStages ctx={ctx} stages={stages} />
    </div>
    {phase === "data" && <ExistingAssessments ctx={ctx} />}
    {phase && phase !== "data" && phase !== "norm" && <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-border/60 py-1" role="group" aria-label="Substeps">
      {phase === "goal" && <>
        <Link to="/projects" className={subClass()}>All projects / new project</Link>
        <Link to="/p/$projectId/data" params={{ projectId: pid }} className={subClass()}>{ctx.datasetBinding?.datasetId ? "Project dataset" : "Select a dataset"}</Link>
        <Link to="/p/$projectId/norms" params={{ projectId: pid }} className={subClass()}>Create a Process norm</Link>
        <Link to="/p/$projectId/runs" params={{ projectId: pid }} className={subClass()}>Runs / new run</Link>
      </>}
      {phase === "run" && <>
        <Link to="/p/$projectId/runs" params={{ projectId: pid }} className={subClass(/\/runs$/.test(pathname))}>Runs / new run</Link>
        {ctx.run && <StageLink screen="runs" ctx={ctx} className={subClass(!/\/runs$/.test(pathname))}>Run status & results</StageLink>}
      </>}
      {phase === "analyse" && <>
        <StageLink screen="investigate" ctx={ctx} className={subClass(/\/investigate$/.test(pathname))}>Process questions</StageLink>
        <StageLink screen="signals" ctx={ctx} className={subClass(/\/backlog$/.test(pathname))}>Ranked groups</StageLink>
        <StageLink screen="flow" ctx={ctx} className={subClass(current === "flow" || tab === "flow")}>Flow</StageLink>
        <StageLink screen="why" ctx={ctx} className={subClass(current === "why")}>{hasGroup ? "Group evidence" : "Choose a group for evidence"}</StageLink>
      </>}
      {phase === "act" && <>
        <StageLink screen="why" ctx={ctx} className={subClass()}>Check the evidence</StageLink>
        <StageLink screen="act" ctx={ctx} className={subClass(true)}>Recommendations</StageLink>
        <Link to="/p/$projectId/notebook" params={{ projectId: pid }} search={{}} className={subClass()}>Analysis notebook</Link>
      </>}
    </div>}
  </nav>;
}
