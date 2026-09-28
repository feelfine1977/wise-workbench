import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph as ApiGraph } from "@wise/api-schema";
import { abstract, type FlowGraph } from "@wise/flow";
import type { ProcessMapProps } from "@wise/flow/react";

vi.unmock("@/components/flow/FlowMap");
const renderer = vi.hoisted(() => ({ props: undefined as ProcessMapProps | undefined, scenes: undefined as FlowGraph[] | undefined }));
vi.mock("@wise/flow/react", () => ({
  useStableLayout: (scenes: FlowGraph[]) => {
    renderer.scenes = scenes;
    return { positions: undefined, status: "ready" };
  },
  // Match the renderer's documented additive contract, so double delivery fails visibly.
  ProcessMap: (props: ProcessMapProps) => {
    renderer.props = props;
    return <div data-testid="rendered-evidence">{JSON.stringify([...(props.graph.overlays ?? []), ...(props.overlays ?? [])])}</div>;
  },
}));
import { FlowMap } from "./FlowMap";

function fixture(): ApiGraph {
  return {
    nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity", label: `Activity ${id}`, metrics: { cases: 100 } })),
    edges: [
      { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 10, cases: 10 } },
      { id: "bc", kind: "flow", source: "b", target: "c", metrics: { count: 10, cases: 10 } },
      { id: "aa", kind: "follows", source: "a", target: "a", metrics: { count: 139000, cases: 15000 } },
      { id: "constraint-edge", kind: "constraint", source: "a", target: "c" },
    ],
    overlays: [
      { kind: "arc", target: "constraint-edge", payload: { constraintId: "c1", source: "a", target: "c", value: 0.5 } },
      { kind: "badge", target: "b", payload: { constraintId: "c2", value: 0.25 } },
    ],
    meta: { cases: 100, constraints: [
      { description: { id: "c1", label: "Invoice chronology", description: "The invoice must be recorded after its purchase order." }, stats: { evaluated: 20, violationShare: 0.5 } },
      { description: { id: "c2", label: "Single receipt", description: "At most one receipt is recorded." }, stats: { evaluated: 8, violationShare: 0.25 } },
      { description: { id: "c3", label: "Unmapped business activity", description: "An approval activity must be recorded." }, stats: { evaluated: 0, violationShare: 1 } },
    ] },
  } as unknown as ApiGraph;
}
const props = () => renderer.props!;
const rendered = () => JSON.parse(screen.getByTestId("rendered-evidence").textContent ?? "[]") as { kind: string; payload: { constraintId?: string; value?: number }; target: string }[];

beforeEach(() => { renderer.props = undefined; renderer.scenes = undefined; });

describe("FlowMap evidence controls", () => {
  it("shows the live case-level result without inventing map anchors or a dashboard score", async () => {
    const graph = fixture();
    graph.overlays = [];
    graph.meta = { cases: 251734, constraints: [
      { description: { id: "manual", type: "metric", layer: "L7_effort_automation", description: "High manual share indicates low straight-through processing.", params: { threshold: 0.5, width: 0.5, unit: "manual_share", direction: "high" } }, stats: { cases: 251734, evaluated: 251734, violationShare: 0.9208926883138551, meanViolation: 0.5355611067153059 } },
      ...Array.from({ length: 41 }, (_, i) => ({ description: { id: `other-${i}` }, stats: {} })),
    ] };
    const before = structuredClone(graph);
    render(<FlowMap graph={graph} title="Process" detail={4} initialEvidenceMode="wise" />);
    expect(screen.getByTestId("constraint-result")).toHaveTextContent("High manual share indicates low straight-through processing.");
    expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 42 constraints");
    expect(screen.getByRole("region", { name: "Selected constraint result" })).toHaveTextContent("High manual share indicates low straight-through processing.");
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("92.1% miss this constraint · 251,734 evaluated cases");
    expect(screen.queryByTestId("constraint-mean")).not.toBeInTheDocument();
    expect(screen.getByTestId("constraint-coverage")).toHaveTextContent("100.0% evaluation coverage");
    expect(screen.getByTestId("constraint-placement")).toHaveTextContent("Case result only; no map anchor");
    expect(screen.getByTestId("constraint-rule")).toHaveTextContent("manual_share ≤ 0.500");
    expect(rendered()).toEqual([]);
    expect(graph).toEqual(before);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Meaning and coverage" }));
    expect(screen.getByTestId("constraint-mean")).toHaveTextContent("Mean violation: 0.536 / 1");
    expect(screen.getByTestId("constraint-full-coverage")).toHaveTextContent("251,734 of 251,734 cases");
    expect(screen.getByText(/Overall dashboard scores/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    fireEvent.click(screen.getByTestId("full-window"));
    expect(screen.getByRole("dialog", { name: "Process — full window" })).toBeInTheDocument();
  });

  it("shows the supplied time target and graded tolerance without calling a WISE arc a path share", async () => {
    const user = userEvent.setup();
    const graph = fixture();
    graph.meta = { cases: 251734, constraints: [{ description: { id: "c1", type: "lag", description: "Invoice recording to clearing interval.", params: { threshold: 30, width: 60, unit: "D" } }, stats: { evaluated: 173183, violationShare: 0.6285432172903807 } }] };
    // A raw visual value must not override the evaluated WISE result.
    graph.overlays = [{ kind: "arc", target: "constraint-edge", payload: { constraintId: "c1", source: "a", target: "c", value: 0.99 } }];
    render(<FlowMap graph={graph} title="Process" detail={4} initialEvidenceMode="wise" />);
    expect(screen.getByTestId("constraint-rule")).toHaveTextContent("within 30 calendar days");
    expect(screen.getByTestId("constraint-rule")).toHaveTextContent("full penalty at 90 calendar days");
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("62.9% miss this constraint · 173,183 evaluated cases");
    expect(screen.getByTestId("constraint-placement")).toHaveTextContent("not a path share");
    expect(props().graph.overlays?.[0]?.payload?.displayLabel).toBe("62.9% miss constraint");
    await user.click(screen.getByRole("button", { name: "Meaning and coverage" }));
    expect(screen.getByText(/Missing-endpoint and repeated-activation policies are not supplied/)).toBeInTheDocument();
    expect(screen.getByText(/Graded tolerance: 60 calendar days/)).toBeInTheDocument();
  });

  it("uses the current filtered scene denominator and distinguishes hidden overlays from absent anchors", async () => {
    const graph = fixture();
    graph.meta = { cases: 10, constraints: [{ description: { id: "c1", label: "Filtered rule" }, stats: { evaluated: 4, violationShare: 0.5 } }] };
    render(<FlowMap graph={graph} title="Process" detail={4} counts={{ casesIn: 10, casesTotal: 251734 }} initialEvidenceMode="wise" legendOpen />);
    expect(screen.getByTestId("constraint-coverage")).toHaveTextContent("40.0% evaluation coverage");
    fireEvent.click(screen.getByRole("button", { name: /WISE arc:/ }));
    expect(screen.getByTestId("constraint-placement")).toHaveTextContent("Map overlays hidden; case result shown");
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("50.0% miss this constraint · 4 evaluated cases");
    expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 2 constraints");
    await userEvent.setup().click(screen.getByRole("button", { name: "Meaning and coverage" }));
    expect(screen.getByTestId("constraint-full-coverage")).toHaveTextContent("4 of 10 cases in the current selection");
  });

  it("does not turn an unknown or inconsistent denominator into compliance", () => {
    const graph = fixture();
    graph.meta = { cases: 2, constraints: [{ description: { id: "c1" }, stats: { evaluated: 8, violationShare: 0, meanViolation: 0 } }] };
    render(<FlowMap graph={graph} title="Process" detail={4} initialEvidenceMode="wise" initialConstraintId="c1" />);
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("WISE result unavailable");
    expect(screen.getByTestId("constraint-denominator")).not.toHaveTextContent("0.0%");
    expect(screen.getByTestId("constraint-coverage")).toHaveTextContent("Coverage unavailable");
    expect(props().graph.overlays?.[0]?.payload?.displayLabel).toBe("WISE result unavailable");
  });

  it("never gives the renderer aggregate violation metrics, including with one constraint selected", () => {
    const graph = fixture();
    graph.nodes[0]!.metrics = { cases: 100, events: 180, violationShare: 0.52 };
    graph.edges[0]!.metrics = { count: 1000, cases: 1000, medianLagHours: 24, violationShare: 0.62 };
    const before = structuredClone(graph);
    render(<FlowMap graph={graph} baseline={graph} title="Process" detail={4} />);
    const assertObserved = () => {
      expect(props().graph.nodes[0]?.metrics).toEqual({ cases: 100, events: 180 });
      expect(props().graph.edges.find((e) => e.id === "ab")?.metrics).toEqual({ count: 1000, cases: 1000, medianLagHours: 24 });
      expect(renderer.scenes?.every((s) => [...s.nodes, ...s.edges].every((item) => item.metrics?.violationShare === undefined))).toBe(true);
    };
    assertObserved();
    fireEvent.click(screen.getByLabelText("WISE evidence"));
    assertObserved();
    expect(rendered()[0]?.payload).toMatchObject({ constraintId: "c1", value: 0.5 });
    expect(graph).toEqual(before);
  });

  it("defaults to recorded routes with no evidence, retaining observed self-loops and host fitting", () => {
    render(<FlowMap graph={fixture()} title="Process" detail={4} highlight={["a", "b"]} />);
    expect(screen.getByLabelText("WISE evidence")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Choose constraints" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("evidence-count")).not.toBeInTheDocument();
    expect(screen.getByText("Recorded process")).toBeInTheDocument();
    expect(rendered()).toEqual([]);
    expect(props().overlays).toBeUndefined();
    expect(props().fitView).toBe(false);
    expect(props().graph.edges.some((e) => e.source === e.target)).toBe(true);
    expect(props().style?.edgeWidth?.metric).toBe("count");
    expect(props().style?.edgeColor).toBeUndefined();
    expect(renderer.scenes?.every((s) => s.edges.every((e) => e.kind === "follows" || e.kind === "flow") && !s.overlays?.length)).toBe(true);
    expect(screen.getByTestId("process-map-semantics")).toHaveTextContent("Start/end: first/last recorded event.");
  });

  it("delivers exactly one chosen constraint once, with stable layout inputs and keyboard-accessible meaning", async () => {
    const user = userEvent.setup();
    render(<FlowMap graph={fixture()} title="Process" detail={4} />);
    const layoutBefore = renderer.scenes;
    const semanticsBefore = screen.getByTestId("process-map-semantics").textContent;
    await user.click(screen.getByLabelText("WISE evidence"));
    expect(screen.getByTestId("process-map-semantics")).toHaveTextContent(semanticsBefore!);
    expect(screen.getByTestId("constraint-result")).toHaveTextContent("Invoice chronology");
    expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 3 constraints");
    expect(rendered()).toHaveLength(1);
    expect(rendered()[0]?.payload.constraintId).toBe("c1");
    expect(props().overlays).toBeUndefined();
    expect(props().graph.edges.some((e) => e.kind === "constraint")).toBe(false);
    expect(renderer.scenes).toBe(layoutBefore);
    expect(props().fitView).toBe(false);
    const disclosure = screen.getByRole("button", { name: "Meaning and coverage" });
    disclosure.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("constraint-meaning")).toHaveTextContent("The invoice must be recorded after its purchase order.");
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent(/50.*20 evaluated cases/);
    expect(screen.getByText(/they do not establish business completion/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(disclosure).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Choose constraints" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("checkbox", { name: "Single receipt" }));
    await user.keyboard("{Escape}");
    expect(rendered()).toHaveLength(1);
    expect(rendered()[0]?.payload.constraintId).toBe("c2");
    expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 3 constraints");
    await user.click(screen.getByLabelText("WISE evidence"));
    expect(rendered()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Meaning and coverage" })).not.toBeInTheDocument();
  });

  it("keeps unmapped business constraints selectable without presenting zero evaluation as compliance", async () => {
    const user = userEvent.setup();
    render(<FlowMap graph={fixture()} title="Process" detail={4} initialEvidenceMode="wise" initialConstraintId="c3" />);
    expect(rendered()).toEqual([]);
    expect(screen.getByTestId("evidence-count")).toHaveTextContent("Selected 1 of 3 constraints");
    await user.click(screen.getByRole("button", { name: "Meaning and coverage" }));
    expect(screen.getByTestId("constraint-denominator")).toHaveTextContent("No evaluated cases in this selection; compliance is unknown.");
    expect(screen.getByTestId("constraint-placement")).toHaveTextContent("no map anchor");
  });

  it("confines contextual driver highlighting to the selected constraint and keeps loops in compact maps", () => {
    const { unmount } = render(<FlowMap graph={fixture()} title="Process" detail={4} initialEvidenceMode="wise" highlight={["a", "b"]} />);
    const tints = rendered().filter((o) => o.kind === "tint");
    expect(tints).toHaveLength(1);
    expect(tints[0]).toMatchObject({ target: "a", payload: { constraintId: "c1", value: 0.5 } });
    unmount();
    render(<FlowMap graph={fixture()} title="Process" detail={4} compact />);
    expect(rendered()).toEqual([]);
    expect(props().selfLoops).toBe(true);
    expect(props().lod?.selfLoops).toBe(0);
    expect(props().fitView).toBe(false);
    expect(props().overlays).toBeUndefined();
  });

  it("guards stale constraint-edge selections and actions while preserving directly-follows filtering", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FlowMap graph={fixture()} title="Process" detail={4} onFilterChange={onFilterChange} />);
    act(() => props().onSelect?.({ nodes: [], edges: ["constraint-edge"], groups: [] }));
    expect(screen.queryByRole("button", { name: "Filter to items with this connection" })).not.toBeInTheDocument();
    act(() => props().onAction?.({ id: "filter-to", label: "Filter", group: "filter", clause: { kind: "follows", a: "a", b: "c", directly: true } }, { kind: "edge", edgeKind: "constraint", id: "constraint-edge", ids: ["constraint-edge"], label: "Rule" }));
    expect(onFilterChange).not.toHaveBeenCalled();
    act(() => props().onSelect?.({ nodes: [], edges: ["ab"], groups: [] }));
    await user.click(screen.getByRole("button", { name: "Filter to items with this connection" }));
    expect(onFilterChange).toHaveBeenCalledWith({ and: [{ kind: "follows", a: "Activity a", b: "Activity b", directly: true }] });
  });

  it("uses cases before occurrences when reporting paths hidden at the current detail", () => {
    const graph = fixture();
    graph.edges[0]!.metrics = { count: 3000, cases: 3000 };
    render(<FlowMap graph={graph} title="Process" detail={2} render="table" focus="a" paths={{ outgoing: [{ node: "b", cases: 3000, count: 3000 }], incoming: [] }} />);
    expect(screen.queryByTestId("paths-hidden")).not.toBeInTheDocument();
  });

  it("can re-enable a hidden evidence kind and disables evidence when none is supplied", () => {
    const { unmount } = render(<FlowMap graph={fixture()} title="Process" detail={4} initialEvidenceMode="wise" legendOpen />);
    fireEvent.click(screen.getByRole("button", { name: /WISE arc:/ }));
    expect(rendered()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /WISE arc:/ }));
    expect(rendered()).toHaveLength(1);
    unmount();
    const graph = fixture();
    graph.overlays = [];
    graph.meta = {};
    render(<FlowMap graph={graph} title="Process" detail={4} />);
    expect(screen.getByLabelText("WISE evidence")).toBeDisabled();
  });
});


describe("FlowMap complete detail", () => {
  it("does not threshold a prepared graph a second time in the renderer", () => {
    const graph = fixture();
    graph.edges = [
      { id: "ac", kind: "follows", source: "a", target: "c", metrics: { cases: 100, count: 100 } },
      { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 3, count: 3 } },
      { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 2, count: 2 } },
    ];
    render(<FlowMap graph={graph} title="Process" detail={1} />);
    expect(props().abstraction).toMatchObject({ minNodeShare: 0, minEdgeShare: 0, keepConnected: false });
    expect(abstract(props().graph, props().abstraction).edges).toEqual(props().graph.edges);
    expect(props().graph.edges.map((e) => e.id)).toEqual(["ac", "ab", "bc"]);
  });

  it("offers all activities and connections at maximum detail instead of silently capping them", () => {
    const graph = fixture();
    graph.nodes[2]!.metrics = { cases: 1 };
    graph.edges = [
      { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 100, count: 100 } },
      { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 1, count: 1 } },
    ];
    graph.meta = { cases: 100, nodesTotal: 3, abstraction: 0 };
    render(<FlowMap graph={graph} title="Process" detail={4} />);
    expect(screen.getByTestId("detail-label")).toHaveTextContent("all activities and connections · 3 of 3 activities");
    expect(props().graph.nodes).toHaveLength(3);
    expect(abstract(props().graph, props().abstraction).edges).toEqual(graph.edges);
  });

  it("discloses a server-pruned graph instead of claiming maximum detail restores absent data", () => {
    const graph = fixture();
    graph.meta = { cases: 100, nodesTotal: 15, abstraction: 0.05 };
    render(<FlowMap graph={graph} title="Process" detail={4} />);
    expect(screen.getByTestId("incomplete-flow")).toHaveTextContent("The supplied graph is simplified; some recorded activities or connections are unavailable.");
  });
});


it("counts locally hidden connections from the prepared scene while keeping restored connections visible", () => {
  const graph = fixture();
  graph.nodes.push({ id: "rare", kind: "activity", label: "Rare", metrics: { cases: 1 } });
  graph.edges = [
    { id: "ac", kind: "follows", source: "a", target: "c", metrics: { cases: 100, count: 100 } },
    { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 3, count: 3 } },
    { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 2, count: 2 } },
    { id: "ar", kind: "follows", source: "a", target: "rare", metrics: { cases: 1, count: 1 } },
  ];
  graph.meta = { cases: 100, nodesTotal: 4, abstraction: 0, pathsHidden: 0 };
  render(<FlowMap graph={graph} title="Process" detail={1} render="table" focus="a" paths={{ outgoing: [{ node: "b", cases: 3, count: 3 }, { node: "rare", cases: 1, count: 1 }], incoming: [] }} />);
  expect(screen.getByTestId("paths-hidden")).toHaveTextContent("1 path is below this detail level.");
});

describe("activity label controls", () => {
  it("inspects a hidden activity without changing detail or filtering the Board", async () => {
    const user = userEvent.setup();
    const graph = fixture();
    graph.nodes.push({ id: "rare", kind: "activity", label: "Rare activity", metrics: { cases: 1 } });
    graph.meta = { ...graph.meta, nodesTotal: 4 };
    const onFilterChange = vi.fn();
    const onDetailChange = vi.fn();
    render(<FlowMap graph={graph} title="Process" detail={1} clickFilters onFilterChange={onFilterChange} onDetailChange={onDetailChange} />);
    const before = props().graph;
    await user.click(screen.getByRole("button", { name: "Activity key" }));
    await user.click(screen.getByRole("button", { name: /A\d+ Rare activity/ }));
    expect(screen.getByTestId("selected-activity")).toHaveTextContent("Rare activity");
    expect(props().graph).toEqual(before);
    expect(onDetailChange).not.toHaveBeenCalled();
    expect(onFilterChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Show on map at full detail" }));
    expect(onDetailChange).toHaveBeenCalledWith(4);
  });
  it("changes display only, with a searchable key, exact identity and counts", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    const graph = fixture();
    graph.nodes[0]!.label = "Change Price";
    graph.nodes[0]!.metrics = { cases: 41, events: 42 };
    graph.nodes[1]!.label = "Change Quantity";
    graph.nodes[1]!.metrics = { cases: 1136, events: 1343 };
    const before = structuredClone(graph);
    render(<FlowMap graph={graph} title="Recorded process" detail={4} clickFilters onFilterChange={onFilterChange} />);
    expect(props().activityLabels?.mode).toBe("names");
    const topology = props().graph.edges;
    await user.click(screen.getByRole("button", { name: "IDs + key" }));
    expect(props().activityLabels?.mode).toBe("ids");
    expect(props().graph.edges).toEqual(topology);
    const key = screen.getByRole("complementary", { name: "Activity key" });
    expect(key).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Find an activity in the key" }), "price");
    expect(screen.getByText("1 of 3 activities in this scope")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /A\d+ Change Price 41 cases/ }));
    expect(screen.getByTestId("selected-activity")).toHaveTextContent("Change Price");
    expect(screen.getByTestId("selected-activity")).toHaveTextContent("42 events");
    await user.click(screen.getByLabelText("Item counts"));
    expect(props().activityLabels?.showCounts).toBe(false);
    expect(props().graph.edges).toEqual(topology);
    expect(graph).toEqual(before);
    expect(onFilterChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close activity key" }));
    expect(screen.getByRole("button", { name: "Activity key" })).toHaveFocus();
  });
});
