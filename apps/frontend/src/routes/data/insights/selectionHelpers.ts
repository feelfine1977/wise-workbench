import type { EDANumericFacet, EDAJointPredicate } from "@/lib/api/eda";

export interface ExplorerScope {
  projectId: string; caseTableId: string; datasetId: string; attribute?: string; selection?: string;
}
export const explorerParams = ({ datasetId, attribute, selection }: ExplorerScope) => ({ datasetId, attribute, selection });

/** Compare decimal text without passing through IEEE-754 numbers. */
export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  const integer = (s: string) => { const [whole, fraction = ""] = s.split("."); return BigInt(`${whole}${fraction.padEnd(scale, "0")}`); };
  const x = integer(a), y = integer(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function numericLabel(f: EDANumericFacet) {
  return `${f.field}: ${[...f.ranges.map((r) => `[${r.min ?? "−∞"}, ${r.max ?? "+∞"})`), ...(f.missing ? ["missing / nonfinite"] : [])].join(" or ")}`;
}
export function jointLabel(branch: EDAJointPredicate) {
  return branch.facets.map((f) => `${f.field} = ${(f.values ?? []).concat(f.keys.map((key) => key === "other" ? "Other categories" : key === "missing" ? "Unknown / missing" : `saved category ${key}`)).join(" or ")}`).join(" AND ");
}


/** Value labels returned by the domain are exact normalized values; sentinels remain keys. */
export function contextPath(fields: string[], keys: string[], labels: string[]): EDAJointPredicate {
  return { facets: fields.map((field, i) => keys[i] === "other" || keys[i] === "missing"
    ? { field, keys: [keys[i]!] } : { field, keys: [], values: [labels[i]!] }) };
}
export function matchesContextPath(branch: EDAJointPredicate, fields: string[], keys: string[], labels: string[]) {
  return branch.facets.length === fields.length && fields.every((field, i) => {
    const facet = branch.facets.find((f) => f.field === field);
    return facet && facet.keys.length + (facet.values?.length ?? 0) === 1 &&
      (facet.keys.includes(keys[i]!) || Boolean(facet.values?.includes(labels[i]!)));
  });
}
