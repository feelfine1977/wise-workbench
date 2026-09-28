import { validWeight, type NormDocument, type NormView } from "./normAuthoring";
import { generalBenchmarkName, layerTotal } from "./viewMembership";

export interface LayerPriorityProfile {
  view: NormView;
  basis: "Equal-layer reference" | "Direct weights summed by layer" | "Configured layer weights";
  values: { layer: string; weight: number; share: number | null }[];
  total: number;
  unavailable?: string;
}

/** A descriptive distribution of configured priorities, not an assessed contribution. */
export function layerPriorityProfile(document: NormDocument, view: NormView): LayerPriorityProfile {
  const layers = document.layers ?? [];
  const constraints = document.constraints ?? [];
  const benchmark = view.name === generalBenchmarkName(document);
  const direct = view.constraint_weights != null;
  const weights = view.constraint_weights ?? view.layer_weights ?? {};
  const totals = layers.map(layer => ({ layer: layer.id, weight: layerTotal(document, view, layer.id) }));
  const total = totals.reduce((sum, value) => sum + value.weight, 0);
  let unavailable: string | undefined;
  if (!layers.length) unavailable = "No layers to compare.";
  else if (constraints.some(c => !layers.some(layer => layer.id === c.layer))) unavailable = "Resolve expectations with missing layer assignments.";
  else if (view.constraint_weights != null && view.layer_weights != null) unavailable = "Resolve the two weight schemes in this view.";
  else if (Object.keys(weights).some(id => direct ? !constraints.some(c => c.id === id) : !layers.some(layer => layer.id === id))) unavailable = "Resolve weights referencing unknown layers or expectations.";
  else if (Object.values(weights).some(weight => !validWeight(weight)) || totals.some(value => !validWeight(value.weight)) || !Number.isFinite(total)) unavailable = "Correct invalid weights to compare this view.";
  else if (constraints.some(c => !validWeight(c.weight ?? 1))) unavailable = "Correct invalid expectation weights before comparison.";
  else if (benchmark && (document.views ?? []).some(v => v.name !== view.name && (
    Object.values(v.constraint_weights ?? v.layer_weights ?? {}).some(w => !validWeight(w)) ||
    (v.constraint_weights != null && v.layer_weights != null) ||
    Object.keys(v.constraint_weights ?? v.layer_weights ?? {}).some(id => v.constraint_weights != null ? !constraints.some(c => c.id === id) : !layers.some(l => l.id === id))
  ))) unavailable = "Correct stakeholder weights before comparing the derived reference.";
  else if (total === 0) unavailable = "No positive priority weight; profile unavailable.";
  return {
    view,
    basis: benchmark ? "Equal-layer reference" : direct ? "Direct weights summed by layer" : "Configured layer weights",
    values: totals.map(value => ({ ...value, share: unavailable ? null : value.weight / total })),
    total,
    unavailable,
  };
}
