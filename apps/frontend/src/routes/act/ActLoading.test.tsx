import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";

const PATH = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}/act?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation`;
const API = "*/api/v1/projects/p2p2018/runs";
const missing = "This run does not exist in this workspace.";

it("keeps a pending assessment distinct from a missing run", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  server.use(http.get(API, async () => { requested = true; await pending; return HttpResponse.json(db.runs); }));
  renderApp(PATH);
  try {
    await waitFor(() => expect(requested).toBe(true));
    expect(screen.queryByText(missing)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  } finally { release(); }
  await screen.findAllByTestId("driver-card", {}, {timeout:8000});
  expect(screen.queryByText(missing)).not.toBeInTheDocument();
});

it("offers retry after run loading fails instead of declaring the run missing", async () => {
  let failed = true;
  server.use(http.get(API, () => failed ? HttpResponse.json({detail:"Unavailable"}, {status:503}) : HttpResponse.json(db.runs)));
  renderApp(PATH);
  expect(await screen.findByTestId("error-sentence", {}, {timeout:8000})).toHaveTextContent("could not answer just now");
  expect(screen.queryByText(missing)).not.toBeInTheDocument();
  failed = false;
  await userEvent.setup().click(screen.getByRole("button", {name:"Try again"}));
  await screen.findAllByTestId("driver-card", {}, {timeout:8000});
});

it("reports absence only after the run list has loaded", async () => {
  server.use(http.get(API, () => HttpResponse.json([])));
  renderApp(PATH);
  expect(await screen.findByText(missing, {}, {timeout:8000})).toBeVisible();
});


it("does not claim there are no findings when a collection request fails", async () => {
  let failed = true;
  server.use(http.get("*/api/v1/projects/p2p2018/actions", () => failed ? HttpResponse.json({detail:"Unavailable"}, {status:503}) : HttpResponse.json([])), http.get("*/api/v1/projects/p2p2018/hypotheses", () => HttpResponse.json([])));
  renderApp(PATH);
  const findings = await screen.findByTestId("open-findings", {}, {timeout:8000});
  const queries = within(findings);
  expect(await queries.findByRole("alert")).toHaveTextContent("could not answer just now");
  expect(queries.queryByText(/Nothing is recorded/)).not.toBeInTheDocument();
  failed = false;
  await userEvent.click(queries.getByRole("button", {name:"Try again"}));
  expect(await queries.findByText(/Nothing is recorded/)).toBeVisible();
});
