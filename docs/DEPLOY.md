# Running WISE Workbench today

This page is for the person who runs the application on a laptop or a
workstation. The team and server profiles (Docker, Postgres, login) are
described in `docker/DEPLOYMENT.md` and arrive with a later cycle; nothing on
this page needs Docker.

## One command

From a checkout of this repository with the backend installed (see "Install"
below):

```bash
tools/start.sh
```

The script builds the frontend once (`apps/frontend`, `npm run build:live`),
starts the backend and opens `http://127.0.0.1:8000/` in the default browser.
`tools/start.sh --no-build` skips the build when `apps/frontend/dist` already
exists; every other argument is passed on to the server, for example
`tools/start.sh --no-open --port 8010`.

The same without the script, once the frontend is built:

```bash
cd apps/backend && .venv/bin/wise-workbench serve --open
```

`wise-workbench serve` serves three things on one port: the application at
`/`, the API under `/api/v1` and its documentation at `/docs`. Stop it with
Ctrl-C; jobs that were running are finished or restarted by the next start
(they are crash-safe, see `apps/backend/CHECKPOINT.md`, CP-A4).

## Install

Python 3.11 or newer and Node 18 or newer. The `wise` library is a separate
repository (`github.com/feelfine1977/wise-pm`); the workbench expects it
next to this checkout as `../wise-lib`, or installs it from GitHub.

```bash
cd apps/backend
python3 -m venv .venv
.venv/bin/pip install -e ../../../wise-lib          # or: pip install "git+https://github.com/feelfine1977/wise-pm.git@v0.1.0"
.venv/bin/pip install -e .                          # the backend and the wise-workbench command
.venv/bin/pip install -e ../../packages/process-knowledge   # optional: stage groups on the process map
cd ../frontend && npm install                       # once; the flow library is optional (see apps/frontend/README.md)
```

`pip install -e apps/backend` alone gives a working `wise-workbench`; the
development extras (`.[dev]`) are only needed for the tests.

The process map's stage boxes (Request, Order, Receive, Invoice, Match, Pay)
come from the knowledge package; without it the map has no stage groups and
everything else works. The flow library `@wise/flow` is expected as a sibling
checkout `../wise-flow` with a built `dist/`; without it the frontend builds
with a stand-in and the Flow tabs show a notice instead of a map.

## The workspace folder

Everything the application writes goes into one folder, the workspace
(`WISE_WORKSPACE`, default `~/WISE Workbench`). It is readable without the
application:

```
<workspace>/
  workspace.json  workbench.db  cache/  tmp/
  projects/<project id>/
    datasets/<dataset id>/        source/<file> (uploads only)  events.parquet  schema.json  manifest.json
    case_tables/<case table id>/  cases.parquet  events.parquet (typed)  quality.json  activities.json  manifest.json
    norms/<norm id>/vNNN.json     every norm version, immutable, in the library's format
    runs/<run id>/                frame.parquet  violations.parquet  in_scope.parquet  summary.json
                                  backlogs/<grouping>__<perspective>.parquet  drivers/…  diagnostics/…  manifest.json (written last)
```

`workbench.db` is the metadata (SQLite): projects, datasets, mappings, norm
versions, runs and jobs. The Parquet files are readable with pandas or
DuckDB without the application.

Uploaded logs are copied into the workspace; the public-log preset reads the
CSV in place from `WISE_BPIC19_CSV` (only its hash is stored). Every run
manifest records the content hash of the log, the norm fingerprint, the
parameter hash and the library version, so a result can be traced to its
inputs.

**Backup**: stop the application and copy the folder (`cp -r`, a ZIP, a
snapshot). `workbench.db` and `projects/` belong together; `cache/` and
`tmp/` can be left out. Restoring is copying the folder back and pointing
`WISE_WORKSPACE` at it. The verified BPIC 2019 workspace used in the
documentation is `~/code/PhD/WISE/wise-workbench-data/workspace_verify`.

## Environment variables

All settings are read from the environment with the prefix `WISE_`
(`apps/backend/src/wise_workbench/settings.py`); `--workspace`, `--host`,
`--port`, `--static` and `--no-worker` on the command line override them.

| Variable | Default | Meaning |
|---|---|---|
| `WISE_WORKSPACE` | `~/WISE Workbench` | the workspace folder |
| `WISE_DATABASE_URL` | `sqlite:///<workspace>/workbench.db` | metadata database; Postgres is possible but untested in this release |
| `WISE_HOST`, `WISE_PORT` | `127.0.0.1`, `8000` | where the server listens; `0.0.0.0` exposes it on the network (no login exists yet) |
| `WISE_STATIC_DIR` | package `static/`, then `apps/frontend/dist` | the built frontend to serve at `/` |
| `WISE_INPROCESS_WORKER` | `1` | run jobs inside the server; `0` needs `wise-workbench worker` in another terminal |
| `WISE_CORS_ORIGINS` | the Vite ports 5173 and 4173 | comma-separated origins allowed to call the API from another origin (not needed when the backend serves the frontend) |
| `WISE_BPIC19_CSV`, `WISE_BPIC19_NORM` | paths under `~/code/PhD/WISE` | the public-log preset: the BPI Challenge 2019 CSV and `bpic19_norm.json` from the library's examples |
| `WISE_LOG_FORMAT`, `WISE_LOG_LEVEL` | `json`, `INFO` | `console` is easier to read in a terminal |
| `WISE_JOB_LEASE_SECONDS`, `WISE_JOB_HEARTBEAT_SECONDS`, `WISE_JOB_POLL_SECONDS`, `WISE_JOB_MAX_ATTEMPTS` | `60`, `5`, `0.5`, `3` | job leasing and retry |
| `WISE_SCORE_CACHE_SIZE` | `4` | scored runs kept in memory for the Why? screens |
| `WISE_MAPPING_SAMPLE_EVENTS` | `200000` | events sampled to validate a mapping |
| `WISE_MAX_UPLOAD_BYTES` | 4 GiB | upload limit |

## Ports

| Port | Used by |
|---|---|
| 8000 | `wise-workbench serve`: application, API, `/docs` |
| 5173 | `npm run dev` in `apps/frontend` (development only; proxies `/api` to `VITE_API_URL`) |
| 4173 | the Playwright end-to-end tests (`npm run e2e`) |

## Development mode

Two terminals: the backend as above (without `--open`), and in
`apps/frontend`:

```bash
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

Open `http://127.0.0.1:5173/`. The dev server reloads on every change and
proxies the API. Without `VITE_API_URL` the frontend runs on mock data
generated from the contract (`packages/api-schema/openapi.yaml`).

## Ollama

The design reserves a place for a local language model (Ollama) as an
optional assistant. This release does not use it: nothing is sent anywhere,
no model is loaded, and the application works fully without Ollama
installed.

## What comes later

`docker/DEPLOYMENT.md` describes the `single`, `team` and `dev` profiles
(Docker images, Postgres, Caddy with login), and
`docs/DEPLOYMENT_AUTH_PLAN.md` the stages towards them. The one-command start
on this page is stage D0 of that plan.
