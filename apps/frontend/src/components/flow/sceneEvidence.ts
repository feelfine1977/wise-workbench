import { MAP_TARGET, type FlowGraph, type Overlay } from "@wise/flow";
import { fmtPct } from "@/lib/format";

export type EvidenceMode = "observed" | "wise";

export interface ConstraintEvidence {
  id: string;
  name: string;
  description: string;
  evaluated?: number;
  violationShare?: number;
  cases?: number;
  meanViolation?: number;
  layer?: string;
  layerName?: string;
  type?: string;
  threshold?: number;
  width?: number;
  unit?: string;
  direction?: string;
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const share = (value: unknown): number | undefined => {
  const n = finite(value);
  return n !== undefined && n >= 0 && n <= 1 ? n : undefined;
};

// Names of the bundled purchase-to-pay norms; response-supplied names always take precedence.
const LAYER_NAMES: Record<string, string> = {
  L1_closure_completeness: "Expected completion and closure",
  L2_flow_discipline: "Flow-conditioned control discipline",
  L3_timeliness_ageing: "Handovers and ageing",
  L4_rework_instability: "Rework and instability",
  L5_exceptions_corrections: "Exceptions and corrections",
  L6_value_commercial: "Value and commercial integrity",
  L7_effort_automation: "Effort and automation friction",
  RP_corrections: "Correction and repetition candidates",
  RP_invoice_capture: "Invoice capture and ordering evidence",
  RP_settlement: "Settlement review candidates",
  RP_automation: "Automation and transfer evidence",
};

export function constraintLayerName(layer: string): string {
  return LAYER_NAMES[layer] ?? (/^L\d+$/.test(layer) ? `Layer ${layer}` : layer.replace(/^L\d+_/, "").replace(/_/g, " "));
}

function suppliedLayerNames(meta: Record<string, unknown>): Map<string, string> {
  const layers = meta.layers;
  const entries = Array.isArray(layers) ? layers.map((layer) => [record(layer).id, layer]) : Object.entries(record(layers));
  const names = new Map<string, string>();
  for (const [id, layer] of entries) {
    const entry = record(layer);
    const name = text(layer) ?? text(entry.name) ?? text(entry.label) ?? text(entry.plain_name);
    if (typeof id === "string" && name) names.set(id, name);
  }
  return names;
}

// These describe the aggregate norm, not a recorded transition or the selected constraint.
// Remove comparison counterparts too, while keeping counts, shares, timing and other observations.
const observedMetrics = (metrics: FlowGraph["nodes"][number]["metrics"]) => metrics === undefined ? undefined : Object.fromEntries(
  Object.entries(metrics).filter(([key]) => !/^(?:(?:a|delta)_)*(?:violationShare|violation_share|shareViolated|meanViolation)$/.test(key)),
);

/** Constraint relations are assertions, not observed routes and not layout inputs. */
export function observedProcessGraph(graph: FlowGraph): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, metrics: observedMetrics(node.metrics) })),
    edges: graph.edges.filter((edge) => edge.kind === "follows" || edge.kind === "flow").map((edge) => ({ ...edge, metrics: observedMetrics(edge.metrics) })),
    overlays: [],
  };
}

/** Keep every supplied constraint selectable, including those without drawable endpoints. */
export function constraintEvidence(graph: FlowGraph, plainOf?: (id: string) => string): ConstraintEvidence[] {
  const choices = new Map<string, ConstraintEvidence>();
  const meta = record(graph.meta);
  const layerNames = suppliedLayerNames(meta);
  for (const item of Array.isArray(meta.constraints) ? meta.constraints : []) {
    const entry = record(item);
    const description = record(entry.description);
    const id = text(description.id);
    if (!id) continue;
    const stats = record(entry.stats);
    const params = record(description.params);
    const plain = plainOf?.(id);
    const meaning = text(description.description);
    const label = text(description.label);
    choices.set(id, {
      id,
      name: plain && plain !== id ? plain : label && label !== id ? label : meaning ?? id,
      description: meaning ?? (plain && plain !== id ? plain : "No constraint description was supplied."),
      evaluated: count(stats.evaluated),
      violationShare: share(stats.violationShare),
      cases: count(meta.cases) ?? count(stats.cases),
      meanViolation: share(stats.meanViolation),
      layer: text(description.layer),
      layerName: text(description.layer) ? layerNames.get(String(description.layer)) ?? text(description.layerName) ?? constraintLayerName(String(description.layer)) : undefined,
      type: text(description.type),
      threshold: finite(params.threshold),
      width: finite(params.width),
      unit: text(params.unit),
      direction: text(params.direction),
    });
  }
  for (const overlay of graph.overlays ?? []) {
    const payload = record(overlay.payload);
    const id = text(payload.constraintId);
    if (!id) continue;
    const previous = choices.get(id);
    const plain = plainOf?.(id);
    const meaning = text(payload.description);
    const label = text(payload.label);
    choices.set(id, {
      id,
      name: previous?.name ?? (plain && plain !== id ? plain : label && label !== id ? label : meaning ?? id),
      description: previous?.description ?? meaning ?? (plain && plain !== id ? plain : "No constraint description was supplied."),
      evaluated: previous?.evaluated ?? count(payload.casesEvaluated),
      // A visual value can be a raw reverse-order or threshold share, not WISE violation.
      violationShare: previous?.violationShare ?? share(payload.shareViolated),
      cases: previous?.cases ?? count(meta.cases),
      meanViolation: previous?.meanViolation ?? share(payload.meanViolation),
      layer: previous?.layer ?? text(payload.layer),
      layerName: previous?.layerName ?? (text(payload.layer) ? layerNames.get(String(payload.layer)) ?? text(payload.layerName) ?? constraintLayerName(String(payload.layer)) : undefined),
      type: previous?.type ?? text(payload.constraintType) ?? text(payload.type),
      threshold: previous?.threshold ?? finite(payload.threshold),
      width: previous?.width ?? finite(payload.width),
      unit: previous?.unit ?? text(payload.unit),
      direction: previous?.direction ?? text(payload.direction),
    });
  }
  const rank = (choice: ConstraintEvidence) => choice.evaluated === 0 ? -1 : choice.violationShare ?? -1;
  return [...choices.values()].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
}

/** Exactly one constraint's visual evidence; never synthesise process edges from its endpoints. */
export function overlaysForConstraint(graph: FlowGraph, scene: FlowGraph, constraintId?: string): Overlay[] {
  if (!constraintId) return [];
  const known = new Set([...scene.nodes.map((n) => n.id), ...(scene.groups ?? []).map((g) => g.id), MAP_TARGET]);
  const result = constraintEvidence(graph).find((c) => c.id === constraintId);
  // Lag misses can include missing endpoints. Without their policy, do not call every miss a late duration.
  const evaluated = result?.evaluated;
  const available = evaluated !== undefined && evaluated > 0 && (result?.cases === undefined || evaluated <= result.cases) && result?.violationShare !== undefined;
  const displayLabel = available ? `${fmtPct(result.violationShare, 1)} miss constraint` : evaluated === 0 ? "Not evaluated" : "WISE result unavailable";
  return (graph.overlays ?? []).filter((overlay) => {
    if (overlay.payload?.constraintId !== constraintId) return false;
    if (overlay.kind === "arc") return known.has(String(overlay.payload.source)) && known.has(String(overlay.payload.target));
    return known.has(overlay.target);
  }).map((overlay) => overlay.kind === "arc" ? { ...overlay, payload: { ...overlay.payload, displayLabel } } : overlay);
}


/** Independent results and overlays for each chosen constraint, without combining their case populations. */
export function overlaysForConstraints(graph: FlowGraph, scene: FlowGraph, constraintIds: readonly string[]): Overlay[] {
  return [...new Set(constraintIds)].flatMap((id) => overlaysForConstraint(graph, scene, id));
}
