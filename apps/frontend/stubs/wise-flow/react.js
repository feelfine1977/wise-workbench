// Stand-in for `@wise/flow/react` when the flow library checkout is not available; see index.d.ts.
import { createElement } from "react";

export function useStableLayout(scenes) {
  const list = scenes === undefined ? [] : Array.isArray(scenes) ? scenes : [scenes];
  const positions = {};
  for (const scene of list) for (const node of scene.nodes) positions[node.id] = { x: 0, y: 0 };
  return { positions, status: "ready" };
}

export function ProcessMap({ graph, ariaLabel, className, containerStyle }) {
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  return createElement(
    "div",
    { role: "img", "aria-label": ariaLabel ?? "process map", className, style: { padding: "1rem", ...containerStyle } },
    createElement("p", null, "The process map needs the flow library (@wise/flow), which this build does not include."),
    createElement("p", null, `${activities.length} activities and ${graph.edges.length} paths are in this scene.`),
  );
}
