import { useChartNavigation } from "@/lib/useChartNavigation";
import { useId, useMemo } from "react";
import { hierarchy, partition } from "d3";
import type { EDAHierarchy, EDAJointPredicate } from "@/lib/api/eda";
import { contextPath, matchesContextPath } from "./selectionHelpers";
import { fmtInt, fmtShare } from "@/lib/format";

const ICICLE_LEAF_LIMIT = 500;
interface ContextNode {
  label: string;
  keys: string[];
  total: number;
  selected: number;
  children?: ContextNode[];
}
function contextTree(data: EDAHierarchy): ContextNode {
  const root: ContextNode = { label: "All prepared cases", keys: [], total: 0, selected: 0, children: [] };
  for (const cell of data.cells) {
    let node = root;
    node.total += cell.total; node.selected += cell.selected;
    cell.keys.forEach((key, level) => {
      node.children ??= [];
      let child = node.children.find((candidate) => candidate.keys.at(-1) === key);
      if (!child) { child = { label: cell.labels[level]!, keys: cell.keys.slice(0, level + 1), total: 0, selected: 0 }; node.children.push(child); }
      child.total += cell.total; child.selected += cell.selected;
      node = child;
    });
  }
  return root;
}

/** D3 partitions complete case membership; selection never changes rectangle geometry. */
export function ContextIcicle({ data, branches, onToggle }: {
  data: EDAHierarchy; branches: EDAJointPredicate[]; onToggle: (branch: EDAJointPredicate) => void;
}) {
  const id = useId().replace(/:/g, "");
  const nodes = useMemo(() => {
    if (data.cells.length > ICICLE_LEAF_LIMIT) return [];
    const root = hierarchy(contextTree(data)).sum((node) => node.children?.length ? 0 : node.total);
    return partition<ContextNode>().size([900, 160])(root).descendants().filter((node) => node.depth > 0);
  }, [data]);
  const selectableNodes = nodes.filter(node => node.depth === 3 && (branches.length < 24 || branches.some(branch => matchesContextPath(branch, data.fields, node.data.keys, node.ancestors().reverse().slice(1).map(n => n.data.label)))));
  const navigateMark = useChartNavigation(selectableNodes.map(node => JSON.stringify(node.data.keys)), key => {
    const node = selectableNodes.find(n => JSON.stringify(n.data.keys) === key);
    if (!node) return;
    const labels = node.ancestors().reverse().slice(1).map(n => n.data.label);
    onToggle(branches.find(b => matchesContextPath(b, data.fields, node.data.keys, labels)) ?? contextPath(data.fields, node.data.keys, labels));
  });
  if (data.cells.length > ICICLE_LEAF_LIMIT) return <p className="eda-note">The icicle supports up to {ICICLE_LEAF_LIMIT} occupied leaf groups. This declaration has {fmtInt(data.cells.length)}; use the complete tree below. No cases or branches have been dropped.</p>;
  if (!nodes.length) return <p className="eda-note">No prepared cases to partition.</p>;
  return <div className="overflow-x-auto" aria-label="Context icicle overview">
    <svg viewBox="0 0 1050 170" className="min-w-[640px] w-full" role="group" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>Declared three-level context icicle</title>
      <desc id={`${id}-desc`}>Widths show all prepared cases. Colored overlays show the selected share within each group. Select a third-level leaf to toggle that complete context path. The tree below offers the same actions.</desc>
      {data.fields.map((field, level) => <text key={field} x={0} y={35 + level * 40} fill="currentColor" fontSize={11}><title>{field}</title>{field.length > 21 ? `${field.slice(0, 20)}…` : field}</text>)}
      <g transform="translate(150, 8)">{nodes.map((node, index) => {
        const width = Math.max(0, node.x1 - node.x0), y = node.y0 - 40;
        const leaf = node.depth === 3;
        const labels = node.ancestors().reverse().slice(1).map((ancestor) => ancestor.data.label);
        const existing = leaf ? branches.find((b) => matchesContextPath(b, data.fields, node.data.keys, labels)) : undefined;
        const branch = existing ?? contextPath(data.fields, node.data.keys, labels);
        const active = Boolean(existing);
        const selectable = leaf && (active || branches.length < 24);
        const description = `${node.ancestors().reverse().slice(1).map((ancestor, level) => `${data.fields[level]} = ${ancestor.data.label}`).join(" → ")}; ${fmtInt(node.data.selected)} selected / ${fmtInt(node.data.total)} all cases (${fmtShare(node.data.total ? node.data.selected / node.data.total : 0)} selected)`;
        return <g key={JSON.stringify(node.data.keys)} role={leaf ? "button" : undefined} {...(selectable ? navigateMark(JSON.stringify(node.data.keys)) : {})} aria-label={description} aria-pressed={leaf ? active : undefined} aria-disabled={leaf ? !selectable : undefined}
          data-total={node.data.total} data-selected={node.data.selected} data-depth={node.depth}
          onClick={selectable ? () => onToggle(branch) : undefined}
          className={leaf ? "eda-icicle-leaf" : undefined}>
          <title>{description}</title>
          <rect x={node.x0} y={y} width={width} height={36} fill="var(--color-surface-sunken)" stroke="var(--color-border)" strokeWidth={.5} />
          <rect data-selected-overlay="true" x={node.x0} y={y} width={node.data.total ? width * node.data.selected / node.data.total : 0} height={36} fill="var(--color-accent-subtle)" pointerEvents="none" />
          {active && <rect x={node.x0} y={y} width={width} height={36} fill="none" stroke="var(--color-accent)" strokeWidth={2} pointerEvents="none" />}
          {width > 42 && <><clipPath id={`${id}-${index}`}><rect x={node.x0 + 4} y={y} width={Math.max(0, width - 8)} height={36} /></clipPath><text x={node.x0 + 5} y={y + 22} fill="currentColor" fontSize={11} clipPath={`url(#${id}-${index})`} pointerEvents="none">{node.data.label}</text></>}
        </g>;
      })}</g>
      <text x={150} y={154} fill="currentColor" fontSize={11}>Whole-population widths · colored selected-case overlays · click a leaf to toggle a complete path</text>
    </svg>
  </div>;
}
