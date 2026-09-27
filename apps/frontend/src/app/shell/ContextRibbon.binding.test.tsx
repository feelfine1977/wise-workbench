import { screen, within, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { renderApp } from "@/test/utils";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { bindProjectDataset } from "@/lib/api/projectBinding";

function otherDataset() {
  db.datasets.push({ ...db.datasets[0]!, id: "o2c", name: "O2C example" });
  db.caseTables.push({ ...db.caseTables[0]!, id: "ct-o2c", datasetId: "o2c" });
}
it("never picks the first dataset for an unbound project without an explicit preview", async () => {
  otherDataset(); db.projects[0]!.latestRunId = null;
  renderApp("/p/p2p2018");
  await waitFor(() => expect(screen.getByTestId("ribbon-project-dataset")).toHaveTextContent("Project dataset not fixed"));
  const path = screen.getByTestId("stepper");
  expect(within(path).getByRole("link", { name: "Understand data" }).getAttribute("href")).toBe("/p/p2p2018/data");
  expect(screen.queryByRole("combobox", { name: /Switch dataset/i })).not.toBeInTheDocument();
});
it("shows a fixed label and stable dataset links on a later step", async () => {
  otherDataset(); await bindProjectDataset("p2p2018", "ds_1");
  renderApp("/p/p2p2018/runs");
  await waitFor(() => expect(screen.getByTestId("ribbon-project-dataset")).toHaveTextContent("Project dataset (fixed):BPI_Challenge_2019.csv"));
  expect(screen.queryByRole("combobox", { name: /Switch dataset/i })).not.toBeInTheDocument();
  const link = within(screen.getByTestId("stepper")).getByRole("link", { name: "Understand data" });
  expect(link.getAttribute("href")).toContain("/data/ds_1"); expect(link.getAttribute("href")).not.toContain("o2c");
});
it("labels historical data honestly and returns to the fixed dataset without a foreign mapping", async () => {
  otherDataset(); await bindProjectDataset("p2p2018", "o2c");
  renderApp("/p/p2p2018/runs/run_41/backlog");
  const alert = await screen.findByTestId("dataset-binding-conflict");
  expect(alert).toHaveTextContent("historical assessment uses BPI_Challenge_2019.csv");
  expect(alert).toHaveTextContent("Project dataset remains fixed to O2C example");
  expect(screen.getByTestId("ribbon-project-dataset")).toHaveTextContent("Assessment dataset: BPI_Challenge_2019.csv");
  const path = screen.getByTestId("stepper");
  const dataLink = within(path).getByRole("link", { name: "Understand data" });
  expect(dataLink.getAttribute("href")).toContain("/data/o2c"); expect(dataLink.getAttribute("href")).not.toContain("caseTable=");
  expect(within(path).getByRole("link", { name: "Process norm" }).getAttribute("href")).not.toContain("caseTable=");
});
it("identifies the saved cohort by metadata and uses the selected assessment count", async () => {
  const run = db.runs.find((r) => r.id === "run_41")!;
  run.scope = { selection_id: "selection-a" }; if (!run.manifest) throw new Error("fixture needs manifest"); run.manifest.cases = 17;
  server.use(http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId/selections", () => HttpResponse.json([{ id: "selection-a", name: "Late deliveries", cases: 100, datasetId: "ds_1", caseTableId: run.caseTableId }])));
  renderApp("/p/p2p2018/runs/run_41/backlog");
  await waitFor(() => expect(screen.getByTestId("ribbon-saved-selection")).toHaveTextContent("Late deliveries"));
  expect(screen.getByTestId("ribbon-saved-selection")).toHaveTextContent("selection-a · 17 cases in this assessment");
  expect(screen.getByTestId("ribbon-saved-selection")).not.toHaveTextContent("100 cases");
});
it("retains cohort identity when metadata is unavailable and does not invent its count", async () => {
  const run = db.runs.find((r) => r.id === "run_41")!; run.scope = { selection_id: "selection-unavailable" }; run.manifest = undefined;
  server.use(http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId/selections", () => HttpResponse.json({ detail: "unavailable" }, { status: 503 })));
  renderApp("/p/p2p2018/runs/run_41/backlog");
  const cohort = await screen.findByTestId("ribbon-saved-selection");
  expect(cohort).toHaveTextContent("Saved analysis filter: selection-unavailable · case count unavailable");
});
it("shows a binding failure instead of presenting a dataset switcher", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/dataset-binding", () => HttpResponse.json({ detail: "unavailable" }, { status: 503 })));
  renderApp("/p/p2p2018/runs");
  await screen.findByText("The project dataset binding could not be verified. Reload before continuing.");
  expect(screen.getByTestId("ribbon-project-dataset")).toHaveTextContent("Project dataset unavailable");
  expect(screen.queryByRole("combobox", { name: /Switch dataset/i })).not.toBeInTheDocument();
});
