import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BacklogRow, Kind } from "@wise/api-schema";
import { EChart, type EChartHandle } from "@/components/charts/EChart";
import { ChartTable } from "@/components/charts/ChartTable";
import { escapeChartText, readableTooltip } from "@/components/charts/readability";
import { chartTokens, type ECharts, type EChartsOption } from "@/components/charts/echarts";
import { useVocabulary } from "@/components/Term";
import { fmtCompact, fmtInt, fmtNum, fmtPct } from "@/lib/format";
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

  const option = useMemo<EChartsOption>(() => {
    const kindColor = (k: Kind | undefined) => (k ? tk.kind[k] : tk.muted);
    const data = rows.map((r) => [r.n_cases, r.gap, r.stable_PI, sliceLabel(r), kindOf(r) ?? "", r.PI_lower !== undefined && r.PI_lower !== null ? r.PI_lower / Math.max(1, r.n_cases) : r.gap, r.key]);
    return {
      animation: false,
      grid: { left: 12, right: 32, top: 20, bottom: 56, containLabel: true },
      legend: { show: false },
      tooltip: {
        ...readableTooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const d = (p as { data: (number | string)[] }).data;
          return `<strong>${escapeChartText(d[3])}</strong><br/>${fmtInt(d[0])} ${t("n_cases")} · ${t("gap")} ${fmtNum((d[1] as number) * 100, 1)} score points<br/>${t("stable_PI")} ${fmtNum(d[2], 1)} · ${d[4] ? escapeChartText(d[4]) : "no kind yet"}<br/>${t("PI_lower")} per case ${fmtNum((d[5] as number) * 100, 1)} score points`;
        },
      },
      xAxis: { type: "log", name: `${t("n_cases")} (log scale)`, nameLocation: "middle", nameGap: 34, nameTextStyle: { fontSize: 13 }, min: Math.min(10, ...rows.map((r) => r.n_cases).filter((n) => n > 0)), axisLabel: { fontSize: 13, hideOverlap: true, formatter: (v: number) => fmtCompact(v) } },
      yAxis: { type: "value", min: 0, axisLabel: { fontSize: 13, formatter: (v: number) => fmtNum(v * 100, 1) } },
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

  const highlightSelection = useCallback((chart: ECharts) => {
    chart.dispatchAction({ type: "downplay", seriesIndex: 1 });
    const i = rows.findIndex((r) => r.key === activeKey);
    if (i >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 1, dataIndex: i });
  }, [activeKey, rows]);

  useEffect(() => {
    const chart = ref.current?.instance();
    if (chart) highlightSelection(chart);
  }, [highlightSelection, option]);

  return (
    <div className="min-w-0">
      <p className="mt-2 text-sm text-text-muted">{t("gap")} (score points)</p>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-text-muted" aria-label="Problem kind key">
        <li><span style={{ color: tk.kind.acute }} aria-hidden>▲ </span>Acute · few cases, far off</li>
        <li><span style={{ color: tk.kind.systematic }} aria-hidden>◆ </span>Systematic · concentrated pattern</li>
        <li><span style={{ color: tk.kind.widespread }} aria-hidden>● </span>Widespread · many cases, smaller gaps</li>
        <li><span style={{ color: tk.muted }} aria-hidden>● </span>Unknown / unclassified</li>
      </ul>
      <p className="mt-1 text-xs text-text-muted">Kinds describe assessed patterns, not proven causes. Symbol size represents priority; confidence in rank is separate.</p>
      <EChart
        ref={ref}
        option={option}
        height={Math.max(340, height)}
        ariaLabel={`All ${rows.length} groups at once: cases by shortfall in score points; whiskers show the cautious bound of the shortfall; shape and colour show the kind of problem`}
        onReady={highlightSelection}
        onEvents={{ click: (p) => { const d = (p as { data?: (number | string)[] }).data; if (d) onSelect(String(d[6])); } }}
      />
      <ChartTable label="Cases and shortfall by group">
        <thead>
          <tr>
            <th scope="col" className="text-left">group</th>
            <th scope="col" className="text-right">{t("n_cases")}</th>
            <th scope="col" className="text-right">{t("gap")} (score points)</th>
            <th scope="col" className="text-right">{t("stable_PI")}</th>
            <th scope="col" className="text-right">{t("PI_lower")} per case (score points)</th>
            <th scope="col" className="text-left">kind</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="text-left font-normal">
                <button type="button" className="text-left text-accent underline underline-offset-2" aria-pressed={r.key === activeKey} onClick={() => onSelect(r.key)}>{sliceLabel(r)}</button>
              </th>
              <td className="text-right">{fmtInt(r.n_cases)}</td>
              <td className="text-right">{fmtNum(r.gap * 100, 1)}</td>
              <td className="text-right">{fmtNum(r.stable_PI, 1)}</td>
              <td className="text-right">{fmtNum((r.PI_lower != null ? r.PI_lower / Math.max(1, r.n_cases) : r.gap) * 100, 1)}</td>
              <td>{kindOf(r) ?? "no kind yet"}</td>
            </tr>
          ))}
        </tbody>
      </ChartTable>
    </div>
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

  const topCount = Math.min(10, points.length);
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 12, right: 32, top: 20, bottom: 56, containLabel: true },
      tooltip: { ...readableTooltip, trigger: "axis", formatter: (p: unknown) => { const a = (p as { data: (number | string)[] }[])[0]; return a ? `${t("rank")} ${String(a.data[0])} · ${escapeChartText(a.data[2])}<br/>cumulative ${fmtPct(a.data[1] as number)}` : ""; } },
      xAxis: { type: "value", name: t("rank"), nameLocation: "middle", nameGap: 34, nameTextStyle: { fontSize: 13 }, min: 1, max: Math.max(2, points.length), minInterval: 1, axisLabel: { fontSize: 13, hideOverlap: true } },
      yAxis: { type: "value", min: 0, max: 1, axisLabel: { fontSize: 13, formatter: (v: number) => fmtPct(v) } },
      series: [
        {
          type: "line",
          data: points,
          showSymbol: false,
          lineStyle: { color: tk.accent, width: 2 },
          areaStyle: { color: tk.accent, opacity: 0.12 },
          markLine: { symbol: "none", lineStyle: { color: tk.reference, type: "dashed" }, label: { show: false }, data: [{ xAxis: Math.min(10, Math.max(1, points.length)) }] },
        },
      ],
    }),
    [points, tk, t],
  );

  return (
    <div className="min-w-0">
      <p className="mt-2 text-sm text-text-muted">Share of {t("stable_PI")} (%). {points.length ? `Top ${topCount} ${topCount === 1 ? "group" : "groups"}: ${fmtPct(top10)}.` : "No groups with positive priority."}</p>
      <EChart option={option} height={Math.max(340, height)} ariaLabel={`Concentration curve: the top ${topCount} groups carry ${fmtPct(top10)} of the priority`} />
      <ChartTable label="Cumulative priority by group rank">
        <thead>
          <tr>
            <th scope="col" className="text-right">{t("rank")}</th>
            <th scope="col" className="text-left">group</th>
            <th scope="col" className="text-right">cumulative share of {t("stable_PI")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point[0]}>
              <td className="text-right">{point[0]}</td>
              <th scope="row" className="text-left font-normal">{point[2]}</th>
              <td className="text-right">{fmtPct(point[1] as number, 1)}</td>
            </tr>
          ))}
        </tbody>
      </ChartTable>
    </div>
  );
}
