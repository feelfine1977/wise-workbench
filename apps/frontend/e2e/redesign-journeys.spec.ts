import { expect, test } from "@playwright/test";

// Role-based task scripts with deterministic fixtures. These are not human usability sessions.
test.skip(!!process.env.E2E_API_URL, "fixtures are served only by the mock build");
const query = `slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;
const group = encodeURIComponent('["companyID_0000", "Packaging"]');

test("beginner: explore context, retain a selection across pages, undo, and find guidance", async ({ page }) => {
  await page.goto("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=overview&explore=context");
  const summary = page.getByRole("status").filter({ hasText: /cases selected/ });
  await expect(summary).toContainText("6 of 6", { timeout: 30000 });
  await page.getByRole("group", { name: "flow_type chart" }).getByRole("button", { name: /^DF1:/ }).click();
  await expect(summary).toContainText("2 of 6");
  await page.getByRole("navigation", { name: "Exploration pages" }).getByRole("button", { name: /Case evidence/ }).click();
  await expect(page.getByRole("region", { name: "Selected case details" })).toContainText("demo-001");
  await expect(summary).toContainText("2 of 6");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(summary).toContainText("6 of 6");
  await page.locator("summary", { hasText: "How to explore" }).click();
  await expect(page.getByText("One selection follows all four pages.", { exact: false })).toBeVisible();
});

test("analyst: default ranking exposes scores and denominators, advanced measures are optional", async ({ page }) => {
  await page.goto(`/p/p2p2018/runs/run_41/backlog?${query}`);
  const table = page.getByRole("grid", { name: "Backlog" });
  await expect(table).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab", { name: "Table", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(table.getByRole("columnheader", { name: /Score/ })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /Cases/ })).toBeVisible();
  await page.getByLabel("Show all measures").check();
  await expect(table.getByRole("columnheader", { name: /^priority, small groups discounted/ })).toBeVisible();
  await page.getByLabel("Show all measures").uncheck();
  await expect(table.getByRole("columnheader", { name: /Score/ })).toBeVisible();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  }
  await page.getByRole("button", { name: "More context and settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("process owner: distinguish score scenario from measured evidence, open an action proposal", async ({ page }) => {
  await page.goto(`/p/p2p2018/runs/run_41/slices/${group}/act?${query}`);
  const cards = page.getByTestId("driver-card");
  await expect(cards.first()).toBeVisible({ timeout: 30000 });
  await expect(cards.first()).toContainText("no operational benefit is estimated");
  await expect(page.getByText("This is a ceiling under the norm, not a forecast of an action’s effect.", { exact: false })).toBeVisible();
  await cards.first().getByRole("button", { name: "Propose this action" }).first().click();
  const form = page.getByRole("form", { name: "Propose an action" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("What should be done")).not.toHaveValue("");
  await form.getByLabel("Who is proposing it").fill("Process owner review");
  await expect(form.getByRole("button", { name: "Save the proposal" })).toBeVisible();
  // Opening an evidence-linked draft must not silently save a proposal.
  await expect(page.getByTestId("open-findings")).not.toContainText("Process owner review");
});
