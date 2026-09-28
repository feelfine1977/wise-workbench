import type { ConstraintRelevance } from "@/lib/api/normRelevance";
import type { Constraint } from "./Builder";

export function constraintPriority(evidence?: ConstraintRelevance) {
  if (!evidence) return { tier: 1, deferred: false, label: "Coverage not checked" };
  if (evidence.casesInScope == null || !Number.isFinite(evidence.casesInScope) || evidence.casesInScope < 0) return { tier: 1, deferred: false, label: "Applicability unknown" };
  if (evidence.casesInScope === 0) return { tier: 4, deferred: true, label: "0 applicable cases" };
  if (evidence.issues.length) return { tier: 1, deferred: false, label: "Data issues to review" };
  if (evidence.observedCases === 0) return { tier: 3, deferred: true, label: "No referenced activities observed" };
  if (evidence.missingActivities.length) return { tier: 2, deferred: true, label: "Some referenced activities not observed" };
  if (evidence.observedCases == null || !Number.isFinite(evidence.observedCases) || evidence.observedCases < 0) return { tier: 1, deferred: false, label: "Activity coverage unavailable" };
  return { tier: 0, deferred: false, label: "Applicable · at least one referenced activity observed" };
}

/** Stable within an evidence tier; view weights never change a rule's applicability. */
export function orderConstraints(constraints: Constraint[], evidence: Map<string, ConstraintRelevance>, guided: boolean): Constraint[] {
  if (!guided) return [...constraints];
  return [...constraints].sort((a, b) => {
    const x = evidence.get(a.id), y = evidence.get(b.id);
    const rank = constraintPriority(x).tier - constraintPriority(y).tier;
    if (rank) return rank;
    const weight = (c: Constraint) => Number.isFinite(c.weight) ? c.weight! : 1;
    const importance = weight(b) - weight(a);
    if (importance) return importance;
    const share = (e?: ConstraintRelevance) => e?.casesInScope && e.observedCases != null ? e.observedCases / e.casesInScope : -1;
    return share(y) - share(x);
  });
}
