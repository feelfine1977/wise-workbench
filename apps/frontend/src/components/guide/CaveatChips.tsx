import type { Caveat } from "@/lib/api/cycle2";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The four-word readings of the data caveats, by id. */
export const CAVEAT_SHORT: Record<string, string> = {
  censoring: "still open at the end",
  right_censored: "still open at the end",
  window_edge: "started near the window end",
  replication: "copied postings",
  header_event_replication: "copied postings",
  duplicates: "duplicated events",
  duplicate_events: "duplicated events",
  timestamp_outliers: "stamps outside the window",
  sentinel_dates: "placeholder dates",
  timestamp_precision: "day-level stamps",
  zero_exposure: "no value",
};

export const caveatShort = (id: string) => CAVEAT_SHORT[id] ?? id.replace(/_/g, " ");

/**
 * Data caveats that touch a group, with their share: "14 % still open at the end". At most `max` chips;
 * `hide` lists the ids a page states once in its header instead of on every card.
 */
export function CaveatChips({ caveats, className, max = 3, hide }: { caveats: Caveat[] | undefined; className?: string; max?: number; hide?: Set<string> }) {
  const list = (caveats ?? [])
    .filter((c) => (c.share === null || c.share === undefined || c.share > 0.005) && !hide?.has(c.id))
    .sort((a, b) => (b.status === "fail" ? 1 : 0) - (a.status === "fail" ? 1 : 0) || (b.share ?? 0) - (a.share ?? 0))
    .slice(0, max);
  if (!list.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Data caveats for this group">
      {list.map((c) => (
        <li key={c.id} title={c.text} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", c.status === "fail" ? "border-danger/40 bg-danger-subtle text-danger" : "border-warning/40 bg-warning-subtle text-warning")} data-caveat={c.id}>
          <span aria-hidden>⚠</span>
          {c.share !== null && c.share !== undefined ? <span className="tnum font-medium">{fmtPct(c.share, c.share < 0.1 ? 1 : 0)}</span> : <span className="font-medium">log-wide</span>}
          <span>{caveatShort(c.id)}</span>
        </li>
      ))}
    </ul>
  );
}
