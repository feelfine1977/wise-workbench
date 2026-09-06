import { useMemo } from "react";
import type { Table } from "@wise/api-schema";
import { EChart } from "@/components/charts/EChart";
import { chartTokens, type EChartsOption } from "@/components/charts/echarts";
import { layerDecal } from "@/components/badges";
import { fmtNum, fmtPct } from "@/lib/format";
import { useUiStore, resolveTheme } from "@/lib/stores/ui";
import { hashIndex, tableRecords } from "@/lib/utils";

type Driver = { constraint: string; layer: string; type: string; delta_gap: number; mean_penalty: number; share_violated: number; share_in_scope: number; description?: string };
type Layer = { layer: string; slice_mean: number; global_mean: number; delta: number };
type Mass = { key: string; n_cases: number; penalty_mass: number; mean_penalty: number; share: number; cum_share: number; rank: number };

const decalFor = (kind: string) => {
  switch (kind) {
    case "diagonal": return { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: Math.PI / 4 };
    case "dots": return { symbol: "circle", symbolSize: 0.5, dashArrayX: [4, 4], dashArrayY: [4, 4] };
    case "cross": return { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: -Math.PI / 4 };
    case "horizontal": return { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: 0 };
    case "vertical": return { symbol: "rect", dashArrayX: [2, 4], dashArrayY: [1, 0], rotation: 0 };
    case "grid": return { symbol: "rect", dashArrayX: [2, 3], dashArrayY: [2, 3], rotation: 0 };
    case "wave": return { symbol: "triangle", dashArrayX: [3, 3], dashArrayY: [3, 3], rotation: 0 };
    default: return undefined;
  }
};

/** Gap waterfall by constraint: positive and negative contributions that sum to the gap. */
export function GapWaterfall({ drivers, gap, onSelect, height = 320, maxBars = 14 }: { drivers: Table | undefined; gap: number; onSelect?: (constraintId: string) => void; height?: number; maxBars?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const { option, rows } = useMemo(() => {
    const all = tableRecords<Driver>(drivers).filter((d) => Number.isFinite(d.delta_gap));
    const sorted = [...all].sort((a, b) => Math.abs(b.delta_gap) - Math.abs(a.delta_gap));
    const shown = sorted.slice(0, maxBars);
    const rest = sorted.slice(maxBars).reduce((s, d) => s + d.delta_gap, 0);
    const items = [...shown.map((d) => ({ id: d.constraint, layer: d.layer, v: d.delta_gap })), ...(sorted.length > maxBars ? [{ id: `other (${sorted.length - maxBars})`, layer: "", v: rest }] : [])];
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
    const cats = [...items.map((i) => i.id), "gap"];
    base.push(0);
    pos.push(gap);
    neg.push(0);
    const opt: EChartsOption = {
      animation: false,
      grid: { left: 56, right: 16, top: 16, bottom: 90 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: unknown) => { const arr = p as { axisValue: string; dataIndex: number }[]; const a = arr[0]; if (!a) return ""; const i = a.dataIndex; const v = i < items.length ? items[i]!.v : gap; return `<strong>${a.axisValue}</strong><br/>Δ gap ${fmtNum(v, 4)}`; } },
      xAxis: { type: "category", data: cats, axisLabel: { rotate: 40, fontSize: 10, interval: 0 } },
      yAxis: { type: "value", name: "Δ gap", axisLabel: { formatter: (v: number) => fmtNum(v, 2) } },
      series: [
        { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, silent: true, tooltip: { show: false } },
        {
          type: "bar",
          stack: "w",
          name: "increases the gap",
          data: pos.map((v, i) => ({ value: v, itemStyle: i === cats.length - 1 ? { color: tk.reference } : { color: tk.layers[hashIndex(items[i]?.layer ?? "")] ?? tk.violation[5], decal: decalFor(layerDecal(items[i]?.layer ?? "")) } })),
        },
        { type: "bar", stack: "w", name: "reduces the gap", data: neg, itemStyle: { color: tk.score[4] } },
      ],
    };
    return { option: opt, rows: items };
  }, [drivers, gap, tk, maxBars]);

  return (
    <div>
      <EChart option={option} height={height} ariaLabel={`Gap waterfall by constraint; the bars sum to the gap ${fmtNum(gap, 3)}`} onEvents={{ click: (p) => { const name = (p as { name?: string }).name; if (name && onSelect && rows.some((r) => r.id === name)) onSelect(name); } }} />
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">constraint</th>
              <th scope="col" className="text-right">Δ gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono">{r.id}</td>
                <td className="text-right">{fmtNum(r.v, 4)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>gap</td>
              <td className="text-right">{fmtNum(gap, 4)}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Expectation-area penalty in the group vs the whole log (`slice_mean`, `global_mean`; the deltas sum to the gap). */
export function LayerBars({ layers, layerNames = {}, height = 260 }: { layers: Table | undefined; layerNames?: Record<string, string>; height?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const rows = useMemo(() => tableRecords<Layer>(layers), [layers]);
  const name = (id: string) => layerNames[id] ?? id;
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 170, right: 24, top: 28, bottom: 28 },
      legend: { top: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => fmtNum(v, 3) },
      xAxis: { type: "value", name: "mean penalty per case", nameLocation: "middle", nameGap: 22 },
      yAxis: { type: "category", data: rows.map((r) => name(r.layer)), axisLabel: { fontSize: 10 }, inverse: true },
      series: [
        { name: "this group", type: "bar", data: rows.map((r) => ({ value: r.slice_mean, itemStyle: { color: tk.layers[hashIndex(r.layer)], decal: decalFor(layerDecal(r.layer)) } })), barGap: "10%" },
        { name: "everyone", type: "bar", data: rows.map((r) => r.global_mean), itemStyle: { color: tk.muted, opacity: 0.5 } },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, tk, layerNames],
  );
  return (
    <div>
      <EChart option={option} height={height} ariaLabel="Penalty per expectation area in this group compared with everyone else" />
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">expectation area</th>
              <th scope="col" className="text-right">this group</th>
              <th scope="col" className="text-right">everyone</th>
              <th scope="col" className="text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.layer}>
                <td>{name(r.layer)}</td>
                <td className="text-right">{fmtNum(r.slice_mean, 4)}</td>
                <td className="text-right">{fmtNum(r.global_mean, 4)}</td>
                <td className="text-right">{fmtNum(r.delta, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Penalty-mass Pareto by a sub-key (bars = mass, line = cumulative share). */
export function PenaltyPareto({ penaltyMass, height = 260 }: { penaltyMass: Table | undefined; height?: number }) {
  const tk = chartTokens[resolveTheme(useUiStore((s) => s.theme))];
  const rows = useMemo(() => tableRecords<Mass>(penaltyMass), [penaltyMass]);
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 56, right: 56, top: 28, bottom: 70 },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: rows.map((r) => r.key), axisLabel: { rotate: 30, fontSize: 10, interval: 0 } },
      yAxis: [
        { type: "value", name: "penalty mass" },
        { type: "value", name: "cumulative", min: 0, max: 1, axisLabel: { formatter: (v: number) => fmtPct(v) }, splitLine: { show: false } },
      ],
      series: [
        { name: "penalty mass", type: "bar", data: rows.map((r) => r.penalty_mass), itemStyle: { color: tk.violation[4] } },
        { name: "cumulative share", type: "line", yAxisIndex: 1, data: rows.map((r) => r.cum_share), lineStyle: { color: tk.accent }, itemStyle: { color: tk.accent } },
      ],
    }),
    [rows, tk],
  );
  return (
    <div>
      <EChart option={option} height={height} ariaLabel="Penalty-mass Pareto by sub-key" />
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Table alternative</summary>
        <table className="tnum mt-1 w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="text-left">key</th>
              <th scope="col" className="text-right">n</th>
              <th scope="col" className="text-right">mass</th>
              <th scope="col" className="text-right">share</th>
              <th scope="col" className="text-right">cum.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td className="text-right">{r.n_cases}</td>
                <td className="text-right">{fmtNum(r.penalty_mass, 2)}</td>
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

/** Composite used by the slice page so the whole drivers tab loads in one chunk. */
export default function DriversCharts({ drivers, layers, penaltyMass, penaltyMassBy, layerNames, gap, onSelect }: { drivers: Table | undefined; layers: Table | undefined; penaltyMass: Table | undefined; penaltyMassBy?: string; layerNames?: Record<string, string>; gap: number; onSelect?: (constraintId: string) => void }) {
  return (
    <>
      <div className="surface p-4 shadow-1">
        <h3 className="mb-2 text-sm font-semibold">
          Gap waterfall by constraint <span className="font-normal text-text-subtle">— each expectation's contribution; the bars sum to the shortfall {fmtPct(gap, 2)}; click a bar to compare the group with everyone else</span>
        </h3>
        <GapWaterfall drivers={drivers} gap={gap} onSelect={onSelect} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-4 shadow-1">
          <h3 className="mb-2 text-sm font-semibold">Expectation areas: this group vs everyone else</h3>
          <LayerBars layers={layers} layerNames={layerNames} />
        </div>
        <div className="surface p-4 shadow-1">
          <h3 className="mb-2 text-sm font-semibold">Where the shortfall sits{penaltyMassBy ? ` by ${penaltyMassBy.replace(/^case /, "")}` : ""}</h3>
          <PenaltyPareto penaltyMass={penaltyMass} />
        </div>
      </div>
    </>
  );
}
