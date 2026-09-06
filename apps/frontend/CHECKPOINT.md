# Frontend checkpoints (increment 0)

How a person tries workstream B by hand. Paths assume the workbench at
`~/code/PhD/WISE/wise-workbench`. Node 18.20 and npm 10 are enough; no pnpm.

## Setup (once)

```sh
cd apps/frontend
npm install
```

`npm run dev`, `npm run build` and `npm test` first compile the design tokens
(`packages/design-tokens/tokens.json` → `dist/tokens.css`, `dist/echarts-theme.*.json`,
`dist/contrast-report.json`; the build fails if any text/background pair drops
below 4.5:1). `npm run generate` regenerates `packages/api-schema/generated/schema.d.ts`
from `packages/api-schema/openapi.yaml`.

## CP-B1 — frontend on mock data

```sh
cd apps/frontend
npm run dev
```

Open `http://127.0.0.1:5173/`. `VITE_API_URL` is unset, so the SPA runs on MSW mocks
generated from the contract. The ribbon shows a `mock data` badge. Requests are
answered by the service worker; where a browser cannot register one, the same
handlers answer from the Vite dev server (`src/mocks/vitePlugin.ts`), so the
screens work either way.

| Step | What you do | What you see | Pass when |
|---|---|---|---|
| 1 | open `/` | redirect to `/p/p2p2018`: dashboard with the charter, the context ribbon (project · dataset · mapping · norm · run · view · by · period), the journey rail on the left with S0–S12 and their states, a readiness banner ("4 caveats travel with every result") | S2 and S7 read *gated* and "Why gated" opens the reason and the screen where to fix it |
| 2 | ribbon → change *view* to `Logistics` | the backlog explorer opens for `run_41`, view Logistics, URL carries `slicing=vendor&view=Logistics` | reloading the page keeps the same view |
| 2b | ribbon → *by* = `company_spend`, *view* = `Automation`; filter γ = 20, min cases 1 | the mock reproduces Table XI: Packaging, Logistics and Real Estate with stable PI 945.7 / 294.2 / 50.6 at ranks 1, 2, 5 (the same numbers CP-A2 prints) | rank and values match CP-A2 |
| 3 | backlog: set *hotspot type* = `mechanism`, *min cases* = 100, type `01` in *search slice* | the table, the volume × gap scatter and the concentration curve update; the URL holds `hotspotType`, `minCases`, `q` | reload keeps every filter; **Reset filters** clears them |
| 4 | click a table row, press `↓` `↓`, `p`, `p` on another row | the active row moves; pinned rows appear in the comparison strip (three fixed slots); `pins` is in the URL | pins survive reload; `Enter` opens the slice; `/` focuses the search box |
| 5 | hover a numeric cell and click the `?` (or focus it with `Tab`) | the "explain this number" popover: formula `PI = n · (μ̄ − μ_s)₊`, the shrinkage form for the stable gap, the inputs (n, μ̄, μ_s, γ) | γ = 50 is printed; the stable-gap popover warns when a slice keeps a small share of its gap |
| 6 | open `vendorID_0128` | reading sentence header, six metrics, the **Drivers** tab with a gap waterfall (bars sum to the gap), layer bars vs global, penalty Pareto; the **decision pane** stays on the right while scrolling | the waterfall's table alternative sums to the printed gap |
| 7 | **Distributions** tab; drag ϑ or W on the chart, or use the number inputs / sliders | histogram + ECDF; the line "x % beyond ϑ · mean violation" updates live | keyboard changes (arrow keys in the ϑ input) update the share |
| 8 | **Cases** tab → click a case id | trace timeline with violated constraints marked `▲` and listed per event; clicking a constraint highlights it | the table alternative lists the same events |
| 9 | decision pane: choose *investigate* | the save button stays disabled until a note is written; entering an owner alone never asks for a note | after **Save finding** the dashboard lists the finding under *Open findings* |
| 10 | `/p/p2p2018/norms` → v7 | constraints by layer, a calibration lens for the selected constraint, the **JSON** tab (CodeMirror, read-only, foldable), **Version notes** with lineage | committing a threshold from the lens asks for a note and creates v9 (draft) |
| 11 | `/p/p2p2018/data` → drop any CSV (or **Choose file…**) | the ingest job shows in the job tray with progress and *Cancel*; when done, **Open result** opens the dataset | screen readers hear "Job … is done" (aria-live) |
| 12 | dataset page: keep the guessed mapping, tick `Vendor creates invoice` under *header events*, **Validate and build case table** | the build job runs; the readiness report appears with the replication caveat replaced by "Header events typed away" | the ribbon's *mapping* switcher lists the new case table |
| 13 | `/p/p2p2018/runs` → **New run** | the run form (case table, norm version, γ, min cases, views, slicings, note); the run monitor shows SSE-style progress (polling on mocks) and the manifest | when the job finishes, **Open backlog** shows the same screens for the new run |
| 14 | `⌘K` / `Ctrl K`, `?` | the command palette (screens and context switches) and the help drawer (glossary, formulas, keyboard map) | both close with `Esc` and return focus |

Automated equivalents:

```sh
npm test          # Vitest: components, contract tests of the mocks against openapi.yaml, axe on five screens
npm run lint      # ESLint (0 errors)
npm run build     # tsc -b + vite build (route-level chunks)
npm run e2e       # Playwright smoke (upload → mapping → readiness → backlog → slice) on the built app
```

`npm run e2e` needs a browser once: `npx playwright install chromium`. On 2026-09-05
in this environment (Node 18.20.8, Chromium via Playwright 1.55): `1 passed (20 s)`;
the run builds the app and serves it with `vite preview` on `127.0.0.1:4173`, where the
service worker handles the mocks. Results on the same date: `npm test` 12 files, 69 tests
passed; `npm run lint` 0 problems; `npm run build` clean (tsc strict + Vite, route-level chunks).

## CP-B2 — frontend on the real backend

Start CP-A3 (`apps/backend`, `.venv/bin/wise-workbench serve` on `127.0.0.1:8000`), then:

```sh
cd apps/frontend
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

In `vite dev` the SPA still calls `/api/v1` on its own origin and the dev proxy
(`vite.config.ts`, `server.proxy["/api"]`) forwards to `VITE_API_URL`, so no CORS
configuration is needed. Production builds (`npm run build`) call
`VITE_API_URL/api/v1` directly. `VITE_USE_MOCKS=1` forces mocks even when the
URL is set.

| Step | What you do | Pass when |
|---|---|---|
| 1 | open `/` | the ribbon shows `live backend`; the project list comes from `GET /api/v1/projects` |
| 2 | data screen → upload the running example CSV | the ingest job in the tray follows `GET /jobs/{id}`; the dataset turns *ready* |
| 3 | map columns → build | `GET /case-tables/{id}` readiness matches CP-A1 (251,734 cases; 1948 and 2020 outliers reported) |
| 4 | runs → new run with `bpic19_norm.json` (v7), slicing `company,spend_area`, view Automation, γ = 20, min cases 1 | backlog numbers equal CP-A2: Packaging, Logistics and Real Estate with stable PI 945.7 / 294.2 / 50.6 at ranks 1, 2, 5 |
| 5 | open a slice | drivers sum to the gap; trace events carry `violates` |

The contract tests (`src/mocks/contract.test.ts`) validate the mocks against
`openapi.yaml`; when the backend regenerates the file, `npm run generate` updates the
types and `tsc` reports every screen that reads a changed field.

## Not done (increment 0)

- **SSE**: the job tray polls `GET /jobs/{id}` every 700 ms; `GET /jobs/{id}/events`
  is mocked (contract test) but the client does not open the stream yet.
- **Stability filter** is applied on the loaded page (the contract has no
  `stability` query parameter); server-side filtering needs a contract addition.
- **Findings, gates, dispositions** persist in the browser (`localStorage`,
  `src/lib/stores/findings.ts`) until the review endpoints of increment 2 exist;
  gate pass / fail / waive is display-only.
- **Norm builder forms** (constraint editor, views & weights matrix, diff as
  changelog) are increment 1; the norm screen has the catalogue, calibration lens,
  JSON view and version notes.
- **Process map / Flow tab** waits for `@wise/flow`; `GET /runs/{id}/flow` is mocked.
- **Presenter (review) mode, owner portal, period comparison, reports, assistant panel**: later increments.
- **Command palette** jumps to screens and context switches only; slices, constraints,
  cases and commands arrive in v1.
- **i18n**: `en` only; `de` is v1. Number and date formats already go through `Intl`.
- **Figma sync** of the tokens (UX-26) is not wired.
- The MSW fallback middleware serves `vite dev` only; `vite preview` and static
  hosting of a mock build rely on the service worker.
