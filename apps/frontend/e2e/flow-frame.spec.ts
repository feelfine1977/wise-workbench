import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The map frame keeps its size (`docs/panel/ui_design_cycle3_board.md` §3.2). The Flow step was unusable
 * because the map resized without settling: the frame's height came from its own fitted content, a filter
 * brought a page scrollbar that changed the width, and the refit changed the height again.
 *
 * The frame now comes from the viewport, the step does not scroll and the bands under the map are reserved,
 * so the loop cannot form at any height. The check is therefore run at three viewport sizes — the threshold
 * where the scrollbar used to appear is size-dependent, so one size proves nothing: at each of them the
 * frame is sampled twenty times over two seconds after load, after the activity card opens and after a
 * filter action, and at most one distinct size may occur after the first three hundred milliseconds.
 *
 * It runs on the mock build and, with `E2E_API_URL`, on the served build of a live backend.
 */
const API = process.env.E2E_API_URL;
const SLICING = "case Company+case Spend area text";
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 780 },
  { width: 1440, height: 900 },
];

/** The project and run the check reads: the mock fixture, or the first done run of the live backend. */
async function target(request: APIRequestContext): Promise<{ projectId: string; runId: string }> {
  if (!API) return { projectId: "p2p2018", runId: "run_41" };
  const projects = (await (await request.get(`${API}/api/v1/projects`)).json()) as { id: string }[];
  const projectId = process.env.E2E_PROJECT_ID ?? projects[0]?.id ?? "";
  const runs = (await (await request.get(`${API}/api/v1/projects/${projectId}/runs`)).json()) as { id: string; status: string; slicings?: { id?: string | null }[] }[];
  const run = runs.find((r) => r.id === process.env.E2E_RUN_ID) ?? runs.find((r) => r.status === "done" && (r.slicings ?? []).some((s) => s.id === SLICING)) ?? runs.find((r) => r.status === "done");
  return { projectId, runId: run?.id ?? "" };
}

/**
 * Twenty readings of the frame's box over two seconds. The readings of the first three hundred milliseconds
 * are the settling of the action itself and are dropped; what is left must be one size.
 */
async function sizesOf(page: Page): Promise<string[]> {
  return page.evaluate(`(async () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const el = document.querySelector("[data-testid='map-frame']");
      const box = el && el.getBoundingClientRect();
      if (box && i * 100 >= 300) seen.add(Math.round(box.width) + "x" + Math.round(box.height));
      await new Promise((r) => setTimeout(r, 100));
    }
    return [...seen];
  })()`) as Promise<string[]>;
}

/** The whole page fits its own viewport: the Flow step never scrolls. */
async function scrolls(page: Page): Promise<{ scrollHeight: number; clientHeight: number }> {
  return page.evaluate(`({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })`) as Promise<{
    scrollHeight: number;
    clientHeight: number;
  }>;
}

for (const size of SIZES) {
  const at = `${size.width} × ${size.height}`;

  test(`the map frame keeps one size on the Flow step at ${at}`, async ({ page, request }) => {
    const { projectId, runId } = await target(request);
    test.skip(!runId, "no finished run to read");
    const loopErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /ResizeObserver/i.test(m.text())) loopErrors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (/ResizeObserver/i.test(String(e))) loopErrors.push(String(e));
    });

    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=Automation`);
    await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    const afterLoad = await sizesOf(page);
    expect(afterLoad, `after load at ${at} the frame took ${afterLoad.join(", ")}`).toHaveLength(1);
    const loaded = await scrolls(page);
    expect(loaded.scrollHeight, `the Flow step scrolls at ${at}`).toBe(loaded.clientHeight);

    // the activity card opens: its band is reserved, so the frame is the size it already was
    await page.locator(".react-flow__node-activity").first().click();
    await expect(page.getByTestId("selected-activity")).toBeVisible({ timeout: 15_000 });
    const withCard = await sizesOf(page);
    expect(withCard, `with the activity card open at ${at} the frame took ${withCard.join(", ")}`).toHaveLength(1);
    expect(withCard, `the activity card resized the frame at ${at}`).toEqual(afterLoad);

    // a filter action: the count changes, the frame does not
    await page.getByTestId("selected-activity").getByRole("button", { name: "Filter to" }).click();
    await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible({ timeout: 20_000 });
    const filtered = await sizesOf(page);
    expect(filtered, `after a filter at ${at} the frame took ${filtered.join(", ")}`).toHaveLength(1);
    const after = await scrolls(page);
    expect(after.scrollHeight, `the Flow step scrolls after a filter at ${at}`).toBe(after.clientHeight);

    // and in the full window, which is the same instrument in another frame
    await page.getByTestId("full-window").click();
    await expect(page.getByTestId("flow-map")).toHaveAttribute("data-full", "1");
    const full = await sizesOf(page);
    expect(full, `in the full window at ${at} the frame took ${full.join(", ")}`).toHaveLength(1);

    expect(loopErrors, `resize-observer errors at ${at}: ${loopErrors.join(" | ")}`).toEqual([]);
  });

  test(`the board's map panel keeps one size at ${at}`, async ({ page, request }) => {
    const { projectId, runId } = await target(request);
    test.skip(!runId, "no finished run to read");
    const loopErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /ResizeObserver/i.test(m.text())) loopErrors.push(m.text());
    });

    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/board?slicing=${encodeURIComponent(SLICING)}&view=Automation`);
    await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-panel="flow-map"] .react-flow__node').first()).toBeVisible({ timeout: 60_000 });

    const afterLoad = await sizesOf(page);
    expect(afterLoad, `the board's map panel at ${at} took ${afterLoad.join(", ")}`).toHaveLength(1);

    // a click on the board is the filter itself (§4.5); the panel reloads its scene for the new filter, and
    // the size is read once the map is back — a panel that is still fetching draws no frame to measure
    await page.locator('[data-panel="flow-map"] .react-flow__node-activity').first().click();
    await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-panel="flow-map"] .react-flow__node').first()).toBeVisible({ timeout: 60_000 });
    const filtered = await sizesOf(page);
    expect(filtered, `after a filter on the board at ${at} the panel took ${filtered.join(", ")}`).toHaveLength(1);
    expect(filtered, `a filter resized the board's map panel at ${at}`).toEqual(afterLoad);

    await page.getByTestId("full-window").click();
    await expect(page.getByTestId("flow-map")).toHaveAttribute("data-full", "1");
    await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 30_000 });
    const full = await sizesOf(page);
    expect(full, `the board's map in the full window at ${at} took ${full.join(", ")}`).toHaveLength(1);

    expect(loopErrors, `resize-observer errors on the board at ${at}: ${loopErrors.join(" | ")}`).toEqual([]);
  });
}
