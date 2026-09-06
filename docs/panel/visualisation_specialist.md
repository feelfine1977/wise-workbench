# WISE Workbench — Process-flow visualisation

*Report of a visualisation and front-end graphics specialist (SVG/Canvas/
WebGL, diagramming libraries, BPMN tooling, visual analytics for process
mining). Date: 2026-09-05. Question asked: should the workbench build a
library "similar to JointJS" for process-flow visualisation, how should
BPMN be visualised, and which visualisations does the method need?*

## 0. Verdict

Build a **headless process-flow visualisation core** owned by the
project — graph model, aggregation, stable layout, metric-to-style scales,
constraint overlays, hit-testing and export — and render it through two
thin renderers: React components for interactive scenes (built on React
Flow) and a Canvas renderer for large maps. Do **not** rewrite a general
diagramming editor: JointJS is a decade of work on shapes, ports, routing
and tools that the workbench does not need in that generality. For
BPMN 2.0, use **bpmn-js** (the reference open-source implementation) for
parsing, rendering and editing, and add an overlay layer that projects
WISE constraints and results onto tasks, flows and lanes. Charts that are
not flows stay in ECharts. The core lives in its own repository (`wise-flow`, npm `@wise/flow`) from
the start, by decision of the owner, and the workbench consumes it as a
dependency.

What makes the core worth owning is process-mining specific: canonical
activities and stages as first-class nodes, directly-follows aggregation
with abstraction sliders, layouts that stay **stable across slices** so
that two maps can be compared, and constraint overlays (presence,
singularity, lag, precedence, exclusion, balance) as visual grammar rather
than ad-hoc annotations.

## 1. Library landscape

| Library | Kind | Licence | Fit | Verdict |
|---|---|---|---|---|
| JointJS / JointJS+ | general diagramming (SVG, elements, links, ports, routers, tools) | MPL-2.0 core; JointJS+ commercial | strong editor primitives; React wrapper is recent; no process-mining semantics; large surface to learn and style | alternative to React Flow for the editor layer if port routing and link tools become essential; not a base to clone |
| React Flow (xyflow) | React node-and-edge canvas with custom nodes, edges, handles, minimap, controls, sub-flows | MIT (pro examples paid) | React-native, small, easy custom nodes; layout delegated (ELK/Dagre); SVG edges and HTML nodes: comfortable to ~1–2k elements | **adopt** for interactive scenes (norm authoring on a model, BPMN-lite, small and medium maps) |
| bpmn-js (bpmn.io: diagram-js, bpmn-moddle) | BPMN 2.0 viewer and modeler | bpmn.io licence (MIT-like, watermark must stay) | the standard; import/export XML; overlays and custom renderers; extensible via modules | **adopt** for BPMN 2.0 viewing, editing and overlays |
| ELK (elkjs) | layered layout with ports, lanes, hierarchy; runs in a web worker | EPL-2.0 | best layered layouts for process maps and BPMN-like graphs; slower than Dagre on > 5k elements | **adopt** as primary layout engine |
| Dagre | layered layout | MIT | fast, simpler, no ports | fallback and quick previews |
| Cytoscape.js | graph analysis and rendering (canvas) | MIT | strong for networks (hand-offs, social), built-in algorithms, styling by selectors | **adopt** for resource/hand-off networks only |
| Sigma.js + graphology | WebGL network rendering | MIT | 10^5+ edges | not needed for aggregated maps; keep in reserve |
| D3 | low-level scales, shapes, force, hierarchy | ISC | building blocks for custom views (performance spectrum, dotted chart, timelines) | **use** selectively inside the core and custom views |
| Apache ECharts | charts | Apache-2.0 | already chosen for statistical charts | keep; also fine for Sankey and simple graphs |
| AntV G6 / X6 | graph visualisation and diagram editing | MIT | capable, but docs and community are China-centric; overlap with React Flow | not adopted |
| GoJS, yFiles | commercial diagramming | commercial | excellent layouts (yFiles) but cost and closed source conflict with a public project | not adopted |
| maxGraph (mxGraph) | diagram editor (draw.io engine) | Apache-2.0 | heavy, legacy API | not adopted |
| Graphviz (via pm4py, viz.js/WASM) | static layouts | EPL | server-side SVG for reports; no interaction | **use** server-side for report figures when a browser is not available |
| Pixi.js / Konva | Canvas/WebGL scene graphs | MIT | for a large-map renderer if plain Canvas is not enough | reserve |

## 2. Architecture of the core (repository `wise-flow`, npm name `@wise/flow`)

```
@wise/flow
  core/
    model.ts        FlowGraph: nodes (activity | stage | gateway | event | start/end),
                    edges (directly-follows | constraint arc), groups (lanes | stages),
                    ports optional; ids stable = canonical ids
    aggregate.ts    directly-follows from server payloads; abstraction by frequency /
                    performance thresholds; stage collapse and expand (semantic zoom);
                    keep-connected guarantee
    layout.ts       ELK in a worker (layered, orthogonal or spline edges, lanes as
                    partitions); Dagre fallback; stable layout: compute on the union
                    graph of the compared scenes, then filter, so positions persist
    style.ts        scales: edge width ← frequency, edge/node colour ← performance,
                    violation share or delta; categorical layer palette; colour-blind
                    safe with pattern redundancy; level-of-detail rules
    overlays.ts     constraint overlay grammar (see §3), badges, arcs, lanes, chips
    hit.ts          spatial index for hover/click on canvas
    export.ts       SVG and PNG export, print stylesheet, figure sizes for reports
  react/
    <ProcessMap/>   React Flow scene for interactive maps and authoring
    <BpmnView/>     bpmn-js wrapper with overlay bridge and activity mapping
    <TraceTimeline/>, <VariantStrip/>, <PerformanceSpectrum/>, <DottedChart/>
    hooks           useFlowGraph, useOverlaySelection, useStableLayout
  canvas/
    renderer.ts     Canvas 2D renderer for large maps (> 2k elements), same model
  bpmn/
    import.ts       bpmn-moddle parse; task ↔ canonical activity mapping; lanes ↔ roles
    overlays.ts     bpmn-js overlays: badges on tasks, arcs on sequence flows, heat
    lite.ts         BPMN-lite model (tasks, gateways, events, lanes) rendered natively
```

Rules: the core is framework-free TypeScript with no DOM dependency
(testable in Node); renderers are thin; all metrics arrive pre-aggregated
from the API (`/runs/{run}/flow?slicing&key&view&abstraction`) computed
in DuckDB; the browser never aggregates raw events. Tests: Vitest for the
core, Storybook stories per component, Playwright visual regression for
the renderers.

## 3. Constraint overlay grammar

| Constraint | Visual | Interaction |
|---|---|---|
| Presence (count ≥ / ≤) | badge on the activity node with violation share and colour | click → distribution lens of the count |
| Singularity / exclusion | node badge with "≤ 1" or "∅" glyph; repeated-execution loops drawn as self-edges tinted by violation share | click → cases with repeats |
| Lag (A → B within ϑ) | arc from A to B above the map, width = coverage, colour = violation share; threshold and width shown on hover | click → performance spectrum of A → B |
| Precedence (A before B) | arc with an order glyph; violations shown as reverse-direction arcs | click → offending traces |
| Balance / metric | side panel gauge; node group shading when the metric is attached to a stage | click → histogram with threshold |
| Applicability | nodes outside scope greyed with a hatch; lane or group border for "applies to" | toggle scope |
| Layer | overlay colour family per layer; layer filter chips | filter |
| Slice vs rest | diff map: edge colour = delta of violation share or performance, width = slice frequency; legend anchored | swap, hold to see rest |

Everything in the overlay has a table alternative (constraint list with the
same numbers) and an ARIA description; overlays never encode a value by
colour alone.

## 4. BPMN

- **Sources of models**: (a) reference BPMN per process template in the
  knowledge pack (`process-knowledge/<pack>/bpmn/*.bpmn`), (b) company
  BPMN uploaded to the document library, (c) discovered models via the
  optional pm4py bridge (inductive miner → BPMN XML) marked "discovered".
- **Mapping**: BPMN task ids ↔ canonical activities (from the pack) ↔ log
  labels (from the activity mapping, F33); lanes ↔ roles; sub-processes ↔
  stages. Unmapped tasks are listed; a task can map to several labels.
- **Viewing**: bpmn-js viewer with overlays: violation heat on tasks,
  constraint arcs on sequence flows, scope hatching, per-slice comparison
  by switching the overlay dataset while the diagram stays fixed.
- **Authoring** (v1): in the modeler, select one task → presence or
  singularity constraint; select two tasks → lag or precedence with the
  distribution lens for thresholds; select a lane → applicability rule;
  every action produces a `wise` constraint through the same forms as the
  norm builder. The BPMN remains a communication artefact; the norm is the
  source of truth, and the mapping is versioned with the norm.
- **What BPMN is not used for**: WISE is not conformance checking against
  the model. Overlays show expectation violations from the norm, never
  "fitness" or alignments; the UI wording keeps that distinction.
- **BPMN-lite**: the stage model and templates render natively in the core
  (tasks, XOR/AND gateways, start/end events, lanes) when a full modeler
  is too heavy, for example in the stage strip on the project dashboard.

## 5. Visualisation catalogue

| # | View | Answers | Data | Library | Tier |
|---|---|---|---|---|---|
| V1 | Process map with constraint overlays, abstraction sliders, semantic zoom (stage ↔ activity) | where in the flow do expectations fail | DFG per slice or global; constraint stats | core + React Flow / Canvas | M |
| V2 | Diff map slice vs rest (or period vs baseline) | what is different here | two DFGs on a stable layout | core | S |
| V3 | BPMN view with overlays | show it on our model | BPMN + mapping + constraint stats | bpmn-js | M |
| V4 | BPMN authoring of constraints | build the norm on the model | modeler events | bpmn-js modeler | S |
| V5 | Trace timeline (Gantt-like) with violated constraints annotated; multi-trace comparison | what happened in the worst cases | `trace()` + violations | core (D3 scales) | M |
| V6 | Variant strip / chevron sequences with frequency, violation share, per-slice filter | which paths carry the violations | variants per slice | core | S |
| V7 | Performance spectrum A → B over time | are lags drifting, batching, censoring | pairs of timestamps | core (Canvas) | S |
| V8 | Dotted chart (events over time by case, colour by activity or slice) | data quality, batching, censoring, seasonality | events sample | core (Canvas) | S |
| V9 | Distribution lens: histogram / ECDF with draggable threshold ϑ and width W, live `sat()` share | calibrate thresholds | raw signals (`signal_matrix`) | ECharts | M |
| V10 | Backlog visuals: volume × gap scatter with whiskers, concentration curve, typology quadrant, agreement matrix, gap waterfall, layer bars, penalty Pareto, headroom bars | prioritise and explain | backlog, drivers, bootstrap | ECharts | M |
| V11 | Period views: slope / dumbbell, control charts with limits, censoring control | is it moving | comparison tables, monitoring | ECharts | M / S |
| V12 | Hand-off network (resource or team graph), matrix alternative | where work bounces | `handoffs` recipe, resource pairs | Cytoscape.js | L |
| V13 | Stage funnel / Sankey between stages with drop-outs and loops | where cases stall or leave | stage transitions | ECharts Sankey | S |
| V14 | Small multiples: sparkline per slice row (gap over periods), mini-map thumbnails | scan many slices | period tables | ECharts / core | S |
| V15 | Case-flow animation (token replay on the map) for workshops | make the flow tangible | event sample | core (Canvas) | L |
| V16 | Object-centric graph (when the library supports OCEL notions) | multi-object flows | OCEL | core | L |

## 6. Design rules

- Server-side aggregation; payloads carry ids, counts and metrics, never
  raw events; samples for dotted charts and spectra are capped and
  stratified.
- Stable layouts for anything that is compared; positions cached per
  (norm fingerprint, mapping version, abstraction settings).
- Level of detail: labels, badges and arcs appear by zoom level; the map
  is readable at every level; a legend is always visible.
- Every view names its context (norm version, view, slice key, period) and
  links to the numbers it encodes.
- Colour: sequential scale for violation share and score, diverging for
  deltas, categorical per layer (stable by hashed layer id), fixed colours
  for hotspot types and gate states; patterns as redundancy; contrast
  ≥ 4.5:1; reduced motion respected.
- Accessibility: keyboard navigation over nodes and edges, ARIA
  descriptions, table alternative for every map and overlay.
- Export: SVG/PNG at figure sizes, print stylesheet, deterministic
  rendering so the same run gives the same figure; server-side Graphviz
  or headless Chromium (Playwright in the report worker) for scheduled
  reports.
- Performance targets: interactive map ≤ 100 ms per abstraction change
  for ≤ 300 nodes; Canvas renderer for ≤ 5k nodes / 20k edges at 60 fps
  pan and zoom; ELK layouts in a worker with cached results.

## 7. Roadmap and placement

- Phase 0: `wise-flow` repository scaffold (core model, ELK worker, React
  Flow scene), Storybook, visual regression; design tokens shared through
  a published tokens package or a copied CSS file.
- MVP: V1, V3, V5, V9, V10, V11 (basic); BPMN reference models for the
  P2P and credit-application packs; export SVG/PNG.
- v1: V2, V4, V6, V7, V8, V13, V14, control charts; hand-off network (V12)
  once the `handoffs` recipe exists in `wise-pm` 0.2.
- v2: V15, V16, server-side rendering for scheduled reports, `@wise/flow`
  1.0 on npm.

Risks: React Flow's SVG edges limit interactive scenes to a few thousand
elements (mitigated by the Canvas renderer and abstraction); ELK layout
time on large graphs (worker, caching, Dagre fallback); bpmn-js styling
and watermark constraints (accepted); layout instability across slices
(union-graph layout); overlay clutter (level of detail, per-layer
filters, table alternative).
