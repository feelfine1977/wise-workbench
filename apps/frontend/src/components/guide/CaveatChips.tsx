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

/** The share below which a caveat is not worth a chip; duplicates need a full per cent (R2-06). */
export const caveatFloor = (id: string) => (CAVEAT_SHORT[id] === "duplicated events" || CAVEAT_SHORT[id] === "copied postings" ? 0.01 : 0.005);

/**
 * Whether a page-wide caveat still deserves its own chip on this group (R2-06): a failing caveat always
 * does; a warning is left to the page's header only while the group's share stays inside the page's range —
 * at most 1.5 × the page-wide share. That is the rule that hid Real Estate's 44 % censoring behind a 16 %
 * page-wide line.
 */
export function chipHidden(caveat: Caveat, pageWide: Map<string, number | undefined> | undefined): boolean {
  if (!pageWide?.has(caveat.id)) return false;
  if (caveat.status === "fail") return false;
  const share = caveat.share;
  const wide = pageWide.get(caveat.id);
  if (share === null || share === undefined || wide === null || wide === undefined) return true;
  return share <= 1.5 * wide;
}

/**
 * Data caveats that touch a group, with their share: "14 % still open at the end". At most `max` chips;
 * `hide` carries the caveats a page states once in its header, with their page-wide share, so a group far
 * outside that range keeps its own chip.
 */
export function CaveatChips({ caveats, className, max = 3, hide }: { caveats: Caveat[] | undefined; className?: string; max?: number; hide?: Map<string, number | undefined> }) {
  const list = (caveats ?? [])
    .filter((c) => (c.share === null || c.share === undefined || c.share > caveatFloor(c.id)) && !chipHidden(c, hide))
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
