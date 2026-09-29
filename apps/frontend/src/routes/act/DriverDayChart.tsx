import { useChartNavigation } from "@/lib/useChartNavigation";
import { useId, useState } from "react";
import { scaleBand, scaleLinear } from "d3";
import { fmtInt } from "@/lib/format";
import { eventShare } from "./driverEvidenceFormat";

export interface DriverDayBucket {
  day: number;
  events: number;
  cases: number;
}

/** Raw calendar counts, without implying a schedule or adjusting for calendar exposure. */
export function DriverDayChart({ buckets, eventTotal, caseTotal, activityLabel }: {
  buckets: readonly DriverDayBucket[];
  eventTotal: number;
  caseTotal: number;
  activityLabel: string;
}) {
  const id = useId();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const navigateDay = useChartNavigation(buckets.map(b => String(b.day)), key => setSelectedDay(Number(key)));
  const selected = buckets.find(b => b.day === selectedDay);
  const width = 640;
  const height = 160;
  const x = scaleBand<number>().domain(buckets.map(b => b.day)).range([40, width - 8]).padding(0.2);
  const max = Math.max(1, ...buckets.map(b => b.events));
  const y = scaleLinear().domain([0, max]).nice(3).range([height - 28, 12]);
  const peak = Math.max(0, ...buckets.map(b => b.events));
  const peaks = buckets.filter(b => b.events === peak).map(b => b.day);
  return (
    <figure className="mt-3" aria-labelledby={`${id}-heading`}>
      <figcaption id={`${id}-heading`} className="text-sm font-medium">{activityLabel}: day of month</figcaption>
      <p className="mt-1 text-sm text-text" data-testid="driver-calendar-reading">
        {fmtInt(eventTotal)} dated end-event records across {fmtInt(caseTotal)} distinct cases.
        {eventTotal > 0 && <> Largest daily bucket{peaks.length === 1 ? "" : "s"}: day{peaks.length === 1 ? "" : "s"} {peaks.join(", ")} — {fmtInt(peak)} records ({eventShare(peak, eventTotal)}){peaks.length > 1 ? " each" : ""}.</>}
      </p>
      {eventTotal > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-surface-sunken p-3">
        <label htmlFor={`${id}-day`} className="text-xs font-medium">Inspect a calendar day</label>
        <select id={`${id}-day`} className="rounded border border-border bg-surface px-2 py-1 text-sm" value={selectedDay ?? ""} onChange={event => setSelectedDay(event.target.value ? Number(event.target.value) : null)}>
          <option value="">All days</option>{buckets.map(b => <option key={b.day} value={b.day}>Day {b.day}</option>)}
        </select>
        <p className="text-sm tnum" aria-live="polite" data-testid="driver-day-inspection">{selected ? <>Day {selected.day}: <strong>{fmtInt(selected.events)} records</strong> · {eventShare(selected.events, eventTotal)} of dated records · {fmtInt(selected.cases)} distinct cases</> : "Select a day or point to a bar for its exact counts."}</p>
        <p className="w-full text-xs text-text-muted">Inspecting a day highlights this chart only; your analysis selection stays the same.</p>
      </div>}
      {eventTotal > 0 ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 block w-full max-w-3xl" role="group" aria-labelledby={`${id}-title ${id}-desc`}>
          <title id={`${id}-title`}>{activityLabel} end-event records by day of month</title>
          <desc id={`${id}-desc`}>Bars count event records on calendar days 1 to 31. The exact day table follows. Repeated events can belong to the same case; counts do not establish a business schedule or cause.</desc>
          {y.ticks(3).filter(t => Number.isInteger(t)).map(t => <g key={t}>
            <line x1={40} x2={width - 8} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" />
            <text x={34} y={y(t) + 3} textAnchor="end" fontSize={10} fill="currentColor" className="text-text-muted">{fmtInt(t)}</text>
          </g>)}
          {buckets.map(b => <g key={b.day} role="button" {...navigateDay(String(b.day))} aria-label={`Inspect day ${b.day}: ${fmtInt(b.events)} records, ${fmtInt(b.cases)} distinct cases`} onMouseEnter={() => setSelectedDay(b.day)} onClick={() => setSelectedDay(b.day)}>
            <rect x={x(b.day)} y={12} width={x.bandwidth()} height={y(0) - 12} fill="transparent" />
            <rect x={x(b.day)} y={y(b.events)} width={x.bandwidth()} height={y(0) - y(b.events)} rx={2} fill="currentColor" className="text-accent"  />
            <rect x={(x(b.day) ?? 0) + x.bandwidth() * .3} y={y(b.cases)} width={x.bandwidth() * .4} height={Math.max(0, y(0) - y(b.cases))} fill="var(--color-accent-subtle)" pointerEvents="none" />
            {selectedDay === b.day && <rect x={(x(b.day) ?? 0) - 2} y={10} width={x.bandwidth() + 4} height={y(0) - 8} fill="none" stroke="var(--color-heading)" strokeDasharray="2 2" pointerEvents="none" />}
            <title>Day {b.day}: {fmtInt(b.events)} records, {eventShare(b.events, eventTotal)}, {fmtInt(b.cases)} distinct cases</title>
          </g>)}
          {buckets.filter(b => b.day === 1 || b.day % 5 === 0 || b.day === 31).map(b => <text key={b.day} x={(x(b.day) ?? 0) + x.bandwidth() / 2} y={height - 12} textAnchor="middle" fontSize={11} fill="currentColor" className="text-text-muted">{b.day}</text>)}
        </svg>
      ) : <p className="mt-2 text-sm text-text-muted">No dated end-event records were observed in this evidence population.</p>}
      <p className="mt-1 text-xs text-text-muted">Blue: event records · inner light bar: distinct cases · dotted outline: inspection only. Raw counts across the observed months; months have different lengths and coverage. A cluster is a pattern to investigate, not proof of a scheduled batch. A case may appear on several days.</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-accent-text">Exact day-of-month table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded border border-border">
          <table className="w-full text-left text-xs tnum">
            <caption className="p-2 text-left text-text-muted">{activityLabel}. Event denominator: {fmtInt(eventTotal)} dated end-event records. Case denominator: {fmtInt(caseTotal)} distinct cases with dated end-event records; daily case counts are not additive.</caption>
            <thead className="sticky top-0 bg-surface"><tr><th scope="col" className="p-2">Day</th><th scope="col" className="p-2">Event records</th><th scope="col" className="p-2">Share of records</th><th scope="col" className="p-2">Distinct cases</th></tr></thead>
            <tbody>{buckets.map(b => <tr key={b.day} className="border-t border-border"><th scope="row" className="p-2 font-normal">{b.day}</th><td className="p-2">{fmtInt(b.events)}</td><td className="p-2" title={eventTotal > 0 ? `${b.events} / ${eventTotal}` : undefined}>{eventShare(b.events, eventTotal)}</td><td className="p-2">{fmtInt(b.cases)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
