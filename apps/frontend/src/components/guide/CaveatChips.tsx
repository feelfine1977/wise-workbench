import type { Caveat } from "@/lib/api/cycle2";
import { fmtPct } from "@/lib/format";
import { useHubStore } from "@/lib/stores/hub";
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
 * The words on the chip: the caveat's own, and the part of the group it is about when it names one (P1-10).
 *
 * The reason screen printed *subgroup censoring* twice, at 100 % and at 65 %, with nothing to tell the two
 * apart — they are two different quarters of the same group.
 */
export function caveatWords(caveat: Pick<Caveat, "id" | "subgroup">): string {
  const sub = caveat.subgroup as { attribute?: string; value?: string } | null | undefined;
  const words = caveatShort(caveat.id);
  if (!sub?.value) return words;
  const attribute = String(sub.attribute ?? "").replace(/^case /, "").replace(/_/g, " ");
  return `${words} · ${attribute ? `${attribute} ` : ""}${String(sub.value)}`;
}

/**
 * What a run-wide caveat says, in words (P1-3).
 *
 * The chip carries its own question — *what does “still open at the end” mean?* — in its accessible name, and
 * the sentence in front of it is what the run says about the caveat. Where the server serves no sentence the
 * client wrote `String(id)` in its place, so a screen reader heard *“censoring What does … mean?”* and the
 * tooltip read the same. The share is the run's, not the page's.
 */
export function runCaveatSentence(id: string, share: number | undefined, max: number | undefined, items: string): string {
  const words = caveatShort(id);
  if (share === undefined) return `On this run: ${words}.`;
  const head = `On this run: ${words}, ${fmtPct(share, share < 0.1 ? 1 : 0)} of ${items} on average`;
  return max === undefined || max <= share ? `${head}.` : `${head}, up to ${fmtPct(max, max < 0.1 ? 1 : 0)} on one group.`;
}

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
 *
 * The chip is itself the *What does this mean?* control (R3-05): a reader who does not know what "copied
 * postings" is presses the words and the hub page opens beside the screen. A second glyph beside every chip
 * would double the width of a strip that already carries a priority bar and a confidence word, so the chip
 * carries the question in its own accessible name instead.
 */
export function CaveatChips({ caveats, className, max = 3, hide, explain = true }: { caveats: Caveat[] | undefined; className?: string; max?: number; hide?: Map<string, number | undefined>; explain?: boolean }) {
  const openHub = useHubStore((s) => s.openHub);
  const list = (caveats ?? [])
    .filter((c) => (c.share === null || c.share === undefined || c.share > caveatFloor(c.id)) && !chipHidden(c, hide))
    .sort((a, b) => (b.status === "fail" ? 1 : 0) - (a.status === "fail" ? 1 : 0) || (b.share ?? 0) - (a.share ?? 0))
    .slice(0, max);
  if (!list.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Data caveats for this group">
      {list.map((c) => {
        const chip = cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-left text-xs",
          c.status === "fail" ? "border-danger/40 bg-danger-subtle text-danger" : "border-warning/40 bg-warning-subtle text-warning",
        );
        const inside = (
          <>
            <span aria-hidden>⚠</span>
            {c.share !== null && c.share !== undefined ? <span className="tnum font-medium">{fmtPct(c.share, c.share < 0.1 ? 1 : 0)}</span> : <span className="font-medium">log-wide</span>}
            <span>{caveatWords(c)}</span>
          </>
        );
        return (
          <li key={`${c.id}:${caveatWords(c)}`} data-caveat={c.id}>
            {explain ? (
              <button
                type="button"
                className={cn(chip, "cursor-help hover:border-accent hover:text-accent-text")}
                title={`${c.text} — what does “${caveatShort(c.id)}” mean?`}
                aria-label={`${c.text} What does “${caveatWords(c)}” mean?`}
                data-testid="what-does-this-mean"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  openHub({ kind: "failure_mode", entryId: c.id, label: caveatShort(c.id) });
                }}
              >
                {inside}
              </button>
            ) : (
              <span className={chip} title={c.text}>
                {inside}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
