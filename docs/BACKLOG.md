# Backlog — what is still to do

Living list, maintained after each increment. Status as of 2026-09-05,
after increment 0 was verified. Sources: the "Not done" sections of the
five `CHECKPOINT.md` files, `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, the
panel reports and `DECISIONS.md`.

## A. Owner actions

| Item | Where |
|---|---|
| First commits in `wise-workbench` and `wise-flow` (repositories are initialised, nothing committed; commit with your own identity) | both folders |
| Licence for the workbench itself (the flow library is PolyForm Noncommercial 1.0.0; the method library is MIT) | `wise-workbench/LICENSE` |
| Domain review of the knowledge packs: every entry is `review_status: draft`; decide the two BPIC 2019 label spellings (`Vendor creates credit memo`, `Change payment term`) | `packages/process-knowledge/{p2p,o2c}` |
| Readiness thresholds in `wise_analytics.quality` are conventions from the synthetic generator; confirm or adjust on real extracts | `packages/wise-analytics` |
| GitHub repositories and npm scope for `@wise/flow` | — |
| Paper updates already listed in `wise-lib-notes/PAPER_ALIGNMENT.md` | notes |

## A2. Guidance and plain language (owner finding, 2026-09-05)

RG-1 to RG-12 in `docs/panel/guidance_and_insight_panel.md`: plain
vocabulary layer with switch, signals list of sentence cards as the
default view, "Why?" reason chain, "What can we do?" remedy screen,
how-to-read paragraphs, caveat chips, kinds of problem renamed acute /
systematic / widespread, comprehension test in every panel review,
onboarding walk, assistant using the plain layer.

## A3. Guidance on layers and the knowledge hub (owner input, 2026-09-06)

RK-1 to RK-11 in `docs/panel/knowledge_hub_panel.md`: guidance object on
every layer, expectation and failure mode (generic tier in the packs,
project overlay by stakeholders), `metadata.guidance` in norm JSON,
knowledge hub screens per process type, "what does this mean?" chips
everywhere, guidance elicitation when layers are defined, hub as the
single source of the reason and remedy texts, assistant grounding, hub
pages in the governance pack.

## B. Increment 1 — first end-to-end (next)

Integration first:

1. Regenerate `packages/api-schema/openapi.yaml` from the backend
   (`wise-workbench openapi --yaml`), re-run the frontend contract tests,
   and settle the two format differences: slice keys as JSON arrays and
   real column names in `slicing` (frontend mocks use aliases and strings).
2. Frontend on the real backend (CP-B2): `VITE_API_URL`, smoke test against
   the live API, upload of the BPIC 2019 CSV through the browser.
3. Link `@wise/flow` into the frontend (local `npm link` or `file:`), render
   the Flow tab from `GET /runs/{id}/flow`, pass overlays from the
   backend's constraint statistics.

Then features:

4. Jobs over SSE in the client (today: polling every 700 ms).
5. Analytics jobs in the backend calling `wise_analytics`: stability badges
   on the backlog (`bootstrap_backlog`), contrast waterfall from
   `contrast_slice`, headroom, readiness merged into the backend's report;
   cache under `analytics/<name>/<params_hash>.parquet` with provenance.
6. Knowledge packs loaded through the backend entry point; activity
   canonicalisation in the mapping screen (candidates, confidence,
   confirm / correct / custom) stored as `ActivityMapping`; glossary and
   failure modes served to the frontend.
7. Norm builder forms: constraint editor per type with the distribution
   lens, applicability rule tree, views and weights matrix, diff as a
   changelog, `check` against a case table.
8. Server-side stability filter (contract addition), `stability` from
   analytics instead of `unknown`.
9. Review entities in the backend (findings, gates, hypotheses, actions);
   today they live in the browser's localStorage.
10. Exit check: BPIC 2019 from upload to backlog in the browser with the
    Table XI numbers on screen (CP-1.1 to CP-1.5).

## B2. Interactive flow (owner request, 2026-09-05; details in `docs/panel/flow_interaction_requirements.md` once written)

- Filters on the map, backlog and analytics together: time window, case
  attributes, slices, activity-based (contains, starts/ends with, follows),
  performance, rework, open/closed; in the URL; cases in/out shown.
- Click actions on activities, stages, edges: filter to, exclude, incoming
  and outgoing paths, add a constraint here, pin, worst cases through here.
- "Analyse only this part of the process": sub-log from a stage or an
  activity set with re-derived case table and the constraints inside it.
- Activity reasoning panel: waiting and processing time, bottleneck
  reading, blocking of successors, repetition and loops, deterministic
  versus discretionary execution, censoring, constraints touching it.
- Stage and edge panels; performance spectrum on an edge; batching
  signature.
- Backend endpoints: filtered flow, activity profile, path analysis,
  sub-log creation.

## B3. Owner walkthroughs, deployment and authentication (owner request, 2026-09-06)

- Owner walkthroughs W1–W5 after cycles 2, 4, 6, 8, 10 with the guide and
  template in the walkthrough guide in the owner's notes; the loop waits for the
  feedback.
- Deployment and authentication per `docs/DEPLOYMENT_AUTH_PLAN.md`:
  single-user install and Docker single profile (cycle 6), team server
  with OIDC, roles and audit (cycle 8), hosted pilot with invitations,
  user administration and backups (cycle 9), hardening (cycle 10).

## C. Increment 2 — the improvement loop

- Validation gates with evidence and waive-with-note; hypotheses blocked
  until gates pass.
- Action cards (A3 style) linked to slices, constraints, cases; owner
  registry.
- Period comparison with frozen baselines; re-baselining as a logged
  action; `compare_periods` and `period_backlogs`.
- Governance pack export (HTML/CSV first; DOCX/XLSX later) with run ids and
  the method appendix; figure export from `@wise/flow` and ECharts.
- Public log presets (F41) for BPIC 2019, 2017, 2012, the hackathon O2C
  extract; O2C end-to-end (CP-2.4).
- Presenter (review) mode, owner portal, command palette over slices and
  cases (UX-9, UX-11, UX-12).
- Docker `single` profile and `uv tool install` packaging.

## D. Increment 3 — v1 start

- Assistant: provider, capability probe, digests, tool registry, prompts,
  guardrails, cassettes; narration and Q&A (U3, U5), single-expectation
  constraint drafting (U1); context builder with process profiles.
- Knowledge layer: knowledge-graph tables and explanation paths, document
  library with embedded hybrid retrieval and citations, MCP server
  transport.
- `@wise/flow` 0.2: BPMN view with overlays and task mapping, Canvas
  renderer, PNG export; 0.3: variant strip, performance spectrum, dotted
  chart; BPMN reference models per pack.
- Analytics v1: norm aids (threshold and applicability proposals,
  constraint health, co-occurrence), monitoring with SPC limits,
  signatures, subgroups, sensitivity envelope with Kendall τ.
- Knowledge packs: credit applications (BPIC 2012/2017), ITSM
  (BPIC 2013/2014, Helpdesk), permits / subsidies / expense claims; German
  glossary complete; embedding-based matching; Ariba / Coupa / Oracle /
  D365 label packs.
- Server mode: Docker `team` profile, Postgres path tested, OIDC and roles,
  backup command; XES import tested with pm4py.
- Frontend: German locale, density modes and dark theme polish, keyboard
  map, workshop kit, Figma token sync, second usability round.

## E. Upstream to `wise-pm` 0.2 (accepted)

`signal_matrix`, `ScoreResult.save/load`, `handoffs` recipe, synthetic
generator with planted hotspots; a date-difference derive recipe (the O2C
pack needs `days_late` prepared outside the norm today); `hotspot_table`
tolerant of missing slice keys. Details in `wise-lib-notes/NEXT_VERSION.md`.

## F. Later (v2 and research)

Tauri desktop bundles; connectors and scheduled runs; MCP client
connectors and cross-project memory; hand-off network once `handoffs`
exists; case-flow animation and object-centric graphs; production and
healthcare packs with domain reviewers; LoRA adapters only if the v1
evaluation shows persistent failures on small models; server-side
rendering for scheduled reports; `@wise/flow` 1.0 on npm.
