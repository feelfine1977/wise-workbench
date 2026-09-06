// Stand-in for `@wise/flow` when the flow library checkout is not available; see index.d.ts.
export const defaultStyle = { name: "default" };
export const diffStyle = { name: "diff" };
export function diff(_a, b) {
  return b;
}
export function filterPositions(positions, graph) {
  const keep = new Set(graph.nodes.map((n) => n.id));
  return Object.fromEntries(Object.entries(positions).filter(([id]) => keep.has(id)));
}
export function canonicalOverlays(overlays) {
  return overlays;
}
