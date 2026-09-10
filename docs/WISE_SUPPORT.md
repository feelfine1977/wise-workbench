# WISE Support in process exploration

Status: planned, 10 September 2026. The control is a presentation feature for Explore; it is not yet a production capability. Delivery is tracked as WS-01–WS-05 in [BACKLOG.md](BACKLOG.md).

## Purpose

Let users explore the process on its own and turn on help interpreting it against explicit business expectations when useful. Comparison remains one optional question alongside time, cost, repetition, expectations and improvement investigation.

Use a visible **WISE Support** on/off switch near the question control. Explain it as “Show business expectations and explain deviations.” Start a new exploration with support off; preserve an explicit user choice in that exploration's saved state. Turning it on adds relevant guidance to the current question and selection without changing the process being inspected.

## What the switch changes

| State | Visible behaviour |
|---|---|
| Off | Process maps, phases, boundary connections, traces, raw time/cost/count measurements, filters and optional comparisons remain usable. Hide the added normative overlays, score attribution, priority annotations and suggested normative interpretations in Explore. |
| On, compatible results available | Show the relevant expectation, native-unit target and observation, supported deviation/contribution and links to evidence. Use one compact contextual area with detail on demand. |
| On, norm or compatible result missing | State what is missing and offer a separate explicit action to choose/create a norm or run an assessment. Do not invent a threshold, show an older run as current or silently start a job. |
| On, results loading or unavailable | Label that state and retain the observed process and measurements. A failed support query must not erase the map or reuse results for a different scope. |

The switch belongs to Explore and linked analysis panels. It does not hide the dedicated Norm editor, change what an explicitly opened scored report means, or turn the existing Guided audience mode on/off. A normative question selected while support is off keeps its selection and offers the switch rather than silently enabling it.

## Invariants

- Toggling changes no population, filter, case count, grouping, flow-type definition, norm revision, weights, run, numerical reference or stored result. It does not select a different question or require a comparison.
- Keep phase expansion, selected activity/event, trace position and map geometry. Adding guidance must not fit, pan, zoom or resize the map. Use a reserved region or an overlay that does not steal canvas width.
- Off does not mean the engine is uninstalled, that scores were deleted or that an analysis was never performed. On does not approve a norm or change a draft's review status.
- Missing-data, open-item, scenario-identity and measurement-limit messages remain visible when required to interpret raw values, regardless of support state. Permission, approval and action-eligibility rules always apply server-side.
- Render only results matching the current assessment context. Rapid scope changes cannot let a late response supply another population's interpretation. Reuse the existing scoped query contract and distinguish observed facts, score attribution, hypotheses and hypothetical benefit.
- Absolute unmet expectations remain distinct from relative priorities: all groups may miss expectations while none is worse than the current population. A score contribution does not establish a process cause.
- Store support visibility as presentation state, separate from score/cache identity. Saved exploration links and notebook captures retain that visibility along with immutable evidence context; turning it off later cannot remove a saved finding's evidence or rewrite an export.
- Basic support works with classic WISE. The separately planned `WISE_ACTIONABILITY=off|on` capability selection remains default off under [ADR 0012](adr/0012-optional-actionability-extension.md). The Explore switch cannot check out a branch, install packages, start a service, contact a model or grant access to optional capabilities.

## Delivery sequence

1. Review a bounded interaction prototype: on/off with the same cases, path, raw metrics and inspection state; explicit unavailable guidance for questions without an expectation.
2. Complete the dense-process and faithful-boundary contract before replacing the current renderer. Include at least 60 activities, long labels, real local loops, three-phase excursions, rare exits, open prefixes and timestamp ties. Fixture correctness alone is not geometry or usability validation.
3. After M2 scope and norm-result correctness, implement a first supported time question using classic results: observed interval/distribution, applicable lag expectation, qualifications and inspectable evidence. Treat activation/response matching as part of the measurement definition.
4. Reuse the same question/context contract for cost, repetition, absolute assessment, priority attribution and optional comparison. Add saved-state/notebook coverage before connecting findings to the goal board.
5. Adopt optional evidence capabilities separately after their own readiness and compatibility checks. They do not block basic WISE Support.

## Acceptance

These are proposed production tests, not already measured outcomes:

1. Mouse and keyboard toggle the labelled switch; its checked state is exposed, focus stays on the switch, and one concise announcement states the new state.
2. Off → on → off preserves canonical filters, case IDs, counts, native measurements, selection, expanded phases, trace occurrence, viewport and graph bounds. No scoring job or write request is emitted.
3. Raw analyses and comparisons work while support is off. Needed data/scenario warnings and server-side gate refusals remain visible and effective.
4. Missing norm, draft norm, absent/incompatible results, empty population, loading and error each give an accurate state without fabricating a finding or auto-running an analysis.
5. A delayed result for the previous scope is ignored. Ranking and attribution reference the same declared comparator where reconciliation is claimed.
6. Saved state and notebook/export retain the visibility flag and original evidence. A later visibility change does not alter historical findings.
7. Classic-only and extension-installed-but-off environments make no optional or network-model calls. On/off presentation leaves numerical outputs unchanged.
8. The owner can inspect a cross-phase return with either state and reach its exact evidence; hidden external activities never become invented local adjacency.
