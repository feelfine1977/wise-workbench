/** One server-backed finding lookup shared by the editor and its surrounding navigation. */
import { useQuery } from "@tanstack/react-query";
import { reviewQuery, type ReviewItem } from "./review";

export interface FindingScope {
  projectId: string;
  runId: string;
  slicing: string;
  sliceKey: string;
  view?: string;
  filter?: string;
  within?: string;
}

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v);

function filterIdentity(value: unknown): string {
  if (value === undefined || value === null) return "null";
  try {
    const obj = (typeof value === "string" ? JSON.parse(value) : value) as { and?: unknown[] };
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return `invalid:${stableJson(value)}`;
    if ("and" in obj && (Object.keys(obj).length !== 1 || !Array.isArray(obj.and))) return `invalid:${stableJson(value)}`;
    const clauses = obj.and ?? (Object.keys(obj).length ? [obj] : []);
    if (!Array.isArray(clauses)) return `invalid:${stableJson(value)}`;
    return clauses.length ? JSON.stringify([...new Set(clauses.map(stableJson))].sort()) : "null";
  } catch {
    return `invalid:${String(value)}`;
  }
}

function keyIdentity(value: string | null | undefined): string {
  try { return stableJson(JSON.parse(value ?? "null")); } catch { return value ?? ""; }
}

/** The collection query resolves slicing aliases; never infer a finding from another selection. */
export function findingMatchesScope(finding: ReviewItem, scope: FindingScope): boolean {
  const c = finding.evidenceContext;
  return scope.within === undefined && finding.kind === "finding" && finding.projectId === scope.projectId && c?.runId === scope.runId &&
    c.view === scope.view && !!c.slicing && keyIdentity(c.sliceKey) === keyIdentity(scope.sliceKey) &&
    !!c.normVersionId && !!c.normFingerprint && !!c.manifestFingerprint &&
    filterIdentity(c.filter) === filterIdentity(scope.filter);
}

export function useScopedFinding(scope: FindingScope) {
  const query = useQuery({ ...reviewQuery(scope.projectId, "findings", scope), enabled: !!(scope.projectId && scope.runId && scope.slicing && scope.sliceKey) });
  const finding = query.isError ? undefined : [...(query.data ?? [])].filter((item) => findingMatchesScope(item, scope))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return { ...query, finding };
}
