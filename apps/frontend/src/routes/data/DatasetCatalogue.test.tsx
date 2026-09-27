import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/mocks/node";
import { createJob } from "@/mocks/db";
import { renderApp } from "@/test/utils";

const catalogue = {
  projects: [
    { id: "p2p2018", name: "Purchasing", process: "p2p", datasets: [{ id: "ds_1", name: "Purchasing.csv", status: "ready", events: 42 }] },
    { id: "sales", name: "Sales project", process: null, datasets: [] },
  ],
  workspaces: [{ name: "Order-to-cash", origin: "http://127.0.0.1:8012", projectId: "o2c_project", description: "Existing sales analysis." }],
  imports: [
    { id: "local", name: "Local CSV", path: "/configured/local.csv", description: "Mapping required.", available: true, reason: null },
    { id: "xes", name: "Local XES", path: "/configured/local.xes", description: "", available: false, reason: "XES importer is not installed on this server." },
  ],
  warning: null,
};

describe("dataset catalogue", () => {
  it("separates project datasets, workspace navigation and local import candidates", async () => {
    server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json(catalogue)));
    renderApp("/p/p2p2018/data?caseTable=ct_1");
    const card = await screen.findByRole("region", { name: "Choose where to work" });
    await within(card).findByText("Purchasing.csv · imported · 42 events");
    expect(within(card).getByText(/no file selection or upload is needed/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Purchasing.csv · imported · 42 events" })).toHaveAttribute("href", "/p/p2p2018/data/ds_1?tab=mapping");
    expect(within(card).getByRole("link", { name: "Open project" })).toHaveAttribute("href", "/p/sales/data");
    const external = within(card).getByRole("link", { name: "Open Order-to-cash" });
    expect(external).toHaveAttribute("href", "http://127.0.0.1:8012/p/o2c_project/data");
    expect(external.getAttribute("href")).not.toContain("caseTable");
    expect(within(card).getByText("Local dataset catalogue (2)")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Import Local CSV" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Import Local XES" })).toBeDisabled();
    expect(within(card).getByText(/mapping and review required/)).toBeInTheDocument();
  });

  it("starts an import only after the chosen local entry is clicked", async () => {
    const imported: string[] = [];
    server.use(
      http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json(catalogue)),
      http.post("*/api/v1/projects/:projectId/dataset-catalogue/imports/:entryId", ({ params }) => {
        imported.push(String(params.entryId));
        return HttpResponse.json(createJob("ingest", "Import local", { kind: "dataset", id: "ds_1" }, 1), { status: 202 });
      }),
    );
    renderApp("/p/p2p2018/data");
    await screen.findByText("Local dataset catalogue (2)");
    expect(imported).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Import Local CSV" }));
    await screen.findByText(/Import started/);
    expect(imported).toEqual(["local"]);
  });

  it("keeps current projects visible when registry configuration is invalid", async () => {
    server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({ ...catalogue, workspaces: [], imports: [], warning: "Check workspace-links.json" })));
    renderApp("/p/p2p2018/data");
    await screen.findByText("Check workspace-links.json");
    expect(screen.getByText("Purchasing.csv · imported · 42 events")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Order-to-cash" })).not.toBeInTheDocument();
  });

  it("shows request failures with retry instead of inventing dataset choices", async () => {
    server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({ title: "Catalogue unavailable" }, { status: 503 })));
    renderApp("/p/p2p2018/data");
    const card = await screen.findByRole("region", { name: "Choose where to work" });
    await within(card).findByText("Catalogue unavailable");
    expect(within(card).queryByRole("link", { name: "Open Order-to-cash" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});


it("shows sourced process context, filters entries and opens an existing import without uploading", async () => {
  server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({
    ...catalogue,
    imports: [{ ...catalogue.imports[0], name: "BPIC15_1", available: false, reason: "Source missing", dataset: { id: "ds_1", name: "BPIC15_1", status: "ready", events: 42 }, context: {
      title: "BPI Challenge 2015 · Municipality 1",
      processDescription: "Building-permit applications and objections in municipality 1.",
      challengeDescription: "Compare roles, throughput and control flow across municipalities.",
      sources: [{ title: "Official challenge", url: "https://research.tue.nl/nl/publications/bpi-challenge-2015/" }],
    } }, catalogue.imports[1]],
  })));
  renderApp("/p/p2p2018/data?caseTable=ct_1");
  const card = await screen.findByRole("region", { name: "Choose where to work" });
  await within(card).findByText(/Building-permit applications/);
  const open = within(card).getByRole("link", { name: "Open BPIC15_1" });
  expect(open).toHaveAttribute("href", "/p/p2p2018/data/ds_1?tab=mapping");
  expect(within(card).queryByRole("button", { name: "Import BPIC15_1" })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByText("Official challenge and sources"));
  expect(within(card).getByText(/Compare roles, throughput/)).toBeVisible();
  expect(within(card).getByRole("link", { name: /Official challenge:/ })).toHaveAttribute("href", "https://research.tue.nl/nl/publications/bpi-challenge-2015/");
  await userEvent.type(within(card).getByRole("searchbox", { name: "Find a local dataset" }), "municipality");
  expect(open).toBeVisible();
  expect(within(card).queryByRole("button", { name: "Import Local XES" })).not.toBeInTheDocument();
});

it("shows ingestion failures and allows an explicit retry", async () => {
  server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({ ...catalogue, imports: [
    { ...catalogue.imports[0], dataset: { id: "failed", name: "Local CSV", status: "failed", error: "Invalid XES content" } },
  ] })));
  renderApp("/p/p2p2018/data");
  expect(await screen.findByText("Previous import failed: Invalid XES content")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry Local CSV" })).toBeEnabled();
});

it("does not start another import while the catalogue source is ingesting", async () => {
  server.use(http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({ ...catalogue, imports: [
    { ...catalogue.imports[0], dataset: { id: "pending", name: "Local CSV", status: "ingesting" } },
  ] })));
  renderApp("/p/p2p2018/data");
  expect(await screen.findByRole("button", { name: "Importing Local CSV" })).toBeDisabled();
});
