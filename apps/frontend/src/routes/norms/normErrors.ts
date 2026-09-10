import { ApiError } from "@/lib/api";

/** Only known norm refusals become specific advice; raw protocol text is not a user-facing label. */
export function normRefusal(error: unknown, names: Record<string, string>, action: "save" | "sign"): string {
  if (!(error instanceof ApiError)) return "The workbench could not be reached. Try again.";
  const code = error.problem?.code;
  if (code === "norm.rationale_required") {
    const fields = error.problem?.errors?.map(e => e.field) ?? [];
    const known = Object.entries(names).filter(([id, name]) => name !== id && (fields.includes(id) || new RegExp(`(^|[^\\w])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`).test(error.problem?.detail ?? "")));
    return known.length ? `Add a reason and an owner for ${known.map(([, name]) => `“${name}”`).join(", ")}.` : "Add a reason and an owner for each changed expectation.";
  }
  if (code === "norm.author") return "Enter the name of the person signing this version.";
  if (code === "norm.not_applicable_note") return "Explain why the expectation is outside scope or cannot be judged from this log.";
  if (code === "norm.transition" || error.status === 409) return "This version's status has changed. Reload the version before trying again.";
  if (error.status >= 500) return "The workbench could not answer just now. Try again.";
  return action === "save" ? "Check the edited rule and its scope, then try again." : "Check the version's recorded decisions, then try again.";
}

export function normConstraintNames(norm: Record<string, unknown> | undefined): Record<string, string> {
  const constraints = norm?.constraints;
  if (!Array.isArray(constraints)) return {};
  return Object.fromEntries(constraints.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const c = value as Record<string, unknown>;
    if (typeof c.id !== "string") return [];
    const name = typeof c.plain_name === "string" ? c.plain_name : typeof c.description === "string" ? c.description : "this expectation";
    return [[c.id, name]];
  }));
}
