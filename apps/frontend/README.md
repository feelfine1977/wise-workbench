# apps/frontend

React 19 + TypeScript (strict) + Vite 5 single-page app for the WISE Workbench.
Runs on Node 18 with npm (no pnpm needed). Try it: `CHECKPOINT.md`.

## Stack

TanStack Query (server data), TanStack Router (code-based routes, typed search
params: every filter lives in the URL), TanStack Table + Virtual (backlog), Zustand
(UI state, job tray, browser-side findings), Tailwind on design tokens, Radix
primitives with a small shadcn-style component set, Apache ECharts (lazy, themed from
the tokens), CodeMirror 6 (norm JSON), openapi-typescript + openapi-fetch (contract
client), MSW (mocks in the browser and in tests), i18next (`en`), Vitest + Testing
Library + axe-core, Playwright smoke.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | tokens build, then Vite on `127.0.0.1:5173`; mocks unless `VITE_API_URL` is set |
| `npm run build` | tokens build, `tsc -b`, `vite build` into `dist/` |
| `npm test` | Vitest (jsdom, MSW in Node) |
| `npm run lint` | ESLint 9 flat config |
| `npm run e2e` | Playwright smoke on the built app (`npx playwright install chromium` once) |
| `npm run generate` | regenerate `packages/api-schema/generated/schema.d.ts` from `openapi.yaml` |
| `npm run tokens` | compile `packages/design-tokens/tokens.json` |

Configuration: `.env.example` (`VITE_API_URL`, `VITE_USE_MOCKS`).

## Structure

```
src/
  main.tsx                 bootstrap: tokens CSS, mocks (if enabled), providers, router
  app/
    router.tsx             route tree; every screen is a lazy chunk
    search.ts              typed search-param validators (backlog, slice, norm, dataset)
    context.ts             useWorkbench(): project · dataset · mapping · norm · run · view · slice key · period
    providers.tsx          QueryClient, tooltips, RouterProvider
    shell/                 AppShell, ContextRibbon, JourneyRail (+ journey.ts states), JobTray, CommandPalette, HelpDrawer
  routes/
    ProjectsPage, DashboardPage
    data/                  DataPage (dropzone → ingest job), DatasetPage (profiler, mapping form, readiness)
    norms/                 NormsPage, NormPage (catalogue, calibration lens, JSON, version notes)
    runs/                  RunsPage (+ run form), RunPage (monitor, manifest)
    backlog/               BacklogPage, Filters, BacklogTable (virtualised, keyboard), BacklogCharts, ComparisonStrip
    slice/                 SlicePage, charts (waterfall, layer bars, Pareto), TraceTimeline, DecisionPane
  components/
    ui/                    button, badge, popover, dialog, sheet, tabs, select, tooltip, input, label, checkbox, misc
    badges.tsx             hotspot / stability / gate / layer badges (glyph + text, never colour alone)
    explain.tsx            "explain this number" popover, Metric, backlog formulas
    DistributionLens.tsx   histogram + ECDF with draggable ϑ and W (lens.ts holds the pure statistics)
    charts/                lazy ECharts core + token themes, EChart wrapper
    reading.tsx, states.tsx, readiness.tsx, JsonView.tsx
  lib/
    api.ts, queries.ts     openapi-fetch client, query options and mutations
    config.ts              VITE_API_URL / VITE_USE_MOCKS resolution
    format.ts              Intl number and date formatting
    glossary.ts            method vocabulary (help drawer, popovers)
    i18n/                  i18next with en.json
    stores/                ui, jobs, findings (zustand)
  mocks/
    handlers.ts, db.ts     MSW handlers for every contract path; in-memory state with progressing jobs
    fixtures/              project, datasets + readiness, norm versions (BPIC'19 norm), runs, backlog generator,
                           slice detail (drivers sum to the gap), traces, distributions
    browser.ts, node.ts    worker / server setups; vitePlugin.ts answers /api/v1 in the dev server as a fallback
  test/                    Vitest setup (MSW, jsdom shims, chart mock) and helpers (renderApp, axe)
e2e/                       Playwright smoke
public/mockServiceWorker.js
```

Shared packages used through path aliases: `@wise/api-schema`
(`packages/api-schema/generated`) and `@wise/design-tokens`
(`packages/design-tokens`, built into `dist/`).
