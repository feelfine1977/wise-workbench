import { Pin } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { ConfidenceMark, KindBadge, LayerChip } from "@/components/badges";
import { Term, useVocabulary } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { cn, sliceLabel } from "@/lib/utils";

export interface SignalCardProps {
  row: BacklogRow;
  /** The largest priority of the backlog, for the bar. */
  maxPI: number;
  view?: string;
  layerNames?: Record<string, string>;
  active?: boolean;
  pinned?: boolean;
  onWhy: (key: string) => void;
  onActivate?: (key: string) => void;
  onTogglePin?: (key: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  className?: string;
}

/**
 * One signal: a sentence card (group, cases, shortfall, kind with glyph, most-missed expectation area with
 * its plain description, confidence, priority and rank), a priority bar and one **Why?** button.
 */
export function SignalCard({ row, maxPI, view, layerNames, active, pinned, onWhy, onActivate, onTogglePin, onKeyDown, className }: SignalCardProps) {
  const { vocabulary, t } = useVocabulary();
  const label = sliceLabel(row);
  const share = maxPI > 0 ? Math.max(0, Math.min(1, row.stable_PI / maxPI)) : 0;
  const area = row.dominant_layer_name ?? layerNames?.[row.dominant_layer ?? ""] ?? row.dominant_layer ?? undefined;
  const noShortfall = row.gap <= 0;
  return (
    <article
      role="option"
      aria-selected={!!active}
      aria-label={`${row.rank}. ${label}`}
      tabIndex={active ? 0 : -1}
      data-row-key={row.key}
      data-active={!!active}
      data-pinned={!!pinned}
      data-kind={row.kind ?? undefined}
      onFocus={() => onActivate?.(row.key)}
      onClick={() => onActivate?.(row.key)}
      onKeyDown={onKeyDown}
      className={cn("signal-card surface flex flex-col gap-2 p-3 outline-none transition-colors duration-fast hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", active && "border-accent bg-selection/40", className)}
      title={row.reading ?? undefined}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold" aria-hidden>
          {row.rank}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-md font-semibold" title={label}>
          {label}
        </h3>
        <KindBadge kind={row.kind} hotspotType={row.hotspot_type} reading />
        <ConfidenceMark value={row.stability} words />
        {onTogglePin && (
          <button
            type="button"
            aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
            aria-pressed={pinned}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(row.key);
            }}
            className="pin-glyph rounded-sm p-0.5 text-text-subtle hover:text-accent-text focus-visible:text-accent-text"
          >
            <Pin className={cn("size-3.5", pinned && "fill-current")} aria-hidden />
          </button>
        )}
      </header>

      <p className="text-sm leading-6 text-text">
        <strong className="tnum">{fmtInt(row.n_cases)}</strong> <Term id="n_cases" primaryOnly />
        {" · "}
        {noShortfall ? (
          <span>at or above expectation on average</span>
        ) : (
          <>
            <strong className="tnum">{fmtPct(row.gap, row.gap * 100 >= 10 ? 0 : 1)}</strong> {vocabulary === "plain" ? "below expectation on average" : "gap"}
          </>
        )}
        {area && (
          <>
            {" · "}
            {vocabulary === "plain" ? "mostly" : "dominant layer"} <LayerChip id={row.dominant_layer} name={area} className="align-baseline font-medium" />
            {row.top_constraint_description && (
              <span className="text-text-muted"> ({row.top_constraint_description.replace(/\.$/, "")}{row.top_constraint_share !== null && row.top_constraint_share !== undefined ? `, missed in ${fmtPct(row.top_constraint_share)} of these cases` : ""})</span>
            )}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <span className="flex min-w-[200px] flex-1 items-center gap-2">
          <span className="whitespace-nowrap">
            <Term id="stable_PI" primaryOnly>{t("PI")}</Term> <strong className="tnum text-text">{fmtNum(row.stable_PI, 1)}</strong>
          </span>
          <span role="meter" aria-valuemin={0} aria-valuemax={Math.max(maxPI, 1)} aria-valuenow={row.stable_PI} aria-label={`${t("PI")} ${fmtNum(row.stable_PI, 1)} of ${fmtNum(maxPI, 1)}`} className="h-2 min-w-[80px] flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: row.kind ? `var(--kind-${row.kind}-solid)` : "var(--color-accent)" }} />
          </span>
        </span>
        <span className="whitespace-nowrap">
          <Term id="rank" primaryOnly /> <strong className="tnum text-text">{row.rank}</strong>
          {row.n_ranked ? ` of ${fmtInt(row.n_ranked)}` : ""}
          {view ? ` · ${view}` : ""}
        </span>
        <Button size="sm" className="ml-auto" onClick={(e) => { e.stopPropagation(); onWhy(row.key); }} aria-label={`Why? ${label}`}>
          Why?
        </Button>
      </div>
    </article>
  );
}
