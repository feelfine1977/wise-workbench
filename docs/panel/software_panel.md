# WISE Workbench — Software Architecture Panel Report

*Joint report of a backend architect (Python services, data engineering, jobs, APIs, packaging, security) and a frontend architect (React/TypeScript, data-heavy UIs, visualisation, accessibility, design systems). Date: 2026-09-05. Library reviewed: `wise-pm` 0.1.0 (`import wise`, numpy + pandas only).*

## 0. Panel verdict

Build one Python service (FastAPI) that owns metadata, files and a crash-safe job queue, serves a React SPA, and calls the `wise` library only through one adapter module. Store event logs, case tables and result frames as Parquet queried by DuckDB; store metadata in SQLite (desktop) or Postgres (server) behind SQLAlchemy. The same binary runs in both modes; only settings differ. The LLM is an optional provider behind an interface; every screen works without it. Ship an installable CLI first (`wise-workbench serve` opens the browser), a Tauri shell later.

## 1. Architecture overview

```
 Browser (React SPA) ──HTTP/JSON + SSE──▶ API process (FastAPI, async)
                                            │  application services (use-cases)
                                            │  domain model (pure Python, no I/O)
                                            ├─ adapters: db (SQLAlchemy) · files (Parquet/DuckDB) · engine (wise) · llm (Ollama|Null) · connectors · exporters
                                            └─ jobs table ──lease/poll──▶ Worker process(es): ingest, build_cases, score_run, diagnostics, compare, export
 Filesystem: <workspace>/projects/<id>/… (Parquet, norm JSON, manifests)      Metadata DB: SQLite | Postgres      Ollama (localhost)
```

Data flow (each arrow is a persisted, addressable artefact):

1. **Ingest** → `Dataset` + `DatasetVersion`: source file normalised to `events.parquet` (typed columns, UTC timestamps, content hash). CSV/Parquet via DuckDB; XES via `pm4py` extra (v2: own streaming parser); DB connectors (v2) produce the same Parquet.
2. **Mapping** → `ColumnMapping` (case/activity/timestamp/order/lifecycle/exposure/attribute columns, `FlowTyping` rules) → **case table** `cases.parquet` via `EventLog(...).cases` + `derive()`. `EventLog.validate()` and `Norm.check(log)` results are stored as `DataQualityReport`.
3. **Norm** → `NormVersion` (immutable; the file *is* the library's JSON schema v2, plus an app envelope; `fingerprint()` stored).
4. **Run** (job) → `score()` → `frame.parquet` (`ScoreResult.frame(view=None)`), `violations.parquet`, `in_scope.parquet`; then for each configured slicing × view: backlog, `layer_drivers`, `hotspot_table`, `constraint_drivers` (top-N), `penalty_mass`, `view_agreement`, `validation_table` → `runs/<id>/…parquet` + `manifest.json`.
5. **Review artefacts** → `Backlog`/`Slice` (queried from Parquet through DuckDB), `Finding`, `ValidationGate`, `Hypothesis`, `Action`, `Comparison` (metadata DB, user-authored, versioned).
6. **Reports** (job) → self-contained HTML, DOCX, XLSX/CSV bundles; PDF optional.

**Library embedding.** `wise-pm` is a pinned dependency (`>=0.1,<0.2`), imported *only* in `adapters/engine.py`. The adapter converts Parquet ↔ DataFrames, builds `EventLog`/`Norm`, calls `score/prioritize/…` and records `wise.__version__` and `norm.fingerprint()` on every run. Missing capabilities go upstream as library PRs (first candidates: `ScoreResult.save/load`, since `_weights` is private and `constraint_drivers`, `penalty_mass`, `view_agreement`, `validation_table` need a live `ScoreResult`). Until then, ad-hoc drill-downs re-score from a warm per-worker `EventLog` cache (~2 s for 1.6 M events), while `prioritize` and `layer_drivers` run directly on the persisted frame (they accept a DataFrame).

**LLM placement.** `AssistantService` (application layer) → `LLMProvider` protocol (`complete`, `stream`, `tools`) with `OllamaProvider` (OpenAI-compatible endpoint, so vLLM/LM Studio also work) and `NullProvider`. The assistant only sees vocabularies (activity labels, attribute names, top-k values under a redaction list) and aggregate tables, never raw events, unless `assistant.share_level=samples` is set. It proposes JSON patches; the user accepts them into a norm draft. Every message and tool call is persisted (`Conversation`, `ToolCall`).

## 2. Stack recommendation

| Concern | Decision | Considered and rejected — why |
|---|---|---|
| Backend framework | **FastAPI**, async, pydantic v2, uvicorn | Litestar: strong (msgspec, DI) but smaller ecosystem/hiring pool; Django: sync ORM, admin/auth we do not need, async second class, heavy for a local-first tool |
| Job execution | **Own `jobs` table + worker processes** (`multiprocessing` spawn; SQLite `BEGIN IMMEDIATE` lease, Postgres `FOR UPDATE SKIP LOCKED`); heartbeat, lease expiry, cancel flag, progress %, retries | FastAPI `BackgroundTasks`: dies with the process, blocks event loop on CPU work, no crash safety; Celery/RQ/arq: need Redis/RabbitMQ — unacceptable on desktop; Huey(SQLite) viable but the table pattern is ~300 lines and identical in both modes |
| Analytical storage | **Parquet files + DuckDB** (embedded, read-mostly, zero-copy Arrow → pandas) | SQLite for events: no columnar pushdown, slow at 10^7 rows; Postgres for events: not local-first; Polars: a second dataframe stack next to pandas |
| Metadata DB | **SQLAlchemy 2 + Alembic; SQLite (desktop), Postgres (server)**; schema kept portable (JSON columns only) | SQLite-only: write contention with N workers; Postgres-only: kills the desktop story |
| Frontend | **React 19 + TypeScript strict + Vite**; TanStack Query; **TanStack Router** (type-safe search params → shareable backlog filter URLs); Zustand for UI-only state | React Router: fine but untyped search params; Next.js: SSR/file-based server we cannot ship in a Python binary |
| Design system | **shadcn/ui (Radix + Tailwind 4)**, tokens as CSS variables | MUI: heavier, harder to theme for dense data UI; Ant: bundle size, styling model |
| Tables | **TanStack Table + TanStack Virtual**; server-side sort/filter/paginate | AG Grid: Community lacks server-side row model/pivot; Enterprise licence; heavy |
| Charts | **Apache ECharts** (canvas, progressive rendering, `large` mode, brush/dataZoom, built-in a11y decal patterns) lazy-loaded per route | Vega-Lite: SVG limits at 10^5 marks, awkward interactions; Plotly: 1 MB+ bundle; visx: build every chart by hand |
| Code editor | CodeMirror 6 (JSON norm view with schema hints) | Monaco: 2 MB, worker setup |
| API style | **REST + OpenAPI 3.1**, `openapi-typescript` + `openapi-fetch` generated client checked into `packages/api-schema`; **SSE** for job progress and LLM tokens | tRPC: TypeScript server only; GraphQL: no fit for wide tabular payloads; WebSockets: bidirectional not needed |
| Auth | Desktop: bind `127.0.0.1`, random port, per-launch bearer token in the opened URL. Server: **OIDC** via `authlib` (or trusted headers from oauth2-proxy), roles `viewer/analyst/owner/admin` per project | Home-grown passwords: prohibited-by-policy scope creep |
| Packaging | Server: Docker Compose (`api`, `worker`, `postgres`, `ollama`, `caddy`). Desktop: phase A `uv tool install wise-workbench` (CLI opens browser); phase B **Tauri 2** shell with `python-build-standalone` sidecar + wheels | PyInstaller: hidden imports for numpy/pandas/duckdb, 300 MB+ onefile, slow start, AV false positives, `freeze_support()` traps with multiprocessing, macOS notarisation pain; Electron: 150 MB shell for a browser we already have |
| Observability | `structlog` JSON, request ids, job timings; `/healthz`, `/readyz`; optional OpenTelemetry exporter | Prometheus-only: fine in server mode, added later |
| Testing | pytest + hypothesis (domain invariants), service tests on temp workspaces, API tests (httpx), golden files vs library outputs on the paper's running example; Vitest + Testing Library; Playwright smoke | Snapshot-everything: brittle for numeric frames — assert on tolerances |
| CI | GitHub Actions: `uv` + ruff + mypy --strict + pytest (3.10–3.13); `pnpm` + tsc + eslint + vitest; OpenAPI drift check; Playwright on Linux; release builds wheels + images + Tauri bundles | — |

## 3. Domain model and storage

| Entity | Key / relations | Notes |
|---|---|---|
| Workspace | id | one per install (desktop) or tenant (server); settings, users |
| Project | id, workspace_id | steering question, process template, default slice keys |
| Dataset | id, project_id | logical log; source kind (csv/parquet/xes/connector) |
| DatasetVersion | id, dataset_id, content_hash | immutable `events.parquet` + schema + row counts; retention pinning |
| ColumnMapping | id, dataset_id | case/activity/timestamp/order/lifecycle/event_id/exposure columns, attributes, timezone/format, `keep_transitions`, `dedupe` |
| FlowTyping | id, mapping_id | ordered rules → `flow_type` case attribute (stored as a derive recipe `eval`/`count` chain) |
| CaseTable | id, dataset_version_id, mapping_id | `cases.parquet`; `DataQualityReport` JSON from `EventLog.validate()` |
| Norm | id, project_id, head_version_id | lineage + draft pointer |
| NormVersion | id, norm_id, number, fingerprint | immutable JSON (library schema), changelog, author, `parent_version_id`; `View`s and `Layer`s live inside the JSON — not separate tables |
| Run | id, project_id, case_table_id, norm_version_id, params_hash | params: views, slicings, γ, volume, baseline, window; state machine `queued→running→succeeded/failed/cancelled`; `wise_version`, `app_version`, manifest |
| RunArtefact | run_id, kind, path, checksum | frame, violations, in_scope, backlog(slicing,view), drivers, hotspot, agreement, validation |
| Backlog / Slice | (run_id, slicing, view) / slice_key JSON | *not* rows in the DB: queried from Parquet; `Slice` identity = (run, slicing, key) |
| Finding | id, run_id, slicing, slice_key, view | analyst-owned; hotspot reading, dominant layer, notes, status |
| ValidationGate | id, finding_id, kind, status | kinds `data_quality, censoring, replication, domain`; `pending/passed/failed/waived`, evidence JSON, who/when/why |
| Hypothesis / Action | id, finding_id | mechanism text, remedy, owner, due, status; links to constraints/layers |
| Period / Comparison | id, project_id; run_prev_id, run_now_id, baseline | `compare_periods` output cached as Parquet; baseline μ̄ pinned |
| Report | id, project_id, template, params | rendered files; embeds run manifests |
| Conversation / Message / ToolCall | id, project_id, context (norm_id/run_id) | full audit: prompt, model, share_level, tool args/results, accepted patches |
| Job | id, kind, payload, state, attempts, lease_until, progress, error | shared by both modes |

**Provenance rule:** every result-bearing artefact carries `(dataset_version.content_hash, mapping_id, norm_version.fingerprint, params_hash, wise_version)`; the API refuses to compare runs whose `by` keys differ.

Project storage layout (`<workspace>/` is `~/WISE Workbench/` on desktop, a mounted volume on server):

```
<workspace>/
  workbench.db                          # SQLite (desktop only)
  projects/<project_id>/
    datasets/<dataset_id>/<version>/    events.parquet  schema.json  manifest.json  (source/ optional)
    case_tables/<case_table_id>/        cases.parquet  quality.json
    norms/<norm_id>/v<NNN>.json         # library format, byte-stable, diffable
    runs/<run_id>/                      manifest.json  frame.parquet  violations.parquet  in_scope.parquet
      backlogs/<slicing>__<view>.parquet  drivers/…  diagnostics/…  log.jsonl
    comparisons/<id>/compare.parquet
    reports/<report_id>/report.html|docx|xlsx
  cache/                                # DuckDB temp, LLM prompt cache; safe to delete
```

Formats: Parquet (zstd) for anything per-case/per-event; JSON for norms, manifests, quality reports; the DB holds only metadata and review artefacts. Retention: dataset versions and runs are pinned by default when referenced by a Finding/Report; unpinned runs pruned after a configurable age (artefacts deleted, manifest kept).

## 4. API design (`/api/v1`)

| Resource | Endpoints | Notes |
|---|---|---|
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` | |
| Datasets | `POST /projects/{id}/datasets` (multipart or `{path}` for local files), `GET /datasets/{id}`, `GET /datasets/{id}/preview?rows=100`, `GET /datasets/{id}/columns` (types, null share, cardinality, sample values) | upload = job `ingest`; returns `202 {job_id, dataset_id}` |
| Mappings | `POST/PUT /datasets/{id}/mappings`, `POST /mappings/{id}/validate` → `DataQualityReport`, `POST /mappings/{id}/build` → job `build_cases` | validate runs `EventLog(...).validate()` on a 200k-event sample synchronously |
| Norms | `GET/POST /projects/{id}/norms`, `GET /norms/{id}/versions`, `POST /norms/{id}/versions` (`{document, message}`), `GET /norm-versions/{id}`, `GET /norm-versions/{a}/diff/{b}`, `POST /norms/validate` (`{document}` → issues, fingerprint), `POST /norms/check` (`{document, case_table_id}` → `Norm.check`) | document validated with `Norm.loads`; `NormError` → 422 |
| Runs | `POST /projects/{id}/runs` `{case_table_id, norm_version_id, views?, slicings[][], gamma, volume, baseline?, min_cases}`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /runs/{id}/summary` | `Idempotency-Key`; identical `params_hash` returns the existing run (`force=true` to recompute) |
| Jobs | `GET /jobs/{id}`, `GET /jobs/{id}/events` (SSE: `progress`, `log`, `done`), `GET /jobs?state=` | |
| Backlog | `GET /runs/{id}/backlog?slicing=company,spend_area&view=Finance&gamma=20&volume=cases&sort=-stable_PI&filter[company]=A&min_cases=30&page=1&size=100` | server-side via DuckDB on the backlog Parquet; ad-hoc slicing/γ recomputed by `prioritize` on `frame.parquet` and cached |
| Slice detail | `GET /runs/{id}/slices/{key}?view=` → gap, PI, hotspot, `layer_drivers`, `constraint_drivers`, validation row; `GET /runs/{id}/slices/{key}/cases?sort=score&cursor=` ; `GET /runs/{id}/slices/{key}/penalty-mass?by=vendor` | `key` = URL-safe JSON of the slice tuple |
| Cases / traces | `GET /runs/{id}/cases/{case_id}` → attributes, per-view scores, layer contributions, violation vector, events with constraint annotations | trace from `events.parquet` filtered by case (DuckDB, indexed by row-group sort) |
| Diagnostics | `GET /runs/{id}/diagnostics/validation?view=&slicing=`, `GET /runs/{id}/diagnostics/agreement?slicing=&k=20`, `GET /runs/{id}/diagnostics/concentration`, `GET /case-tables/{id}/quality` | |
| Review | CRUD `findings`, `findings/{id}/gates`, `hypotheses`, `actions`; `POST /findings/from-slice` | |
| Comparisons | `POST /projects/{id}/comparisons {run_prev, run_now, slicing, view}` → job; `GET /comparisons/{id}/table` | |
| Reports | `POST /projects/{id}/reports {template, run_ids, findings[], format}` → job; `GET /reports/{id}/download` | |
| Exports | `GET /runs/{id}/export?artefact=backlog&format=csv\|parquet\|xlsx` | streamed |
| Assistant | `POST /assistant/conversations`, `POST /conversations/{id}/messages` (SSE stream: `token`, `tool_call`, `tool_result`, `patch`, `done`), `POST /conversations/{id}/patches/{pid}/accept` | `GET /assistant/status` reports provider/model or `null` |
| System | `GET /healthz`, `/readyz`, `/version` (app, wise, duckdb), `/openapi.json` | |

Core shapes (abridged): run creation returns `{id, state, params, links: {backlog, summary}}`; backlog rows carry exactly the library's columns (`n_cases, mean_score, gap, stable_gap, PI, stable_PI, rank, share, cum_share, hotspot?, dominant_layer?`) plus the key columns, and `attrs` (γ, baseline, view) once per page. Pagination: offset for backlogs (≤ 10^5 rows), cursor for cases. Errors: RFC 9457 `application/problem+json` with stable `code` (`norm.invalid`, `mapping.column_missing`, `run.params_mismatch`, `job.cancelled`, `assistant.unavailable`) and `errors[]` for field paths. All POSTs that create jobs accept `Idempotency-Key`; job payloads are content-addressed.

## 5. Frontend information architecture

| Journey stage | Route | Key components |
|---|---|---|
| Dashboard | `/p/:id` | project card, latest run KPIs (`summary()`), open findings, gate status, job tray |
| Data & mapping | `/p/:id/data`, `/data/:ds/mapping` | dropzone, column profiler, mapping form (zod), flow-typing rule builder, quality report with severity chips |
| Norm builder | `/p/:id/norms/:norm` | three panes: **catalogue** (layers → constraints, drag to re-layer), **constraint editor** (type-specific form: activities from vocabulary picker, thresholds with a live `sat()` curve preview, applicability rule tree, weight), **views & weights** (matrix editor, normalised bars, two-stage toggle); JSON tab (CodeMirror), version history + diff, `check` against a case table |
| Run monitor | `/p/:id/runs`, `/runs/:run` | run form (views, slicings, γ with `estimate_gamma` hint, volume, baseline), SSE progress, manifest/provenance panel |
| Backlog explorer | `/runs/:run/backlog?slicing&view&gamma…` | virtualised table, hotspot typology badges (reservoir/mechanism/severity), PI-components chart (volume × gap), Pareto/concentration, view-agreement matrix, filters in URL |
| Slice detail | `/runs/:run/slices/:key` | header (n, gap, PI, hotspot), layer-driver bars vs global, constraint drivers, penalty-mass Pareto by sub-key, worst cases table → **trace viewer** (timeline with violated constraints annotated), validation row, "create finding" |
| Validation gates | `/p/:id/findings/:f/gates` | gate cards with evidence (censored share, replicated share, gap retained), waive/pass with reason |
| Action board | `/p/:id/actions` | kanban by status; hypothesis form linked to layers/constraints; owner, due |
| Period comparison | `/p/:id/comparisons/:c` | slope/dumbbell chart of stable gap per slice, PI change table, baseline note |
| Reports | `/p/:id/reports` | template picker, section toggles, preview, download |
| Assistant | right-hand panel on norm builder, slice detail, findings | streamed chat, tool-call log, patch review (JSON diff → accept/reject), share-level indicator, hidden when provider is `null` |

State: TanStack Query owns all server data (keys mirror URLs; `staleTime` long for immutable runs); Zustand for selections, panel layout, unsent drafts; URL search params for every filter so views are shareable. Forms: react-hook-form + zod schemas generated from OpenAPI. Performance: server does all aggregation; tables virtualised (row + column); charts receive ≤ 5k points or ECharts `sampling: 'lttb'`; heavy routes code-split; Web Worker for client-side norm diff. Accessibility: Radix primitives, full keyboard table navigation, focus management, `aria-live` job updates, colour-blind-safe palettes with shape/pattern redundancy (ECharts `aria.decal`), min 4.5:1 contrast, reduced-motion respected. i18n: `i18next` + ICU, `en` and `de`, number/date formatting via `Intl`. Design tokens in `packages/design-tokens/tokens.json` → CSS variables (light/dark) and an ECharts theme; semantic scales: sequential score scale, categorical layer palette stable per norm (hashed layer id), fixed colours for the three hotspot types and four gate states.

## 6. Code organisation

```
wise-workbench/
  apps/backend/                       # Python package `wise_workbench` (uv, pyproject)
    src/wise_workbench/
      domain/        entities, value objects, state machines, invariants — no I/O, never imports `wise` or SQLAlchemy
      application/   IngestService, MappingService, NormService, RunService, ReviewService, ComparisonService, ReportService, AssistantService; ports (Protocols)
      adapters/      engine/ (the only importer of `wise`), storage/ (parquet, duckdb, workspace paths), db/ (SQLAlchemy models, repos), llm/ (ollama, null), connectors/ (csv, parquet, xes, sql), exporters/ (html, docx, xlsx)
      api/           routers/, schemas/ (pydantic), errors.py (problem+json), sse.py, deps.py, auth/
      jobs/          queue.py, worker.py, handlers/ (one per job kind)
      settings.py  cli.py  main.py
    alembic/  tests/{unit,service,api,golden}/
  apps/frontend/                      # Vite + React + TS
    src/{app/,routes/,features/<feature>/{api,components,hooks}/,components/ui/,lib/{api,charts,format}/,i18n/,styles/}
  apps/desktop/                       # Tauri 2 shell (v2 phase), sidecar config
  packages/api-schema/                openapi.json + generated TS client (CI fails on drift)
  packages/design-tokens/             tokens.json → css + echarts theme
  packages/process-templates/         p2p/, o2c/ norm templates, flow-typing rules, glossary
  docker/  compose.yml  Dockerfile.backend  Dockerfile.frontend  caddy/
  docs/  .github/workflows/  justfile  pnpm-workspace.yaml  pyproject.toml (uv workspace)
```

Boundaries: `api → application → domain`; `adapters` implement `application.ports`; nothing above `adapters` touches pandas, DuckDB or `wise`. Services return domain objects or Arrow tables, routers map to pydantic schemas. Conventions: Python 3.11+, `ruff` (E,W,F,I,UP,B,SIM,RUF), `mypy --strict`, pydantic models only at the API boundary, frozen dataclasses in `domain`, `pytest -W error`; TypeScript `strict`, `noUncheckedIndexedAccess`, ESLint typescript-strict, Prettier, feature-folder colocation, no default exports. Library decoupling: the app never subclasses library types; norm JSON is stored as the library emits it (`Norm.dumps`) so any library upgrade is validated by round-trip tests; a `compat.py` in the engine adapter pins accepted `schema_version`s. Plugin points: `connectors` (entry point `wise_workbench.connectors`, interface `read(spec) -> Arrow RecordBatchReader`), `process templates` (JSON + metadata in `packages/process-templates`, discovered via entry point), `exporters`, `llm providers`, `gate evaluators`.

## 7. Non-functional requirements

Performance budgets (desktop: 4-core laptop, 16 GB; log ≤ 5 M events / 500 k cases): ingest CSV ≤ 90 s; case table ≤ 30 s; run (score + all configured backlogs/diagnostics) ≤ 90 s; backlog page p95 ≤ 300 ms; slice detail ≤ 500 ms (cached re-score ≤ 3 s cold); trace ≤ 200 ms; first LLM token ≤ 3 s (local 8B model); SPA first load ≤ 2 s, initial bundle ≤ 500 kB gz; worker RSS ≤ 4 GB. Server mode target: 20 M events with 8 GB workers, DuckDB projection pushdown and chunked `events.parquet` reading.

Security and privacy: all data under the workspace directory, no telemetry, no outbound calls except the configured LLM endpoint; desktop binds loopback with a per-launch token; server mode OIDC, project-level roles, audit log of writes; secrets only via env/keyring, never in project dirs; the assistant's `share_level` (`names_only` default) plus a per-project redaction list of attribute names; prompts and tool results logged so a reviewer can verify what left the process; uploads validated by content, size-capped, paths never taken from clients (except explicit local-path mode on desktop).

Reliability: jobs are leased with heartbeats; a crashed worker's job is re-queued with `attempts+1` and marked failed after 3; artefacts written to `tmp/` then atomically renamed, `manifest.json` last; a run is `succeeded` only when the manifest checksum passes; API restarts are safe because state lives in the DB and files. Upgrades: Alembic migrations on start; norm documents migrated by `schema_version` shims; run manifests record library and app versions so old runs remain readable but flagged "recompute to compare"; workspace `format_version` with explicit, backed-up upgrades.

## 8. Phased delivery and risks

| Phase | Scope | Cut / deferred |
|---|---|---|
| **MVP** (8–10 weeks) | desktop mode only; CSV/Parquet/XES ingest; mapping + quality report; norm builder (forms + JSON) with validate/check/version; run with jobs + SSE; backlog explorer with typology; slice detail with drivers and trace viewer; validation table; CSV/HTML export; `uv tool install` distribution | OIDC, Postgres, Tauri, LLM, action board, period comparison, DOCX/PDF, connectors |
| **v1** | assistant with tools + patch review + audit; validation gates and findings; action board; period comparison with pinned baseline; DOCX/XLSX reports; server mode (Compose, Postgres, OIDC, roles); P2P/O2C templates; `estimate_gamma`, concentration, agreement views | Tauri, connectors, sensitivity analysis |
| **v2** | Tauri desktop bundles with auto-update; SQL/ODBC and warehouse connectors; sensitivity analysis over thresholds/γ/weights; scheduled monitoring runs; plugin API stabilised; PDF | object-centric case notions (research) |

Top technical risks and mitigations:
1. **Live `ScoreResult` needed for drill-downs** (private `_weights`) → persist frames now, re-score from a warm cache, upstream `save/load`.
2. **Desktop packaging** → avoid PyInstaller; `uv tool` first, `python-build-standalone` sidecar in Tauri later; test on macOS/Windows/Linux in CI.
3. **Assistant proposes non-existent activities or invalid JSON** → tools expose vocabularies, every patch passes `Norm.loads` + `check`, nothing auto-applies.
4. **SQLite contention in small-team use** → single API writer, workers write via API-owned queue, documented switch to Postgres.
5. **Memory on 10^7-event logs** → DuckDB-side filtering, only mapped columns loaded, run-time guard rails with clear errors.
6. **Big-table UI** → server-side aggregation and virtualisation from day one; never ship a client-side backlog.
7. **Pre-1.0 library API churn** → strict pin, adapter-only imports, golden tests on the paper's running example.
8. **XES via pm4py is heavy** → optional extra; streaming XES reader in v2.
