import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { makeTestQueryClient } from "@/test/utils";
import { RuleEvidenceSummary } from "./RuleEvidenceSummary";

const props = { projectId: "p", versionId: "v", caseTableId: "ct", constraint: { id: "lag", type: "lag", layer: "time", params: { a: ["A"], b: ["B"], delta: 5, width: 10 } } };
const counts = { populationCases: 9, applicableCases: 8, evaluatedCases: 7, observedCases: 6, missingSignalCases: 2 };

it("defers full-log evaluation until the distribution is ready and reuses saved counts on remount", async () => {
  let calls = 0;
  server.use(http.post("*/projects/p/norms/v/preview/lag", () => {
    calls++;
    return HttpResponse.json({ normVersionId: "v", caseTableId: "ct", constraintId: "lag", scope: { kind: "all" }, saved: { counts }, proposed: { counts } });
  }));
  const client = makeTestQueryClient();
  const ui = (ready: boolean) => <QueryClientProvider client={client}><RuleEvidenceSummary {...props} readyForCounts={ready} /></QueryClientProvider>;
  const first = render(ui(false));
  expect(calls).toBe(0);
  expect(screen.getAllByText("Checking…")).toHaveLength(3);
  first.rerender(ui(true));
  expect(await screen.findByText("6")).toBeVisible();
  expect(calls).toBe(1);
  first.unmount();
  render(ui(true));
  expect(screen.getByText("7")).toBeVisible();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(calls).toBe(1);
});

it("does not display measurements returned for another evidence population", async () => {
  server.use(http.post("*/projects/p/norms/v/preview/lag", () => HttpResponse.json({ normVersionId: "v", caseTableId: "ct", constraintId: "lag", scope: { kind: "saved_selection", selectionId: "different" }, saved: { counts }, proposed: { counts } })));
  render(<QueryClientProvider client={makeTestQueryClient()}><RuleEvidenceSummary {...props} selectionId="requested" /></QueryClientProvider>);
  const region = screen.getByRole("region", { name: "Saved rule evidence" });
  await waitFor(() => expect(within(region).getAllByText("Unavailable")).toHaveLength(3));
  expect(within(region).queryByText("6")).not.toBeInTheDocument();
});
