import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Distribution } from "@wise/api-schema";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { EChart, type EChartHandle } from "./charts/EChart";
import { chartTokens, type ECharts, type EChartsOption } from "./charts/echarts";
import { Explain } from "./explain";
import { ecdfAt, lensStats, type Direction } from "./lens";

export interface DistributionLensProps {
  distribution: Distribution;
  /** The same expectation over the whole log; "everyone else" is drawn behind the group as the whole minus the group. */
  rest?: Distribution;
  title?: string;
  constraintId?: string;
  direction?: Direction;
  threshold?: number;
  width?: number;
  onChange?: (next: { threshold: number; width: number }) => void;
  /** Called when the analyst commits the manipulated threshold; a note is asked upstream. */
  onCommit?: (next: { threshold: number; width: number }) => void;
  className?: string;
  height?: number;
  /** Plain words (the reason screen) or the method's notation (the norm's calibration lens, the words switch). */
  mode?: "plain" | "method";
  /** Where the ϑ / W controls live: always (the calibration lens), behind "Try another threshold" in method mode, or never. */
  sliders?: "always" | "method" | "never";
  /** The sentences above the chart (the real-unit comparison); a default is computed from the distribution. */
  sentences?: ReactNode;
  /** The name of the group for the legend ("Packaging"). */
  groupName?: string;
  /** The x-axis in words with its unit ("days from invoice receipt to clearing"). */
  unitLabel?: string;
}

const UNIT_WORD: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds" };
const STAT_LABEL: Record<string, string> = {
  n: "cases with a value",
  nCases: "cases in scope",
  mean: "mean",
  median: "median",
  p90: "90th percentile",
  p95: "95th percentile",
  min: "minimum",
  max: "maximum",
  shareViolated: "share beyond the expectation",
  shareBeyondSaturation: "share beyond the tolerance",
};
const STAT_ORDER = ["n", "nCases", "mean", "median", "p90", "p95", "min", "max", "shareViolated", "shareBeyondSaturation"];

const total = (d: Distribution) => {
  const n = d.stats?.n;
  if (typeof n === "number" && n > 0) return n;
  return (d.bins ?? []).reduce((s, b) => s + (b.n ?? 0), 0) + (d.beyond?.n ?? 0) + (d.below?.n ?? 0);
};

/**
 * The distribution lens: the group ("here", accent) and everyone else (grey, behind) as shares of cases on
 * shared bin edges, the expectation line and the tolerance band always drawn, the share beyond the
 * expectation as a sentence above the chart. The ϑ / W controls exist only where a threshold is set (the
 * calibration lens) or, in the method's words, under "Try another threshold"; the cumulative curve is a
 * toggle; the statistics sit behind "more" with plain labels.
 */
export function DistributionLens({ distribution, rest, title, constraintId, direction = "high", threshold, width, onChange, onCommit, className, height = 300, mode = "method", sliders = "always", sentences, groupName = "this group", unitLabel }: DistributionLensProps) {
  const [inner, setInner] = useState({ threshold: distribution.threshold ?? 0, width: distribution.width ?? 1 });
  const [cumulative, setCumulative] = useState(false);
  const t = threshold ?? inner.threshold;
  const w = width ?? inner.width;
  const set = useCallback(
    (next: { threshold: number; width: number }) => {
      const clean = { threshold: Number.isFinite(next.threshold) ? next.threshold : 0, width: Math.max(Number.isFinite(next.width) ? next.width : 0, 0) };
      setInner(clean);
      onChange?.(clean);
    },
    [onChange],
  );
  const plain = mode === "plain";
  const showSliders = sliders === "always" || (sliders === "method" && !plain);

  const stats = useMemo(() => lensStats(distribution, t, w, direction), [distribution, t, w, direction]);
  const bins = useMemo(() => distribution.bins ?? [], [distribution.bins]);
  const xMin = bins.length ? (bins[0]?.x0 ?? 0) : 0;
  const xMax = bins.length ? (bins[bins.length - 1]?.x1 ?? 1) : 1;
  const step = useMemo(() => {
    const span = xMax - xMin;
    if (span <= 0) return 1;
    const raw = span / 100;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return Math.max(mag, 0.001);
  }, [xMin, xMax]);
  const unit = distribution.unit ?? "";
  // the answer's unit is the column it was measured on (`manual_share`); the axis, the band and the sentences
  // say it in words, never as a field name
  const unitWord = UNIT_WORD[unit] ?? unit.replace(/[_-]+/g, " ").trim();
  const dirty = t !== (distribution.threshold ?? 0) || w !== (distribution.width ?? 1);
  const nGroup = total(distribution);
  const nAll = rest ? total(rest) : 0;
  const nRest = Math.max(0, nAll - nGroup);

  // everyone else on the group's bin edges: the whole log's mass in a bin (from its ECDF) minus the group's, as a share of the rest
  const restShares = useMemo(() => {
    if (!rest || nRest <= 0) return undefined;
    return bins.map((b) => {
      const all = nAll * (ecdfAt(rest.ecdf, b.x1 ?? 0) - ecdfAt(rest.ecdf, b.x0 ?? 0));
      const mass = Math.max(0, all - (b.n ?? 0));
      return mass / nRest;
    });
  }, [rest, bins, nAll, nRest]);
  const restBeyond = useMemo(() => {
    if (!rest || nRest <= 0) return undefined;
    const allBeyond = direction === "high" ? 1 - ecdfAt(rest.ecdf, t) : ecdfAt(rest.ecdf, t);
    return Math.max(0, Math.min(1, (nAll * allBeyond - nGroup * stats.shareViolating) / nRest));
  }, [rest, nRest, nAll, nGroup, direction, t, stats.shareViolating]);

  const theme = resolveTheme(useUiStore((s) => s.theme));
  const tk = chartTokens[theme];
  const chartRef = useRef<EChartHandle>(null);
  const [instance, setInstance] = useState<ECharts>();

  const option = useMemo<EChartsOption>(() => {
    // a share of cases is between nothing and everything: the axis never runs past 100 %
    const share = (v: number) => Math.max(0, Math.min(1, v));
    const groupShares = bins.map((b) => share(nGroup > 0 ? (b.n ?? 0) / nGroup : 0));
    const restBars = restShares?.map(share);
    const maxShare = Math.min(1, Math.max(0.0001, ...groupShares, ...(restBars ?? [])));
    const lo = direction === "high" ? t : t - w;
    const hi = direction === "high" ? t + w : t;
    const bar = (name: string, shares: number[], color: string, opacity: number, z: number) => ({
      name,
      type: "custom" as const,
      yAxisIndex: 0,
      z,
      data: bins.map((b, i) => [b.x0 ?? 0, shares[i] ?? 0, b.x1 ?? 0, b.n ?? 0]),
      encode: { x: [0, 2], y: 1, tooltip: [1, 3] },
      renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
        const x0 = api.value(0);
        const x1 = api.value(2);
        const y = api.value(1);
        const p0 = api.coord([x0, y]);
        const p1 = api.coord([x1, 0]);
        return {
          type: "rect",
          shape: { x: (p0[0] ?? 0) + 0.5, y: p0[1] ?? 0, width: Math.max(1, (p1[0] ?? 0) - (p0[0] ?? 0) - 1), height: (p1[1] ?? 0) - (p0[1] ?? 0) },
          style: { fill: color, opacity },
        };
      },
    });
    const series: Record<string, unknown>[] = [];
    if (restBars) series.push(bar("everyone else", restBars, tk.muted, 0.6, 1));
    series.push({
      ...bar(groupName, groupShares, tk.accent, restShares ? 0.85 : 0.9, 2),
      markArea: { silent: true, itemStyle: { color: tk.violation[1], opacity: 0.3 }, label: { show: true, position: "insideTop", color: tk.muted, fontSize: 11, formatter: plain ? `tolerance to ${fmtNum(hi, 0)} ${unitWord}` : `ϑ … ϑ${direction === "high" ? "+" : "−"}W` }, data: [[{ xAxis: lo }, { xAxis: hi }]] },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: tk.reference, type: "dashed", width: 1.5 },
        label: { formatter: (p: { name: string }) => p.name, position: "insideEndTop", fontSize: 11 },
        data: [{ xAxis: t, name: plain ? `expected ${direction === "high" ? "≤" : "≥"} ${fmtNum(t, t >= 10 ? 0 : 1)} ${unitWord}` : `ϑ = ${fmtNum(t, 2)}` }],
      },
    });
    if (cumulative) {
      series.push({ name: "cumulative", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { width: 1.5, color: tk.reference }, itemStyle: { color: tk.reference }, data: (distribution.ecdf ?? []).map((p) => [p[0] ?? 0, p[1] ?? 0]), encode: { x: 0, y: 1 } });
    }
    return {
      animation: false,
      grid: { left: 60, right: cumulative ? 56 : 24, top: 36, bottom: 44 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; value: number[] }>;
          const first = arr[0];
          if (!first) return "";
          const x = first.value?.[0] ?? 0;
          const lines = [`${fmtNum(x, x >= 10 ? 0 : 1)} ${unitWord}`];
          for (const p of arr) {
            if (p.seriesName === "cumulative") lines.push(`cumulative: ${fmtPct(p.value[1], 0)}`);
            else lines.push(`${p.seriesName}: ${fmtPct(p.value[1], 1)} of cases${p.seriesName === groupName ? ` (${fmtInt(p.value[3])})` : ""}`);
          }
          return lines.join("<br/>");
        },
      },
      legend: { top: 0, right: 8, data: [...(restShares ? ["everyone else"] : []), groupName, ...(cumulative ? ["cumulative"] : [])] },
      xAxis: { type: "value", name: unitLabel ?? unitWord, nameLocation: "middle", nameGap: 28, min: xMin, max: xMax },
      yAxis: [
        { type: "value", name: "share of cases", nameTextStyle: { align: "left" }, max: maxShare, splitLine: { show: true }, axisLabel: { formatter: (v: number) => fmtPct(v, v < 0.01 ? 1 : 0) } },
        ...(cumulative ? [{ type: "value" as const, name: "cumulative", min: 0, max: 1, position: "right" as const, splitLine: { show: false }, axisLabel: { formatter: (v: number) => fmtPct(v) } }] : []),
      ],
      series,
    };
  }, [bins, restShares, distribution.ecdf, direction, t, w, unitWord, unitLabel, xMin, xMax, tk, nGroup, groupName, plain, cumulative]);

  // Draggable handles: positioned in pixels after render, dragging converts back to data.
  const positionHandles = useCallback(
    (chart: ECharts) => {
      if (!showSliders) {
        chart.setOption({ graphic: [] }, { replaceMerge: ["graphic"] });
        return;
      }
      const dom = chart.getDom();
      const h = dom?.clientHeight ?? height;
      const xT = chart.convertToPixel({ xAxisIndex: 0 }, t);
      const xW = chart.convertToPixel({ xAxisIndex: 0 }, direction === "high" ? t + w : t - w);
      if (typeof xT !== "number" || Number.isNaN(xT)) return;
      const handle = (id: string, x: number, label: string, onDragEnd: (px: number) => void) => ({
        id,
        type: "group",
        x: x - 6,
        y: 36,
        draggable: "horizontal",
        cursor: "ew-resize",
        z: 100,
        ondragend: function (this: { x: number }) {
          onDragEnd(this.x + 6);
        },
        children: [
          { type: "rect", shape: { x: 0, y: 0, width: 12, height: h - 80 }, style: { fill: "transparent" } },
          { type: "rect", shape: { x: 3, y: 0, width: 6, height: 14, r: 2 }, style: { fill: tk.reference } },
          { type: "text", x: 6, y: -12, style: { text: label, fill: tk.muted, fontSize: 10, textAlign: "center" } },
        ],
      });
      chart.setOption(
        {
          graphic: [
            handle("handle-threshold", xT, "ϑ", (px) => {
              const v = chart.convertFromPixel({ xAxisIndex: 0 }, px) as number;
              set({ threshold: Math.round(v / step) * step, width: w });
            }),
            handle("handle-width", xW, "W", (px) => {
              const v = chart.convertFromPixel({ xAxisIndex: 0 }, px) as number;
              const nw = direction === "high" ? v - t : t - v;
              set({ threshold: t, width: Math.max(0, Math.round(nw / step) * step) });
            }),
          ],
        },
        { replaceMerge: ["graphic"] },
      );
    },
    [t, w, direction, step, set, tk, height, showSliders],
  );

  useEffect(() => {
    if (!instance) return;
    const raf = requestAnimationFrame(() => positionHandles(instance));
    const onResize = () => positionHandles(instance);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [instance, positionHandles, option]);

  const idBase = `lens-${constraintId ?? "signal"}`;
  const statEntries = Object.entries(distribution.stats ?? {})
    .filter(([k, v]) => typeof v === "number" && (!plain || k in STAT_LABEL))
    .sort(([a], [b]) => (STAT_ORDER.indexOf(a) + 1 || 99) - (STAT_ORDER.indexOf(b) + 1 || 99));
  const fmtStat = (k: string, v: number) => (/^share|^meanViolation|^ecdf/.test(k) ? fmtPct(v, 1) : k === "n" || k === "nCases" ? fmtInt(v) : `${fmtNum(v, v >= 10 ? 0 : 1)} ${unitWord}`);
  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={`ϑ threshold (${unit})`} htmlFor={`${idBase}-t`}>
        <Input id={`${idBase}-t`} type="number" step={step} value={t} className="w-28" onChange={(e) => set({ threshold: Number(e.target.value), width: w })} />
      </Field>
      <Field label={`W width (${unit})`} htmlFor={`${idBase}-w`}>
        <Input id={`${idBase}-w`} type="number" step={step} min={0} value={w} className="w-28" onChange={(e) => set({ threshold: t, width: Number(e.target.value) })} />
      </Field>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <span>ϑ</span>
        <input type="range" aria-label="threshold slider" min={xMin} max={xMax} step={step} value={t} onChange={(e) => set({ threshold: Number(e.target.value), width: w })} className="w-40 accent-[var(--color-accent)]" />
      </label>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <span>W</span>
        <input type="range" aria-label="width slider" min={0} max={Math.max(step, xMax - xMin)} step={step} value={w} onChange={(e) => set({ threshold: t, width: Number(e.target.value) })} className="w-40 accent-[var(--color-accent)]" />
      </label>
      {dirty && <span className="text-xs text-warning">exploring: not saved</span>}
      {onCommit && (
        <Button variant={dirty ? "default" : "outline"} disabled={!dirty} onClick={() => onCommit({ threshold: t, width: w })}>
          Commit as version…
        </Button>
      )}
    </div>
  );

  // a group without a single value is not a 100 % share of nothing (R2-05): it says so and draws no bars
  if (total(distribution) === 0) {
    return (
      <section className={cn("flex flex-col gap-2", className)} aria-label={title ?? `Distribution of ${constraintId ?? "signal"}`} data-testid="lens-empty">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <p className="reading text-sm text-text-muted">
          No case of {groupName} has a value for this expectation, so there is nothing to draw — not a share of 100 %. The expectation may not apply here, or the events it measures are missing.
        </p>
      </section>
    );
  }

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={title ?? `Distribution of ${constraintId ?? "signal"}`}>
      <header className="flex flex-col gap-1">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        {plain ? (
          <div className="reading flex flex-col gap-0.5 text-base text-text" data-testid="lens-sentences">
            {sentences ?? (
              <p aria-live="polite">
                <strong className="tnum">{fmtPct(stats.shareViolating, 0)}</strong> of {groupName} are beyond the expected {fmtNum(t, t >= 10 ? 0 : 1)} {unitWord}
                {restBeyond !== undefined ? ` (everyone else: ${fmtPct(restBeyond, 0)})` : ""}.
              </p>
            )}
          </div>
        ) : (
          <p className="tnum text-xs text-text-muted" aria-live="polite">
            {fmtInt(stats.n)} cases in scope · <strong className="text-text">{fmtPct(stats.shareViolating, 1)}</strong> beyond ϑ · {fmtPct(stats.shareFull, 1)} beyond ϑ{direction === "high" ? "+" : "−"}W · mean violation{" "}
            <strong className="text-text">{fmtNum(stats.meanViolation, 3)}</strong>
            {restBeyond !== undefined ? ` · everyone else ${fmtPct(restBeyond, 1)} beyond ϑ` : ""}
            <Explain
              term="constraint"
              title="Violation under a soft threshold"
              formula={`ν(x) = clip((x − ϑ) / W, 0, 1)   (direction ${direction})\nshare beyond ϑ = 1 − ECDF(ϑ)\nmean violation = Σ n_bin · ν(mid_bin) / n`}
              inputs={[
                { label: "ϑ", value: `${fmtNum(t, 2)} ${unit}` },
                { label: "W", value: `${fmtNum(w, 2)} ${unit}` },
                { label: "ECDF(ϑ)", value: fmtPct(stats.cdfAtThreshold, 1) },
              ]}
              caveats={["Bins approximate the mean violation; the ECDF gives the shares exactly.", "Committing a change creates a norm version with a note."]}
              className="ml-1 align-middle"
            />
          </p>
        )}
      </header>
      {sliders === "always" && controls}
      <EChart ref={chartRef} option={option} height={height} ariaLabel={`Distribution of ${constraintId ?? "the signal"} for ${groupName}${restShares ? " and everyone else" : ""}; expected ${fmtNum(t, 2)} ${unit}, tolerance ${fmtNum(w, 2)} ${unit}`} onReady={setInstance} notMerge={false} />
      <p className="text-xs text-text-subtle">
        {groupName} against everyone else{restShares ? "" : " (the whole log)"}, {fmtInt(stats.n)} cases with a value
        {distribution.beyond?.share ? `; ${fmtPct(distribution.beyond.share, distribution.beyond.share < 0.01 ? 1 : 0)} of cases beyond ${fmtNum(xMax, 0)} ${unitWord} are not drawn` : ""}.
      </p>
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} />
          show cumulative
        </label>
        {sliders === "method" && !plain && (
          <details className="basis-full">
            <summary className="cursor-pointer">Try another threshold</summary>
            <div className="mt-2">{controls}</div>
          </details>
        )}
        {statEntries.length > 0 && (
          <details className="basis-full" data-testid="lens-stats">
            <summary className="cursor-pointer">more ▾</summary>
            <dl className="tnum mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 sm:grid-cols-[auto_1fr_auto_1fr]">
              {statEntries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{plain ? STAT_LABEL[k] : k}</dt>
                  <dd className="text-text">{plain ? fmtStat(k, v as number) : fmtNum(v as number, 2)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        <details className="basis-full">
          <summary className="cursor-pointer">Table alternative</summary>
          <table className="tnum mt-2 w-full text-xs">
            <thead>
              <tr>
                <th scope="col" className="text-left">from</th>
                <th scope="col" className="text-left">to</th>
                <th scope="col" className="text-right">{groupName}</th>
                {restShares && <th scope="col" className="text-right">everyone else</th>}
              </tr>
            </thead>
            <tbody>
              {bins.map((b, i) => (
                <tr key={i}>
                  <td>{fmtNum(b.x0, 1)}</td>
                  <td>{fmtNum(b.x1, 1)}</td>
                  <td className="text-right">{fmtInt(b.n)}</td>
                  {restShares && <td className="text-right">{fmtPct(restShares[i] ?? 0, 1)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
