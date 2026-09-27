import { hierarchy, partition } from "d3";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Constraint } from "./Builder";
import { constraintName } from "./normAuthoring";
import { constraintFamily } from "./constraintFamily";

type Group = { id: string; name: string; matches: Constraint[] };
type Node = { name: string; layer?: string; family?: string; value?: number; children?: Node[] };
const colors = ["#0e7490", "#6d28d9", "#0369a1", "#a16207", "#0f766e", "#be185d", "#475569"];

/** D3 partition area encodes catalogue size, never cases, performance or importance. */
export function NormHierarchyChart({ groups, onConstraint }: { groups: Group[]; onConstraint: (id: string) => void }) {
  const [selected, setSelected] = useState<{ layer: string; family?: string }>();
  const [page, setPage] = useState(0);
  const active = groups.find(group => group.id === selected?.layer && group.matches.length > 0);
  const data: Node = { name: "Visible norm", children: groups.filter(g => g.matches.length).map(group => ({ name: group.name, layer: group.id, children: [...new Set(group.matches.map(c => constraintFamily(c.type)))].map(family => ({ name: family, layer: group.id, family, value: group.matches.filter(c => constraintFamily(c.type) === family).length })) })) };
  const root = hierarchy(active ? data.children!.find(node => node.layer === active.id)! : data).sum(node => node.value ?? 0);
  const layout = partition<Node>().size([600, 900]).padding(2)(root);
  const nodes = layout.descendants();
  const rules = active?.matches.filter(c => !selected?.family || constraintFamily(c.type) === selected.family) ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rules.length / 8) - 1));
  return <section aria-label="Norm hierarchy overview" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Where the expectations sit</h3><p className="text-xs text-text-muted">Area = number of visible rules. Color identifies a layer. Select an area to explore.</p></div>{active && <Button size="sm" variant="outline" onClick={() => { setSelected(undefined); setPage(0); }}>All layers in overview</Button>}</div>
    <div className="overflow-x-auto rounded border border-border" role="region" aria-label="Explore hierarchy chart" tabIndex={0}>
      <div className="relative min-w-[560px]" style={{ height: 420 }}>
        {nodes.map((node, index) => {
          const color = colors[Math.max(0, groups.findIndex(g => g.id === node.data.layer)) % colors.length];
          const height = (node.x1 - node.x0) / 600 * 420;
          const label = `${node.data.name} · ${node.value ?? 0} rules`;
          const style = { left: `${node.y0 / 9}%`, top: `${node.x0 / 6}%`, width: `${(node.y1 - node.y0) / 9}%`, height: `${(node.x1 - node.x0) / 6}%`, backgroundColor: node.depth === 0 ? "#334155" : color, color: "white" };
          return node.data.layer ? <button key={index} type="button" aria-label={`Explore ${node.data.family ? `${active?.name ?? groups.find(g => g.id === node.data.layer)?.name} / ` : ""}${label}`} title={label} className="absolute overflow-hidden rounded-sm p-1 text-left text-sm focus-visible:z-10 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-white" style={style} onClick={() => { setSelected({ layer: node.data.layer!, family: node.data.family }); setPage(0); }}><span className={height < 24 ? "sr-only" : "block truncate font-medium"}>{node.data.name}</span>{height > 55 && <span className="block text-xs">{node.value} rules</span>}</button> : <div key={index} className="absolute overflow-hidden rounded-sm p-3 text-sm font-medium" style={style}>{label}</div>;
        })}
      </div>
    </div>
    <p className="text-xs text-text-muted">Purpose → layers → rule families. This shows definitions, not process flows. Use Map or Table for individual relationships.</p>
    {active && <section aria-label="Expectations in selected area" className="rounded border border-border p-3">
      <h4 className="text-sm font-semibold">{active.name}{selected?.family ? ` / ${selected.family}` : ""}</h4>
      <ul className="mt-2 space-y-1">{rules.slice(currentPage * 8, (currentPage + 1) * 8).map(c => <li key={c.id}><button type="button" className="min-h-8 text-left text-sm text-accent-text underline" onClick={() => onConstraint(c.id)}>{constraintName(c)}</button></li>)}</ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs"><span role="status">{rules.length ? currentPage * 8 + 1 : 0}–{Math.min((currentPage + 1) * 8, rules.length)} of {rules.length} rules</span>{rules.length > 8 && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous expectations</Button><Button size="sm" variant="outline" disabled={(currentPage + 1) * 8 >= rules.length} onClick={() => setPage(currentPage + 1)}>Next expectations</Button></div>}</div>
    </section>}
    {!groups.some(group => group.matches.length) && <p className="text-sm">No visible rules. Restore hidden items or adjust the display settings.</p>}
  </section>;
}
