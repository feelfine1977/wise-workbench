import type { Caveat } from "@/lib/api/cycle2";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SHORT: Record<string, string> = {
  censoring: "still open",
  right_censored: "still open",
  window_edge: "near the window end",
  replication: "copied postings",
  header_event_replication: "copied postings",
  duplicates: "duplicated events",
  duplicate_events: "duplicated events",
  timestamp_outliers: "stamps outside the window",
  sentinel_dates: "placeholder dates",
  timestamp_precision: "day-level stamps",
  zero_exposure: "no value",
};

/** Data caveats that touch a group, with their share (RG-6, RG-20): "14 % still open", "73 % copied postings". */
export function CaveatChips({ caveats, className, max = 3 }: { caveats: Caveat[] | undefined; className?: string; max?: number }) {
  const list = (caveats ?? []).filter((c) => c.share === null || c.share === undefined || c.share > 0.005).slice(0, max);
  if (!list.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Data caveats for this group">
      {list.map((c) => (
        <li key={c.id} title={c.text} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", c.status === "fail" ? "border-danger/40 bg-danger-subtle text-danger" : "border-warning/40 bg-warning-subtle text-warning")} data-caveat={c.id}>
          <span aria-hidden>!</span>
          {c.share !== null && c.share !== undefined ? <span className="tnum font-medium">{fmtPct(c.share, c.share < 0.1 ? 1 : 0)}</span> : <span className="font-medium">log-wide</span>}
          <span>{SHORT[c.id] ?? c.id.replace(/_/g, " ")}</span>
        </li>
      ))}
    </ul>
  );
}
