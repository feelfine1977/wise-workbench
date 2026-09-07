/**
 * The page header the Flow step and the board share (§3.2, §4.2): the back control, the title with one
 * reading sentence, the `Flow | Board` switch — two arrangements of one step, so context, filter, chips and
 * selection survive the switch — and the camera. 68 px at 1440, 60 at 1024.
 */
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BackControl } from "@/components/guide/BackControl";
import { cn } from "@/lib/utils";

export function StepHeader({
  projectId,
  runId,
  title,
  sentence,
  active,
  search,
  backFallback,
  actions,
  className,
}: {
  projectId: string;
  runId: string;
  title: string;
  sentence: ReactNode;
  active: "flow" | "board";
  /** The state both arrangements share; it travels with the switch untouched. */
  search: Record<string, unknown>;
  backFallback?: { href: string; label: string };
  actions?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const go = (to: "flow" | "board") => {
    if (to === active) return;
    void navigate({
      to: to === "flow" ? "/p/$projectId/runs/$runId/flow" : "/p/$projectId/runs/$runId/board",
      params: { projectId, runId },
      search: search as never,
    });
  };
  return (
    <header className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackControl fallback={backFallback} />
        <div className="flex items-center gap-2" data-no-capture>
          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Flow or board">
            {(["flow", "board"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={active === k}
                data-testid={`switch-${k}`}
                onClick={() => go(k)}
                className={cn("px-3 py-1 text-sm capitalize", active === k ? "bg-accent-subtle font-medium text-accent-text" : "text-text-muted hover:bg-surface-sunken")}
              >
                {k}
              </button>
            ))}
          </span>
          {actions}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="reading text-sm text-text-muted" data-testid="step-sentence">
          {sentence}
        </p>
      </div>
    </header>
  );
}
