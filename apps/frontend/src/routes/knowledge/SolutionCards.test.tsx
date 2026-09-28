import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";
import type { HubNode, HubPage } from "@/lib/api/knowledge";
import { useNavStore } from "@/lib/stores/nav";
import { solutionCardFixture as card } from "@/routes/act/driverEvidence.fixture";

const process: HubNode = { id: "process:p2p", kind: "process", plain_name: "Purchase to pay" };
const problem: HubNode = { id: "failure_mode:p2p:payment_wait", kind: "failure_mode", plain_name: "Payment waiting after release" };
const solution: HubNode = { id: "solution_card:p2p:release-to-clearing", kind: "solution_card", plain_name: "Review release-to-clearing timing" };
const expectations: HubNode[] = Array.from({ length: 10 }, (_, i) => ({ id: `expectation:p2p:payment_${i}`, kind: "expectation", plain_name: `Payment expectation ${i + 1}` }));
const pages: Record<string, HubPage> = {
  [process.id]: { node: process, related: { solution_cards: [solution], failure_modes: [problem] } },
  [solution.id]: { node: { ...solution, solution_card: { ...card, hubNode: solution.id } }, related: { process, expectations, failure_modes: [problem] } },
  [problem.id]: { node: problem, guidance: { meaning_when_missed: "A typical problem to investigate." }, related: { process, solution_cards: [solution] } },
};
const T = { timeout: 8000 };
beforeEach(() => server.use(
  http.get("*/api/v1/projects/p2p2018/knowledge/hub", () => HttpResponse.json({ pack: "p2p", nodes: [process, problem, solution, ...expectations], edges: [] })),
  http.get("*/api/v1/projects/p2p2018/knowledge/hub/:nodeId", ({ params }) => pages[String(params.nodeId)] ? HttpResponse.json(pages[String(params.nodeId)]) : HttpResponse.json({ detail: "Unknown page" }, { status: 404 })),
));

it("browses solution templates by type and opens their ordered evidence recipe without invented results", async () => {
  const user = userEvent.setup();
  const { container } = renderApp("/p/p2p2018/knowledge");
  await screen.findByTestId("hub-group-process", {}, T);
  await user.selectOptions(screen.getByLabelText("Browse by type"), "solution_card");
  expect(screen.queryByTestId("hub-group-expectation")).not.toBeInTheDocument();
  expect(screen.getByTestId("hub-count")).toHaveTextContent("1 of 13 pages match");
  await user.click(screen.getByRole("link", { name: solution.plain_name! }));
  const definition = await screen.findByTestId("solution-card-definition", {}, T);
  expect(definition).toHaveTextContent("unmeasured template, not a finding");
  expect(within(definition).getAllByTestId("solution-card-definition-block").map(b => within(b).getByRole("heading").textContent)).toEqual(card.blocks.map(b => b.title));
  for (const block of card.blocks) {
    expect(definition).toHaveTextContent(block.calculation);
    expect(definition).toHaveTextContent(block.missingData);
  }
  expect(definition).toHaveTextContent("mapped invoice payment due date");
  expect(screen.queryByTestId("driver-evidence-counts")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hub-overlay")).not.toBeInTheDocument();
  await expectNoSeriousA11yViolations(container);
});

it("connects process, solution card and typical problem in both directions", async () => {
  const user = userEvent.setup();
  renderApp(`/p/p2p2018/knowledge/${process.id}`);
  await screen.findByTestId("hub-page", {}, T);
  await user.click(screen.getByRole("button", { name: solution.plain_name! }));
  await screen.findByTestId("solution-card-definition", {}, T);
  expect(screen.getByTestId("hub-related")).toHaveTextContent(process.plain_name!);
  await user.click(screen.getByRole("button", { name: problem.plain_name! }));
  await waitFor(() => expect(screen.getByTestId("hub-page")).toHaveAttribute("data-node", problem.id), T);
  await user.click(within(screen.getByTestId("hub-related")).getByRole("button", { name: solution.plain_name! }));
  await screen.findByTestId("solution-card-definition", {}, T);
  await user.click(screen.getByRole("button", { name: process.plain_name! }));
  await waitFor(() => expect(screen.getByTestId("hub-page")).toHaveAttribute("data-node", process.id), T);
});

it("keeps expectations beyond the first eight reachable", async () => {
  renderApp(`/p/p2p2018/knowledge/${solution.id}`);
  await screen.findByTestId("solution-card-definition", {}, T);
  expect(screen.getByRole("button", { name: "Payment expectation 10" })).not.toBeVisible();
  await userEvent.click(screen.getByText("Show 2 more expectations"));
  expect(screen.getByRole("button", { name: "Payment expectation 10" })).toBeVisible();
});

it("shows missing template metadata as unavailable while retaining its process links", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/knowledge/hub/:nodeId", () => HttpResponse.json({ node: solution, related: { process } })));
  renderApp(`/p/p2p2018/knowledge/${solution.id}`);
  expect(await screen.findByText("This solution-card definition is unavailable.", {}, T)).toBeInTheDocument();
  expect(screen.queryByTestId("solution-card-definition")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: process.plain_name! })).toBeInTheDocument();
});


it("returns from a solution card to the exact filtered Improve selection", async () => {
  const pathname = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}/act`;
  const filter = JSON.stringify({and:[{kind:"open",value:true}]});
  const href = `${pathname}?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation&filter=${encodeURIComponent(filter)}&constraint=c_l3_lag_release_to_clear`;
  useNavStore.getState().record(href, pathname);
  renderApp(`/p/p2p2018/knowledge/${solution.id}`);
  await screen.findByTestId("solution-card-definition", {}, T);
  expect(screen.getByRole("heading", {level:1,name:"Knowledge hub"})).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", {name:"Back to Improve"}));
  const back = await screen.findByRole("link", {name:/Back to why this group is worst/}, T);
  const query = new URL(back.getAttribute("href")!, "http://local").searchParams;
  expect(query.get("filter")).toBe(filter);
  expect(query.get("view")).toBe("Automation");
  expect(query.get("slicing")).toBe("case Company+case Spend area text");
  expect(screen.getByTestId("act-selection-notice")).toBeVisible();
});
