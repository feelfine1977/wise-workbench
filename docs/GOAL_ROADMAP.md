# Goal-oriented improvement roadmap

Status: proposed for staged development, 2026-09-10. The goal registry, ticket board and planning controls described here are not implemented. Existing actions, hypotheses, findings, gates and notebook records are foundations to reuse.

## Purpose

Help an organisation turn its business objectives into an explicit, feasible sequence of improvement and handling decisions:

**Goal → scoped analysis → reviewed finding → alternatives → agreed action → follow-up measurement.**

The output is a roadmap whose actions have owners, reasons, dependencies and review criteria. WISE priority helps identify where to investigate. It does not establish an intervention's benefit, causal effectiveness, monetary return or an optimal portfolio.

This develops the action-board and period-review direction already described in [the customer journey](CUSTOMER_JOURNEY.md). The existing linked **Explore Board** remains the analysis surface. The **Improvement roadmap** is a project-level view of commitments, reachable from the project overview and *What can we do?*

## Goals, perspectives and tickets

| Concept | Meaning | Example, illustrative only |
|---|---|---|
| Company goal | An intended outcome with a stable identity, scope, accountable sponsor and review horizon; a metric/target when justified | Make invoice processing more reliable |
| WISE view | A named weighting of normative layers, within a particular norm version | Finance or Automation |
| Finding | A reviewed statement about the observed population, with its evidence and limitations | An eligible group has longer recorded clearing times |
| Action ticket | A distinct commitment to investigate, repair, change, pilot, monitor or deliberately defer something | Check whether payment-term mappings are correct |
| Outcome review | A separate record of what happened after the action and what can be concluded | Mapping corrected; business effect still unknown |

A goal can precede data ingestion and can use several views. Several goals may share one action. Renaming a goal, replacing a norm or changing a view must not change the goal's identity. Goal importance must never silently rewrite norm weights or analysis results.

Qualitative goals are valid. Missing measures, estimates or evidence remain explicitly unknown; they are not filled with invented targets or zeros. Before claiming measurable achievement, agree the measure, unit, population, baseline, desired direction, target or minimum worthwhile change, observation horizon and guardrails.

## Board arrangement

The initial board uses the existing action lifecycle:

| Column | Existing action status | Meaning |
|---|---|---|
| Proposed | proposed | A candidate next step; not yet an accepted commitment |
| Agreed | agreed | Ownership and the next step have been accepted under the transition policy |
| Doing | in_progress | Work has started |
| Closed | done or dropped | Work completed or deliberately stopped, visibly distinguished |

Columns describe progress. Swimlanes group the same cards by **primary goal** (the portfolio default) or **primary WISE view**. A focused single-goal view can omit redundant lanes; an ungrouped option remains available. Missing assignments have a visible unassigned lane.

Each ticket appears once in the active arrangement. It has one primary goal and, where useful, secondary goal/view links. Filtering by a secondary goal finds the same ticket; it does not create a copy. View grouping uses a versioned reference, not a bare display name. Goal or view reassignment is an explicit edit; changing grouping never changes the ticket's status, scope, scoring configuration or owner.

The card face shows a short action title, owner, next review date when set and at most one attention message. Put evidence, estimates, alternatives and history in details. Do not show raw IDs, hashes, priority formulas, miniature process maps or speculative savings on every card. Use one primary action per active surface.

Provide **Move to**, **Move up/down**, visible focus, announcements and recovery from failed saves; drag and drop is an optional equivalent. Compact screens use a status-grouped list rather than tiny cards. A transition failure stays visible at the control and leaves the card in its previous state.

Completed work is not achieved benefit. Closed tickets with pending follow-up carry **Outcome review due** and remain accessible through an outcome-review filter. Historical completed actions without an outcome keep **Outcome not recorded**. Stopped, unsuccessful, adverse and inconclusive outcomes are valid and remain in history.

## What a ticket preserves

Reuse the existing action ID, status, remedy and review records. Add structured relationships rather than copying their text into a second ticket store:

- A primary objective revision, secondary goal links and an explicit analytical-view binding where relevant.
- Action purpose: investigation, measurement/data repair, norm review, process intervention, monitoring or recorded disposition. Norm-review work uses the existing norm approval flow; moving a ticket cannot approve a norm.
- The accountable owner and accepted responsibility, distinguished from the author and from a suggested owner role.
- The proposed mechanism, chosen alternative and selection rationale. A competing remedy, bounded pilot, or monitor/do-nothing option may be enough; there is no requirement to create a ticket for every suggestion.
- Linked findings, hypotheses, relevant gate decisions and notebook evidence.
- The next decision/review date; a due date is a commitment, not a model-generated forecast.
- For planned commitments: effort/resource assumptions, dependencies, controllability, relevant risks and a success/reassessment plan. Unknown estimates are allowed in Proposed.

Evidence links preserve the exact run, norm revision, view, assessment unit, flow-type definition, grouping, canonical filter, observation window, comparator, measure/unit, support and limitations. Reuse immutable run artifacts rather than copying event data. Include the producing runtime/capabilities where available.

Selecting a new analytical filter changes the exploration preview, not existing tickets or their historical evidence. Ticket filters are separately labelled. A changed run or norm creates a new evidence revision; it does not rewrite the source of an earlier decision. Freeze a screenshot together with structured context and notes: the screenshot alone does not establish which cases were assessed.

## Readiness and transitions

Separate **evidence readiness** (what the observation supports) from **commitment readiness** (whether this activity can proceed). The application must provide one server-side eligibility policy to every write path, including existing action PATCH calls and board moves.

- Missing, pending or unavailable checks must not become an automatic approval.
- Allow explicitly unassessed ideas and investigation/repair drafts. A measurement repair can address a failed measurement check; it cannot use that exception to authorise an unrelated business intervention.
- Before agreement or execution, review scope-matched evidence or a documented exception, accepted ownership, relevant dependencies and the intended review. Record exceptions with their reason, author, scope and review trigger.
- A gate waiver remains a waiver. It does not establish causality, complete missing data or validate a mechanism.
- Recheck eligibility after material scope/evidence changes. Manual order or a drag gesture cannot override the policy.
- Refused writes are atomic, explain the blocking condition and preserve user input. Use optimistic revisions to detect stale edits.

Two implementation prerequisites were found in the current source: review/gate calls do not consistently carry the analytical filter/view, and generic action updates do not apply the same eligibility checks as creation. Correct these before advertising a roadmap built from filtered evidence. If a scope cannot be evaluated, show that limitation rather than substituting a wider population.

## From tickets to a roadmap

The first planning view uses **Now / Next / Later**, with explicit owner-selected order. It is another projection of the same actions, not another workflow status or store:

- **Now:** selected work with an accountable owner, known prerequisites and allocated capacity.
- **Next:** candidates whose prerequisites or capacity are not yet available.
- **Later:** deferred work with a reason and, where useful, a reconsideration date.

Start with one project and a small manual capacity budget per owner/team and planning period. A shared action consumes capacity once even if it supports multiple goals. Detect dependency cycles and missing prerequisites. Allow useful work to be prioritised for obligations, urgency, risk reduction or learning value even when financial effect is unknown.

Keep descriptive shortfall, hypothetical headroom, predicted operational effect and observed outcome separate. Do not add PI across tickets, overlapping slices or views; do not compute a universal action score by multiplying PI by confidence or dividing it by effort. Owner overrides retain reasons. Contradictory goals show the expected direction of trade-offs and their uncertainty.

Suggestions may identify missing checks or candidate countermeasures from the knowledge hub. People choose and accept commitments. Portfolio optimisation, automatic execution and causal recommendations require separate decision models and evidence; none is promised by this board.

## Follow-up and documentation

Store work completion separately from the outcome review. Record the baseline and follow-up populations/windows, metric/unit, measurement definition, observed change, guardrails, costs when known, limitations and a conclusion that may be inconclusive. A before/after association alone is not proof of an intervention effect.

Keep legitimate flow types and case notions distinct. Changed flow mix, norm thresholds, eligibility or comparator can move a rank without process improvement. Review comparability explicitly; start a new series when necessary. A frozen run artifact and a fixed numeric comparator are different choices.

Notebook exports should include the goal, chosen sequence, action owners, evidence sources, assumptions, deferrals and review results. A later dashboard-builder panel can show this same roadmap; later PowerPoint export uses the frozen narrative. No second action list or export-specific calculation should be introduced.

## Repository and capability boundaries

| Layer | Responsibility |
|---|---|
| Workbench | Objective registry, action lifecycle, roadmap membership/order, transition policy, persistence, notebook/export and UI |
| Classic wise-pm | Existing scoring, priorities and diagnostics; no company ticket storage |
| Optional actionability branch | Typed evidence, compatible comparator explanations, sensitivity/object-centric evidence where supported |
| wise-flow | Process/BPMN rendering, selection and evidence navigation; no business-goal or ticket workflow |
| Knowledge / analytics packages | Reusable candidate guidance and measurements, not autonomous commitments |

The basic workflow must work offline on the classic library, including the minimal application profile: unavailable analytics are labelled, not fabricated. No LLM is required.

Optional integration follows [ADR 0012](adr/0012-optional-actionability-extension.md): default **off**, explicit enablement in a separately prepared environment, available versus enabled capabilities, and labelled run/export provenance. There is no automatic branch checkout, dependency installation or model contact on a board click. The runtime selection itself remains planned.

The initial delivery retains the local application boundary. An owner field is not authentication. Shared organisational hosting and cross-project portfolios require the separate [authentication/deployment work](DEPLOYMENT_AUTH_PLAN.md); an audit trail does not supply permissions.

## Implementation sequence and acceptance

The items below are tracked as GR-01–GR-13 in [BACKLOG.md](BACKLOG.md#b5-goal-oriented-improvement-roadmap). They follow the current CI repairs and backend/frontend contract cleanup, without mixing behavioral changes into those extractions.

1. **Trust prerequisites:** norm calibration persistence/signing, visible refusal messages, scope-matched review/gates and one transition policy. Pin filtered-population and update-path tests.
2. **Classic board:** stable goals, existing-action links, compact Board/List, goal/view grouping, transactional order/status edits, explicit outcome-review state and saved context. Preserve legacy actions through migration.
3. **Usable roadmap:** alternatives, effort/dependencies, manual capacity and Now/Next/Later, success/review criteria, structured notebook/export. This completes the first planning workflow; a board alone does not complete it.
4. **Optional enrichment:** capability integration and typed evidence/comparator views, independently tested with classic off/full/minimal profiles.
5. **Later:** reusable dashboard panel, PowerPoint, cross-project portfolio, team roles and external ticket synchronisation. Automatic optimisation is a separate research proposal.

Acceptance scenarios, not yet executed:

- A goal survives rename and norm replacement with its original identity and decision history.
- One action linked to two goals appears and consumes capacity once. All groupings retain its identity.
- A filtered process selection becomes a ticket whose findings, checks and denominators match that exact scope; a broader fallback cannot be called validated.
- Both board moves and ordinary updates refuse the same ineligible transition. Draft repair work remains possible without granting intervention readiness.
- Keyboard-only movement, undo, reload and conflicting edits preserve status/order or visibly explain refusal.
- Changing exploration filters, view or run leaves saved ticket evidence and manual order unchanged.
- Now cannot hide missing capacity/prerequisites; a dependency cycle produces a clear explanation.
- Closed work with no measured benefit remains unconfirmed; adverse or inconclusive outcomes can be recorded.
- Classic-only and extension-present-but-off need no optional calls, service or model. Missing analytics remain unavailable.
- Freeze/export preserves context, notes and roadmap revision; cross-project references are rejected.
- In a later owner walkthrough, readers can identify the goal, next action, owner and blocker without method knowledge, and distinguish implementation completion from demonstrated improvement.

## Background

The Kanban Guide calls for explicit workflow policies, work-in-progress control and review of work-item flow. This informs the capacity and transition requirements; the proposed board is only an initial implementation slice, not a claim of a complete Kanban system. See [The Kanban Guide, May 2025](https://kanbanguides.org/the-kanban-guide/2025.5/).

Connecting process measurements to operational decisions is also reflected in Celonis' documented external enrichment/operational use cases. That supports the direction, not the proposed WISE data model or any promise of equivalent automation. See [Knowledge Model API use cases](https://developer.celonis.com/process-intelligence-apis/knowledge-model-api/use-cases).
