import { group, hierarchy, partition } from "d3";
import { useId } from "react";
import type { Table } from "@wise/api-schema";
import { ChartTable } from "@/components/charts/ChartTable";
import { fmtNum } from "@/lib/format";
import { contributionData, type Contribution } from "./chartData";

interface Branch { name: string; id?: string; value?: number; children?: Branch[] }

function ContributionBranch({ rows, title, negative, maximum, plainOf, layerNames, onSelect }: {
  rows: Contribution[]; title: string; negative: boolean; maximum: number; plainOf: (id: string) => string; layerNames: Record<string, string>; onSelect: (id: string) => void;
}) {
  const root = hierarchy<Branch>({ name: title, children: Array.from(group(rows, (r) => r.layer), ([layer, children]) => ({
    name: layerNames[layer] ?? layer,
    children: children.map((r) => ({ name: plainOf(r.constraint), id: r.constraint, value: Math.abs(r.delta_gap) })),
  })) }).sum((r) => r.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const nodes = partition<Branch>().size([700 * (root.value ?? 0) / maximum, 132])(root).descendants();
  return (
    <div className="min-w-0 overflow-x-auto">
      <svg viewBox="0 0 704 138" className="w-full min-w-[350px]" role="group" aria-label={`${title}: area then expectation; score points`}>
        {nodes.map((node, i) => {
          const width = node.x1 - node.x0;
          const label = `${node.data.name}: ${negative ? '−' : '+'}${fmtNum((node.value ?? 0) * 100, 2)} score points`;
          const select = node.data.id;
          return <g key={i} role={select ? "button" : "img"} tabIndex={select ? 0 : undefined} aria-label={label}
            className={select ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" : undefined}
            onClick={select ? () => onSelect(select) : undefined}
            onKeyDown={select ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(select); } } : undefined}>
            <title>{label}</title>
            <rect x={node.x0 + 1} y={node.y0 + 1} width={Math.max(0, width - 2)} height={node.y1 - node.y0 - 2} rx={3}
              fillOpacity={0.2} strokeOpacity={0.5} className={negative ? "fill-success stroke-success" : "fill-accent stroke-accent"} />
            {width > 85 && <text x={node.x0 + 8} y={node.y0 + 25} className="fill-text text-[12px]" aria-hidden>{width > node.data.name.length * 7 + 16 ? node.data.name : `${negative ? '−' : '+'}${fmtNum((node.value ?? 0) * 100, 2)} pts`}</text>}
          </g>;
        })}
      </svg>
    </div>
  );
}

export function ContributionIcicle({ drivers, signedGap, view, selected, plainOf, layerNames, onSelect }: {
  drivers: Table | undefined; signedGap: number | undefined; view?: string; selected: boolean; plainOf: (id: string) => string; layerNames: Record<string, string>; onSelect: (id: string) => void;
}) {
  const id = useId();
  const data = contributionData(drivers, signedGap);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby={`${id}-title`} data-testid="contribution-icicle">
      <h2 id={`${id}-title`} className="text-base font-semibold">Where the score difference comes from</h2>
      <p className="mt-1 text-xs text-text-muted">Whole group · {view ?? "this view"} · compared with the whole run{selected ? "; filters and parent selection do not rescore this chart" : ""}.</p>
      {!data ? <p className="mt-3 text-sm text-text-muted">An exact additive breakdown is unavailable. Contributions must be complete and reconcile to the measured score difference before this chart can be drawn.</p> : (
        <>
          <p className="mt-3 text-sm"><strong className="tnum">{fmtNum(data.positive * 100, 2)}</strong> points of shortfall contributions − <strong className="tnum">{fmtNum(data.offsets * 100, 2)}</strong> points of offsets ≈ <strong className="tnum">{fmtNum(data.signedGap * 100, 2)}</strong> points net difference (rounded).</p>
          <p className="mt-1 text-xs text-text-muted">Each level divides the same total: contribution → area → expectation. Both branches use the same width scale. Select an expectation to inspect its measured comparison.</p>
          {data.positive > 0 && <div className="mt-3"><ContributionBranch rows={data.drivers.filter((r) => r.delta_gap > 0)} title="Shortfall contributions" negative={false} maximum={Math.max(data.positive, data.offsets)} plainOf={plainOf} layerNames={layerNames} onSelect={onSelect} /></div>}
          {data.offsets > 0 && <div className="mt-2"><ContributionBranch rows={data.drivers.filter((r) => r.delta_gap < 0)} title="Offsets: better than the run" negative maximum={Math.max(data.positive, data.offsets)} plainOf={plainOf} layerNames={layerNames} onSelect={onSelect} /></div>}
          {data.positive === 0 && data.offsets === 0 && <p className="mt-3 text-sm text-text-muted">All measured contributions are zero.</p>}
          <p className="mt-2 text-xs text-text-muted">These are score contributions under the saved norm, not causal effects or promised savings.</p>
          <ChartTable label="Signed score contributions by expectation">
            <thead><tr><th scope="col">Expectation</th><th scope="col">Area</th><th scope="col">Contribution (score points)</th></tr></thead>
            <tbody>{data.drivers.map((r) => <tr key={r.constraint}><th scope="row"><button type="button" onClick={() => onSelect(r.constraint)} className="text-accent-text underline">{plainOf(r.constraint)}</button></th><td>{layerNames[r.layer] ?? r.layer}</td><td>{fmtNum(r.delta_gap * 100, 3)}</td></tr>)}</tbody>
          </ChartTable>
        </>
      )}
    </section>
  );
}
