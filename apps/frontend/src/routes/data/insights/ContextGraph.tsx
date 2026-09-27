import { useMemo, useState } from "react";
import { hierarchy, treemap, scaleOrdinal } from "d3";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { fmtInt } from "@/lib/format";
import type { EDACategory } from "@/lib/api/eda";

export interface JointCount {
  leftKey: string;
  rightKey: string;
  total: number;
  selected: number;
}
const palette = [
  "#4263eb",
  "#0c8599",
  "#ae3ec9",
  "#d9480f",
  "#087f5b",
  "#6741d9",
  "#c2255c",
  "#5c7c0a",
];
interface Node {
  id: string;
  label: string;
  side: "left" | "right";
  key: string;
}
interface Edge {
  source: string;
  target: string;
  value: number;
  total: number;
  selected: number;
  leftKey: string;
  rightKey: string;
}
interface TreeNode {
  name: string;
  leftKey?: string;
  rightKey?: string;
  total?: number;
  selected?: number;
  children?: TreeNode[];
}

/** Attribute membership is a conserved two-column partition, not activity transitions. */
export function ContextGraph({
  left,
  right,
  rows,
  leftField,
  rightField,
  onPair,
}: {
  left: EDACategory[];
  right: EDACategory[];
  rows: JointCount[];
  leftField: string;
  rightField: string;
  onPair: (leftKey: string, rightKey: string) => void;
}) {
  const [mode, setMode] = useState<"sankey" | "treemap">("sankey");
  const width = 900;
  const height = Math.max(
    340,
    Math.max(
      left.filter((r) => r.total > 0).length,
      right.filter((r) => r.total > 0).length,
    ) * 25,
  );
  const color = scaleOrdinal<string, string>()
    .domain(left.map((r) => r.key))
    .range(palette);
  const graph = useMemo(() => {
    if (!rows.some((r) => r.total > 0)) return null;
    const layout = sankey<Node, Edge>()
      .nodeId((n) => n.id)
      .nodeWidth(12)
      .nodePadding(14)
      .nodeSort(() => 0)
      .extent([
        [195, 12],
        [width - 195, height - 12],
      ]);
    return layout({
      nodes: [
        ...left
          .filter((r) => r.total > 0)
          .map((r) => ({
            id: `l:${r.key}`,
            key: r.key,
            label: r.label,
            side: "left" as const,
          })),
        ...right
          .filter((r) => r.total > 0)
          .map((r) => ({
            id: `r:${r.key}`,
            key: r.key,
            label: r.label,
            side: "right" as const,
          })),
      ],
      links: rows
        .filter((r) => r.total > 0)
        .map((r) => ({
          source: `l:${r.leftKey}`,
          target: `r:${r.rightKey}`,
          value: r.total,
          ...r,
        })),
    });
  }, [left, right, rows, height]);
  const tree = useMemo(
    () =>
      treemap<TreeNode>()
        .size([width, 350])
        .paddingOuter(4)
        .paddingTop(24)
        .paddingInner(3)(
        hierarchy<TreeNode>({
          name: "All cases",
          children: left
            .filter((l) => l.total > 0)
            .map((l) => ({
              name: l.label,
              leftKey: l.key,
              children: rows
                .filter((r) => r.leftKey === l.key && r.total > 0)
                .map((r) => ({
                  ...r,
                  name:
                    right.find((x) => x.key === r.rightKey)?.label ??
                    r.rightKey,
                })),
            })),
        }).sum((r) => r.total ?? 0),
      ),
    [left, right, rows],
  );
  const describe = (r: JointCount) =>
    `${left.find((x) => x.key === r.leftKey)?.label} × ${right.find((x) => x.key === r.rightKey)?.label}: ${fmtInt(r.selected)} selected / ${fmtInt(r.total)} all cases`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {leftField} <span aria-hidden>↔</span> {rightField}
        </p>
        <div
          className="inline-flex gap-1 rounded-lg bg-surface-sunken p-1"
          aria-label="Context visualization"
        >
          {(["sankey", "treemap"] as const).map((m) => (
            <button
              className={`rounded-md px-3 py-1.5 text-xs ${mode === m ? "bg-surface font-semibold shadow-sm" : "text-text-muted"}`}
              aria-pressed={mode === m}
              key={m}
              onClick={() => setMode(m)}
            >
              {m === "sankey" ? "Sankey" : "Treemap"}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        Each case belongs to one pair. Size shows all cases; color intensity
        shows the selected share. Select a connection or tile to filter both
        fields.
      </p>
      {graph && mode === "sankey" && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[620px]"
          aria-label="Context membership Sankey"
        >
          {graph.links.map((link) => (
            <g
              key={`${link.leftKey}:${link.rightKey}`}
              role="button"
              tabIndex={0}
              aria-label={describe(link)}
              onClick={() => onPair(link.leftKey, link.rightKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPair(link.leftKey, link.rightKey);
                }
              }}
              className="cursor-pointer focus:outline focus:outline-2 focus:outline-offset-2"
            >
              <title>{describe(link)}</title>
              <path
                d={sankeyLinkHorizontal<Node, Edge>()(link) ?? undefined}
                stroke={color(link.leftKey)}
                strokeWidth={Math.max(1, link.width ?? 0)}
                strokeOpacity={
                  0.1 + (0.55 * link.selected) / Math.max(1, link.value)
                }
                fill="none"
              />
            </g>
          ))}
          {graph.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x0}
                y={node.y0}
                width={12}
                height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))}
                fill={node.side === "left" ? color(node.key) : "#0c8599"}
              />
              <text
                x={
                  node.side === "left" ? (node.x0 ?? 0) - 9 : (node.x1 ?? 0) + 9
                }
                y={((node.y0 ?? 0) + (node.y1 ?? 0)) / 2}
                dy="0.35em"
                textAnchor={node.side === "left" ? "end" : "start"}
                fill="currentColor"
                fontSize="11"
              >
                <title>{node.label}</title>
                {node.label.length > 27
                  ? node.label.slice(0, 26) + "…"
                  : node.label}
              </text>
            </g>
          ))}
        </svg>
      )}
      {mode === "treemap" && (
        <svg
          viewBox={`0 0 ${width} 350`}
          className="w-full min-w-[620px]"
          aria-label="Context membership treemap"
        >
          {tree.children?.map((n) => (
            <text
              key={n.data.leftKey}
              x={n.x0 + 6}
              y={n.y0 + 16}
              fontSize="11"
              fill="currentColor"
            >
              <title>{n.data.name}</title>
              {n.x1 - n.x0 > 70
                ? n.data.name.slice(0, Math.floor((n.x1 - n.x0) / 7))
                : ""}
            </text>
          ))}
          {tree
            .leaves()
            .filter((n) => n.data.leftKey && n.data.rightKey)
            .map((n) => (
              <g
                key={`${n.data.leftKey}:${n.data.rightKey}`}
                tabIndex={0}
                role="button"
                aria-label={describe(n.data as JointCount)}
                onClick={() => onPair(n.data.leftKey!, n.data.rightKey!)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPair(n.data.leftKey!, n.data.rightKey!);
                  }
                }}
                className="cursor-pointer focus:outline focus:outline-2"
              >
                <title>{describe(n.data as JointCount)}</title>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={Math.max(0, n.x1 - n.x0)}
                  height={Math.max(0, n.y1 - n.y0)}
                  rx="3"
                  fill={color(n.data.leftKey!)}
                  fillOpacity={
                    0.12 +
                    (0.6 * (n.data.selected ?? 0)) /
                      Math.max(1, n.data.total ?? 1)
                  }
                />
                {n.x1 - n.x0 > 85 && n.y1 - n.y0 > 40 && (
                  <text
                    x={n.x0 + 8}
                    y={n.y0 + 18}
                    fill="currentColor"
                    fontSize="11"
                    pointerEvents="none"
                  >
                    <tspan>
                      {n.data.name.slice(0, Math.floor((n.x1 - n.x0 - 20) / 7))}
                    </tspan>
                    <tspan x={n.x0 + 8} dy="16" fontWeight="600">
                      {fmtInt(n.data.selected ?? 0)}
                    </tspan>
                  </text>
                )}
              </g>
            ))}
        </svg>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-text-muted">
          Connections as a table · keyboard selection
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>{leftField}</th>
                <th>{rightField}</th>
                <th>Selected</th>
                <th>All</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.total > 0)
                .map((r) => (
                  <tr
                    key={`${r.leftKey}:${r.rightKey}`}
                    className="border-t border-border"
                  >
                    <td className="py-2">
                      <button
                        className="text-accent-text underline"
                        aria-label={`Filter ${describe(r)}`}
                        onClick={() => onPair(r.leftKey, r.rightKey)}
                      >
                        {left.find((x) => x.key === r.leftKey)?.label}
                      </button>
                    </td>
                    <td>{right.find((x) => x.key === r.rightKey)?.label}</td>
                    <td>{fmtInt(r.selected)}</td>
                    <td>{fmtInt(r.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
