import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { NormCalibrationChart } from "./NormCalibrationChart";
import type { components } from "@wise/api-schema";

const props = {
  projectId: "p", versionId: "v", caseTableId: "ct", selectionId: "saved-cohort",
  constraint: { id: "lag", type: "lag", layer: "time", params: { a: ["Start"], b: ["End"], delta: 10, width: 20 } },
  distribution: { bins: [{ x0: 9, x1: 14, n: 3 }], ecdf: [[9, 1 / 3], [11, 2 / 3], [13, 1]], unit: "D", threshold: 10, width: 20, stats: { n: 3, nCases: 4 } },
  title: "Elapsed time", populationName: "Saved cohort", onCommit: vi.fn(),
};
const counts = (violating: number) => ({ populationCases: 4, applicableCases: 4, evaluatedCases: 4, unknownCases: 0, violatingCases: violating, violationShare: violating / 4, meanPenalty: .1, observedCases: 3, missingSignalCases: 1 });
function response(violating: number): components["schemas"]["NormConstraintPreview"] {
  return { normVersionId: "v", caseTableId: "ct", constraintId: "lag", scope: { kind: "saved_selection", selectionId: "saved-cohort", selectionName: "Saved cohort" }, saved: { counts: counts(3) }, proposed: { counts: counts(violating) } };
}
it("uses the saved cohort and hides obsolete exact counts while the target changes", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: components["schemas"]["NormPreviewRequest"][] = [];
  server.use(http.post("*/projects/p/norms/v/preview/lag", async ({ request }) => {
    const body = await request.json() as components["schemas"]["NormPreviewRequest"];
    requests.push(body);
    const changed = (body.constraint.params as { delta: number }).delta === 12;
    if (changed) await gate;
    return HttpResponse.json(response(changed ? 2 : 3));
  }));
  const onCommit = vi.fn();
  const ui = render(<QueryClientProvider client={makeTestQueryClient()}><NormCalibrationChart {...props} onCommit={onCommit} /></QueryClientProvider>);
  expect(await screen.findByText("3 / 4 → 3 / 4")).toBeVisible();
  expect(requests[0]?.selectionId).toBe("saved-cohort");
  fireEvent.change(screen.getByLabelText("Target (days)"), { target: { value: "12" } });
  expect(screen.queryByText("3 / 4 → 3 / 4")).not.toBeInTheDocument();
  expect(screen.getByText("Evaluating proposed target…")).toBeVisible();
  await waitFor(() => expect(requests).toHaveLength(2));
  release();
  expect(await screen.findByText("3 / 4 → 2 / 4")).toBeVisible();
  expect(screen.getByText(/1 missing native measurements/)).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Cumulative" }));
  expect(screen.getByRole("img", { name: /Cumulative distribution/ })).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Commit as version…" }));
  expect(onCommit).toHaveBeenCalledWith({ threshold: 12, width: 20 });
  await expectNoSeriousA11yViolations(ui.container);
});

it("does not invent effects for a failed preview and rejects invalid proposed numbers", async () => {
  server.use(http.post("*/projects/p/norms/v/preview/lag", () => HttpResponse.json({ title: "Preview unavailable" }, { status: 503 })));
  render(<QueryClientProvider client={makeTestQueryClient()}><NormCalibrationChart {...props} /></QueryClientProvider>);
  expect(await screen.findByText(/Exact preview unavailable/)).toBeVisible();
  expect(screen.queryByText("3 / 4 → 3 / 4")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tolerance width (days)"), { target: { value: "-1" } });
  expect(screen.getByRole("button", { name: "Commit as version…" })).toBeDisabled();
});


it("accepts fractional occurrence tolerance while rejecting zero width and fractional count targets", async () => {
  const requests: components["schemas"]["NormPreviewRequest"][] = [];
  server.use(http.post("*/projects/p/norms/v/preview/lag", async ({ request }) => {
    requests.push(await request.json() as components["schemas"]["NormPreviewRequest"]);
    return HttpResponse.json(response(2));
  }));
  const onCommit = vi.fn();
  render(<QueryClientProvider client={makeTestQueryClient()}><NormCalibrationChart {...props}
    constraint={{ id: "lag", type: "singularity", layer: "time", params: { activity: ["Start"], k: 1, K: .5 } }}
    distribution={{ ...props.distribution, unit: "events", threshold: 1, width: .5 }} onCommit={onCommit} /></QueryClientProvider>);
  expect(await screen.findByText("3 / 4 → 2 / 4")).toBeVisible();
  expect(requests[0]?.constraint.params).toMatchObject({ k: 1, K: .5 });
  expect(screen.getByText(/fractional widths are allowed/)).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Commit as version…" }));
  expect(onCommit).toHaveBeenCalledWith({ threshold: 1, width: .5 });
  fireEvent.change(screen.getByLabelText("Tolerance width (events)"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "Commit as version…" })).toBeDisabled();
  expect(screen.getByText(/width must be positive/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Tolerance width (events)"), { target: { value: ".25" } });
  expect(screen.getByRole("button", { name: "Commit as version…" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Target (events)"), { target: { value: "1.5" } });
  expect(screen.getByRole("button", { name: "Commit as version…" })).toBeDisabled();
});
