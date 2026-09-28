/** Describe only a complete, simple classification rule; never drop part of a compound rule. */
export function flowTypeDefinition(rule: unknown): { attribute: string; value: string } | undefined {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return;
  const r = rule as Record<string, unknown>;
  if (Object.keys(r).length !== 2 || typeof r.attr !== "string") return;
  if (typeof r.eq === "string") return { attribute: r.attr, value: r.eq };
  if (Array.isArray(r.in) && r.in.length && r.in.every((v) => typeof v === "string")) return { attribute: r.attr, value: r.in.join(" or ") };
}
