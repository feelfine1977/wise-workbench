import { screen, within, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { db, summaryFor } from "@/mocks/db";
import { bindProjectDataset } from "@/lib/api/projectBinding";
import userEvent from "@testing-library/user-event";
import { useViewPreference } from "@/lib/stores/viewPreference";
import { useUiStore } from "@/lib/stores/ui";
import { renderApp } from "@/test/utils";

it("reopens a saved finding in its recorded view and exact filter rather than the dashboard defaults",async()=>{
  const filter={and:[{kind:"count",activity:"Review invoice",min:2}]};
  server.use(http.get("*/api/v1/projects/p2p2018/findings",()=>HttpResponse.json([{
    id:"saved-finding",projectId:"p2p2018",kind:"finding",status:"open",title:"Investigate repeated reviews",runId:"run_41",sliceKey:'["North"]',slicing:"region",view:"Finance",createdAt:"2026-09-27T00:00:00Z",updatedAt:"2026-09-27T00:00:00Z",
    evidenceContext:{runId:"run_41",sliceKey:'["North"]',slicing:"region",view:"Automation",filter,normVersionId:"norm1",normFingerprint:"abc",manifestFingerprint:"def"},
  }])));
  renderApp("/p/p2p2018");
  const records=await screen.findByTestId("open-records", {}, { timeout: 8000 });
  const link=within(records).getByRole("link",{name:"North"});
  const url=new URL(link.getAttribute("href")!,"http://local");
  expect(url.searchParams.get("view")).toBe("Automation");
  expect(url.searchParams.get("slicing")).toBe("region");
  expect(url.searchParams.get("filter")).toBe(JSON.stringify(filter));
  expect(url.searchParams.get("focus")).toBe("finding");
  expect(records).toHaveTextContent("saved selection");
});


it("guides prepared data with no norm to its first expectation", async () => {
  await bindProjectDataset("p2p2018", "ds_1");
  server.use(http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([])), http.get("*/api/v1/projects/p2p2018/norms", () => HttpResponse.json([])), http.get("*/api/v1/projects/p2p2018", () => HttpResponse.json({...db.projects[0], latestRunId:null})));
  renderApp("/p/p2p2018");
  const action = await screen.findByRole("link", {name:"Define your first expectation"}, {timeout:8000});
  expect(action).toHaveAttribute("href", "/p/p2p2018/norms");
  expect(screen.queryByRole("link", {name:"Create a run"})).not.toBeInTheDocument();
  expect(screen.queryByText(/Import the reference norm/)).not.toBeInTheDocument();
});

it("separates readiness failures and warnings from ranking stability", async () => {
  const run = db.runs.find(r => r.id === "run_41")!;
  const table = db.caseTables.find(t => t.id === run.caseTableId)!;
  const fixture = {...table, readiness:{status:"fail",items:[{id:"missing",level:"fail",message:"Missing case identifiers"},{id:"coverage",level:"warn",message:"Partial coverage"}]}};
  server.use(http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId", () => HttpResponse.json(fixture)), http.get("*/api/v1/projects/p2p2018/case-tables", () => HttpResponse.json([fixture])));
  renderApp("/p/p2p2018");
  const summary = await screen.findByRole("complementary", {name:"Data checks for this preparation"}, {timeout:8000});
  expect(summary).toHaveTextContent("1 blocking issue · 1 warning");
  expect(summary).toHaveTextContent("It does not establish data fitness or a cause.");
  expect(await screen.findByTestId("caveats-chip")).toHaveTextContent("1 blocking issue · 1 warning");
});


it("shows the preferred view's mean in score points and keeps method detail secondary in technical mode", async () => {
  useViewPreference.getState().choose("p2p2018", "Automation");
  useUiStore.getState().setVocabulary("method");
  renderApp("/p/p2p2018");
  const score = await screen.findByTestId("mean-score-stat", {}, {timeout:8000});
  expect(score).toHaveTextContent("84.4 / 100");
  expect(score).toHaveTextContent("Automation view");
  expect(score).not.toHaveTextContent("%");
  expect(score).not.toHaveTextContent(/rules met|business impact|savings/i);
  const signal = await screen.findByTestId("top-signal");
  expect(signal).toHaveTextContent("score points");
  expect(signal).not.toHaveTextContent(/gap |μ̄|%/);
  expect(screen.getByRole("heading", {level:2, name:"Assessment overview"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {level:2, name:"Open findings"})).toBeInTheDocument();
  const toggle = screen.getByText("Other view scores and method details");
  const details = toggle.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  await userEvent.click(toggle);
  expect(details).toHaveAttribute("open");
  expect(within(details).getByText(/not the percentage of rules met/)).toBeVisible();
  expect(within(details).getByText(/does not estimate business impact/)).toBeVisible();
  expect(within(details).getByText(/Method values/)).toHaveTextContent("gap");
  expect(useViewPreference.getState().byProject.p2p2018).toBe("Automation");
  const next = new URL(within(screen.getByTestId("next-step")).getByRole("link",{name:/Why\?/}).getAttribute("href")!, "http://local");
  expect(next.searchParams.get("view")).toBe("Automation");
});

it("resumes the assessment's exact data preparation, norm version and saved selection", async () => {
  const run = db.runs.find(r => r.id === "run_41")!;
  run.scope = {selection_id:"saved-cohort"};
  renderApp("/p/p2p2018");
  const actions = await screen.findByRole("region", {name:"Project actions"}, {timeout:8000});
  const urlFor = (name: RegExp) => new URL(within(actions).getByRole("link", {name}).getAttribute("href")!, "http://local");
  const data = urlFor(/Understand your data/);
  expect(data.pathname).toBe("/p/p2p2018/data/ds_1");
  expect(data.searchParams.get("caseTable")).toBe(run.caseTableId);
  expect(data.searchParams.get("tab")).toBe("understand");
  const norm = urlFor(/Review your Process norm/);
  expect(norm.pathname).toBe(`/p/p2p2018/norms/${run.normVersionId}`);
  expect(norm.searchParams.get("caseTable")).toBe(run.caseTableId);
  expect(norm.searchParams.get("selection")).toBe("saved-cohort");
  expect(norm.searchParams.get("tab")).toBe("guide");
  expect(norm.searchParams.has("view")).toBe(false);
  const runs = urlFor(/Run WISE/);
  expect(runs.searchParams.get("caseTable")).toBe(run.caseTableId);
  expect(runs.searchParams.get("selection")).toBe("saved-cohort");
});

it("uses scoped counts and the reported concentration threshold without substituting whole-dataset totals", async () => {
  const run = db.runs.find(r => r.id === "run_41")!;
  run.scope = {selection_id:"saved-cohort"};
  const summary = summaryFor(run.id);
  summary.cases = 120;
  summary.scored = {Finance:100};
  summary.means = {Finance:0};
  summary.concentration = {[run.slicings![0]!.id!]:{Finance:{columns:["threshold","top_k","share_of_slices"],rows:[[0.7,2,0.25]]}}};
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/summary", () => HttpResponse.json(summary)));
  renderApp("/p/p2p2018");
  const count = await screen.findByTestId("case-count-stat", {}, {timeout:8000});
  expect(count).toHaveTextContent("120");
  expect(count).toHaveTextContent("Saved selection only");
  const score = screen.getByTestId("mean-score-stat");
  expect(score).toHaveTextContent("0.0 / 100");
  expect(score).toHaveTextContent("100 scored cases");
  expect(screen.getByTestId("priority-stat")).toHaveTextContent("70%");
  expect(screen.getByTestId("priority-stat")).not.toHaveTextContent("80%");
});

it("does not turn missing score and population evidence into zero or use the case-table count", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/summary", () => HttpResponse.json({means:{Finance:null},cases:null})));
  renderApp("/p/p2p2018");
  const score = await screen.findByTestId("mean-score-stat", {}, {timeout:8000});
  expect(score).toHaveTextContent("Unavailable");
  expect(score).not.toHaveTextContent("0.0");
  expect(screen.getByTestId("case-count-stat")).toHaveTextContent("Unavailable");
});

it("offers retry for a summary failure without showing zero measurements", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/summary", () => HttpResponse.json({detail:"Unavailable"},{status:503})));
  renderApp("/p/p2p2018");
  const retry = await screen.findByRole("button", {name:"Retry summary"}, {timeout:8000});
  expect(screen.queryByTestId("mean-score-stat")).not.toBeInTheDocument();
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/summary", () => HttpResponse.json(summaryFor("run_41"))));
  await userEvent.click(retry);
  await waitFor(() => expect(screen.getByTestId("mean-score-stat")).toHaveTextContent("81.9 / 100"));
});
