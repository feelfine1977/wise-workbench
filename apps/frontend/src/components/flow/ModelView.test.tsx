import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlowGraph } from "@wise/flow";
vi.mock("@wise/flow/react", () => ({ BpmnView: ({ xml }: { xml?: string }) => <div data-testid="bpmn-xml">{xml}</div> }));
import ModelView from "./ModelView";
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
}
const graph = { nodes: [{ id: "a", kind: "activity", label: "Approve" }], edges: [] } satisfies FlowGraph;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); WorkerStub.instances = []; });
it("exports in a worker and cancels obsolete scenes without replacing the latest model", () => {
  vi.stubGlobal("Worker", WorkerStub);
  const { rerender, unmount } = render(<ModelView scene={graph} graph={graph} height={400} />);
  expect(screen.getByRole("status").textContent).toContain("Arranging");
  const first = WorkerStub.instances[0]!;
  expect(first.postMessage).toHaveBeenCalled();
  const next = { ...graph, nodes: [...graph.nodes, { id: "b", kind: "activity" as const, label: "Pay" }] };
  rerender(<ModelView scene={next} graph={next} height={400} />);
  expect(first.terminate).toHaveBeenCalled();
  act(() => { first.onmessage?.({ data: { xml: "obsolete" } } as MessageEvent); });
  expect(screen.queryByTestId("bpmn-xml")).toBeNull();
  const current = WorkerStub.instances[1]!;
  act(() => { current.onmessage?.({ data: { xml: "current diagram" } } as MessageEvent); });
  expect(screen.getByTestId("bpmn-xml").textContent).toBe("current diagram");
  expect(current.terminate).toHaveBeenCalled();
  rerender(<ModelView scene={next} graph={next} height={400} selected="b" overlays={[]} />);
  expect(WorkerStub.instances).toHaveLength(2);
  unmount();
  expect(current.terminate).toHaveBeenCalledTimes(2);
});
it("shows a generation failure instead of leaving a loading indicator", () => {
  vi.stubGlobal("Worker", WorkerStub);
  render(<ModelView scene={graph} graph={graph} height={400} />);
  act(() => { WorkerStub.instances[0]!.onmessage?.({ data: { error: "No safe route" } } as MessageEvent); });
  expect(screen.getByRole("alert").textContent).toContain("No safe route");
  expect(screen.queryByRole("status")).toBeNull();
});
