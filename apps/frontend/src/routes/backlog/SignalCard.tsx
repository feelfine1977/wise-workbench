import { ChevronDown, Pin } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { BacklogRow } from "@wise/api-schema";
import type { BacklogRow as BacklogRowC2 } from "@/lib/api/exploration";
import { CalibrationChip, KindBadge, LayerChip } from "@/components/badges";
import { CaveatChips } from "@/components/guide/CaveatChips";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { Term, useVocabulary } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { belowExpectation, comparisonSentence, groupLabel, missedPhrase, readingSentence } from "@/lib/sentences";
import { confidenceOf } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

export interface SignalCardProps {
  row: BacklogRow;
  /** The largest priority of the backlog, for the bar. */
  maxPI: number;
  view?: string;
  layerNames?: Record<string, string>;
  /** The mapping's business name of a case ("purchase order items"); the row's own `case_noun` wins. */
  caseNoun?: string;
  /** The group's name without the part every group on the page shares. */
  label?: string;
  /** Caveat ids the page states once in its header. */
  hideCaveats?: Map<string, number | undefined>;
  /** The run's uncalibrated expectations by id: the one this card names carries the chip. */
  uncalibrated?: Map<string, { text?: string }>;
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
 * "0.9 points below the overall score of 84.4 (1 %)": the distance as score points with the percent in
 * brackets, behind "more" on the card and in the method's words when the vocabulary is switched. The backend's
 * own sentence (`points_below`) is used when it is served; otherwise it is computed.
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
 * One signal: the rank and the name with the kind chip at the right end; one sentence with three numbers —
 * cases, the share below expectation, the most-missed expectation as a plain phrase with its share; the
 * real-unit comparison as a muted line when the backend serves one; the strip with the priority bar (accent),
 * the priority, the confidence word and at most one caveat chip; **Why?** as the single primary button;
 * everything else behind "more".
 */
export function SignalCard({ row: raw, maxPI, view, layerNames, caseNoun, label: givenLabel, hideCaveats, uncalibrated, active, pinned, onWhy, onActivate, onTogglePin, onDrill, onKeyDown, className }: SignalCardProps) {
  const { vocabulary, t } = useVocabulary();
  const plain = vocabulary === "plain";
  const row = raw as BacklogRowC2;
  const [more, setMore] = useState(false);
  const label = givenLabel ?? groupLabel(row);
  const share = maxPI > 0 ? Math.max(0, Math.min(1, row.stable_PI / maxPI)) : 0;
  const area = row.dominant_layer_name ?? layerNames?.[row.dominant_layer ?? ""] ?? row.dominant_layer ?? undefined;
  const noun = row.case_noun ?? caseNoun ?? (plain ? "cases" : "n_cases");
  const noShortfall = row.gap <= 0;
  const topDescription = row.top_constraint_description?.replace(/\.$/, "");
  const topConstraint = (row as { top_constraint?: string | null }).top_constraint ?? undefined;
  const missed = missedPhrase(row);
  const missedShare = row.top_constraint_share !== null && row.top_constraint_share !== undefined ? row.top_constraint_share : undefined;
  const comparison = plain ? comparisonSentence(row) : row.comparison ?? undefined;
  const confidence = confidenceOf(row.stability);
  const reading = readingSentence(row);
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
      className={cn("signal-card surface card-pad flex flex-col gap-3 outline-none transition-colors duration-fast hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", active && "border-accent", className)}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="tnum inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold" aria-hidden>
          {row.rank}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold" title={groupLabel(row)}>
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

      <p className="reading text-md leading-7 text-text" data-testid="card-sentence" title={plain && !noShortfall ? distanceSentence(row, true) : undefined}>
        <strong className="tnum">{fmtInt(row.n_cases)}</strong> {plain ? noun : <Term id="n_cases" primaryOnly />}
        {" · "}
        {noShortfall ? (
          <span>at or above the overall score</span>
        ) : plain ? (
          <>
            <strong className="tnum">{belowExpectation(row)}</strong> below expectation
          </>
        ) : (
          <span>{distanceSentence(row, false)}</span>
        )}
        {!noShortfall && missed && (
          <>
            {" · "}
            <span title={topDescription ?? undefined}>
              {plain ? missed : area}
              {missedShare !== undefined ? (
                <>
                  {" "}
                  in <strong className="tnum">{fmtPct(missedShare, 0)}</strong> of them
                </>
              ) : null}
            </span>
            {/* the expectation is named here, so the page that says what it means opens from here (R3-05) */}
            {plain && topConstraint && <WhatDoesThisMean className="ml-1.5 align-middle" kind="constraint" entryId={topConstraint} label={row.top_constraint_plain ?? missed ?? topConstraint} />}
            {/* an expectation almost every case misses separates no group: say so where it is named  */}
            {topConstraint && uncalibrated?.has(topConstraint) && <CalibrationChip className="ml-1.5 align-middle" text={uncalibrated.get(topConstraint)?.text} />}
          </>
        )}
        .
      </p>
      {!noShortfall && comparison && (
        <p className="reading clamp-2 text-sm text-text-muted" data-testid="card-reason">
          {comparison}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-[220px] flex-1 items-center gap-2 text-xs text-text-muted">
          <span role="meter" aria-valuemin={0} aria-valuemax={Math.max(maxPI, 1)} aria-valuenow={row.stable_PI} aria-label={`${t("PI")} ${fmtNum(row.stable_PI, 1)} of ${fmtNum(maxPI, 1)}`} title={`${t("stable_PI")}: ${fmtNum(row.stable_PI, 1)}`} className="h-1.5 min-w-[90px] max-w-[280px] flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, share * 100)}%` }} />
          </span>
          <span className="tnum whitespace-nowrap" data-testid="card-strip">
            {plain ? "priority" : t("stable_PI")} {fmtNum(row.stable_PI, 0)}
            {" · "}
            <span data-stability={row.stability ?? "unknown"} title={row.stability_reason ?? undefined}>
              {plain ? `confidence ${confidence}` : `stability ${(row.stability ?? "unknown").replace("_", " ")}`}
            </span>
          </span>
          <CaveatChips caveats={row.caveats} max={1} hide={hideCaveats} />
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
          {givenLabel && givenLabel !== groupLabel(row) && (
            <>
              <dt className="text-text-muted">group</dt>
              <dd>{groupLabel(row)}</dd>
            </>
          )}
          {row.kind && (
            <>
              <dt className="text-text-muted">{plain ? "kind of problem" : "hotspot type"}</dt>
              <dd>
                <KindBadge kind={row.kind} hotspotType={row.hotspot_type} reading />
              </dd>
            </>
          )}
          {!noShortfall && (
            <>
              <dt className="text-text-muted">{plain ? "how far off" : t("gap")}</dt>
              <dd className="tnum">{distanceSentence(row, plain)}</dd>
            </>
          )}
          {area && (
            <>
              <dt className="text-text-muted">{plain ? "expectation area" : <Term id="dominant_layer" primaryOnly />}</dt>
              <dd>
                <LayerChip id={row.dominant_layer} name={plain ? (row.plain_layer ?? area) : area} className="text-sm" explain />
                {plain && row.plain_layer && row.plain_layer !== area ? <span className="ml-1 text-xs text-text-subtle">({area})</span> : null}
                {topDescription && (
                  <span className="block text-text-muted">
                    {row.top_constraint_plain ? `${row.top_constraint_plain} — ` : ""}
                    {topDescription}
                    {missedShare !== undefined ? `, missed in ${fmtPct(missedShare)} of these ${noun}` : ""}
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
            {row.n_ranked ? ` · rank ${row.rank} of ${fmtInt(row.n_ranked)}` : ` · rank ${row.rank}`}
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
          {reading && (
            <>
              <dt className="text-text-muted">reading</dt>
              <dd className="text-text-muted">{reading}</dd>
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
