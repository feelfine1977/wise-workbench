# WISE Workbench — Interactive flow visualisation: benchmark, interaction model and requirements

*Report of a three-person panel: a process-mining tool specialist
(Celonis, Fluxicon Disco, Apromore, ProM, SAP Signavio Process
Intelligence, UiPath Process Mining, Minit/Microsoft, QPR, mpmX, Mehrwerk,
pm4py), a process-mining researcher (bottleneck and queue analysis,
rework and loop detection, batching, performance spectrum, determinism
of system-generated events, trace clustering, sub-process abstraction)
and an interaction designer for analytical graphics. Date: 2026-09-06.
Inputs: `visualisation_specialist.md`, `ux_design_panel.md`,
`guidance_and_insight_panel.md` §2 (plain-language layer),
`docs/CUSTOMER_JOURNEY.md` (stages, §8 vocabulary), `docs/ARCHITECTURE.md`
(API, FlowGraph), `wise-flow/docs/API.md` and `README.md` (the flow
library 0.1 as it is), `wise-lib/README.md` (the method), the backend's
`GET /runs/{runId}/flow` and `adapters/engine/flow.py`, the development notes
and `docs/BACKLOG.md` B2. Vendor claims were checked on the pages listed
in §9 on 2026-09-06; where a vendor page could not be read (Celonis'
current documentation requires a login, SAP's help portal renders by
script), the table says so and the claim rests on a public mirror or on
the indexed page text.*

## 0. Summary

The benchmarked tools share one interaction grammar: a directly-follows
map with two sliders, a click that filters (with / without / starts with /
ends with / with this connection), a filter panel whose clauses combine by
AND, a throughput-time metric on edges, and — in the newer products — a
list of "inefficiencies" (bottlenecks, rework, low automation) computed
from inter-event gaps. What they do not have is an expectation. Every
colour on their maps is frequency or elapsed time; the analyst supplies
the judgement "this is too slow" in her head. WISE inverts this: the norm
says what was expected, the map shows where and how often the expectation
is missed, and the slice — not the variant — is the unit of comparison.

This report keeps the parts of the vendors' grammar that work (click to
filter, filter chips with case counts, incoming and outgoing lists, process
cropping, rework filters, the performance spectrum) and adds what the
method needs: expectation overlays as the primary channel, filters that
scope the map, the backlog and the analytics together and live in the
URL, a first-class sub-log for "analyse only this part of the process",
and reasoning panels for an activity, a stage and an edge whose every
number carries a formula, a sample size and a caveat, in descriptive
language. 53 requirements (RF-01 to RF-53) are in §7 with acceptance
criteria and a cycle each; the ten that matter most are RF-01, RF-04,
RF-09, RF-10, RF-12, RF-13, RF-24, RF-26, RF-29 and RF-39.

## 1. Benchmark

Verified on 2026-09-06 unless marked. "Not verified today" means the
statement comes from the specialist's working knowledge of the product,
not from a page read for this report.

### 1.1 Interaction on the map

| Tool | Click on an activity | Click on an edge | Gateway or group | Sub-process, partial process |
|---|---|---|---|---|
| **Celonis** (Process Explorer, Variant Explorer, Case Explorer; Analyses are in maintenance since 2025-08-01, Studio Views carry the same components) | Activity Details panel with the selections *With this activity*, *Without this activity*, *Starting with this activity*, *Ending with this activity*, plus the preceding and succeeding activities with case frequencies [C1, C2] | Connection Details with *With this connection* / *Without this connection* and the case frequency of the transition [C1]; *Calculate throughput time* between two chosen events opens a histogram of the edge's throughput time to drag-select a range [C3, indexed text only] | No gateways in the DFG; the Conformance Checker compares variants to a target model and lists deviations [C5] | No cutout on the map; partial analysis is done by *Starting with* / *Ending with* selections and by PQL in the analysis; the multi-object Process Explorer follows relations between object types [C6] |
| **Fluxicon Disco** | Popover with all metrics of the activity (absolute and case frequency, max repetitions, total / median / mean / max duration); *quick filter shortcuts to filter cases that contain a specific activity or path right from the map* [D1, D2] | Same popover for a path; quick filter on the path [D1] | None (pure DFG); Cases view shows variants | *Endpoints* filter with *Trim longest* / *Trim first* cuts cases to a boundary activity; *Timeframe* → *Trim to timeframe* cuts events outside the window [D3] |
| **Apromore** (Process Discoverer) | Double-click shows the activities that directly follow and directly precede the selected activity with metrics [A2]; retain / remove is done through the log filters | Arc metrics on hover; filter through the Path and Between filters | BPMN view with a *Parallelism* slider discovers AND/OR gateways; a *backbone* (auto or user-defined) aligns the most frequent activities on one line [A2] | *Between* filter (events between a source and a target occurrence), i.e. process cropping [A1] |
| **SAP Signavio Process Intelligence** (investigations of widgets) | Select one or more activities or a connector, then *Filter widget* / *Filter chapter* / *Filter investigation* [S1, indexed text]; nodes show *Event Count*, *Case Count*; connectors *Cycle Time* [S2] | Connector selection creates the same three-level filter [S1] | Process Conformance widget lists deviations against a BPMN model [S3, page title only] | Activity Slider and Sequence Flow Slider add activities and connections [S2]; chapters scope filters to a part of the investigation rather than of the process |
| **UiPath Process Mining** | Right-click context menu: *Filter options*, *Export*, *Full-screen mode*, send to Automation Hub; hover hints show throughput time and highlight connections [U2] | Same context menu; edge metric selector (case frequency, average / median throughput time) [U2] | None in the DFG; conformance dashboard in the Process Optimization app [U3] | *Process cropping filter* between a start and an end activity; throughput time between selected activities [U1] |
| **pm4py** (library) | No UI; `filter_start_activities`, `filter_end_activities`, `filter_event_attribute_values`, `filter_directly_follows_relation`, `filter_eventually_follows_relation` [P1] | `discover_performance_dfg` gives mean / median / max per edge [P1] | Inductive miner → BPMN (`discover_bpmn_inductive`) [P1] | `filter_between` (not verified today), `filter_time_range` [P1] |
| ProM, Minit/Microsoft Process Advisor, QPR ProcessAnalyzer, mpmX, Mehrwerk (not verified today) | Minit and QPR: click → filter with / without, path lists; mpmX (Qlik) and Mehrwerk (Qlik): selection propagates through Qlik's associative filter; ProM: plug-in dependent, mostly static views | Edge click → duration statistics (Minit, QPR); Qlik selections | ProM: Petri nets, alignments; Minit: BPMN export | Minit *process trimming*, QPR *process cut* (both not verified today) |
| **WISE Workbench** (this report) | Actions menu: filter to / exclude cases / exclude the event, incoming and outgoing lists with counts, medians and violation shares, activity profile, distribution lens of the constraints that touch it, add a constraint here, pin, worst cases through it, set as sub-process boundary (§2) | Edge profile with lag distribution, share of cases, spectrum, lag-constraint violations, batching signature (§5) | Stage groups are first-class nodes with a stage profile; BPMN gateways map back to activities (flow 0.2) | *Analyse only this part* → a sub-log with re-derived case table and the constraints whose endpoints lie inside (§3.4) |

### 1.2 Filters, readings, strengths and pitfalls

| Tool | Filters | Bottlenecks, rework, loops, automation | Good | Misleads |
|---|---|---|---|---|
| **Celonis** | Process flow selections above; PQL filters on any case or activity attribute; throughput-time filter between two events [C1, C3]; Variant Explorer selects variants by coverage [C4] | Throughput Time (median / average / trimmed mean) on edges as the KPI; *Reverse activity size* for KPIs that should be low, e.g. a rework rate [C7]; custom KPIs (PQL) for automation rate per activity; inefficiency claims come from throughput time | PQL is complete; the throughput-time histogram before filtering; five map KPIs with trimmed mean | The map default is the *baseline graph* (most frequent variant), so infrequent but expensive paths are invisible until the sliders move; edge colour scales are not shown as a legend; "throughput time" on an edge is an inter-event gap, not a queue time |
| **Disco** | Timeframe (*Contained in*, *Intersecting*, *Started in*, *Completed in*, *Trim to timeframe*), Variation (variant frequency bounds), Performance (case duration, events per case, case utilisation, total / mean / max active and waiting time), Endpoints (*Discard cases*, *Trim longest*, *Trim first*), Attribute (*Keep selected*, *Mandatory*, *Forbidden*), Follower (*Eventually* / *Directly followed*, *Never* variants, 4-eyes same / different value, time between) [D3] | Performance metrics on the map (total / median / mean / max duration) with colour; *max repetitions* frequency metric shows loops; no automation notion | The cleanest filter set in the field; filters compose in sequence with coverage feedback; trim operations are explicit | Filters are applied in sequence, so their order matters and a viewer of the map does not see the stack; "waiting time" needs lifecycle start / complete pairs, otherwise it is an inter-event gap; the animation is persuasive but not evidence |
| **Apromore** | Case filters: attribute, case variant, case id, timeframe (*contained in*, *active in*, *start in*, *end in*), performance (case duration, case length, processing time, waiting time, case utilisation, *Node duration*, *Arc duration*, percentile), path (*Eventually follows* with temporal bounds), rework (self-loops, ping-pong, indirect repetition), blocks (AND/OR); event filters: attribute, timeframe, frequency, performance, path (directly-follows / precedes), between [A1] | Duration perspectives with processing and waiting times; *Rework* metrics (total rework, rework duration, rework cost); cost with role tables; simulation from the log [A2] | Rework filter names the three loop shapes; percentile performance filter; explicit AND/OR blocks; node and arc durations as filters | "Processing time" and "waiting time" appear even without lifecycle transitions (then they are gap-based); cost figures need role tables that rarely exist; three sliders plus a perspective dropdown hide their combined effect |
| **Signavio** | Widget / chapter / investigation filters from selections [S1]; filter types page exists on the SAP help portal but could not be read today [S4]; SIGNAL queries over case and event attributes [S5] | Cycle time on connectors; Process Conformance widget; automation is a modelled attribute, not a discovered one | Three-level filter scope is a good idea: the reader sees which chapter's filter applies; investigations as narrated chapters | Widget-level filters make two widgets on one page silently disagree; cycle time on a connector is again an inter-event gap; nothing on the map states the filter it is drawn under |
| **UiPath** | Activity, Directly follows, Indirectly follows, Starts with / Ends with, Rework, Process cropping, Timeframe (a fixed filter that splits by a date field), list / combo / range selectors; all filters AND; filter panel shows counts [U1] | *Process inefficiencies* panel: bottlenecks (highest throughput time activities), manual processing delays, low automation rates, rework loops; a filter icon on an insight card applies the matching filter; automation rate = share of events with the *automated* field true; automation-potential simulation (what if an activity were automated) [U2, U4, U5] | The inefficiency card → filter round trip is the closest thing to a reasoning panel; automation rate is honestly defined from a field | "Bottleneck = highest throughput time" is a ranking of gaps, not a queue reading; the 1,000-edge cap and the *Variants* slider default hide paths without saying which; the automation simulation reports savings as if the gap were idle time |
| **pm4py** | `filter_variants`, `filter_trace_attribute_values`, `filter_case_performance`, `filter_time_range`, `filter_activities_rework` (not verified today) [P1] | Performance DFG; dotted chart and performance spectrum visualisers (`view_performance_spectrum`, not verified today) | Every filter is a function: reproducible and scriptable; the sub-log is an object | No UI; every visual defaults to Graphviz with no legend |
| ProM, Minit, QPR, mpmX, Mehrwerk (not verified today) | Minit and QPR: activity, path, attribute, duration, rework filters; Qlik-based tools: associative selection over any field | QPR: *Process Cut* and root-cause style attribute ranking; Minit: bottleneck by duration; mpmX: SAP-oriented KPIs | Qlik-based tools show filter state everywhere (the selection bar) | Ranked "root causes" from attribute correlations are presented as causes |

### 1.3 The WISE Workbench column, written out

| Aspect | Benchmarked tools | WISE Workbench |
|---|---|---|
| Primary overlay | frequency and inter-event time | the norm's expectations: violation share per constraint on the activity, edge or group that the constraint touches; frequency as width, expectation as colour; `defaultStyle` in `@wise/flow` already colours by `violationShare` |
| Unit of comparison | the variant, the filtered log | the slice (group of cases sharing a key value) against the rest and against a baseline period; `diff()` and `layoutUnion()` keep positions stable |
| Scope | a filter selects cases; all metrics recompute on them | a filter selects cases; applicability then says, per constraint, which of those cases are counted (`in_scope`); the map shows both numbers and hatches the activities that are outside a constraint's scope |
| Layers and views | none | overlays carry the layer (colour family) and the view (which constraints count and how much); switching the view re-weights the map without re-scoring the cases |
| "Bad" | slow, frequent, rework | missed expectation, with the threshold ϑ and width W that define it printed next to the number |
| Bottleneck | highest throughput time | a descriptive reading: share of the elapsed case time spent in the gap before this activity, its rank, the queue-length proxy over time, and the lag constraints that end here with their violation share |
| Sub-process | cropping the map | a sub-log artefact with its own case table, the constraints whose endpoints are inside, its own run, and provenance to the parent |
| Automation | a boolean field | determinism signals (timestamp regularity, resource type, transition entropy, calendar pattern, exact-lag spikes) with thresholds printed, read as *rule-like* or *discretionary*, never as "automated" unless the field exists |
| Language | "bottleneck", "root cause", "inefficiency" | descriptive: "coincides with", "is missed in n of m cases", "reads as", "candidate for a source-system check" |

## 2. Interaction model for the flow map

Conventions: single click selects and opens the element's card in the
right-hand pane; the actions menu opens with a right click, the `≡`
button on the card, or `Enter` on the focused element; every action has a
menu entry with an accelerator letter and a keyboard route. The map
already supports arrow keys, `Enter` / `Space`, `Escape`, `Home` / `End`
and `aria-activedescendant` (flow 0.1); everything below extends that
model, never replaces it.

### 2.1 Actions per element type

| Element | Hover | Click | Actions menu (accelerator) | Where it leads |
|---|---|---|---|---|
| **Activity** | tooltip: label, stage, cases (share), events per case, median gap before, the worst constraint touching it with its violation share; incoming and outgoing edges highlighted | selects; card shows the activity profile summary (§4) | *Filter to cases with this activity* (`f`) · *Exclude cases with this activity* (`x`) · *Exclude the event, keep the cases* (`e`, abstraction: the event is removed from the map and the sub-log, the case table is re-derived) · *Paths in / out* (`i` / `o`) · *Open profile* (`Enter`) · *Distribution lens* of a touching constraint (`d`, submenu per constraint) · *Add expectation here* (`c`: presence, singularity, exclusion; with a second selected activity: lag, precedence) · *Pin for comparison* (`p`) · *Worst cases through here* (`w`) · *Set as sub-process boundary* (`b`: start / end / include) | filter → URL filter chip and recomputed map, backlog, analytics; profile → right pane; lens → distribution lens with the current filter; add expectation → norm editor pre-filled; pin → comparison strip; worst cases → case list sorted by score with the trace timeline; boundary → sub-log builder |
| **Stage group** | tooltip: cases entering, median time in stage, loop-back share | selects; card shows the stage profile (§5.1) | *Collapse / expand* (`z`) · *Filter to cases entering this stage* (`f`) · *Exclude cases entering* (`x`) · *Paths in / out* between stages (`i` / `o`) · *Analyse only this stage* (`b`, sub-log from the stage) · *Pin* (`p`) · *Worst cases in this stage* (`w`) | as above; collapse uses `collapseGroups` and keeps positions |
| **Follows edge** | tooltip: count, cases (share), median and p90 lag, lag constraints on it with violation share | selects; card shows the edge profile (§5.2) | *Filter to cases with this connection* (`f`) · *Exclude cases with this connection* (`x`) · *Path analysis A → B* (`Enter`) · *Performance spectrum* (`s`) · *Add lag / precedence expectation* (`c`) · *Pin* (`p`) · *Worst cases on this connection* (`w`) | path analysis pane; spectrum component (flow 0.3) |
| **Gateway** (BPMN view, flow 0.2) | tooltip: mapped activities and branch shares | selects the mapped activities as a multi-selection | the activity actions applied to the set: *Filter to cases through any / all* · *Compare branches* (each outgoing branch as a pinned scene) | comparison strip |
| **Self-loop** overlay | tooltip: repeat share, cases with ≥ 2, ≥ 3 executions, singularity constraint if any | selects the activity with the repetition tab open | *Filter to cases with repeats* (`f`: count ≥ k, k editable) · *Exclude repeats* (`x`) · *Distribution lens of the count* (`d`) · *Add singularity expectation* (`c`) | repetition tab (§4, block R) |
| **Start / end** event | tooltip: cases starting / ending here, open cases at the window edge | selects | *Filter to cases starting with …* / *ending with …* (`f`) · *Exclude* (`x`) · *Only closed cases* (`k`) · *Censoring reading* (`Enter`) | censoring block (§4, block C) |
| **Constraint arc / badge / chip** | tooltip: constraint sentence in plain language, layer, cases in scope, violation share, threshold and width | selects the constraint; endpoints highlighted | *Distribution lens* (`d`) · *Filter to violating cases* (`f`) · *Filter to cases in scope* (`k`) · *Exclude violating cases* (`x`) · *Worst cases for this expectation* (`w`) · *Edit expectation* (`c`, opens the norm editor at this constraint) · *Hide this layer* (`h`) | lens with the filter; norm editor (a new version, with a note) |
| **Legend entry** (layer, constraint type, scale) | tooltip: what the encoding means, the scale's domain | toggles the overlays of that layer or type | *Show only this layer* · *Filter to cases violating any expectation of this layer* (`f`) · *Sort side list by this metric* | map re-render; filter chip "layer = timeliness, violating" |

### 2.2 Multi-select

Shift-click or `Shift + arrow` extends the selection. Two activities open
the pair actions; more than two open the set actions.

| Selection | Actions | Result |
|---|---|---|
| two activities A, B | *Path analysis A → B* (direct and eventual, with the share of cases where B precedes A), *Lag between A and B* (distribution lens on `first_after` lags), *Performance spectrum A → B*, *Add lag expectation A → B within ϑ (W)* with the lens to drag ϑ, *Add precedence A before B*, *Analyse only A … B* (sub-log between the first A and the first B at or after it) | path pane; lens; spectrum; norm editor; sub-log builder |
| a set of activities | *Filter to cases containing all / any*, *Exclude*, *Analyse only these activities* (sub-log by activity set), *Collapse into a temporary group* (local abstraction, not saved), *Pin the set* | filter chips; sub-log builder |
| an activity and a stage | *Paths from the activity into the stage*, *Lag activity → first event of the stage* | path pane |
| two pinned scenes | *Diff* (`diff(a, b)` on the union layout), *Swap*, *Hold to see the other* | diff map with the diverging scale |

### 2.3 Context menu contents

In this order, with dividers: identity (label, stage, plain-language
sentence of the worst expectation touching it) · *Filter* group (to / exclude
/ exclude event / only closed) · *Explore* group (profile, paths in / out,
worst cases, distribution lens submenu) · *Compare* group (pin, diff with
pinned) · *Author* group (add expectation, set as boundary, analyse only
this part) · *Export* (copy numbers as a table, SVG of the highlighted
neighbourhood). Guided mode shows identity, *Explore* and *Compare* only.

### 2.4 Keyboard

Must work without a mouse: focus moves with arrows between nodes and with
`Alt + arrow` along edges (the focused element becomes the edge, then the
next node); `Tab` cycles map → legend → filter bar → side list → card;
`Enter` opens the actions menu of the focused element, `Escape` closes it;
accelerator letters inside the menu; `Shift + arrow` extends the
selection; `/` focuses the filter bar; `?` opens the keyboard map. Every
action announces its result ("Filter added: cases with Record Invoice
Receipt — 237,236 of 251,734 cases remain") through a live region. The
table alternative (`<TableAlternative/>`) lists the same actions per row.
The letters `p` (pin) and `f` (filter) follow the table shell of
`ux_design_panel.md` §4; because the table shell uses `f` for "finding",
the map's `f` means filter and "create finding" stays on the card button
only.

## 3. Filtering model

One filter store per screen group (map, backlog, analytics, cases),
serialised in the URL as `f=<url-encoded JSON>` with a short hash `fh=`
for share links; the backend echoes the canonical form in every
response's `meta.filter` and the screen prints it as chips. A chip shows
its clause in plain words and its effect: cases kept, cases removed by
this clause alone (marginal) and cumulatively.

### 3.1 Filter kinds

| Kind | Clause | Semantics (case-level unless stated) | Interaction with the norm |
|---|---|---|---|
| Time window | `window: {from, to, mode}` with mode ∈ `case_start`, `case_end`, `active` (first event ≤ to and last event ≥ from), `events_inside` | the first three keep whole cases; `events_inside` trims events outside the window and is flagged "changes cases" because counts, lags and presence change | `events_inside` re-derives the case table; presence and lag constraints are re-evaluated on the trimmed cases and the censoring diagnostics are recomputed at the new edges |
| Case attribute | `attr: {name, op, values}` with op ∈ `in`, `not_in`, `range`, `missing` | on `EventLog.cases` columns, including derived attributes from the norm's recipes and the flow type | applicability rules read the same attributes, so a filter on `flow_type` interacts with `applicability`: the chip shows, per constraint, cases in scope after the filter |
| Slice | `slice: {slicing, key}` | the backlog row's cases; a slice filter is an attribute filter with the slicing's columns | identical to the slice detail's scope; the map under a slice filter is the slice's map |
| Activity-based | `act: {op, a, b?, mode?}` with op ∈ `contains`, `not_contains`, `starts_with`, `ends_with`, `follows` (mode `direct` / `eventual`), `never_follows`, `count_ge` (k) | `contains` = `count(a) ≥ 1`; `follows eventual` = first `b` at or after the first `a` exists (the same rule `Lag` uses); `direct` = at least one direct transition a → b | `count_ge` mirrors singularity; `follows` mirrors precedence; the chip offers "add as expectation" |
| Performance | `perf: {metric, op, value}` with metric ∈ `case_duration`, `events_per_case`, `lag(a, b, mode)`, `gap_before(a)` | durations in the log's unit, shown in days or hours | a lag filter reuses the constraint's measurement rule so that "cases where GR → INV > 10 d" and the constraint's violators are the same set when ϑ = 10 d |
| Rework | `rework: {a, op}` with op ∈ `self_loop` (a → a direct), `repeat_ge` (count ≥ k), `ping_pong` (a → b → a), `loop_through` (a … a with ≥ 1 event between) | case-level | mirrors singularity constraints; the replication diagnostic is shown on the chip when `event_replication` flags a |
| Open / closed | `closure: open / closed / all` | closed = the case's last observed event is a norm end activity or a configured end label; open = otherwise, at the window's right edge (`right_censored`) | lag constraints on open cases are censored; the chip warns "open cases understate lags" and the validation gate `censoring` reads the same numbers |
| Flow type | `attr` on `flow_type` with a fixed chip | as attribute | as attribute; applicability by flow type is the common case |
| Constraint-based | `viol: {constraint, state}` with state ∈ `violating`, `satisfied`, `in_scope`, `out_of_scope` | from `ScoreResult.violations` and `in_scope` | native to the method; the legend and arcs create these clauses |

### 3.2 Composition and effect

- Clauses combine by AND; the value list of one clause is OR; an explicit
  `any: [clause, clause]` group gives OR between clauses. No sequence
  semantics: the result is the same in any order, and the chips can be
  removed individually.
- The filter bar shows `N_total`, `N_in` and `N_out`, then per chip the
  marginal removal (cases that only this chip removes) so that redundant
  chips are visible; the backend returns these from one pass over
  `cases.parquet` in DuckDB.
- Applicability is never changed by a filter. Every constraint's card
  shows three numbers under the current filter: cases in the filter,
  cases in scope, cases violating; the map hatches an activity for a
  constraint when its in-scope share among the filtered cases is below
  the `outOfScopeMinShare` (1 %) that the overlay grammar already uses.
- The norm's scope (its end-activity list, its applicability rules) is
  printed under the filter bar as the "reading frame" so that a map is
  never read without knowing which cases the norm was meant for.
- The filter is part of the query key of every screen; the backlog is
  recomputed on the filtered frame with the existing ad-hoc recompute
  (`prioritize` on the cached frame), so ranks under a filter carry a
  chip "ranked within the filter, γ = …".
- Screenshots and SVG exports carry the filter chips as a caption line;
  a map without its filter caption cannot be exported.

### 3.3 Filters that change cases

`events_inside`, *exclude the event* and the sub-log boundary change the
content of cases rather than their selection. They are shown as a second
chip colour ("changes cases"), they force a re-derived case table (a job
with provenance), and they are refused when the norm's scoring mode
needs an activity that the change removes (the norm editor reports it
through `Norm.check`).

### 3.4 "Analyse only this part of the process" — the sub-log

A sub-log is a first-class artefact, not a filter:

1. Boundary: a stage, a set of activities, or a pair A … B (from the first
   A to the first B at or after it, optionally including the boundary
   events), chosen on the map or in the builder.
2. The job writes a new dataset version (events inside the boundary, with
   the parent's content hash and the boundary in its manifest), re-derives
   the case table (case start, end, duration, counts, derived attributes
   whose recipe only reads events inside; recipes that read outside events
   are marked "not derivable in this sub-log"), and derives a norm version
   from the parent norm with the constraints whose endpoints all lie
   inside the boundary; constraints that cross the boundary are listed as
   "outside this sub-log" with the parent's numbers.
3. A run on the sub-log uses the normal runs API; its backlog is ranked
   within the sub-log and its map's stage groups are those of the
   boundary. Comparisons between a sub-log run and its parent run are
   allowed only for constraints present in both, on the same slicing.
4. Provenance: `(parent dataset version, parent norm fingerprint,
   boundary, filter at creation)` on the sub-log; the context ribbon shows
   "sub-log of P2P · stage Invoicing".

## 4. Activity reasoning panel — "what is this activity?"

The panel opens from the activity card and answers, in this order and
in plain words first: how often, where in the flow, how long before and
inside it, whether it holds cases up, whether it repeats, whether it
looks rule-driven or discretionary, whether the data edge cuts it, and
which expectations touch it. Notation: `N` cases in the filter; `N_a`
cases with at least one `a`; `E_a` events of `a`; `cnt_a(σ)` the count of
`a` in case σ; `t(e)` a timestamp; `prev(e)` / `next(e)` the previous and
next event of the same case; `dur(σ)` the case duration. Every block
prints its sample size, and the reading sentence names the number and its
source ("from the case table of run … under filter …").

| Block | Reading (plain sentence) | Formula or method | Data needs | Caveats printed with it |
|---|---|---|---|---|
| **F — frequency and coverage** | "Occurs in 237,236 of 251,734 cases (94 %); 1.08 times per case on average; in 6 % of cases more than once" | `N_a / N`; `E_a / N_a`; `P(cnt_a ≥ 2)`; distribution of `cnt_a` as a bar chart (0, 1, 2, 3+) | case table (`EventLog.count`) | replicated header events inflate `E_a` (link to `event_replication`); the filter's `N` is the denominator, not the log's |
| **P — position** | "Stage Invoicing; usually after Record Goods Receipt (71 %) and before Clear Invoice (83 %); its next step is predictable (outgoing entropy 0.31)" | stage from the activity mapping; predecessor shares `count(x → a) / Σ_x count(x → a)`; successor shares likewise; normalised entropies `H_in = −Σ p_i log2 p_i / log2 k_in`, `H_out` likewise; start share `starts(a) / N`, end share `ends(a) / N` | DFG from the storage adapter (the same `dfg` that feeds the map) | shares are of direct transitions, not of eventual order; under abstraction the shares are of the full DFG, not of the drawn edges |
| **T — time before and inside** | with lifecycle: "Cases wait a median 3.2 d (p90 14.1 d) before it starts and it takes a median 6 min"; without: "The gap from the previous step is a median 3.2 d (p90 14.1 d)" | with `lifecycle:transition` start / complete pairs: `wait(e) = t_start(e) − t_complete(prev(e))`, `service(e) = t_complete(e) − t_start(e)`; without: `gap_before(e) = t(e) − t(prev(e))`, and `gap_after(e) = t(next(e)) − t(e)`; median, p90, ECDF; per flow type as small multiples | events with lifecycle column when mapped (mapping declares it); otherwise timestamps only | without lifecycle the word "waiting" is not used — the label is "gap before"; a gap includes parallel work on other steps; the previous event may belong to a replicated header; first events have no gap before |
| **B — bottleneck reading** | "35 % of the elapsed time of cases through it is spent in the gap before it — rank 2 of 18 activities. At most 1,240 cases were between the previous step and this one at once (2018-06-12)" | share `B_a = Σ_{σ ∋ a} Σ_{e ∈ σ, act(e) = a} gap_before(e) / Σ_{σ ∋ a} dur(σ)`; rank of `B_a` among activities in the filter; queue-length proxy `Q_a(t) = #{σ : t(prev) ≤ t < t(a)}` counted per day over the window, plotted with its maximum and the date; arrivals and departures per day next to it | case table and events; a daily step function computed in DuckDB | `Q_a` counts only cases that eventually reach `a` (open cases are missing at the right edge, so the curve dips there); a gap is not a queue without lifecycle; ranking by `B_a` favours late-stage activities in long cases — the share is also given per stage; no statement that the activity "causes" the delay |
| **K — blocking of successors** | "When it ran late (gap before it above 8.4 d, the upper quartile), the step to Clear Invoice was also longer: median 11.0 d against 4.2 d, difference 6.8 d, interval [5.9, 7.7]. This coincidence is descriptive." | `late(σ) = gap_before(a, σ) > q75` (or: violates the lag constraint ending at `a`, when one exists); for each successor `b`: `gap(a → b)` among late vs not late cases: medians, difference of medians with a bootstrap 95 % interval (1,000 resamples, stratified by flow type), Cliff's δ as an effect size; repeated within each flow type as a check | events; the filter; `wise_analytics` bootstrap helpers | confounding by case type, period and vendor is not removed; the reading uses "coincides with"; when the interval covers 0 the sentence says "no difference visible"; a minimum of 200 late cases per successor, otherwise "too few cases" |
| **R — repetition and loops** | "Repeats in 6.1 % of its cases; 1.9 % directly after itself; typical loop returns after 2 steps and 1.5 d; the expectation 'at most 2 goods receipts' is missed in 3.4 % of cases in scope" | self-loop rate `count(a → a) / E_a`; rework share `#{σ : cnt_a(σ) ≥ 2} / N_a`; share with `cnt_a > k` for k = 1, 2, 3; loop length = events between consecutive `a` events in a case (0 = self-loop) and its time span, as a histogram; ping-pong share `#{σ : a → b → a}`; singularity constraints on `a`: cases in scope, violation share (`ScoreResult.violations` under the filter) | events; violation matrix | `event_replication` and `cross_case_replication` flags shown when they touch `a` (copies of header events look like rework); lifecycle duplicates (start + complete) are collapsed before counting; loops through an excluded event are counted with the event restored |
| **D — determinism** | "Reads as rule-like: 96 % of its timestamps end on :00 seconds, 91 % are executed by users matching the system pattern, and 88 % fall in two hours of the day (02:00, 03:00). Candidate for a configuration check in the source system." | signals: s1 timestamp regularity = share of `a` events with seconds = 0 and the share sharing an identical timestamp with ≥ 5 other `a` events; s2 system resource = share by resources matching the mapping's system pattern (e.g. `BATCH`, `WF-BATCH`, `NONE`) or with an `automated` field; s3 transition entropy `H_out` (from P); s4 execution-time regularity = coefficient of variation of `gap_before` and the share of gaps equal to a round number of hours or days (± 1 min); s5 calendar concentration = share of events in the two most frequent hour-of-day bins and the weekend share; reading rule printed: *rule-like* when s1 ≥ 0.9 or s2 ≥ 0.9, or when three of {s1 ≥ 0.5, s3 ≤ 0.3, s4 CV ≤ 0.5 or round-lag share ≥ 0.5, s5 ≥ 0.6} hold; *discretionary* when s1 ≤ 0.2, s2 ≤ 0.2 and s5 ≤ 0.3; *mixed* otherwise | events with resource column and, where mapped, an automation flag; the mapping's system-user pattern | a manual step imported in a nightly batch looks rule-like (s1, s5) — the reading names the signals it rests on; a scheduled job can execute discretionary content; the thresholds are conventions, adjustable in the mapping, and printed; the sentence never says "automated" without an automation field |
| **C — censoring at the window edge** | "In 12 % of cases through it, it is the last observed event and the case is still open at the end of the data (2019-01-29); gaps after it are understated" | share of cases where `a` is the last event and the case is open (`right_censored` with the norm's end activities); share of `a` events within the norm's largest lag width of the window end; `left_truncated` share for cases starting before the window | diagnostics (`observation_window`, `right_censored`, `left_truncated`) | the `censoring` validation gate reads the same numbers; readings of blocks T, B and K carry a chip when this share exceeds 5 % |
| **E — expectations that touch it** | a table: expectation (plain sentence), area (layer), role of `a` (subject, from, to), cases in scope, cases missing it, share, possible gain (headroom) | from the norm: presence / singularity / exclusion on `a`, lag / precedence with `a` as endpoint; violation share on the filtered, in-scope cases; headroom from `wise_analytics.headroom` for the current slice or filter | violation matrix, `in_scope`, headroom | a lag constraint measures first-to-first, the edge measures direct transitions — both are shown with their names; headroom is exact under the norm and not a forecast |

The reading sentences use the plain-language layer of
`guidance_and_insight_panel.md` §2 (expectation, area, group, cases
missing the expectation, possible gain), with the method term in the
muted secondary style. Numbers carry the "explain this number" popover
(UX-3): formula, inputs, sample size, caveats.

Guided mode shows F, T (as one sentence), R, D and E; Analyst mode shows
all blocks; Data-expert mode adds the SQL of each block against the
workspace.

## 5. Stage and edge reasoning

### 5.1 Stage panel

| Block | Reading | Formula or method | Caveats |
|---|---|---|---|
| Throughput | "184,300 cases enter this stage; the median stay is 9.1 d (p90 31 d)" | cases entering `#{σ : ∃ e ∈ σ, stage(e) = S}`; time in stage = last event in S − first event in S per case; per-day entries and exits as a step chart | stays are understated for open cases (censoring chip) |
| Entering from, leaving to | "Cases arrive from Ordering (92 %) and continue to Payment (78 %), Change (14 %) or end here (8 %)" | first event in S: its predecessor's stage; last event in S: its successor's stage; shares of entering cases | direct transitions only |
| Loops back | "7.2 % of cases return to this stage after having left it" | re-entry count per case = number of maximal runs of S events beyond the first; share with ≥ 1 re-entry; where they went in between | replication and lifecycle duplicates as in block R |
| Hand-offs | "A median 2 resources touch a case inside this stage; 31 % of cases change resource at least once" | resource changes along the trace inside S (needs the `handoffs` recipe, wise-pm 0.2); hand-off matrix inside the stage as the matrix alternative to the network | resources may be systems; the mapping's system pattern is applied |
| Expectations | expectations with all endpoints in S with their violation shares and headroom; expectations crossing the boundary listed separately with the note "measured against events outside this stage" | as in block E | as in block E |
| Sub-log | "Analyse only this stage" button → §3.4 | | |

### 5.2 Edge panel (A → B)

| Block | Reading | Formula or method | Caveats |
|---|---|---|---|
| Share | "Taken in 133,400 cases (53 %); 141,900 times" | `cases(A → B) / N`; `count(A → B)`; reverse edge `B → A` share | abstraction hides weak edges, the numbers are from the full DFG |
| Lag distribution | "Median 2.1 d, p90 19 d; 22 % of transitions take longer than 10 d" | lag of direct transitions `t(B) − t(A)`; median, p90, histogram and ECDF with the threshold marker of any lag constraint on (A, B) | direct transitions only; the constraint's first-to-first lag is shown next to it when they differ |
| Performance spectrum | a strip: one line per occurrence from `t(A)` on the top edge to `t(B)` on the bottom edge, coloured by lag quartile, over the window (Denisov, Fahland and van der Aalst, 2018) | sample of up to 20,000 occurrences stratified by month; FIFO share = share of pairs of occurrences whose order at B equals their order at A | a stratified sample; "batching" and "FIFO" are readings of the picture and are also given as numbers |
| Expectations on the edge | lag and precedence constraints with A, B as endpoints: cases in scope, missing, share; violation share on this edge = share of transitions on this edge belonging to violating cases | violation matrix | first-to-first versus direct transition, printed |
| Batching signature | "B is executed in batches: 64 % of B events on this edge arrive in groups of 5 or more within 60 s by the same resource; batches at 02:00" | groups of ≥ m (5) B events within w (60 s, adjustable) by the same resource or with identical timestamps; share of B events in such groups; batch size distribution; hour-of-day of batch starts (Martin, Swennen, Depaire, Caris and Vanhoof, 2017, for the notion of batch identification) | identical timestamps can be import artefacts; the signature is a candidate for a source-system check, not a finding |
| Worst cases | the cases on this edge sorted by score under the current view, with the trace timeline | `worst_cases` restricted to the edge's cases | |

## 6. What WISE adds beyond the benchmarked tools

- **Expectation-first overlays.** Edge width is frequency; colour is the
  violation share of the expectation that touches the element, on the
  sequential scale with its legend; the frequency-only map is one click
  away and labelled as such. Unmet presence expectations sit as badges on
  the activity, lag expectations as arcs with ϑ and W in the tooltip,
  singularity as self-loops tinted by the repeat share — the grammar of
  `visualisation_specialist.md` §3, already implemented in
  `constraintOverlays`.
- **Slice comparison on a stable layout.** Any filter or slice can be
  pinned; the union layout (`layoutUnion`) is computed once per (norm
  fingerprint, mapping version, abstraction) and cached, so the vendor
  0128 map and the global map put every activity in the same place; the
  diff map colours `delta_violationShare` on the diverging scale, and the
  strip shows slice, rest and delta as three numbers per element.
- **Applicability hatching.** Activities outside a constraint's scope under
  the current filter are hatched; the tooltip says "this expectation
  applies to 3-way-match items only; 12 % of the filtered cases". No other
  tool draws the scope of a rule on the map.
- **Gate status on the map.** The validation gates of the run (censoring,
  replication, data quality, domain) appear as chips on the elements they
  concern: a replication flag on the activity whose events are copied, a
  censoring chip on the end event and on any activity whose block C share
  exceeds 5 %; the chip links to the gate with its evidence and its
  pass / fail / waive state.
- **Headroom per activity.** "If this activity met its expectations": the
  sum over the constraints touching `a` of `mean_s(π_c)` from
  `wise_analytics.headroom` — exact and additive over constraints under
  the norm, not a forecast. A constraint with two endpoints is listed
  under both activities, so activity headrooms are not summed across
  activities; the panel says so.
- **What-if hooks from the map.** Two are available today: *reweight the
  perspective* (`rescore_view` on the cached violations: "if Logistics'
  weights counted") and *remove this expectation's violations* (headroom).
  The intervention scenarios of cycle 1's `WHATIF_SCENARIOS.md` are not on
  disk at the time of writing (only the analytics module `whatif.py`
  exists); when the file exists, each scenario should attach to a map
  element as an *intervention point* (activity, edge or stage) with a
  *scenario* (a set of assumptions per constraint: violations removed for
  a share of cases, a lag shifted by δ, a repeat capped at k) and produce a
  backlog before / after on the same slicing. The map's job is to open the
  scenario with the element and the filter pre-filled and to show the
  result as a diff map.

## 7. Requirements

Priorities: P1 needed for the flow map to be an instrument, P2 needed
for the reasoning panels to be trusted, P3 completion. Workstreams: flow
library (`wise-flow`), frontend, backend, analytics. Cycles follow
the development notes (filters and click actions in 2, activity panel
in 3, loops, sub-logs and stage / edge panels in 5, authoring from the map
in 6, gates in 8, censoring stress in 9, scenarios in 10) and the flow
library's roadmap (0.2 Canvas and BPMN, 0.3 spectrum and dotted chart,
0.4 authoring callbacks).

### 7.1 Filters

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-01 | P1 | backend, frontend | Filter model: canonical JSON with the clause kinds of §3.1, AND between clauses, OR inside a value list and in `any` groups; `f=` in the URL, `fh=` hash for links; echoed in `meta.filter` of every response | Reloading a URL with `f=` restores the same map, backlog and case list; the canonical form of two orderings of the same clauses is byte-identical; an unknown clause kind returns a 422 problem detail naming it | 2 |
| RF-02 | P1 | backend, frontend | Time window with the four modes (`case_start`, `case_end`, `active`, `events_inside`); `events_inside` flagged "changes cases" and re-deriving the case table through a job | For BPIC 2019 the three whole-case modes return the counts that DuckDB gives for the same predicates; `events_inside` changes `N` and the presence shares and shows the "changes cases" chip; the censoring diagnostics are recomputed at the new edges | 2 |
| RF-03 | P1 | backend, frontend | Case attribute and slice filters, including derived attributes and the flow type; "open the map for this row" from the backlog creates the slice chip | A slice chip yields the same `n_cases` as the backlog row; attribute chips show their values in plain words and support `in`, `not_in`, `range`, `missing` | 2 |
| RF-04 | P1 | backend, frontend | Activity-based filters: contains, does not contain, starts with, ends with, directly follows, eventually follows, never follows, count ≥ k | `follows eventual` selects exactly the cases in which the corresponding `Lag` constraint would be evaluated (same first-to-first rule); each op has a unit test against a hand-built log of ten cases | 2 |
| RF-05 | P2 | backend, frontend | Performance filters: case duration, events per case, lag between two activities (direct / eventual), gap before an activity | With ϑ equal to a constraint's threshold the filter's case set equals the constraint's violators (in scope); units shown in days or hours | 3 |
| RF-06 | P2 | backend, frontend | Rework filters: self-loop, repeat ≥ k, ping-pong a → b → a, loop through a | Counts agree with `EventLog.count`; the chip shows the replication flag of `event_replication` when it touches the activity | 5 |
| RF-07 | P1 | backend, frontend, analytics | Open / closed filter with the readiness definition of closure (norm end activities or configured end labels) and the censoring warning | On BPIC 2017 the open share equals the `right_censored` share reported by the diagnostics; a chip "open cases understate lags" appears whenever open cases are included and a lag constraint is on the map | 3 |
| RF-08 | P1 | frontend | Flow type as a fixed chip with the applicability counts per constraint | Selecting a flow type updates, per constraint card, "cases in filter / in scope / missing" | 2 |
| RF-09 | P1 | backend, frontend | Cases in / out: `N_total`, `N_in`, `N_out`, marginal removal per chip, and per-constraint in-scope counts, from one DuckDB pass | Numbers match a direct query; a redundant chip shows marginal removal 0; p95 ≤ 300 ms for 251,734 cases | 2 |
| RF-10 | P1 | backend, frontend | One filter store scopes the map, the backlog, the analytics and the case list; the backlog under a filter is recomputed on the filtered frame with the existing ad-hoc recompute and carries the chip "ranked within the filter" | Changing a chip updates all four within one round trip each; the backlog's `n_cases` sum equals `N_in`; the analytics provenance record stores the canonical filter | 2 |
| RF-11 | P2 | backend, frontend | Saved, named filters per project with author and note; share links by hash | A saved filter reopens identically after a restart; the hash link resolves without the JSON | 4 |

### 7.2 Click actions

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-12 | P1 | frontend, backend | Activity actions: filter to, exclude cases, exclude the event (abstraction with a re-derived case table) | Each action adds the corresponding chip; "exclude the event" removes the node, keeps `N`, re-derives counts and shows the "changes cases" chip; undo removes the chip | 2 |
| RF-13 | P1 | frontend, backend | Incoming and outgoing paths: highlight on the map plus a side list with count, cases (share), median and p90 lag and the violation share of lag constraints on each path; sortable | The side list sums to the activity's in- and out-counts of the full DFG; a click on a list row selects the edge; the list has a table alternative | 2 |
| RF-14 | P1 | frontend, flow library | Actions menu per element (§2.3) reachable by right click, card button and `Enter`; accelerators; live-region announcements | Every action in §2.1 is reachable without a mouse (checked with a keyboard-only Playwright run); screen reader reads the announcement text | 2 |
| RF-15 | P2 | frontend, backend, flow library | Multi-select of two activities → path analysis (direct and eventual, reverse share), lag lens, spectrum; sets → filters and temporary groups | Path analysis for `Record Goods Receipt` → `Record Invoice Receipt` on BPIC 2019 returns cases, shares and the lag ECDF within 1 s; the spectrum renders 20,000 sampled occurrences at 60 fps pan | 3 (paths), 5 (spectrum) |
| RF-16 | P2 | frontend, backend | Add expectation here: presence, singularity, exclusion from one activity; lag, precedence from two; the norm editor opens pre-filled with the distribution lens and the current filter's numbers; save creates a norm version with a note | The pre-filled constraint passes `validate`; the lens's live share equals the preview endpoint's share; the saved version's changelog names the map as origin | 6 |
| RF-17 | P2 | frontend, flow library | Pin for comparison, up to three scenes, on the union layout; diff map with the diverging scale | Shared activities have identical positions across pinned scenes (`coversGraph` true); the diff legend shows the domain; swap and hold work by keyboard | 3 |
| RF-18 | P1 | frontend, backend | Worst cases through this activity, edge, stage or expectation → case list sorted by score under the view, with the trace timeline and violated expectations annotated | The list equals `worst_cases` restricted to the element's cases; opening a case shows its trace within 200 ms | 2 |
| RF-19 | P2 | frontend, backend | Edge actions: filter with / without the connection, profile (§5.2), worst cases on the edge | The with / without chips partition `N_in`; the profile's count equals the edge metric | 2 (filters), 5 (profile) |
| RF-20 | P2 | frontend, flow library | Legend entries toggle layers and constraint types and create "violating any expectation of this layer" chips | Toggling a layer hides only its overlays; the chip's case count equals the OR of the layer's violators | 2 |
| RF-21 | P2 | frontend | Constraint arc, badge or chip → distribution lens under the current filter; filter to violating / in scope / out of scope | The lens's `casesInScope` equals the card's; ϑ and W drags update the share live from `signals` | 2 |
| RF-22 | P3 | frontend, flow library | Gateway and BPMN task clicks map to the activity actions (BpmnView, flow 0.2); branch comparison as pinned scenes | Clicking a BPMN task selects its mapped activities; unmapped tasks say so | 6 |
| RF-23 | P2 | frontend, flow library | Hover cards with units and the worst expectation; linked highlighting between map, side list, backlog and traces | Hovering an activity highlights its rows in the side list and the constraint table; the table alternative exposes the same numbers | 2 |

### 7.3 Activity panel

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-24 | P1 | backend, frontend | Activity profile endpoint and panel skeleton with blocks F, P and E (§4) | For `Clear Invoice` on BPIC 2019 under no filter the profile reports 237,236 cases evaluated for the presence expectation and a 22.6 % missing share (the fixture's numbers); p95 ≤ 700 ms | 3 |
| RF-25 | P1 | backend, analytics | Block T with lifecycle detection: waiting and service when the mapping declares start / complete pairs, gap before and after otherwise, with the label switching | On a synthetic log with lifecycle the waiting time equals the planted value; without lifecycle the panel never uses the word "waiting" | 3 |
| RF-26 | P1 | backend, analytics, frontend | Block B: share of case time in the gap before, rank among activities, queue-length proxy per day with its maximum and date, arrivals and departures | `B_a` values sum to ≤ 1 over the activities of a case set; the queue curve's maximum matches a direct DuckDB query; the reading uses no causal verb | 3 |
| RF-27 | P2 | analytics, backend, frontend | Block K: late vs not late contrast per successor with bootstrap intervals and Cliff's δ, repeated per flow type; minimum 200 late cases | On a synthetic log with a planted successor delay the interval excludes 0; on a log without one it covers 0; the sentence uses "coincides with" | 3 |
| RF-28 | P1 | backend, frontend | Block R: self-loop rate, rework share, share with > k executions, loop length and span histograms, ping-pong, singularity expectations with shares, replication flags | Counts agree with `EventLog.count`; replication flags appear for the planted header duplicate of the synthetic generator | 5 |
| RF-29 | P1 | analytics, backend, frontend | Block D: the five determinism signals with printed thresholds and the reading rule (*rule-like* / *discretionary* / *mixed*); the mapping holds the system-resource pattern and the thresholds | On BPIC 2019 the panel classifies at least one batch activity as rule-like from s1 and s5 and one clerk activity as discretionary, with the signals shown; changing a threshold in the mapping changes the reading and is logged | 3 |
| RF-30 | P1 | backend, analytics, frontend | Block C: censoring shares at the window edge and the chip on blocks T, B, K above 5 % | On BPIC 2017 the shares equal `right_censored` and `left_truncated`; the chip links to the censoring gate | 3, stress in 9 |
| RF-31 | P1 | frontend | Every number in the panel has the "explain this number" popover with formula, inputs, sample size and caveats; every sentence follows the descriptive vocabulary and the plain-language layer | A lint of the panel's string table finds no "cause", "root cause", "leads to", "results in", "effective", "bottleneck" outside the phrase "bottleneck reading"; the comprehension test of the cycle review reaches ≥ 80 % on three questions about the panel | 3 |
| RF-32 | P2 | frontend | Guided mode subset (F, T as one sentence, R, D, E) with method cards; Data-expert mode adds the SQL per block | Guided mode shows no block without a plain sentence; the SQL runs unchanged in the query console | 3 (Guided), 4 (Data expert) |

### 7.4 Stage and edge panels

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-33 | P2 | backend, frontend | Stage profile: throughput, entering from and leaving to, time in stage, loops back, expectations inside and crossing | Entering cases equal the collapsed stage node's `cases`; loop-back share matches a direct query; crossing expectations are listed separately | 5 |
| RF-34 | P3 | analytics, backend | Hand-offs inside a stage (needs the `handoffs` recipe of wise-pm 0.2) with the matrix alternative | The hand-off count per case equals the recipe's value; system resources are excluded by the mapping's pattern | 5 or 7 |
| RF-35 | P2 | backend, frontend | Edge profile: share, lag distribution with the constraint marker, expectations on the edge, reverse share, worst cases | Direct-transition and first-to-first lags are both shown and named; the median equals `medianHours` of the edge metric | 5 |
| RF-36 | P2 | flow library, backend, frontend | Performance spectrum component (flow 0.3) fed by a stratified sample endpoint; FIFO share | Sample ≤ 20,000, stratified by month; pan and zoom at 60 fps; the table alternative lists quartile counts per month | 5 |
| RF-37 | P2 | analytics, backend, frontend | Batching signature: share in groups of ≥ m within w by the same resource or identical timestamps, batch size and hour-of-day; parameters adjustable and printed | On the synthetic generator's planted nightly batch the share is ≥ 0.9; the reading calls it a candidate for a source-system check | 5 |

### 7.5 Part-of-process analysis

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-38 | P1 | frontend, flow library | Sub-process boundary selection on the map: a stage, an activity set, or A … B with "include boundary events"; the builder previews cases, events and the expectations inside | The preview counts equal the job's result; a boundary that leaves no expectation inside says so before the job starts | 5 |
| RF-39 | P1 | backend | Sub-log job: dataset version, re-derived case table, derived norm version (constraints with all endpoints inside), provenance to the parent | Running the sub-log yields a manifest with parent hashes and the boundary; a constraint crossing the boundary is absent from the derived norm and listed in the sub-log's card; the job on BPIC 2019's invoicing stage completes within 60 s | 5 |
| RF-40 | P2 | backend, frontend, analytics | Sub-log run and backlog; comparison to the parent on shared constraints and the same slicing; the context ribbon shows the sub-log | The comparison refuses a different slicing with a problem detail; shared constraints' violation shares agree with the parent's under the boundary filter | 5 |
| RF-41 | P2 | frontend, backend | Collapse and expand stages (semantic zoom) wired to the backend's groups; abstraction thresholds for nodes and edges as separate parameters | The backend returns stage groups from the activity mapping; collapsing keeps positions of the surviving elements (the library's guarantee) | 2 |
| RF-42 | P3 | backend, frontend | Sub-log export (Parquet, CSV, XES) in Data-expert mode with the manifest | The export reproduces the sub-log's counts when re-imported | 4 or 5 |

### 7.6 WISE additions on the map

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-43 | P1 | frontend, backend, flow library | Expectation-first default: colour = violation share, width = frequency, legend with the scale's domain; frequency-only mode labelled | The legend states the domain and the metric; a screenshot without the legend is impossible; the toggle is in the URL | 2 |
| RF-44 | P2 | backend, frontend | Two-scene response for slice vs rest and period vs baseline (two `FlowGraph`s from one call or two cached calls) rendered as a diff on the union layout | Delta metrics per element equal the difference of the two scenes' metrics; the strip shows slice, rest and delta | 3 |
| RF-45 | P2 | backend, frontend | Applicability hatching from in-scope shares under the filter, with the scope sentence in the tooltip | An activity touched only by constraints inapplicable to the filtered flow type is hatched; the tooltip names the rule and the share | 2 |
| RF-46 | P2 | backend, frontend | Gate chips on the map (censoring, replication, data quality, domain) linked to the validation gates | A failed replication gate shows a chip on the affected activity; waiving the gate changes the chip's state | 8 |
| RF-47 | P2 | analytics, backend, frontend | Headroom per activity in block E and the what-if hooks (reweight perspective, remove violations); scenario hooks with intervention point, scenario and before / after backlog once `WHATIF_SCENARIOS.md` exists | Headroom values equal `wise_analytics.headroom` per constraint; the panel states that activity headrooms are not summed across activities; a scenario opened from the map carries the element and the filter | 2 (headroom), 10 (scenarios) |

### 7.7 Performance and accessibility

| ID | Pri | Workstreams | Requirement | Acceptance criterion | Cycle |
|---|---|---|---|---|---|
| RF-48 | P1 | backend | Latency budgets on the desktop target (4 cores, 16 GB, BPIC 2019): filtered flow p95 ≤ 500 ms, filter preview ≤ 300 ms, activity profile ≤ 700 ms, path analysis ≤ 1 s, sub-log job ≤ 60 s; DuckDB queries over `events.parquet` and `cases.parquet`, results cached by (run, canonical filter hash, element) | Timings recorded in the job and request logs and reported in the cycle's `REPORT.md` | 2, 3, 5 |
| RF-49 | P1 | flow library, frontend | Full keyboard operability of §2.4, ARIA names for every element and action, live-region announcements, table alternative covering profiles and side lists | Playwright keyboard-only run completes the ten top tasks; axe reports no serious issue; the table alternative shows every number of the map | 2 onward |
| RF-50 | P1 | flow library, frontend | Colour never alone: pattern twins on nodes, glyphs on badges, numbers in tooltips; contrast ≥ 4.5:1; reduced motion respected | The visual regression suite includes a greyscale render in which every overlay is still distinguishable | 2 |
| RF-51 | P2 | flow library | Canvas renderer (flow 0.2) for maps above 2,000 elements with the same hit index and actions | 5,000 nodes / 20,000 edges pan and zoom at 60 fps; the actions menu works on canvas hits | 3 |
| RF-52 | P2 | frontend | Filter and selection state survive reload and are shareable; every export carries the filter caption and run id | A shared link opens the same selection; an exported SVG contains the caption line | 2 |
| RF-53 | P2 | frontend | Usability test of the map actions with five analysts and two process owners: tasks "filter to vendor X and find its worst expectation", "find the activity that holds cases up", "analyse only invoicing" | Task success ≥ 90 %, median time ≤ 3 min per task; findings feed the next cycle's requirements | 3, repeated in 6 |

### 7.8 Backend endpoints, in prose

All under `/api/v1/projects/{projectId}`, RFC 9457 errors, results cached
by the run id, the canonical filter hash and the element id; long
computations become jobs with SSE progress.

1. **Filtered flow** — `GET /runs/{runId}/flow` extended with `filter`
   (URL-encoded canonical JSON), `view` (which constraints count),
   `minNodeShare` and `minEdgeShare` (replacing the single `abstraction`,
   which stays as an alias for `minNodeShare`), `collapse` (stage ids or
   `all`), `compare` (`rest`, `baseline:{runId}` or a second slice). It
   returns the `FlowGraph` of the workbench schema: nodes with `events`,
   `cases`, `caseShare`, `eventsPerCase`, `repeatShare`,
   `medianGapBeforeHours`, `p90GapBeforeHours` and `headroom`; follows
   edges with `count`, `cases`, `caseShare`, `medianHours`, `p90Hours`;
   constraint edges and overlays with their stats under the filter
   (`cases`, `evaluated`, `violations`, `violationShare`, `casesInScope`,
   `nodeShareInScope`); groups from the activity mapping's stages; `meta`
   with the canonical filter, `cases {total, in, out}`, the window, the
   view, the norm fingerprint and the run id. With `compare` the response
   carries a second graph under `meta.compare` so that the client can run
   `diff` and `layoutUnion`.
2. **Filter preview** — `POST /runs/{runId}/filter/preview` with the filter
   in the body; returns `casesTotal`, `casesIn`, `casesOut`, a `clauses`
   list with each clause's plain sentence, its own case count and its
   marginal removal, and a `constraints` list with cases in scope and
   evaluated under the filter. One DuckDB pass; no job.
3. **Activity profile** — `GET /runs/{runId}/activities/{activityId}/profile`
   with `filter`, `view` and `lifecycle` (`auto`, `on`, `off`); returns the
   blocks of §4 as named objects (`frequency`, `position`, `timing`,
   `bottleneck`, `blocking`, `repetition`, `determinism`, `censoring`,
   `constraints`), each with its numbers, the sample size, the method name
   and version, the caveat keys, and a `readings` list of plain sentences
   with the ids of the numbers they cite; plus `provenance` (run, filter
   hash, analytics versions). Blocks that need more than the budget (the
   blocking contrast on large filters) return `pending` with a job id.
4. **Path analysis** — `GET /runs/{runId}/paths` with `from`, `to`, `mode`
   (`direct` or `eventual`), `filter`, `sample` (default 20,000); returns
   cases and share, the reverse share, the lag distribution (median, p90,
   histogram bins, ECDF points, the threshold marker of any lag constraint
   on the pair), the spectrum sample as `(tA, tB, caseId)` triples
   stratified by month, the FIFO share, the batching signature with its
   parameters, and the constraints on the pair with their violation shares.
   The edge profile is this endpoint with `mode=direct`.
5. **Stage profile** — `GET /runs/{runId}/stages/{stageId}/profile` with
   `filter`; returns the blocks of §5.1 in the same shape as the activity
   profile.
6. **Sub-log creation** — `POST /sublogs` with `runId`, `boundary`
   (`{kind: stage | activities | between, stage?, activities?, from?, to?,
   includeBoundary}`), `filter`, `name` and a note; returns a job; the
   finished job yields `sublogId`, the new dataset version id, case table
   id and derived norm version id, the counts (cases, events, constraints
   inside, constraints crossing) and the provenance. `GET /sublogs/{id}`
   returns the same; runs on a sub-log use `POST /runs` with the sub-log's
   ids.
7. **Constraint preview** — `POST /runs/{runId}/constraints/preview` with a
   constraint specification (the norm file's constraint object) and a
   filter; returns the `Distribution` shape that `signals` already returns
   plus the violation share and cases in scope, so that "add expectation
   here" shows live numbers before a norm version exists.
8. **Cases through an element** — `GET /runs/{runId}/cases` extended with
   `filter`, `through` (activity, edge, stage or constraint id), `view`,
   `sort=score`, `limit`; returns the case rows with scores and the
   violated constraint ids; `GET /runs/{runId}/cases/{caseId}/trace` stays
   as it is.

The frontend keeps one filter store (Zustand) mirrored to the URL; every
TanStack Query key includes the canonical filter hash; the `@wise/flow`
map receives the graph, the overlays and the selection and emits
`onSelect` / `onHover`; the actions menu is a workbench component that
maps element ids to the endpoints above.

## 8. Risks and anti-patterns

| Anti-pattern seen in the benchmarked tools | Why it misleads | How the workbench avoids it |
|---|---|---|
| Maps that hide their filters (widget-level filters, sequence-ordered filter stacks, a default "most frequent variant" map) | two readers of the same screen see different populations and do not know it; the baseline graph makes rare, expensive paths invisible | the filter chips with `N_in` / `N_out` are part of the map's frame; exports carry the caption; the default map is the abstracted full DFG with the abstraction settings printed, not a variant |
| Edge colours without a scale | "red" means whatever the reader fears | the legend with the domain is mandatory (RF-43, RF-50); every colour has a number in the tooltip and a pattern twin |
| Bottleneck claims from inter-event gaps | a gap between two events mixes queueing, parallel work and idle time; ranking gaps crowns the last long step of every case | block B reports a share of elapsed time, a rank, a queue proxy and the censoring share, in a sentence that says "spent in the gap before"; "waiting" only with lifecycle data (RF-25, RF-26) |
| Causal language ("root cause", "inefficiency", "impact") | attribute correlations presented as causes drive interventions at the wrong place | the vocabulary lint (RF-31): "coincides with", "is missed in", "reads as", "candidate for a check"; the blocking contrast prints intervals and effect sizes and is repeated per flow type |
| Automation and savings from a boolean or a simulation | "automated" is a data field; savings assume gaps are idle | determinism signals with printed thresholds and a *rule-like* reading; headroom is exact under the norm and labelled "not a forecast"; scenarios are before / after backlogs on the same slicing |
| Rework from raw counts | replicated header events and lifecycle pairs count as repeats | block R collapses lifecycle pairs and shows the replication flags; the replication gate sits on the map (RF-46) |
| Three sliders whose combined effect is unknown | the reader cannot say what was removed | `abstract` is monotone and keeps the map connected; re-added elements are tagged `reconnected` and drawn dashed; the table alternative lists removed elements with their shares |
| Sub-process by cropping the picture | cropping keeps case attributes that no longer describe the cropped part | the sub-log re-derives the case table and the norm and carries provenance (RF-39) |
| Comparison on moving layouts | the eye reads a moved node as a changed node | union layout and stable positions for anything pinned (RF-17, RF-44) |
| Panels that grow into dashboards | forty numbers, no reading | each block leads with one sentence and hides its numbers behind it; Guided mode shows five blocks; the comprehension test gates the panel (RF-31) |

Open risks: the blocking contrast (block K) will be over-read as a cause
despite the wording — the panel review should test this reading
specifically; the determinism thresholds are conventions until several
logs have been seen — keep them in the mapping and print them; sub-logs
multiply artefacts — the workspace browser must group them under their
parent; latency of profiles on the server target (20 M events) is not
covered by the budgets above and needs the cached-frame path.

## 9. Sources

Vendor pages read on 2026-09-06 (a bracketed key is used in §1):

- [C1] Celonis, *Process Explorer* (CPM 4.6 help, public mirror of the
  component documentation): https://help.celonis.com/cpm46/en/process-explorer
- [C2] Celonis, *Process components in Celonis Analyses*:
  https://docs.celonis.com/en/process-components-in-celonis-analyses.html
  (the page redirects to a login; the statements used come from its
  indexed text)
- [C3] Celonis, *Throughput time filtering in Process Explorer*:
  https://docs.celonis.com/en/pe-tpt-filtering.html (indexed text only)
- [C4] Celonis, *Variant Explorer*: https://docs.celonis.com/en/variant-explorer.html
  and the CPM 4.6 mirror https://help.celonis.com/cpm46/en/the-variant-explorer
  (indexed text only)
- [C5] Celonis, *Analysis — Conformance Checker*:
  https://docs.celonis.com/en/analysis---conformance-checker.html (indexed text only)
- [C6] Celonis, *Multi-object Process Explorer*:
  https://docs.celonis.com/en/multi-object-process-explorer.html and
  *Process Explorer* (Studio view component):
  https://docs.celonis.com/en/process-explorer.html (indexed text only)
- [C7] Celonis, *Process Explorer KPIs*:
  https://docs.celonis.com/en/process-explorer-kpis.html (indexed text
  only); the Celonis blog *Process Explorer and Variant Explorer: what's
  the difference?*:
  https://www.celonis.com/blog/celonis-ems-process-explorer-and-variant-explore-whats-the-difference
- [D1] Fluxicon, *Disco* product page: https://fluxicon.com/disco/
- [D2] Fluxicon, *Disco User Guide* (Process Mining Book 3.1, reference):
  https://fluxicon.com/book/read/reference/
- [D3] Fluxicon, *Filtering* (Process Mining Book 3.1):
  https://fluxicon.com/book/read/filtering/
- [A1] Apromore, *Types of filter criteria*:
  https://documentation.apromore.org/logfilters/filtercriteria.html
- [A2] Apromore, *Discover model*:
  https://documentation.apromore.org/discovery/discovermodel.html
- [S1] SAP Signavio, *Process Discovery* widget:
  https://documentation.signavio.com/suite/en-us/Content/process-intelligence/widget-type-process-discovery.htm
  (host not reachable on 2026-09-06; statements from its indexed text)
- [S2] SAP Learning, *Using Widgets for Process Flows* (SAP Signavio
  Process Intelligence):
  https://learning.sap.com/learning-journeys/run-business-processes-with-sap-signavio-solutions/analyzing-process-flows_a9e4c825-0fe4-4581-983f-6a194c03e84e
- [S3] SAP Help Portal, *Process Conformance* widget:
  https://help.sap.com/docs/signavio-process-intelligence/user-guide/process-conformance-widget
  (page body rendered by script; title only)
- [S4] SAP Help Portal, *Filter types*:
  https://help.sap.com/docs/signavio-process-intelligence/user-guide/filter-types
  (page body rendered by script; not read)
- [S5] SAP, *SAP Signavio Analytics Language Guide* (SIGNAL reference):
  https://help.sap.com/doc/666fb92a094040189fae226bcb240278/SHIP/en-US/sap-signavio-process-intelligence-signal-reference-en.pdf
- [U1] UiPath, *Process Mining — Filters*:
  https://docs.uipath.com/process-mining/automation-cloud/latest/user-guide/filters
- [U2] UiPath, *Process Mining — Working with process graphs*:
  https://docs.uipath.com/process-mining/automation-suite/2.2510/user-guide/working-with-process-graphs
- [U3] UiPath, *Process Mining — Process Optimization app*:
  https://docs.uipath.com/process-mining/automation-cloud/latest/user-guide/process-optimization-app
- [U4] UiPath, *Process Mining — Process graphs* (2024.10):
  https://docs.uipath.com/process-mining/automation-suite/2024.10/user-guide/process-graphs
  and *Process Mining 2024.10 release notes*:
  https://docs.uipath.com/process-mining/automation-suite/2024.10/release-notes/process-mining-2024-10
- [U5] UiPath, *Process Mining — Simulating automation potential*:
  https://docs.uipath.com/process-mining/automation-cloud-public-sector/latest/user-guide/simulating-automation-potential
- [P1] pm4py, *pm4py package* API reference:
  https://pm4py-source.readthedocs.io/en/latest/pm4py.html

Method references (author and year; no page was read for them today):
Denisov, Fahland and van der Aalst (2018) for the performance spectrum;
Martin, Swennen, Depaire, Caris and Vanhoof (2017) for batch processing
identification from event logs; Senderovich, Weidlich, Gal and Mandelbaum
(2014) for queue mining and the caution that a queue needs arrival and
service events; Jessen, Fahland and Zerbato for the WISE method
(`wise-lib/README.md`).

Project documents: `docs/panel/visualisation_specialist.md` (§3 overlay
grammar, §5 catalogue, §6 rules), `docs/panel/ux_design_panel.md` (§4
patterns, UX-3, UX-7, UX-8, UX-19), `docs/panel/guidance_and_insight_panel.md`
(§2 plain-language layer), `docs/CUSTOMER_JOURNEY.md` (§8 trust rules),
`docs/ARCHITECTURE.md` (§5 API, §9 targets), `wise-flow/docs/API.md`
(model, `abstract`, `diff`, `layoutUnion`, overlays, `<ProcessMap/>`
keyboard model), `wise-flow/docs/ROADMAP.md`, `wise-lib/README.md`
(constraints, applicability, `Lag` measurement rule, diagnostics),
`apps/backend/src/wise_workbench/adapters/engine/flow.py` (current node
and edge metrics), `packages/wise-analytics/src/wise_analytics/whatif.py`
(headroom, `rescore_view`), the development notes (cycle plan),
`docs/BACKLOG.md` (B2).
