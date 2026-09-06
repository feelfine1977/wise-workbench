/**
 * Stand-in for `@wise/flow` when the flow library checkout is not available (a fresh clone, CI).
 * It carries the names `src/components/flow/FlowMap.tsx` imports with the library's shapes reduced to
 * what the application touches; the real library is linked from `../../../wise-flow` when it exists.
 */
export interface FlowNode {
  id: string;
  kind: string;
  label?: string;
  group?: string;
  [metric: string]: unknown;
}
export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  kind?: string;
  [metric: string]: unknown;
}
export interface FlowGroup {
  id: string;
  label?: string;
  parent?: string;
  [extra: string]: unknown;
}
export interface Overlay {
  id?: string;
  kind: string;
  [extra: string]: unknown;
}
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
  overlays?: Overlay[];
  meta?: Record<string, unknown>;
}
export type Positions = Record<string, { x: number; y: number }>;
export interface StyleSpec {
  readonly name?: string;
  nodeColor?: unknown;
  edgeColor?: unknown;
  edgeWidth?: unknown;
}
export declare const defaultStyle: StyleSpec;
export declare const palettes: { sequential: readonly string[]; sequentialBlue: readonly string[]; diverging: readonly string[]; categorical: readonly string[] };
export declare const diffStyle: StyleSpec;
export declare function diff(a: FlowGraph, b: FlowGraph): FlowGraph;
export declare function filterPositions(positions: Positions, graph: FlowGraph): Positions;
export declare function canonicalOverlays(overlays: Overlay[]): Overlay[];
