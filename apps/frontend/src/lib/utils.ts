import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable small hash for layer ids -> categorical palette index (max 8). */
export function hashIndex(id: string, modulo = 8): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % modulo;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Reads a column from a contract `Table` by name. */
export function tableColumn<T = unknown>(table: { columns: string[]; rows: unknown[][] } | undefined, name: string): T[] {
  if (!table) return [];
  const i = table.columns.indexOf(name);
  if (i < 0) return [];
  return table.rows.map((r) => r[i] as T);
}

/** Converts a contract `Table` into records keyed by column name. */
export function tableRecords<T extends Record<string, unknown> = Record<string, unknown>>(
  table: { columns: string[]; rows: unknown[][] } | undefined,
): T[] {
  if (!table) return [];
  return table.rows.map((r) => Object.fromEntries(table.columns.map((c, i) => [c, r[i]])) as T);
}

export function parseResultRef(ref: string | undefined): { kind: string; id: string } | undefined {
  if (!ref) return undefined;
  const i = ref.indexOf(":");
  if (i < 0) return undefined;
  return { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}

/** The finer attribute a group is drilled into (the backend's default drill-down keys for the BPIC 2019 mapping; vendor otherwise). */
export function drillAttributeFor(slicing: string): string {
  const attributes = slicing.split("+");
  const order = ["case Vendor", "case Spend area text", "case Company", "case Item Type", "case Document Type", "flow_type"];
  return order.find((a) => !attributes.includes(a)) ?? "case Vendor";
}

/** The group's display label: the key values joined by ×, from `keys` or the JSON-array key. */
export function sliceLabel(row: { key: string; keys?: Record<string, string> | null } | undefined): string {
  if (!row) return "";
  const values = Object.values(row.keys ?? {});
  if (values.length) return values.join(" × ");
  try {
    const parsed = JSON.parse(row.key) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join(" × ");
  } catch {
    /* a bare key */
  }
  return row.key;
}
