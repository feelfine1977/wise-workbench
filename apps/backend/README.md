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
.venv/bin/pip install -e ~/code/PhD/WISE/wise-lib        # the method library (editable checkout)
.venv/bin/pip install -e '.[dev]'
```

With `uv`: `uv sync --extra dev` (the `[tool.uv.sources]` entry points
`wise-pm` at `../../../wise-lib`).

Optional extras: `xes` (pm4py for XES import), `postgres`, `analytics`.

## Run

```bash
.venv/bin/wise-workbench serve                     # API + in-process worker on http://127.0.0.1:8000/docs
.venv/bin/wise-workbench serve --no-worker         # API only
.venv/bin/wise-workbench worker                    # a worker process (any number may run)
.venv/bin/wise-workbench worker --once             # drain the queue and exit
.venv/bin/wise-workbench migrate                   # apply Alembic migrations
.venv/bin/wise-workbench openapi [--yaml] [--out F] # the OpenAPI document (paths relative to /api/v1)
.venv/bin/wise-workbench health                    # call the running API
.venv/bin/wise-workbench demo ingest --csv PATH    # ingest + case table + readiness report
.venv/bin/wise-workbench demo run --norm F --slicing ATTR[,ATTR] [--view V] [--gamma G] [--min-cases N]
```

Settings come from the environment (prefix `WISE_`): `WISE_WORKSPACE`
(default `~/WISE Workbench`), `WISE_DATABASE_URL` (default SQLite in the
workspace), `WISE_HOST`, `WISE_PORT`, `WISE_INPROCESS_WORKER` (default `1`),
`WISE_CORS_ORIGINS` (default `http://localhost:5173`), `WISE_LOG_FORMAT`
(`json` | `console`), `WISE_LOG_LEVEL`, `WISE_JOB_LEASE_SECONDS`,
`WISE_JOB_MAX_ATTEMPTS`, `WISE_SCORE_CACHE_SIZE`, `WISE_MAPPING_SAMPLE_EVENTS`.
`--workspace` on the CLI overrides `WISE_WORKSPACE`.

## Layout

```
src/wise_workbench/
  settings.py  logging.py  ids.py  container.py  cli.py  main.py
  domain/         entities, value objects, state machines, invariants (pure Python)
                  project, dataset, mapping (incl. flow typing + header events as recipes),
                  case_table (+ Readiness), norm (NormVersion), run (params, manifest, state
                  machine), job (lease, retries), readings (reading sentences), errors
  application/    ports.py (Protocols + RunContext) and services/ (projects, datasets,
                  mappings, norms, runs, jobs) — no pandas, DuckDB or `wise` here
  adapters/
    engine/       the only importer of `wise`: gateway.py (ingest, case tables, scoring,
                  backlogs, slice detail, trace, diagnostics, signals, flow, LRU cache of
                  live ScoreResult objects), logs.py (EventLog building, flow typing,
                  readiness report), signals.py, flow.py, tables.py, compat.py, cache.py
    storage/      workspace.py (layout, atomic writes, hashing), parquet.py (zstd),
                  duck.py (CSV ingest, profiling, backlog paging, traces, directly-follows)
    db/           SQLAlchemy 2 models, session (SQLite WAL, BEGIN IMMEDIATE), repositories,
                  migrate.py (Alembic runner)
  jobs/           queue.py (lease, heartbeat, cancel, retries), worker.py (Worker,
                  InProcessWorker, JobContext), registry.py, handlers/ (ingest,
                  build_cases, score_run)
  api/            app.py (factory, CORS, request ids), errors.py (RFC 9457), sse.py,
                  schemas.py (pydantic, contract names), routers/ (system, projects,
                  datasets, norms, runs, jobs)
  migrations/     Alembic environment and versions (0001_initial)
tests/
  unit/           domain invariants, mapping
  service/        storage round-trips, jobs (lease expiry, crash then resume, cancel)
  api/            httpx against the app with the in-process worker; contract drift check
  golden/         API backlog == library prioritize on the running example; opt-in BPIC 2019
CHECKPOINT.md     how to try CP-A1 … CP-A4 by hand, with expected output
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
```

Every artefact is written to a temporary file and renamed atomically; the
manifest is written last. Run manifests carry `normFingerprint`,
`contentHash`, `mappingId`, `paramsHash`, `wiseVersion` and per-artefact
checksums; identical inputs return the existing run.

## Tests and checks

```bash
.venv/bin/python -m pytest                                  # 56 tests, ~15 s
WISE_BPIC19_CSV=~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv .venv/bin/python -m pytest tests/golden/test_bpic19.py
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests
.venv/bin/mypy
```
