# Workbench frontend

React 19, strict TypeScript and Vite. Use **Node 24 and npm**. From the repository root, run `tools/install.sh --dev`; the frontend then needs no sibling source checkout.

## Commands

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build:live
```

Run these in `apps/frontend`. `npm run dev` uses mock fixtures by default. Use `VITE_API_URL=http://127.0.0.1:8000 npm run dev` for a live backend. `npm run build:live` disables mocks and builds the same-origin SPA for the backend. `npm run generate` regenerates API types; both the schema and generated types are checked in CI.

`npm run e2e` builds into `dist-e2e` and serves port 4173, leaving the served `dist` alone. Install Chromium with `npx playwright install chromium`. Tests without `E2E_API_URL` use public fixture responses; live tests require an explicitly supplied backend and workspace.

## Process renderer

`@wise/flow` is a **required packaged dependency**, pinned in the lockfile to the artifact in [vendor](../../vendor/README.md). `npm ci` installs the real map and BPMN renderer. Vite and TypeScript use its public package exports; they do not inspect a sibling repository or silently substitute a stub. BPMN CSS/fonts come from `@wise/flow/bpmn.css`. Required bpmn.io attribution remains visible.

To update the renderer, build and validate a new artifact in the flow repository, then refresh the vendored package, provenance and lockfile together. The source repository owns the renderer; the app does not maintain a copied fork of its source. Replace the artifact reference with an exact registry version when that release is published.

## Boundaries

- `app/`: routes, shared context, navigation and shell.
- `routes/`: data, norms, runs, signals, flow/board, investigation, review and notebook screens.
- `components/flow/`: convert API data to the public flow contract and handle host actions.
- `lib/api/`, `lib/queries.ts`: requests and query state; HTTP DTOs come from `packages/api-schema/generated`.
- `lib/stores/`: local interface state; durable findings/actions are backend records.
- `mocks/`: deterministic contract fixtures; `test/`: unit/accessibility setup; `e2e/`: browser journeys.

Keep one primary action, a readable sentence and removable filter chips on each screen. Selections must change the visible population consistently. The design documents describe further goals; unresolved usability and calibration issues are listed in the [repository README](../../README.md#current-limits).
