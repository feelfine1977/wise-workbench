# Frontend checkpoints (increments 0 and 1, cycle 2)

How a person tries workstream B by hand. Paths assume the workbench at
`~/code/PhD/WISE/wise-workbench` and the flow library checked out next to it
at `~/code/PhD/WISE/wise-flow`. Node 18.20 and npm 10 are enough; no pnpm.
Everything marked *observed* was checked on 2026-09-06.

## Setup (once)

```sh
cd ~/code/PhD/WISE/wise-flow && npm install && npm run build      # @wise/flow 0.3 (dist/ is what the app imports)
cd ~/code/PhD/WISE/wise-workbench/apps/frontend && npm install     # links @wise/flow from ../../../wise-flow
```

The flow library is optional: without the checkout the app builds with the
stand-in in `stubs/wise-flow` (README, "The flow library"). `npm run build:live`
writes the build the backend serves at `/` (`wise-workbench serve --open`,
`tools/start.sh`; backend CHECKPOINT CP-1.6); `npm run e2e` builds into
`dist-e2e/` and leaves `dist/` alone.

`npm run dev`, `npm run build` and `npm test` first compile the design tokens
(`packages/design-tokens/tokens.json` → `dist/tokens.css`, `dist/echarts-theme.*.json`,
`dist/contrast-report.json`; the build fails if any text/background pair drops
below 4.5:1). `npm run generate` regenerates `packages/api-schema/generated/schema.d.ts`
from `packages/api-schema/openapi.yaml`, which the backend writes with
`wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml`.

## Words on the screens

Every screen leads with plain words (group, expectation, expectation area,
perspective, shortfall, priority, kind of problem, confidence in rank) and
shows the method's term (slice, constraint, layer, view, gap, PI, hotspot
type, stability) as a muted secondary label whose definition appears on
hover. The ribbon's **words** switch (plain | method, plain by default,
remembered in the browser) swaps the two everywhere: column headers, badges,
filter labels, chart axes, popovers and the help drawer's glossary, which
lists both. The kinds of problem are **acute** (few cases, far off),
**systematic** (one pattern behind it) and **widespread** (many cases,
slightly off); the method's names severity, mechanism and reservoir stay as
aliases in the contract, the URL (`hotspotType=`) and the tokens.

## CP-B1 — frontend on mock data

```sh
cd apps/frontend
npm run dev
```

Open `http://127.0.0.1:5173/`. `VITE_API_URL` is unset, so the SPA runs on MSW mocks
generated from the contract. The ribbon shows a `mock data` badge. Requests are
answered by the service worker; where a browser cannot register one, the same
handlers answer from the Vite dev server (`src/mocks/vitePlugin.ts`).

| Step | What you do | What you see | Pass when |
|---|---|---|---|
| 1 | open `/` | redirect to `/p/p2p2018`: dashboard with the charter, the context ribbon (project · dataset · mapping · norm · run · perspective · grouping · period · words), the journey rail on the left with S0–S12 and their states, a readiness banner ("4 caveats travel with every result"), the top signal as one sentence | S2 and S7 read *gated* and "Why gated" opens the reason and the screen where to fix it |
| 2 | **Open the ranked list** | "Where is it worst?" for `run_41`: the ranking rule in one line ("Ranked by how many cases × how far below expectation, with small groups discounted (γ = 50)"), the perspective and grouping switchers, filters phrased as questions, ten sentence cards with a priority bar, a kind-of-problem glyph, the confidence mark and one **Why?** each; URL carries `slicing=case Vendor&view=Finance` | reloading the page keeps the same list |
| 2b | ribbon → *grouping* = `Company × Spend area text`, *perspective* = `Automation`; filter caution γ = 20, at least 1 case | the mock reproduces Table XI: Packaging, Logistics and Real Estate with priority 945.7 / 294.2 / 50.6 at ranks 1, 2, 5 (the same numbers CP-A2 prints) | rank and values match CP-A2 |
| 3 | filters: *Only acute / systematic / widespread* = systematic, *Only groups with at least … cases* = 100, type `01` in *Which group?* | the cards, the **Table** tab and **All groups at once** (scatter and concentration curve) update; the URL holds `kind`, `minCases`, `q` (`hotspotType=mechanism` in an old link still works) | reload keeps every filter; **Reset filters** clears them |
| 4 | click a card, press `↓` `↓`, `p`, `p` on another card | the active card moves; pinned groups appear in the comparison strip (three fixed slots); `pins` is in the URL | pins survive reload; `↵` opens Why?; `/` focuses the group filter |
| 5 | **Table** tab: hover a numeric cell and click the `?` (or focus it with `Tab`) | the "explain this number" popover: plain label, method term, formula `PI = n · (μ̄ − μ_s)₊`, the shrinkage form for the discounted shortfall, the inputs (n, μ̄, μ_s, γ) | γ = 50 is printed; the popover warns when a group keeps a small share of its shortfall |
| 6 | **Why?** on `vendorID_0128` | the group's sentence, six metrics, **Which expectations are missed** with the top three as bars, the shortfall waterfall (bars sum to the shortfall), expectation areas vs everyone, penalty Pareto, the full table of expectations; the **decision pane** stays on the right while scrolling | the waterfall's table alternative sums to the printed shortfall |
| 7 | **Compared with everyone else** tab; drag ϑ or W on the chart, or use the number inputs / sliders | histogram + ECDF; the line "x % beyond ϑ · mean violation" updates live | keyboard changes (arrow keys in the ϑ input) update the share |
| 8 | **Cases** tab → click a case id | trace timeline with missed expectations marked `▲` and listed per event; clicking an expectation highlights it | the table alternative lists the same events |
| 9 | **Where in the flow** tab | the process map of the group from `GET /runs/{id}/flow` with badges, arcs and tints for the expectations, the abstraction controls (activities, paths, stage view, keep connected), a legend and the **table alternative**; **compare with everyone else** colours the paths by the difference to the whole log without moving an activity | positions do not jump between the two scenes |
| 10 | decision pane: choose *investigate* | the save button stays disabled until a note is written; entering an owner alone never asks for a note | after **Save finding** the dashboard lists the finding under *Open findings* |
| 11 | `/p/p2p2018/norms` → v7 | constraints by layer, a calibration lens for the selected constraint, the **JSON** tab (CodeMirror, read-only, foldable), **Version notes** with lineage | committing a threshold from the lens asks for a note and creates v9 (draft) |
| 12 | `/p/p2p2018/data` → drop any CSV (or **Choose file…**), or **Load public log preset** | the job shows in the job tray with progress, the transport label *live* (the event stream) and *Cancel*; when done, **Open result** opens the dataset (or the run for the preset) | screen readers hear "Job … is done" (aria-live) |
| 13 | dataset page: keep the guessed mapping, tick `Vendor creates invoice` under *header events*, **Validate and build case table** | the build job runs; the readiness report appears with the replication caveat replaced by "Header events typed away" | the ribbon's *mapping* switcher lists the new case table |
| 14 | `/p/p2p2018/runs` → **New run** | the run form (case table, norm version, γ, min cases, views, groupings, note); the run monitor follows the job over the event stream and shows the manifest; its second tab draws the whole log's process map | when the job finishes, **Open backlog** shows the same screens for the new run |
| 15 | ribbon → *words* = method | every screen swaps: "slice", "gap", "stable PI", "hotspot type: reservoir", "stability unknown" first, the plain words secondary; the glossary (`?`) shows both | switching back restores the plain words |
| 16 | `⌘K` / `Ctrl K`, `?` | the command palette (screens and context switches in the current words) and the help drawer (glossary in both vocabularies, formulas, keyboard map) | both close with `Esc` and return focus |

Automated equivalents:

```sh
npm test          # Vitest: components (signal card in both vocabularies, badges, explain), the translation module, the backlog
                  # screen (cards, keyboard, URL filters, table tab), contract tests of the mocks against openapi.yaml, axe on six screens
npm run lint      # ESLint (0 problems)
npx tsc -b        # strict TypeScript
npm run build     # tokens build + tsc -b + vite build (route-level chunks)
npm run e2e       # Playwright smoke on the built app: upload → mapping → readiness → signals list → Why? (e2e/smoke.spec.ts)
```

Observed on 2026-09-06 (Node 18.20.8, Chromium via Playwright 1.55): `npm test` 14 files,
94 tests passed in about 30 s; `npm run lint` 0 problems; `npx tsc -b` clean; `npm run build` clean
(16 s; the ELK layout engine is the largest chunk); `npm run e2e` 1 passed (5.8 s, 25 s with the build).

## CP-B2 — frontend on the real backend

Start the backend on the verified BPIC 2019 workspace (`apps/backend/CHECKPOINT.md`,
"Serve the verified workspace"), then:

```sh
cd apps/frontend
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

In `vite dev` the SPA still calls `/api/v1` on its own origin and the dev proxy
(`vite.config.ts`, `server.proxy["/api"]`) forwards to `VITE_API_URL`, so no CORS
configuration is needed. Production builds (`npm run build`) call
`VITE_API_URL/api/v1` directly; the backend allows the `5173` and `4173` origins by
default. `VITE_USE_MOCKS=1` forces mocks even when the URL is set.

| Step | What you do | What appears (observed) | Pass when |
|---|---|---|---|
| 1 | open `/` | the ribbon shows `live backend` and the project `Demo`; the dashboard reads "Where is it worst? · run_0mtoq44vd14f208ur" with the sentence *companyID_0000 × Packaging · widespread: many cases, slightly off · 109,199 cases, 0.9 % below expectation on average, mostly Handovers and ageing · priority 945.7, rank 1 of 30*; overall average per perspective (Finance 0.819, Logistics 0.817, Compliance 0.871, Automation 0.844); "80 % of the priority sits in 2 groups"; the data caveats card lists the 11 readiness items | the project list comes from `GET /api/v1/projects` |
| 2 | **Data and mapping** | the dropzone, the **Load public log preset** card ("BPI Challenge 2019 (purchase-to-pay)" with the file path and the button), the datasets table (`BPI_Challenge_2019.csv`, ready, 1,595,923 events, content hash) | the preset card says the file is available on this machine |
| 3 | open the dataset (ribbon → *dataset*) | the readiness report of the case table (`warn`, the 1948 and 2020 stamps, sentinel dates, day-level precision, duplicated events, header replication, right-censoring), the column profiler with 22 columns, the mapping form prefilled "by the backend from the column names (BPI Challenge 2019 export)": case id `case concept:name`, activity `event concept:name`, timestamp with its format, exposure, 7 case attributes, 5 header events, closure `Clear Invoice`, flow types DF1, DF2, 2-way, Consignment | the readiness matches CP-A1 (251,734 cases) |
| 4 | **Norms** → v1 → **JSON** | "WISE BPIC'19 norm · v1", draft, 7 layers, 29 constraints, 4 views; the JSON is the library's own document | the fingerprint in the run manifest equals the version's |
| 5 | **Runs** → the run | status done, γ = 20, min cases 1, four views, grouping Company × Spend area text; **Parameters and manifest** (norm fingerprint, content hash, mapping, params hash, wise version, started, finished, job); **where in the flow**: the whole log's map ("251,734 cases · 1,595,923 events · 9 of 42 activities shown · 9 placed in stages") with the stage groups Request, Order, Receive, Invoice, Match, Pay, the abstraction controls and the legend | the manifest values equal `GET /runs/{id}` |
| 6 | **Open the ranked list** (filter: at least 1 case) | the signals list: the ranking rule "… (γ = 20)", perspective Automation, grouping Company × Spend area text, "30 groups ranked · 84.4 % overall average score"; card 1 *companyID_0000 × Packaging · widespread · confidence not computed · 109,199 cases · 0.9 % below expectation on average · mostly Handovers and ageing (Invoice-bearing flows should clear in a reasonable time, missed in 97 % of these cases) · priority 945.7 · rank 1 of 30 · Automation · Why?*; card 2 Logistics 5,242 cases, 5.6 %, systematic, priority 294.2; card 5 Real Estate 583 cases, priority 50.6 | the numbers equal CP-A2: 945.7 / 294.2 / 50.6 at ranks 1, 2, 5 |
| 7 | **Table** and **All groups at once** | the metric table with the plain headers (cases, average how-well score, shortfall, …) and the method's names beside them; the cases × shortfall scatter (shape = kind, size = priority, whiskers = cautious bound) and the concentration curve | the table's row 1 reads 109,199 · 0.836 · 0.9 % · 0.9 % · 945.9 · 945.7 |
| 8 | **Why?** on Packaging | after the backend's first re-score (about 13 s once per process) the group's sentence with the three expectations behind the shortfall; **Which expectations are missed**: *Invoice-bearing flows should clear in a reasonable time — missed in 97 % of cases — explains 93 % of the shortfall*, *In DF2, goods/service is to Remove Payment Block should be timely — 87 % — 24 %*, *Too many human handoffs indicate coordination cost — 85 % — 21 %*; the waterfall, the areas vs everyone, the penalty Pareto by vendor and the table of all 29 expectations | the waterfall sums to the shortfall 0.9 % |
| 9 | **Compared with everyone else** | the lens of `c_l3_invoice_to_clear_days` for this group: ϑ = 30 days, W = 60, histogram and ECDF, the share beyond ϑ | the inputs change the share live |
| 10 | **Cases** → `4507037358_00030` | 20 cases furthest off with their missed expectations; the timeline of the selected case: 28 events, `Change Quantity` marked for `c_l6_change_quantity`, `Change Price` for `c_l6_change_price`, … | the table alternative lists the same 28 events |
| 11 | **Can the data be trusted?** | the validation row: cases, shortfall, priority, share still open at the end of the data, share with duplicated events, shortfall kept without open cases, reading; the checks before acting | the numbers equal `GET /diagnostics` |
| 12 | **Where in the flow** | the group's map ("109,199 cases … 9 of 42 activities shown · 9 placed in stages") with the same positions as the whole log's; **compare with everyone else** recolours the paths by the difference; **table alternative** lists activities, paths and overlays | no activity moves when toggling |
| 13 | ribbon → *words* = method, then `?` | the same screens with slice, gap, stable PI, hotspot type, stability first; the glossary shows both columns | switching back restores the plain words |

Automated equivalent (the backend serving the verified workspace on port 8000):

```sh
E2E_API_URL=http://127.0.0.1:8000 npm run e2e      # e2e/real-backend.spec.ts; the mock smoke is skipped
```

The test opens the dashboard, the signals list of the verified run, checks the Table XI
rows on the cards and in the table (945.7, 294.2, 50.6), clicks **Why?** on Packaging, counts
the 29 expectations, opens a trace and the Flow tab with a map. Observed on 2026-09-06:
`1 passed (2.9 s; 25 s with the build)`. `E2E_PROJECT_ID` and `E2E_RUN_ID` pin the project
and run; otherwise the first project and its first done run grouped by company × spend
area are used.

## CP-1.1 — upload → mapping → readiness in the browser

Either drop the BPIC 2019 CSV into the dataset screen (the ingest job reads it
in place: about 65 s), open the dataset when it is ready (the mapping form is
prefilled from the column names) and press **Validate and build case table**
(about 10 s), or press **Load public log preset** on the data screen: one job
does ingest, case table, norm import and scoring (observed 87.9 s on a fresh
workspace; 0.9 s when everything exists already) and **Open result** in the job
tray opens the ranked list of the new run. Pass: the readiness banner shows the
same report as CP-A1 (251,734 cases; the 1948 and 2020 stamps reported).

## CP-1.2 — norm builder

What exists: the norm screen lists the constraints by expectation area with a
calibration lens per constraint; committing a threshold from the lens asks for
a note and creates the next version (draft) whose lineage shows in **Version
notes**; the **JSON** tab shows the library's document; the preset imports
`bpic19_norm.json` as version 1. The constraint editor forms, the applicability
rule tree and the views-and-weights matrix are not built (see "Not done").

## CP-1.3 — run with progress

**Runs → New run** (or the preset) starts a job; the job tray follows it over
`GET /jobs/{id}/events` (EventSource; the label under the progress bar reads
*live*; it reads *polling* where the stream is unavailable and the tray polls
`GET /jobs/{id}` every 700 ms instead). The run monitor shows the progress
messages ("scoring: scoring cases", "backlog case Company+case Spend area
text × Finance", …) and, when done, the manifest with the norm fingerprint and
the library version. Pass: the transport label says *live* and the tray
announces "Job … is done" without a reload.

## CP-1.4 — ranked list and Why?

On the verified run, **Why?** on Packaging: the three expectations behind the
shortfall explain 93 %, 24 % and 21 % of it, the waterfall's table alternative
sums to the shortfall (0.008662), and the cases furthest off open the trace
timeline with the missed expectations marked. (The plan names vendor 0128; that
is the mock's illustrative vendor, the real log's ranked list is by company ×
spend area.)

## CP-1.5 — process map

The Flow tab of the group and the run monitor's second tab render
`<ProcessMap/>` of `@wise/flow` from `GET /runs/{id}/flow`: the whole log and
the group are laid out together (`useStableLayout`), so the compare toggle
recolours without moving an activity; overlays come from the backend's
constraint statistics (badges, arcs, hatching, tints); the abstraction
controls and the table alternative are the library's.

## Not done (increment 1)

- **Stability / confidence in rank** is always "not computed" until the
  analytics package is wired into the backend; the filter *Only
  high-confidence ranks* then hides everything and says so.
- **Headroom / possible gain** is a placeholder table from the backend.
- **Findings, gates, dispositions** persist in the browser (`localStorage`,
  `src/lib/stores/findings.ts`) until the review endpoints of increment 2 exist;
  pass / fail / waive of a check is display-only.
- **Norm builder forms** (constraint editor, applicability tree, views & weights
  matrix, diff as changelog) are not built; the norm screen has the catalogue,
  calibration lens, JSON view and version notes.
- **Reason chain (RG-3) and remedy screen (RG-4)**: the Why? screen has the
  five blocks' data (missed expectations, flow, comparison, sub-groups as the
  penalty Pareto, data caveats) on tabs; the one-screen layout, the knowledge
  base's typical causes and "What can we do?" are cycle 2.
- **Caveat chips on cards (RG-6)** and the "how to read this" paragraph on
  every screen (RG-5) are cycle 2; the ranked list has the paragraph.
- **Presenter (review) mode, owner portal, period comparison, reports, assistant panel**: later increments.
- **Command palette** jumps to screens and context switches only.
- **i18n**: `en` only; `de` is v1. Number and date formats already go through `Intl`.
- The MSW fallback middleware serves `vite dev` only; `vite preview` and static
  hosting of a mock build rely on the service worker.


## Cycle 2 (2026-09-06) — the analysis path, the clean UI, flow types, decisions, the notebook

Everything below was observed on 2026-09-06 on the mocks (`npm run dev`) and on the live backend
serving the verified workspace on port 8010
(`WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --port 8010`,
then `VITE_API_URL=http://127.0.0.1:8010 npm run dev`). The backend's cycle-2 endpoints of the same day
(`packages/api-schema/openapi.yaml`, regenerated types under `generated/`) are what the screens call;
the mocks answer with the verified run's own responses where they exist and mark the rest illustrative.

### CP-2.0 — the clean UI (R2-O9)

| Step | What you do | What you see | Pass when |
|---|---|---|---|
| 1 | open the signals list of the verified run (`…/backlog?slicing=case Company+case Spend area text&view=Automation&minCases=1`) | one sentence under the title: *30 groups of purchase order items by Company × Spend area text, ranked by how many × how far below the overall score, small groups discounted (γ = 20), in the Automation perspective*; below it the **Refine** button with the perspective and grouping switchers, the active filters as chips (*at least 1 purchase order items*), one next step (*Why? companyID_0000 × Packaging — because it carries 57 % of the priority on this page and its rank is reliable*), then the cards | no γ, μ̄ or PI badge is on the screen in plain mode; switching the words to *method* brings the method strip back |
| 2 | read card 1 | *companyID_0000 × Packaging · widespread* — first line **109,199 purchase order items · 0.9 points below the overall score of 84.4 (1 %) · ●●● confidence high** — second line *mostly waiting too long between steps — Paid within terms: 83 days here against 55 elsewhere (+25 days).* — chips *14 % still open · 17 % near the window end* — the priority bar with *1 of 30* — **more** — **Why?** | the first line holds three numbers; the priority number appears only behind **more** (945.7, before discounting 945.9, cautious 903.8, the reading sentence) and on hover |
| 3 | **Refine** | a drawer with the filter questions (which group, at least … cases, only problems about …, only acute / systematic / widespread, only high-confidence ranks, caution against small groups, per page); every change lands as a chip above the list and in the address | removing a chip re-runs the list; **clear all** empties them |
| 4 | **Why?** on Packaging | the one-sentence header (items · points below · confidence), the reason line, the caveat chips and a compact strip (priority bar · rank 1 of 30 · Automation); no metric boxes in plain mode | the six boxes return only with *method* words |

### CP-2.1 — the analysis path and the way back (R2-O6, R2-O8)

| Step | What you do | What you see | Pass when |
|---|---|---|---|
| 1 | any screen | the stepper across the top: **⊘ Data → ● Norm → ● Run → ◐ Signals → ○ Why → ○ What to do** (arrows, the current step highlighted, the stage glyphs from the journey rail; *What to do* says *arrives in cycle 3*) | every step is a link to where its work happens; *Why* returns to the last group opened |
| 2 | Signals → Norm (stepper) → **Back to Where is it worst?** | the signals list with the same perspective, grouping and chips as before | the browser's back button walks the same way |
| 3 | Why? → *Compared with everyone else* → the norm's calibration lens link → **Back to Why?** | the reason screen on the same tab | the back control on the norm, run, notebook and data screens behaves the same |

### CP-2.2 — Why? on the first click (R2-O4)

Click **Why?** on a card that is not the active one (or the group link of a non-active table row):
the reason screen opens at once with a skeleton, then the group's sentence. Observed on the live
backend: one click, the first re-score of the run takes about 13 s and the skeleton shows meanwhile.
Automated: `Backlog.test.tsx` ("the first click on Why? opens the reason screen", "the table's slice
link opens the reason screen on the first click of a non-active row"). Root cause fixed: the table
scrolled the row into view on focus (mouse and keyboard alike), moving the target between mousedown
and click; the list's focus handler re-rendered between the two events. Both paths now leave the
DOM alone on the mouse path (`onMouseDown` prevents the focus move on the Why? button and the table
link; the table scrolls only on keyboard moves) and the router shows a pending skeleton after 50 ms.

### CP-2.3 — flow first and the flow-type fork (R2-O7, R2-O10)

| Step | What you do | What you see | Pass when |
|---|---|---|---|
| 1 | dashboard, or Data → the dataset → **Your process** | *The log splits into 4 flow types by flow_type; DF2 carries 88 % of the 251,734 purchase order items* and four cards: **DF2** 221,010 · 88 %, DF1 15,182 · 6.0 %, Consignment 14,498 · 5.8 %, 2-way 1,044 · 0.4 %, each with a share bar, a small map, the readiness headline and *14 % still open* where it applies; below: **Compare everything together** / **Analyse per flow type** / *flow types side by side* | the small maps come from `GET /case-tables/{ct}/flow-types` |
| 2 | **Analyse per flow type** (mocks) | four *Score DF2 / DF1 / Consignment / 2-way* jobs in the tray; when they are done the ribbon gains **flow type**: *all flow types / DF2 only / …*; the cards read **Open this flow** | a scoped run's signals list says *Signals · DF2 flow only* |
| 3 | run monitor → **Flow types side by side** | one column per flow type: items and share, *rules met 84.3 % (−0.1 points against everyone)*, *missed most: Mostly automatic in 93 % of purchase order items*, the largest groups, *14 % still open*, the link to the flow type's own run when it exists | read from `GET /runs/{r}/compare-flow-types` |
| 4 | Why? → **Where in the flow** (first tab) → right-click *Record Goods Receipt* → *filter to* | the chip *cases with Record Goods Receipt* above the map with cases in / out, the address carries `filter=`; *paths* highlights the incoming and outgoing paths with the side list; *lens* opens the distribution of the expectation touching the activity | the filter travels to the ranked list through the back control's address |

### CP-2.4 — decisions on the data caveats (R2-O1)

Data → the dataset → **Data caveats**: every item that allows a decision has a button (*Drop the
events outside the window*, *Treat placeholder dates as missing*, *Collapse exact duplicates*, *Mark
day-precise activities*, *Type the header events away*, *Decide how open cases count*, *Decide how
items without a value count*, *Assign the flow types*). **Preview the effect** prints *5,089 of
251,734 cases · 180,913 of 1,595,923 events affected* for the duplicates (the live backend's own
numbers); the note is mandatory; **Apply and rebuild the case table** stores the decision as a
versioned mapping decision, starts the rebuild job in the tray and re-scopes the screen to the new
case table whose report carries *Decided (…)*. **Decisions taken** lists kind, version, cases, events,
author, note, the resulting case table and the time.

### CP-2.5 — the slice designer (R2-O2)

Runs → **New run**: every grouping combines one to three attributes; numeric attributes (exposure,
n_events, …) are banded (equal-count bands with a number, or cut points); the id is the attributes
joined by `+`; **scope** offers *all flow types together* or one flow type. On a card, **more → Drill
into this group** opens the finer grouping inside the group (*vendors inside companyID_0000 ×
Packaging*: vendorID_0136 with 14,369 items first, from `GET /backlog?drillFrom=…&drillKey=…`) with a
chip to leave it.

### CP-2.6 — the essential "Why?" (RG-3) with the analytics fields (R1-01, R1-04)

Packaging: the header sentence with **confidence high** (bootstrap: P(stays in top-10) = 1.00 on
hover), the comparison *Paid within terms: 83 days here against 55 elsewhere (+25 days)*, the chips;
**Which expectations are missed**: *Paid within terms — Invoice-bearing flows should clear in a
reasonable time — missed in 97 % of these purchase order items — explains 93 % of the shortfall*,
then the real-unit sentence per expectation; **What kind of cases carry it** (vendorID_0136 15 % of
the shortfall, …); *Typical causes arrive with the knowledge hub in cycle 3*; the waterfall, the areas
and the full table behind **show all 29 expectations**; **Possible gain** in sentences (*If Paid within
terms were always met, this group would gain 4.3 points (100 % of its shortfall)*). No constraint id
is visible in plain mode.

### CP-2.7 — the notebook (R2-O11)

**Freeze this** on the dashboard, the signals list, Why?, the norm and the run screens: a dialog with
a title (prefilled) and a note; the screen is captured in the browser (html-to-image) and sent with
its numbers and context (run, grouping, perspective, filters, address, screen) to
`POST /notebook/snapshots`; *Frozen · open the notebook*. The **Notebook** (ribbon icon) lists the
snapshots in order with the image, the note and the context, moves them up and down, edits the notes,
returns to the frozen screen and exports Markdown with the images as a zip.

### Automated equivalents (observed 2026-09-06, Node 18.20.8)

```sh
npm test          # Vitest: 20 files, 136 tests in about 10 s (jsdom, MSW): the signal card on the verified row, the
                  # signals list (first-click Why?, Refine, chips, drill-in, table), the reason chain, the stepper and
                  # back control, the flow-type fork, decisions, the notebook, the filter store, contract tests of the
                  # mocks against openapi.yaml (56 operations), axe on nine screens
npm run lint      # ESLint 0 problems
npx tsc -b        # strict TypeScript, clean
npm run build:live  # tokens + tsc -b + vite build --mode live in 14 s (the build the backend serves)
npm run e2e       # Playwright smoke on mocks: upload → decision → flow types → signals → Why? → freeze → notebook
E2E_API_URL=http://127.0.0.1:8010 npm run e2e   # the live-backend run on the verified workspace (read only)
```
