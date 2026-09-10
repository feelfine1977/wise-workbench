/**
 * The board's panels (§4.3): the four tiles, the breakdown bars and the ranked list. Every one of them keeps
 * the rules of §4.7 — the unfiltered twin is always drawn, bars keep the unfiltered order and mark a changed
 * rank instead of moving, and the ranked list, which is a ranking, says that it re-ranks within the filter.
 */
import type { BacklogRow } from "@wise/api-schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FacetValue, Facets, KpiTile, Kpis } from "@/lib/api/board";
import { fmtInt, fmtNum, fmtShare } from "@/lib/format";
import { groupLabel } from "@/lib/sentences";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- the four tiles

/**
 * The tile's number in the words of its format; the sentence behind it comes from the server. A share is
 * printed with one decimal near either end: 99.945 % rounded to 100 % said something that was not true and
 * carried no information.
 */
export function tileValue(tile: KpiTile): string {
  if (tile.value === null || tile.value === undefined) return "–";
  switch (tile.format) {
    case "share":
      return fmtShare(tile.value);
    case "index":
      return fmtNum(tile.value, 0);
    case "points":
      return fmtNum(tile.value, 1);
    default:
      return fmtInt(tile.value);
  }
}

/** The short name a tile carries in `data-testid`. */
const SHORT: Record<string, string> = { share_below_expectation: "below", priority_at_stake: "priority", open_share: "open", mean_score: "score" };

/**
 * The four tiles of the board, in order (§4.3). The second one is the run's own score against the
 * score of the whole run — the measure that tells one selection from another — and not the share of items
 * missing an expectation, which on this log is 99.9 % of everything and so separates nothing. That share
 * stays in the tile's `ⓘ` and in the header sentence, where it is read once and understood.
 */
export function boardTiles(kpis: Kpis | undefined): KpiTile[] {
  const all = kpis?.tiles ?? [];
  const by = (id: string) => all.find((t) => t.id === id);
  const score = by("mean_score");
  const share = by("share_below_expectation");
  if (!score) {
    // a backend without the score tile keeps the share, named for what it counts
    const named = share ? { ...share, label: "Items missing at least one expectation" } : undefined;
    return [by("items"), named, by("priority_at_stake"), by("open_share")].filter((t): t is KpiTile => !!t).slice(0, 4);
  }
  const second: KpiTile = { ...score, label: "Average score", text: [score.text, share?.text].filter(Boolean).join(" ") };
  return [by("items"), second, by("priority_at_stake"), by("open_share")].filter((t): t is KpiTile => !!t).slice(0, 4);
}

/** The header's sentence about the run: the share the second tile no longer carries on its face. */
export function belowExpectationSentence(kpis: Kpis | undefined): string | undefined {
  return (kpis?.tiles ?? []).find((t) => t.id === "share_below_expectation")?.text ?? undefined;
}

/**
 * The board's four tiles (§4.3): the number of this selection, the same number over all items beside it —
 * a filtered number is never shown without its unfiltered twin — and the server's plain sentence behind ⓘ.
 */
export function KpiTiles({ kpis, baseline, filtered, updating, className }: { kpis: Kpis | undefined; baseline?: Kpis; filtered?: boolean; updating?: boolean; className?: string }) {
  const tiles = boardTiles(kpis);
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} aria-label="The four numbers of this selection" data-testid="kpi-tiles">
      {tiles.map((t) => {
        const twin = baseline?.tiles.find((x) => x.id === t.id);
        const short = SHORT[t.id] ?? t.id;
        return (
          <li key={t.id} className={cn("surface flex flex-col gap-0.5 px-3 py-2", updating && "opacity-60")} data-kpi={t.id}>
            <span className="text-[11px] uppercase tracking-wide text-text-subtle">{t.label}</span>
            <span className="tnum text-xl font-semibold" data-testid={`kpi-${short}`}>
              {tileValue(t)}
            </span>
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span>{!filtered ? (t.id === "items" ? "the whole run" : "all items") : twin ? `all items ${tileValue(twin)}` : "no comparison yet"}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="rounded-full px-1 text-text-subtle hover:bg-surface-sunken" aria-label={`How ${t.label} is computed`}>
                    ⓘ
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 text-sm">
                  {t.text}
                  {kpis?.derived && <span className="mt-2 block text-xs text-text-subtle">This backend does not serve the board's own numbers yet; the tile is assembled from the run's summary, the filter preview and the ranked list.</span>}
                </PopoverContent>
              </Popover>
            </span>
          </li>
        );
      })}
      {tiles.length === 0 && <li className="text-sm text-text-muted">The numbers of this selection are being counted…</li>}
    </ul>
  );
}

// ---------------------------------------------------------------- breakdown bars

export interface BarRow {
  value: string;
  label: string;
  cases: number;
  casesAll: number;
  measure: number | null;
  measureAll: number | null;
  rankMove: number;
  selected: boolean;
}

/** The bars in the unfiltered order, with the filtered value over the grey twin and the rank move marked. */
export function barsOf(facets: Facets | undefined, baseline: Facets | undefined, selected: string[]): BarRow[] {
  const source = baseline ?? facets;
  if (!source) return [];
  const filtered = new Map((facets?.values ?? []).map((v) => [v.value, v]));
  const order = [...source.values].sort((a, b) => b.cases - a.cases);
  const filteredOrder = [...(facets?.values ?? [])].sort((a, b) => b.cases - a.cases).map((v) => v.value);
  return order.slice(0, 12).map((v: FacetValue, i) => {
    const own = filtered.get(v.value);
    const now = filteredOrder.indexOf(v.value);
    return {
      value: v.value,
      label: v.label ?? v.value,
      cases: own?.cases ?? 0,
      casesAll: v.cases,
      measure: own?.share_below_expectation ?? null,
      measureAll: v.share_below_expectation ?? null,
      rankMove: now < 0 ? 0 : i - now,
      selected: selected.includes(v.value),
    };
  });
}

/**
 * The bars in the unfiltered order. Every percentage carries the word for what it measures, and no two
 * quantities on the board share a name: the share here counts items missing an expectation, while the ranked
 * list's percentage is a distance from the overall score.
 */
export function BreakdownBars({ rows, noun, onSelect, measureLabel = "missing an expectation" }: { rows: BarRow[]; noun: string; onSelect: (row: BarRow) => void; measureLabel?: string }) {
  // one shared domain over the unfiltered population, so equal length means equal numbers between panels
  const domain = Math.max(1, ...rows.map((r) => r.casesAll));
  return (
    <ul className="flex flex-col gap-1.5" data-testid="breakdown-bars">
      {rows.map((r) => (
        <li key={r.value}>
          <button
            type="button"
            onClick={() => onSelect(r)}
            aria-pressed={r.selected}
            data-bar={r.value}
            className={cn("flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-surface-sunken", r.selected && "bg-accent-subtle")}
          >
            <span className="w-28 shrink-0 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-sunken" aria-hidden>
              <span className="absolute inset-y-0 left-0 bg-border" style={{ width: `${(r.casesAll / domain) * 100}%` }} />
              <span className="absolute inset-y-[3px] left-0 rounded-sm bg-accent" style={{ width: `${(r.cases / domain) * 100}%` }} />
            </span>
            <span className="tnum w-56 shrink-0 text-right text-xs text-text-muted" data-testid={`bar-value-${r.value}`}>
              {fmtInt(r.cases)} {noun}
              {r.measure !== null ? ` · ${fmtShare(r.measure)} ${measureLabel}` : ""}
            </span>
            {r.rankMove !== 0 && (
              <span className="w-6 shrink-0 text-[11px] text-text-subtle" title={`rank ${r.rankMove > 0 ? "up" : "down"} ${Math.abs(r.rankMove)} under this filter`}>
                {r.rankMove > 0 ? "▲" : "▼"}
                {Math.abs(r.rankMove)}
              </span>
            )}
          </button>
        </li>
      ))}
      <li className="px-1 pt-1 text-xs text-text-subtle">
        Click a bar to filter · the grey bar is all items · the share {measureLabel} beside the count · the order is the unfiltered one.
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- the ranked list

export function RankedRows({
  rows,
  shared,
  noun,
  maxPI,
  selected,
  onSelect,
  onWhy,
}: {
  rows: BacklogRow[];
  shared: Map<string, string>;
  noun: string;
  maxPI: number;
  selected?: string;
  onSelect: (row: BacklogRow) => void;
  onWhy: (row: BacklogRow) => void;
}) {
  return (
    <ol className="flex flex-col" data-testid="ranked-rows">
      {rows.map((r, i) => {
        const name = groupLabel(r, shared);
        return (
          <li key={r.key} className={cn("flex flex-wrap items-center gap-x-2 border-b border-border py-1 text-sm last:border-0", selected === r.key && "bg-accent-subtle")}>
            <span className="tnum w-5 shrink-0 text-text-subtle">{i + 1}</span>
            {/* P1-12: the name gets the width it needs and the numbers wrap under it; sharing one line with a
                twelve-word sentence, a bar and a control cut *Packaging* to *P…* at 1440 × 900 */}
            <button type="button" className="min-w-[11rem] flex-1 truncate text-left font-medium hover:underline" title={name} onClick={() => onSelect(r)}>
              {name}
            </button>
            <span className="tnum shrink-0 text-xs text-text-muted">
              {fmtInt(r.n_cases)} {noun} · {fmtNum(r.gap * 100, r.gap * 100 >= 10 ? 0 : 1)} % below the overall score
            </span>
            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={maxPI} aria-valuenow={r.stable_PI} aria-label={`${name}: priority ${fmtNum(r.stable_PI, 0)}`}>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.stable_PI / Math.max(maxPI, 1)) * 100)}%` }} />
            </span>
            <button type="button" className="shrink-0 text-xs text-accent-text underline" onClick={() => onWhy(r)}>
              Why?
            </button>
          </li>
        );
      })}
    </ol>
  );
}
