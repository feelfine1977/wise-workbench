import { scaleLinear, symbol, symbolCircle, symbolDiamond, symbolTriangle } from "d3";
import { useId } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { ChartTable } from "@/components/charts/ChartTable";
import { fmtCompact, fmtInt, fmtNum } from "@/lib/format";
import { sliceLabel } from "@/lib/utils";
import { confidenceOf, kindOf } from "@/lib/vocabulary";
import { priorityRows } from "./chartData";

const kindsFor = (noun: string) => [
  { kind: "acute", label: `Acute · few ${noun}, far off`, shape: symbolTriangle },
  { kind: "systematic", label: "Systematic · concentrated pattern", shape: symbolDiamond },
  { kind: "widespread", label: `Widespread · many ${noun}, smaller gaps`, shape: symbolCircle },
  { kind: "unknown", label: "Unknown / unclassified", shape: symbolCircle },
] as const;
const color = (kind: string) => kind === "unknown" ? "var(--color-text-muted)" : `var(--kind-${kind}-fg)`;

export function PrioritySupport({ rows, total, scope, onSelect, activeKey, noun = "cases" }: {
  rows: BacklogRow[]; total: number; scope: string; onSelect: (key: string) => void; activeKey?: string; noun?: string;
}) {
  const id = useId();
  const kinds = kindsFor(noun);
  const valid = priorityRows(rows);
  const ranked = valid.slice(0, 6);
  const x = scaleLinear().domain([0, Math.max(1, ...valid.map((r) => r.n_cases))]).nice().range([60, 690]);
  const y = scaleLinear().domain([0, Math.max(1, ...valid.map((r) => r.stable_PI))]).nice().range([246, 28]);
  const area = scaleLinear().domain([0, Math.max(1, ...valid.map((r) => r.stable_PI))]).range([0, 800]);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-surface p-4" data-testid="priority-support">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-base font-semibold">Choose a group to investigate</h2>
        <span className="text-xs text-text-muted">{scope} · {fmtInt(rows.length)} of {fmtInt(total)} matching groups loaded</span>
      </div>
      <p className="mt-1 text-sm text-text-muted">Priority versus support. Higher means greater discounted priority; further right means more {noun}. Symbol area represents priority.</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted" aria-label="Problem kind key">
        {kinds.map((entry) => <li key={entry.kind} className="flex items-center gap-1.5"><svg width="18" height="18" viewBox="-12 -12 24 24" aria-hidden><path d={symbol().type(entry.shape).size(90)() ?? undefined} fill={color(entry.kind)} /></svg>{entry.label}</li>)}
      </ul>
      <p className="mt-1 text-xs text-text-muted">Kinds describe assessed patterns, not proven causes. Rank confidence is shown separately.</p>
      {!valid.length ? <p className="mt-3 text-sm text-text-muted">No measured priority and counts of {noun} are available.</p> : (
        <div className="mt-3 grid items-center gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)]">
          <div className="min-w-0 overflow-x-auto">
            <svg viewBox="0 0 730 300" className="w-full min-w-[350px]" role="group" aria-label={`Priority and support from ${noun}; select a group to open its reasons`}>
              {y.ticks(4).map((tick) => <g key={tick}><line x1={60} x2={690} y1={y(tick)} y2={y(tick)} className="stroke-border" /><text x={50} y={y(tick) + 4} textAnchor="end" className="fill-text-muted text-[12px]">{fmtCompact(tick)}</text></g>)}
              {x.ticks(4).map((tick) => <text key={tick} x={x(tick)} y={268} textAnchor="middle" className="fill-text-muted text-[12px]">{fmtCompact(tick)}</text>)}
              <text x={60} y={15} className="fill-text-muted text-[12px]">Discounted priority (stable PI)</text>
              <text x={375} y={291} textAnchor="middle" className="fill-text-muted text-[12px]">{noun} in group · linear scale</text>
              {[...valid].reverse().map((r) => {
                const kind = kindOf(r) ?? "unknown";
                const shape = kinds.find((entry) => entry.kind === kind)!.shape;
                return <path key={r.key} transform={`translate(${x(r.n_cases)},${y(r.stable_PI)})`} d={symbol().type(shape).size(r.stable_PI === 0 ? 28 : area(r.stable_PI))() ?? undefined}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  fill={r.stable_PI === 0 ? "none" : color(kind)} stroke={color(kind)} fillOpacity={0.55} strokeWidth={r.key === activeKey ? 3 : 1}
                  role="button" tabIndex={0} aria-label={`Investigate ${sliceLabel(r)}: ${fmtInt(r.n_cases)} ${noun}, priority ${fmtNum(r.stable_PI, 2)}`}
                  onClick={() => onSelect(r.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.key); } }}>
                  <title>{sliceLabel(r)} · {fmtInt(r.n_cases)} {noun} · priority {fmtNum(r.stable_PI, 2)} · {kind} · rank confidence {confidenceOf(r.stability)}</title>
                </path>;
              })}
            </svg>
          </div>
          <ol className="space-y-1" aria-label="Highest priorities among loaded groups">
            {ranked.map((r, i) => <li key={r.key}>
              <button type="button" onClick={() => onSelect(r.key)} className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <span aria-hidden className="tnum text-text-subtle">{i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{sliceLabel(r)}</span><span className="text-xs text-text-muted">{fmtInt(r.n_cases)} {noun} · rank confidence {confidenceOf(r.stability)}</span></span>
                <span className="tnum text-sm font-semibold">{fmtNum(r.stable_PI, 1)}</span>
              </button>
            </li>)}
          </ol>
        </div>
      )}
      <p className="mt-2 text-xs text-text-muted">Support is group size, not proof of a cause. Priorities are comparable within this view and selection. Zero priority is shown as a small outlined symbol.</p>
      {valid.length !== rows.length && <p className="text-xs text-text-muted">{rows.length - valid.length} groups lack valid counts or priority and are not plotted.</p>}
      <ChartTable label="Priority and support for loaded groups">
        <thead><tr><th scope="col">Group</th><th scope="col">{noun}</th><th scope="col">Discounted priority</th><th scope="col">Rank confidence</th><th scope="col">Kind</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><th scope="row"><button type="button" onClick={() => onSelect(r.key)} className="text-accent-text underline">{sliceLabel(r)}</button></th><td>{fmtInt(r.n_cases)}</td><td>{fmtNum(r.stable_PI, 2)}</td><td>{confidenceOf(r.stability)}</td><td>{kindOf(r) ?? "unknown / unclassified"}</td></tr>)}</tbody>
      </ChartTable>
    </section>
  );
}
