# WISE Workbench — design workspace

Design workspace for an application that analyses event logs with the
`wise` library (norm-based, slice-first prioritisation) and guides analysts
and process owners through an improvement process, with a local LLM
(Ollama) as an assistant.

This folder holds the design, not yet the implementation:

| Path | Content |
|---|---|
| `docs/panel/` | Reports of the expert panel: process mining / BPM / Lean–Six Sigma, backend + frontend architecture, ML analytics, LLM assistant, the knowledge-architecture follow-up (RAG, knowledge graph, MCP, frameworks, process-specific understanding), process-flow visualisation (flow library, BPMN, visualisation catalogue) the UI/UX design panel (navigation, screen concepts, interaction patterns, design system, accessibility, workshops), the guidance and insight panel (plain language, signal → reason → remedy), the knowledge-hub panel (stakeholder guidance on layers, meaning → reasons → actions per process), and the interactive-flow requirements benchmarked against Celonis, Disco, Apromore, Signavio, UiPath and pm4py (RF-01 to RF-53). |
| `docs/CUSTOMER_JOURNEY.md` | Personas, journey stages, and the feature catalogue derived from them. |
| `docs/ARCHITECTURE.md` | Architecture draft: components, stack, domain model, APIs, deployment. |
| `docs/ROADMAP.md` | MVP → v1 → v2 and the main risks. |
| `docs/DATASETS.md` | Inventory of public event logs (BPI Challenge 2011–2020, 4TU logs, OCEL 2.0) with their fit to the method and the knowledge-pack order derived from them. |
| `docs/DECISIONS.md` | Decisions taken by the owner, dated. |
| `docs/IMPLEMENTATION_PLAN.md` | Increments, workstreams, contracts, test strategy, and the checkpoints where the owner tries each feature. |
| `docs/BACKLOG.md` | What is still to do, by increment, plus owner actions. |
| `docs/DEPLOYMENT_AUTH_PLAN.md` | Deployment stages D0–D5, hosting choices, authentication modes and roles, work items by cycle. |
| `docs/adr/` | Architecture decision records. |
| `docker/` | Docker installation: deployment guide with `single` / `team` / `dev` profiles, draft `compose.yml`, GPU overlay, Caddy config, `.env.example`. |
| `apps/backend`, `apps/frontend`, `apps/desktop` | Repository skeleton for the implementation (README per module describing its responsibility; placeholder `pyproject.toml`, `pnpm-workspace.yaml`, `justfile`). |
| `packages/wise-analytics` | Skeleton of the analytics package (uncertainty, contrast, readiness, headroom, monitoring). |
| `packages/process-knowledge` | Curated process knowledge (ontologies with system label packs, stages, failure modes, KPIs, glossary, playbooks, norm templates) for P2P, O2C, order management, production, ITSM. |
| `packages/api-schema`, `packages/design-tokens` | Shared packages: generated API client, design tokens. |

The `wise` library itself lives in a separate repository
(`github.com/feelfine1977/wise-pm`) and is used as a dependency. The
process-flow visualisation library `@wise/flow` is also a separate
repository; its design workspace is `../wise-flow/`.
