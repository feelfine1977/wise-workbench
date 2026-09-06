#!/usr/bin/env node
/**
 * Screenshots of the running application for reports (docs/RESULTS_TEMPLATE.md).
 *
 *   node tools/capture_screens.mjs --base http://127.0.0.1:8000 --steps docs/examples/screens.json --out docs/examples/screenshots
 *
 * Node 18 or newer; uses the Playwright installed under apps/frontend/node_modules (npm install there,
 * then `npx playwright install chromium` once). Every step is an object:
 *
 *   {
 *     "name": "signals_list",                 // file name without extension
 *     "route": "/p/prj_1/runs/run_1/backlog", // path (with query string) relative to --base
 *     "clicks": [                              // optional, in order
 *       { "role": "tab", "name": "Table" },   // a click by ARIA role and accessible name (exact by default)
 *       { "role": "button", "name": "Why?", "nth": 0, "exact": false },
 *       { "text": "Open the ranked list" },   // a click by visible text
 *       { "testid": "flow-map" },            // a click by data-testid
 *       { "press": "Escape" }                 // a key press instead of a click
 *     ],
 *     "waitFor": { "role": "grid", "name": "Backlog" },   // optional: an element that must be visible
 *     "waitForText": "945.7",                              // optional: text that must be on the page
 *     "settle": 500,                                       // optional: extra milliseconds before the shot
 *     "fullPage": false                                    // optional: capture the whole page height
 *   }
 *
 * Pages are captured at 1440 × 900 as PNG. Missing elements fail the step and the script exits 1 after
 * running every step, so one broken route never hides the others.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const require = createRequire(path.join(repoRoot, "apps/frontend/package.json"));

function parseArgs(argv) {
  const out = { base: "http://127.0.0.1:8000", steps: undefined, out: "screenshots", timeout: 30000, headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--steps") out.steps = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--timeout") out.timeout = Number(argv[++i]);
    else if (a === "--headed") out.headed = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/capture_screens.mjs --base URL --steps steps.json --out DIR [--timeout ms] [--headed]");
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!out.steps) throw new Error("--steps FILE is required");
  return out;
}

function locatorFor(page, spec) {
  if (spec.testid) return page.getByTestId(spec.testid);
  if (spec.role) return page.getByRole(spec.role, { name: spec.name, exact: spec.exact ?? true });
  if (spec.text) return page.getByText(spec.text, { exact: spec.exact ?? true });
  if (spec.selector) return page.locator(spec.selector);
  throw new Error(`cannot locate ${JSON.stringify(spec)}`);
}

async function runStep(page, step, options) {
  const url = new URL(step.route, options.base).toString();
  await page.goto(url, { waitUntil: "networkidle", timeout: options.timeout });
  for (const action of step.clicks ?? []) {
    if (action.press) {
      await page.keyboard.press(action.press);
      continue;
    }
    if (action.fill !== undefined) {
      await locatorFor(page, action).fill(String(action.fill));
      continue;
    }
    let target = locatorFor(page, action);
    if (action.nth !== undefined) target = target.nth(action.nth);
    await target.scrollIntoViewIfNeeded({ timeout: options.timeout });
    await target.click({ timeout: options.timeout });
    if (action.settle) await page.waitForTimeout(action.settle);
  }
  if (step.waitFor) await locatorFor(page, step.waitFor).first().waitFor({ state: "visible", timeout: options.timeout });
  if (step.waitForText) await page.getByText(step.waitForText, { exact: false }).first().waitFor({ state: "visible", timeout: options.timeout });
  await page.waitForLoadState("networkidle", { timeout: options.timeout }).catch(() => {});
  await page.waitForTimeout(step.settle ?? 300);
  const file = path.join(options.out, `${step.name}.png`);
  await page.screenshot({ path: file, fullPage: step.fullPage ?? false });
  return file;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const steps = JSON.parse(readFileSync(options.steps, "utf8"));
  if (!Array.isArray(steps)) throw new Error("the steps file must hold a JSON array");
  mkdirSync(options.out, { recursive: true });
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  let failures = 0;
  for (const step of steps) {
    const started = Date.now();
    try {
      const file = await runStep(page, step, options);
      console.log(`${step.name.padEnd(28)} ${file} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (error) {
      failures += 1;
      console.error(`${step.name.padEnd(28)} FAILED: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  await browser.close();
  if (failures) {
    console.error(`${failures} of ${steps.length} steps failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
