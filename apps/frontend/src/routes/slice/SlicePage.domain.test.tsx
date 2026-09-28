import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { db } from "@/mocks/db";
import { verifiedSlice, verifiedFlowAll, verifiedFlowPackaging, VERIFIED_PACKAGING_KEY } from "@/mocks/fixtures/verified";
import { renderApp, ROUTE_READY } from "@/test/utils";

const path = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent(VERIFIED_PACKAGING_KEY)}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;
const api = "*/api/v1/projects/p2p2018/runs/run_41";
const parent = JSON.stringify({ slicing: "case Company", key: '["companyID_0000"]' });
const date = { kind: "time", field: "case_start", from: "2018-01-01", to: "2018-03-31" };
const distribution = { bins: [{ x0: 0, x1: 10, n: 2 }], stats: { n: 2 }, ecdf: [[10, 1]], threshold: 5, width: 2, unit: "D" };
const problem = (status: number, code: string) => HttpResponse.json({ status, code, title: "Evidence unavailable", detail: code }, { status });

it("applies parent and date to group, baseline and focused charts and retains both in full-map navigation", async () => {
  const flows: URL[] = [];
  const signals: URL[] = [];
  server.use(
    http.get(`${api}/flow`, ({ request }) => { const u = new URL(request.url); flows.push(u); return HttpResponse.json(u.searchParams.has("sliceKey") ? verifiedFlowPackaging : verifiedFlowAll); }),
    http.get(`${api}/signals/:id`, ({ request }) => { signals.push(new URL(request.url)); return HttpResponse.json(distribution); }),
  );
  renderApp(`${path}&within=${encodeURIComponent(parent)}&filter=${encodeURIComponent(JSON.stringify({ and: [date] }))}&activity=Record%20Goods%20Receipt`);
  await screen.findByTestId("flow-map", {}, ROUTE_READY);
  await waitFor(() => expect(signals.length).toBe(2));
  await waitFor(() => expect(flows.some(u => u.searchParams.has("focus"))).toBe(true));
  const expected = [date, { kind: "attribute", field: "case Company", in: ["companyID_0000"] }];
  for (const u of [...flows, ...signals]) expect(JSON.parse(u.searchParams.get("filter")!).and).toEqual(expected);
  expect(signals.filter(u => u.searchParams.has("sliceKey"))).toHaveLength(1);
  expect(screen.getByTestId("why-lens")).toHaveTextContent("Selected items: measurement");
  expect(screen.getByTestId("why-lens")).not.toHaveTextContent("83 days here; everywhere else 55");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Flow" }));
  await user.click(screen.getByRole("button", { name: "Open full →" }));
  await waitFor(() => expect(flows.some(u => {
    const filter = JSON.parse(u.searchParams.get("filter") ?? "null");
    return !u.searchParams.has("sliceKey") && filter?.and?.some((c: { field?: string }) => c.field === "case Spend area text");
  })).toBe(true));
  const full = flows.findLast(u => JSON.parse(u.searchParams.get("filter") ?? "null")?.and?.some((c: { field?: string }) => c.field === "case Spend area text"))!;
  expect(JSON.parse(full.searchParams.get("filter")!).and).toContainEqual({ kind: "attribute", field: "case Spend area text", in: ["Packaging"] });
});

it.each([
  JSON.stringify({ slicing: 'group:{"attributes":["amount"],"bands":[{}]}', key: '["0–100"]' }),
  "malformed-parent",
])("withholds every chart request and full-map navigation for unsupported parent %s", async (withinParam) => {
  const requests: string[] = [];
  server.use(http.get(`${api}/flow`, ({ request }) => { requests.push(request.url); return HttpResponse.json(verifiedFlowAll); }), http.get(`${api}/signals/:id`, ({ request }) => { requests.push(request.url); return HttpResponse.json(distribution); }));
  renderApp(`${path}&within=${encodeURIComponent(withinParam)}&activity=Record%20Goods%20Receipt`);
  expect((await screen.findAllByTestId("chart-scope-unavailable", {}, ROUTE_READY))[0]).toHaveTextContent("no broader population is substituted");
  expect(screen.queryByTestId("flow-map")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Flow" }));
  expect(screen.getByRole("button", { name: "Open full →" })).toBeDisabled();
  expect(requests).toEqual([]);
});

it("carries the saved population to Define and states the narrower-scope limitation", async () => {
  const run = db.runs.find(r => r.id === "run_41")!;
  run.scope = { selection_id: "quarter-2018", flow_type: "standard" };
  renderApp(`${path}&tab=compared&within=${encodeURIComponent(parent)}&filter=${encodeURIComponent(JSON.stringify({ and: [date] }))}`);
  const link = await screen.findByRole("link", { name: "norm's calibration lens" }, ROUTE_READY);
  const query = new URL(link.getAttribute("href")!, "http://localhost").searchParams;
  expect(query.get("caseTable")).toBe("ct_1");
  expect(query.get("selection")).toBe("quarter-2018");
  expect(query.has("within")).toBe(false);
  expect(query.has("filter")).toBe(false);
  expect(link).toHaveAccessibleDescription(/saved population.*investigation group.*flow-type restriction are not carried/);
});

it("labels weighted case and mean scores on 0–100 rather than rules passed", async () => {
  const data = structuredClone(verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!);
  data.row.mean_score = .9;
  data.row.global_mean = .8356;
  data.worstCases = [{ caseId: "unequal-weights", score: .9, violated: ["c_l3_invoice_to_clear_days"] }];
  server.use(http.get(`${api}/slices/:key`, () => HttpResponse.json(data)));
  renderApp(`${path}&tab=cases`);
  expect(await screen.findByTestId("why-strip", {}, ROUTE_READY)).toHaveTextContent("Mean WISE score (0–100) · whole group90.0 (everyone 83.6)");
  const cases = screen.getByTestId("worst-cases");
  expect(cases).toHaveTextContent("WISE score (0–100)");
  expect(cases).toHaveTextContent("90.0");
  expect(cases).not.toHaveTextContent("90%");
  expect(cases).not.toHaveTextContent("rules met");
  expect(screen.getByText(/not the percentage of rules passed/)).toBeVisible();
});

it.each(["case_table.artefacts_missing", "run.not_found", "slice.not_found"])("distinguishes flow %s from a successful empty chart selection", async code => {
  server.use(http.get(`${api}/flow`, ({ request }) => new URL(request.url).searchParams.has("sliceKey") ? problem(404, code) : HttpResponse.json(verifiedFlowAll)));
  renderApp(`${path}&tab=flow`);
  if (code === "slice.not_found") {
    expect(await screen.findByTestId("no-map", {}, ROUTE_READY)).toHaveTextContent("No cases match this group and chart selection");
  } else {
    expect(await screen.findByText(code, {}, ROUTE_READY)).toBeInTheDocument();
    expect(screen.queryByTestId("no-map")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  }
  expect(screen.queryByText(/The run has no event/)).not.toBeInTheDocument();
});

it("separates reasons pending, failed and successfully empty, and recovers on retry", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  server.use(http.get(`${api}/what-can-we-do`, async () => { if (++count === 1) { await waiting; return problem(500, "knowledge.unavailable"); } return HttpResponse.json({ drivers: [] }); }));
  renderApp(path);
  const card = await screen.findByTestId("typical-causes", {}, ROUTE_READY);
  expect(within(card).getByRole("status")).toBeInTheDocument();
  expect(card).not.toHaveTextContent("No candidate reasons");
  release();
  await within(card).findByText("knowledge.unavailable");
  expect(card).not.toHaveTextContent("No candidate reasons");
  await userEvent.click(within(card).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(card).toHaveTextContent("No candidate reasons were returned for this group."));
  expect(within(card).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

it("labels failed comparison baselines while retaining successfully measured group charts", async () => {
  server.use(
    http.get(`${api}/flow`, ({ request }) => new URL(request.url).searchParams.has("sliceKey") ? HttpResponse.json(verifiedFlowPackaging) : problem(500, "baseline.unavailable")),
    http.get(`${api}/signals/:id`, ({ request }) => new URL(request.url).searchParams.has("sliceKey") ? HttpResponse.json(distribution) : problem(500, "baseline.unavailable")),
  );
  renderApp(path);
  expect(await screen.findByTestId("map-baseline-unavailable", {}, ROUTE_READY)).toHaveTextContent("only this group's paths are shown");
  expect(await screen.findByTestId("distribution-baseline-unavailable")).toHaveTextContent("only this group's measurements are shown");
  expect(screen.getByTestId("flow-map")).toBeVisible();
  expect(screen.getByTestId("why-lens")).not.toHaveTextContent("83 days here; everywhere else 55");
});
