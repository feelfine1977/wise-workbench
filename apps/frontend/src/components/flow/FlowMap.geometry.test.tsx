import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { layout, type FlowGraph, type Positions } from "@wise/flow";
import type { FlowGraph as ApiGraph } from "@wise/api-schema";
import type { ProcessMapProps } from "@wise/flow/react";
import raw from "./fixtures/o2c-observed.json";

vi.unmock("@/components/flow/FlowMap");
const state = vi.hoisted(() => ({ positions: undefined as Positions | undefined, props: undefined as ProcessMapProps | undefined, scenes: undefined as FlowGraph[] | undefined }));
vi.mock("@wise/flow/react", () => ({
  useStableLayout: (scenes: FlowGraph[]) => { state.scenes = scenes; return { status: "ready", positions: state.positions }; },
  ProcessMap: (props: ProcessMapProps) => { state.props = props; return <div data-testid="geometry-map" />; },
}));
import { FlowMap } from "./FlowMap";
const graph = raw as unknown as ApiGraph;
const shown = () => state.props!;
function count(value: number) {
  fireEvent.change(screen.getByRole("spinbutton", { name: "Number of activities" }), { target: { value: String(value) } });
  fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Number of activities" }), { key: "Enter" });
}
beforeAll(async () => { state.positions = await layout(raw as unknown as FlowGraph, { engine: "elk", edgeRouting: "ORTHOGONAL" }); });
beforeEach(() => { state.props = undefined; state.scenes = undefined; });

it("keeps real routes and exactly the supplied connections when O2C changes from 9 to 10 activities", () => {
  render(<FlowMap graph={graph} title="Observed O2C" detail={4} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Keep full-process positions" }));
  count(9);
  const nine = shown();
  const initial = structuredClone(nine.positions!);
  const layoutScenes = state.scenes;
  expect(nine.graph.nodes.filter((n) => n.kind === "activity")).toHaveLength(9);
  const visible = new Set(nine.graph.nodes.map((n) => n.id));
  expect(nine.graph.edges.map((e) => e.id)).toEqual(raw.edges.filter((e) => visible.has(e.source) && visible.has(e.target)).map((e) => e.id));
  for (const edge of nine.graph.edges.filter((e) => e.source !== e.target)) expect(nine.positions!.edges[edge.id]?.points.length).toBeGreaterThan(1);
  const create = nine.graph.edges.find((e) => e.source === "a_create_order" && e.target === "a_create_order_item");
  expect(create?.metrics?.cases).toBe(51149);
  count(10);
  expect(shown().graph.nodes.filter((n) => n.kind === "activity")).toHaveLength(10);
  expect(state.scenes).toBe(layoutScenes);
  for (const id of Object.keys(initial.nodes)) expect(shown().positions!.nodes[id]).toEqual(initial.nodes[id]);
  for (const id of Object.keys(initial.edges)) expect(shown().positions!.edges[id]).toEqual(initial.edges[id]);
  expect(shown().graph.edges.length).toBeGreaterThan(nine.graph.edges.length);
});

it("preserves manual geometry through selection, evidence and count changes; Reset restores routes", () => {
  render(<FlowMap graph={graph} title="Observed O2C" detail={4} full height={260} />);
  fireEvent.click(screen.getByRole("button", { name: "Display & meaning" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Keep full-process positions" }));
  count(9);
  const id = "a_create_order_item";
  const initial = structuredClone(shown().positions!);
  const point = { x: initial.nodes[id]!.x, y: initial.bounds.y - 200 };
  expect(shown().nodesDraggable).toBe(true);
  expect(screen.queryByRole("button", { name: "Reset layout" })).not.toBeInTheDocument();
  act(() => shown().onNodeMove!(id, point));
  expect(shown().positions!.nodes[id]).toMatchObject(point);
  const moved = structuredClone(shown().positions!);
  act(() => shown().onSelect!({ nodes: [id], edges: [], groups: [] }));
  expect(shown().positions).toEqual(moved);
  fireEvent.click(screen.getByRole("checkbox", { name: "WISE evidence" }));
  expect(shown().positions).toEqual(moved);
  count(10); count(9);
  expect(shown().positions).toEqual(moved);
  expect(screen.getByTestId("map-frame")).toHaveStyle({ minHeight: "0" });
  fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
  expect(shown().positions).toEqual(initial);
  expect(screen.queryByRole("button", { name: "Reset layout" })).not.toBeInTheDocument();
});
