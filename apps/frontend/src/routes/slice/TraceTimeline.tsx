import { useMemo } from "react";
import type { Trace } from "@wise/api-schema";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime, fmtDays } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

/** A simple trace timeline: events on a time axis, violated constraints marked with a glyph and listed; table alternative below. */
export function TraceTimeline({ trace, highlight, onHighlight }: { trace: Trace; highlight?: string; onHighlight?: (constraintId: string | undefined) => void }) {
  const events = useMemo(() => [...(trace.events ?? [])].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")), [trace.events]);
  const t0 = events[0]?.timestamp ? new Date(events[0].timestamp).getTime() : 0;
  const t1 = events[events.length - 1]?.timestamp ? new Date(events[events.length - 1]?.timestamp as string).getTime() : t0;
  const span = Math.max(1, t1 - t0);
  const width = 720;
  const pad = 24;
  const x = (ts?: string | null) => pad + ((ts ? new Date(ts).getTime() - t0 : 0) / span) * (width - pad * 2);
  const violatedAll = useMemo(() => [...new Set(events.flatMap((e) => e.violates ?? []))], [events]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="font-mono text-text">{trace.caseId}</span>
        <span>· {events.length} events · {fmtDays(span / DAY)} from first to last</span>
        {Object.entries(trace.attributes ?? {})
          .slice(0, 6)
          .map(([k, v]) => (
            <Badge key={k} variant="outline" className="font-mono">
              {k.replace(/^case /, "")}: {String(v)}
            </Badge>
          ))}
      </div>
      <div className="overflow-x-auto">
        <svg role="img" aria-label={`Timeline of case ${trace.caseId} with ${violatedAll.length} violated constraints`} viewBox={`0 0 ${width} 140`} className="h-[140px] min-w-[720px] w-full">
          <line x1={pad} y1={70} x2={width - pad} y2={70} stroke="var(--color-border-strong)" strokeWidth={2} />
          {events.map((e, i) => {
            const cx = x(e.timestamp);
            const bad = (e.violates?.length ?? 0) > 0;
            const hit = highlight && e.violates?.includes(highlight);
            const up = i % 2 === 0;
            return (
              <g key={i} transform={`translate(${cx},70)`} onMouseEnter={() => onHighlight?.(e.violates?.[0])} onMouseLeave={() => onHighlight?.(undefined)}>
                {bad ? (
                  <polygon points="0,-8 8,6 -8,6" fill={hit ? "var(--color-accent)" : "var(--hotspot-severity-solid)"} stroke="var(--color-surface)" strokeWidth={1.5} />
                ) : (
                  <circle r={6} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1.5} />
                )}
                <line x1={0} y1={up ? -10 : 10} x2={0} y2={up ? -26 : 26} stroke="var(--color-border-strong)" />
                <text x={0} y={up ? -30 : 40} textAnchor="middle" fontSize={10} fill="var(--color-text)" className="font-sans">
                  {e.activity}
                </text>
                <text x={0} y={up ? -42 : 52} textAnchor="middle" fontSize={9} fill="var(--color-text-subtle)">
                  {e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : ""}
                </text>
                {bad && (
                  <text x={0} y={up ? 22 : -16} textAnchor="middle" fontSize={9} fill="var(--hotspot-severity-fg)" className="font-mono">
                    ▲ {e.violates?.length}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <table className="tnum w-full text-xs">
        <caption className="sr-only">Events of case {trace.caseId}</caption>
        <thead>
          <tr className="text-left text-text-muted">
            <th scope="col" className="py-1">#</th>
            <th scope="col">activity</th>
            <th scope="col">timestamp</th>
            <th scope="col">Δ prev</th>
            <th scope="col">resource</th>
            <th scope="col">violates</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const prev = events[i - 1]?.timestamp;
            const delta = prev && e.timestamp ? (new Date(e.timestamp).getTime() - new Date(prev).getTime()) / DAY : undefined;
            const bad = (e.violates?.length ?? 0) > 0;
            return (
              <tr key={i} className={cn("border-t border-border", bad && "bg-danger-subtle/40")}>
                <td className="py-1 text-text-subtle">{i + 1}</td>
                <td className="font-medium">{e.activity}</td>
                <td>{fmtDateTime(e.timestamp)}</td>
                <td>{delta === undefined ? "–" : fmtDays(delta)}</td>
                <td className="font-mono">{e.resource}</td>
                <td>
                  {bad ? (
                    <span className="flex flex-wrap gap-1">
                      {e.violates?.map((v) => (
                        <button key={v} type="button" onClick={() => onHighlight?.(highlight === v ? undefined : v)} className={cn("rounded-sm border px-1 font-mono text-[11px]", highlight === v ? "border-accent bg-accent-subtle text-accent-text" : "border-border")} aria-pressed={highlight === v}>
                          <span aria-hidden>▲ </span>
                          {v}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="text-text-subtle">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
