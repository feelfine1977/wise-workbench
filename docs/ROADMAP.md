# WISE Workbench — delivery roadmap

Updated 10 September 2026. This is the current delivery order. It replaces the
phase/week schedule retained in [the initial roadmap](ROADMAP_INITIAL.md).
The [README](../README.md) states current capabilities and limitations;
[BACKLOG.md](BACKLOG.md) retains requirement identities and historical evidence.
A planned item below is not a shipped feature.

## Product outcome

Help a process owner turn a business objective into a reviewed improvement
roadmap: **goal → scoped evidence → finding → agreed action → follow-up**.
The output must explain what to do, who owns it, why it comes next and how its
outcome will be reviewed. WISE priority identifies analytical shortfalls; it
does not estimate benefit or prove that an intervention will work.

Keep two surfaces distinct: **Explore** for linked process analysis, and
**Improvement roadmap** for commitments. A later configurable dashboard can
display either surface without introducing another action store. The full
board design is in [GOAL_ROADMAP.md](GOAL_ROADMAP.md).

Explore starts with the observed process. A planned **WISE Support** switch
adds business expectations and explanations when requested; it starts off in
a new exploration. Time, cost, repetition and comparison remain independent
questions. Visibility changes preserve analytical context and do not enable
the optional actionability runtime. See [WISE_SUPPORT.md](WISE_SUPPORT.md).

## Delivery order

Effort is relative: S is a focused change, M crosses a feature boundary, and L
requires several reviewable slices. These are planning sizes, not elapsed-time
or compute-budget promises. Re-estimate each batch after its entry checks.

| Milestone | Deliverable | Entry condition | Exit evidence | Size |
|---|---|---|---|---|
| M0 — supported distribution | Clean, compatible core/renderer/application artifacts | Reviewed source and exact dependency inputs | Required jobs pass on the submitted commits, including Windows, strict visuals and installed application/knowledge wheels; renderer provenance matches clean source | S–M |
| M1 — bounded structural cleanup | A first cohesive engine/schema extraction, feature API clients, and one reusable renderer behavior moved to Flow | M0 | Existing HTTP shapes, query keys, filters, numerical results and default rendering remain unchanged; packaged integration passes | M–L |
| M2 — trustworthy decisions | Reliable norm calibration/approval, exact evidence scope, persistent findings, one action eligibility policy and visible failures | M1 bounded batch; owner walkthrough feedback incorporated | Public synthetic walkthrough passes from edit/save/reload/approve through filtered finding/action and refusal/recovery; classic full/minimal profiles remain supported | L, split into two checkpoints |
| M3 — goal/action board | Stable goals; existing actions as tickets; Board/List; goal/view lanes; ownership, review criteria and outcome-review state | M2 | One action can support two goals without duplication; keyboard movement, stale-edit refusal and reload work; historical evidence and legacy actions survive | M–L |
| M4 — usable improvement roadmap | Now/Next/Later, alternatives, effort, dependencies, manual capacity, follow-up measurement and frozen documentation | M3 | A feasible owner-selected sequence with reasons can be saved, reopened and exported; shared actions consume capacity once; completion and observed outcomes remain distinct | L, split planning from follow-up/export |
| M5 — presentation and wider use | Movable analytics dashboard, roadmap panel, PowerPoint, additional process packs, then supported team hosting | Relevant contracts below; no dependency on an LLM | Each feature has its own installable release, walkthrough and acceptance evidence | Separate batches |

M1 is deliberately bounded. Completing every renderer or engine refactor is
not a prerequisite for M2. Remaining structural debt returns to the backlog.
Do not combine extraction with new behavior, new defaults or redesigned charts.

## M1: first structural batch

- Extract one coherent engine responsibility behind the existing adapter
  facade. Split its schemas while retaining public imports and identical
  generated OpenAPI. Do not change scoring, caching or eligibility rules here.
- Group frontend API calls by feature: norms, review, flow, board and notebook.
  Use generated DTOs; preserve transport, query keys, filter serialization,
  errors and supported fallback behavior. Integrate after the backend contract
  is confirmed unchanged.
- Move one reusable fit/label behavior into `wise-flow`, retaining its current
  defaults. Check it in a standalone package consumer and in Workbench's Flow,
  Why and Board placements. Keep routes, data requests and tickets in Workbench.

Prepare the extractions independently, then integrate the backend facade,
frontend clients and tested renderer artifact in that order. Rendering parity
includes resize/full-window stability and selection across Map/Model switches.
New collision handling or lane-order changes are separate visual fixes with
reviewed baselines, not silent refactor changes.

## M2: two small checkpoints before a new board

**M2a — save and trust the decision.** Persist rationale, owner and decision
date on each calibrated expectation; send exclusions through the supported
not-applicable contract; preserve signer identity. Exercise both eligible
approval and refusal without losing input. Record the exact run, norm, view,
filter, grouping, flow definition, comparator and population behind a finding.
Persist the finding/disposition on the server before relying on it from a ticket.
Use one server-side policy for creation, ordinary updates and later board moves.
Unknown checks must not silently authorize a business intervention. Scoped
investigation and data-repair drafts remain possible with their limits visible.

The first action-boundary slice is available: [proposals and commitment
checks](ACTION_REVIEW.md). It records action evidence scope and refuses unsafe
commitment through both create and update. A supported filter subset now has
exact membership, selected-item readiness and decisions bound to that selection.
Broader filter grammar, findings/hypotheses propagation and the full M2a
walkthrough remain to be done.

**M2b — read the decision correctly.** Display a supported comparison or its
specific unavailable reason, qualify uncertainty and caveats, identify the
expectation each sentence describes, and show existing hypothesis test results.
Identify hypothetical runs on every entry path and keep them out of the default
measured-run selection. Give headroom its own denominator and assumptions;
do not call it realised benefit or require it to equal a relative score gap.
Address mutable-input cache risks on the affected evidence path as a separate
correctness change, with explicit invalidation tests.

The first release does not need a full what-if editor, a new credit dataset,
comprehensive activity reasoning or a dashboard builder. Those remain planned.
Software that stores an approval does not establish appropriate thresholds:
domain calibration and sign-off require the responsible people and suitable data.

## M3 and M4: commitments before optimisation

M3 covers GR-01, GR-04, GR-05 and the initial parts of GR-07/GR-09/GR-13.
GR-02/GR-03 are M2 prerequisites. Start with one project and four columns:
**Proposed → Agreed → Doing → Closed**, with completed and stopped work
distinguished. Group by primary goal, primary versioned WISE view, or neither.
An action retains one ID across all arrangements and secondary goal links.
Use compact cards and a detail panel, accessible Move to/Move up/down controls,
and a list for small screens. Drag and drop is an optional equivalent.

Agreed work already needs an owner, intended result and review criteria/date;
do not defer these until M4. Closed actions with no measured outcome stay
labelled as unconfirmed. A functioning card board is the M3 checkpoint, not
completion of the roadmap product.

M4 covers GR-06, GR-08 and the full follow-up part of GR-07. Record alternatives
and the chosen reason, effort assumptions, dependencies, manual capacity and
Now/Next/Later order. Detect dependency cycles; unknown capacity cannot silently
authorize Now. Reuse the notebook for frozen scope, images, notes and decisions.
Record beneficial, adverse, stopped and inconclusive outcomes. A changed rank
or a before/after association alone is not proof of improvement or causation.

## Independent tracks and later work

| Track | Next bounded step | Required boundary |
|---|---|---|
| Classic `wise-pm` | Maintain the public case API, arithmetic and reproducible package contract | No goal/ticket persistence or experimental branch merge |
| `wise-flow` | M1 extraction, then scoped label-collision, compact/stage-only fit, tooltip and Map/Model order work | Standalone consumer, strict visual review and preserved BPMN attribution; no project workflow |
| Process exploration and WISE Support | Stage Atlas boundary/density validation and WS-01–WS-05; first supported time question after M2 context correctness | Same population, native metrics and map state on/off; essential caveats and gates always apply; classic engine supported; prototype validation precedes production replacement |
| Optional actionability | First adopt bounded case evidence and compatible explanations through [ADR 0012](adr/0012-optional-actionability-extension.md) | Default off; separate prepared environment; available versus enabled capabilities; provenance; unchanged classic results |
| Extension hardening | Validate sensitivity comparator context before exposing sensitivity; reconcile capture/evaluation truncation before claiming complete evidence; resolve or exclude mixed-unit paths | Only capability-specific readiness; no mandatory live model or research expansion |
| Configurable analytics dashboard | Saved panel contract, server persistence, movement/resizing and data/chart choice | Existing canonical filters and reusable panels; does not require the actionability branch |
| Documentation and PowerPoint | Frozen notebook/roadmap revision to a deck with editable text, images, source context and notes | Same records and calculations as the application; no separate export truth |
| Additional process packs | Validate existing P2P/O2C interpretation, then budget credit/BPIC 2017 separately | Lifecycle/case-notion review first; supported measurements or explicit unavailable results |
| Team hosting and portfolio | Supported deployment, identity, project roles, backup/restore, then shared goals and cross-project views | An owner field is not authentication; follow [deployment/authentication plan](DEPLOYMENT_AUTH_PLAN.md) |

Optional enrichment does not block the classic board, configurable dashboard
or PowerPoint. A full scenario editor can follow M2's scenario-identification
fix; label the scenario baseline artifact and the numerical comparator separately.
Automatic optimisation, causal-effect claims, model quality studies and new
connectors are separately scoped work, not implied by the ticket board.

## Acceptance rules for every milestone

- Use public synthetic fixtures and packaged dependencies for required CI.
  Private/reference datasets are supplemental only when separately authorized;
  missing data or live-model skips cannot stand in for required product checks.
- Preserve unresolved facts: a comparison may be unavailable, a caveat may be
  qualitative, uncertainty may be uncomputed, and an action may be legitimately
  blocked. Tests assert the explanation, never demand a favourable outcome.
- Do not tune a norm to match a reference ranking. Compare declared populations,
  definitions and parameters; state unresolved differences rather than inventing
  an attribution. Do not remove valid expectations solely because all cases meet them.
- Measure performance on a declared fixture/environment, with cold and repeated
  timings distinguished. Measure layout in the supported viewports and placements.
- Use an agreed comprehension/keyboard protocol with actual participants before
  making usability claims. Design review is useful but is not participant evidence.
- End with a runnable build, migration/reload evidence, current start guide and
  a short owner walkthrough. Define the next batch only after reviewing failures
  and feedback; keep release readiness distinct from feature completeness.
