import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { App } from "@/app/providers";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { projectBindingQuery } from "@/lib/api/projectBinding";
import { caseTableQuery, caseTablesQuery, datasetsQuery } from "@/lib/queries";
import { makeTestQueryClient } from "@/test/utils";

// Route integration uses the real exploration component; chart drawing needs a browser canvas.
vi.mock("@/components/charts/EChart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

const projectId = "p2p2018";
const LOAD = { timeout: 8000 };
function mount({ bound = true, tableReady = true }: { bound?: boolean; tableReady?: boolean } = {}) {
  const table = db.caseTables[0]!;
  const binding = { projectId, datasetId: bound ? table.datasetId : null, boundAt: bound ? "2026-09-27T00:00:00Z" : null };
  server.use(http.get("*/api/v1/projects/p2p2018/dataset-binding", () => HttpResponse.json(binding)));
  const client = makeTestQueryClient();
  client.setQueryData(projectBindingQuery(projectId).queryKey, binding);
  client.setQueryData(datasetsQuery(projectId).queryKey, db.datasets);
  if (tableReady) {
    client.setQueryData(caseTablesQuery(projectId).queryKey, db.caseTables);
    client.setQueryData(caseTableQuery(projectId, table.id).queryKey, table);
  }
  const history = createMemoryHistory({ initialEntries: ["/projects", `/p/${projectId}/data`], initialIndex: 1 });
  const view = render(<App queryClient={client} history={history} />);
  return { table, history, view, client };
}

it("replaces a bound project's data entry with its dataset overview and matching prepared table", async () => {
  const { table, history } = mount();
  await screen.findByRole("region", { name: "Data dictionary" }, LOAD);
  expect(history.location.pathname).toBe(`/p/${projectId}/data/${table.datasetId}`);
  const search = new URLSearchParams(history.location.search);
  expect(search.get("tab")).toBe("overview"); expect(search.get("caseTable")).toBe(table.id);
  expect(screen.getByRole("tab", { name: "Explore data" })).toHaveAttribute("data-state", "active");
  expect(screen.getByRole("region", { name: "Data dictionary" })).toBeVisible();
  expect(screen.queryByText("Analyse another dataset")).not.toBeInTheDocument();
  expect(screen.queryByText("Continue with your dataset")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use this dataset for project" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Column mapping" })).not.toBeInTheDocument();
  expect(history.length).toBe(2);
  await act(async () => { history.back(); });
  await waitFor(() => expect(history.location.pathname).toBe("/projects"));
});

it("opens the bound overview immediately without an initial case table, then explores when that table arrives", async () => {
  const tables = structuredClone(db.caseTables);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.use(
    http.get("*/api/v1/projects/p2p2018/case-tables", async () => { await gate; return HttpResponse.json(tables); }),
    http.get("*/api/v1/projects/p2p2018/case-tables/:id", async ({ params }) => { await gate; return HttpResponse.json(tables.find(table => table.id === params.id)); }),
  );
  const { table, history } = mount({ tableReady: false });
  try {
    await waitFor(() => expect(history.location.pathname).toBe(`/p/${projectId}/data/${table.datasetId}`), LOAD);
    expect(new URLSearchParams(history.location.search).get("tab")).toBe("overview");
    expect(new URLSearchParams(history.location.search).has("caseTable")).toBe(false);
    expect(screen.queryByText("Analyse another dataset")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Data and mapping" })).not.toBeInTheDocument();
  } finally { release(); }
  await screen.findByRole("region", { name: "Data dictionary" }, LOAD);
  expect(screen.getByRole("tab", { name: "Explore data" })).toHaveAttribute("data-state", "active");
  expect(history.location.pathname).toBe(`/p/${projectId}/data/${table.datasetId}`);
  expect(history.length).toBe(2);
});

it("preserves dataset selection and intake when the project is unbound", async () => {
  const { history } = mount({ bound: false });
  expect(await screen.findByRole("heading", { name: "Data and mapping" }, LOAD)).toBeVisible();
  expect(screen.getByRole("button", { name: "Choose file…" })).toBeVisible();
  expect(await screen.findByRole("region", { name: "Choose where to work" }, LOAD)).toBeVisible();
  expect(history.location.pathname).toBe(`/p/${projectId}/data`);
  expect(history.length).toBe(2);
  expect(screen.queryByRole("tab", { name: "Explore data" })).not.toBeInTheDocument();
});
