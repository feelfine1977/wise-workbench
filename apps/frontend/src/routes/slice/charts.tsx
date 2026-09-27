import { useMemo } from "react";
import type { Table } from "@wise/api-schema";
import { EChart } from "@/components/charts/EChart";
import { ChartTable } from "@/components/charts/ChartTable";
import { escapeChartText, horizontalCategoryLayout, readableTooltip } from "@/components/charts/readability";
import { chartTokens, type EChartsOption } from "@/components/charts/echarts";
import { layerColor } from "@/components/badges";
import { useVocabulary } from "@/components/Term";
import { fmtNum, fmtPct } from "@/lib/format";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { tableRecords } from "@/lib/utils";

type Driver = { constraint: string; layer: string; type: string; delta_gap: number; mean_penalty: number; share_violated: number; share_in_scope: number; description?: string };
type Layer = { layer: string; slice_mean: number; global_mean: number; delta: number };
type Mass = { key: string; n_cases: number; penalty_mass: number; mean_penalty: number; share: number; cum_share: number; rank: number };

/** The waterfall of the shortfall by expectation: every bar is the share of the shortfall an expectation explains, in whole per cent; the bars sum to 100 %. */
export function GapWaterfall({ drivers, gap, onSelect, height = 320, maxBars = 14, plainOf }: { drivers: Table | undefined; gap: number; onSelect?: (constraintId: string) => void; height?: number; maxBars?: number; plainOf?: (constraintId: string) => string }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { t } = useVocabulary();
  const { option, rows, chartHeight } = useMemo(() => {
    const all = tableRecords<Driver>(drivers).filter((d) => Number.isFinite(d.delta_gap));
    const share = (v: number) => (gap > 0 ? v / gap : 0);
    const sorted = [...all].sort((a, b) => Math.abs(b.delta_gap) - Math.abs(a.delta_gap));
    const shown = sorted.slice(0, maxBars);
    const rest = sorted.slice(maxBars).reduce((s, d) => s + d.delta_gap, 0);
    const items = [...shown.map((d) => ({ id: d.constraint, name: plainOf?.(d.constraint) ?? d.constraint, v: share(d.delta_gap) })), ...(sorted.length > maxBars ? [{ id: "__other__", name: `other (${sorted.length - maxBars})`, v: share(rest) }] : [])];
    let running = 0;
    const base: number[] = [];
    const pos: number[] = [];
    const neg: number[] = [];
    for (const it of items) {
      if (it.v >= 0) {
        base.push(running);
        pos.push(it.v);
        neg.push(0);
        running += it.v;
      } else {
        running += it.v;
        base.push(running);
        pos.push(0);
        neg.push(-it.v);
      }
    }
    const cats = [...items.map((i) => i.name), "the shortfall"];
    base.push(0);
    pos.push(1);
    neg.push(0);
    const layout = horizontalCategoryLayout(cats, height);
    const opt: EChartsOption = {
      animation: false,
      grid: { ...layout.grid, top: 16 },
      tooltip: { ...readableTooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: unknown) => { const arr = p as { axisValue: string; dataIndex: number }[]; const a = arr[0]; if (!a) return ""; const i = a.dataIndex; const v = i < items.length ? items[i]!.v : 1; return `<strong>${escapeChartText(a.axisValue)}</strong><br/>${fmtPct(v, 0)} of the shortfall`; } },
      yAxis: layout.yAxis,
      xAxis: { type: "value", name: "share of the shortfall (%)", nameLocation: "middle", nameGap: 32, splitNumber: 3, axisLabel: { fontSize: 13, formatter: (v: number) => fmtPct(v, 0) }, minInterval: 0.05 },
      series: [
        { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, silent: true, tooltip: { show: false } },
        { type: "bar", stack: "w", name: "adds to the shortfall", data: pos.map((v, i) => ({ value: v, itemStyle: i === cats.length - 1 ? { color: tk.reference } : { color: tk.accent } })) },
        { type: "bar", stack: "w", name: "met better than everyone else here", data: neg, itemStyle: { color: tk.muted, opacity: 0.6 } },
      ],
    };
    return { option: opt, rows: items, chartHeight: layout.height };
  }, [drivers, gap, tk, maxBars, plainOf, height]);

  return (
    <div>
      <div className="overflow-x-auto">
        <EChart className="min-w-[360px]" option={option} height={chartHeight} ariaLabel={`Waterfall of each expectation's share of the shortfall; total shortfall ${fmtNum(gap * 100, 2)} score points`} onEvents={{ click: (p) => { const row = rows[(p as { dataIndex: number }).dataIndex]; if (row && onSelect && row.id !== "__other__") onSelect(row.id); } }} />
      </div>
      <ChartTable label="Expectation shares of the shortfall">
          <thead>
            <tr>
              <th scope="col" className="text-left">expectation</th>
              <th scope="col" className="text-right">share of the shortfall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="text-left font-normal" title={r.id}>
                  {onSelect && r.id !== "__other__" ? <button type="button" className="text-left text-accent underline underline-offset-2" onClick={() => onSelect(r.id)}>{r.name}</button> : r.name}
                </th>
                <td className="text-right">{fmtPct(r.v, 0)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <th scope="row" className="text-left">the shortfall</th>
              <td className="text-right">{fmtPct(1, 0)}</td>
            </tr>
          </tbody>
      </ChartTable>
      <p className="mt-1 text-xs text-text-subtle">The shortfall is {fmtNum(gap * 100, 2)} score points. Shares can add to more than 100 % because other expectations are met better than average here{t("gap") === "gap" ? " (Δ gap per constraint over the gap)" : ""}.</p>
    </div>
  );
}

/** The expectation areas as pairs of thin bars: the score lost per case here (accent) over everyone (grey), on the same scale, the value at the right end. */
export function LayerBars({ layers, layerNames = {} }: { layers: Table | undefined; layerNames?: Record<string, string>; height?: number }) {
  const rows = useMemo(() => [...tableRecords<Layer>(layers)].sort((a, b) => b.slice_mean - a.slice_mean), [layers]);
  const max = Math.max(0.0001, ...rows.map((r) => Math.max(r.slice_mean, r.global_mean)));
  const name = (id: string) => layerNames[id] ?? id;
  return (
    <div>
      <ul className="flex flex-col gap-2" aria-label="Score lost per case by expectation area">
        {rows.map((r) => {
          const applies = Number.isFinite(r.slice_mean) && Number.isFinite(r.global_mean);
          return (
            <li key={r.layer} className="grid min-w-0 grid-cols-1 items-center gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
              <span className="flex min-w-0 items-start gap-1.5" title={r.layer}>
                <span aria-hidden className="layer-swatch mt-1 shrink-0" style={{ background: layerColor(r.layer) }} />
                <span className="break-words [overflow-wrap:anywhere]">{name(r.layer)}</span>
              </span>
              {applies ? (
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="w-8">here</span>
                    <span role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={r.slice_mean} aria-label={`${name(r.layer)}: ${fmtPct(r.slice_mean, 1)} of the score lost per case here`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (r.slice_mean / max) * 100)}%` }} />
                    </span>
                    <span className="tnum w-12 text-right text-text">{fmtPct(r.slice_mean, 1)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="w-8">all</span>
                    <span role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={r.global_mean} aria-label={`${name(r.layer)}: ${fmtPct(r.global_mean, 1)} of the score lost per case everywhere`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-text-subtle opacity-60" style={{ width: `${Math.max(1, (r.global_mean / max) * 100)}%` }} />
                    </span>
                    <span className="tnum w-12 text-right">{fmtPct(r.global_mean, 1)}</span>
                  </span>
                </span>
              ) : (
                <span className="text-xs text-text-subtle">does not apply here</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-text-subtle">share of the score lost per case: this group (accent) over everyone (grey), same scale</p>
      <ChartTable label="Score lost per case by expectation area">
          <thead>
            <tr>
              <th scope="col" className="text-left">expectation area</th>
              <th scope="col" className="text-right">this group</th>
              <th scope="col" className="text-right">everyone</th>
              <th scope="col" className="text-right">difference (score points)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.layer}>
                <th scope="row" className="text-left font-normal">{name(r.layer)}</th>
                <td className="text-right">{fmtPct(r.slice_mean, 2)}</td>
                <td className="text-right">{fmtPct(r.global_mean, 2)}</td>
                <td className="text-right">{fmtNum(r.delta * 100, 2)}</td>
              </tr>
            ))}
          </tbody>
      </ChartTable>
    </div>
  );
}

/** Where the shortfall sits inside the group, by a sub-key: the top 20 as bars (share of the shortfall), the rest as one bar, the cumulative share as a line. */
export function PenaltyPareto({ penaltyMass, height = 260, by = "vendors", top = 20 }: { penaltyMass: Table | undefined; height?: number; by?: string; top?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { t } = useVocabulary();
  const rows = useMemo(() => {
    const all = [...tableRecords<Mass>(penaltyMass)].sort((a, b) => b.penalty_mass - a.penalty_mass);
    if (all.length <= top) return all;
    const head = all.slice(0, top);
    const tail = all.slice(top);
    const other: Mass = { key: `other ${by} (${tail.length})`, n_cases: tail.reduce((s, r) => s + r.n_cases, 0), penalty_mass: tail.reduce((s, r) => s + r.penalty_mass, 0), mean_penalty: 0, share: tail.reduce((s, r) => s + r.share, 0), cum_share: 1, rank: top + 1 };
    return [...head, other];
  }, [penaltyMass, top, by]);
  const layout = useMemo(() => horizontalCategoryLayout(rows.map((r) => r.key), height), [rows, height]);
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { ...layout.grid, top: 72 },
      legend: { top: 0, left: 0, right: 0, type: "scroll", textStyle: { fontSize: 13 } },
      tooltip: { ...readableTooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => fmtPct(v, 1) },
      yAxis: layout.yAxis,
      xAxis: [
        { type: "value", name: "share of the shortfall (%)", nameLocation: "middle", nameGap: 32, splitNumber: 3, axisLabel: { fontSize: 13, formatter: (v: number) => fmtPct(v, 0) } },
        { type: "value", position: "top", min: 0, max: 1, splitNumber: 3, axisLabel: { fontSize: 13, formatter: (v: number) => fmtPct(v, 0) }, splitLine: { show: false } },
      ],
      series: [
        { name: "share of the shortfall", type: "bar", data: rows.map((r) => r.share), itemStyle: { color: tk.accent } },
        { name: "cumulative share (top scale)", type: "line", xAxisIndex: 1, data: rows.map((r) => r.cum_share), lineStyle: { color: tk.reference }, itemStyle: { color: tk.reference } },
      ],
    }),
    [rows, tk, layout],
  );
  return (
    <div>
      <div className="overflow-x-auto">
        <EChart className="min-w-[360px]" option={option} height={layout.height + 24} ariaLabel={`${t("penalty_mass")}: the top ${top} ${by} and the rest`} />
      </div>
      <ChartTable label="Shortfall by sub-group">
          <thead>
            <tr>
              <th scope="col" className="text-left">key</th>
              <th scope="col" className="text-right">cases</th>
              <th scope="col" className="text-right">share of the shortfall</th>
              <th scope="col" className="text-right">cumulative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="text-left font-normal">{r.key}</th>
                <td className="text-right">{r.n_cases}</td>
                <td className="text-right">{fmtPct(r.share, 1)}</td>
                <td className="text-right">{fmtPct(r.cum_share, 1)}</td>
              </tr>
            ))}
          </tbody>
      </ChartTable>
    </div>
  );
}

/** Composite behind "Show all" on the Why tab: the waterfall, the area strips and where the shortfall sits inside the group. */
export default function DriversCharts({ drivers, layers, penaltyMass, penaltyMassBy, layerNames, gap, onSelect, plainOf }: { drivers: Table | undefined; layers: Table | undefined; penaltyMass: Table | undefined; penaltyMassBy?: string; layerNames?: Record<string, string>; gap: number; onSelect?: (constraintId: string) => void; plainOf?: (constraintId: string) => string }) {
  const by = penaltyMassBy ? `${penaltyMassBy.replace(/^case /, "").toLowerCase()}s` : "sub-groups";
  return (
    <>
      <div className="surface p-4">
        <h3 className="mb-1 text-sm font-semibold">See as a waterfall</h3>
        <p className="mb-2 text-xs text-text-muted">Each expectation's share of the shortfall; click a bar to compare the group with everyone else on that expectation.</p>
        <GapWaterfall drivers={drivers} gap={gap} onSelect={onSelect} plainOf={plainOf} />
      </div>
      <div className="surface p-4">
        <h3 className="mb-1 text-sm font-semibold">Expectation areas</h3>
        <LayerBars layers={layers} layerNames={layerNames} />
      </div>
      <div className="surface p-4">
        <h3 className="mb-1 text-sm font-semibold">Where inside this group{penaltyMassBy ? ` · by ${penaltyMassBy.replace(/^case /, "")}` : ""}</h3>
        <PenaltyPareto penaltyMass={penaltyMass} by={by} />
      </div>
    </>
  );
}
