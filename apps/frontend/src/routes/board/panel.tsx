/**
 * The panel contract (§5): every panel on the board declares what it answers, where its numbers come from,
 * how it is bound to the board's filter, the shape of its answer and therefore the charts it may use, the
 * one sentence above its chart and the clause a click on each of its elements adds. The later dashboard
 * builder adds movement and configuration on top of this; it does not need new panels.
 */
import type { ReactNode } from "react";
import { Info, Lock, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorBlock } from "@/components/states";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export type PanelBinding = "linked" | "fixed" | "baseline";
export type PanelShape = "graph" | "rows" | "distribution" | "categories" | "scalar";

export interface PanelSpec {
  id: string;
  /** The title is the question in plain words, never a noun phrase of the method. */
  title: string;
  /** One data source with the parameters it fills from the context; one request per selection. */
  source: string;
  binding: PanelBinding;
  shape: PanelShape;
  chart: string;
  /** The clause a click on each element adds (§4.5). */
  emits: string;
  /** Minimum and default columns × row units of the twelve-column grid. */
  size: { min: [number, number]; default: [number, number] };
}

export const PANELS = {
  kpis: {
    id: "kpis",
    title: "How big, how far off, how much is at stake, how much is unfinished",
    source: "the run's summary and the filter preview under the canonical filter",
    binding: "linked",
    shape: "scalar",
    chart: "number with its comparison to all items",
    emits: "nothing: a tile is a readout",
    size: { min: [3, 1], default: [3, 1] },
  },
  "flow-map": {
    id: "flow-map",
    title: "Where in the flow?",
    source: "the run's flow (grouping, slice key, detail level, filter, focus)",
    binding: "linked",
    shape: "graph",
    chart: "process map, with the model as its second rendering",
    emits: "activity, path, stage and expectation clauses",
    size: { min: [4, 2], default: [7, 3] },
  },
  "worst-groups": {
    id: "worst-groups",
    title: "Where is it worst?",
    source: "the run's ranked groups (grouping, perspective, γ, minimum items, sort, filter)",
    binding: "linked",
    shape: "rows",
    chart: "ranked one-line cards with priority bars",
    emits: "a group clause; Enter leaves the board for the Why screen",
    size: { min: [4, 2], default: [5, 3] },
  },
  distribution: {
    id: "distribution",
    title: "How far off?",
    source: "one expectation's distribution (grouping, slice key, filter, scale)",
    binding: "linked",
    shape: "distribution",
    chart: "histogram with the expectation line and the tolerance band, both series",
    emits: "range and expectation-state clauses",
    size: { min: [4, 2], default: [6, 2] },
  },
  breakdown: {
    id: "breakdown",
    title: "How does it split?",
    source: "the run's counts by a facet under the same filter — flow type, period, any case attribute",
    binding: "linked",
    shape: "categories",
    chart: "horizontal bars, sorted by the measure, value at the end",
    emits: "attribute and time clauses",
    size: { min: [4, 2], default: [6, 2] },
  },
} satisfies Record<string, PanelSpec>;

export interface PanelProps {
  spec: PanelSpec;
  /** One line above the chart: what is shown and for whom, at most three numbers, no ids. */
  sentence?: ReactNode;
  /** A number in the panel's corner (the ranked list's "10 of 30"). */
  count?: ReactNode;
  /** The panel is not linked to the board's filter: the lock chip and the words that name it. */
  lock?: string;
  expanded?: boolean;
  onExpand?: () => void;
  /** Numbers are being recomputed: the previous ones stay, dimmed, with the updating dot. */
  updating?: boolean;
  error?: unknown;
  /** The way out of a failure this panel knows about (R3-12): *open the board without the filter*. */
  errorAction?: { label: string; onClick?: () => void };
  onRetry?: () => void;
  loading?: boolean;
  /** Height of the chart body, so a skeleton has the panel's final size. */
  bodyHeight?: number;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Panel chrome is one line: the title as a plain question, the explanation, the expansion, and — when the
 * panel is not linked — the lock chip. Nothing blanks while numbers are recomputed and nothing moves.
 */
export function Panel({ spec, sentence, count, lock, expanded, onExpand, updating, error, errorAction, onRetry, loading, bodyHeight = 200, children, actions, className }: PanelProps) {
  return (
    <section
      aria-label={spec.title}
      data-panel={spec.id}
      className={cn("surface flex min-w-0 flex-col gap-2 p-3", expanded && "fixed inset-2 z-overlay overflow-auto", className)}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">{spec.title}</h2>
        {lock && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted" title={lock}>
            <Lock className="size-3" aria-hidden />
            all items
          </span>
        )}
        {updating && (
          <span className="inline-flex items-center gap-1 text-[11px] text-text-subtle" role="status">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
            updating
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {count}
          {actions}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`How ${spec.title} is computed`}>
                <Info className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm">
              <p className="font-medium">{spec.title}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-muted">
                <dt>from</dt>
                <dd>{spec.source}</dd>
                <dt>follows</dt>
                <dd>{spec.binding === "linked" ? "the board's filter" : spec.binding === "baseline" ? "nothing: all items, always" : "a filter fixed when it was configured"}</dd>
                <dt>drawn as</dt>
                <dd>{spec.chart}</dd>
                <dt>a click adds</dt>
                <dd>{spec.emits}</dd>
              </dl>
            </PopoverContent>
          </Popover>
          {onExpand && (
            <Button variant="ghost" size="sm" aria-label={expanded ? `Close ${spec.title}` : `Open ${spec.title} in the full window`} aria-pressed={expanded} onClick={onExpand}>
              {expanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
            </Button>
          )}
        </span>
      </header>
      {sentence && <p className="reading text-sm text-text">{sentence}</p>}
      {error ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">This panel could not be computed for this selection.</p>
          <ErrorBlock error={error} retry={onRetry} action={errorAction} />
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-2" style={{ minHeight: bodyHeight }} role="status" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="flex-1" style={{ height: bodyHeight - 40 }} />
        </div>
      ) : (
        <div className={cn("flex min-w-0 flex-1 flex-col", updating && "opacity-60 transition-opacity")}>{children}</div>
      )}
    </section>
  );
}
