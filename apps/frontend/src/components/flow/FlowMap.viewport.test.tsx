import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type * as Xyflow from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowGraph as ApiGraph } from "@wise/api-schema";
import { abstract, type FlowGraph as LibraryGraph } from "@wise/flow";
import type { ProcessMapProps } from "@wise/flow/react";
import type { ModelViewProps } from "./ModelView";
import { validateFlowSearch } from "@/app/search";
import { activitiesAt } from "./frame";

vi.unmock("@/components/flow/FlowMap");
const renderer = vi.hoisted(() => ({ map: undefined as ProcessMapProps | undefined, model: undefined as ModelViewProps | undefined, scenes: undefined as LibraryGraph[] | undefined }));
vi.mock("@wise/flow/react", async () => ({
  ...await import("@xyflow/react"),
  useStableLayout: (scenes: LibraryGraph[]) => { renderer.scenes = scenes; return { status: "ready", positions: undefined }; },
  ProcessMap: (props: ProcessMapProps) => { renderer.map = props; return <div data-testid="count-map" />; },
}));
vi.mock("./ModelView", () => ({ default: (props: ModelViewProps) => { renderer.model = props; return <div data-testid="count-model" />; } }));
const state = vi.hoisted(() => ({
  viewport: vi.fn<(value: { x: number; y: number; zoom: number }, options: { duration: number }) => Promise<boolean>>(async () => true), centre: vi.fn(),
  selected: false,
}));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<typeof Xyflow>(),
  useNodesInitialized: () => true,
  useStore: () => 1,
  useReactFlow: () => ({
    getNodes: () => [{ id: "main", type: "activity", width: 280, height: 72, selected: state.selected, position: { x: 100, y: 100 }, data: { node: { metrics: { cases: 100 } } } }],
    getInternalNode: () => ({ internals: { positionAbsolute: { x: 1000, y: 800 } } }),
    setViewport: state.viewport, setCenter: state.centre,
    zoomTo: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(),
  }),
}));
import { FitToView, FlowMap, ZoomControls } from "./FlowMap";

const bounds = { x: 0, y: 0, width: 3000, height: 1600 };
const container = { current: document.createElement("div") };
beforeEach(() => {
  vi.useFakeTimers(); state.viewport.mockClear(); state.centre.mockClear(); state.selected = false;
  vi.spyOn(container.current, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 500 } as DOMRect);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("opens readable labels on an activity, then respects an explicit overview without late refits", async () => {
  const { rerender } = render(<><FitToView container={container} fitKey="full-names" bounds={bounds} readable /><ZoomControls container={container} bounds={bounds} /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(125); });
  expect(state.viewport).toHaveBeenLastCalledWith({ x: -640, y: -586, zoom: 1 }, { duration: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Fit overview" }));
  expect(state.viewport.mock.lastCall?.[0].zoom).toBeLessThan(1);
  expect(state.viewport).toHaveBeenCalledTimes(2);
  state.selected = true;
  rerender(<><FitToView container={container} fitKey="full-names" bounds={{ ...bounds }} readable /><ZoomControls container={container} bounds={bounds} /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(state.viewport).toHaveBeenCalledTimes(2);
});

it("centres readable size on the absolute position of a selected activity in a group", () => {
  state.selected = true;
  render(<ZoomControls container={container} bounds={bounds} />);
  fireEvent.click(screen.getByRole("button", { name: "Readable size" }));
  expect(state.centre).toHaveBeenCalledWith(1140, 836, { zoom: 1, duration: 0 });
});


it("honours a manual overview chosen before initial delayed fitting", async () => {
  const manualViewport = { current: undefined as string | undefined };
  render(<><FitToView container={container} fitKey="new-map" bounds={bounds} readable manualViewport={manualViewport} /><ZoomControls container={container} bounds={bounds} onViewportChange={() => { manualViewport.current = "new-map"; }} /></>);
  fireEvent.click(screen.getByRole("button", { name: "Fit overview" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(state.viewport).toHaveBeenCalledTimes(1);
  expect(state.viewport.mock.lastCall?.[0].zoom).toBeLessThan(1);
});

it("makes the square below minus fit exactly the same full displayed bounds as Fit overview", async () => {
  const manualViewport = { current: undefined as string | undefined };
  const displayedBounds = { ...bounds, x: -140, y: -90 };
  render(<><FitToView container={container} fitKey="square" bounds={displayedBounds} readable manualViewport={manualViewport} /><ZoomControls container={container} bounds={displayedBounds} onViewportChange={() => { manualViewport.current = "square"; }} /></>);
  const buttons = screen.getByTestId("zoom-controls").querySelectorAll("button");
  expect(buttons[2]).toHaveAccessibleName("Fit whole process");
  fireEvent.click(buttons[2]!);
  const squareViewport = state.viewport.mock.lastCall?.[0];
  expect(squareViewport?.zoom).toBeLessThan(1);
  expect(screen.queryByRole("button", { name: /Fill the window/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fit overview" }));
  expect(state.viewport.mock.lastCall?.[0]).toEqual(squareViewport);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(state.viewport).toHaveBeenCalledTimes(2);
  expect(state.centre).not.toHaveBeenCalled();
});

it("disables both overview actions while the displayed layout is unavailable", () => {
  render(<ZoomControls container={container} bounds={bounds} disabled />);
  expect(screen.getByRole("button", { name: "Fit whole process" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fit overview" })).toBeDisabled();
});


function countGraph(): ApiGraph {
  return {
    nodes: [
      { id: "start", kind: "event", label: "Start" },
      ...Array.from({ length: 42 }, (_, index) => ({ id: `a${String(index).padStart(2, "0")}`, kind: "activity", label: `Activity ${index}`, group: "stage", metrics: { cases: index < 9 ? 1000 - index * 100 : 1, events: 9999 } })),
      { id: "end", kind: "event", label: "End" },
    ],
    edges: [
      { id: "start-a", kind: "flow", source: "start", target: "a00" },
      ...Array.from({ length: 41 }, (_, index) => ({ id: `e${index}`, kind: "follows", source: `a${String(index).padStart(2, "0")}`, target: `a${String(index + 1).padStart(2, "0")}`, metrics: { cases: 1, count: 1 } })),
      { id: "rare-return", kind: "follows", source: "a41", target: "a00", metrics: { cases: 1, count: 1 } },
      { id: "loop", kind: "follows", source: "a00", target: "a00", metrics: { cases: 1, count: 99999 } },
    ],
    groups: [{ id: "stage", kind: "stage", label: "Recorded stage" }],
    meta: { cases: 1000, nodesTotal: 42 },
  } as unknown as ApiGraph;
}
const mapActivities = () => renderer.map!.graph.nodes.filter((node) => node.kind === "activity").map((node) => node.id);
const editCount = (value: string) => {
  const input = screen.getByRole("spinbutton", { name: "Number of activities" });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("exact activity controls", () => {
  it("moves 9 → 10 → 9 and one activity per keyboard step, with identical slider and count", () => {
    const onDetailChange = vi.fn();
    render(<FlowMap graph={countGraph()} title="Process" detail={3} onDetailChange={onDetailChange} />);
    const initial = mapActivities();
    expect(initial).toHaveLength(9);
    expect(screen.getByTestId("detail-label")).toHaveTextContent("9 of 42 activities");
    fireEvent.click(screen.getByRole("button", { name: "Show one more activity" }));
    expect(mapActivities()).toEqual([...initial, "a09"]);
    expect(screen.getByRole("spinbutton")).toHaveValue(10);
    expect(screen.getByRole("slider")).toHaveValue("10");
    fireEvent.click(screen.getByRole("button", { name: "Show one fewer activity" }));
    expect(mapActivities()).toEqual(initial);
    fireEvent.keyDown(screen.getByTestId("flow-map"), { key: "]" });
    expect(mapActivities()).toHaveLength(10);
    fireEvent.keyDown(screen.getByTestId("flow-map"), { key: "[" });
    expect(mapActivities()).toEqual(initial);
    expect(onDetailChange).not.toHaveBeenCalled();
  });
  it("clamps edits, tolerates a cleared field and retains every connection at maximum", () => {
    const graph = countGraph();
    render(<FlowMap graph={graph} title="Process" detail={3} />);
    editCount("");
    expect(mapActivities()).toHaveLength(9);
    editCount("-10");
    expect(mapActivities()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Show one fewer activity" })).toBeDisabled();
    editCount("5.7");
    expect(mapActivities()).toHaveLength(6);
    editCount("999");
    expect(mapActivities()).toHaveLength(42);
    expect(screen.getByRole("button", { name: "Show one more activity" })).toBeDisabled();
    expect(abstract(renderer.map!.graph, renderer.map!.abstraction).edges).toEqual(graph.edges);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "41" } });
    expect(mapActivities()).toHaveLength(41);
    expect(screen.getByRole("spinbutton")).toHaveValue(41);
  });
  it("retains the same subset through Map, Model and Table, including comparison", async () => {
    const graph = countGraph();
    const baseline = { ...graph, nodes: [...graph.nodes, { id: "baseline-only", kind: "activity" as const, label: "Other cohort", metrics: { cases: 99999 } }] };
    render(<FlowMap graph={graph} baseline={baseline} title="Process" detail={3} />);
    editCount("10");
    fireEvent.click(screen.getByRole("button", { name: "compare with everyone else" }));
    const ids = mapActivities();
    expect(ids).toHaveLength(10);
    expect(renderer.scenes?.every((scene) => !scene.nodes.some((node) => node.id === "baseline-only"))).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "model" })); });
    expect(screen.getByTestId("count-model")).toBeInTheDocument();
    expect(abstract(renderer.model!.scene, renderer.model!.abstraction).nodes.filter((node) => node.kind === "activity").map((node) => node.id)).toEqual(ids);
    fireEvent.click(screen.getByRole("button", { name: "Show one more activity" }));
    const modelIds = renderer.model!.scene.nodes.filter((node) => node.kind === "activity").map((node) => node.id);
    expect(modelIds).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "table" }));
    expect(mapActivities()).toEqual(modelIds);
    fireEvent.click(screen.getByRole("button", { name: "map" }));
    expect(mapActivities()).toEqual(modelIds);
  });
  it.each([0, 1, 2, 3, 4])("bootstraps legacy detail=%s links without treating levels as counts", (level) => {
    const graph = countGraph();
    const search = validateFlowSearch(Object.fromEntries(new URLSearchParams(`detail=${level}&render=map`)) as unknown as Parameters<typeof validateFlowSearch>[0]);
    render(<FlowMap graph={graph} title="Process" detail={search.detail} render={search.render} />);
    if (level === 0) {
      expect(screen.getByRole("button", { name: "Stages only" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("detail-label")).toHaveTextContent("1 stage");
      expect(renderer.map!.abstraction?.collapse).toBe("all");
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    } else {
      expect(mapActivities()).toEqual(activitiesAt(graph, level));
      expect(screen.getByRole("spinbutton")).toHaveValue(activitiesAt(graph, level).length);
    }
  });
  it("resets on a new legacy URL, while metadata never inflates the control's range", () => {
    const graph = countGraph();
    graph.meta = { nodesTotal: 999, cases: 1000 };
    const { rerender } = render(<FlowMap graph={graph} title="Process" detail={3} />);
    editCount("20");
    rerender(<FlowMap graph={graph} title="Process" detail={4} />);
    expect(mapActivities()).toHaveLength(42);
    rerender(<FlowMap graph={graph} title="Process" detail={3} />);
    expect(mapActivities()).toHaveLength(9);
    expect(screen.getByRole("slider")).toHaveAttribute("max", "42");
    expect(screen.getByTestId("incomplete-flow")).toBeInTheDocument();
  });
  it.each([0, 1])("handles a graph with %s activities at both boundaries", (total) => {
    const graph = countGraph();
    graph.nodes = graph.nodes.filter((node) => node.kind !== "activity" || (total === 1 && node.id === "a00"));
    graph.edges = [];
    render(<FlowMap graph={graph} title="Process" detail={4} />);
    expect(mapActivities()).toHaveLength(total);
    expect(screen.getByRole("spinbutton")).toHaveValue(total);
    expect(screen.getByRole("button", { name: "Show one fewer activity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show one more activity" })).toBeDisabled();
    expect(screen.getByRole("slider")).toBeDisabled();
  });
});


it("keeps multiple selected results and overlays across all renderers without changing layout or fit", async () => {
  const graph = countGraph();
  graph.meta = { cases: 1000, constraints: [
    { description: { id: "chronology", label: "Invoice follows purchase order", layer: "L1_order" }, stats: { evaluated: 20, violationShare: 0.5 } },
    { description: { id: "receipt", label: "Single receipt", layer: "L1_order" }, stats: { evaluated: 8, violationShare: 0.25 } },
    { description: { id: "case-only", label: "Business completion", layer: "L1_order" }, stats: { evaluated: 400, violationShare: 0.1 } },
  ] };
  graph.overlays = [
    { kind: "arc", target: "chronology-rule", payload: { constraintId: "chronology", source: "a00", target: "a01" } },
    { kind: "badge", target: "a02", payload: { constraintId: "receipt" } },
  ];
  render(<FlowMap graph={graph} title="Process" detail={4} frame="page" className="min-h-0 flex-1" />);
  expect(screen.getByTestId("map-frame")).toHaveStyle({ minHeight: "400px" });
  expect(screen.getByTestId("flow-map")).toHaveClass("overflow-y-auto");
  expect(screen.getByTestId("flow-map")).toHaveStyle({ scrollbarGutter: "stable" });
  const layoutBefore = renderer.scenes;
  const fitKey = () => (renderer.map!.children as { props?: { fitKey?: string } }[]).find((child) => child?.props?.fitKey)?.props?.fitKey;
  const fitBefore = fitKey();
  fireEvent.click(screen.getByRole("checkbox", { name: "WISE evidence" }));
  expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 3 constraints");
  fireEvent.click(screen.getByRole("button", { name: "Choose constraints" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Business layer" }), { target: { value: "L1_order" } });
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Choose constraints" }), { key: "Escape" });
  expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 3 of 3 constraints");
  const rows = within(screen.getByRole("region", { name: "Selected constraint results" }));
  expect(rows.getByText("50.0% miss this constraint · 20 evaluated cases")).toBeInTheDocument();
  expect(rows.getByText("25.0% miss this constraint · 8 evaluated cases")).toBeInTheDocument();
  expect(rows.getByText("10.0% miss this constraint · 400 evaluated cases")).toBeInTheDocument();
  expect(rows.getByText("Case result only; no map anchor")).toBeInTheDocument();
  fireEvent.click(rows.getByRole("button", { name: /Business completion/ }));
  expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("10.0% miss this constraint · 400 evaluated cases");
  expect(screen.getAllByRole("region", { name: "Selected constraint result" })).toHaveLength(1);
  expect(renderer.scenes).toBe(layoutBefore);
  expect(fitKey()).toBe(fitBefore);
  expect(screen.getByTestId("map-frame")).toHaveStyle({ minHeight: "400px" });
  const overlays = renderer.map!.graph.overlays;
  expect(overlays?.map((overlay) => overlay.payload?.constraintId).sort()).toEqual(["chronology", "receipt"]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "model" })); });
  expect(renderer.model!.overlays).toEqual(overlays);
  fireEvent.click(screen.getByRole("button", { name: "table" }));
  expect(renderer.map!.graph.overlays).toEqual(overlays);
  expect(screen.getByRole("region", { name: "Selected constraint results" })).toBeInTheDocument();
  expect(renderer.scenes).toBe(layoutBefore);
  fireEvent.click(screen.getByRole("button", { name: "Choose constraints" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Choose constraints" }), { key: "Escape" });
  expect(renderer.map!.graph.overlays).toEqual([]);
  expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 0 of 3 constraints");
  expect(screen.getByText(/No constraints selected/)).toBeInTheDocument();
});


it("gives full-window Map and Model a scrollable 400px minimum drawing even from a short panel", async () => {
  render(<FlowMap graph={countGraph()} title="Process" detail={4} height={260} full />);
  expect(screen.getByTestId("flow-map")).toHaveClass("overflow-y-auto");
  expect(screen.getByTestId("map-frame")).toHaveStyle({ minHeight: "400px" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "model" })); });
  expect(renderer.model!.height).toBe(400);
  expect(screen.getByTestId("map-frame")).toHaveStyle({ minHeight: "400px" });
});
