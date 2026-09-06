# apps/backend — `wise_workbench`

The Python service of WISE Workbench: FastAPI API, application services,
domain model, adapters (engine, storage, db), crash-safe jobs and the CLI.
Analytics live in `packages/wise-analytics`, curated process knowledge in
`packages/process-knowledge`. The `wise` library (`wise-pm`) is imported in
exactly one place, `adapters/engine/`, and its norm JSON is stored exactly as
`Norm.dumps` emits it.

## Install

```bash
cd apps/backend
python3 -m venv .venv
.venv/bin/pip install -e ~/code/PhD/WISE/wise-lib        # the method library (editable checkout), or
                                                         # pip install "git+https://github.com/feelfine1977/wise-pm.git@v0.1.0"
.venv/bin/pip install -e .                               # the service and the wise-workbench command
.venv/bin/pip install -e '.[dev]'                        # plus pytest, ruff, mypy for the checks
.venv/bin/pip install -e ../../packages/process-knowledge # stage groups, plain names of layers and expectations, case nouns
.venv/bin/pip install -e ../../packages/wise-analytics    # stability badges, kinds, comparison sentences, caveats, contrast, headroom
```

Both packages are optional at import time: without `wise-analytics` every
rank reads "confidence not computed" and the slice detail has no contrast;
without `wise-knowledge` the map has no stage groups and layers keep the
norm's names.

A fresh virtual environment with the library and `pip install -e .` is
enough to run `wise-workbench` (checked with Python 3.12 and 3.13). With
`uv`: `uv sync --extra dev` (the `[tool.uv.sources]` entry points `wise-pm`
at `../../../wise-lib`).

Optional extras: `xes` (pm4py for XES import), `postgres`, `analytics`.

## Run

```bash
.venv/bin/wise-workbench serve                     # application at http://127.0.0.1:8000/, API + in-process worker, /docs
.venv/bin/wise-workbench serve --open              # the same, and open the browser once the server answers
.venv/bin/wise-workbench serve --static DIR        # serve another built frontend (default: WISE_STATIC_DIR, then apps/frontend/dist)
.venv/bin/wise-workbench serve --no-worker         # API only
.venv/bin/wise-workbench worker                    # a worker process (any number may run)
.venv/bin/wise-workbench worker --once             # drain the queue and exit
.venv/bin/wise-workbench migrate                   # apply Alembic migrations
.venv/bin/wise-workbench openapi [--yaml] [--out F] # the OpenAPI document (paths relative to /api/v1)
.venv/bin/wise-workbench health                    # call the running API
.venv/bin/wise-workbench demo ingest --csv PATH    # ingest + case table + readiness report
.venv/bin/wise-workbench demo run --norm F --slicing ATTR[,ATTR] [--view V] [--gamma G] [--min-cases N]
```

The built frontend (`apps/frontend`, `npm run build:live`) is served at `/`
with history fallback: `/assets/*` and files that exist in the directory are
served as they are, every other path outside `/api`, `/docs` and `/redoc`
answers `index.html` so the application's own routes survive a reload; the
directory is `WISE_STATIC_DIR`, else the package's `static/` folder, else
`apps/frontend/dist` of the checkout (`api/static.py`). Without a built
frontend only the API and `/docs` are served and the start-up line says so.
`tools/start.sh` at the repository root builds and starts in one go.

Settings come from the environment (prefix `WISE_`): `WISE_WORKSPACE`
(default `~/WISE Workbench`), `WISE_DATABASE_URL` (default SQLite in the
workspace), `WISE_HOST`, `WISE_PORT`, `WISE_STATIC_DIR`, `WISE_INPROCESS_WORKER`
(default `1`), `WISE_CORS_ORIGINS` (default the Vite origins on 5173 and 4173), `WISE_LOG_FORMAT`
(`json` | `console`), `WISE_LOG_LEVEL`, `WISE_JOB_LEASE_SECONDS`,
`WISE_JOB_MAX_ATTEMPTS`, `WISE_SCORE_CACHE_SIZE`, `WISE_MAPPING_SAMPLE_EVENTS`,
`WISE_MAX_UPLOAD_BYTES`, for the public log preset `WISE_BPIC19_CSV`
(default `~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv`) and
`WISE_BPIC19_NORM` (default `~/code/PhD/WISE/wise-lib/examples/bpic19_norm.json`),
and for the analytics job `WISE_ANALYTICS_AUTO` (queue it after every scoring
job, default on), `WISE_ANALYTICS_BOOTSTRAP_B` (200 replicates),
`WISE_ANALYTICS_COMPARISON_TOP` (comparison sentences for the top 12 groups of
every backlog), `WISE_ANALYTICS_CLUSTER_SHARE` (resample by document instead of
by case above this replicated share, 0.2) and `WISE_ANALYTICS_SEED`.
`--workspace` on the CLI overrides `WISE_WORKSPACE`.

Public log presets: `GET /projects/{id}/datasets/presets` lists the logs the
service knows (mapping, norm, slicing, view, γ) and whether their files are on
this machine; `POST /projects/{id}/datasets/presets/bpic2019` runs one job from
the file to a scored run (ingest, case table, norm version, scoring), reusing
whatever the project already has. Job progress streams over
`GET /jobs/{id}/events` (server-sent events: `progress`, heartbeats, one
terminal `done`).

Cycle 2 (see `CHECKPOINT.md`, CP-2.1 to CP-2.8, and
`packages/api-schema/CONTRACT_CYCLE2.md`):

- an `analytics` job after every scoring job (`POST/GET …/runs/{r}/analytics`):
  backlog rows gain `stability` (bootstrap badge), `kind` and `kind_reading`
  (the analytics rule, one kind per group across views), `comparison` (one
  real-unit sentence from the top driver's contrast), `caveats` (`{id, share,
  text}` with the window end), `plain_layer`, `layer_missed_label`,
  `case_noun`, `points_below` and `reading_plain`; the slice detail gains
  `contrast`, `headroom`, `caveats`, `subgroups`, `guidance_refs`,
  `reading_plain`; results are Parquet tables with provenance records under
  `runs/<id>/analytics/<name>/<params_hash>.parquet`;
- one window end for every censoring number (readiness report, validation
  table, analytics gate, caveat sentences; `readiness.windowEnd`,
  `manifest.windowEnd`, `params.window_end`);
- norm versions carry `warnings` (`Norm.check`) and `guidance_complete`; cards
  whose most-missed area contains a warned expectation carry a `norm_warning`
  caveat; the distribution lens bins over the robust range with a `beyond`
  bin, the δ and δ + W markers and the share beyond δ (`?scale=log` for a
  log scale);
- the flow-type fork: `GET …/case-tables/{ct}/flow-types` (counts, one map
  each, readiness headline, the scope to pass), `POST /runs` with
  `scope: {flow_type: …}` (a sub-log run; applicability untouched; scope in
  the manifest), `GET …/runs/{r}/compare-flow-types`;
- the analysis notebook (`/projects/{p}/notebook`: multipart snapshots with a
  PNG and a JSON payload, reorder, edit, delete, Markdown export as a zip with
  the images; PowerPoint is a registered-exporter extension point for cycle 4);
- caveat actions: `GET /projects/{p}/decisions/kinds`, `POST
  …/case-tables/{ct}/decisions/preview` (cases and events affected), `POST
  …/case-tables/{ct}/decisions` (a versioned mapping decision: child mapping,
  new case table, `build_cases` job, readiness re-evaluated), `GET
  …/decisions`;
- the slice designer: slicings of up to three attributes with `bands`
  (quantiles or cut points) on numeric attributes, `GET …/runs/{r}/slicings/preview`,
  and `drillFrom`/`drillKey` on the backlog (a finer slicing scoped to one group);
- the canonical `filter` (time, attribute, activity, follows, lag, count,
  open) on backlog, signals and flow with `GET …/runs/{r}/filters/preview`, and
  `focus` on the flow (incoming and outgoing paths with lag and violation share).

## Layout

```
src/wise_workbench/
  settings.py  logging.py  ids.py  container.py  cli.py  main.py  presets.py (known logs, column-name heuristics)
  domain/         entities, value objects, state machines, invariants (pure Python)
                  project, dataset, mapping (incl. flow typing + header events as recipes, case noun,
                  decisions on data caveats, open-case and zero-exposure handling), case_table
                  (+ Readiness with the window end and the decision each item allows), norm
                  (NormVersion), run (params with slicing bands and scope, manifest, state machine),
                  decision (the eight caveat actions), notebook (Snapshot), job (lease, retries),
                  readings (plain-language reading sentences), errors
  application/    ports.py (Protocols + RunContext) and services/ (projects, datasets,
                  mappings incl. flow types, norms incl. warnings, runs incl. analytics, drill-in,
                  filters and the flow-type comparison, decisions, notebook, jobs, presets)
                  — no pandas, DuckDB or `wise` here
  adapters/
    engine/       the only importer of `wise`: gateway.py (ingest, case tables, scoring incl. scoped
                  runs, backlogs with bands, drill-in, filters and the analytics enrichment, slice
                  detail with contrast, headroom, sub-groups and caveats, trace, diagnostics, signals,
                  flow with filter and focus, flow types and their comparison, previews), logs.py
                  (EventLog building, flow typing, decisions applied at build, the one window end,
                  readiness report merged with the analytics gate), analytics.py (the bridge to
                  wise-analytics with Parquet caching and provenance records; tolerates a missing
                  package), filters.py (the canonical filter clauses → case mask), bands.py (banded
                  numeric attributes), signals.py (robust histograms), flow.py (FlowGraph JSON with
                  stage groups and constraint overlays), tables.py, compat.py, cache.py
    knowledge.py  optional bridge to the curated packs: stages for the process map, case nouns, plain
                  names and missed labels of layers and expectations with hub node ids, guidance
                  completeness (a pack that fails validation is used without validation, with a
                  warning; no pack → no groups, no plain names)
    storage/      workspace.py (layout, atomic writes, hashing), parquet.py (zstd),
                  duck.py (CSV ingest, profiling, backlog paging, traces, directly-follows, focus paths)
    db/           SQLAlchemy 2 models, session (SQLite WAL, BEGIN IMMEDIATE), repositories,
                  migrate.py (Alembic runner)
  jobs/           queue.py (lease, heartbeat, cancel, retries), worker.py (Worker,
                  InProcessWorker, JobContext), registry.py, handlers/ (ingest,
                  build_cases, score_run, load_preset, analytics)
  api/            app.py (factory, CORS, request ids), errors.py (RFC 9457), sse.py,
                  schemas.py (pydantic, contract names), routers/ (system, projects,
                  datasets incl. flow types and decisions, norms, runs, notebook, jobs)
  migrations/     Alembic environment and versions (0001_initial, 0002_cycle2: decisions, notebook)
tests/
  unit/           domain invariants, mapping, reading sentences, the knowledge bridge (stage groups),
                  cycle 2 domain and engine helpers (bands, scope, decisions, filters, robust bins)
  service/        storage round-trips, jobs (lease expiry, crash then resume, cancel)
  api/            httpx against the app with the in-process worker; the SSE stream; the preset on a
                  small log; cycle 2 on the synthetic log (analytics, one window end, norm warnings,
                  histograms, flow-type fork, notebook, decisions, slice designer, flow filter and
                  focus); contract drift check (committed openapi.yaml == generated document)
  golden/         API backlog == library prioritize on the running example; opt-in BPIC 2019
                  (Table XI, readiness, and the cycle 2 numbers)
CHECKPOINT.md     how to try CP-A1 … CP-A4, the service side of CP-B2, CP-1.1 … CP-1.6 and CP-2.1 … CP-2.8 by hand
```

## Workspace

```
<workspace>/
  workspace.json  workbench.db  cache/  tmp/
  projects/<project_id>/
    datasets/<dataset_id>/       source/<file> (uploads only)  events.parquet  schema.json  manifest.json
    case_tables/<case_table_id>/ cases.parquet  events.parquet (typed)  quality.json  activities.json  manifest.json
    norms/<norm_id>/vNNN.json    library format, byte-stable
    runs/<run_id>/               frame.parquet  violations.parquet  in_scope.parquet  summary.json
                                 backlogs/<slicing>__<view>.parquet  drivers/…  diagnostics/…  manifest.json (last)
                                 analytics/<name>/<params_hash>.parquet + .json (record, summary)  analytics/manifest.json
    notebook/<snapshot_id>.png   images of the analysis notebook
```

Every artefact is written to a temporary file and renamed atomically; the
manifest is written last. Run manifests carry `normFingerprint`,
`contentHash`, `mappingId`, `paramsHash`, `wiseVersion` and per-artefact
checksums; identical inputs return the existing run.

## Tests and checks

```bash
.venv/bin/python -m pytest                                  # 100 passed, 4 skipped (BPIC opt-in), ~34 s
WISE_BPIC19_CSV=~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv .venv/bin/python -m pytest tests/golden/test_bpic19.py
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests
.venv/bin/mypy
.venv/bin/wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml   # regenerate the contract (the drift test fails otherwise)
```
