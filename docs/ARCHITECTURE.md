# WISE Workbench — architecture draft

Synthesis of the software, ML and LLM panel reports (`docs/panel/`,
including the knowledge-architecture follow-up),
constrained by the process panel's rule that the app automates computation
and bookkeeping around human decisions and never the decisions themselves.
Decision records: `docs/adr/`.

## 1. System overview

```
┌─────────────────────────────── Browser ────────────────────────────────┐
│ React + TypeScript SPA: data & mapping · norm builder · run monitor ·   │
│ backlog explorer · slice detail · validation gates · action board ·     │
│ period comparison · reports · assistant panel (cards first, prose second)│
└──────────────▲──────────────────────────────────────────▲──────────────┘
               │ REST + OpenAPI (generated client)         │ SSE (jobs, assistant)
┌──────────────┴──────────────────────────────────────────┴──────────────┐
│ API process (FastAPI, async)                                            │
│   api/          routers, pydantic schemas, RFC 9457 errors, auth        │
│   application/  services: Ingest, Mapping, Norm, Run, Review,           │
│                 Comparison, Report, Assistant  (+ ports)                 │
│   domain/       entities, state machines, invariants (pure Python)      │
│   adapters/     engine (the only importer of `wise`) · storage          │
│                 (Parquet/DuckDB) · db (SQLAlchemy) · llm (Ollama|Null)   │
│                 · knowledge (documents, embeddings, hybrid retrieval)    │
│                 · mcp (server / client) · connectors · exporters         │
│   jobs table ───lease / heartbeat───▶ worker processes                  │
│                 ingest · build_cases · score_run · diagnostics ·         │
│                 analytics · compare · export · assistant (long turns)    │
└───────┬───────────────────────────┬─────────────────────────┬──────────┘
        │                           │                         │
  <workspace>/projects/…     metadata DB                 Ollama (localhost)
  Parquet · norm JSON ·      SQLite (desktop)            chat + embeddings
  manifests · reports ·      Postgres (server)           optional, tiered
  knowledge index            (+ knowledge graph tables)
```

Two libraries underneath: `wise` (the method; pinned, never forked) and
`wise-analytics` (uncertainty, contrast, readiness, headroom, monitoring;
built on `wise` objects), plus the curated `process-knowledge` package.
The assistant reads all of them only through typed tools. In the browser,
`@wise/flow` (separate repository) renders process maps, BPMN overlays,
timelines and spectra; ECharts renders statistical charts.

## 2. Data flow as addressable artefacts

| Step | Input | Output (persisted) | Library calls |
|---|---|---|---|
| Ingest (job) | CSV / Parquet / XES / connector | `events.parquet`, schema, content hash | DuckDB; `pm4py` extra for XES |
| Mapping | column roles, timestamp format, lifecycle, order, exposure, attributes, flow-typing rules | `ColumnMapping`, `FlowTyping` (stored as recipes) | — |
| Case table (job) | mapping | `cases.parquet`, `quality.json` | `EventLog(...)`, `derive`, `validate`, `Norm.check` |
| Norm version | editor / wizard / accepted proposals | `norms/<id>/vNNN.json` (library format), fingerprint, status, changelog | `Norm.from_dict`, `validate`, `fingerprint` |
| Run (job) | case table + norm version + parameters (views, slicings, γ, volume, baseline, min_cases) | `frame.parquet`, `violations.parquet`, `in_scope.parquet`, per slicing × view backlog / drivers / hotspot / agreement / validation Parquet, `manifest.json` | `score`, `prioritize`, `layer_drivers`, `constraint_drivers`, `hotspot_table`, `view_agreement`, `validation_table`, `right_censored`, `event_replication` |
| Analytics (job or interactive) | run artefacts | `analytics/<name>/<params_hash>.parquet` + provenance record | `wise_analytics.*` |
| Review | backlog rows | Findings, ValidationGates, Hypotheses, Actions (metadata DB) | — |
| Comparison (job) | two runs with the same slicing, frozen baseline | `compare.parquet` | `prioritize(baseline=)`, `compare_periods`, `wise_analytics.monitoring` |
| Report (job) | reviewed narratives, accepted hypotheses, tables | HTML / DOCX / XLSX bundle with run ids | exporters |

Provenance rule: every result-bearing artefact carries `(content_hash,
mapping_id, norm_fingerprint, params_hash, wise_version)`; identical inputs
return the existing run; comparisons across different slice keys are refused.

## 3. Stack

| Concern | Decision | Rejected |
|---|---|---|
| Backend | FastAPI, pydantic v2, uvicorn, Python 3.11+ | Litestar, Django |
| Jobs | own `jobs` table + worker processes (SQLite `BEGIN IMMEDIATE`, Postgres `SKIP LOCKED`), heartbeats, retries, cancel, progress | BackgroundTasks, Celery/RQ/arq, Huey |
| Analytical storage | Parquet (zstd) + DuckDB | SQLite/Postgres for events, Polars |
| Metadata | SQLAlchemy 2 + Alembic; SQLite desktop / Postgres server | single-DB choices |
| Frontend | React 19, TypeScript strict, Vite, TanStack Query/Router/Table/Virtual, Zustand, shadcn/ui + Tailwind, ECharts, CodeMirror 6 | Next.js, MUI, AG Grid, Plotly, Vega-Lite |
| Process-flow visualisation | `@wise/flow`, a separate repository (`wise-flow`): headless core (model, aggregation, ELK layout in a worker with stable positions, overlay grammar, export) with React Flow and Canvas renderers; bpmn-js for BPMN 2.0 viewing, overlays and constraint authoring; Cytoscape.js for hand-off networks (ADR 0011, `docs/panel/visualisation_specialist.md`) | writing a JointJS-like editor, GoJS/yFiles, AntV, maxGraph |
| UI/UX | design system on shadcn/ui with tokens synced to Figma; context ribbon, journey rail, decision pane, presenter mode, "explain this number" (`docs/panel/ux_design_panel.md`) | ad-hoc screens |
| API | REST + OpenAPI 3.1, generated TS client, SSE, RFC 9457 errors, idempotency keys | tRPC, GraphQL, WebSockets |
| Auth | desktop: loopback + per-launch token; server: OIDC (authlib / oauth2-proxy), roles viewer / analyst / owner / admin | home-grown passwords |
| LLM | Ollama via OpenAI-compatible endpoint behind `LLMProvider`; `recorded` and `null` providers | remote providers by default |
| Packaging | desktop A: `uv tool install` + CLI; desktop B: Tauri 2 + python-build-standalone sidecar; Docker from day one with profiles `single` / `team` / `dev` on one `compose.yml` (api, worker, postgres, ollama + GPU overlay, caddy; see `docker/DEPLOYMENT.md`) | PyInstaller, Electron |
| Observability | structlog JSON, request ids, job timings, `/healthz` `/readyz`, optional OpenTelemetry | — |
| Testing | pytest + hypothesis, service tests on temp workspaces, httpx API tests, golden files vs library outputs; Vitest + Testing Library; Playwright smoke; assistant cassettes | snapshot-everything |

## 4. Domain model

| Entity | Notes |
|---|---|
| Workspace, Project | install / tenant; project = process, steering question, template, default slice keys |
| Dataset, DatasetVersion | logical log and immutable `events.parquet` with content hash |
| ColumnMapping, FlowTyping | roles, parsing, lifecycle, order, exposure; flow-type rules stored as derive recipes |
| ActivityMapping | log labels → canonical activities and stages of the process ontology; confidence, confirmation, version |
| Document, DocumentChunk, KnowledgeNode, KnowledgeEdge, Retrieval | project document library and its index; knowledge graph tables; what was retrieved for each assistant turn |
| CaseTable | `cases.parquet` + `DataQualityReport` |
| Norm, NormVersion | lineage and immutable versions (library JSON, fingerprint, status draft / reviewed / approved, author, changelog, parent) |
| Run, RunArtefact | parameters, state machine, manifest; Parquet artefacts with checksums |
| Backlog, Slice | not DB rows: queried from Parquet; identity `(run, slicing, key)` |
| Finding | analyst-owned reading of a slice: hotspot type (with override note), dominant layer, disposition from review sessions |
| ValidationGate | kinds data_quality / censoring / replication / domain; pending / passed / failed / waived with evidence and author |
| Hypothesis, Action | A3-style card: mechanism, remedy, owner, due, status, links to constraints/layers/cases |
| Period, Comparison | run pair with frozen baseline; cached comparison table |
| AnalyticsRecord | provenance of every analytics result (analytic, version, inputs, params, output hash, warnings, readiness at run time) |
| Report | template, params, rendered files |
| Conversation, Message, ToolCall, Proposal | full assistant audit: prompt version and hash, model digest, process profile, tool args/results, staged → accepted / edited / rejected |
| Job | kind, payload, state, attempts, lease, progress, error |

Workspace layout: `projects/<id>/{datasets,case_tables,norms,runs,analytics,comparisons,reports,knowledge}` plus `workbench.db` (desktop) and a disposable `cache/`.

## 5. API surface (`/api/v1`)

Projects · Datasets (upload = job) · Mappings (validate on a sample,
build = job) · Norms (versions, diff, validate, check) · Runs (create with
idempotency, poll, cancel, summary) · Jobs (SSE events) · Backlog
(server-side filter / sort / paginate; ad-hoc γ and slicing recomputed on the
frame and cached) · Slice detail (drivers, penalty mass, cases, validation
row) · Cases and traces (events with constraint annotations) · Diagnostics
(validation, agreement, concentration, quality) · Analytics (bootstrap,
contrast, readiness, headroom, monitoring; long ones as jobs) · Review
(findings, gates, hypotheses, actions) · Comparisons · Reports · Exports ·
Knowledge (activity mapping candidates and confirmation, documents and
index status, grounded search, graph explanations) · Assistant (sessions,
streamed turns, proposals accept / reject, capability, audit) · System
(health, version, OpenAPI). The tool registry is additionally served over
MCP.

Backlog rows carry the library's column names (`n_cases, mean_score, gap,
stable_gap, PI, stable_PI, …`) plus keys, hotspot type, dominant layer,
stability badge; the parameters travel once per page.

## 6. Frontend information architecture

| Stage | Screen | Core components |
|---|---|---|
| S0 | Project dashboard | charter, latest run KPIs, open findings and gates, job tray |
| S1–S2 | Data & mapping | dropzone, column profiler, mapping form, flow-typing rule builder, activity canonicalisation (candidates with confidence and stage, confirm / correct / custom), readiness report (banner everywhere afterwards), slice-key designer with owner registry |
| S3–S4 | Norm builder | three panes: catalogue (layers → constraints), constraint editor (type-specific form, activity picker bound to the inventory, applicability rule tree, live `sat()` preview, threshold calibrator on the empirical distribution), views & weights (matrix, agreement preview); JSON tab; version history and diff; check against a case table; expectation wizard |
| S5 | Run monitor | parameters with γ hint, SSE progress, manifest / provenance panel |
| S6 | Backlog explorer | virtualised table with formula popover, hotspot badges, stability strip, volume × gap scatter with whiskers, concentration curve, agreement matrix; filters in the URL; review-session mode with dispositions |
| S6–S8 | Slice detail | header, gap waterfall by constraint, layer bars vs global, penalty-mass Pareto, ECDF overlay slice vs rest, process map with constraint overlays and diff map slice vs rest, variant strip, worst cases → trace timeline with violated constraints annotated, validation row, headroom bars, "create finding" |
| S3–S4, S6 | Model view | BPMN view of the template or the company model with violation heat, constraint arcs and scope hatching; constraint authoring on the model (v1); performance spectrum and dotted chart for lags, batching and censoring |
| S7 | Validation gates | gate cards with evidence, pass / fail / waive with reason and author |
| S8–S10 | Action board | kanban of A3-style cards; evidence chips deep-link to slices, constraints, cases |
| S11 | Period comparison | dumbbell / slope charts of stable gap, change table, control charts, baseline note, re-baseline action |
| S12 | Reports | governance pack templates, section toggles, preview, download |
| all | Assistant panel | streamed turns; tool results rendered with the app's own components; proposal and hypothesis cards with sources; cited document snippets; explanation paths from the knowledge graph; capability tier shown; hidden when no provider |
| S1, S8 | Knowledge | project document library with index status; glossary and failure-mode browser per process; explanation path per constraint |

State: TanStack Query for server data, URL search params for filters,
Zustand for UI state; server-side aggregation everywhere; accessibility via
Radix primitives, keyboard table navigation, colour-blind-safe palettes with
pattern redundancy; i18n `en` and `de`. Experience rules from the design
panel: context ribbon and journey rail on every screen, reading sentences,
"explain this number" popovers, a decision pane that never scrolls away,
linked highlighting, pin-and-compare with stable layouts, presenter mode
for reviews, notes only for human decisions.

## 7. Assistant layer

- Digests with stable ids (`NormDigest`, `LogDigest`, `DistSummary`,
  `BacklogDigest`, `SliceDigest`, `CaseDigest`, `JourneyState`); the model
  references ids, the frontend resolves labels.
- Tool registry mapped to library and analytics functions (read-only,
  cached by fingerprints; one staging tool that never mutates).
- Output contracts as JSON schemas: `ConstraintProposal` (thresholds only
  from tool-returned candidates), `NormReview`, `Narrative` (numbers linked
  to tool results), `ActionHypotheses` (validation status copied from the
  validation table, ≥ 2 evidence links), `Answer`, `NextStep`, `ReportDraft`.
- Capability probe at startup → tiers full / schema-only / slow / off;
  model table by hardware class (4B → 8–14B → 32B+), Q4_K_M floor,
  deterministic options, explicit `num_ctx`.
- Guardrails: vocabulary and faithfulness checks, causal-language gate,
  injection screening of log text, pseudonymised resources, audit store,
  versioned prompts pinned by golden tests.
- Fallbacks: wizard, lint list, template narration, playbook, checklist —
  built first, shared with the LLM path.
- Knowledge (ADR 0009, `docs/panel/llm_knowledge_architecture.md`): a
  curated process knowledge base per process (ontology with system label
  packs, stages, failure modes linked to constraint patterns, KPIs,
  glossary, playbooks, templates); activity canonicalisation at mapping
  time; embedded hybrid retrieval over company documents with citations;
  the knowledge graph as node/edge tables with traversal tools; a context
  builder that assembles the process profile within the model's budget;
  MCP server transport for the same tool registry (v1), MCP client
  connectors (v2). No LangChain/LlamaIndex; Ollama schema-constrained
  output.

## 8. Analytics package

`wise-analytics` (ADR 0006): bootstrap uncertainty and rank stability,
contrastive gap decomposition with native-unit effect sizes, readiness gate,
headroom under the norm, period monitoring with SPC limits, norm-engineering
proposals, violation signatures, PI-guided subgroup discovery with holdout;
later hand-offs and open-case exceedance risk. Each result: claim, evidence,
uncertainty, caveats, provenance. Per-case features come only from
`EventLog.cases` and norm recipes; caches are content-addressed by log and
norm fingerprints and library version.

## 9. Non-functional targets

Desktop (4 cores, 16 GB, ≤ 5 M events): ingest ≤ 90 s, case table ≤ 30 s,
run ≤ 90 s, backlog page p95 ≤ 300 ms, slice detail ≤ 500 ms (cold re-score
≤ 3 s), trace ≤ 200 ms, interactive analytics ≤ 5 s else job, first LLM
token ≤ 3 s on an 8B model, SPA first load ≤ 2 s, worker RSS ≤ 4 GB. Server:
20 M events with 8 GB workers. Privacy: no telemetry, loopback binding on
desktop, per-project redaction list, assistant share level `names_only` by
default. Reliability: leased jobs, atomic artefact writes, manifest-last,
Alembic migrations, norm schema shims, workspace format version.

## 10. Repository layout

```
wise-workbench/
  apps/backend/        wise_workbench: domain · application · adapters (engine, storage, db, llm, knowledge, mcp, connectors, exporters) · api · jobs · assistant
  apps/frontend/       React SPA: routes · features · components/ui · lib
  apps/desktop/        Tauri shell (phase B)
  packages/wise-analytics/     analytics on wise artefacts
  packages/api-schema/         openapi.json + generated TS client
  packages/design-tokens/      tokens → CSS variables + ECharts theme
  packages/process-knowledge/  curated process knowledge: ontologies, stages, failure modes, KPIs, glossary, playbooks, norm templates
  docker/              DEPLOYMENT.md, compose.yml + gpu/dev overlays, Dockerfiles, Caddy, .env.example
  docs/                journey, architecture, roadmap, ADRs, panel reports
```

Layering: `api → application → domain`; `adapters` implement ports;
nothing above `adapters` touches pandas, DuckDB, `wise` or the LLM.

## 11. Items accepted for `wise-pm` 0.2 (decision 2026-09-05)

- `ScoreResult.save(dir)` / `load(dir)` so drill-downs do not re-score.
- `signal_matrix(log, norm)`: raw constraint signals in native units, from
  the same primitives scoring uses.
- Recipe kind `handoffs` (resource changes along a trace).
- A synthetic P2P generator with planted hotspots for evaluation.
