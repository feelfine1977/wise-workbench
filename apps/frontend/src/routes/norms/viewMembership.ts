import type { NormDocument, NormView } from "./normAuthoring";

export const BENCHMARK_POLICY = "equal_layers_union_v1";
export function generalBenchmarkName(document: NormDocument): string | undefined {
  const marker = document.metadata?.general_benchmark as { policy?: string; name?: string } | undefined;
  return marker?.policy === BENCHMARK_POLICY ? marker.name : undefined;
}
export function rawViewWeights(document: NormDocument, view: NormView): Record<string, number> {
  const constraints = document.constraints ?? [];
  if (view.constraint_weights != null) return Object.fromEntries(constraints.map(c => [c.id, view.constraint_weights?.[c.id] ?? 0]));
  const total = (layer: string) => constraints.filter(c => c.layer === layer).reduce((sum, c) => sum + (c.weight ?? 1), 0);
  return Object.fromEntries(constraints.map(c => [c.id, total(c.layer) > 0 ? (view.layer_weights?.[c.layer] ?? 0) * (c.weight ?? 1) / total(c.layer) : 0]));
}
export function withGeneralBenchmark(document: NormDocument): NormDocument {
  const managed = generalBenchmarkName(document);
  const others = (document.views ?? []).filter(v => v.name !== managed);
  const constraints = document.constraints ?? [];
  const active = new Set(others.flatMap(v => Object.entries(rawViewWeights(document, v)).filter(([, w]) => w > 0).map(([id]) => id)));
  if (!others.length) constraints.filter(c => (c.weight ?? 1) > 0).forEach(c => active.add(c.id));
  if (!active.size && !managed) return document;
  const names = new Set(others.map(v => v.name));
  let name = managed ?? "General";
  if (names.has(name)) { name = "General benchmark"; let i = 2; while (names.has(name)) name = `General benchmark ${i++}`; }
  const count = (layer: string) => constraints.filter(c => c.layer === layer && active.has(c.id)).length;
  return { ...document, views: [...others, { name, constraint_weights: Object.fromEntries(constraints.map(c => [c.id, active.has(c.id) ? 1 / count(c.layer) : 0])), description: "General benchmark: every constraint used by any stakeholder view; equal total weight per participating layer and equal constraint shares within each layer." }], metadata: { ...document.metadata, general_benchmark: { policy: BENCHMARK_POLICY, name } } };
}
function direct(view: NormView, weights: Record<string, number>): NormView {
  const { layer_weights: _layers, ...rest } = view;
  return { ...rest, constraint_weights: weights };
}
export function layerTotal(document: NormDocument, view: NormView, layer: string): number {
  if (view.layer_weights != null) return view.layer_weights[layer] ?? 0;
  const weights = rawViewWeights(document, view);
  return (document.constraints ?? []).filter(c => c.layer === layer).reduce((sum, c) => sum + (weights[c.id] ?? 0), 0);
}
export function setViewLayerWeight(document: NormDocument, view: NormView, layer: string, weight: number): NormView {
  if (view.layer_weights != null) return { ...view, layer_weights: { ...view.layer_weights, [layer]: weight } };
  const weights = rawViewWeights(document, view);
  const members = (document.constraints ?? []).filter(c => c.layer === layer);
  const total = members.reduce((sum, c) => sum + (weights[c.id] ?? 0), 0);
  const base = members.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  for (const c of members) weights[c.id] = weight * (total > 0 ? (weights[c.id] ?? 0) / total : base > 0 ? (c.weight ?? 1) / base : 1 / members.length);
  return direct(view, weights);
}
/** Selected-view membership only. Preserve the layer's total importance when it still has members. */
export function setViewConstraintIncluded(document: NormDocument, view: NormView, id: string, included: boolean): NormView {
  const target = document.constraints?.find(c => c.id === id);
  if (!target) return view;
  const weights = rawViewWeights(document, view);
  const members = (document.constraints ?? []).filter(c => c.layer === target.layer);
  const previous = members.reduce((sum, c) => sum + (weights[c.id] ?? 0), 0);
  const peers = members.filter(c => c.id !== id && (weights[c.id] ?? 0) > 0);
  const basis = peers.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  weights[id] = included ? previous > 0 && basis > 0 ? previous * ((target.weight ?? 1) || 1) / basis : 1 : 0;
  const total = members.reduce((sum, c) => sum + (weights[c.id] ?? 0), 0);
  if (total > 0) for (const c of members) weights[c.id] = (weights[c.id] ?? 0) * (previous || 1) / total;
  return direct(view, weights);
}
