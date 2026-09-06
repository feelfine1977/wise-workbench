import { useMemo } from "react";
import type { Table } from "@wise/api-schema";
import { EChart } from "@/components/charts/EChart";
import { chartTokens, type EChartsOption } from "@/components/charts/echarts";
import { layerColor } from "@/components/badges";
import { useVocabulary } from "@/components/Term";
import { fmtPct } from "@/lib/format";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { tableRecords } from "@/lib/utils";

type Driver = { constraint: string; layer: string; type: string; delta_gap: number; mean_penalty: number; share_violated: number; share_in_scope: number; description?: string };
type Layer = { layer: string; slice_mean: number; global_mean: number; delta: number };
type Mass = { key: string; n_cases: number; penalty_mass: number; mean_penalty: number; share: number; cum_share: number; rank: number };

/** The waterfall of the shortfall by expectation: every bar is the share of the shortfall an expectation explains, in whole per cent; the bars sum to 100 %. */
export function GapWaterfall({ drivers, gap, onSelect, height = 320, maxBars = 14, plainOf }: { drivers: Table | undefined; gap: number; onSelect?: (constraintId: string) => void; height?: number; maxBars?: number; plainOf?: (constraintId: string) => string }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { t } = useVocabulary();
  const { option, rows } = useMemo(() => {
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
    const opt: EChartsOption = {
      animation: false,
      grid: { left: 64, right: 16, top: 16, bottom: 110 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: unknown) => { const arr = p as { axisValue: string; dataIndex: number }[]; const a = arr[0]; if (!a) return ""; const i = a.dataIndex; const v = i < items.length ? items[i]!.v : 1; return `<strong>${a.axisValue}</strong><br/>${fmtPct(v, 0)} of the shortfall`; } },
      xAxis: { type: "category", data: cats, axisLabel: { rotate: 40, fontSize: 10, interval: 0, width: 140, overflow: "truncate" } },
      yAxis: { type: "value", name: "share of the shortfall", axisLabel: { formatter: (v: number) => fmtPct(v, 0) }, minInterval: 0.05 },
      series: [
        { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, silent: true, tooltip: { show: false } },
        { type: "bar", stack: "w", name: "adds to the shortfall", data: pos.map((v, i) => ({ value: v, itemStyle: i === cats.length - 1 ? { color: tk.reference } : { color: tk.accent } })) },
        { type: "bar", stack: "w", name: "met better than everyone else here", data: neg, itemStyle: { color: tk.muted, opacity: 0.6 } },
      ],
    };
    return { option: opt, rows: items };
  }, [drivers, gap, tk, maxBars, plainOf]);

  return (
    <div>
      <EChart option={option} height={height} ariaLabel={`Waterfall of the shortfall by expectation; the bars sum to the shortfall ${fmtPct(gap, 1)}`} onEvents={{ click: (p) => { const name = (p as { name?: string }).name; const row = rows.find((r) => r.name === name); if (row && onSelect && row.id !== "__other__") onSelect(row.id); } }} />
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">expectation</th>
              <th scope="col" className="text-right">share of the shortfall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.id}>{r.name}</td>
                <td className="text-right">{fmtPct(r.v, 0)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>the shortfall</td>
              <td className="text-right">{fmtPct(gap, 2)} of the score</td>
            </tr>
          </tbody>
        </table>
      </details>
      <p className="mt-1 text-xs text-text-subtle">Shares can add to more than 100 % because other expectations are met better than average here{t("gap") === "gap" ? " (Δ gap per constraint over the gap)" : ""}.</p>
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
            <li key={r.layer} className="grid grid-cols-[minmax(160px,1fr)_3fr] items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 truncate" title={r.layer}>
                <span aria-hidden className="layer-swatch" style={{ background: layerColor(r.layer) }} />
                <span className="truncate">{name(r.layer)}</span>
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
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">expectation area</th>
              <th scope="col" className="text-right">this group</th>
              <th scope="col" className="text-right">everyone</th>
              <th scope="col" className="text-right">difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.layer}>
                <td>{name(r.layer)}</td>
                <td className="text-right">{fmtPct(r.slice_mean, 2)}</td>
                <td className="text-right">{fmtPct(r.global_mean, 2)}</td>
                <td className="text-right">{fmtPct(r.delta, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
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
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 56, right: 56, top: 28, bottom: 70 },
      legend: { top: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => fmtPct(v, 0) },
      xAxis: { type: "category", data: rows.map((r) => r.key), axisLabel: { rotate: 30, fontSize: 10, interval: 0 } },
      yAxis: [
        { type: "value", name: "share of the shortfall", axisLabel: { formatter: (v: number) => fmtPct(v, 0) } },
        { type: "value", name: "cumulative", min: 0, max: 1, axisLabel: { formatter: (v: number) => fmtPct(v) }, splitLine: { show: false } },
      ],
      series: [
        { name: "share of the shortfall", type: "bar", data: rows.map((r) => r.share), itemStyle: { color: tk.accent } },
        { name: "cumulative share", type: "line", yAxisIndex: 1, data: rows.map((r) => r.cum_share), lineStyle: { color: tk.reference }, itemStyle: { color: tk.reference } },
      ],
    }),
    [rows, tk],
  );
  return (
    <div>
      <EChart option={option} height={height} ariaLabel={`${t("penalty_mass")}: the top ${top} ${by} and the rest`} />
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
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
                <td>{r.key}</td>
                <td className="text-right">{r.n_cases}</td>
                <td className="text-right">{fmtPct(r.share, 1)}</td>
                <td className="text-right">{fmtPct(r.cum_share, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
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
