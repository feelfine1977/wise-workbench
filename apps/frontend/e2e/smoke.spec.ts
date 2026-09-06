import { expect, test } from "@playwright/test";

/** CP-B1 smoke on mocks: upload → mapping → readiness → backlog → slice. */
test("upload to backlog on mock data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("P2P 2018", { timeout: 20_000 });
  await expect(page.getByRole("banner")).toContainText("mock data");

  // S1: upload a small CSV; the ingest job appears in the tray and finishes
  await page.goto("/p/p2p2018/data");
  await page.setInputFiles("#dataset-file", { name: "smoke.csv", mimeType: "text/csv", buffer: Buffer.from("case,activity,time\n1,Create Purchase Order Item,2018-01-02\n1,Record Goods Receipt,2018-01-14\n") });
  const tray = page.getByRole("region", { name: "Jobs" });
  await expect(tray).toContainText("Ingest smoke.csv");
  await expect(tray.getByRole("button", { name: "Open result" })).toBeVisible({ timeout: 20_000 });
  await tray.getByRole("button", { name: "Open result" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("smoke.csv");
  // collapse the tray to its header so it no longer covers the bottom-right of the form
  await tray.getByRole("button", { name: /^Jobs/ }).click();
  await expect(tray.getByRole("button", { name: "Open result" })).toBeHidden();

  // S2: map columns and build the case table; the readiness report appears
  await expect(page.getByText("Column profiler")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("checkbox", { name: "Vendor creates invoice" }).check();
  const build = page.getByRole("button", { name: "Validate and build case table" });
  await build.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await build.click();
  await expect(page.getByText(/Data readiness/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Header events typed away/)).toBeVisible();

  // S6: backlog explorer with filters in the URL and keyboard navigation
  await page.goto("/p/p2p2018/runs/run_41/backlog?slicing=vendor&view=Finance&hotspotType=mechanism");
  const grid = page.getByRole("grid", { name: "Backlog" });
  await expect(grid).toBeVisible({ timeout: 20_000 });
  await expect(grid.getByRole("columnheader", { name: /stable_PI/ })).toBeVisible();
  expect(page.url()).toContain("hotspotType=mechanism");
  await page.reload();
  await expect(grid).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain("hotspotType=mechanism");
  const rows = grid.getByRole("row");
  await expect(rows.nth(1)).toBeVisible();
  await rows.nth(1).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("p");
  await expect(page.getByRole("region", { name: "Comparison strip" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Gap waterfall by constraint/)).toBeVisible();
});
