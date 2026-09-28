import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";
import { driverEvidenceFixture as evidence, solutionCardFixture as card } from "./driverEvidence.fixture";

const api = "*/api/v1/projects/p2p2018/runs/run_41/driver-evidence";
const slicing = "case Company+case Spend area text";
const key = '["companyID_0000","Packaging"]';
const path = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent(key)}/act?slicing=${encodeURIComponent(slicing)}&view=Automation`;
const T = { timeout: 8000 };
const hubNode = "solution_card:p2p:release-to-clearing";
function answer(filter: string | null = null) {
  return { ...evidence, source: { ...evidence.source, projectId: "p2p2018", runId: "run_41" },
    scope: { ...evidence.scope, slicing, key: JSON.parse(key), view: "Automation", filter: filter === null ? null : JSON.parse(filter), filtered: filter !== null, groupCases: 120, selectedCases: filter === null ? 120 : 100 },
    solutionCard: { ...card, hubNode } };
}
beforeEach(() => server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/what-can-we-do", () => HttpResponse.json({
  reading: "120 cases in this group.", caseNoun: "purchase order items", drivers: [{ constraint_id: "lag", plain_name: "Paid soon after release", usual_reasons: [{ text: "Check the payment calendar" }], usual_actions: [{ text: "Review the process", owner_role: "Owner" }] }],
}))));

it("keeps suggestions available while measurements load, then shows exact counts and the template link", async () => {
  let requests = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get(api, async () => { requests++; await ready; return HttpResponse.json(answer()); }));
  const { container } = renderApp(path);
  try {
    const panel = await screen.findByTestId("driver-evidence", {}, T);
    expect(panel).toHaveAttribute("aria-busy", "false");
    expect(requests).toBe(0);
    expect(within(panel).queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Measure evidence for this selection" }));
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "true"));
    await waitFor(() => expect(requests).toBe(1));
    expect(within(panel).getByRole("status")).toHaveTextContent("Measuring events for this exact run, group and filter");
    expect(screen.getByText("Review the process")).toBeInTheDocument();
    expect(within(panel).queryByText(/0 cases|0.0 days/)).not.toBeInTheDocument();
  } finally { release(); }
  const counts = await screen.findByTestId("driver-evidence-counts", {}, T);
  expect(counts).toHaveTextContent("120 purchase order items in this evidence population");
  expect(counts).toHaveTextContent("200 in the saved run");
  const link = screen.getByRole("link", { name: /Open this solution-card template/ });
  expect(decodeURIComponent(link.getAttribute("href")!)).toContain(`/p/p2p2018/knowledge/${hubNode}`);
  await expectNoSeriousA11yViolations(container);
});

it("measures the exact filter while retaining the whole-group label on score suggestions", async () => {
  const filter = '{"and":[{"kind":"open","value":true}]}';
  const requests: URLSearchParams[] = [];
  server.use(http.get(api, ({ request }) => {
    const params = new URL(request.url).searchParams; requests.push(params);
    return HttpResponse.json(answer(params.get("filter")));
  }));
  renderApp(`${path}&filter=${encodeURIComponent(filter)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Measure evidence for this selection" }, T));
  const counts = await screen.findByTestId("driver-evidence-counts", {}, T);
  expect(counts).toHaveTextContent("100 purchase order items in this evidence population · 120 in the saved run’s whole group");
  expect(screen.getByTestId("whole-group-suggestions")).toHaveTextContent("Suggestions for the whole group");
  expect(requests).toHaveLength(1);
  expect(requests[0]!.get("filter")).toBe(filter);
  expect(requests[0]!.get("constraintId")).toBe("lag");
  await userEvent.click(screen.getByText("Exact evidence scope"));
  expect(screen.getByTestId("driver-evidence")).toHaveTextContent(filter);
});

it("shows failed measurements as unavailable and retries only the same selection", async () => {
  const filter = '{"and":[{"kind":"open","value":true}]}';
  const requests: (string | null)[] = [];
  server.use(http.get(api, ({ request }) => {
    requests.push(new URL(request.url).searchParams.get("filter"));
    return HttpResponse.json({ detail: "The evidence service is temporarily unavailable." }, { status: 503 });
  }));
  renderApp(`${path}&filter=${encodeURIComponent(filter)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Measure evidence for this selection" }, T));
  const button = await screen.findByRole("button", { name: "Retry event evidence" }, T);
  expect(screen.getByTestId("driver-evidence")).toHaveTextContent("temporarily unavailable");
  expect(screen.queryByTestId("driver-evidence-counts")).not.toBeInTheDocument();
  expect(screen.queryByTestId("solution-card-measured")).not.toBeInTheDocument();
  await userEvent.click(button);
  await waitFor(() => expect(requests).toEqual([filter, filter]), T);
});

it("does not substitute group measurements for an unsupported drilled selection", async () => {
  let requests = 0;
  server.use(http.get(api, () => { requests++; return HttpResponse.json(answer()); }));
  renderApp(`${path}&within=${encodeURIComponent('{"slicing":"company","key":"[\\"A\\"]"}')}`);
  const panel = await screen.findByTestId("driver-evidence", {}, T);
  expect(panel).toHaveTextContent("Event evidence is unavailable for this drilled selection");
  expect(panel).toHaveAttribute("aria-busy", "false");
  expect(screen.queryByTestId("driver-evidence-counts")).not.toBeInTheDocument();
  expect(requests).toBe(0);
});

it("keeps historic causal wording inside candidate guidance rather than the measured reading", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/what-can-we-do", () => HttpResponse.json({
    caseNoun: "purchase order items", drivers: [{ constraint_id: "lag", plain_name: "Paid soon after release", share_of_shortfall: 0.13,
      meaning_when_missed: "The invoice waited for a payment run or a second hold.", why_it_matters: "Pure waiting costs discounts and goodwill.", comparison: "Missed in 86% here against 82% elsewhere" }],
  })));
  renderApp(path);
  const candidate = await screen.findByTestId("driver-interpretation", {}, T);
  expect(candidate).toHaveTextContent("Candidate interpretation from process guidance");
  expect(candidate).toHaveTextContent("does not establish this group’s cause, contractual lateness or financial impact");
  expect(candidate).toHaveTextContent("Pure waiting");
  expect(screen.getByTestId("driver-reading")).not.toHaveTextContent(/payment run|Pure waiting/);
  expect(screen.getByTestId("driver-comparison")).toHaveTextContent("86% here against 82% elsewhere");
});
