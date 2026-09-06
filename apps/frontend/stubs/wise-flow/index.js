// Stand-in for `@wise/flow` when the flow library checkout is not available; see index.d.ts.
export const defaultStyle = { name: "default" };
export const palettes = {
  sequential: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"],
  sequentialBlue: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  diverging: ["#542788", "#998ec3", "#d8daeb", "#f7f7f7", "#fee0b6", "#f1a340", "#b35806"],
  categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"],
};
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
