import type { NormRelevance } from "@/lib/api/normRelevance";
import type { Constraint } from "./Builder";
export interface NormVisibility { minApplicability: number; hiddenLayers: string[]; hiddenConstraints: string[] }
export const allNormItems: NormVisibility = { minApplicability: 0, hiddenLayers: [], hiddenConstraints: [] };
export function constraintVisible(c: Constraint, visibility: NormVisibility, relevance?: NormRelevance): boolean {
  if (visibility.hiddenLayers.includes(c.layer) || visibility.hiddenConstraints.includes(c.id)) return false;
  if (visibility.minApplicability <= 0) return true;
  const applicable = relevance?.constraints.find(row => row.id === c.id)?.casesInScope;
  return !!relevance && relevance.cases > 0 && applicable != null && applicable * 100 >= visibility.minApplicability * relevance.cases;
}
