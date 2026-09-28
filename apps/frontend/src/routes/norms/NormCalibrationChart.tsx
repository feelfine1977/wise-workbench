import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { area, curveStepAfter, scaleLinear } from "d3";
import type { components } from "@wise/api-schema";
import { normPreviewQuery } from "@/lib/api/norms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { ruleSentence, thresholdOf, type Constraint } from "./Builder";
import { thresholdSettingsIssue } from "./normBatchPolicy";

type Distribution = components["schemas"]["Distribution"];
const unitNames: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds" };
const number = (value: number) => fmtNum(value, Math.abs(value) < 1 ? 3 : 1);

/** Visual summaries never estimate draft evaluation counts: those come from the canonical evaluator. */
export function NormCalibrationChart({ projectId, versionId, caseTableId, selectionId, constraint, distribution, title, populationName, onCommit }: {
  projectId: string; versionId: string; caseTableId: string; selectionId?: string;
  constraint: Constraint; distribution: Distribution; title: string; populationName: string;
  onCommit: (next: { threshold: number; width: number }) => void;
}) {
  const initial = thresholdOf(constraint)!;
  const [target, setTarget] = useState(String(initial.threshold));
  const [tolerance, setTolerance] = useState(String(initial.width));
  const [presentation, setPresentation] = useState<"histogram" | "cumulative">("histogram");
  const threshold = Number(target), width = Number(tolerance);
  const validationIssue = thresholdSettingsIssue(constraint, target, tolerance);
  const valid = validationIssue === undefined;
  const proposal = useMemo(() => ({ ...constraint, params: { ...constraint.params, [initial.keys[0]]: threshold, [initial.keys[1]]: width } }), [constraint, initial.keys[0], initial.keys[1], threshold, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const serialized = JSON.stringify(proposal);
  const [settled, setSettled] = useState(serialized);
  useEffect(() => { const timer = setTimeout(() => setSettled(serialized), 350); return () => clearTimeout(timer); }, [serialized]);
  const waiting = settled !== serialized;
  const preview = useQuery({ ...normPreviewQuery(projectId, versionId, constraint.id, { caseTableId, selectionId, constraint: JSON.parse(settled) as Record<string, unknown> }), enabled: valid && !waiting });
  // Never label a previous request's counts as belonging to the current edited target.
  const exact = valid && !waiting && preview.data?.caseTableId === caseTableId && preview.data.normVersionId === versionId && preview.data.constraintId === constraint.id && (preview.data.scope.selectionId ?? undefined) === selectionId ? preview.data : undefined;
  const stats = distribution.stats ?? {};
  const bins = distribution.bins ?? [];
  const ecdf = distribution.ecdf ?? [];
  const observed = typeof stats.n === "number" ? stats.n : undefined;
  const applicable = distribution.casesInScope ?? (typeof stats.nCases === "number" ? stats.nCases : undefined);
  const unit = unitNames[distribution.unit ?? ""] ?? distribution.unit ?? "units";
  const low = distribution.direction === "low";
  const xValues = [...bins.flatMap(bin => [bin.x0, bin.x1]), ...ecdf.map(point => point[0]!), initial.threshold, ...(valid ? [threshold, low ? threshold - width : threshold + width] : [])].filter(Number.isFinite);
  const minimum = Math.min(...xValues, 0), maximum = Math.max(...xValues, 1);
  const pad = (maximum - minimum) * 0.04;
  const x = scaleLinear().domain([minimum - pad, maximum + pad]).range([62, 802]);
  const y = scaleLinear().domain([0, presentation === "cumulative" ? 1 : Math.max(...bins.map(bin => bin.n), 1)]).nice().range([240, 25]);
  const chartId = useId();
  const cumulative = area<number[]>().x(point => x(point[0]!)).y0(240).y1(point => y(point[1]!)).curve(curveStepAfter)(ecdf);
  const setPlotTarget = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pixel = (event.clientX - rect.left) * 840 / rect.width;
    const py = (event.clientY - rect.top) * 295 / rect.height;
    if (pixel < 62 || pixel > 802 || py < 25 || py > 240) return;
    const value = x.invert(pixel);
    setTarget(String(constraint.type === "singularity" ? Math.max(0, Math.round(value)) : Math.round(value * 1000) / 1000));
  };
  return <section aria-label="Threshold calibration" className="overflow-hidden rounded-2xl border border-border bg-surface">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
      <div><p className="text-xs font-medium uppercase tracking-wider text-accent-text">Explore a target</p><h3 className="mt-1 text-lg font-semibold">{title}</h3><p className="mt-1 text-sm">Saved rule: {ruleSentence(constraint)}</p><p className="mt-1 text-xs text-text-muted">{populationName} · {observed === undefined ? "Observation coverage unavailable" : `${fmtInt(observed)} finite measurements`}{applicable === undefined ? "" : ` / ${fmtInt(applicable)} applicable cases`}</p></div>
      <div role="group" aria-label="Calibration chart type" className="flex rounded-lg border border-border p-1">
        <Button size="sm" variant={presentation === "histogram" ? "secondary" : "ghost"} aria-pressed={presentation === "histogram"} onClick={() => setPresentation("histogram")}>Distribution</Button>
        <Button size="sm" variant={presentation === "cumulative" ? "secondary" : "ghost"} aria-pressed={presentation === "cumulative"} onClick={() => setPresentation("cumulative")}>Cumulative</Button>
      </div>
    </div>
    <div className="p-4">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted"><span>▰ Measured cases</span><span className="text-accent-text">┃ Proposed target</span><span>┆ Saved target</span><span>Tinted band: tolerance</span></div>
      <svg viewBox="0 0 840 295" className="w-full touch-pan-y" role="img" aria-label={`${presentation === "histogram" ? "Distribution" : "Cumulative distribution"} in ${unit}; click to propose a target, or use the target input below`} onPointerDown={setPlotTarget}>
        <title>{title} · native measurements</title>
        <defs><linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b6fe8" stopOpacity="0.95" /><stop offset="100%" stopColor="#2baaaa" stopOpacity="0.65" /></linearGradient></defs>
        {valid && <rect x={Math.min(x(threshold), x(low ? threshold - width : threshold + width))} y="25" width={Math.abs(x(threshold) - x(low ? threshold - width : threshold + width))} height="215" fill="var(--color-accent, #5b6fe8)" opacity="0.09" />}
        {y.ticks(4).filter(tick => presentation === "cumulative" || Number.isInteger(tick)).map(tick => <g key={tick}><line x1="62" x2="802" y1={y(tick)} y2={y(tick)} stroke="currentColor" opacity="0.09" /><text x="51" y={y(tick) + 4} textAnchor="end" fill="currentColor" fontSize="11">{presentation === "cumulative" ? fmtPct(tick, 0) : fmtInt(tick)}</text></g>)}
        {presentation === "histogram" ? bins.map((bin, index) => <rect key={index} x={x(bin.x0) + 0.6} y={y(bin.n)} width={Math.max(1, x(bin.x1) - x(bin.x0) - 1.2)} height={240 - y(bin.n)} rx="2" fill={`url(#${chartId})`}><title>{number(bin.x0)}–{number(bin.x1)} {unit}: {fmtInt(bin.n)} cases</title></rect>) : <path d={cumulative ?? ""} fill={`url(#${chartId})`} fillOpacity="0.22" stroke="#596cde" strokeWidth="2" />}
        <line x1={x(initial.threshold)} x2={x(initial.threshold)} y1="20" y2="245" stroke="currentColor" strokeDasharray="4 4" opacity="0.6" />
        {valid && <g><line x1={x(threshold)} x2={x(threshold)} y1="20" y2="245" stroke="#6752d8" strokeWidth="2.5" /><circle cx={x(threshold)} cy="20" r="5" fill="#6752d8" /></g>}
        {x.ticks(6).map(tick => <text key={tick} x={x(tick)} y="260" textAnchor="middle" fontSize="11" fill="currentColor">{number(tick)}</text>)}
        <text x="432" y="284" textAnchor="middle" fontSize="12" fill="currentColor">{unit}</text>
      </svg>
      <p className="text-xs text-text-muted">Click the plot to move the target. {presentation === "cumulative" ? "The cumulative curve summarizes sampled quantiles; exact counts below are evaluated from all cases." : "Histogram bins summarize measured values; exact draft effects are calculated separately."}{distribution.below?.n || distribution.beyond?.n ? ` Outside the displayed bins: ${fmtInt((distribution.below?.n ?? 0) + (distribution.beyond?.n ?? 0))} measurements.` : ""}</p>
      {distribution.note && <p className="mt-2 text-xs text-text-muted">{distribution.note}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="text-sm"><label htmlFor={`${chartId}-target`}>Target ({unit})</label><Input id={`${chartId}-target`} type="number" step={constraint.type === "singularity" ? 1 : "any"} value={target} onChange={event => setTarget(event.target.value)} className="mt-1" /><input aria-label="Move target" type="range" min={Math.min(minimum, threshold || 0)} max={Math.max(maximum, threshold || 0)} step={constraint.type === "singularity" ? 1 : (maximum - minimum) / 500} value={valid ? threshold : initial.threshold} onChange={event => setTarget(event.target.value)} className="mt-2 w-full accent-indigo-600" /></div>
        <div className="text-sm"><label htmlFor={`${chartId}-width`}>Tolerance width ({unit})</label><Input id={`${chartId}-width`} type="number" min={0} step="any" value={tolerance} onChange={event => setTolerance(event.target.value)} className="mt-1" /><span className="mt-2 block text-xs text-text-muted">{low ? "Values below the target accumulate a penalty." : "Values above the target accumulate a penalty."} {constraint.type === "singularity" ? "Tolerance must be positive; fractional widths are allowed." : "A zero width applies the rule’s sharp boundary."}</span></div>
      </div>
      <div aria-live="polite" className="mt-4 rounded-xl border border-border bg-surface-sunken p-3">
        <h4 className="text-sm font-semibold">Exact preview · saved → proposed</h4>
        {!valid ? <p className="mt-1 text-sm text-danger">{validationIssue}</p> : waiting || preview.isPending ? <p role="status" className="mt-1 text-sm">Evaluating proposed target…</p> : exact ? <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-text-muted">Violating / evaluated cases</dt><dd className="mt-1 font-semibold tabular-nums">{fmtInt(exact.saved.counts.violatingCases)} / {fmtInt(exact.saved.counts.evaluatedCases)} → {fmtInt(exact.proposed.counts.violatingCases)} / {fmtInt(exact.proposed.counts.evaluatedCases)}</dd></div>
            <div><dt className="text-xs text-text-muted">Violation share</dt><dd className="mt-1 font-semibold tabular-nums">{exact.saved.counts.violationShare == null ? "Unavailable" : fmtPct(exact.saved.counts.violationShare, 1)} → {exact.proposed.counts.violationShare == null ? "Unavailable" : fmtPct(exact.proposed.counts.violationShare, 1)}</dd></div>
            <div><dt className="text-xs text-text-muted">Mean penalty · 0–1</dt><dd className="mt-1 font-semibold tabular-nums">{exact.saved.counts.meanPenalty == null ? "Unavailable" : fmtNum(exact.saved.counts.meanPenalty, 3)} → {exact.proposed.counts.meanPenalty == null ? "Unavailable" : fmtNum(exact.proposed.counts.meanPenalty, 3)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-text-muted">{fmtInt(exact.proposed.counts.applicableCases)} applicable of {fmtInt(exact.proposed.counts.populationCases)} population cases · {fmtInt(exact.proposed.counts.unknownCases)} unevaluated{exact.proposed.counts.missingSignalCases == null ? "" : ` · ${fmtInt(exact.proposed.counts.missingSignalCases)} missing native measurements`}. The rule’s missing-data policy can assign penalties even without a native measurement.</p>
        </> : <p className="mt-2 text-sm">Exact preview unavailable. No draft counts are estimated. <button type="button" className="text-accent-text underline" onClick={() => void preview.refetch()}>Retry preview</button></p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs text-text-muted">A target is a proposed business expectation. Observed percentiles do not establish what the target should be.</p><Button disabled={!valid} onClick={() => onCommit({ threshold, width })}>Commit as version…</Button></div>
      <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium">Measurement table</summary><div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left"><caption className="sr-only">Native histogram measurements</caption><thead><tr><th scope="col">From ({unit})</th><th scope="col">To ({unit})</th><th scope="col">Cases</th></tr></thead><tbody>{bins.map((bin, index) => <tr key={index}><td>{number(bin.x0)}</td><td>{number(bin.x1)}</td><td>{fmtInt(bin.n)}</td></tr>)}</tbody></table></div></details>
    </div>
  </section>;
}
