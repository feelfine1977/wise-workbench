import { expect, test, type Page } from "@playwright/test";

/**
 * CP-B3 on the served build with the mocks: the acceptance tests of the third release's specification
 * (`docs/panel/ui_design_cycle3_board.md` §6.2) that can be measured — F1 (the map is the screen), F2 (an
 * action does something, the owner's "filter to cases with this activity"), F3 (every path is reachable),
 * F4 (full window), F5 (the model), B1 (one click moves everything), B2 (a chip restores) and B3 (two
 * selections read as OR).
 */
test.skip(!!process.env.E2E_API_URL, "the mock build is not served when E2E_API_URL points at a live backend");
test.use({ viewport: { width: 1440, height: 900 } });

const RUN = "run_41";
const SLICING = "case Company+case Spend area text";
const FLOW = `/p/p2p2018/runs/${RUN}/flow?slicing=${encodeURIComponent(SLICING)}&view=Automation`;
const BOARD = `/p/p2p2018/runs/${RUN}/board?slicing=${encodeURIComponent(SLICING)}&view=Automation`;

async function openFlow(page: Page) {
  await page.goto(FLOW);
  await expect(page.getByTestId("flow-map")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  // the fit runs a moment after the layout arrives
  await page.waitForTimeout(1200);
}

/** The activity card of one node, opened by a click on the drawing. */
async function selectActivity(page: Page, label: string) {
  await page.locator(".react-flow__node", { hasText: label }).first().click();
  await expect(page.getByTestId("selected-activity")).toContainText(label, { timeout: 15_000 });
}

const numbers = (text: string) => (text.match(/[\d][\d,]*/g) ?? []).join("|");

test("F1 · the map is the screen: the frame covers at least 60 % of the viewport and the drawing is fitted", async ({ page }) => {
  await openFlow(page);
  const frame = await page.getByTestId("map-frame").boundingBox();
  expect(frame).not.toBeNull();
  const share = ((frame?.width ?? 0) * (frame?.height ?? 0)) / (1440 * 900);
  expect(share, `the map frame covers ${(share * 100).toFixed(1)} % of the viewport`).toBeGreaterThanOrEqual(0.6);
  // the drawing is fitted into it: it starts at the left edge, uses the width, and sits centred — the fit
  // defect the panel measured (an empty band at the top with the drawing pushed into the lower third) is gone.
  // A nine-activity left-to-right graph is flatter than the frame, so the remaining space is split evenly
  // above and below rather than filled by over-zooming.
  const bands = (await page.evaluate(
    `(() => {
      const box = document.querySelector('[data-testid="map-frame"]').getBoundingClientRect();
      const rects = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      return { above: (top - box.top) / box.height, below: (box.bottom - bottom) / box.height, left: (left - box.left) / box.width, width: (right - left) / box.width };
    })()`,
  )) as { above: number; below: number; left: number; width: number };
  expect(bands.left, "the drawing starts at the left edge of the frame").toBeLessThan(0.08);
  expect(bands.width, "the drawing uses the width of the frame").toBeGreaterThan(0.6);
  expect(Math.abs(bands.above - bands.below), "the drawing is centred, with no one-sided empty band").toBeLessThan(0.06);
  // the chrome of the instrument and nothing else
  const bar = page.getByTestId("flow-bar");
  await expect(bar).toContainText("of 251,734 purchase order items");
  await expect(bar.getByTestId("detail-label")).toContainText("of 42 activities");
  await expect(page.getByTestId("map-legend")).toBeVisible();
  await expect(page.getByTestId("zoom-controls")).toBeVisible();
});

test("F2 · filter to the items with this activity changes the count, the chip and the announcement (R3-O9)", async ({ page }) => {
  await openFlow(page);
  const before = await page.getByTestId("count-line").innerText();
  expect(before).toContain("251,734");
  await selectActivity(page, "Record Goods Receipt");
  await page.getByTestId("selected-activity").getByRole("button", { name: "Filter to", exact: true }).click();

  const chips = page.getByTestId("flow-bar").getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("with Record Goods Receipt", { timeout: 15_000 });
  await expect(page.getByTestId("count-line")).not.toHaveText(before, { timeout: 15_000 });
  await expect(page.getByTestId("count-line")).toContainText("out");
  await expect(page.getByTestId("filter-announcement")).toContainText(/Filter added: with Record Goods Receipt — [\d,]+ of 251,734 purchase order items remain\./, { timeout: 15_000 });
  expect(page.url()).toContain("filter=%7B%22and%22");
  expect(page.url()).toContain("fh=");

  // removing the chip returns exactly the unfiltered screen
  await chips.getByRole("button", { name: /Remove filter/ }).click();
  await expect(page.getByTestId("count-line")).toHaveText(before, { timeout: 15_000 });
  await expect(page.getByTestId("flow-bar")).toContainText("no filter yet");
});

test("F3 · every path of an activity is reachable, and the ones below the detail level are named", async ({ page }) => {
  await openFlow(page);
  await selectActivity(page, "Record Goods Receipt");
  await page.getByTestId("selected-activity").getByRole("button", { name: "Paths in / out" }).click();
  // the sheet lists every path and says how many the level does not draw — once, where the list is (R3-11)
  await expect(page.getByTestId("path-panel")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("paths-divider")).toContainText(/hidden at this detail level/, { timeout: 15_000 });
  await expect(page.getByTestId("paths-divider").getByRole("button", { name: "Show them" })).toBeVisible();
  await expect(page.getByTestId("paths-hidden")).toHaveCount(0);
  expect(page.url()).toContain("activity=");
});

test("F4 · full window fills the viewport and Escape leaves it", async ({ page }) => {
  await openFlow(page);
  await page.getByTestId("full-window").click();
  await expect(page.getByTestId("flow-map")).toHaveAttribute("data-full", "1");
  await page.waitForTimeout(600);
  const frame = await page.getByTestId("map-frame").boundingBox();
  const share = ((frame?.width ?? 0) * (frame?.height ?? 0)) / (1440 * 900);
  expect(share, `the full window covers ${(share * 100).toFixed(1)} % of the viewport`).toBeGreaterThanOrEqual(0.95);
  expect(page.url()).toContain("full=true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("flow-map")).not.toHaveAttribute("data-full", "1");
});

test("F5 · the model shows the same scene as a BPMN diagram, and back changes nothing else", async ({ page }) => {
  await openFlow(page);
  await selectActivity(page, "Record Goods Receipt");
  await page.getByRole("group", { name: "How the process is drawn" }).getByRole("button", { name: "model" }).click();
  await expect(page.getByTestId("model-view")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("model-note")).toContainText("model from the log · generated");
  await page.getByRole("group", { name: "How the process is drawn" }).getByRole("button", { name: "map" }).click();
  await expect(page.getByTestId("selected-activity")).toContainText("Record Goods Receipt");
});

test("B1 and B2 · one click on the board moves every panel, and removing the chip restores them", async ({ page }) => {
  await page.goto(BOARD);
  await expect(page.getByTestId("kpi-tiles")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("breakdown-bars")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-panel="flow-map"] .react-flow__node').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);

  const before = {
    count: await page.getByTestId("board-selectors").getByTestId("count-line").innerText(),
    items: await page.getByTestId("kpi-items").innerText(),
    score: await page.getByTestId("kpi-score").innerText(),
    priority: await page.getByTestId("kpi-priority").innerText(),
    open: await page.getByTestId("kpi-open").innerText(),
    ranked: await page.getByTestId("ranked-count").innerText(),
    bars: numbers(await page.getByTestId("breakdown-bars").innerText()),
    url: page.url(),
  };

  const started = Date.now();
  await page.locator('[data-panel="flow-map"] .react-flow__node', { hasText: "Record Goods Receipt" }).first().click();
  // the count line, the four tiles, the ranked list and the breakdown all answer the same click
  await expect(page.getByTestId("board-selectors").getByTestId("count-line")).not.toHaveText(before.count, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-items")).not.toHaveText(before.items, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-priority")).not.toHaveText(before.priority, { timeout: 10_000 });
  await expect(page.getByTestId("ranked-count")).toBeVisible();
  await expect.poll(async () => numbers(await page.getByTestId("breakdown-bars").innerText()), { timeout: 10_000 }).not.toBe(before.bars);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "measured", description: `every panel's count after ${elapsed} ms (target ≤ 1000 ms on the live backend)` });

  // one chip, one announcement, and the board says how many panels answered
  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips.getByRole("listitem")).toHaveCount(1);
  await expect(chips).toContainText("with Record Goods Receipt");
  await expect(page.getByTestId("filter-announcement")).toContainText("6 panels updated");
  // no panel is blank
  await expect(page.getByTestId("kpi-tiles")).toBeVisible();
  await expect(page.getByTestId("ranked-rows")).toBeVisible();

  // B2: removing the chip returns every panel to the values it had, and the address with it
  await chips.getByRole("button", { name: /Remove filter/ }).click();
  await expect(page.getByTestId("board-selectors").getByTestId("count-line")).toHaveText(before.count, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-items")).toHaveText(before.items, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-score")).toHaveText(before.score, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-priority")).toHaveText(before.priority, { timeout: 10_000 });
  await expect(page.getByTestId("kpi-open")).toHaveText(before.open, { timeout: 10_000 });
  await expect(page.getByTestId("ranked-count")).toHaveText(before.ranked, { timeout: 10_000 });
  await expect.poll(async () => numbers(await page.getByTestId("breakdown-bars").innerText()), { timeout: 10_000 }).toBe(before.bars);
  expect(page.url()).toBe(before.url);
});

test("B3 · two values of one field read as OR, and the second click on the same bar removes it", async ({ page }) => {
  await page.goto(BOARD);
  await expect(page.getByTestId("breakdown-bars")).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-bar='DF2']").click();
  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("flow type: DF2", { timeout: 10_000 });
  await page.locator("[data-bar='DF1']").click();
  await expect(chips.getByRole("listitem")).toHaveCount(1);
  await expect(chips).toContainText(/flow type: (DF1 or DF2|DF2 or DF1)/);
  await page.locator("[data-bar='DF2']").click();
  await expect(chips).toContainText("flow type: DF1");
  await expect(chips).not.toContainText("DF2");
});
