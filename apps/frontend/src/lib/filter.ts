/**
 * The filter model (RF-01, third release §2.1): one URL-safe JSON object in the `filter` search param scopes
 * the map, the ranked list, the analytics, the board's panels and the case list of a run. Clauses combine by
 * AND, an `any` group by OR; the map's and the board's click actions add clauses through `addClause` and
 * `toggleClause`, chips remove them through `removeClause`.
 *
 * Canonical form (the flow library's `canonicalFilter`): aliases resolved (`not_contains` → `never`,
 * `mode` → `field`), value lists sorted, duplicates removed, keys written in a fixed order — so the same
 * selection always produces the same request and the same short hash (`fh`). The clauses themselves keep the
 * order in which they were added, because the chips read in that order (§2.2); everything that has to be
 * comparable between two people — the request, the hash, the cache key — goes through `canonicalFilter`.
 */
import type { Filter, FilterClause } from "@/lib/api/cycle2";
import { fmtInt } from "@/lib/format";

export const emptyFilter: Filter = { and: [] };

export function parseFilter(raw: unknown): Filter | undefined {
  if (!raw) return undefined;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
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
  return JSON.stringify(sorted(canonicalClause(c)));
}

/** One clause in the canonical form: aliases resolved, value lists sorted, empty fields dropped. */
export function canonicalClause(c: FilterClause): FilterClause {
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
  switch (c.kind) {
    case "activity":
      return clean({ ...c, op: c.op === "not_contains" ? "never" : c.op });
    case "attribute":
      return clean({ ...c, ...(c.in ? { in: [...c.in].sort() } : {}), ...(c.not_in ? { not_in: [...c.not_in].sort() } : {}) });
    case "any": {
      const inner = c.clauses.map(canonicalClause);
      const seen = new Map<string, FilterClause>();
      for (const x of inner) seen.set(JSON.stringify(x), x);
      return { kind: "any", clauses: [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, x]) => x) };
    }
    default:
      return clean({ ...c });
  }
}

/** The whole filter in the canonical form: every clause canonical, duplicates removed, clauses sorted. */
export function canonicalFilter(f: Filter | undefined): Filter {
  const seen = new Map<string, FilterClause>();
  for (const c of f?.and ?? []) seen.set(clauseKey(c), canonicalClause(c));
  return { and: [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => c) };
}

/** The short hash of the canonical filter (`fh` in the address): the same clicks give the same hash. */
export function filterHash(f: Filter | undefined): string | undefined {
  const canonical = canonicalFilter(f);
  if (!canonical.and.length) return undefined;
  const text = JSON.stringify(canonical);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function filterEquals(a: Filter | undefined, b: Filter | undefined): boolean {
  return JSON.stringify(canonicalFilter(a)) === JSON.stringify(canonicalFilter(b));
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

/** Whether a clause is already part of the filter (a second click on the same element removes it). */
export function hasClause(f: Filter | undefined, clause: FilterClause): boolean {
  const key = clauseKey(clause);
  return (f?.and ?? []).some((c) => clauseKey(c) === key);
}

/**
 * What a click on an element does (§4.5): the clause is added when it is not there and removed when it is.
 * Two values of the same field read as OR — clicking DF2 and then DF1 gives one chip *flow type: DF2 or DF1*,
 * and clicking DF2 again leaves *flow type: DF1*.
 */
export function toggleClause(f: Filter | undefined, clause: FilterClause): Filter | undefined {
  const current = f?.and ?? [];
  const key = clauseKey(clause);
  const at = current.findIndex((c) => clauseKey(c) === key);
  if (at >= 0) return removeClause(f, at);
  if (clause.kind === "attribute" && clause.in && clause.in.length && !clause.not_in && !clause.range && !clause.missing) {
    const i = current.findIndex((c) => c.kind === "attribute" && c.field === clause.field && !!c.in && !c.not_in && !c.range && !c.missing);
    if (i >= 0) {
      const existing = current[i] as Extract<FilterClause, { kind: "attribute" }>;
      const values = new Set(existing.in ?? []);
      let changed = false;
      for (const v of clause.in) {
        if (values.has(v)) {
          values.delete(v);
          changed = true;
        } else {
          values.add(v);
          changed = true;
        }
      }
      if (!changed) return f;
      const next = [...current];
      if (values.size === 0) next.splice(i, 1);
      else next[i] = { ...existing, in: [...values].sort() };
      return next.length ? { and: next } : undefined;
    }
  }
  return addClause(f, clause);
}

/** A clause that changes what a case contains rather than which cases are read (§2.2, second chip style). */
export function changesCases(c: FilterClause): boolean {
  if (c.kind === "time") return c.field === "events_inside";
  if (c.kind === "any") return c.clauses.some(changesCases);
  return false;
}

const UNIT_WORD: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2018 Q4", "October 2018", "2018" or the two dates, from a window's edges. */
export function periodLabel(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return `${from ?? "…"} to ${to ?? "…"}`;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} to ${to}`;
  const startsMonth = a.getUTCDate() === 1;
  const endsMonth = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate() === b.getUTCDate();
  if (startsMonth && endsMonth) {
    const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
    if (months === 12 && a.getUTCMonth() === 0) return `${a.getUTCFullYear()}`;
    if (months === 3 && a.getUTCMonth() % 3 === 0) return `${a.getUTCFullYear()} Q${Math.floor(a.getUTCMonth() / 3) + 1}`;
    if (months === 1) return `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  }
  return `${from.slice(0, 10)} to ${to.slice(0, 10)}`;
}

/**
 * Plain-words description of a clause, as the chips print it (§2.2): the words of the thing selected, never
 * the method's vocabulary and never an id. `labelOf` turns activity ids into labels.
 */
export function describeClause(c: FilterClause, labelOf: (id: string) => string = (id) => id): string {
  switch (c.kind) {
    case "activity": {
      const a = labelOf(c.activity);
      return c.op === "contains" ? `with ${a}` : c.op === "never" || c.op === "not_contains" ? `without ${a}` : c.op === "starts_with" ? `starting with ${a}` : `ending with ${a}`;
    }
    case "follows":
      return `${labelOf(c.a)} ${c.never ? "never " : ""}${c.directly ? "→ " : "followed by "}${labelOf(c.b)}`;
    case "lag": {
      const unit = UNIT_WORD[c.unit ?? "D"];
      const range = c.min !== undefined && c.max !== undefined ? `${c.min}–${c.max} ${unit}` : c.min !== undefined ? `at least ${c.min} ${unit}` : c.max !== undefined ? `at most ${c.max} ${unit}` : "";
      return `${labelOf(c.a)} to ${labelOf(c.b)} ${range}`.trim();
    }
    case "count": {
      const a = labelOf(c.activity);
      return c.min !== undefined && c.max !== undefined ? `${a} ${c.min}–${c.max} times` : c.min !== undefined ? `${a} at least ${c.min} times` : `${a} at most ${c.max ?? 0} times`;
    }
    case "open":
      return c.value ? "still open items only" : "closed items only";
    case "attribute": {
      const field = c.field.replace(/^case /, "").replace(/_/g, " ");
      if (c.missing) return `${field} missing`;
      if (c.in) return `${field}: ${c.in.join(" or ")}`;
      if (c.not_in) return `${field}: not ${c.not_in.join(" or ")}`;
      if (c.range) return `${field} between ${c.range[0] ?? "…"} and ${c.range[1] ?? "…"}`;
      return field;
    }
    case "time":
      return c.field === "events_inside" ? `only the events in ${periodLabel(c.from, c.to)}` : periodLabel(c.from, c.to);
    case "constraint":
      return `${c.label ?? c.constraint}: ${c.state.replace(/_/g, " ")}`;
    case "slice":
      return `${c.slicing.replace(/^case /, "")}: ${Array.isArray(c.key) ? c.key.join(" × ") : String(c.key)}`;
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

/** A stage band: any of its activities (exclude: one `never` per member). */
export function clauseForStage(activities: string[], action: "keep" | "exclude"): FilterClause[] {
  if (action === "exclude") return activities.map((a) => clauseForActivity(a, "exclude"));
  return [{ kind: "any", clauses: activities.map((a) => clauseForActivity(a, "keep")) }];
}

/** One value of a case attribute (a flow type, a vendor, a spend area) as the board's selectors and bars add it. */
export function clauseForValue(field: string, value: string): FilterClause {
  return { kind: "attribute", field, in: [value] };
}

/** A period selected on the breakdown, on the cases active in the window. */
export function clauseForPeriod(from: string, to: string): FilterClause {
  return { kind: "time", field: "active", from, to };
}

/** An expectation selected on an arc, a badge or beyond the expectation line. */
export function clauseForConstraint(constraint: string, state: "violating" | "in_scope", label?: string): FilterClause {
  return { kind: "constraint", constraint, state, ...(label ? { label } : {}) };
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

/** The clauses `prev` had and `next` does not. */
export function removedClauses(prev: Filter | undefined, next: Filter | undefined): FilterClause[] {
  const kept = new Set((next?.and ?? []).map(clauseKey));
  return (prev?.and ?? []).filter((c) => !kept.has(clauseKey(c)));
}

/**
 * What the live region says after a filter change (§2.4): the clause in plain words, the count in the run's
 * case noun and, on the board, how many panels answered. An action that removes nothing says so, so a filter
 * that keeps every item is never a silent button.
 */
export function announceFilter(
  change: { added: FilterClause[]; removed: FilterClause[] },
  counts: { casesIn: number; casesTotal: number } | undefined,
  noun: string,
  options: { panels?: number; labelOf?: (id: string) => string; removedNone?: boolean } = {},
): string | undefined {
  const words = (list: FilterClause[]) => list.map((c) => describeClause(c, options.labelOf)).join("; ");
  const head = change.added.length ? `Filter added: ${words(change.added)}` : change.removed.length ? `Filter removed: ${words(change.removed)}` : undefined;
  if (!head) return undefined;
  const count = counts ? ` — ${fmtInt(counts.casesIn)} of ${fmtInt(counts.casesTotal)} ${noun} remain` : "";
  const none = options.removedNone ? ` — no ${noun} removed` : "";
  const panels = options.panels ? `; ${options.panels} panels updated` : "";
  return `${head}${none || count}${panels}.`;
}
