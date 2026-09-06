import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { lensStats, type Direction } from "./lens";

export interface DistributionLensProps {
  distribution: Distribution;
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
}

/**
 * Distribution lens (UX-6): histogram + ECDF of a raw signal with draggable ϑ (threshold) and W (width).
 * The violation share updates live; the number inputs give the same manipulation to the keyboard.
 */
export function DistributionLens({ distribution, title, constraintId, direction = "high", threshold, width, onChange, onCommit, className, height = 280 }: DistributionLensProps) {
  const [inner, setInner] = useState({ threshold: distribution.threshold ?? 0, width: distribution.width ?? 1 });
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
  const dirty = t !== (distribution.threshold ?? 0) || w !== (distribution.width ?? 1);

  const theme = resolveTheme(useUiStore((s) => s.theme));
  const tk = chartTokens[theme];
  const chartRef = useRef<EChartHandle>(null);
  const [instance, setInstance] = useState<ECharts>();

  const option = useMemo<EChartsOption>(() => {
    const maxN = Math.max(1, ...bins.map((b) => b.n ?? 0));
    const lo = direction === "high" ? t : t - w;
    const hi = direction === "high" ? t + w : t;
    return {
      animation: false,
      grid: { left: 56, right: 56, top: 28, bottom: 40 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; value: number[]; data: number[] }>;
          const first = arr[0];
          if (!first) return "";
          const x = first.value?.[0] ?? first.data?.[0] ?? 0;
          const lines = [`${fmtNum(x, 2)} ${unit}`];
          for (const p of arr) {
            if (p.seriesName === "cases") lines.push(`cases: ${fmtInt(p.value[3])}`);
            if (p.seriesName === "ECDF") lines.push(`ECDF: ${fmtPct(p.value[1], 1)}`);
          }
          return lines.join("<br/>");
        },
      },
      legend: { top: 0, right: 56, data: ["cases", "ECDF"] },
      xAxis: { type: "value", name: unit, nameLocation: "middle", nameGap: 26, min: xMin, max: xMax },
      yAxis: [
        { type: "value", name: "cases", nameTextStyle: { align: "left" }, max: maxN, splitLine: { show: true } },
        { type: "value", name: "ECDF", min: 0, max: 1, position: "right", splitLine: { show: false }, axisLabel: { formatter: (v: number) => fmtPct(v) } },
      ],
      series: [
        {
          name: "cases",
          type: "custom",
          yAxisIndex: 0,
          data: bins.map((b) => [b.x0 ?? 0, b.n ?? 0, b.x1 ?? 0, b.n ?? 0]),
          encode: { x: [0, 2], y: 1, tooltip: 3 },
          renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; style: () => Record<string, unknown> }) => {
            const x0 = api.value(0);
            const x1 = api.value(2);
            const y = api.value(1);
            const p0 = api.coord([x0, y]);
            const p1 = api.coord([x1, 0]);
            const mid = (x0 + x1) / 2;
            const inBand = direction === "high" ? mid >= t : mid <= t;
            const full = direction === "high" ? mid >= t + w : mid <= t - w;
            const fill = full ? tk.violation[6] : inBand ? tk.violation[3] : tk.score[3];
            return {
              type: "rect",
              shape: { x: (p0[0] ?? 0) + 0.5, y: p0[1] ?? 0, width: Math.max(1, (p1[0] ?? 0) - (p0[0] ?? 0) - 1), height: (p1[1] ?? 0) - (p0[1] ?? 0) },
              style: { fill, opacity: 0.9 },
            };
          },
          markArea: {
            silent: true,
            itemStyle: { color: tk.violation[1], opacity: 0.35 },
            data: [[{ xAxis: lo }, { xAxis: hi }]],
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: tk.reference, type: "dashed", width: 1.5 },
            label: { formatter: (p: { name: string }) => p.name, position: "insideEndTop" },
            data: [
              { xAxis: t, name: `ϑ = ${fmtNum(t, 2)}` },
              { xAxis: direction === "high" ? t + w : t - w, name: `ϑ${direction === "high" ? "+" : "−"}W = ${fmtNum(direction === "high" ? t + w : t - w, 2)}` },
            ],
          },
        },
        {
          name: "ECDF",
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          step: false,
          lineStyle: { width: 2, color: tk.accent },
          itemStyle: { color: tk.accent },
          data: (distribution.ecdf ?? []).map((p) => [p[0] ?? 0, p[1] ?? 0]),
          encode: { x: 0, y: 1 },
        },
      ],
    };
  }, [bins, distribution.ecdf, direction, t, w, unit, xMin, xMax, tk]);

  // Draggable handles: positioned in pixels after render, dragging converts back to data.
  const positionHandles = useCallback(
    (chart: ECharts) => {
      const dom = chart.getDom();
      const h = dom?.clientHeight ?? height;
      const xT = chart.convertToPixel({ xAxisIndex: 0 }, t);
      const xW = chart.convertToPixel({ xAxisIndex: 0 }, direction === "high" ? t + w : t - w);
      if (typeof xT !== "number" || Number.isNaN(xT)) return;
      const handle = (id: string, x: number, label: string, onDragEnd: (px: number) => void) => ({
        id,
        type: "group",
        x: x - 6,
        y: 28,
        draggable: "horizontal",
        cursor: "ew-resize",
        z: 100,
        ondragend: function (this: { x: number }) {
          onDragEnd(this.x + 6);
        },
        children: [
          { type: "rect", shape: { x: 0, y: 0, width: 12, height: h - 68 }, style: { fill: "transparent" } },
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
    [t, w, direction, step, set, tk, height],
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
  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={title ?? `Distribution of ${constraintId ?? "signal"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          <p className="tnum text-xs text-text-muted" aria-live="polite">
            {fmtInt(stats.n)} cases in scope · <strong className="text-text">{fmtPct(stats.shareViolating, 1)}</strong> beyond ϑ · {fmtPct(stats.shareFull, 1)} beyond ϑ{direction === "high" ? "+" : "−"}W · mean violation{" "}
            <strong className="text-text">{fmtNum(stats.meanViolation, 3)}</strong>
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
        </div>
        <div className="flex items-end gap-2">
          <Field label={`ϑ threshold (${unit})`} htmlFor={`${idBase}-t`}>
            <Input id={`${idBase}-t`} type="number" step={step} value={t} className="w-28" onChange={(e) => set({ threshold: Number(e.target.value), width: w })} />
          </Field>
          <Field label={`W width (${unit})`} htmlFor={`${idBase}-w`}>
            <Input id={`${idBase}-w`} type="number" step={step} min={0} value={w} className="w-28" onChange={(e) => set({ threshold: t, width: Number(e.target.value) })} />
          </Field>
          {onCommit && (
            <Button variant={dirty ? "default" : "outline"} disabled={!dirty} onClick={() => onCommit({ threshold: t, width: w })}>
              Commit as version…
            </Button>
          )}
        </div>
      </header>
      <EChart ref={chartRef} option={option} height={height} ariaLabel={`Histogram and ECDF of ${constraintId ?? "the signal"}; threshold ${fmtNum(t, 2)} ${unit}, width ${fmtNum(w, 2)} ${unit}`} onReady={setInstance} notMerge={false} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <span>ϑ</span>
          <input type="range" aria-label="threshold slider" min={xMin} max={xMax} step={step} value={t} onChange={(e) => set({ threshold: Number(e.target.value), width: w })} className="w-40 accent-[var(--color-accent)]" />
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <span>W</span>
          <input type="range" aria-label="width slider" min={0} max={Math.max(step, xMax - xMin)} step={step} value={w} onChange={(e) => set({ threshold: t, width: Number(e.target.value) })} className="w-40 accent-[var(--color-accent)]" />
        </label>
        {distribution.stats && (
          <dl className="tnum ml-auto flex flex-wrap gap-x-3 text-xs text-text-muted">
            {Object.entries(distribution.stats)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => (
                <div key={k} className="flex gap-1">
                  <dt>{k}</dt>
                  <dd className="text-text">{fmtNum(v as number, 2)}</dd>
                </div>
              ))}
          </dl>
        )}
      </div>
      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-2 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">from</th>
              <th scope="col" className="text-left">to</th>
              <th scope="col" className="text-right">cases</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b, i) => (
              <tr key={i}>
                <td>{fmtNum(b.x0, 1)}</td>
                <td>{fmtNum(b.x1, 1)}</td>
                <td className="text-right">{fmtInt(b.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
