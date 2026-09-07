// Stand-in for `@wise/flow/bpmn` when the flow library checkout is not available; see bpmn.d.ts.
export function liteFromGraph(graph) {
  return graph;
}
export async function exportBpmn() {
  throw new Error("The BPMN export needs the flow library (@wise/flow), which this build does not include.");
}
