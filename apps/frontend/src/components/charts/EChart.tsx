import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { loadECharts, type ECharts, type EChartsOption } from "./echarts";

export interface EChartHandle {
  instance: () => ECharts | undefined;
}

export interface EChartProps {
  option: EChartsOption;
  className?: string;
  height?: number | string;
  /** Accessible name; a table alternative should sit next to the chart. */
  ariaLabel: string;
  onReady?: (chart: ECharts) => void;
  onEvents?: Record<string, (params: unknown, chart: ECharts) => void>;
  notMerge?: boolean;
}

/** ECharts wrapper: lazy-loaded library, token theme, resize observer, aria decals. */
export const EChart = forwardRef<EChartHandle, EChartProps>(function EChart({ option, className, height = 260, ariaLabel, onReady, onEvents, notMerge }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | undefined>(undefined);
  const theme = useUiStore((s) => s.theme);
  const resolved = resolveTheme(theme);
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;

  useImperativeHandle(ref, () => ({ instance: () => chart.current }), []);

  useEffect(() => {
    let disposed = false;
    const node = el.current;
    if (!node) return;
    void loadECharts().then((core) => {
      if (disposed || !el.current) return;
      chart.current?.dispose();
      const inst = core.init(el.current, resolved === "dark" ? "wise-dark" : "wise-light", { renderer: "canvas" });
      chart.current = inst;
      inst.setOption({ aria: { enabled: true, label: { enabled: false }, decal: { show: true } }, ...option }, { notMerge: true });
      for (const [name, handler] of Object.entries(eventsRef.current ?? {})) {
        inst.on(name, (params: unknown) => handler(params, inst));
      }
      onReady?.(inst);
    });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => chart.current?.resize()) : undefined;
    ro?.observe(node);
    return () => {
      disposed = true;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = undefined;
    };
    // The chart is re-created only when the theme changes; options update in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  useEffect(() => {
    chart.current?.setOption({ aria: { enabled: true, label: { enabled: false }, decal: { show: true } }, ...option }, { notMerge: notMerge ?? false });
  }, [option, notMerge]);

  return <div ref={el} role="img" aria-label={ariaLabel} className={cn("w-full", className)} style={{ height }} />;
});
