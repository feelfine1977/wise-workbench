import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { analysisKey, draftFromSelection, useAnalysisSelection } from "@/lib/stores/analysisSelection";
import { server } from "@/mocks/node";

const T = { timeout: 8000 };

beforeEach(() => server.use(http.get("*/api/v1/projects/p2p2018/dataset-binding", () => HttpResponse.json({ projectId: "p2p2018", datasetId: "ds_1", boundAt: "2026-09-27T00:00:00Z" }))));

describe("your process: the flow-type fork (R2-O7, R2-O10)", () => {
  it("opens the newest completed compatible flow run regardless of API order or a pending rerun", async () => {
    const parent = db.runs.find((run) => run.id === "run_41")!;
    db.runs.push(
      { ...parent, id: "df1-pending", status: "running", createdAt: "2026-09-27T12:00:00Z", scope: { flow_type: "DF1" } },
      { ...parent, id: "df1-old", createdAt: "2026-09-25T12:00:00Z", scope: { flow_type: "DF1" } },
      { ...parent, id: "df1-new", createdAt: "2026-09-26T12:00:00Z", scope: { flow_type: "DF1" } },
      { ...parent, id: "df1-other-norm", normVersionId: "other", createdAt: "2026-09-28T12:00:00Z", scope: { flow_type: "DF1" } },
    );
    const requested: string[] = [];
    server.use(http.get("*/api/v1/projects/p2p2018/runs/:runId/flow", ({ params }) => {
      requested.push(String(params.runId));
      return HttpResponse.json({ nodes: [{ id: "a", kind: "activity", label: "Scoped activity", metrics: { cases: 10 } }], edges: [], meta: { cases: 10 } });
    }));
    const user = userEvent.setup();
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    await user.click(await screen.findByRole("button", { name: "Open the map of the DF1 flow" }, T));
    await screen.findByTestId("flow-step");
    await waitFor(() => expect(requested).toEqual(["df1-new"]));
  });

  it("shows one card per flow type with counts, an aligned comparison and the choice of the analysis path", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    const list = await screen.findByRole("list", { name: "Flow types" }, T);
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent(/DF2/);
    expect(cards[0]).toHaveTextContent(/221,010 purchase order items · 88\s?%/);
    expect(screen.queryByTestId("mini-map")).not.toBeInTheDocument();
    expect(await screen.findByTestId("flow-type-comparison", {}, T)).toHaveTextContent("What actually differs?");
    expect(within(cards[0] as HTMLElement).getByRole("button", { name: "Common process paths" })).toBeEnabled();
    expect(cards[0]).toHaveTextContent(/14\s?% flagged as potentially incomplete/);
    expect(screen.getByTestId("your-process")).toHaveTextContent(/Compare 4 flow types by flow type; DF2 contains 88\s?% of the 251,734 purchase order items/);
    const fork = screen.getByTestId("flow-fork");
    expect(within(fork).getByRole("link", { name: "Compare everything together" })).toHaveAttribute("href", expect.stringContaining("/runs/run_41/backlog"));
    expect(within(fork).getByRole("button", { name: "Analyse per flow type" })).toBeEnabled();
  });

  it("forking creates one scoped run per flow type; the ribbon gains the flow-type switcher when they are done", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    await screen.findByRole("list", { name: "Flow types" }, T);
    await user.click(screen.getByRole("button", { name: "Analyse per flow type" }));
    const tray = await screen.findByRole("region", { name: "Jobs" }, T);
    await waitFor(() => expect(within(tray).getAllByText(/^Score (DF2|DF1|Consignment|2-way)/).length).toBe(4), T);
    // Both the status badge and the progress message say "done". Check each job
    // instead of a transient label count that can pass with only two jobs finished.
    await waitFor(() => {
      const jobs = within(tray).getAllByRole("listitem");
      expect(jobs).toHaveLength(4);
      for (const job of jobs) expect(job).toHaveAttribute("data-job-status", "done");
    }, T);
    await waitFor(() => expect(screen.getByText("Every flow type has its run")).toBeInTheDocument(), T);
    // the Data step's ribbon shows project and dataset only; the scope switcher belongs to the Signals step
    expect(screen.queryByRole("combobox", { name: "Switch scope" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("list", { name: "Flow types" })).getAllByRole("button", { name: /Analyse the .* flow|Open this flow/ })[0]!);
    await waitFor(() => expect(screen.getByRole("list", { name: "Signals" })).toBeInTheDocument(), T);
    expect(screen.getByText(/Signals · DF2 flow only/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Switch scope" })).toHaveTextContent("DF2 only"), T);
  });

  it("the run page compares the flow types side by side for a run without scope", async () => {
    renderApp("/p/p2p2018/runs/run_41?tab=compare");
    const section = await screen.findByTestId("compare-flow-types", {}, T);
    expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["DF2", "DF1", "Consignment", "2-way"]);
    expect(section).toHaveTextContent(/points against everyone/);
    expect(section).toHaveTextContent(/no run of its own yet/);
  });
  it("every card retains data coverage and scoped access to the full map and exact paths", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
    const list = await screen.findByRole("list", { name: "Flow types" }, T);
    const cards = within(list).getAllByRole("listitem") as HTMLElement[];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: /Open the map of/ })).toBeEnabled();
      expect(within(card).getByRole("button", { name: "Common process paths" })).toBeEnabled();
      // and the sub-line says what the flow type is, in full: clamping it cut every card of the extract
      // mid-number
      const sub = [...card.querySelectorAll("p")].find((p) => /purchase order items \(/.test(p.textContent ?? ""));
      expect(sub, `${card.textContent?.slice(0, 12) ?? ""} has no sub-line`).toBeTruthy();
      expect(sub?.className ?? "", `${card.textContent?.slice(0, 12) ?? ""} clamps its sub-line`).not.toMatch(/clamp-/);
      expect(sub?.textContent ?? "").toMatch(/activities/);
    }
  });
});

it("keeps a saved cohort in flow exploration and in every fork, excluding unfiltered runs", async () => {
  const parent = db.runs.find((r) => r.id === "run_41")!;
  db.runs.push({ ...parent, id: "cohort-parent", scope: { selection_id: "sel-q1" }, createdAt: "2026-09-27T00:00:00Z" });
  useAnalysisSelection.getState().activate(analysisKey("p2p2018", "ds_1", "ct_1"), "sel-q1", draftFromSelection({ timeRanges: [{ from: "2018-01-01", before: "2018-04-01" }] }));
  const scopes: unknown[] = [];
  const filters: (string | null)[] = [];
  server.use(
    http.get("*/api/v1/projects/p2p2018/case-tables/ct_1/selections", () => HttpResponse.json([{ id: "sel-q1", name: "Q1", cases: 100, datasetId: "ds_1", caseTableId: "ct_1", selection: {timeRanges: [{from: "2018-01-01", before: "2018-04-01"}]} }])),
    http.post("*/api/v1/projects/p2p2018/runs", async ({request}) => { const body = await request.json() as {scope: unknown}; scopes.push(body.scope); return HttpResponse.json({...parent, id: "q1-df1", status: "done", scope: body.scope }); }),
  );
  server.events.on("request:start", ({request}) => { if (new URL(request.url).pathname.endsWith("/flow-types")) filters.push(new URL(request.url).searchParams.get("selectionId")); });
  renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=flows");
  await userEvent.click(await screen.findByRole("button", {name: "Analyse the DF1 flow"}));
  await waitFor(() => expect(scopes).toEqual([{selection_id: "sel-q1", flow_type: "DF1", attribute: "flow_type"}]));
  expect(filters).toContain("sel-q1");
  expect(screen.getByRole("link", {name: "Compare everything together"})).toHaveAttribute("href", expect.stringContaining("cohort-parent"));
  server.events.removeAllListeners("request:start");
});
