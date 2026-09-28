import type { NormDocument, NormView } from "./normAuthoring";
import { generalBenchmarkName, rawViewWeights, withGeneralBenchmark } from "./viewMembership";

export interface MembershipChange { view: string; constraint: string; included: boolean }

/** Change membership as a set, preserving each affected layer's total and retained ratios. */
export function membershipBatch(document: NormDocument, views: string[], ids: string[], included: boolean) {
  const selected = new Set(ids);
  const benchmark = generalBenchmarkName(document);
  const changes: MembershipChange[] = [];
  const constraints = document.constraints ?? [];
  const nextViews = (document.views ?? []).map(view => {
    if (view.name === benchmark || !views.includes(view.name)) return view;
    const before = rawViewWeights(document, view);
    const affected = constraints.filter(c => selected.has(c.id) && (before[c.id]! > 0) !== included);
    if (!affected.length) return view;
    const weights = { ...before };
    for (const layer of new Set(affected.map(c => c.layer))) {
      const members = constraints.filter(c => c.layer === layer);
      const total = members.reduce((sum, c) => sum + (before[c.id] ?? 0), 0);
      const retained = members.filter(c => before[c.id]! > 0);
      const basis = retained.reduce((sum, c) => sum + (c.weight ?? 1), 0);
      for (const c of affected.filter(c => c.layer === layer)) {
        // New members use within-layer weights relative to retained members; an empty layer starts at 1.
        weights[c.id] = included ? (c.weight || 1) * (basis > 0 ? total / basis : 1) : 0;
        changes.push({ view: view.name, constraint: c.id, included });
      }
      const nextTotal = members.reduce((sum, c) => sum + weights[c.id]!, 0);
      if (nextTotal > 0) for (const c of members) weights[c.id] = weights[c.id]! * (total || 1) / nextTotal;
    }
    // Explicit membership requires direct weights; other views and definitions remain untouched.
    const next: NormView = { ...view, constraint_weights: weights };
    delete next.layer_weights;
    return next;
  });
  return { document: changes.length ? withGeneralBenchmark({ ...document, views: nextViews }) : document, changes };
}
