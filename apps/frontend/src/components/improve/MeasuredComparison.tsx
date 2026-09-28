import { scaleLinear } from "d3";
import { useId } from "react";
import { ChartTable } from "@/components/charts/ChartTable";
import { fmtInt, fmtNum } from "@/lib/format";
import { measuredPair } from "./chartData";

export function MeasuredComparison({ row, label, selected, view, noun = "cases" }: { row?: Record<string, unknown>; label: string; selected: boolean; view?: string; noun?: string }) {
  const id = useId();
  const pair = measuredPair(row, noun);
  const minimum = pair ? Math.min(0, pair.here, pair.elsewhere) : 0;
  const maximum = pair ? Math.max(0, pair.here, pair.elsewhere) : 1;
  const x = scaleLinear().domain(pair?.measure === "Missed" ? [0, 100] : [minimum, maximum === minimum ? minimum + 1 : maximum]).nice().range([55, 645]);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby={`${id}-title`} data-testid="measured-comparison">
      <h2 id={`${id}-title`} className="text-base font-semibold">Measured comparison · {label}</h2>
      <p className="mt-1 text-xs text-text-muted">Whole group versus the rest of the run · {view ?? "this view"}{selected ? "; filters and parent selection do not apply to this summary" : ""}.</p>
      {!pair ? <p className="mt-3 text-sm text-text-muted">Two comparable measurements are unavailable for this expectation. Missing measurements are not zero.</p> : <>
        <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
          <p><span className="font-semibold">● Whole group</span><br /><span className="tnum text-xl">{fmtNum(pair.here, 2)}</span> {pair.unit}</p>
          <p className="text-right"><span className="font-semibold">◇ Rest of run</span><br /><span className="tnum text-xl">{fmtNum(pair.elsewhere, 2)}</span> {pair.unit}</p>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox="0 0 700 110" className="w-full min-w-[320px]" role="img" aria-label={`${pair.measure}: whole group ${fmtNum(pair.here, 2)} ${pair.unit}; rest of run ${fmtNum(pair.elsewhere, 2)} ${pair.unit}`}>
            <line x1={55} x2={645} y1={70} y2={70} className="stroke-border" />
            {x.ticks(5).map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={67} y2={74} className="stroke-border" /><text x={x(tick)} y={94} textAnchor="middle" className="fill-text-muted text-[12px]">{fmtNum(tick, Math.abs(tick) < 1 && tick !== 0 ? 2 : 0)}</text></g>)}
            <line x1={x(pair.here)} x2={x(pair.elsewhere)} y1={43} y2={43} className="stroke-text-muted" strokeWidth={3} />
            <circle cx={x(pair.here)} cy={43} r={8} className="fill-accent stroke-surface" strokeWidth={2} />
            <path d={`M${x(pair.elsewhere)},32 l11,11 -11,11 -11,-11 Z`} className="fill-surface stroke-text" strokeWidth={2} />
          </svg>
        </div>
        <p className="text-xs text-text-muted">{pair.measure} in {pair.unit}. {pair.measure === "Median" ? `Medians use available raw measurements among scored ${noun}.` : `Rates use evaluated ${noun} among scored ${noun}.`} This is an observed comparison, not a before/after estimate or an effect of an action.</p>
        <p className="mt-1 text-xs text-text-muted">Evaluated {noun}: whole group {pair.evaluatedHere === undefined ? "not supplied" : fmtInt(pair.evaluatedHere)}; rest of run {pair.evaluatedElsewhere === undefined ? "not supplied" : fmtInt(pair.evaluatedElsewhere)}. Evaluation counts are not counts of nonmissing raw measurements.</p>
        <ChartTable label={`Measured values: ${label}`}>
          <thead><tr><th scope="col">Population</th><th scope="col">{pair.measure} ({pair.unit})</th><th scope="col">Evaluated {noun}</th></tr></thead>
          <tbody><tr><th scope="row">Whole group</th><td>{fmtNum(pair.here, 3)}</td><td>{pair.evaluatedHere === undefined ? "Not supplied" : fmtInt(pair.evaluatedHere)}</td></tr><tr><th scope="row">Rest of run</th><td>{fmtNum(pair.elsewhere, 3)}</td><td>{pair.evaluatedElsewhere === undefined ? "Not supplied" : fmtInt(pair.evaluatedElsewhere)}</td></tr></tbody>
        </ChartTable>
      </>}
    </section>
  );
}
