# .github/workflows

`ci.yml` runs on pushes to `main`, on pull requests and by hand:

| Job | Runner | What it does |
|---|---|---|
| `backend` | Python 3.12 and 3.13 | installs `wise-pm` from GitHub (`git+https://github.com/feelfine1977/wise-pm.git@v0.1.0`), the knowledge package and `apps/backend[dev]`; `ruff check`, `ruff format --check`, `mypy`, `pytest`; regenerates the OpenAPI document and diffs it against `packages/api-schema/openapi.yaml` |
| `analytics` | Python 3.12 | `packages/wise-analytics`: `ruff`, `mypy`, `pytest` |
| `knowledge` | Python 3.12 | `packages/process-knowledge`: `ruff`, `pytest` |
| `frontend` | Node 20 | `npm ci` (the flow library link is absent on the runner, so the stub in `apps/frontend/stubs/wise-flow` is resolved), design tokens, `eslint`, `tsc -b`, `vitest`, a check that `npm run generate` leaves `packages/api-schema/generated` unchanged, `npm run build:live` |

Actions: `actions/checkout@v5`, `actions/setup-python@v6`, `actions/setup-node@v5` (all on the Node 24 runtime).

Not in CI: the Playwright smoke tests (`npm run e2e`) and the real-backend e2e, which need a browser and the BPIC 2019 workspace; run them locally as described in `apps/frontend/README.md`. Release jobs (wheels, images, desktop bundles) arrive with the deployment work.
