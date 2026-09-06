# apps/frontend

React 19 + TypeScript (strict) + Vite 5 single-page app for the WISE Workbench.
Runs on Node 18 with npm (no pnpm needed). Try it: `CHECKPOINT.md`. Plain words
first on every screen, the method's terms as secondary labels, a switch in the
ribbon (`src/lib/vocabulary.ts` holds the translation table). Cycle 2 added the
analysis path across the top of every screen, the clean-UI pass, the flow-type
fork, decisions on the data caveats, the filter model on the map, the slice
designer, the essential "Why?" reason chain and the analysis notebook.

## Visual checklist (R2-O9)

Applied to every screen before a release; the cycle-2 screens were checked
against the live application on the verified workspace on 2026-09-06.

1. **One dominant element per screen.** The sentence a reader takes away sits
   first and largest (`.headline`): the top signal on the dashboard, the ranking
   sentence on the signals list, the group's sentence on "Why?", the flow types
   at the data step. Everything else is smaller and below it.
2. **One reading sentence of at most two lines per card and per header**
   (`.reading`, 68 characters wide, `.clamp-2` on the second line). The rest sits
   behind "more".
3. **At most three numbers in the first line of a card**: how many cases (the
   case noun), how far below the overall score (points, with the percent in
   brackets), the confidence word. Priority is a bar with the rank; its number
   is behind "more" and on hover.
4. **The six metric boxes are gone from the slice header** in plain mode: one
   sentence, the caveat chips and a compact strip (priority bar, rank,
   perspective). Method mode brings the boxes back.
5. **Filters live in one "Refine" drawer**; the active ones show as chips above
   the list, every chip removable, "clear all" beside them.
6. **No repeated layer description on every card**: the missed-form label of the
   expectation area ("waiting too long between steps") and the real-unit
   comparison, the full description on hover and behind "more".
7. **Method terms hidden in plain mode** (constraint ids, PI, γ, μ̄, hotspot
   types); the words switch in the ribbon brings them back everywhere.
8. **Generous spacing and larger type**: base 15 px, card padding and gap from
   the density tokens (`--card-padding`, `--card-gap`), section gap 20 px,
   `max-width: 1400px` for the main region.
9. **Calm palette, one meaning per colour**: the kind of problem on the list,
   missed vs met on the reason screen, gain on the possible-gain list; warning
   tones only for caveats. Colour never carries meaning alone (glyph + word).
10. **Consistent components**: `Card`, `NextStep`, `HowToRead`, `BackControl`,
    `CaveatChips`, `FilterChipsRow`, `FreezeButton` are the only building blocks for these
    elements. The next step exists on the dashboard and after a saved decision only; every
    screen has one primary button; the how-to-read paragraph is collapsed and opens from
    the `?` beside the title.
11. **A back control on every sub-screen** returning to the exact place the
    reader came from, cutting the navigation stack back to it (`popTo`), with the state
    it restores in its label when the origin is the ranked list; `Alt+←` presses it,
    `Alt+1` … `Alt+6` press the steps; the browser's back button always works.
12. **Axe clean** (no serious or critical violation) on the dashboard, the data
    caveats, the mapping, the signals list, the table, "Why?", the flow-type
    comparison, the notebook and the norm screen (`src/routes/a11y.test.tsx`).

## Stack

TanStack Query (server data), TanStack Router (code-based routes, typed search
params: every filter lives in the URL), TanStack Table + Virtual (backlog), Zustand
(UI state, job tray, browser-side findings), Tailwind on design tokens, Radix
primitives with a small shadcn-style component set, Apache ECharts (lazy, themed from
the tokens), CodeMirror 6 (norm JSON), openapi-typescript + openapi-fetch (contract
client), MSW (mocks in the browser and in tests), i18next (`en`), `@wise/flow` (the
process map, an optional link to the sibling checkout `../../../wise-flow`, imported from its
`dist/`; see "The flow library" below), Vitest + Testing Library + axe-core, Playwright (mock
smoke and a live-backend run).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | tokens build, then Vite on `127.0.0.1:5173`; mocks unless `VITE_API_URL` is set |
| `npm run build` | tokens build, `tsc -b`, `vite build` into `dist/` (mocks unless `VITE_API_URL` is set) |
| `npm run build:live` | the same with `--mode live` (`.env.live`: no backend URL, mocks off): the build the backend serves at `/` (`wise-workbench serve`, `tools/start.sh`) |
| `npm test` | Vitest (jsdom, MSW in Node) |
| `npm run lint` | ESLint 9 flat config |
| `npm run e2e` | Playwright on a build in `dist-e2e/` served on 4173 (`npx playwright install chromium` once): the mock smoke, or with `E2E_API_URL=http://127.0.0.1:8010` the live-backend run (read only on the verified workspace); `dist/` is left alone |
| `npm run generate` | regenerate `packages/api-schema/generated/schema.d.ts` from `openapi.yaml` |
| `npm run tokens` | compile `packages/design-tokens/tokens.json` |

Configuration: `.env.example` (`VITE_API_URL`, `VITE_USE_MOCKS`). With `VITE_API_URL` set,
`vite dev` proxies `/api` to the backend and production builds call it directly (the
backend allows the `5173` and `4173` origins by default). `VITE_USE_MOCKS=0` without a URL
makes the build call `/api/v1` on its own origin — the build that the backend serves
(`npm run build:live` sets both through `.env.live`).

## The flow library

`@wise/flow` (0.3: selection, actions menu, paths, filter chips, stage lanes, Canvas renderer) is an
`optionalDependencies` entry, `file:../../../wise-flow`. When the sibling
checkout exists, `npm install` links it (`node_modules/@wise/flow`) and the app imports its
`dist/` (build it there first: `npm install && npm run build`). `FlowMap.tsx` uses the 0.3
interactions: a right click (or Enter) on an activity or a path opens the actions menu; filter-to
and exclude write the screen's filter model (`filter` in the URL), paths focuses the activity
(`activity` in the URL, the paths block of `GET …/flow?focus=`), lens and worst-cases jump to the
distribution and the cases tabs; the chips above the map show the clauses with cases in / out. When the checkout is absent — a
fresh clone, the CI runner — npm leaves a dangling link and does not fail; `vite.config.ts`
then aliases `@wise/flow`, `@wise/flow/react` and the two CSS entries to `stubs/wise-flow/`,
and `tsconfig.app.json` resolves the types through the same fallback. The stub carries the
names `FlowMap.tsx` imports (`canonicalOverlays`, `defaultStyle`, `diff`, `diffStyle`,
`filterPositions`, `useStableLayout`, `ProcessMap`) with reduced types; its `ProcessMap`
renders a notice instead of a map, everything else works. `WISE_FLOW_STUB=1 npm run build`
forces the stub with the checkout present, to test that path. The decision is made at config
time from the existence of `node_modules/@wise/flow/dist/react/index.js`; after building the
library run `npm install` again if the link was dangling.

## Structure

```
src/
  main.tsx                 bootstrap: tokens CSS, mocks (if enabled), providers, router
  app/
    router.tsx             route tree; every screen is a lazy chunk with a pending skeleton (the first click never looks swallowed)
    search.ts              typed search-param validators (backlog with filter and drill-in, slice with filter and activity, norm, dataset tabs, run tabs, notebook)
    context.ts             useWorkbench(): project · dataset · mapping · norm · run · view · slice key · period
    providers.tsx          QueryClient, tooltips, RouterProvider
    shell/                 AppShell (the three bands: ribbon, stepper, page; records every location for the back controls; Alt+← and Alt+1…6),
                           Stepper (the analysis path Data → Norm → Run → Signals → Why → What to do with states from the data, "you are here", a second line for
                           sub-screens and the twelve stages behind "All stages"; journey.ts computes their states), ContextRibbon (switchers per step, the rest in ⋯,
                           caveats chip, notebook count, camera), JobTray, CommandPalette, HelpDrawer
  routes/
    ProjectsPage, DashboardPage (one sentence, next step, Your process, caveats in one line, findings)
    data/                  DataPage (dropzone, presets, Your process), DatasetPage (tabs: data caveats with ReadinessDecisions, Your process, column mapping)
    flow/YourProcess.tsx   the log split by flow type: cards with counts and a small map each, "analyse this flow", compare everything together / analyse per flow type (forks one run per type)
    norms/                 NormsPage, NormPage (catalogue, calibration lens, JSON, version notes; back control, freeze)
    runs/                  RunsPage (+ run form with SliceDesigner and the flow-type scope), RunPage (monitor, manifest, flow, CompareFlowTypes side by side)
    backlog/               BacklogPage ("Where is it worst?": one sentence, the page-wide caveats once, Refine drawer with chips, signals list first, table and scatter as tabs),
                           SignalsList, SignalCard (three numbers, the reason line, caveat chips, priority bar, "more", drill into this group),
                           Refine (drawer + chips + cases in/out), Filters (questions), BacklogTable, BacklogCharts, ComparisonStrip
    slice/                 SlicePage ("Why?": one sentence, Flow tab first with the map's actions, expectations in plain words with the real-unit comparison,
                           sub-groups, the typical-causes placeholder, lens, cases, caveats, possible gain in sentences), charts, TraceTimeline, DecisionPane
    notebook/NotebookPage  the analysis notebook: snapshots in order with image, note and context; reorder, edit, Markdown export
  components/
    ui/                    button, badge, popover, dialog, sheet, tabs, select, tooltip, input, label, checkbox, misc
    guide/                 HowToRead (+ toggle), NextStep, BackControl, CaveatChips, Freeze (the "Freeze this" button and dialog)
    Term.tsx               a term in the current vocabulary with the other one as a secondary label (definition on hover)
    badges.tsx             kind of problem / confidence / gate / layer badges (glyph + text, never colour alone)
    explain.tsx            "explain this number" popover, Metric, backlog formulas
    flow/FlowMap.tsx       <ProcessMap/> of @wise/flow 0.3: shared layout, compare toggle, actions menu → filter model, paths, lens; MiniMap for the cards
    DistributionLens.tsx   histogram + ECDF with draggable ϑ and W (lens.ts holds the pure statistics)
    charts/                lazy ECharts core + token themes, EChart wrapper
    reading.tsx, states.tsx, readiness.tsx, JsonView.tsx
  lib/
    api.ts, queries.ts     openapi-fetch client, query options and mutations (backlog with filter, drill-in, stability; flow with filter)
    api/cycle2.ts          the cycle-2 operations on the generated types: flow types, compare, decisions, filter and slicing previews, analytics, notebook
    filter.ts              the filter model in the URL: parse, serialise, add / remove clauses, plain descriptions
    capture.ts             client-side capture of a screen (html-to-image) for the notebook
    config.ts              VITE_API_URL / VITE_USE_MOCKS resolution
    format.ts              Intl number and date formatting
    vocabulary.ts          the translation table (plain label, method term, definition, formula, the comprehension test's rewording), kinds, confidence words
    glossary.ts            the glossary built from it (help drawer, popovers)
    i18n/                  i18next with en.json
    stores/                ui (theme, density, words, how-to-read state), jobs, findings, nav (visited locations for the back controls)
  mocks/
    handlers.ts, db.ts     MSW handlers for every contract path (cycle 2 included); in-memory state with progressing jobs, scoped runs, decisions, the notebook
    fixtures/verified/     responses of the verified run run_0mtoq44vd14f208ur (backlog rows of company × spend area and vendor in four perspectives,
                           slice details, maps, distribution, flow types, comparison, decision kinds, analytics, drill-in); `verified.ts` loads them
    fixtures/cycle2.ts     the contract's shapes for the illustrative slicings (marked `params.illustrative`), filters, drill-in, decisions
    fixtures/              project, datasets + readiness, norm versions (BPIC'19 norm), runs, the illustrative backlog generator, slice detail, traces, distributions, flow
    browser.ts, node.ts    worker / server setups; vitePlugin.ts answers /api/v1 in the dev server as a fallback
  test/                    Vitest setup (MSW, jsdom shims, chart and map mocks) and helpers (renderApp, axe)
e2e/                       Playwright: smoke.spec.ts (mocks: upload → decision → flow types → signals → Why? → freeze → notebook), real-backend.spec.ts (with E2E_API_URL, read only)
stubs/wise-flow/           stand-in for @wise/flow when the checkout is absent (see above)
public/mockServiceWorker.js
.env.live                  the `build:live` mode: same-origin API, mocks off
```

Shared packages used through path aliases: `@wise/api-schema`
(`packages/api-schema/generated`, regenerated with `npm run generate` from the backend's
`openapi.yaml`; the cycle-2 operations are typed there and `src/lib/api/cycle2.ts` reads them) and
`@wise/design-tokens` (`packages/design-tokens`, built into `dist/`; version 0.2 raised the base type
to 15 px and added the card padding and gap per density and the reading measure). `@wise/flow` is an optional `file:` dependency
on the sibling checkout; React, React DOM and React Flow are deduplicated in `vite.config.ts`
so the linked package uses the app's copies.

## Mock data and the verified run

The mocks serve the verified run's own responses for the company × spend area and vendor
groupings (every number equals the API's, including the analytics fields: stability, comparison
sentence, caveats, plain layer names, points below); the other groupings (item type, flow type) and
every drill-in outside Packaging are generated and marked `params.illustrative`, which the signals
list shows as a badge. The vendor grouping carries the top 50 of 1,975 rows; pages beyond the fifth are
empty on mocks. The mock chunk (`browser-*.js`, about 1.4 MB) is loaded only when mocks are on.

## Serving the built app

`npm run build:live` writes `dist/`; `wise-workbench serve` in `apps/backend` serves it at `/`
with history fallback next to `/api/v1` and `/docs` (the backend looks for
`apps/frontend/dist`, or `WISE_STATIC_DIR`). `tools/start.sh` at the repository root does the
build and the start in one go. Rebuild after changing the sources; `npm run dev` stays the
way to work on them.
