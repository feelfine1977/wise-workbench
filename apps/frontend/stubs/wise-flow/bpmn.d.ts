/**
 * Stand-in for `@wise/flow/bpmn` when the flow library checkout is not available (a fresh clone, CI): the
 * BPMN-lite conversion returns the graph unchanged and the export refuses, so the Model rendering shows its
 * error state instead of a diagram.
 */
import type { FlowGraph } from "./index";

export interface LiteOptions {
  abstraction?: { minNodeShare?: number; minEdgeShare?: number; keepConnected?: boolean; collapse?: "all" };
  lanes?: "groups" | "none";
  selfLoops?: "marker" | "flow" | "drop";
}
export declare function liteFromGraph(graph: FlowGraph, options?: LiteOptions): FlowGraph;
export declare function exportBpmn(graph: FlowGraph, options?: { name?: string; format?: boolean }): Promise<{ xml: string }>;
