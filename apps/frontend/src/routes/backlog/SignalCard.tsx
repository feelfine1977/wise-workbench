import { ChevronDown, Pin } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { BacklogRow } from "@wise/api-schema";
import type { BacklogRowC2 } from "@/lib/api/cycle2";
import { ConfidenceMark, KindBadge, LayerChip } from "@/components/badges";
import { CaveatChips } from "@/components/guide/CaveatChips";
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
  /** The mapping's business name of a case ("purchase order items"); the row's own `case_noun` wins. */
  caseNoun?: string;
  active?: boolean;
  pinned?: boolean;
  onWhy: (key: string) => void;
  onActivate?: (key: string) => void;
  onTogglePin?: (key: string) => void;
  onDrill?: (key: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  className?: string;
}

/**
 * "0.9 points below the overall score of 84.4 (1 %)": distances as score points with the percent in brackets
 * (RG-18). The backend's own sentence (`points_below`) is used when it is served; otherwise it is computed.
 */
export function distanceSentence(row: { gap: number; global_mean?: number | null; mean_score: number; points_below?: string | null }, plain: boolean): string {
  const mu = row.global_mean ?? row.mean_score + row.gap;
  const pct = mu > 0 ? row.gap / mu : 0;
  if (!plain) return `gap ${fmtNum(row.gap, 4)} (${fmtPct(pct, pct >= 0.1 ? 0 : 1)} of μ̄ ${fmtNum(mu, 3)})`;
  if (row.points_below) return row.points_below;
  const points = row.gap * 100;
  return `${fmtNum(points, points >= 100 ? 0 : 1)} points below the overall score of ${fmtNum(mu * 100, 1)} (${fmtPct(pct, pct >= 0.1 ? 0 : 1)})`;
}

/**
 * One signal (R2-O9): a rank, the group, its kind, then one reading sentence of at most two lines — the
 * three numbers a reader needs (cases, how far below, confidence) and the plain reason with the real-unit
 * comparison — caveat chips, the priority bar with the rank, one **Why?**; everything else behind "more".
 */
export function SignalCard({ row: raw, maxPI, view, layerNames, caseNoun, active, pinned, onWhy, onActivate, onTogglePin, onDrill, onKeyDown, className }: SignalCardProps) {
  const { vocabulary, t } = useVocabulary();
  const plain = vocabulary === "plain";
  const row = raw as BacklogRowC2;
  const [more, setMore] = useState(false);
  const label = sliceLabel(row);
  const share = maxPI > 0 ? Math.max(0, Math.min(1, row.stable_PI / maxPI)) : 0;
  const area = row.dominant_layer_name ?? layerNames?.[row.dominant_layer ?? ""] ?? row.dominant_layer ?? undefined;
  const missed = row.layer_missed_label ?? area;
  const noun = row.case_noun ?? caseNoun ?? (plain ? "cases" : "n_cases");
  const noShortfall = row.gap <= 0;
  const topDescription = row.top_constraint_description?.replace(/\.$/, "");
  const topPlain = row.top_constraint_plain ?? topDescription;
  return (
    <article
      aria-current={active ? "true" : undefined}
      aria-label={`${row.rank}. ${label}`}
      tabIndex={active ? 0 : -1}
      data-row-key={row.key}
      data-active={!!active}
      data-pinned={!!pinned}
      data-kind={row.kind ?? undefined}
      onFocus={() => onActivate?.(row.key)}
      onClick={() => onActivate?.(row.key)}
      onKeyDown={onKeyDown}
      className={cn("signal-card surface card-pad flex flex-col gap-3 outline-none transition-colors duration-fast hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", active && "border-accent bg-selection/30", className)}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="tnum inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold" aria-hidden>
          {row.rank}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold" title={label}>
          {label}
        </h3>
        <KindBadge kind={row.kind} hotspotType={row.hotspot_type} short={plain} className="text-sm" />
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
            <Pin className={cn("size-4", pinned && "fill-current")} aria-hidden />
          </button>
        )}
      </header>

      <p className="reading text-base leading-7 text-text" data-testid="card-sentence">
        <strong className="tnum">{fmtInt(row.n_cases)}</strong> {plain ? noun : <Term id="n_cases" primaryOnly />}
        {" · "}
        {noShortfall ? <span>at or above the overall score</span> : <span>{distanceSentence(row, plain)}</span>}
        {" · "}
        <ConfidenceMark value={row.stability} words className="text-base" title={row.stability_reason ?? undefined} />
      </p>
      {!noShortfall && (missed || row.comparison) && (
        <p className="reading clamp-2 text-base leading-7 text-text-muted" data-testid="card-reason" title={topDescription ? `${topDescription}${row.top_constraint_share !== null && row.top_constraint_share !== undefined ? `, missed in ${fmtPct(row.top_constraint_share)} of these ${noun}` : ""}` : undefined}>
          {missed && (
            <>
              {plain ? "mostly" : "dominant layer"} <strong className="font-medium text-text">{plain ? missed : area}</strong>
            </>
          )}
          {row.comparison ? (
            <>
              {missed ? " — " : ""}
              {row.comparison}
            </>
          ) : topPlain ? (
            <>
              {missed ? " — " : ""}
              {topPlain}
              {row.top_constraint_share !== null && row.top_constraint_share !== undefined ? ` missed in ${fmtPct(row.top_constraint_share)} of these ${noun}` : ""}
            </>
          ) : null}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <CaveatChips caveats={row.caveats} max={2} />
        <span className="ml-auto flex min-w-[180px] items-center gap-2 text-xs text-text-muted">
          <span role="meter" aria-valuemin={0} aria-valuemax={Math.max(maxPI, 1)} aria-valuenow={row.stable_PI} aria-label={`${t("PI")} ${fmtNum(row.stable_PI, 1)} of ${fmtNum(maxPI, 1)}`} title={`${t("stable_PI")}: ${fmtNum(row.stable_PI, 1)}`} className="h-2 min-w-[90px] flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: row.kind ? `var(--kind-${row.kind}-solid)` : "var(--color-accent)" }} />
          </span>
          <span className="tnum whitespace-nowrap">
            {plain ? "" : `${t("rank")} `}
            {row.rank}
            {row.n_ranked ? ` of ${fmtInt(row.n_ranked)}` : ""}
          </span>
        </span>
        <button
          type="button"
          aria-expanded={more}
          aria-label={`${more ? "Less" : "More"} about ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setMore((m) => !m);
          }}
          className="inline-flex items-center gap-0.5 text-xs text-text-muted hover:text-text"
        >
          {more ? "less" : "more"}
          <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} aria-hidden />
        </button>
        <Button
          size="md"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onWhy(row.key);
          }}
          aria-label={`Why? ${label}`}
        >
          Why?
        </Button>
      </div>

      {more && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-3 text-sm" data-testid="card-more">
          {row.kind && (
            <>
              <dt className="text-text-muted">{plain ? "kind of problem" : "hotspot type"}</dt>
              <dd>
                <KindBadge kind={row.kind} hotspotType={row.hotspot_type} reading />
              </dd>
            </>
          )}
          {area && (
            <>
              <dt className="text-text-muted">
                <Term id="dominant_layer" primaryOnly />
              </dt>
              <dd>
                <LayerChip id={row.dominant_layer} name={area} className="text-sm" />
                {topDescription && (
                  <span className="text-text-muted">
                    {" — "}
                    {topDescription}
                    {row.top_constraint_share !== null && row.top_constraint_share !== undefined ? `, missed in ${fmtPct(row.top_constraint_share)} of these ${noun}` : ""}
                    {!plain && row.top_constraint ? <span className="ml-1 font-mono text-xs text-text-subtle">{row.top_constraint}</span> : null}
                  </span>
                )}
              </dd>
            </>
          )}
          {row.stability_reason && (
            <>
              <dt className="text-text-muted">{plain ? "how sure" : "stability"}</dt>
              <dd>
                {row.stability_reason}
                {row.rank_lo !== null && row.rank_lo !== undefined && row.rank_hi !== null && row.rank_hi !== undefined ? ` · rank ${fmtNum(row.rank_lo, 0)}–${fmtNum(row.rank_hi, 0)} in resamples` : ""}
              </dd>
            </>
          )}
          <dt className="text-text-muted">
            <Term id="stable_PI" primaryOnly />
          </dt>
          <dd className="tnum">
            {fmtNum(row.stable_PI, 1)}
            {fmtNum(row.PI, 1) !== fmtNum(row.stable_PI, 1) ? ` (${plain ? "before discounting" : "raw PI"} ${fmtNum(row.PI, 1)})` : ""}
            {row.PI_lower !== null && row.PI_lower !== undefined ? ` · ${t("PI_lower")} ${fmtNum(row.PI_lower, 1)}` : ""}
          </dd>
          <dt className="text-text-muted">{plain ? "average score" : t("mean_score")}</dt>
          <dd className="tnum">
            {fmtPct(row.mean_score, 1)} {plain ? "of the rules met" : ""}
            {row.global_mean !== null && row.global_mean !== undefined ? ` · ${plain ? "overall" : "μ̄"} ${fmtPct(row.global_mean, 1)}` : ""}
            {view ? ` · ${view}` : ""}
          </dd>
          {row.caveats && row.caveats.length > 0 && (
            <>
              <dt className="text-text-muted">data caveats</dt>
              <dd>
                <ul className="flex flex-col gap-0.5">
                  {row.caveats.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {row.reading && (
            <>
              <dt className="text-text-muted">reading</dt>
              <dd className="text-text-muted">{row.reading}</dd>
            </>
          )}
          {onDrill && (
            <>
              <dt className="text-text-muted">finer</dt>
              <dd>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDrill(row.key);
                  }}
                >
                  Drill into this group
                </Button>
              </dd>
            </>
          )}
        </dl>
      )}
    </article>
  );
}
