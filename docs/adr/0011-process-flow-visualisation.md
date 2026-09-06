# ADR 0011 — Process-flow visualisation: own headless core, React Flow and Canvas renderers, bpmn-js for BPMN

Status: accepted (2026-09-05)

## Context
The workbench needs process maps with constraint overlays, BPMN views,
trace timelines and comparison maps; ECharts covers statistical charts but
not flows. The owner asked whether to build a library similar to JointJS.

## Decision
A project-owned headless core in **its own repository from day one**
(`wise-flow`, npm `@wise/flow`; owner decision 2026-09-05, an exception to
ADR 0010), consumed by the workbench as a dependency and linked locally
during development:
graph model with canonical activities and stages, directly-follows
aggregation with abstraction, ELK layout in a worker with stable positions
across compared scenes, metric-to-style scales, a constraint overlay
grammar, hit-testing and export. Renderers: React Flow for interactive
scenes, a Canvas renderer for large maps. BPMN 2.0 through bpmn-js with an
overlay bridge and a task ↔ canonical activity mapping; BPMN authoring of
constraints feeds the same forms as the norm builder. Cytoscape.js for
resource networks; ECharts for everything else. No general diagramming
editor is written; JointJS remains the alternative editor layer if port
routing and link tools become necessary.

## Consequences
Process-mining semantics live in one tested TypeScript core with its own
release cycle and a public API contract the workbench codes against; interaction and rendering stay thin; BPMN is a
communication and authoring surface, never a conformance reference; all
aggregation stays server-side.
