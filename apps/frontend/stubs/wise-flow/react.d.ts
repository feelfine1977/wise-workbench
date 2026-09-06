import type { CSSProperties, JSX } from "react";
import type { FlowGraph, Overlay, Positions, StyleSpec } from "./index";

export type LayoutStatus = "idle" | "pending" | "ready" | "error";
export interface StableLayout {
  positions: Positions | undefined;
  status: LayoutStatus;
  error?: Error;
}
export interface LayoutOptions {
  elkWorkerUrl?: string;
}
export declare function useStableLayout(scenes: FlowGraph | FlowGraph[] | undefined, options?: LayoutOptions): StableLayout;

export interface MenuTarget {
  kind: string;
  id: string;
  ids: string[];
  label: string;
}
export interface MenuAction {
  id: string;
  label: string;
}
export interface ProcessMapProps {
  graph: FlowGraph;
  positions?: Positions;
  overlays?: Overlay[];
  style?: StyleSpec;
  defaultAbstraction?: { minNodeShare?: number; minEdgeShare?: number; keepConnected?: boolean };
  controls?: boolean;
  legend?: boolean;
  minimap?: boolean;
  contextMenu?: boolean;
  selfLoops?: boolean;
  lod?: Record<string, number>;
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
  locale?: string;
  layout?: LayoutOptions;
  ariaLabel?: string;
  className?: string;
  containerStyle?: CSSProperties;
  lanes?: "stages" | "roles" | "none";
  focus?: string | [string, string] | null;
  onFocusChange?: (focus: string | [string, string] | undefined) => void;
  paths?: unknown;
  filters?: unknown;
  filterPreview?: unknown;
  onFilterChange?: (filter: { and: unknown[] }) => void;
  onAction?: (action: MenuAction, target: MenuTarget) => void | string;
  announce?: string;
}
export declare function ProcessMap(props: ProcessMapProps): JSX.Element;
