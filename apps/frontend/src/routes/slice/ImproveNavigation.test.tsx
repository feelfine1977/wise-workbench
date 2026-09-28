import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { verifiedSlice, VERIFIED_PACKAGING_KEY } from "@/mocks/fixtures/verified";
import { renderApp } from "@/test/utils";

const path = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent(VERIFIED_PACKAGING_KEY)}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;
const filter = '{"and":[{"kind":"open","value":true}]}';
const parent = '{"slicing":"case Company","key":"[\\"companyID_0000\\"]"}';

it("keeps non-threshold expectation and exact selection through comparison, group examples and action", async () => {
  const base = structuredClone(verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!);
  base.row.mean_score = .6;
  base.row.global_mean = .8;
  base.row.n_cases = 100;
  base.scoredCases = 80;
  base.drivers = { columns: ["constraint", "layer", "type", "delta_gap", "share_violated", "share_in_scope"], rows: [["exact/non-threshold", "control", "precedence", .2, .5, 1]] };
  base.contrast = { columns: ["constraint", "plain", "share_missed_group", "share_missed_elsewhere", "n_evaluated_group", "n_evaluated_elsewhere"], rows: [["exact/non-threshold", "Exact expectation", .5, .1, 60, 250]] };
  const distributionRequests: string[] = [];
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs/run_41/slices/:key", () => HttpResponse.json(base)),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/distributions/:constraint", ({ request }) => { distributionRequests.push(request.url); return HttpResponse.json({}); }),
  );
  const user = userEvent.setup();
  renderApp(`${path}&filter=${encodeURIComponent(filter)}&within=${encodeURIComponent(parent)}`);
  const chart = await screen.findByTestId("score-waterfall");
  await user.click(within(chart).getByRole("button", { name: "Inspect Exact expectation: −20.00 score points" }));
  expect(await screen.findByTestId("measured-comparison")).toHaveTextContent("Exact expectation");
  expect(screen.getByText(/This expectation has no threshold distribution/)).toBeVisible();
  expect(screen.getByRole("img", { name: /Missed: whole group 50.00/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Inspect group case examples/ }));
  expect(await screen.findByTestId("evidence-support")).toHaveTextContent("Exact expectation");
  expect(screen.getByRole("img", { name: /Whole group: 100 purchase order items; Scored in this view: 80 purchase order items; Evaluated for this expectation: 60 purchase order items/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Review actions for this expectation/ }));
  await screen.findByTestId("act-selection-notice");
  const back = await screen.findByRole("link", { name: /Inspect the measured comparison/ });
  const query = new URL(back.getAttribute("href")!, "http://localhost").searchParams;
  expect(query.get("constraint")).toBe("exact/non-threshold");
  expect(query.get("filter")).toBe(filter);
  expect(query.get("within")).toBe(parent);
  expect(query.get("view")).toBe("Automation");
  await waitFor(() => expect(distributionRequests).toEqual([]));
});

it.each(["why", "act"])("keeps the selected denominator beside whole-group diagnostics on %s", async (page) => {
  const base = structuredClone(verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!);
  base.row.n_cases = 5242;
  base.row.stability = "stable";
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs/run_41/slices/:key", () => HttpResponse.json(base)),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", ({ request }) => {
      expect(new URL(request.url).searchParams.get("filter")).toBe(filter);
      return HttpResponse.json({ filter: JSON.parse(filter) as unknown, selection: { state: "measured", cases: 3698, wholeGroupCases: 5242, fingerprint: "exact-selection" }, gates: [] });
    }),
  );
  const start = page === "act" ? path.replace("?", "/act?") : path;
  renderApp(`${start}&filter=${encodeURIComponent(filter)}`);
  const summary = await screen.findByTestId("selection-scope");
  await waitFor(() => expect(summary).toHaveTextContent("Selected in this group: 3,698 / Whole group: 5,242"));
  expect(summary).toHaveTextContent("Selected-group rank, score and rank confidence are not supplied on this screen");
  expect(within(summary).getByRole("list", { name: "Active filters" })).toBeVisible();
  if (page === "why") {
    expect(screen.getByTestId("why-sentence")).toHaveTextContent("Whole group: 5,242");
    expect(screen.getByTestId("why-strip")).toHaveTextContent("rank · whole group");
    expect(screen.getByText("Whole-group pattern / rank confidence:")).toBeVisible();
  } else {
    expect((await screen.findAllByTestId("headroom"))[0]).toHaveTextContent("score points of possible gain · whole group");
    expect((await screen.findAllByText("Whole-group score scenario; no operational benefit is estimated."))[0]).toBeVisible();
  }
});

it("does not replace a missing selected count with a legacy whole-group response", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", () => HttpResponse.json({ gates: [] })));
  renderApp(`${path}&filter=${encodeURIComponent(filter)}`);
  const summary = await screen.findByTestId("selection-scope");
  await waitFor(() => expect(summary).toHaveTextContent("Selected in this group: unavailable / Whole group: 109,199"));
  expect(summary).toHaveTextContent("no whole-group count has been substituted");
});

it.each([false, true])("uses the saved support threshold and never mixes a rank with an empty list total (empty=%s)", async (empty) => {
  const base = structuredClone(verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!);
  base.row.rank = 1;
  base.row.n_ranked = 2;
  base.row.stable_PI = .3;
  const requests: string[] = [];
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs/run_41/slices/:key", () => HttpResponse.json(base)),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/backlog", ({ request }) => {
      const minimum = new URL(request.url).searchParams.get("minCases");
      requests.push(minimum ?? "omitted");
      return HttpResponse.json({ rows: empty || minimum !== "1" ? [] : [base.row], total: empty || minimum !== "1" ? 0 : 2, params: { minCases: Number(minimum) } });
    }),
  );
  renderApp(path);
  const strip = await screen.findByTestId("why-strip");
  await waitFor(() => expect(requests).toEqual(["1"]));
  expect(strip).toHaveTextContent("rank · whole group1 of 2");
  expect(strip).toHaveTextContent("priority · whole group0.3");
  expect(strip).not.toHaveTextContent("1 of 0");
  expect(strip).toHaveTextContent(empty ? "Assessment ranking population" : "Groups with at least 1 purchase order items");
});

it.each([1, 20])("preserves minimum support %s from the ranked group into Why", async (minimum) => {
  const base = structuredClone(verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!);
  base.row.rank = 1;
  base.row.n_ranked = 2;
  const total = minimum === 1 ? 2 : 1;
  const requests: string[] = [];
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs/run_41/slices/:key", () => HttpResponse.json(base)),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/backlog", ({ request }) => {
      const requested = new URL(request.url).searchParams.get("minCases") ?? "omitted";
      requests.push(requested);
      return HttpResponse.json({ rows: [base.row], total, params: { minCases: Number(requested), case_noun: "purchase order items" } });
    }),
  );
  const user = userEvent.setup();
  renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&minCases=${minimum}`);
  await user.click(await screen.findByRole("button", { name: /^Why\?/ }));
  const strip = await screen.findByTestId("why-strip");
  await waitFor(() => expect(strip).toHaveTextContent(`rank · whole group1 of ${total}`));
  expect(strip).toHaveTextContent(`Groups with at least ${minimum} purchase order items`);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(value => value === String(minimum))).toBe(true);
});
