import { expect, test } from "@playwright/test";

/**
 * CP-B1 smoke on mocks: upload → mapping → readiness with a decision → flow types → signals list (Refine, chips)
 * → the first click on Why? → the reason chain (flow first, expectations in plain words) → freeze → notebook.
 */
test.skip(!!process.env.E2E_API_URL, "the mock build is not served when E2E_API_URL points at a live backend");

test("upload to the ranked list, Why? on the first click, freeze into the notebook (mock data)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("P2P 2018", { timeout: 20_000 });
  await expect(page.getByRole("banner")).toContainText("mock data");
  // the analysis path across the top of every screen
  const stepper = page.getByRole("navigation", { name: "Analysis path" });
  await expect(stepper).toContainText("Data");
  await expect(stepper).toContainText("What to do");
  // the dashboard leads with one sentence and the flow types
  await expect(page.getByTestId("top-signal")).toContainText("companyID_0000 × Packaging");
  await expect(page.getByRole("list", { name: "Flow types" })).toContainText("DF2");

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

  // S2: map columns and build the case table; the readiness report appears with its decisions
  await expect(page.getByText("Column profiler")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("checkbox", { name: "Vendor creates invoice" }).check();
  const build = page.getByRole("button", { name: "Validate and build case table" });
  await build.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await build.click();
  await expect(page.getByText(/Data readiness/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Header events typed away/)).toBeVisible();
  await expect(page.getByTestId("readiness-decisions")).toBeVisible();
  // a decision: preview, note, apply
  await page.getByRole("button", { name: /Collapse exact duplicates/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Preview the effect" }).click();
  await expect(dialog.getByTestId("decision-preview")).toContainText("180,913");
  await dialog.getByLabel("note *").fill("duplicates come from the export");
  await dialog.getByRole("button", { name: /Apply and rebuild/ }).click();
  await expect(page.getByTestId("decisions-list")).toContainText("Collapse exact duplicates", { timeout: 20_000 });
  // the flow types at the data step
  await page.getByRole("tab", { name: "Your process" }).click();
  await expect(page.getByRole("list", { name: "Flow types" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("flow-fork").getByRole("button", { name: "Analyse per flow type" })).toBeVisible();

  // S6: the signals list is the default view; the kind filter lives in the URL as a chip and survives a reload
  await page.goto(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance&kind=systematic`);
  const list = page.getByRole("list", { name: "Signals" });
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ranking-rule")).toContainText("groups of purchase order items by Vendor");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("systematic");
  expect(page.url()).toContain("kind=systematic");
  await page.reload();
  await expect(list).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain("kind=systematic");
  const cards = list.getByRole("article");
  await expect(cards.first()).toContainText("vendorID_0136");
  await expect(cards.first()).toContainText("purchase order items");
  await expect(cards.first().getByRole("button", { name: /^Why\?/ })).toBeVisible();
  // the Refine drawer holds the filter questions
  await page.getByRole("button", { name: /^Refine/ }).click();
  await expect(page.getByRole("dialog", { name: "Refine the list" })).toContainText("Only groups with at least … cases");
  await page.keyboard.press("Escape");

  // keyboard: ↓ moves, p pins into the comparison strip
  await cards.first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("p");
  await expect(page.getByRole("region", { name: "Comparison strip" })).toBeVisible();

  // the metric table and the scatter are secondary tabs
  await page.getByRole("tab", { name: "Table" }).click();
  const grid = page.getByRole("grid", { name: "Backlog" });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: /^priority, small groups discounted/ })).toBeVisible();
  await page.getByRole("tab", { name: "Signals" }).click();

  // the first click on Why? of a non-active card opens the reason chain, flow first
  const third = cards.nth(2);
  const thirdName = (await third.getByRole("heading", { level: 3 }).textContent()) ?? "";
  await third.getByRole("button", { name: /^Why\?/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(thirdName, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Where in the flow" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("flow-map")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Which expectations are missed" }).click();
  await expect(page.getByTestId("top-drivers")).toContainText("explains");
  await expect(page.getByTestId("typical-causes")).toContainText("cycle 3");

  // freeze the screen into the notebook
  await page.getByRole("button", { name: /^Freeze this screen/ }).click();
  const freeze = page.getByRole("dialog", { name: "Freeze this screen" });
  await freeze.getByLabel("note").fill("the first reason screen of the smoke run");
  await freeze.getByRole("button", { name: "Freeze" }).click();
  await expect(page.getByText(/^Frozen/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "open the notebook" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Analysis notebook");
  const snapshots = page.getByRole("list", { name: "Snapshots" });
  await expect(snapshots.getByRole("listitem")).toHaveCount(1);
  await expect(snapshots).toContainText("the first reason screen of the smoke run");
  await expect(snapshots.locator("img")).toBeVisible();

  // the back control returns to the reason screen
  await page.getByTestId("back-control").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(thirdName);
});
