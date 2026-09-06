import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * CP-B2 on the live backend. Runs only with `E2E_API_URL` (e.g. http://127.0.0.1:8010) pointing at a backend
 * that serves the verified BPIC 2019 workspace: a done run grouped by company × spend area with γ = 20.
 * `E2E_PROJECT_ID` and `E2E_RUN_ID` pin the project and run; otherwise the first project and its first
 * matching run are used. The run is read only: nothing is created in the verified workspace; the cycle-2
 * checks skip with a message when their endpoints are not served.
 */
const API = process.env.E2E_API_URL;
const SLICING = "case Company+case Spend area text";

test.skip(!API, "set E2E_API_URL to run the frontend against a live backend");

interface Run {
  id: string;
  status: string;
  gamma?: number;
  caseTableId?: string;
  slicings?: { id?: string | null }[];
}

async function verifiedRun(request: APIRequestContext): Promise<{ pid: string; run: Run | undefined }> {
  const projects = (await (await request.get(`${API}/api/v1/projects`)).json()) as { id: string }[];
  const pid = process.env.E2E_PROJECT_ID ?? projects[0]?.id ?? "";
  const runs = (await (await request.get(`${API}/api/v1/projects/${pid}/runs`)).json()) as Run[];
  const run = runs.find((r) => r.id === process.env.E2E_RUN_ID) ?? runs.find((r) => r.status === "done" && (r.slicings ?? []).some((s) => s.id === SLICING));
  return { pid, run };
}

async function served(request: APIRequestContext, path: string): Promise<boolean> {
  const res = await request.get(`${API}/api/v1${path}`);
  return res.status() < 400;
}

test("dashboard, the Table XI signals with the analytics fields, Why? on Packaging, the flow and the back control", async ({ page, request }) => {
  const { pid, run } = await verifiedRun(request);
  expect(run, "a done run grouped by company × spend area").toBeTruthy();
  const runId = (run as Run).id;

  // the dashboard from real runs: one sentence, the next step, the flow types
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/p/${pid}`), { timeout: 30_000 });
  await expect(page.getByRole("banner")).toContainText("live backend");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("top-signal")).toContainText("companyID_0000 × Packaging", { timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "Analysis path" })).toContainText("Signals");
  if (await served(request, `/projects/${pid}/case-tables/${(run as Run).caseTableId}/flow-types`)) {
    await expect(page.getByRole("list", { name: "Flow types" })).toContainText("DF2", { timeout: 60_000 });
  } else {
    test.info().annotations.push({ type: "skipped", description: "flow-types endpoint not served" });
  }

  // the signals list with the paper's Table XI rows (Automation, γ = 20, min cases 1) and the cycle-2 fields
  await page.goto(`/p/${pid}/runs/${runId}/backlog?slicing=${encodeURIComponent(SLICING)}&view=Automation&minCases=1`);
  const list = page.getByRole("list", { name: "Signals" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  const cards = list.getByRole("article");
  await expect(cards.nth(0)).toContainText("companyID_0000 × Packaging");
  await expect(cards.nth(0)).toContainText("109,199 purchase order items");
  await expect(cards.nth(0)).toContainText("0.9 points below the overall score of 84.4");
  await expect(cards.nth(0)).toContainText("widespread");
  await expect(cards.nth(0).getByRole("meter", { name: /^priority 945\.7/ })).toBeVisible();
  const firstText = (await cards.nth(0).textContent()) ?? "";
  if (/confidence high/.test(firstText)) {
    await expect(cards.nth(0)).toContainText("83 days here against 55 elsewhere");
    await expect(cards.nth(0).getByRole("list", { name: "Data caveats for this group" })).toContainText("still open");
  } else {
    test.info().annotations.push({ type: "skipped", description: "analytics not computed for this run: confidence, comparison and caveats not checked" });
  }
  await expect(cards.nth(1)).toContainText("companyID_0000 × Logistics");
  await expect(cards.nth(1).getByRole("meter", { name: /^priority 294\.2/ })).toBeVisible();
  await expect(cards.nth(4)).toContainText("companyID_0003 × Real Estate");
  await expect(cards.nth(4).getByRole("meter", { name: /^priority 50\.6/ })).toBeVisible();
  await expect(page.getByTestId("ranking-rule")).toContainText("γ = 20");
  await expect(page.getByRole("button", { name: /^Refine/ })).toBeVisible();

  // the metric table shows the same numbers
  await page.getByRole("tab", { name: "Table" }).click();
  const grid = page.getByRole("grid", { name: "Backlog" });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("row").nth(1)).toContainText("945.7");
  await expect(grid.getByRole("row").nth(2)).toContainText("294.2");
  await expect(grid.getByRole("row").nth(5)).toContainText("50.6");
  await page.getByRole("tab", { name: "Signals" }).click();

  // the first click on Why? of a non-active card opens the reason screen (R2-O4)
  const second = cards.nth(1);
  await second.getByRole("button", { name: /^Why\?/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("companyID_0000 × Logistics", { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Where in the flow" })).toHaveAttribute("aria-selected", "true");
  const map = page.getByTestId("flow-map");
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(map).toContainText("Record Goods Receipt", { timeout: 60_000 });
  await expect(map.getByRole("button", { name: "compare with everyone else" })).toBeVisible();

  // the expectations in plain words with the share of the shortfall; the full table behind "show all"
  await page.getByRole("tab", { name: "Which expectations are missed" }).click();
  await expect(page.getByTestId("top-drivers")).toContainText("of the shortfall", { timeout: 30_000 });
  await page.getByRole("button", { name: /show all \d+ expectations/ }).click();
  await expect(page.getByTestId("drivers-table").locator("tbody tr")).toHaveCount(29, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Cases" }).click();
  await page.getByTestId("worst-cases").locator("tbody tr").first().getByRole("button").click();
  await expect(page.getByRole("img", { name: /^Timeline of case/ })).toBeVisible({ timeout: 30_000 });

  // the back control returns to the signals list with its search
  await page.getByTestId("back-control").click();
  await expect(list).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toContain("minCases=1");

  // flow types side by side (read only)
  if (await served(request, `/projects/${pid}/runs/${runId}/compare-flow-types`)) {
    await page.goto(`/p/${pid}/runs/${runId}?tab=compare`);
    await expect(page.getByTestId("compare-flow-types")).toContainText("DF2", { timeout: 60_000 });
  } else {
    test.info().annotations.push({ type: "skipped", description: "compare-flow-types endpoint not served" });
  }

  // the data caveats with their decision buttons (nothing is applied)
  if (await served(request, `/projects/${pid}/decisions/kinds`)) {
    const caseTableId = (run as Run).caseTableId;
    const ct = (await (await request.get(`${API}/api/v1/projects/${pid}/case-tables/${caseTableId}`)).json()) as { datasetId: string };
    await page.goto(`/p/${pid}/data/${ct.datasetId}?caseTable=${caseTableId}&tab=readiness`);
    await expect(page.getByTestId("readiness-decisions")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Decide how open cases count/ })).toBeVisible();
  } else {
    test.info().annotations.push({ type: "skipped", description: "decisions endpoints not served" });
  }

  // the notebook screen (empty on the verified workspace; nothing is frozen here)
  if (await served(request, `/projects/${pid}/notebook`)) {
    await page.goto(`/p/${pid}/notebook`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Analysis notebook");
  } else {
    test.info().annotations.push({ type: "skipped", description: "notebook endpoint not served" });
  }
});
