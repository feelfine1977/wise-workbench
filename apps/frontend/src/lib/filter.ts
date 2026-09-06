/**
 * The filter model (RF-01): one URL-safe JSON object in the `filter` search param scopes the map, the
 * ranked list, the analytics and the case list of a run. Clauses combine by AND; the map's click actions
 * add clauses through `addClause`; chips above the list remove them through `removeClause`.
 */
import type { Filter, FilterClause } from "@/lib/api/cycle2";

export const emptyFilter: Filter = { and: [] };

export function parseFilter(raw: unknown): Filter | undefined {
  if (!raw) return undefined;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const and = (value as { and?: unknown }).and;
  if (!Array.isArray(and)) return undefined;
  const clauses = and.filter((c): c is FilterClause => typeof c === "object" && c !== null && typeof (c as { kind?: unknown }).kind === "string");
  return clauses.length ? { and: clauses } : undefined;
}

export function serializeFilter(f: Filter | undefined): string | undefined {
  return f && f.and.length ? JSON.stringify(f) : undefined;
}

/** A stable key per clause so the same clause is never added twice. */
export function clauseKey(c: FilterClause): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sorted(c));
}

export function addClause(f: Filter | undefined, clause: FilterClause): Filter {
  const current = f?.and ?? [];
  const key = clauseKey(clause);
  if (current.some((c) => clauseKey(c) === key)) return { and: current };
  return { and: [...current, clause] };
}

export function removeClause(f: Filter | undefined, index: number): Filter | undefined {
  const next = (f?.and ?? []).filter((_, i) => i !== index);
  return next.length ? { and: next } : undefined;
}

/** Plain-words description of a clause; `labelOf` turns activity ids into labels. */
export function describeClause(c: FilterClause, labelOf: (id: string) => string = (id) => id): string {
  switch (c.kind) {
    case "activity": {
      const a = labelOf(c.activity);
      return c.op === "contains" ? `cases with ${a}` : c.op === "never" || c.op === "not_contains" ? `cases without ${a}` : c.op === "starts_with" ? `cases starting with ${a}` : `cases ending with ${a}`;
    }
    case "follows":
      return `${labelOf(c.a)} ${c.never ? "never " : ""}${c.directly ? "directly " : ""}followed by ${labelOf(c.b)}`;
    case "lag": {
      const unit = { D: "days", H: "hours", M: "minutes", S: "seconds" }[c.unit ?? "D"];
      const range = c.min !== undefined && c.max !== undefined ? `${c.min}–${c.max} ${unit}` : c.min !== undefined ? `at least ${c.min} ${unit}` : c.max !== undefined ? `at most ${c.max} ${unit}` : "";
      return `${labelOf(c.a)} to ${labelOf(c.b)} ${range}`.trim();
    }
    case "count": {
      const a = labelOf(c.activity);
      return c.min !== undefined && c.max !== undefined ? `${a} ${c.min}–${c.max} times` : c.min !== undefined ? `${a} at least ${c.min} times` : `${a} at most ${c.max ?? 0} times`;
    }
    case "open":
      return c.value ? "still open at the end of the data" : "closed cases only";
    case "attribute": {
      if (c.missing) return `${c.field.replace(/^case /, "")} missing`;
      if (c.in) return `${c.field.replace(/^case /, "")} is ${c.in.join(", ")}`;
      if (c.not_in) return `${c.field.replace(/^case /, "")} is not ${c.not_in.join(", ")}`;
      if (c.range) return `${c.field.replace(/^case /, "")} between ${c.range[0] ?? "…"} and ${c.range[1] ?? "…"}`;
      return c.field;
    }
    case "time":
      return `${(c.field ?? "case_start").replace("_", " ")} ${c.from ?? "…"} to ${c.to ?? "…"}`;
    case "constraint":
      return `${c.label ?? c.constraint}: ${c.state.replace("_", " ")}`;
    case "slice":
      return `${c.slicing.replace(/^case /, "")} = ${Array.isArray(c.key) ? c.key.join(" × ") : String(c.key)}`;
    case "any":
      return c.clauses.map((x) => describeClause(x, labelOf)).join(" or ");
    default:
      return JSON.stringify(c);
  }
}

/** The clause the map's actions add for an activity or a path (the library's `clauseForTarget` in the contract's shapes). */
export function clauseForActivity(activityId: string, action: "keep" | "exclude"): FilterClause {
  return { kind: "activity", op: action === "keep" ? "contains" : "never", activity: activityId };
}

export function clauseForPath(a: string, b: string, action: "keep" | "exclude"): FilterClause {
  return { kind: "follows", a, b, directly: true, ...(action === "exclude" ? { never: true } : {}) };
}

/** The same clause with every activity reference (`activity`, `a`, `b`) passed through `fn`: node ids to labels for the backend, labels to ids for the map. */
export function mapActivities(c: FilterClause, fn: (activity: string) => string): FilterClause {
  switch (c.kind) {
    case "activity":
    case "count":
      return { ...c, activity: fn(c.activity) };
    case "follows":
    case "lag":
      return { ...c, a: fn(c.a), b: fn(c.b) };
    case "any":
      return { ...c, clauses: c.clauses.map((x) => mapActivities(x, fn)) };
    default:
      return c;
  }
}

export function mapFilterActivities(f: Filter, fn: (activity: string) => string): Filter {
  return { and: f.and.map((c) => mapActivities(c, fn)) };
}

/** The clauses of `next` that `prev` did not have. */
export function addedClauses(prev: Filter | undefined, next: Filter | undefined): FilterClause[] {
  const had = new Set((prev?.and ?? []).map(clauseKey));
  return (next?.and ?? []).filter((c) => !had.has(clauseKey(c)));
}
