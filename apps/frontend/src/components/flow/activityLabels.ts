import { activityReferences, type FlowGraph, type ActivityLabelOptions } from "@wise/flow";

export type LabelPreferences = Pick<ActivityLabelOptions, "mode" | "showCounts">;
const PREFERENCES = "wise.map.labels.v1";
const REFERENCES = "wise.map.activity-references.v1:";
const referenceRegistry = new Map<string, Record<string, string>>();

function read(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { return null; }
}
export function readLabelPreferences(): LabelPreferences {
  const value = read(PREFERENCES) as Partial<LabelPreferences> | null;
  return { mode: value?.mode === "ids" ? "ids" : "names", showCounts: value?.showCounts !== false };
}
export function saveLabelPreferences(value: LabelPreferences) {
  try { window.localStorage.setItem(PREFERENCES, JSON.stringify(value)); } catch { /* Preferences remain usable without storage. */ }
}
/** A project shares references across runs and flow scopes. Canonical activity IDs carry the identity. */
export function activityReferenceScope(pathname: string): string {
  return pathname.match(/^\/p\/[^/]+/)?.[0] ?? pathname;
}
export function readActivityReferences(graph: FlowGraph, scope: string): Record<string, string> {
  const value = read(REFERENCES + scope);
  const previous: Record<string, string> = { ...referenceRegistry.get(scope) };
  const used = new Set(Object.values(previous));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, ref] of Object.entries(value)) {
      if (Object.hasOwn(previous, id) || typeof ref !== "string" || !/^A\d+$/.test(ref) || used.has(ref) || !Number.isSafeInteger(Number(ref.slice(1))) || Number(ref.slice(1)) < 1) continue;
      Object.defineProperty(previous, id, { value: ref, enumerable: true, writable: true, configurable: true });
      used.add(ref);
    }
  }
  const references = activityReferences(graph, previous);
  // Several maps can mount in one render. Reserve references immediately so they cannot allocate the same ID differently.
  referenceRegistry.set(scope, references);
  return references;
}
export function saveActivityReferences(scope: string, references: Record<string, string>) {
  try { window.localStorage.setItem(REFERENCES + scope, JSON.stringify({ ...references, ...referenceRegistry.get(scope) })); } catch { /* In-memory labels still work. */ }
}
