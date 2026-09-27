import type { ConstraintRelevance } from "@/lib/api/normRelevance";
import type { Constraint } from "./Builder";

export function constraintPriority(evidence?: ConstraintRelevance) {
  if (!evidence) return { tier: 1, deferred: false, label: "Coverage not checked" };
  if (evidence.casesInScope === 0) return { tier: 4, deferred: true, label: "0 applicable cases" };
  if (evidence.observedCases === 0) return { tier: 3, deferred: true, label: "0% observed activity coverage" };
  if (evidence.missingActivities.length) return { tier: 2, deferred: true, label: "Some activities not observed" };
  if (evidence.casesInScope == null || evidence.issues.length) return { tier: 1, deferred: false, label: "Check data or scope" };
  if (evidence.observedCases == null) return { tier: 1, deferred: false, label: "Applicable · check measurement" };
  return { tier: 0, deferred: false, label: "Activities observed" };
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
