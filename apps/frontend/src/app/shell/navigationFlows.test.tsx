import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { bindProjectDataset } from "@/lib/api/projectBinding";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";

const timeout = { timeout: 8000 };
it("offers a compatible saved assessment without scoring the explorer or inheriting its filter", async () => {
  await bindProjectDataset("p2p2018", "ds_1");
  const run = db.runs.find(r => r.id === "run_41")!;
  const recorded = {...run, minCases: 1, scope: {selection_id: "recorded-cohort", flow_type: "DF2"}};
  server.use(http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([recorded])), http.get("*/api/v1/projects/p2p2018/runs/run_41", () => HttpResponse.json(recorded)), http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId/selections", () => HttpResponse.json([{id:"recorded-cohort",caseTableId:run.caseTableId,datasetId:"ds_1",name:"Recorded cohort",cases:12,selection:null,createdAt:"2026-09-27"}])));
  renderApp(`/p/p2p2018/data/ds_1?caseTable=${run.caseTableId}&tab=readiness&filter=7`);
  const chooser = await screen.findByTestId("existing-assessments", {}, timeout);
  expect(chooser).toHaveTextContent("Exploring data · no assessment selected");
  const stepper = screen.getByTestId("stepper");
  expect(within(stepper).queryByRole("link", {name: "Analyse"})).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(within(chooser).getByRole("button", {name: /Open existing assessment/}));
  const heading = await screen.findByRole("heading", {name: "Saved assessments for this preparation"});
  const popup = heading.parentElement!;
  expect(popup).toHaveTextContent("Saved selection · DF2 flow only");
  const link = within(popup).getAllByRole("link").find(a => a.getAttribute("href")?.includes("run_41"))!;
  const url = new URL(link.getAttribute("href")!, "http://local");
  expect(Object.fromEntries(url.searchParams)).toEqual({tab: "monitor"});
  await user.click(link);
  await waitFor(() => expect(screen.getByTestId("ribbon-saved-selection")).toHaveTextContent("recorded-cohort"), timeout);
  await waitFor(() => expect(within(screen.getByTestId("stepper")).getByRole("link", {name:"Process norm"})).toHaveAttribute("href", expect.stringContaining("selection=recorded-cohort")), timeout);
  expect(await screen.findByRole("link", {name:"Open the ranked list"}, timeout)).toHaveAttribute("href", expect.stringContaining("minCases=1"));
  expect(within(screen.getByTestId("stepper")).getByRole("link", {name:"Improve"})).toHaveAttribute("href", expect.stringContaining("minCases=1"));
  await user.click(screen.getByRole("link", {name:"Open the ranked list"}));
  await waitFor(() => expect(screen.getByRole("link", {name:"Layers in each view"})).toHaveAttribute("href", expect.stringContaining("selection=recorded-cohort")), timeout);
  expect(screen.getByRole("link", {name:"Ranked groups"})).toHaveAttribute("href", expect.stringContaining("minCases=1"));
});

it.each(["valid", "foreign-table", "foreign-dataset", "unavailable"])("Define → Run preserves only verified saved scope: %s", async (kind) => {
  await bindProjectDataset("p2p2018", "ds_1");
  const table = db.caseTables.find(c => c.datasetId === "ds_1")!;
  const norm = db.norms[0]!;
  server.use(http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId/selections", () => kind === "unavailable" ? HttpResponse.json({detail:"unavailable"}, {status:503}) : HttpResponse.json([{id:"saved", name:"Selected items", caseTableId: kind === "foreign-table" ? "other-table" : table.id, datasetId:kind === "foreign-dataset" ? "other-data" : table.datasetId, cases:12, createdAt:"2026-09-27", selection:null}])));
  renderApp(`/p/p2p2018/norms/${norm.id}?caseTable=${table.id}&selection=saved&tab=guide`);
  const path = await screen.findByTestId("stepper", {}, timeout);
  if (kind === "valid") {
    await waitFor(() => {
      const href = within(path).getByRole("link", {name:"Run WISE"}).getAttribute("href")!;
      const url = new URL(href, "http://local");
      expect(url.pathname).toBe("/p/p2p2018/runs");
      expect(Object.fromEntries(url.searchParams)).toEqual({new:"true", caseTable:table.id, selection:"saved"});
    }, timeout);
    expect(within(path).getByRole("link", {name:"Process norm"})).toHaveAttribute("href", expect.stringContaining("selection=saved"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", {name:"Switch norm"}));
    const otherVersion = db.norms.find(n => n.id !== norm.id);
    if (!otherVersion) throw new Error("fixture needs another norm version");
    await user.click(screen.getByRole("option", {name:new RegExp(`^v${otherVersion.version}`)}));
    await waitFor(() => expect(within(path).getByRole("link", {name:"Run WISE"})).toHaveAttribute("href", expect.stringContaining("selection=saved")), timeout);
    await waitFor(() => expect(within(path).getByRole("link", {name:"Process norm"})).toHaveAttribute("href", expect.stringContaining(otherVersion.id)), timeout);
    expect(within(path).getByRole("link", {name:"Process norm"})).toHaveAttribute("href", expect.stringContaining("selection=saved"));
    await user.click(within(path).getByRole("button", {name:"All stages of your journey"}));
    const all = await screen.findByRole("list", {name:"All stages"});
    expect(within(all).getByRole("link", {name:"Assessment"})).toHaveAttribute("href", expect.stringContaining("selection=saved"));
  } else {
    await waitFor(() => expect(within(path).getByText("Run WISE").closest("[aria-disabled]"))
      .toHaveAttribute("title", "Return to the norm evidence population and choose a cohort from this preparation"), timeout);
    expect(within(path).queryByRole("link", {name:"Run WISE"})).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", {name:"Switch norm"})).toBeDisabled();
  }
});

it("keeps all context and tools keyboard-reachable in the compact ribbon", async () => {
  const original = window.matchMedia;
  const media = vi.spyOn(window, "matchMedia").mockImplementation(query => ({...original(query), matches: query === "(max-width: 1023px)"}));
  const app = renderApp("/p/p2p2018/runs/run_41/backlog");
  try {
    const trigger = await screen.findByRole("button", {name:"More context and settings"}, timeout);
    expect(trigger).toHaveTextContent("Settings");
    const user = userEvent.setup();
    trigger.focus(); await user.keyboard("{Enter}");
    const menu = await screen.findByTestId("ribbon-more");
    expect(within(menu).getByRole("heading", {name:"Analysis context"})).toBeVisible();
    expect(within(menu).getByRole("button", {name:/Help/})).toBeVisible();
    expect(within(menu).getByRole("button", {name:/Search|Command/})).toBeVisible();
    expect(within(menu).getByTestId("ribbon-project-dataset")).toBeVisible();
    await expectNoSeriousA11yViolations(menu);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  } finally { app.unmount(); media.mockRestore(); }
});


it("keeps an explicit browsing minimum of 20 when the saved assessment minimum is 1", async () => {
  const recorded = {...db.runs.find(r => r.id === "run_41")!, minCases:1};
  server.use(http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([recorded])), http.get("*/api/v1/projects/p2p2018/runs/run_41", () => HttpResponse.json(recorded)));
  renderApp("/p/p2p2018/runs/run_41/backlog?minCases=20");
  const stepper = await screen.findByTestId("stepper", {}, timeout);
  await waitFor(() => {
    for (const name of ["Improve", "Ranked groups", "Choose a group for evidence"]) {
      const href = within(stepper).getByRole("link", {name}).getAttribute("href")!;
      expect(new URL(href, "http://local").searchParams.get("minCases")).toBe("20");
    }
  }, timeout);
});


it("opens a Runs table result with that assessment's saved minimum", async () => {
  const recorded = {...db.runs.find(r => r.id === "run_41")!, minCases:1};
  server.use(http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([recorded])));
  renderApp("/p/p2p2018/runs");
  const link = await screen.findByRole("link", {name:"Backlog"}, timeout);
  const url = new URL(link.getAttribute("href")!, "http://local");
  expect(url.pathname).toBe("/p/p2p2018/runs/run_41/backlog");
  expect(url.searchParams.get("minCases")).toBe("1");
});
