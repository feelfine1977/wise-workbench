import { useEffect, useMemo, useRef } from "react";
import type { BacklogRow, Kind } from "@wise/api-schema";
import { EChart, type EChartHandle } from "@/components/charts/EChart";
import { chartTokens, type EChartsOption } from "@/components/charts/echarts";
import { useVocabulary } from "@/components/Term";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { sliceLabel } from "@/lib/utils";
import { kindOf } from "@/lib/vocabulary";

const symbols: Record<Kind, string> = { acute: "triangle", systematic: "diamond", widespread: "circle" };

/** Cases × shortfall scatter with cautious-bound whiskers; size ∝ priority, colour and shape by kind of problem. */
export function VolumeGapScatter({ rows, activeKey, onSelect, height = 300 }: { rows: BacklogRow[]; activeKey?: string; onSelect: (key: string) => void; height?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { t } = useVocabulary();
  const ref = useRef<EChartHandle>(null);
  const maxPI = Math.max(1, ...rows.map((r) => r.stable_PI));
  const kindColor = (k: Kind | undefined) => (k ? tk.kind[k] : tk.muted);

  const option = useMemo<EChartsOption>(() => {
    const data = rows.map((r) => [r.n_cases, r.gap, r.stable_PI, sliceLabel(r), kindOf(r) ?? "", r.PI_lower !== undefined && r.PI_lower !== null ? r.PI_lower / Math.max(1, r.n_cases) : r.gap, r.key]);
    return {
      animation: false,
      grid: { left: 60, right: 16, top: 24, bottom: 40 },
      legend: { show: false },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const d = (p as { data: (number | string)[] }).data;
          return `<strong>${String(d[3])}</strong><br/>${fmtInt(d[0])} ${t("n_cases")} · ${t("gap")} ${fmtPct(d[1] as number, 1)}<br/>${t("stable_PI")} ${fmtNum(d[2], 1)} · ${d[4] ? String(d[4]) : "no kind yet"}<br/>${t("PI_lower")} per case ${fmtPct(d[5] as number, 1)}`;
        },
      },
      xAxis: { type: "log", name: `${t("n_cases")} (log)`, nameLocation: "middle", nameGap: 26, min: 10 },
      yAxis: { type: "value", name: t("gap"), min: 0, axisLabel: { formatter: (v: number) => fmtPct(v) } },
      series: [
        {
          name: "whiskers",
          type: "custom",
          silent: true,
          data,
          renderItem: (_p: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
            const x = api.value(0);
            const top = api.coord([x, api.value(1)]);
            const bottom = api.coord([x, api.value(5)]);
            return { type: "line", shape: { x1: top[0], y1: top[1], x2: bottom[0], y2: bottom[1] }, style: { stroke: tk.muted, lineWidth: 1, opacity: 0.7 } };
          },
          z: 1,
        },
        {
          name: "groups",
          type: "scatter",
          data,
          symbol: (d: (number | string)[]) => symbols[d[4] as Kind] ?? "circle",
          symbolSize: (d: (number | string)[]) => 6 + 22 * Math.sqrt((d[2] as number) / maxPI),
          itemStyle: {
            color: (p: { data: (number | string)[] }) => kindColor((p.data[4] as Kind) || undefined),
            opacity: 0.85,
            borderColor: tk.surface,
            borderWidth: 1,
          },
          emphasis: { focus: "self", scale: 1.4, itemStyle: { borderColor: tk.accent, borderWidth: 2 } },
          z: 2,
        },
      ],
    };
  }, [rows, tk, maxPI, t]);

  useEffect(() => {
    const chart = ref.current?.instance();
    if (!chart) return;
    chart.dispatchAction({ type: "downplay", seriesIndex: 1 });
    const i = rows.findIndex((r) => r.key === activeKey);
    if (i >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 1, dataIndex: i });
  }, [activeKey, rows, option]);

  return (
    <EChart
      ref={ref}
      option={option}
      height={height}
      ariaLabel={`All ${rows.length} groups at once: cases by shortfall; whiskers show the cautious bound of the shortfall; shape and colour show the kind of problem`}
      onEvents={{ click: (p) => { const d = (p as { data?: (number | string)[] }).data; if (d) onSelect(String(d[6])); } }}
    />
  );
}

/** Concentration curve: cumulative share of priority over rank. */
export function ConcentrationCurve({ rows, height = 300 }: { rows: BacklogRow[]; height?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { t } = useVocabulary();
  const { points, top10 } = useMemo(() => {
    const sorted = [...rows].filter((r) => r.stable_PI > 0).sort((a, b) => b.stable_PI - a.stable_PI);
    const total = sorted.reduce((s, r) => s + r.stable_PI, 0) || 1;
    let cum = 0;
    const pts = sorted.map((r, i) => {
      cum += r.stable_PI / total;
      return [i + 1, cum, sliceLabel(r)];
    });
    return { points: pts, top10: (pts[Math.min(9, pts.length - 1)]?.[1] as number | undefined) ?? 0 };
  }, [rows]);

  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 60, right: 16, top: 24, bottom: 40 },
      tooltip: { trigger: "axis", formatter: (p: unknown) => { const a = (p as { data: (number | string)[] }[])[0]; return a ? `${t("rank")} ${String(a.data[0])} · ${String(a.data[2])}<br/>cumulative ${fmtPct(a.data[1] as number)}` : ""; } },
      xAxis: { type: "value", name: t("rank"), nameLocation: "middle", nameGap: 26, min: 1, max: Math.max(2, points.length) },
      yAxis: { type: "value", name: `share of ${t("stable_PI")}`, min: 0, max: 1, axisLabel: { formatter: (v: number) => fmtPct(v) } },
      series: [
        {
          type: "line",
          data: points,
          showSymbol: false,
          lineStyle: { color: tk.accent, width: 2 },
          areaStyle: { color: tk.accent, opacity: 0.12 },
          markLine: { symbol: "none", lineStyle: { color: tk.reference, type: "dashed" }, label: { formatter: () => `top 10 = ${fmtPct(top10)}`, position: "insideEndTop" }, data: [{ xAxis: Math.min(10, Math.max(1, points.length)) }] },
        },
      ],
    }),
    [points, tk, top10, t],
  );

  return <EChart option={option} height={height} ariaLabel={`Concentration curve: the top 10 groups carry ${fmtPct(top10)} of the priority`} />;
}
