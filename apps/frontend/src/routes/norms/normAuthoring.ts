import type { Constraint } from "./Builder";

export interface NormLayer { id: string; name: string; description?: string }
export interface NormView {
  name: string;
  description?: string;
  layer_weights?: Record<string, number>;
  constraint_weights?: Record<string, number>;
}
export interface NormDocument extends Record<string, unknown> {
  name?: string;
  layers?: NormLayer[];
  views?: NormView[];
  constraints?: Constraint[];
  metadata?: Record<string, unknown> & { not_applicable?: Record<string, { constraint?: Constraint }> };
}

export const constraintName = (c: Constraint) => c.plain_name ?? c.description ?? c.id;
export const validWeight = (weight: number) => Number.isFinite(weight) && weight >= 0;

/** Validate authoring inputs, leaving engine validation and canonicalization to the API. */
export function structureIssues(norm: NormDocument): string[] {
  const layers = norm.layers ?? [];
  const constraints = norm.constraints ?? [];
  const views = norm.views ?? [];
  const issues: string[] = [];
  if (layers.some(l => !l.name.trim())) issues.push("Give each layer a name.");
  if (constraints.some(c => !layers.some(l => l.id === c.layer))) issues.push("Assign every constraint to a layer.");
  if (constraints.some(c => !validWeight(c.weight ?? 1))) issues.push("Constraint weights must be zero or a positive number.");
  if (views.some(v => !v.name.trim())) issues.push("Give each view a name.");
  if (new Set(views.map(v => v.name.trim())).size !== views.length) issues.push("Use a different name for each view.");
  if (views.some(v => Object.values(v.constraint_weights ?? v.layer_weights ?? {}).some(w => !validWeight(w)))) issues.push("View weights must be zero or a positive number.");
  if (views.some(v => !constraints.some(c => v.constraint_weights != null
    ? (v.constraint_weights[c.id] ?? 0) > 0
    : (v.layer_weights?.[c.layer] ?? 0) > 0 && (c.weight ?? 1) > 0))) issues.push("Each view needs a positive weight on at least one assigned constraint.");
  return issues;
}

/** IDs are stable references; the layer's editable business name is separate. */
export function nextLayerId(layers: NormLayer[]): string {
  let index = layers.length + 1;
  while (layers.some(l => l.id === `layer_${index}`)) index += 1;
  return `layer_${index}`;
}
