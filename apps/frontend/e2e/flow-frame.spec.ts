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
/** The grouping the checks read; `E2E_SLICING` names another one, so the same suite runs on a second dataset. */
const SLICING = process.env.E2E_SLICING ?? "case Company+case Spend area text";
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 780 },
  { width: 1440, height: 900 },
];

/**
 * The project, run and perspective the check reads: the mock fixture, or the first done run of the live
 * backend. The perspective comes from the run itself — a second dataset weights its expectation areas by its
 * own names, and asking for one the run does not carry is answered with 422 and an error state, not a map.
 */
async function target(request: APIRequestContext): Promise<{ projectId: string; runId: string; view: string }> {
  if (!API) return { projectId: "p2p2018", runId: "run_41", view: "Automation" };
  const projects = (await (await request.get(`${API}/api/v1/projects`)).json()) as { id: string }[];
  const projectId = process.env.E2E_PROJECT_ID ?? projects[0]?.id ?? "";
  const runs = (await (await request.get(`${API}/api/v1/projects/${projectId}/runs`)).json()) as { id: string; status: string; slicings?: { id?: string | null }[]; views?: string[] }[];
  const run = runs.find((r) => r.id === process.env.E2E_RUN_ID) ?? runs.find((r) => r.status === "done" && (r.slicings ?? []).some((s) => s.id === SLICING)) ?? runs.find((r) => r.status === "done");
  const views = run?.views ?? [];
  const view = process.env.E2E_VIEW ?? (views.includes("Automation") ? "Automation" : (views[0] ?? "Automation"));
  return { projectId, runId: run?.id ?? "", view };
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
    const { projectId, runId, view } = await target(request);
    test.skip(!runId, "no finished run to read");
    const loopErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /ResizeObserver/i.test(m.text())) loopErrors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (/ResizeObserver/i.test(String(e))) loopErrors.push(String(e));
    });

    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
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
    const { projectId, runId, view } = await target(request);
    test.skip(!runId, "no finished run to read");
    const loopErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /ResizeObserver/i.test(m.text())) loopErrors.push(m.text());
    });

    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/board?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
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

/**
 * R3-06 — the activity names at a readable size, measured rather than asserted.
 *
 * Cycle 3 measured the same code drawing an 11.0 px name on a five-activity map and a 4.7 px name on an
 * eight-activity, six-lane one: the label was written at a fixed 12 layout units inside a pane the library
 * scales by the fitted zoom, so legibility depended on how many lanes the process had. The name is now
 * counter-scaled by the inverse of that zoom, so what is checked here is the number the reader actually sees:
 * the computed font size of every drawn name, multiplied by the viewport transform of the pane it sits in.
 *
 * The second half of the requirement — that the box holds the name — is checked as *no two boxes touch*: the
 * box grows into the room the drawing left and no further, and where that room is not enough for eighteen
 * characters the bar says so instead of drawing a row of stubs.
 */
const LABEL_SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];

/**
 * Every text drawn inside the canvas: what it measures on the screen, which class drew it, and the empty
 * band the fit leaves on each side of the drawing.
 *
 * The size is the computed font size of the element that carries the text, multiplied by the transform of the
 * pane it sits in — the number the reader sees. The band is measured against **everything drawn**: the
 * activities, the lanes, the paths and every label. It was 44.7 % above the activities, and what filled it was
 * empty lane and routed detour rather than process.
 */
async function drawnOn(page: Page) {
  return page.evaluate(`(() => {
    const pane = document.querySelector(".react-flow__viewport");
    const canvas = document.querySelector(".wise-map");
    if (!pane || !canvas) return { texts: [], overlaps: [], zoom: 0, band: null, activities: 0 };
    const zoom = new DOMMatrixReadOnly(getComputedStyle(pane).transform).a;
    const frame = canvas.getBoundingClientRect();
    const texts = [];
    const walk = (el) => {
      for (const child of el.children) walk(child);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (!own) return;
      const r = el.getBoundingClientRect();
      if (r.width < 0.2 && r.height < 0.2) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
      const cls = [...el.classList].find((c) => c.startsWith("wf-")) || el.tagName.toLowerCase();
      texts.push({ cls, text: own.slice(0, 40), px: Math.round(parseFloat(cs.fontSize) * zoom * 10) / 10, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
    };
    walk(pane);
    const rects = [
      ...[...pane.querySelectorAll(".wf-node")].map((n) => n.getBoundingClientRect()),
      ...[...pane.querySelectorAll(".wf-group")].map((n) => n.getBoundingClientRect()),
      ...[...pane.querySelectorAll(".react-flow__edge")].map((n) => n.getBoundingClientRect()),
      ...texts.map((t) => ({ left: t.rect.x, right: t.rect.x + t.rect.w, top: t.rect.y, bottom: t.rect.y + t.rect.h, width: t.rect.w, height: t.rect.h })),
    ].filter((r) => r.width > 0 && r.height > 0);
    const band = rects.length ? {
      above: Math.round(((Math.min(...rects.map((r) => r.top)) - frame.top) / frame.height) * 1000) / 10,
      below: Math.round(((frame.bottom - Math.max(...rects.map((r) => r.bottom))) / frame.height) * 1000) / 10,
      left: Math.round(((Math.min(...rects.map((r) => r.left)) - frame.left) / frame.width) * 1000) / 10,
      right: Math.round(((frame.right - Math.max(...rects.map((r) => r.right))) / frame.width) * 1000) / 10,
    } : null;
    const boxes = [...pane.querySelectorAll(".wf-node")].filter((n) => n.dataset.kind === "activity").map((n) => ({ text: (n.querySelector(".wf-node__label") || {}).textContent, box: n.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box, b = boxes[j].box;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(boxes[i].text + " over " + boxes[j].text);
      }
    }
    return { zoom: Math.round(zoom * 1000) / 1000, band, overlaps, texts, activities: boxes.length };
  })()`) as Promise<{
    zoom: number;
    band: { above: number; below: number; left: number; right: number } | null;
    overlaps: string[];
    texts: { cls: string; text: string; px: number }[];
    activities: number;
  }>;
}

for (const size of LABEL_SIZES) {
  const at = `${size.width} × ${size.height}`;

  test(`every text drawn on the map is at least 11 px at ${at} (R3-06, P1-4)`, async ({ page, request }) => {
    const { projectId, runId, view } = await target(request);
    test.skip(!runId, "no finished run to read");
    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
    await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".react-flow__node-activity").first()).toBeVisible({ timeout: 60_000 });

    // every detail level the slider offers, from the stages to all that fit
    for (const level of [1, 2, 3, 4]) {
      await page.getByLabel("Detail of the map, from stages only to all that fit").fill(String(level));
      await expect(page.locator(".react-flow__node-activity").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2500);
      const { texts, overlaps, zoom, activities } = await drawnOn(page);
      expect(activities, `no activity is drawn at level ${level} at ${at}`).toBeGreaterThan(0);
      expect(texts.length, `no text is drawn at level ${level} at ${at}`).toBeGreaterThan(0);
      // the activity name, the stage header, the item count, the markers, the path labels and both halves of a
      // badge: the name alone was counter-scaled and the other six measured 3.2 to 8.8 px
      const smallest = texts.reduce((a, b) => (a.px <= b.px ? a : b));
      expect(smallest.px, `“${smallest.text}” (${smallest.cls}) is ${smallest.px} px at level ${level}, zoom ${zoom}, ${at}`).toBeGreaterThanOrEqual(11);
      expect(overlaps, `boxes overlap at level ${level} at ${at}: ${overlaps.join("; ")}`).toEqual([]);
    }
  });

  test(`the map is fitted to its drawing, with no empty band over 8 % at ${at} (P1-5)`, async ({ page, request }) => {
    const { projectId, runId, view } = await target(request);
    test.skip(!runId, "no finished run to read");
    await page.setViewportSize(size);
    await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
    await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".react-flow__node-activity").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    const { band, zoom } = await drawnOn(page);
    expect(band, "nothing is drawn on the map").not.toBeNull();
    const sides = band as { above: number; below: number; left: number; right: number };
    for (const [side, value] of Object.entries(sides)) {
      expect(value, `the band ${side} the drawing is ${value} % of the frame at ${at} (zoom ${zoom})`).toBeLessThanOrEqual(8.001);
    }
  });
}

/** R3-17 — the map carries the product's own chrome and nothing else. */
test("no third-party control bar or watermark is drawn on the map (R3-17)", async ({ page, request }) => {
  const { projectId, runId, view } = await target(request);
  test.skip(!runId, "no finished run to read");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
  await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".react-flow__node-activity").first()).toBeVisible({ timeout: 60_000 });

  // the product's own zoom stack is there, once
  await expect(page.getByTestId("zoom-controls")).toBeVisible();
  const chrome = await page.evaluate(`(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== "none").length;
    return {
      libraryControls: shown(".react-flow__controls") + shown(".wf-controls"),
      watermarks: shown(".react-flow__attribution") + shown(".bjs-powered-by"),
      ourStacks: document.querySelectorAll("[data-testid='zoom-controls']").length,
    };
  })()`) as { libraryControls: number; watermarks: number; ourStacks: number };
  expect(chrome.libraryControls, "the flow library's own control bar is drawn beside the product's").toBe(0);
  expect(chrome.watermarks, "a third-party watermark is drawn on the map").toBe(0);
  expect(chrome.ourStacks).toBe(1);
});

/**
 * R3-18 — a flow-type thumbnail draws its flow.
 *
 * The small maps on the data screen are fitted to their activities and paths, not to the stage lanes: a lane
 * is 1,475 layout units tall against an activity's 48, so a fit that had to hold them drew one lane header
 * and a row of specks — two of the three thumbnails on the extract showed nothing else. The check is that
 * every card draws its activities inside its own frame.
 */
/** The address of the flow-type cards: the dataset screen with the run's own case table named. */
async function flowTypesHref(request: APIRequestContext, projectId: string): Promise<string | undefined> {
  if (!API) return `/p/${projectId}/data/ds_1?caseTable=ct_1&tab=flows`;
  const runs = (await (await request.get(`${API}/api/v1/projects/${projectId}/runs`)).json()) as { status: string; caseTableId?: string }[];
  const caseTableId = runs.find((r) => r.status === "done" && r.caseTableId)?.caseTableId;
  if (!caseTableId) return undefined;
  const table = (await (await request.get(`${API}/api/v1/projects/${projectId}/case-tables/${caseTableId}`)).json()) as { datasetId?: string };
  return table.datasetId ? `/p/${projectId}/data/${table.datasetId}?caseTable=${caseTableId}&tab=flows` : undefined;
}

test("every flow-type thumbnail draws its activities inside its frame (R3-18)", async ({ page, request }) => {
  const { projectId } = await target(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  // the flow types are a tab of the dataset screen, and it reads the case table the address names
  const where = await flowTypesHref(request, projectId);
  test.skip(!where, "this workspace has no case table to read flow types from");
  await page.goto(String(where));
  const list = page.getByRole("list", { name: "Flow types" });
  await list.waitFor({ state: "visible", timeout: 60_000 }).catch(() => undefined);
  test.skip((await list.count()) === 0, "this workspace has no flow types");
  await expect(page.locator('[data-flow-type] [data-testid="mini-map"] .react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);

  const cards = await page.evaluate(`(() => {
    return [...document.querySelectorAll("[data-flow-type]")].map((card) => {
      const mini = card.querySelector("[data-testid='mini-map']");
      const frame = mini.getBoundingClientRect();
      const nodes = [...mini.querySelectorAll(".wf-node")].filter((n) => n.dataset.kind === "activity");
      const inside = nodes.filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 2 && r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom;
      });
      const sub = [...card.querySelectorAll("p")].find((p) => /\\(/.test(p.textContent || ""));
      return { type: card.dataset.flowType, activities: nodes.length, drawn: inside.length, clipped: sub ? sub.scrollHeight > sub.clientHeight + 1 : false };
    });
  })()`) as { type: string; activities: number; drawn: number; clipped: boolean }[];

  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card.activities, `the ${card.type} thumbnail draws no activity`).toBeGreaterThan(0);
    expect(card.drawn, `the ${card.type} thumbnail draws ${card.drawn} of its ${card.activities} activities inside its frame`).toBe(card.activities);
    expect(card.clipped, `the ${card.type} card clips its sub-line`).toBe(false);
  }
});

/**
 * R3-11 — one path answer, in a place that does not take width from the map.
 *
 * The paths were a 264 px column inside the frame holding 1,175 px of rows: opening it shrank the canvas
 * from 1,158 to 894 px and every activity name with it, the flow library drew the same list a second time,
 * and the *hidden at this detail level* sentence was printed three times. They are now a sheet over the map:
 * the canvas keeps its width, the whole answer is on the screen, and `Escape` closes it.
 */
test("the paths of an activity are listed once, over the map, without taking its width (R3-11)", async ({ page, request }) => {
  const { projectId, runId, view } = await target(request);
  test.skip(!runId, "no finished run to read");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${projectId}/runs/${runId}/flow?slicing=${encodeURIComponent(SLICING)}&view=${encodeURIComponent(view)}`);
  await expect(page.getByTestId("map-frame")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".react-flow__node-activity").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);

  const widthBefore = await page.evaluate(`Math.round(document.querySelector(".wise-map").getBoundingClientRect().width)`);

  await page.locator(".react-flow__node-activity").first().click();
  await expect(page.getByTestId("selected-activity")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("selected-activity").getByRole("button", { name: /Paths in \/ out/ }).click();
  const sheet = page.getByTestId("path-panel");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const measured = await page.evaluate(`(() => {
    const sheet = document.querySelector("[data-testid='path-panel']");
    const canvas = document.querySelector(".wise-map");
    return {
      canvas: Math.round(canvas.getBoundingClientRect().width),
      rows: sheet.querySelectorAll("tbody tr").length,
      scrolls: sheet.scrollHeight > sheet.clientHeight + 1,
      lists: document.querySelectorAll("[data-testid='path-list']").length,
      dividers: document.querySelectorAll("[data-testid='paths-divider']").length + document.querySelectorAll("[data-testid='paths-hidden']").length,
      filters: [...sheet.querySelectorAll("button")].filter((b) => /filter to this path/.test(b.textContent || "")).length,
    };
  })()`) as { canvas: number; rows: number; scrolls: boolean; lists: number; dividers: number; filters: number };

  expect(measured.canvas, `opening the paths shrank the canvas from ${String(widthBefore)} to ${measured.canvas} px`).toBe(widthBefore);
  expect(measured.lists, "the paths are listed in more than one panel").toBe(1);
  expect(measured.dividers, "the hidden-paths sentence is printed more than once").toBeLessThanOrEqual(1);
  expect(measured.rows).toBeGreaterThan(0);
  expect(measured.filters, "no row acts as “filter to this path”").toBe(measured.rows);
  expect(measured.scrolls, `the ${measured.rows} paths do not fit the sheet at 1440 × 900`).toBe(false);

  // Escape closes it and the map is whole again
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden({ timeout: 10_000 });
});
