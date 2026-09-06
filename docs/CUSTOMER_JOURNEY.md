# WISE Workbench — customer journey and feature set

Synthesis of the expert panel (process mining, BPM, Lean/Six Sigma, software
architecture, ML, LLM). Panel reports with the full reasoning:
`docs/panel/`.

## 1. Design principles

1. **The app is organised around the improvement loop, not the log.** Products
   are the versioned norm, the run manifest, the dispositioned backlog, the
   validation record, the action cards and the period reports. The log is an
   input.
2. **Computation is automated; judgement is not.** The app never sets
   thresholds, widths, weights, γ, case notions, readings, causes or owners.
   Each of these is a one-click human action with a mandatory note.
3. **Every screen names its context**: norm version, view, slice key, period.
4. **Local-first and reproducible**: logs, norms, results and assistant
   traffic stay on the machine; a project folder reproduces any backlog
   without the app (plain Parquet/JSON/Markdown artefacts).
5. **The assistant proposes, people decide.** The `wise` library is the only
   source of numbers; the LLM drafts, explains and asks, and every accepted
   suggestion is recorded with model, prompt version and output.
6. **Descriptive, not causal.** Priorities and drivers are evidence for
   hypotheses; the app never labels an intervention "effective" from log data
   alone.

## 2. Personas

| Persona | Needs to see | Decides | Hands over |
|---|---|---|---|
| Process analyst | data-readiness report, activity inventory, applicability density, score distributions, drivers, sensitivity, validation table | case notion, label merging, derived attributes, γ and `min_cases`, blocking caveats, validation reading | scored run + backlog + validation record; norm draft; run manifest |
| Process owner | own slices in business words, the norm as sentences, hotspot type, drivers, worst cases and traces, trend vs baseline | thresholds, accept/dispute priorities, action ownership, norm approval | action cards; norm sign-off |
| Improvement lead / Black Belt | hotspot typology, constraint Pareto, raw distributions slice vs rest, validation flags, period series | which slices become projects, RCA method, control limits, pilot scope | A3/charter, countermeasure plan, control plan, before/after evidence |
| Executive sponsor | concentration curve, top-10 per view, view-agreement matrix, PI trend, open actions by owner | steering view, capacity, re-baselining, norm change approval | mandate and priorities |
| Data engineer | column mapping, timestamp parsing, observation window, replication diagnostics, recipes, extraction scope | extraction fixes, flow-type source, refresh cadence | reproducible extract with fingerprint |
| Auditor / controller | norm versions with approvals and diffs, run manifests, exclusions, overrides, assistant provenance | whether a backlog and a report claim are reproducible | audit note |

## 3. Journey stages

Mapping: DMAIC phase · BPM lifecycle phase · A3 box.

| # | Stage | Output | Human decision | Exit criterion | Mapping |
|---|---|---|---|---|---|
| S0 | Steering question and scope | charter (goal, process, period, owners, template) | which goal lens steers first | question written, owners named | Define · Identification · Background/Problem |
| S1 | Log intake and data readiness | `events.parquet`, mapping, data-readiness report, log fingerprint | accept the log or return it; which caveats travel with every report | no blocking issue; caveat list attached | Measure · Discovery · Current condition |
| S2 | Case notion, flow types, slice keys | analysis-unit spec, flow-type recipe, owner registry | case notion; flow-type rule; keys; small-slice merging | every case typed; every slice value has an owner | Measure · Discovery · Current condition |
| S3 | Norm elicitation workshop | norm vN with rationale per constraint | every threshold, width, applicability rule, layer (owners decide) | `check()` clean; every constraint has owner, rationale, calibration note | Define/Measure · Analysis · Target condition |
| S4 | View design | views with layer weights; agreement matrix | weights; steering vs informative views | ≥1 approved view | Define · Analysis · Target condition |
| S5 | Scoring and calibration | scored run + manifest; score distributions; γ estimate; sensitivity | γ, `min_cases`, scoring mode, exposure vs cases | manifest written; unscored share explained | Measure/Analyze · Analysis · Analysis |
| S6 | Backlog review session | dispositioned backlog (agree / dispute / defer per slice) | which slices proceed; disputed thresholds return to S3 | top-k dispositioned | Analyze · Analysis · Analysis |
| S7 | Validation gate | validation status per focus slice (stable / verify first / artefact) | reading; case exclusions (logged) | every focus slice has a reading | Analyze · Analysis · Analysis |
| S8 | Root-cause analysis | RCA record: mechanism, traces, distributions, fishbone/5-why | mechanism reading; confirmed causes | hypothesis with mechanism evidence and one non-log confirmation | Analyze · Analysis · Root cause |
| S9 | Action hypotheses | A3-style cards: slice, view, type, mechanism, hypothesis, owner, expected effect, evidence links | owner accepts; sponsor prioritises | card complete and accepted | Improve · Redesign · Countermeasures |
| S10 | Intervention planning | charter/A3, pilot scope, success metric, control plan | pilot vs roll-out; success threshold | sponsor approves; baseline run frozen | Improve · Implementation · Plan |
| S11 | Monitoring across periods | period report with fixed baseline, per-constraint rates, control chart | plausibility of change; norm still right; re-baseline (logged) | period decision recorded | Control · Monitoring · Follow-up |
| S12 | Institutionalisation | norm as standard; template; governance calendar | norm ownership; review cadence | second cycle runs without the original analyst | Control · all · Standardise |

The library carries S1 (diagnostics), S5–S7 and S11 almost completely and
supports S3 (distributions), S6 (drivers) and S8 (drill-down). Judgement is
indispensable at S0, S2, S3 thresholds, S4 weights, S6 dispositions, S7
readings, S8 causes, S9 owners and S11 re-baselining.

## 4. Feature catalogue

Tier: **M** MVP · **S** should · **L** later. "Library" names the `wise` capability.

### Data and analysis units
| ID | Feature | Persona | Library | Tier |
|---|---|---|---|---|
| F1 | Project workspace: one folder per process, versioned artefacts, timeline; reproducible from the folder | analyst | `Norm.dump/load`, `fingerprint` | M |
| F2 | Log importer and column mapper (CSV/Parquet/XES), 50-row preview, timestamp format tester | analyst, DE | `EventLog`, `from_csv`, `from_xes` | M |
| F3 | Data-readiness report: traffic lights, activity inventory, observation window, replication; banner on every later screen | analyst, DE | `validate`, `observation_window`, `timestamp_outliers`, `event_replication`, `cross_case_replication` | M |
| F4 | Case-notion and flow-type builder (rules stored as recipes) | analyst | `derive`, `add_case_attribute` | M |
| F5 | Slice-key designer with owner registry and slice-size histogram | analyst, owner | `prioritize` (dry run), `estimate_gamma` | M |

### Norm and views
| ID | Feature | Persona | Library | Tier |
|---|---|---|---|---|
| F6 | Structured norm editor: constraints, layers, applicability, weights, versions with diff and status (draft / reviewed / approved) | analyst | `Norm`, `NormConstraint`, `validate`, `check`, `describe` | M |
| F7 | Expectation-to-constraint wizard (sentence → type → endpoints → scope → threshold → meaning → preview) | analyst, owner | constraint catalogue, primitives | M |
| F8 | Threshold calibrator on the empirical distribution (draggable ϑ and W, live share violated) | owner | `activation_lags`, `count`, `total`, recipes | M |
| F9 | Applicability matrix: constraints × flow types with case counts | analyst | applicability rules, `in_scope` | M |
| F10 | View workshop mode: layer sliders, radar, agreement matrix, top-k side by side | owner, sponsor | `View`, `layer_weight_table`, `view_agreement`, `top_k_overlap` | M |
| F25 | Template library with adapt wizard (P2P and ITSM first) | analyst | `Norm.load` | S |

### Scoring and prioritisation
| ID | Feature | Persona | Library | Tier |
|---|---|---|---|---|
| F11 | Scoring run with manifest (fingerprints, library version, parameters) and decomposition check | analyst | `score`, `summary`, `check_decomposition` | M |
| F12 | Backlog table with formula popover per row, view switcher, γ/exposure toggles | owner, analyst | `prioritize` | M |
| F13 | Concentration curve with 80/95 % markers | sponsor | `pareto`, `concentration` | M |
| F14 | Hotspot typology chart (reservoir / mechanism / severity), override with note | BB, owner | `hotspot_table` | M |
| F15 | Driver drill-down: slice → layers → constraints → cases → annotated trace | all | `layer_drivers`, `constraint_drivers`, `penalty_mass`, `worst_cases`, `trace` | M |
| F16 | Raw-distribution lens: slice vs rest | BB | `activation_lags`, `count`, recipes | M |
| F22 | Sensitivity sweep: rank stability under γ, thresholds, weights | analyst, auditor | loops over `score`/`prioritize` | S |
| F27 | Exposure-weighted priorities | finance owner | `prioritize(volume="exposure")` | S |
| F28 | Document/object roll-up | analyst | `prioritize(by=document)` | S |

### Validation and improvement loop
| ID | Feature | Persona | Library | Tier |
|---|---|---|---|---|
| F17 | Validation gate: status chips, reading, note, source-check task; no hypothesis without a reading | analyst, owner | `right_censored`, `left_truncated`, `gap_retained`, `validation_table` | M |
| F18 | Backlog review session mode: agree / dispute / defer with minutes | owner, analyst | `hotspot_table`, drivers | M |
| F19 | Action-hypothesis cards (A3-style) on a board; required owner, mechanism, evidence links, expected effect | BB, owner | links to F12–F17 | M |
| F20 | Period runs with fixed baseline; change table; re-baselining as a logged sponsor action | analyst, sponsor | `prioritize(baseline=)`, `compare_periods` | M |
| F21 | Governance pack export (HTML/DOCX/PDF + CSV/JSON) with run ids and method appendix | all | all tables | M |
| F23 | SPC over periods (p-chart of violation rate, XmR of slice mean) | BB | `compare_periods` series | S |
| F24 | Fishbone / 5-why workspace seeded from drivers | BB | `layer_drivers`, `constraint_drivers` | S |
| F26 | Owner portal (read-only, comments) | owner | — | S |
| F32 | Intervention-effect design checklist with comparison tables (never a headline effect) | BB | — | L |

### Assistant (local LLM)
| ID | Feature | Persona | Tier |
|---|---|---|---|
| F29a | Result narration and Q&A over results (numbers cited to tables) | all | M |
| F29b | Single-expectation constraint drafting (type, endpoints, scope, sentence; thresholds only from data candidates chosen by the user) | analyst, owner | M |
| F29c | Norm review over deterministic lint findings; action-hypothesis drafting; journey guidance; report drafting | all | S |

### Process knowledge (see `docs/panel/llm_knowledge_architecture.md`)
| ID | Feature | Persona | Tier |
|---|---|---|---|
| F33 | Activity canonicalisation: log labels mapped to a reference ontology with candidates, confidence and human confirmation; system label packs (SAP, Ariba, Coupa, Oracle, D365, MES) | analyst | M |
| F34 | Process knowledge base for P2P (BPIC 2019, hackathon purchase orders) and O2C (hackathon sales and stock data): ontology, stages, failure modes linked to constraint patterns, KPIs, glossary, playbooks, templates | all | M |
| F35 | Explanation paths and candidate hypotheses from the knowledge graph, with sources | analyst, BB, owner | S |
| F36 | Project document library with grounded, cited Q&A (hybrid retrieval, embedded index) | all | S |
| F37 | MCP server exposing the tool registry to external assistants | analyst | S |
| F38 | Credit-application, ITSM, permits/subsidies/expense-claims and production knowledge packs | all | S |
| F39 | MCP client connectors (wiki, document management, ticketing); cross-project memory of signatures and actions | admin, analyst | L |
| F40 | LoRA adapters for weak local models | — | research |
| F41 | Public log presets: one-click mapping, canonical activities and reference norm for the BPI Challenge and other public logs (`docs/DATASETS.md`) | analyst, trainer | M |

### Visualisation (see `docs/panel/visualisation_specialist.md`)
| ID | Feature | Persona | Tier |
|---|---|---|---|
| F42 | Process map with constraint overlays, abstraction sliders, semantic zoom between stages and activities (V1) | all | M |
| F43 | BPMN view of template or company model with violation heat, constraint arcs and scope hatching (V3) | owner, sponsor | M |
| F44 | Trace timeline with violated constraints annotated; multi-trace comparison (V5) | analyst | M |
| F45 | Distribution lens with draggable threshold and width; backlog and period charts (V9–V11) | analyst, BB | M |
| F46 | Diff map slice vs rest and period vs baseline on a stable layout (V2) | analyst, owner | S |
| F47 | Constraint authoring on the BPMN model: one task → presence/singularity, two tasks → lag/precedence, lane → applicability (V4) | analyst, owner | S |
| F48 | Variant strip, performance spectrum, dotted chart, stage funnel, small multiples (V6–V8, V13, V14) | analyst | S |
| F49 | Hand-off network with matrix alternative (V12) | analyst, owner | L |
| F50 | Case-flow animation for workshops; object-centric graphs; `@wise/flow` 1.0 on npm (V15, V16) | facilitator | L |

### Experience (see `docs/panel/ux_design_panel.md`, UX-1 to UX-30)
| ID | Feature | Persona | Tier |
|---|---|---|---|
| F51 | Context ribbon, journey rail with gate states, job tray, URL state (UX-1, UX-2, UX-22) | all | M |
| F52 | Explain-this-number popovers and reading sentences (UX-3, UX-4) | all | M |
| F53 | Decision pane with notes only for human decisions; linked highlighting; pin-and-compare (UX-5, UX-7, UX-8) | analyst, owner | M |
| F54 | Presenter mode for review sessions with dispositions and attendance (UX-9) | facilitator | M |
| F55 | Public-log onboarding with method cards, glossary, empty states with next best action (UX-10, UX-18, UX-21) | new analyst | M |
| F56 | Owner portal, command palette, norm diff as changelog, workshop kit, density and dark themes, report preview (UX-11 to UX-17) | owner, analyst | S |
| F57 | Usability rounds and design review checklist as release criteria (UX-27, UX-28) | — | M |

### Integrations
| ID | Feature | Tier |
|---|---|---|
| F30 | pm4py bridge (DFG/variants of a slice vs rest) | L |
| F31 | Object-centric case notions, multi-log comparison | L |

## 5. The elicitation flow (F7 + F8 + assistant)

"Invoices should be paid within terms":

1. Kind of expectation → constraint type (something must happen / must not /
   order / time between / how often / values agree).
2. Endpoints: fuzzy match against the activity inventory; synonyms become one
   merged label list; unknown labels cannot be saved.
3. Scope: applicability matrix over flow type / document type with counts.
4. Threshold: the calibrator shows the empirical distribution; "within terms"
   offers a fixed δ/Δ or a derived attribute `days_late = lag − payment_terms`
   scored by a `Metric`. The threshold is always a human drag.
5. Meaning: layer, within-layer weight, one-sentence rationale, owner.
6. Preview: share violated, correlated constraints (double counting), save as
   a new norm version.

The assistant may draft steps 1–3 and 5 and describe the distribution; it
never writes thresholds, widths or weights.

## 6. Process templates

Starting points, shipped with thresholds flagged "uncalibrated": purchase-to-
pay, order-to-cash, hire-to-retire, IT service management, healthcare
pathways, claims handling, manufacturing/MES, public-sector permits. Each
template holds typed constraints, slice keys, views and a pitfall list
(flow types, replicated header events, clock-stop rules, per-priority SLAs,
small slices that identify people). Details: `docs/panel/process_panel.md` §5.
Templates are one part of the curated process knowledge base (ontology,
stage model, failure-mode catalogue, KPIs, glossary, playbooks), which also
feeds activity canonicalisation and the assistant's process profile
(`docs/panel/llm_knowledge_architecture.md` §2).

## 7. Lean / Six Sigma connection

| Tool | The app draws | The Black Belt still does |
|---|---|---|
| Pareto | penalty mass by slice / vendor / resource / constraint with the 80 % cut | decides which categories are actionable units |
| SPC | per-period violation rates and slice means against a fixed baseline, user-set limits | Phase I periods, rational subgroups, special-cause interpretation |
| Fishbone / 5-why | bones seeded from realised layer and constraint drivers, linked to evidence | the 6M causes the log cannot see; interviews, gemba |
| Value stream | "norm-as-VSM" strip: expected steps with δ, observed medians per slice, rework loops | the real VSM, takt, process-cycle efficiency |
| Waste categories | each constraint tagged at elicitation; penalty mass per waste category | cost of poor quality |
| Measurement system analysis | the log's known defects per slice (replication, censoring, gap retained) | verification against source tables |

## 8. Trust rules

**Plain language first (owner decision, 2026-09-05).** Every screen leads
with three questions — where is it worst, why, what can we do — in plain
words; the method's terms (slice, constraint, layer, view, gap, PI,
hotspot type, stability, dominant layer) appear as muted secondary labels
with one-sentence definitions and a vocabulary switch. The translation
table in `docs/panel/guidance_and_insight_panel.md` §2 is normative; the
kinds of problem are called acute, systematic and widespread. No bare
column of decimals is the first element of a screen.

- Reproducibility: same log fingerprint + norm fingerprint + parameters →
  identical backlog.
- Traceability: every number opens one level down to cases and events.
- The formula per backlog row is visible in the table (n, μ̄, μ_s, γ, gap, PI).
- Support and stability shown per slice: n, `PI_lower`, gap retained,
  replicated share, sensitivity class.
- Stable PI is the headline; raw PI beside it; γ printed.
- Language rules in generated text: "priority", "expectation shortfall";
  never "root cause", "fault", "effect". Value constraints are commercial-risk
  indicators.
- Assistant per stage: drafts and explanations only; off by default in the
  owner portal; suggestions arrive as diffs or cards to accept.

## 9. Success metrics and risks

Metrics measured by the app: time from import to first approved norm
(target < 10 working days); share of constraints with an owner-calibrated
threshold (100 % before "approved"); share of focus slices validated before a
card exists (100 %); cards with owner, evidence and expected effect; time
from new extract to period report (< 2 days); rank stability of the top-10;
owner agreement rate; assistant acceptance and edit rates; norms reused
across periods and owners.

Main risks: norm engineering too heavy (wizard, templates, "10 constraints
first"); wrong case notion or flow-type rule (S2 gate, coverage counts);
replicated events inflating rework (diagnostics banner, S7 gate); false
precision (formula popover, `PI_lower`, stability badges); assistant
inventing labels or numbers (inventory-bound ids, table-cited numbers,
accept-only workflow); thresholds set by the analyst instead of the owner
(calibration note with owner name); fine slices identifying individuals
(`min_cases`, key aggregation); moving baselines (frozen, named baseline);
the tool degenerating into a dashboard (cards, dispositions and period runs
are first-class); local hardware limits (Parquet caching, incremental period
runs, LLM never on the critical path).
