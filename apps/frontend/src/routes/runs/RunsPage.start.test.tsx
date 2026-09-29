import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import { server } from "@/mocks/node";
import { db } from "@/mocks/db";
import { renderApp, makeTestQueryClient } from "@/test/utils";
import { App } from "@/app/providers";
import { useJobStore } from "@/lib/stores/jobs";
import { createMemoryHistory } from "@tanstack/react-router";
import type { GroupingSuggestionsRequest, GroupingSuggestionsResponse } from "@/lib/api/groupingSuggestions";

function discovery(body: GroupingSuggestionsRequest, label = "Suggested region") : GroupingSuggestionsResponse {
  return {
    attributes: [{ name: "case Company", type: "categorical", distinct: 2, missing: 0 }],
    suggestions: [{ id: "suggested", label, attributes: ["case Company"], bands: [], reasons: ["Context reference in this norm; support measured on the selected cases."], relevance: 1, rankScore: 1, cases: 40, supportCases: 40, missingCases: 0, groups: 2, belowMinCases: 0, supportedCases: 40, relatedConstraints: [] }],
    notice: "Pre-scoring suggestions, not verified drivers or root causes.",
    evidence: { ...body, kind: "pre_scoring_context_support", projectId: "p2p2018", datasetId: "ds_1", caseTableId: "ct_1", normFingerprint: "norm-sha", effectiveNormFingerprint: "effective-sha", cases: 40, fingerprint: "evidence-sha", source: { mappingId: "map_2", mappingChecksum: "mapping-sha", casesChecksum: "cases-sha", eventsChecksum: "events-sha" } },
    search: { evaluatedCombinations: 12, eligibleColumns: 4, candidateColumns: ["case Company"], sampled: false, truncated: false, ranking: "Ranked by context references and support", relevanceViews: body.views.filter((v) => v !== "General"), relevanceBasis: "Selected stakeholder views", relatedWeightMeaning: "Normalized weights of referencing constraints", diversity: "One viable candidate of each available width" },
  };
}

beforeEach(() => server.use(http.post("*/api/v1/projects/p2p2018/case-tables/:id/grouping-suggestions", async ({ request }) => HttpResponse.json(discovery(await request.json() as GroupingSuggestionsRequest)))));

beforeEach(() => server.use(http.get("*/api/v1/projects/p2p2018/dataset-binding", () => HttpResponse.json({ projectId: "p2p2018", datasetId: "ds_1", boundAt: "2026-09-27T00:00:00Z" }))));

it("offers prepared datasets before any run exists and retains the managed General benchmark", async () => {
  const user = userEvent.setup();
  server.use(http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([])));
  renderApp("/p/p2p2018/runs");
  const newRun = await screen.findByRole("button", { name: "New run" }, { timeout: 8000 });
  await waitFor(() => expect(newRun).toBeEnabled());
  await user.click(newRun);
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Prepared dataset" })).toHaveTextContent(/BPI.*cases/));
  const checkboxes = within(dialog).getAllByRole("checkbox");
  expect(checkboxes.length).toBeGreaterThan(1);
  for (const checkbox of checkboxes) if (checkbox.getAttribute("aria-checked") === "true") await user.click(checkbox);
  expect(within(dialog).queryByText("Select at least one view.")).not.toBeInTheDocument();
  expect(within(dialog).getByText(/always included/)).toHaveTextContent("General");
  expect(within(dialog).queryByRole("checkbox", { name: "General" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Start run" })).toBeDisabled();
  for (const checkbox of checkboxes) expect(checkbox).toHaveAttribute("aria-checked", "false");
});

it("explains the missing norm before a first run instead of opening an unusable form", async () => {
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([])),
    http.get("*/api/v1/projects/p2p2018/norms", () => HttpResponse.json([])),
  );
  renderApp("/p/p2p2018/runs");
  expect(await screen.findByRole("link", { name: "Create or import a Process norm" })).toHaveAttribute("href", "/p/p2p2018/norms");
  expect(screen.getByRole("button", { name: "New run" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Create a run" })).not.toBeInTheDocument();
});

it("prefills the saved filter for a new run and retains it when changing the flow type", async () => {
  const requested: unknown[] = [];
  const parent = db.runs[0]!;
  server.use(
    http.get("*/api/v1/projects/p2p2018/case-tables/ct_1/selections", () => HttpResponse.json([{id: "sel_q1", name: "Q1 cases", datasetId: "ds_1", caseTableId: "ct_1", cases: 20, selection: {timeRanges: [{from: "2018-01-01", before: "2018-04-01"}]}}])),
    http.post("*/api/v1/projects/p2p2018/runs", async ({request}) => { requested.push(await request.json()); return HttpResponse.json({...parent, id: "q1-run", status: "done"}); }),
  );
  renderApp("/p/p2p2018/runs?new=true&caseTable=ct_1&selection=sel_q1");
  const dialog = await screen.findByRole("dialog");
  await screen.findByRole("option", {name: "Q1 cases · 20 cases"});
  expect(within(dialog).getByRole("combobox", {name: "Analysis filter"})).toHaveValue("sel_q1");
  await userEvent.click(within(dialog).getByRole("combobox", {name: "Flow type"}));
  await userEvent.click(await screen.findByRole("option", {name: /DF1 only/}));
  const start = within(dialog).getByRole("button", {name: "Start run"});
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  await waitFor(() => expect(requested).toHaveLength(1));
  expect(requested[0]).toMatchObject({caseTableId: "ct_1", scope: {selection_id: "sel_q1", flow_type: "DF1", attribute: "flow_type"}});
});
it("rejects a new-run URL naming a case table from a different dataset", async () => {
  db.datasets.push({...db.datasets[0]!, id: "other-ds", name: "Other process"});
  db.caseTables.push({...db.caseTables[0]!, id: "other-ct", datasetId: "other-ds"});
  renderApp("/p/p2p2018/runs?new=true&caseTable=other-ct");
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText(/Choose and fix this project’s dataset/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", {name: "Start run"})).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("combobox", {name: "Prepared dataset"}));
  expect(screen.queryByRole("option", {name: /Other process/})).not.toBeInTheDocument();
});
it("opens exploration of the fixed dataset directly from Data without offering a dataset switch", async () => {
  renderApp("/p/p2p2018/data");
  expect(await screen.findByRole("heading", {name: "Your data at a glance"}, {timeout: 8000})).toBeInTheDocument();
  expect(await screen.findByRole("region", {name: "Explore dataset"})).toBeVisible();
  expect(screen.getByRole("tab", {name: "Explore data"})).toHaveAttribute("data-state", "active");
  expect(screen.getByRole("region", {name: "Project dataset"})).toHaveTextContent("Project dataset fixed: BPI_Challenge_2019.csv");
  expect(screen.queryByText("Analyse another dataset")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "Choose file…"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "Use this dataset for project"})).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", {name: "Switch dataset"})).not.toBeInTheDocument();
});


it("adds one suggestion without replacing chosen rows, keeps General, and hides advanced settings", async () => {
  const user = userEvent.setup();
  const requests: Array<Record<string, unknown>> = [];
  server.use(http.post("*/api/v1/projects/p2p2018/runs", async ({ request }) => {
    requests.push(await request.json() as Record<string, unknown>);
    return HttpResponse.json({ ...db.runs[0]!, id: "added-run" });
  }));
  const previous = structuredClone(db.runs[0]!.slicings ?? []);
  renderApp("/p/p2p2018/runs?new=true");
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByRole("spinbutton", { name: "min cases" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Add grouping Suggested region" }));
  expect(screen.getByRole("button", { name: "Add grouping Suggested region" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Advanced settings" }));
  expect(within(dialog).getByRole("spinbutton", { name: "min cases" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  const added = requests[0]!.slicings as Array<{ id: string }>;
  expect(added.slice(0, previous.length)).toEqual(previous);
  expect(added).toHaveLength(previous.length + 1);
  expect(new Set(added.map((s) => s.id)).size).toBe(added.length);
  expect(requests[0]!.views).toContain("General");
});

it("removes stale suggestion evidence immediately when the selected views change", async () => {
  const user = userEvent.setup();
  const requested: GroupingSuggestionsRequest[] = [];
  let release: (() => void) | undefined;
  server.use(http.post("*/api/v1/projects/p2p2018/case-tables/:id/grouping-suggestions", async ({ request }) => {
    const body = await request.json() as GroupingSuggestionsRequest;
    requested.push(body);
    if (requested.length > 1) await new Promise<void>((resolve) => { release = resolve; });
    return HttpResponse.json(discovery(body, requested.length === 1 ? "Original context" : "Changed context"));
  }));
  renderApp("/p/p2p2018/runs?new=true");
  await screen.findByRole("button", { name: "Add grouping Original context" }, { timeout: 8000 });
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getAllByRole("checkbox")[0]!);
  expect(screen.queryByRole("button", { name: "Add grouping Original context" })).not.toBeInTheDocument();
  await waitFor(() => expect(release).toBeDefined());
  release!();
  await screen.findByRole("button", { name: "Add grouping Changed context" });
  expect(requested[0]!.views).not.toEqual(requested[1]!.views);
  expect(requested[1]!.views).toContain("General");
});


it("opens new-run navigation on an already mounted list and can reopen after cancellation", async () => {
  const history = createMemoryHistory({ initialEntries: ["/p/p2p2018/runs"] });
  render(<App queryClient={makeTestQueryClient()} history={history} />);
  await screen.findByRole("heading", { name: "All runs" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => { history.push("/p/p2p2018/runs?new=true&caseTable=ct_1"); });
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(history.location.search).not.toContain("new=true");
  await act(async () => { history.push("/p/p2p2018/runs?new=true&caseTable=ct_1"); });
  expect(await screen.findByRole("dialog")).toBeVisible();
});

it("shows the starting state and a failed request without closing the form or inventing a run", async () => {
  let reject!: () => void;
  server.use(http.post("*/api/v1/projects/p2p2018/runs", async () => {
    await new Promise<void>(resolve => { reject = resolve; });
    return HttpResponse.json({ title: "Run could not start", detail: "Fixture scoring is unavailable", status: 503, code: "run.unavailable" }, { status: 503 });
  }));
  renderApp("/p/p2p2018/runs?new=true");
  const dialog = await screen.findByRole("dialog");
  const start = within(dialog).getByRole("button", { name: "Start run" });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  expect(await within(dialog).findByRole("button", { name: "Starting run…" })).toBeDisabled();
  await waitFor(() => expect(reject).toBeDefined());
  reject();
  expect(await within(dialog).findByText("The workbench could not answer just now.")).toBeVisible();
  await userEvent.click(within(dialog).getByText("what the server said"));
  expect(within(dialog).getByText("Fixture scoring is unavailable")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Start run" })).toBeEnabled();
  expect(dialog).toBeVisible();
});


it.each(["done", "running", "queued"] as const)("opens the returned %s assessment and preserves its job status", async status => {
  const run = db.runs[0]!;
  const jobId = `returned-${status}`;
  server.use(
    http.post("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json({ ...run, status, jobId })),
    http.get(`*/api/v1/projects/p2p2018/runs/${run.id}`, () => HttpResponse.json({ ...run, status, jobId })),
    http.get(`*/api/v1/jobs/${jobId}`, () => HttpResponse.json({ id: jobId, kind: "score_run", status, progress: status === "done" ? 1 : 0, attempts: 1, cancelRequested: false, createdAt: run.createdAt, updatedAt: run.createdAt })),
  );
  const history = createMemoryHistory({ initialEntries: ["/p/p2p2018/runs?new=true"] });
  render(<App queryClient={makeTestQueryClient()} history={history} />);
  const dialog = await screen.findByRole("dialog");
  const start = within(dialog).getByRole("button", { name: "Start run" });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  await waitFor(() => expect(history.location.pathname).toBe(`/p/p2p2018/runs/${run.id}`));
  expect(history.location.search).toContain("tab=monitor");
  expect(useJobStore.getState().jobs.find(job => job.id === jobId)?.lastStatus).toBe(status);
  if (status === "done") {
    expect(await screen.findByText("Opened existing completed assessment: inputs unchanged.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the ranked list" })).toHaveAttribute("href", expect.stringContaining(`/runs/${run.id}/backlog`));
  } else {
    expect(await screen.findByText("Progress", { selector: "h3" })).toBeVisible();
    expect(screen.queryByText("Opened existing completed assessment: inputs unchanged.")).not.toBeInTheDocument();
  }
});
