# Backlog — what is still to do

Current sequencing is in [ROADMAP.md](ROADMAP.md), updated 10 September 2026.
Requirement identities below are retained; an earlier “next” label or recorded
test count is historical evidence, not a current release-status claim.

## Current delivery queue

| Milestone | Scope in this backlog | Completion boundary |
|---|---|---|
| M0/M1 | Distribution and bounded backend/client/renderer cleanup | Compatible packaged inputs and unchanged behavior; no goal-board feature claim |
| M2 | Norm save/approval, GR-02/GR-03, server findings/dispositions, visible refusals, comparison/test/scenario readings | A trustworthy classic decision workflow; actual domain calibration is a separate review |
| M3 | GR-01/04/05; initial GR-07/09/13 | Goal/action board with ownership, review criteria and separate outcome state |
| M4 | GR-06/08; full GR-07/09/13 | Sequencing, alternatives, capacity, dependencies and frozen follow-up documentation |
| Independent optional track | B4, GR-10 | Explicit capability adoption after the selected library contracts are ready |
| Later bounded releases | B2 remaining activity/visual work, GR-11/12, movable analytics dashboard and process packs | Separately scoped; dashboard and PowerPoint do not require an LLM or the extension |

For new acceptance tests, a legitimate gate refusal, unavailable comparison,
uncomputed uncertainty or qualitative caveat is valid when clearly explained.
Do not require invented shares, favourable outcomes or a benchmark ranking.
Preserve exact scoped evidence; do not infer causal benefit from priority or
hypothetical headroom. These rules supersede stronger historical examples.

The norm-persistence part of M2a is implemented: calibration and exclusion
reasons/owners/dates survive reload; changed rules require a current decision;
review and approval persist the explicit signer and show refusals without
losing input. A public five-case browser workflow exercises these operations
against the actual backend. This does not close M2a: scoped evidence, persistent
finding/disposition and shared action eligibility still precede the goal board.

The first [action commitment boundary](ACTION_REVIEW.md) now records immutable
proposal context and applies the same evidence/gate checks to creation and
updates. Unassessed drafts remain usable; pending, unavailable, stale and
unsupported filtered evidence cannot silently authorise commitment. Supported
filters now record exact membership and selected-item readiness; decisions are
bound to that selection and its measured checks. Broader filter grammar and
context propagation through findings/hypotheses remain open, so GR-02/GR-03 and
M2a are not closed by this bounded change.
It also does not establish business calibration or a human usability result.

The remaining sections preserve original requirements and observations.
Consult the repository README for current implemented behavior and limitations.

## WISE Support and question-based exploration

Owner request, 10 September 2026. Planned, not shipped. The presentation
contract and acceptance scenarios are in [WISE_SUPPORT.md](WISE_SUPPORT.md).
These items form an independent exploration track with M2 evidence-scope
correctness as the production dependency; they do not delay the classic goal
board for optional library or model integration.

| ID | Next step | Completion boundary |
|---|---|---|
| WS-01 | A visible WISE Support on/off switch in Explore, initially off | Keyboard/focus/announcement work; raw questions stay available; guidance visibility changes without changing analysis, map geometry or mandatory caveats |
| WS-02 | Contextual expectation and deviation guidance; time as the first complete question | Relevant native values and targets share scope, norm and comparator; missing/draft/incompatible/error states are explicit; no automatic scoring or invented targets |
| WS-03 | Phase/occurrence and dense-process fixture, then geometry validation | At least 60 activities; real loops, external excursions and rare exits preserve exact witnesses; aggregate paths do not invent a case-level return; readable stable navigation measured separately |
| WS-04 | Saved presentation state and evidence links | Visibility persists in exploration/notebook context; toggling cannot rewrite findings, result identity, historical exports or action eligibility |
| WS-05 | Classic and optional-capability boundaries | Presentation switch works with classic WISE and never enables optional runtime, downloads, model calls or permissions; installed-but-off profile remains off |

## A. Original owner actions (historical)

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

## B. Increment 1 — first end-to-end (historical)

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

## B2b. Carried out of the third release — closed by this one

The three items measured and not met at the last release were all measured
again on this build:

- **A readable label at the fitted zoom** — **closed**. Every text drawn
  inside the map is at least 11 px on the screen at 1440 × 900, 1280 × 720
  and 1024 × 768, on both logs and at every detail level, with the activity
  name at 12 px; the drawing is fitted to itself rather than to the lanes,
  so the band above it is 4.2 % of the frame instead of 44.7 %.
- **A path list that is visible at once** — **closed**. The paths open on a
  sheet over the map: all 49 paths of *Record Goods Receipt* are on the
  screen without scrolling, and the canvas keeps its 1,158 px.
- **The board's first filtered selection** — **closed for the tiles**. The
  four tiles are read from the run's own artefacts (0.20 s the first time
  after a start, 0.009 s again) and a filtered selection costs about 0.13 s
  once the log is in the process; a run scored before this release pays
  about 3 s once, for the open-case flag it has no artefact for.

## B2c. Carried out of this release — the map's own geometry and the P2 list

Measured on the released build and **not met**; named here rather than
closed.

- **Two drawn texts can overlap.** Every text is large enough to read, but
  the overlays are placed without knowledge of each other. Measured on the
  released build over the three reference windows and the four finer detail
  levels of BPI Challenge 2019: **12 to 22 intersecting pairs**, of two
  kinds — a path's share label over another path's (*⇒ 52 %* over *⇒ 38 %*)
  and a badge over the activity name or the item count beside it (*≥1* over
  *Vendor creates invoice*, *11 %* over *210k*). The placement is the flow
  library's own overlay geometry (`core/overlays.ts`), outside this
  repository; the apexes and the badge anchors have to be placed with
  knowledge of each other.
- **The map's own tooltips say *cases*.** The `<title>` of a path reads
  *124,621 cases. median lag 37 d.*: the library writes it and takes no case
  noun. It needs either a case noun in the library's API or the product's
  own title element over the drawing.
- **The coarsest detail level does not fill its frame.** At *stages only*
  the drawing leaves 21.4 % of the frame empty above, 60.5 % below and
  35.9 % on the right at 1440 × 900, where the other four levels leave no
  band over 8 %. The live check measures the band at the default level only;
  it should measure every level.
- **The board's map panel leaves a 9.4 % band below the drawing** at
  1440 × 900, against the same 8 % rule; the live check measures the Flow
  step's frame, not the panel's.
- **The P2 list of the last review is untouched**: no what-if screen, the
  possible gain's denominator, a due date on an action, the hub index's
  repeated names, plain names on the norm step, the distribution panel's
  title and unit, a chip of its own for an expectation that measures
  logging, the badges on the extract's map, the customer's noun on a card,
  the calibration chip inside a sentence, `required` on the required fields,
  the text repairs, the board's 1.5 s map redraw, and a run scored before
  the comparison rule that carries no comparison sentence.

## B3. Owner walkthroughs, deployment and authentication (owner request, 2026-09-06)

- Owner walkthroughs W1–W5 after cycles 2, 4, 6, 8, 10 with the guide and
  template in the walkthrough guide in the owner's notes; the loop waits for the
  feedback.
- Deployment and authentication per `docs/DEPLOYMENT_AUTH_PLAN.md`:
  single-user install and Docker single profile (cycle 6), team server
  with OIDC, roles and audit (cycle 8), hosted pilot with invitations,
  user administration and backups (cycle 9), hardening (cycle 10).

## B4. Optional actionability extension (owner decision, 2026-09-06; ADR 0012)

Built in the application cycle that follows the extension's first stages,
never before there is something to detect:

- **R-EXT-1** capability probe and `WISE_ACTIONABILITY` setting
  (`off` by default / explicit `on`, per ADR 0012), capabilities in the version endpoint and in every
  run manifest.
- **R-EXT-2** engine adapter: extension calls behind capability checks with
  classic fallbacks that produce identical numbers.
- **R-EXT-3** interface: a settings page naming the installed build and what
  it adds; capability-dependent controls shown only when available; runs and
  exports labelled with the capability set; a warning when runs made under
  different capability sets are compared.
- **R-EXT-4** deployment: the opt-in install documented in the deployment
  guide (one package replaced, service restarted) and, later, a container
  profile.
- **R-EXT-5** the dual-build check in the local release routine: the
  application suites and the reference reproduction run against both builds
  and must agree.

## B5. Goal-oriented improvement roadmap

Proposed 2026-09-10; not implemented. See [the product design](GOAL_ROADMAP.md).
This extends the existing action records and preserves the linked Explore Board.
Correctness repairs and contract cleanup precede implementation.

| ID | Priority / slice | Planned work and acceptance |
|---|---|---|
| GR-01 | P1 · Classic board | Stable project goals with owner, scope, revision and optional measurable target; renaming or changing norms preserves identity/history. |
| GR-02 | P1 · Prerequisite | Carry exact filter, view, norm, flow type, population and comparator through review/gates/evidence. A wider fallback is never labelled validated. |
| GR-03 | P1 · Prerequisite | One server transition policy for all action updates and board moves; missing/pending checks stay unresolved, repair drafts remain possible, refusals are visible and atomic. |
| GR-04 | P1 · Classic board | Compact Board/List using existing actions: Proposed / Agreed / Doing / Closed; keyboard move/reorder, reload and stale-write protection. |
| GR-05 | P1 · Classic board | Goal/view swimlanes and primary/secondary links; one action identity, one card per arrangement, no duplicated counts or capacity. |
| GR-06 | P1 · Planning slice | Human-selected Now/Next/Later with rationale, effort, dependencies and manual capacity; detect dependency cycles and missing prerequisites, without presenting PI as benefit. |
| GR-07 | P1 · Both slices | Work completion separate from outcome review; baseline, success criteria, guardrails and inconclusive/adverse/not-measured outcomes; pending reviews stay visible. |
| GR-08 | P1 · Planning slice | Freeze the roadmap revision with structured evidence, screenshot and notes; notebook/export preserves decisions and historical scope. |
| GR-09 | P1 · Release gate | Entire basic workflow on classic full/minimal profiles, no LLM; unavailable analytics remain unavailable. Reject cross-project references and preserve legacy actions. |
| GR-10 | P2 · Optional enrichment | ADR 0012 capability integration, typed evidence and compatible comparator explanations; extension-present-but-off makes no optional calls. |
| GR-11 | P2 · Later presentation | Dashboard-builder panel and PowerPoint export reuse the same roadmap/action records, not another store. |
| GR-12 | P2 · Later collaboration | Team permissions, cross-project portfolio and external-ticket synchronisation after deployment/authentication work; no automatic remote execution in the MVP. |
| GR-13 | P1 · Design/release gate | Owner walkthrough identifies goal, owner, next action and blocker; goal/view changes preserve tickets; completed work is not mistaken for proven benefit. |

The first usable roadmap comprises the classic board and planning slice, not
just draggable cards. No work item above is closed by this planning update.
Norm calibration/signing and meaningful gate refusals remain prerequisites;
the existing flexible analytical dashboard request remains separate.

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
