# Initial roadmap — historical design

Archived 10 September 2026. The phase estimates, implementation states and
installation proposals below are historical assumptions, not current delivery
promises. Use [the current roadmap](ROADMAP.md) for sequencing and
[the README](../README.md) for implemented capabilities.

## Phase 0 — foundations (weeks 1–2)

- Monorepo from the skeleton; `uv` workspace, `pnpm` workspace, CI (ruff,
  mypy --strict, pytest; tsc, eslint, vitest; OpenAPI drift check).
- Domain model and metadata schema (ADR 0003), workspace layout, job table
  and worker (ADR 0002), engine adapter with golden tests against the
  library's running example and the BPIC'19 numbers.
- Design tokens and the analytical component set (backlog table, hotspot
  badge, driver bars, distribution histogram with draggable thresholds,
  trace timeline, validation chips).
- `wise-flow` repository scaffold (separate repository, ADR 0011): core
  model, ELK worker, React Flow scene, bpmn-js wrapper, Storybook and
  visual regression; the workbench links it locally with pnpm.
- Design system and Figma library synced from tokens; design review
  checklist in the PR template (UX-26, UX-28).

## MVP — desktop, no LLM (weeks 3–10)

Journey coverage S1–S7 plus cards and period runs, in this order:

1. Ingest (CSV / Parquet / XES), column mapping, data-readiness report
   (F2, F3), case-notion and flow-type builder (F4), slice-key designer with
   owner registry (F5), activity canonicalisation against the P2P and
   O2C ontologies with SAP label packs (F33), knowledge base content for
   P2P (BPIC 2019, hackathon purchase orders) and O2C (hackathon sales and
   stock data, OCEL Order Management vocabulary) with schema, loaders and
   review workflow (F34), public log presets (F41; `docs/DATASETS.md`).
2. Norm builder with forms, JSON view, versions with status and diff,
   `validate` / `check` (F6); expectation wizard and threshold calibrator on
   the empirical distribution (F7, F8); applicability matrix (F9); view
   workshop mode (F10).
3. Scoring runs with manifests and SSE progress (F11); backlog explorer with
   formula popover, concentration curve, hotspot typology (F12–F14); slice
   detail with drivers, penalty-mass Pareto, raw-distribution lens and
   annotated traces (F15, F16); process map with constraint overlays
   (F42), BPMN view with overlays for the pack's reference model (F43),
   trace timeline (F44), distribution lens and backlog charts (F45);
   SVG/PNG export for the governance pack.
4. Validation gate (F17), review-session mode (F18), action cards (F19),
   period runs with a frozen baseline (F20), governance pack export as
   HTML/CSV (F21).
5. Analytics MVP: bootstrap stability badges, contrastive gap waterfall,
   readiness gate wired to the backlog, headroom per driver; provenance
   records from day one.
6. Experience (design panel MVP set UX-1 to UX-10, UX-21, UX-22, UX-29):
   context ribbon, journey rail with gate states, explain-this-number,
   reading sentences, decision pane, distribution lens, linked
   highlighting, pin-and-compare, presenter mode, public-log onboarding;
   first usability round with five analysts (UX-27).
7. Distribution: `uv tool install wise-workbench`, CLI opens the browser;
   Docker `single` profile (backend image built in CI, SQLite, host
   Ollama) for Linux workstations and container users.

Exit criteria: the BPIC'19 evaluation of the paper can be reproduced
end-to-end in the UI (norm import, run, Table XI slices, Table XII
validation, vendor Pareto) and exported as a governance pack; the
hackathon O2C extract runs end-to-end on the O2C pack (order-item case
notion, header-event replication typed away, postponements, cancellations
and late goods issue as drivers by customer and SKU, open items censored);
BPIC 2017 runs through a generic template with censoring at 1 Feb 2017
handled by the validation gate.

## v1 — assistant, teams, monitoring (weeks 11–20)

- Assistant with tools, staged proposals, audit trail and capability tiers:
  result narration and Q&A, single-expectation constraint drafting; then
  norm review over lint findings, action-hypothesis drafting, journey
  guidance, report drafting (F29). Golden sets and cassette tests in CI.
- Knowledge layer: context builder with process profiles, knowledge-graph
  tables and explanation paths (F35), document library with embedded hybrid
  retrieval and cited answers (F36), MCP server transport (F37), order
  management, production and ITSM knowledge packs (F38); retrieval
  evaluation sets per process.
- Server mode: Docker `team` profile (workers, Postgres, Ollama with GPU
  overlay, Caddy with OIDC), project roles, backup command, air-gapped
  bundle; owner portal (F26).
- Visualisation v1: diff maps (F46), constraint authoring on BPMN (F47),
  variant strip, performance spectrum, dotted chart, stage funnel, small
  multiples (F48); control charts.
- Experience v1: owner portal, command palette, norm diff as changelog,
  BPMN model tab, workshop kit, density modes and dark theme, report
  preview, German sentences, keyboard map, assistant cards, period
  comparison strip (UX-11 to UX-20, UX-23 to UX-25); second usability
  round.
- Period monitoring with SPC limits (F23), sensitivity sweep (F22),
  fishbone / 5-why workspace seeded from drivers (F24), template library with
  adapt wizard (F25), exposure-weighted priorities (F27), document roll-up
  (F28), DOCX/XLSX reports.
- Analytics v1: norm-engineering proposals, sensitivity envelope, what-if
  norms and weights, violation signatures, subgroup discovery with holdout,
  synthetic generator and evaluation harness.

## v2 — desktop bundles, connectors, research items

- Tauri desktop bundles with auto-update (ADR 0008); SQL / ODBC and
  warehouse connectors; scheduled monitoring runs; plugin API stabilised;
  PDF export.
- Analytics later items: hand-off analysis, open-case exceedance risk with
  backtesting, quasi-experimental before/after with control slices labelled
  as such (F32 as a design checklist).
- pm4py bridge (F30); object-centric case notions when the library supports
  them (F31); production pack (Production log, Hinge Production OCEL) and
  healthcare packs (BPIC 2011, Sepsis, Hospital Billing) with domain
  reviewers.
- MCP client connectors and cross-project memory (F39); LoRA adapters only
  if the v1 evaluation shows persistent failures on small models (F40).
- Hand-off network once `handoffs` exists in `wise-pm` 0.2 (F49);
  case-flow animation, object-centric graphs, server-side rendering for
  scheduled reports, `@wise/flow` 1.0 on npm (F50); touch-friendly
  presenter mode (UX-30).

## Team

Backend engineer (Python, data), frontend engineer (React), a
visualisation engineer who owns the `wise-flow` repository and the BPMN
bridge, a product designer (part-time from Phase 0; owns the design
system, usability rounds and presenter mode),
one engineer for analytics and the assistant (shared with the library
maintainer), a process-mining / BPM domain lead for templates, playbooks and
workshop facilitation; a Black Belt as design partner for gates, cards and
control charts. Two engineers can deliver the MVP in about ten weeks; the
assistant and server mode need the third.

## Top risks (consolidated)

| Risk | Mitigation |
|---|---|
| Norm engineering too heavy; workshops stall | wizard, calibrator, templates, "10 constraints first", per-constraint save |
| Wrong case notion or flow typing silently produces a wrong backlog | S2 gate, coverage counts, readiness banner, sensitivity to case notion |
| Replicated or bulk events inflate rework signals | replication diagnostics per slice, S7 gate blocks hypotheses |
| False precision in PI | formula popover, `PI_lower`, bootstrap badges, language rules |
| Assistant invents labels, numbers or causes | id-bound vocabulary, table-cited numbers, causal-language gate, accept-only workflow, audit |
| Curated process knowledge is the bottleneck | start with P2P and O2C, review workflow, sources per entry, community contributions later |
| Wrong canonical mappings propagate into templates and narration | confidence shown, readiness item for unmapped labels, versioned mappings |
| Retrieval surfaces stale or injected document content | document versions and dates in citations, untrusted-input screening, quote-only rendering |
| Drill-downs need a live `ScoreResult` | persist frames, warm re-score cache, upstream `save/load` |
| Desktop packaging | `uv tool` first, Tauri sidecar later, no PyInstaller |
| Interactive maps stall on large graphs; layouts jump between slices | server-side aggregation and abstraction, Canvas renderer above ~2k elements, ELK in a worker with cached union-graph layouts |
| Memory on very large logs | DuckDB pushdown, mapped columns only, guard rails with clear errors |
| Moving baselines make trends meaningless | frozen, named baselines; re-baselining as a logged sponsor action |
| The tool becomes a dashboard and the loop never closes | dispositions, gates, cards and period runs are first-class; the governance pack reports open actions |
