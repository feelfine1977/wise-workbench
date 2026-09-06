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

interface Row {
  key: string;
  n_cases: number;
  case_noun?: string | null;
  stability?: string;
  comparison?: string | null;
  caveats?: { id: string }[];
}

/** The plain confidence word of a stability value, as the card prints it. */
const confidenceWord: Record<string, string> = { stable: "high", fragile: "medium", insufficient_support: "not enough cases to be sure", unknown: "not computed" };

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
  await expect(page.getByTestId("top-signal")).toContainText("Packaging", { timeout: 60_000 });
  await expect(page.getByTestId("top-signal")).not.toContainText("companyID");
  await expect(page.getByTestId("next-step")).toContainText("Why? Packaging");
  await expect(page.getByRole("navigation", { name: "Analysis path" })).toContainText("Signals");
  if (await served(request, `/projects/${pid}/case-tables/${(run as Run).caseTableId}/flow-types`)) {
    await expect(page.getByRole("list", { name: "Flow types" })).toContainText("DF2", { timeout: 60_000 });
  } else {
    test.info().annotations.push({ type: "skipped", description: "flow-types endpoint not served" });
  }

  // the signals list with the paper's Table XI rows (Automation, γ = 20, min cases 1): every card reads the row's own fields
  const page1 = (await (await request.get(`${API}/api/v1/projects/${pid}/runs/${runId}/backlog?slicing=${encodeURIComponent(SLICING)}&view=Automation&minCases=1&sort=-stable_PI&page=1&pageSize=10`)).json()) as { rows: Row[]; params?: { case_noun?: string | null } };
  const first = page1.rows[0] as Row;
  const noun = first.case_noun ?? page1.params?.case_noun ?? "cases";
  expect(noun, "the backend's case noun").toBe("purchase order items");
  await page.goto(`/p/${pid}/runs/${runId}/backlog?slicing=${encodeURIComponent(SLICING)}&view=Automation&minCases=1`);
  const list = page.getByRole("list", { name: "Signals" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  const cards = list.getByRole("article");
  // the company every group shares is dropped; the one group outside it keeps it as a suffix
  await expect(cards.nth(0).getByRole("heading", { level: 3 })).toHaveText("Packaging");
  await expect(cards.nth(4).getByRole("heading", { level: 3 })).toHaveText("Real Estate · company 0003");
  // the sentence: three numbers — items with the noun, the share below expectation, the most-missed expectation with its share
  await expect(cards.nth(0).getByTestId("card-sentence")).toHaveText(/^109,199 purchase order items · 0\.9 % below expectation · waiting too long between steps in 97\s?% of them\.$/);
  await expect(cards.nth(0)).toContainText("widespread");
  // the strip: the priority as a whole number and the confidence word from the row's stability
  await expect(cards.nth(0).getByRole("meter", { name: /^priority 945\.7/ })).toBeVisible();
  await expect(cards.nth(0).getByTestId("card-strip")).toHaveText(`priority 946 · confidence ${confidenceWord[first.stability ?? "unknown"]}`);
  expect(first.stability, "the backend's stability of Packaging").toBe("stable");
  // the comparison sentence from the row; the caveats every group shares sit once in the header, the others on the card
  await expect(cards.nth(0).getByTestId("card-reason")).toHaveText("Paid within terms: 83 days here against 55 elsewhere (+25 days).");
  await expect(page.getByTestId("page-caveats")).toContainText("still open at the end");
  await expect(page.getByTestId("page-caveats")).toContainText("started near the window end");
  await expect(cards.nth(1).getByRole("list", { name: "Data caveats for this group" })).toContainText(/copied postings|duplicated events/);
  expect(await cards.nth(1).getByRole("list", { name: "Data caveats for this group" }).getByRole("listitem").count()).toBe(1);
  // the points sentence and the expectation area sit behind "more"
  await cards.nth(0).getByRole("button", { name: "More about Packaging" }).click();
  await expect(cards.nth(0).getByTestId("card-more")).toContainText("0.9 points below the overall score of 84.4 (1 %)");
  await expect(cards.nth(0).getByTestId("card-more")).toContainText("On time");
  await expect(cards.nth(0).getByTestId("card-more")).toContainText("confidence in rank: high");
  await expect(cards.nth(1).getByRole("heading", { level: 3 })).toHaveText("Logistics");
  await expect(cards.nth(1).getByRole("meter", { name: /^priority 294\.2/ })).toBeVisible();
  await expect(cards.nth(4).getByRole("meter", { name: /^priority 50\.6/ })).toBeVisible();
  // no γ, no "of 30" in plain words; one primary button per card, no next-step bar, the how-to-read paragraph collapsed
  await expect(page.getByTestId("ranking-rule")).not.toContainText("γ");
  await expect(cards.nth(0).getByTestId("card-strip")).not.toContainText("of 30");
  await expect(cards.nth(0).getByTestId("card-sentence")).not.toContainText("of 30");
  await expect(page.getByTestId("next-step")).toHaveCount(0);
  await expect(page.getByTestId("how-to-read")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Refine/ })).toBeVisible();
  // the three bands: no journey rail, no readiness banner; the ribbon shows the caveats chip and no id
  await expect(page.getByRole("complementary", { name: "Journey" })).toHaveCount(0);
  await expect(page.getByTestId("caveats-chip")).toContainText("caveats");
  await expect(page.getByRole("banner")).not.toContainText(/run_0|ct_0|map_0/);

  // the metric table shows the same numbers
  await page.getByRole("tab", { name: "Table" }).click();
  const grid = page.getByRole("grid", { name: "Backlog" });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("row").nth(1)).toContainText("945.7");
  await expect(grid.getByRole("row").nth(2)).toContainText("294.2");
  await expect(grid.getByRole("row").nth(5)).toContainText("50.6");
  await page.getByRole("tab", { name: "Signals" }).click();

  // the first click on Why? of a non-active card opens the reason screen on the Why tab, the map embedded in it
  const second = cards.nth(1);
  await second.getByRole("button", { name: /^Why\?/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Logistics", { timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("companyID");
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Why" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("why-sentence")).toContainText(/5,242 purchase order items · 5\.6 % below expectation · .* in 77\s?% of them; the shortfall is \d+\s?% this one expectation\./);
  await expect(page.getByTestId("why-strip")).toContainText("rank");
  await expect(page.getByTestId("top-drivers")).toContainText("of the shortfall", { timeout: 30_000 });
  const map = page.getByTestId("why-map").getByTestId("flow-map");
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(map).toContainText("Record Goods Receipt", { timeout: 60_000 });
  await expect(map.getByRole("button", { name: "compare with everyone else" })).toBeVisible();
  await expect(map.getByTestId("map-legend")).toBeVisible();
  await expect(map.getByTestId("map-footnote")).not.toContainText("c_l");
  await page.getByRole("button", { name: /Show all \d+ expectations/ }).click();
  await expect(page.getByTestId("drivers-table").locator("tbody tr")).toHaveCount(29, { timeout: 30_000 });

  // the map's filter action filters: a chip with the activity's name, the count of cases in, the announcement, the address
  await page.getByRole("tab", { name: "Flow" }).click();
  const fullMap = page.getByTestId("flow-map");
  await expect(fullMap).toContainText("Record Goods Receipt", { timeout: 60_000 });
  await fullMap.locator(".react-flow__node", { hasText: "Record Goods Receipt" }).first().click();
  await expect(page.getByTestId("selected-activity")).toContainText("Record Goods Receipt", { timeout: 30_000 });
  await page.getByTestId("selected-activity").getByRole("button", { name: "Filter to cases with it" }).click();
  await expect(page.getByTestId("filter-bar").getByRole("list", { name: "Active filters" })).toContainText("cases with Record Goods Receipt");
  await expect(page.getByTestId("filter-preview")).toContainText("234,479 of 251,734", { timeout: 60_000 });
  await expect(page.getByTestId("filter-announcement")).toHaveText("Filter added: cases with Record Goods Receipt — 234,479 of 251,734 remain.");
  expect(page.url()).toContain("filter=%7B%22and%22");
  expect(page.url()).not.toContain("filter=%22%7B");
  // the chips stay on every tab; the cases tab lists the missed expectations as plain phrases
  await page.getByRole("tab", { name: "Cases" }).click();
  await expect(page.getByTestId("filter-bar")).toContainText("cases with Record Goods Receipt");
  await page.getByTestId("worst-cases").locator("tbody tr").first().getByRole("button").click();
  await expect(page.getByRole("img", { name: /^Timeline of case/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("worst-cases")).not.toContainText("c_l");
  // Compared: the group against everyone else with the two sentences, no sliders in plain words
  await page.getByRole("tab", { name: "Compared" }).click();
  await expect(page.getByTestId("lens-sentences")).toContainText(/here; everywhere else/, { timeout: 60_000 });
  await expect(page.getByTestId("lens-sentences")).toContainText(/everyone else: \d+\s?%/);
  await expect(page.locator("input[type=range]")).toHaveCount(0);

  // the back control returns to the signals list with its search and names the state it restores
  await expect(page.getByTestId("back-control")).toContainText("Back to Where is it worst? (page 1)");
  await page.getByTestId("back-control").click();
  await expect(list).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toContain("minCases=1");

  // a deep link to a run that does not exist: the sentence with its next step; the ribbon stays on the latest run
  await page.goto(`/p/${pid}/runs/run_missing/backlog`);
  await expect(page.getByText("This run does not exist in this workspace.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Go to Runs" })).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText("no run yet");

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
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Notebook");
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  } else {
    test.info().annotations.push({ type: "skipped", description: "notebook endpoint not served" });
  }
});
