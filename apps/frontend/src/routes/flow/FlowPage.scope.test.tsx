import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { FlowGraph } from "@wise/api-schema";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";
import { flowQuery } from "@/lib/queries";
import { flowFocusedQuery } from "@/lib/api/flow";
import { clauseForValue } from "@/lib/filter";

// Exercise the real route, context, queries and response graph, without a canvas worker.
vi.mock("@/components/flow/FlowMap", async () => {
  const { useWorkbench } = await import("@/app/context");
  const FlowMap = ({ graph }: { graph: FlowGraph }) => {
    const ctx = useWorkbench();
    return <div data-testid="flow-map">
      <p data-testid="graph-activities">{graph.nodes.map((node) => node.label).join(" · ")}</p>
      <p data-testid="route-context">{ctx.runId} | {ctx.view} | {ctx.slicing}</p>
      <button onClick={() => ctx.navigateRun("scope-df1")}>Select DF1 scope</button>
      <button onClick={() => ctx.navigateRun("scope-consignment")}>Select Consignment scope</button>
    </div>;
  };
  return { FlowMap, default: FlowMap, MiniMap: FlowMap, toLibraryGraph: (graph: FlowGraph) => graph };
});

describe("flow scope reaches the graph query", () => {
  it("changes fetched graph data when scope changes, staying on Flow with compatible context", async () => {
    const parent = db.runs.find((run) => run.id === "run_41")!;
    db.runs.push(
      { ...parent, id: "scope-consignment", scope: { flow_type: "Consignment" } },
      { ...parent, id: "scope-df1", scope: { flow_type: "DF1" } },
    );
    const requests: { run: string; filter: string | null; focus: string | null }[] = [];
    server.use(http.get("*/api/v1/projects/p2p2018/runs/:runId/flow", ({ params, request }) => {
      const query = new URL(request.url).searchParams;
      const run = String(params.runId);
      requests.push({ run, filter: query.get("filter"), focus: query.get("focus") });
      const cases = run === "scope-df1" ? 15182 : 14498;
      const label = run === "scope-df1" ? "Record Service Entry Sheet" : "Consignment goods receipt";
      return HttpResponse.json({ nodes: [{ id: "activity", kind: "activity", label, metrics: { cases } }], edges: [], meta: { cases, events: cases * 2 } });
    }));
    const slicing = 'group:{"attributes":["case Vendor"],"bands":[]}';
    const filter = JSON.stringify({ and: [clauseForValue("flow_type", "Consignment")] });
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/scope-consignment/flow?view=Automation&slicing=${encodeURIComponent(slicing)}&filter=${encodeURIComponent(filter)}&activity=old-activity&sel=activity:old-activity&detail=3&render=map`);
    expect(await screen.findByTestId("graph-activities", {}, { timeout: 8000 })).toHaveTextContent("Consignment goods receipt");
    await user.click(screen.getByRole("button", { name: "Select DF1 scope" }));
    await waitFor(() => expect(screen.getByTestId("graph-activities")).toHaveTextContent("Record Service Entry Sheet"));
    expect(screen.getByTestId("flow-step")).toHaveTextContent("DF1 flow only");
    expect(screen.getByTestId("route-context")).toHaveTextContent(`scope-df1 | Automation | ${slicing}`);
    expect(requests.filter((r) => r.run === "scope-df1")).toEqual([{ run: "scope-df1", filter: null, focus: null }]);
    await user.click(screen.getByRole("button", { name: "Select Consignment scope" }));
    await waitFor(() => expect(screen.getByTestId("graph-activities")).toHaveTextContent("Consignment goods receipt"));
    expect(requests.some((r) => r.run === "scope-consignment" && r.filter === null && r.focus === null)).toBe(true);
  });

  it("separates run and filter identity in both base and focused flow caches", () => {
    expect(flowQuery("p", "df1").queryKey).not.toEqual(flowQuery("p", "df2").queryKey);
    expect(flowQuery("p", "df1", { filter: "selected" }).queryKey).not.toEqual(flowQuery("p", "df1").queryKey);
    expect(flowFocusedQuery("p", "df1", { focus: "a" }).queryKey).not.toEqual(flowFocusedQuery("p", "df2", { focus: "a" }).queryKey);
  });
});
