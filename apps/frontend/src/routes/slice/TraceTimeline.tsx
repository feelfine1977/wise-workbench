import { useId, useMemo } from "react";
import type { Trace } from "@wise/api-schema";
import { cn } from "@/lib/utils";

type EventTime = { raw?: string | null; instant?: bigint; basis?: "instant" | "recorded"; issue?: string };

function eventTime(raw?: string | null): EventTime {
  if (!raw?.trim()) return { issue: "Timestamp not recorded" };
  // Parse recorded clock values independently of the browser's timezone.
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(raw.trim());
  if (!parts) return { raw, issue: "Invalid timestamp" };
  const [, year, month, day, hour, minute, second, fraction = "", offset] = parts;
  const y = Number(year);
  const m = Number(month);
  const monthDays = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || Number(day) < 1 || Number(day) > monthDays[m - 1]! || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return { raw, issue: "Invalid timestamp" };
  }
  const milliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset?.toUpperCase() ?? "Z"}`);
  if (!Number.isFinite(milliseconds)) return { raw, issue: "Invalid timestamp" };
  // Preserve sub-millisecond differences from the supplied timestamp instead of rounding them to zero.
  return { raw, instant: BigInt(milliseconds) * 1_000_000n + BigInt(fraction.padEnd(9, "0")), basis: offset ? "instant" : "recorded" };
}

function elapsed(nanoseconds: bigint): string {
  const units = [[86_400_000_000_000n, "d"], [3_600_000_000_000n, "h"], [60_000_000_000n, "min"], [1_000_000_000n, "s"], [1_000_000n, "ms"], [1_000n, "µs"], [1n, "ns"]] as const;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const count = nanoseconds / size;
    if (count) parts.push(`${count} ${label}`);
    nanoseconds %= size;
  }
  return parts.join(" ") || "0 s";
}

function Timestamp({ time }: { time: EventTime }) {
  if (time.instant !== undefined) return <time dateTime={time.raw!}>{time.raw}</time>;
  return <span>{time.issue}{time.raw && <>: <span className="font-mono">{time.raw}</span></>}</span>;
}

/** Every event has its own row; spacing conveys sequence, never elapsed time or causality. */
export function TraceTimeline({ trace, highlight, onHighlight, plainOf }: { trace: Trace; highlight?: string; onHighlight?: (constraintId: string | undefined) => void; plainOf?: (constraintId: string) => string }) {
  const id = useId();
  const { events, mixedTimezones } = useMemo(() => {
    const rows = (trace.events ?? []).map((event, sourceIndex) => ({ event, sourceIndex, time: eventTime(event.timestamp) }));
    const mixedTimezones = new Set(rows.flatMap(({ time }) => time.basis ? [time.basis] : [])).size > 1;
    // Offset-free clock values cannot be placed relative to absolute instants.
    if (!mixedTimezones) rows.sort((a, b) => {
      if (a.time.instant === undefined) return b.time.instant === undefined ? a.sourceIndex - b.sourceIndex : 1;
      if (b.time.instant === undefined) return -1;
      return a.time.instant < b.time.instant ? -1 : a.time.instant > b.time.instant ? 1 : a.sourceIndex - b.sourceIndex;
    });
    return { events: rows, mixedTimezones };
  }, [trace.events]);
  const constraints = [...new Set(events.flatMap(({ event }) => event.violates ?? []))].map((key, index) => ({
    key, reference: `C${index + 1}`, target: `${id}-constraint-${index + 1}`, name: plainOf?.(key),
  }));
  const constraintOf = new Map(constraints.map((constraint) => [constraint.key, constraint]));
  const attributes = Object.entries(trace.attributes ?? {});
  const unavailable = events.filter(({ time }) => time.instant === undefined).length;
  const first = events[0]?.time.instant;
  const last = events[events.length - 1]?.time.instant;
  const recordedClock = !mixedTimezones && events.some(({ time }) => time.basis === "recorded");
  const gapLabel = recordedClock ? "Recorded clock gap" : "Since previous event";
  const span = !mixedTimezones && events.length > 1 && unavailable === 0 && first !== undefined && last !== undefined ? elapsed(last - first) : undefined;
  const spanReason = events.length === 0 ? "no events" : events.length === 1 ? "at least two timed events needed" : mixedTimezones ? "mixed timezone information" : "some timestamps are unavailable";
  const sincePrevious = (index: number) => {
    const current = events[index]?.time.instant;
    const previous = events[index - 1]?.time.instant;
    if (mixedTimezones || current === undefined) return "Unavailable";
    if (index === 0) return "First timed event";
    return previous === undefined ? "Unavailable" : elapsed(current - previous);
  };
  const references = (violations?: string[]) => violations?.length ? (
    <span className="flex flex-wrap gap-2">
      {violations.map((key, index) => {
        const constraint = constraintOf.get(key)!;
        const className = cn("inline-flex min-h-8 items-center rounded border px-2 py-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", highlight === key ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-text");
        return onHighlight ? (
          <button key={`${key}-${index}`} type="button" className={className} aria-label={`Highlight constraint ${constraint.reference}`} aria-describedby={constraint.target} aria-pressed={highlight === key} onClick={() => onHighlight(highlight === key ? undefined : key)}>
            {constraint.reference}
          </button>
        ) : (
          <a key={`${key}-${index}`} className={className} href={`#${constraint.target}`} aria-label={`Constraint ${constraint.reference} details`} aria-describedby={constraint.target}>{constraint.reference}</a>
        );
      })}
    </span>
  ) : <span className="text-text-muted">None recorded</span>;

  return (
    <section aria-label={`Timeline of case ${trace.caseId}`} className="min-w-0 space-y-4 text-sm">
      <div className="space-y-1">
        <p className="font-medium [overflow-wrap:anywhere]">Case {trace.caseId} · {events.length} {events.length === 1 ? "event" : "events"}</p>
        <p className="tnum text-text-muted">{recordedClock ? "First-to-last recorded clock span" : "First-to-last span"}: {span ?? `unavailable (${spanReason})`}</p>
      </div>
      {attributes.length > 0 && (
        <details className="rounded border border-border p-3">
          <summary className="cursor-pointer text-text-muted">Case metadata ({attributes.length} fields)</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {attributes.map(([key, value]) => (
              <div key={key} className="min-w-0 [overflow-wrap:anywhere]">
                <dt className="text-xs text-text-muted">{key.replace(/^case /, "")}</dt>
                <dd>{value === null || value === undefined ? "Not recorded" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {events.length === 0 ? <p>No events recorded for this case.</p> : (
        <>
          <div id={`${id}-ordering`} className="space-y-1 text-xs leading-relaxed text-text-muted">
            <p>{mixedTimezones ? "Recorded event order; chronological order is unknown because timestamps mix explicit offsets and unspecified timezones." : "Chronological event rows; equal timestamps keep recorded order."} Distances are not to scale.</p>
            <p>Timestamps are shown exactly as recorded. {mixedTimezones ? "Elapsed time is unavailable with mixed timezone information." : recordedClock ? "Timezone not supplied: gaps use recorded clock times; timezone and daylight-saving adjustments are unknown." : "Timezone offsets are retained; elapsed time is shown separately."}</p>
            {unavailable > 0 && <p>{unavailable} {unavailable === 1 ? "event has" : "events have"} no usable timestamp. {mixedTimezones ? "These events stay in recorded order" : "These events follow the timed events in recorded order"}; their chronological position and elapsed time are unknown.</p>}
          </div>
          <ol aria-label={`Events ${mixedTimezones ? "in recorded order" : "in time order"} for case ${trace.caseId}`} aria-describedby={`${id}-ordering`} role="list" className="space-y-2">
            {events.map(({ event, sourceIndex, time }, index) => (
              <li key={sourceIndex} className={cn("grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded border border-border p-3", highlight && event.violates?.includes(highlight) && "border-accent bg-accent-subtle/20")}>
                <span className="tnum pt-0.5 text-text-muted" aria-label={`Event ${index + 1}`}>{index + 1}</span>
                <div className="min-w-0">
                  <p className="font-medium leading-relaxed [overflow-wrap:anywhere]">{event.activity?.trim() ? event.activity : "Activity not recorded"}</p>
                  <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
                    <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-text-muted">Timestamp</dt><dd className="tnum"><Timestamp time={time} /></dd></div>
                    <div><dt className="text-xs text-text-muted">{gapLabel}</dt><dd className="tnum">{sincePrevious(index)}</dd></div>
                    <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-text-muted">Resource</dt><dd>{event.resource?.trim() ? event.resource : "Not recorded"}</dd></div>
                    <div><dt className="mb-1 text-xs text-text-muted">Recorded violations</dt><dd>{references(event.violates)}</dd></div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {constraints.length > 0 && (
        <section aria-label="Constraint key" className="min-w-0 space-y-2 rounded border border-border p-3">
          <p className="font-medium">Constraint key</p>
          <p className="text-xs leading-relaxed text-text-muted">Recorded violations identify missed constraints; they do not establish the cause. {onHighlight ? "Select a reference to highlight its events; select it again to clear." : "Follow a reference for its full details."}</p>
          <dl className="space-y-3">
            {constraints.map((constraint) => (
              <div key={constraint.key} id={constraint.target} tabIndex={-1} className={cn("grid min-w-0 scroll-mt-4 grid-cols-[2.5rem_minmax(0,1fr)] gap-2 rounded p-1", highlight === constraint.key && "bg-accent-subtle")}>
                <dt className="font-semibold">{constraint.reference}</dt>
                <dd className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                  {constraint.name && constraint.name !== constraint.key && <p>{constraint.name}</p>}
                  <p className="text-xs leading-relaxed text-text-muted">Full constraint ID: <code>{constraint.key}</code></p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {events.length > 0 && (
        <details className="min-w-0 rounded border border-border p-3">
          <summary className="cursor-pointer font-medium">Event table</summary>
          <div role="region" aria-label={`Scrollable event table for case ${trace.caseId}`} tabIndex={0} className="mt-3 overflow-x-auto">
            <table className="tnum w-full min-w-[48rem] table-fixed text-left text-sm">
              <caption className="sr-only">Events of case {trace.caseId}</caption>
              <colgroup><col className="w-[5%]" /><col className="w-[25%]" /><col className="w-[25%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[15%]" /></colgroup>
              <thead><tr className="text-xs text-text-muted">
                {["#", "Activity", "Timestamp (as recorded)", gapLabel, "Resource", "Recorded violations"].map((label) => <th key={label} scope="col" className="p-3 align-top">{label}</th>)}
              </tr></thead>
              <tbody>
                {events.map(({ event, sourceIndex, time }, index) => (
                  <tr key={sourceIndex} className={cn("border-t border-border [&>td]:p-3 [&>td]:align-top [&>td]:[overflow-wrap:anywhere]", highlight && event.violates?.includes(highlight) && "bg-accent-subtle/20")}>
                    <td className="text-text-muted">{index + 1}</td>
                    <td className="font-medium">{event.activity?.trim() ? event.activity : "Activity not recorded"}</td>
                    <td><Timestamp time={time} /></td>
                    <td>{sincePrevious(index)}</td>
                    <td>{event.resource?.trim() ? event.resource : "Not recorded"}</td>
                    <td>{references(event.violates)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
