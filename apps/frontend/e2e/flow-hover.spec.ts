import { expect, test } from "@playwright/test";

const slicing = "case Company+case Spend area text";
const key = '["companyID_0000", "Packaging"]';

// Hover must not move the map, including after an analyst chooses their own zoom.
for (const width of [1280, 1440]) {
  test(`Why map keeps its viewport while hovering at ${width}px`, async ({ page }) => {
    const project = process.env.E2E_PROJECT_ID ?? "p2p2018";
    const run = process.env.E2E_RUN_ID ?? "run_41";
    const view = process.env.E2E_VIEW ?? "Automation";
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/p/${project}/runs/${run}/slices/${encodeURIComponent(key)}?slicing=${encodeURIComponent(slicing)}&view=${view}&tab=why`);
    const map = page.getByTestId("flow-map");
    const nodes = map.locator(".react-flow__node-activity");
    await expect(nodes.first()).toBeVisible({ timeout: 60000 });
    await map.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2400); // bounded initial layout/fit attempts
    const geometry = () => map.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { width: box.width, height: box.height, transform: el.querySelector(".react-flow__viewport")?.getAttribute("style") };
    });
    for (const zoomed of [false, true]) {
      if (zoomed) await map.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(1800);
      const before = await geometry();
      for (let i = 0; i < Math.min(3, await nodes.count()); i++) {
        await nodes.nth(i).hover();
        for (let sample = 0; sample < 8; sample++) {
          await page.waitForTimeout(100);
          expect(await geometry(), `node ${i}, zoomed=${zoomed}, sample ${sample}`).toEqual(before);
        }
      }
      await page.getByRole("tab", { name: "Why", exact: true }).hover();
      await page.waitForTimeout(500);
      expect(await geometry()).toEqual(before);
    }
  });
}
