import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import tokens from "@wise/design-tokens";
import { useVocabulary } from "@/components/Term";
import { useFindingStore } from "@/lib/stores/findings";
import { useNavStore } from "@/lib/stores/nav";
import { cn } from "@/lib/utils";
import type { WorkbenchContext } from "../context";
import { computeStages, type StageState } from "./journey";

export type StepId = "data" | "norm" | "run" | "signals" | "why" | "act";

interface Step {
  id: StepId;
  label: string;
  state: StageState;
  hint?: string;
  later?: string;
}

const RANK: Record<StageState, number> = { not_started: 0, in_progress: 1, gated: 2, done: 3 };
const worst = (...states: StageState[]): StageState => states.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));

export function currentStep(pathname: string): StepId | undefined {
  if (/\/slices\//.test(pathname)) return "why";
  if (/\/backlog$/.test(pathname)) return "signals";
  if (/\/runs/.test(pathname)) return "run";
  if (/\/norms/.test(pathname)) return "norm";
  if (/\/data/.test(pathname)) return "data";
  return undefined;
}

/**
 * The analysis path (R2-O6, R2-O8): Data → Norm → Run → Signals → Why → What to do across the top of every
 * screen, with arrows, the current step highlighted and every step a link to where its work happens.
 * The journey rail keeps the twelve stage states; the stepper is the primary navigation.
 */
export function Stepper({ ctx }: { ctx: WorkbenchContext }) {
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = currentStep(pathname);
  const findings = useFindingStore((s) => s.findings);
  const lastSlice = useNavStore((s) => s.lastSlice);

  const steps = useMemo<Step[]>(() => {
    const all = Object.values(findings).filter((f) => f.projectId === ctx.projectId);
    const stages = computeStages({ project: ctx.project, datasets: ctx.datasets, caseTable: ctx.caseTable, norms: ctx.norms, runs: ctx.runs, run: ctx.run, findings: all.length, dispositions: all.filter((f) => f.disposition).length, gatesPassed: 0 });
    const st = (id: string) => stages.find((s) => s.id === id)?.state ?? "not_started";
    return [
      { id: "data", label: "Data", state: worst(st("S1"), st("S2")), hint: "log, case notion, flow types, data caveats" },
      { id: "norm", label: "Norm", state: worst(st("S3"), st("S4")), hint: plain ? "the expectations and the perspectives" : "constraints, layers and views" },
      { id: "run", label: "Run", state: st("S5"), hint: "score the cases against the norm" },
      { id: "signals", label: plain ? "Signals" : "Backlog", state: st("S6"), hint: plain ? "where is it worst?" : "ranked slices" },
      { id: "why", label: "Why", state: worst(st("S7"), st("S8")), hint: plain ? "the reasons behind one group" : "drivers, contrast, flow" },
      { id: "act", label: "What to do", state: "not_started", later: "cycle 3" },
    ];
  }, [findings, ctx.projectId, ctx.project, ctx.datasets, ctx.caseTable, ctx.norms, ctx.runs, ctx.run, plain]);

  const pid = ctx.projectId;
  const datasetId = ctx.caseTable?.datasetId ?? ctx.dataset?.id ?? ctx.datasets[0]?.id;
  const doneRun = ctx.run?.status === "done" ? ctx.run : ctx.runs.find((r) => r.status === "done");

  const linkOf = (id: StepId) => {
    switch (id) {
      case "data":
        return datasetId ? { to: "/p/$projectId/data/$datasetId" as const, params: { projectId: pid, datasetId }, search: { caseTable: ctx.caseTable?.id, tab: "flows" as const } } : { to: "/p/$projectId/data" as const, params: { projectId: pid } };
      case "norm":
        return ctx.norm ? { to: "/p/$projectId/norms/$normVersionId" as const, params: { projectId: pid, normVersionId: ctx.norm.id }, search: { tab: "constraints" as const } } : { to: "/p/$projectId/norms" as const, params: { projectId: pid } };
      case "run":
        return ctx.run ? { to: "/p/$projectId/runs/$runId" as const, params: { projectId: pid, runId: ctx.run.id }, search: { tab: "monitor" as const } } : { to: "/p/$projectId/runs" as const, params: { projectId: pid } };
      case "signals":
        return doneRun ? { to: "/p/$projectId/runs/$runId/backlog" as const, params: { projectId: pid, runId: doneRun.id }, search: { slicing: ctx.slicing, view: ctx.view } } : { to: "/p/$projectId/runs" as const, params: { projectId: pid } };
      default:
        return undefined;
    }
  };

  return (
    <nav aria-label="Analysis path" className="border-b border-border bg-surface px-4" data-testid="stepper">
      <ol className="flex flex-wrap items-center gap-y-1 py-2 text-sm">
        {steps.map((s) => {
          const isCurrent = s.id === current;
          const glyph = tokens.semantic.stage[s.state].glyph;
          const cls = cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors duration-fast",
            isCurrent ? "bg-accent-subtle font-semibold text-accent-text ring-1 ring-accent/40" : "text-text-muted hover:bg-surface-sunken hover:text-text",
            s.later && "cursor-default opacity-60 hover:bg-transparent",
          );
          const inner = (
            <>
              <span aria-hidden className={cn("font-mono text-xs", s.state === "done" ? "text-success" : s.state === "gated" ? "text-warning" : s.state === "in_progress" ? "text-accent-text" : "text-text-subtle")}>
                {glyph}
              </span>
              <span>{s.label}</span>
              <span className="sr-only">
                : {s.state.replace("_", " ")}
                {s.later ? `, arrives in ${s.later}` : ""}
              </span>
            </>
          );
          const link = linkOf(s.id);
          return (
            <li key={s.id} className="stepper-arrow flex items-center" aria-current={isCurrent ? "step" : undefined} title={s.later ? `${s.label}: ${s.later}` : s.hint}>
              {s.id === "why" ? (
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
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
