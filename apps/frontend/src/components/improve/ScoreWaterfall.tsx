import { scaleLinear } from "d3";
import { useId, useState } from "react";
import type { Table } from "@wise/api-schema";
import { ChartTable } from "@/components/charts/ChartTable";
import { fmtNum } from "@/lib/format";
import { scoreWaterfallData } from "./chartData";

export interface ScoreWaterfallProps {
  drivers: Table | undefined;
  baseline: unknown;
  groupScore: unknown;
  groupName: string;
  view?: string;
  selected: boolean;
  noun: string;
  plainOf: (id: string) => string;
  layerNames: Record<string, string>;
  onSelect: (id: string) => void;
}

const points = (value: number) => fmtNum(value * 100, 2);
const signedPoints = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value) > 0 && Math.abs(value * 100) < .005 ? "<0.005" : points(Math.abs(value))}`;
const tone = (value: number) => value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-text-muted";
const fill = (value: number) => value > 0 ? "var(--color-success)" : value < 0 ? "var(--color-danger)" : "var(--color-text-muted)";
const rowLayout = "grid min-w-0 gap-x-5 md:grid-cols-[minmax(200px,0.9fr)_minmax(0,1.7fr)]";

export function ScoreWaterfall({ drivers, baseline, groupScore, groupName, view, selected, noun, plainOf, layerNames, onSelect }: ScoreWaterfallProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const data = scoreWaterfallData(drivers, baseline, groupScore);
  const steps = data ? expanded ? data.all : data.collapsed : [];
  // Keep the same scale when the remainder is expanded, including every intermediate position.
  const positions = data ? [data.baseline, data.groupScore, ...data.all.flatMap(row => [row.before, row.after])] : [0, 1];
  const low = Math.min(...positions), high = Math.max(...positions);
  const padding = Math.max((high - low) * .08, .01);
  const scale = scaleLinear().domain([low - padding, high + padding]).nice().range([24, 616]);
  const ticks = scale.ticks(4);
  const grid = () => ticks.map(tick => <line key={tick} x1={scale(tick)} x2={scale(tick)} y1={0} y2={56} stroke="currentColor" opacity={.08} />);
  const endpoint = (label: string, value: number, final: boolean) => <div className={`${rowLayout} rounded-lg bg-surface-sunken px-3 py-2`}>
    <div className="min-w-0 self-center"><p className="text-sm font-semibold">{label}</p><p className="tnum text-lg font-semibold">{points(value)} <span className="text-xs font-normal text-text-muted">/ 100</span></p></div>
    <svg viewBox="0 0 640 56" className="w-full self-center" aria-hidden="true">
      {grid()}
      <line x1={scale(value)} x2={scale(value)} y1={final ? 0 : 28} y2={final ? 28 : 56} stroke="currentColor" strokeDasharray="3 3" opacity={.5} />
      {final ? <path d={`M${scale(value)},19 l9,9 -9,9 -9,-9 Z`} fill="currentColor" /> : <circle cx={scale(value)} cy={28} r={7} fill="currentColor" />}
    </svg>
  </div>;
  return <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface p-4" aria-labelledby={`${id}-title`} data-testid="score-waterfall">
    <h2 id={`${id}-title`} className="text-base font-semibold">How this group’s score differs</h2>
    <p className="mt-1 break-words text-sm text-text-muted">{groupName} · whole group · {view ?? "this view"} · compared with the whole run.</p>
    {selected && <p className="mt-1 text-xs text-text-muted">Filters and parent selection do not rescore this chart. The selected subset’s score difference is unavailable here.</p>}
    {!data ? <p className="mt-3 text-sm text-text-muted">An exact additive breakdown is unavailable. Both measured mean scores and all signed contributions must reconcile before a waterfall can be drawn. Missing contributions are not estimated.</p> : <>
      <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-3" aria-label="Measured score comparison">
        <div><p className="text-xs text-text-muted">Whole-run mean</p><p className="tnum text-xl font-semibold">{points(data.baseline)} <span className="text-xs font-normal">/ 100</span></p></div>
        <div><p className="text-xs text-text-muted">Net score difference</p><p className={`tnum text-xl font-semibold ${tone(data.net)}`}>{signedPoints(data.net)} <span className="text-xs font-normal">score points</span></p></div>
        <div><p className="text-xs text-text-muted">Whole-group mean</p><p className="tnum text-xl font-semibold">{points(data.groupScore)} <span className="text-xs font-normal">/ 100</span></p></div>
      </div>
      <p className="mt-3 text-xs text-text-muted">Start at the whole-run mean, then add each expectation’s signed contribution to reach the whole-group mean. Means use scored {noun} in this view.</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Score contribution key">
        <li className="text-success">+ Higher score · lower penalty</li><li className="text-danger">− Lower score · higher penalty</li><li className="text-text-muted">0 No score difference</li>
      </ul>
      <div className="mt-3" aria-label="Score waterfall from whole run to whole group" role="group">
        <div className={`${rowLayout} px-3`}>
          <p className="self-center text-xs text-text-muted">Expectation · signed score points</p>
          <div className="relative h-8 w-full text-xs text-text-muted" aria-hidden="true">
            {ticks.map(tick => <span key={tick} className="absolute top-0 h-full -translate-x-1/2" style={{ left: `${scale(tick) / 640 * 100}%` }}><span className="tnum">{fmtNum(tick * 100, 1)}</span><span className="absolute bottom-0 left-1/2 h-3 border-l border-border" /></span>)}
          </div>
        </div>
        {endpoint("Start · whole-run mean", data.baseline, false)}
        <ol id={`${id}-steps`} className="my-1" aria-label="Signed expectation contributions">
          {steps.map((step, index) => {
            const remaining = step.remaining !== undefined;
            const label = remaining ? `Remaining ${step.remaining} expectations` : plainOf(step.constraint!);
            const start = scale(step.before), end = scale(step.after);
            const length = Math.abs(end - start), head = Math.min(7, length / 2);
            const direction = step.delta >= 0 ? 1 : -1;
            const arrow = `M${start},16 H${end - direction * head} L${end},28 L${end - direction * head},40 H${start} Z`;
            const select = () => remaining ? setExpanded(true) : onSelect(step.constraint!);
            return <li key={step.constraint ?? "remainder"} className={`${rowLayout} border-b border-border/60 px-3 py-2 last:border-0`}>
              <button type="button" onClick={select} className="min-w-0 rounded-sm py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent hover:underline" aria-label={`${remaining ? "Expand" : "Inspect"} ${label}: ${signedPoints(step.delta)} score points`} aria-expanded={remaining ? false : undefined} aria-controls={remaining ? `${id}-steps` : undefined}>
                <span className="block break-words text-sm font-medium">{label}</span>
                <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"><strong className={`tnum ${tone(step.delta)}`}>{signedPoints(step.delta)} score points</strong><span className="break-words text-text-muted">{remaining ? "Exact signed sum · expand to inspect" : layerNames[step.layer!] ?? step.layer}</span></span>
              </button>
              <svg viewBox="0 0 640 56" className="w-full self-center" aria-hidden="true">
                {grid()}
                <line x1={start} x2={start} y1={0} y2={16} stroke="currentColor" strokeDasharray="3 3" opacity={.5} />
                <line x1={end} x2={end} y1={40} y2={56} stroke="currentColor" strokeDasharray="3 3" opacity={.5} />
                {step.delta === 0 ? <line x1={start} x2={start} y1={16} y2={40} stroke={fill(0)} strokeWidth={2} /> : <path d={arrow} fill={fill(step.delta)} fillOpacity={.8} stroke={fill(step.delta)} strokeWidth={length < 1 ? 1 : 0} />}
                <title>{`${index + 1}. ${label}: ${signedPoints(step.delta)} score points; accumulated position ${points(step.before)} to ${points(step.after)}`}</title>
              </svg>
            </li>;
          })}
        </ol>
        {endpoint("End · whole-group mean", data.groupScore, true)}
      </div>
      {data.remaining > 0 && <button type="button" className="mt-3 rounded-sm text-sm text-accent-text underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={expanded} aria-controls={`${id}-steps`} onClick={() => setExpanded(value => !value)}>{expanded ? "Show six largest contributions" : `Expand waterfall to all ${data.all.length} expectations`}</button>}
      <p className="mt-3 text-xs text-text-muted">Axis: score points; zoomed to the accumulated positions. Expectations are ordered by absolute contribution. Intermediate positions are running sums; only the start and end are measured mean scores. Displayed numbers are rounded.</p>
      <details className="mt-3 text-xs text-text-muted"><summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">How this score is explained</summary><p className="mt-2">WISE uses the saved norm’s effective penalties. A lower mean penalty in this group adds to its score; a higher one subtracts from it. This is a deterministic score decomposition, not a causal effect, an action forecast, or an estimate of operational benefits.</p></details>
      <ChartTable label="Waterfall contributions and measured mean scores">
        <thead><tr><th scope="col">Expectation / reference</th><th scope="col">Area</th><th scope="col">Signed score points</th><th scope="col">Accumulated score points</th></tr></thead>
        <tbody>
          <tr><th scope="row">Whole-run mean · measured</th><td>Reference</td><td>—</td><td>{fmtNum(data.baseline * 100, 6)}</td></tr>
          {data.all.map(step => <tr key={step.constraint}><th scope="row"><button type="button" onClick={() => onSelect(step.constraint!)} className="break-words text-left text-accent-text underline">{plainOf(step.constraint!)}</button></th><td>{layerNames[step.layer!] ?? step.layer}</td><td title={`${step.delta} score units`}>{step.delta > 0 ? "+" : ""}{fmtNum(step.delta * 100, 6)}</td><td>{fmtNum(step.after * 100, 6)}</td></tr>)}
          <tr><th scope="row">Whole-group mean · measured</th><td>Result</td><td>{signedPoints(data.net)} net</td><td>{fmtNum(data.groupScore * 100, 6)}</td></tr>
        </tbody>
      </ChartTable>
    </>}
  </section>;
}
