import type { RunWithScope } from "@/lib/api/runs";
import { selectionIdOf } from "@/lib/api/runs";
import type { Filter, FilterClause } from "@/lib/api/filter-types";
import { serializeFilter } from "@/lib/filter";
import { readGrouping } from "@/lib/grouping";
import { fmtNum } from "@/lib/format";

type Slicings = RunWithScope["slicings"];
type ChartSelection = { supported: true; filterText?: string; filter?: Filter } | { supported: false; reason: string };
const unavailable = (reason: string): ChartSelection => ({ supported: false, reason });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Translate only equivalent raw-attribute groups. Preserve unknown filter qualifiers for server refusal. */
export function chartSelection(filterText: string | undefined, within: string | undefined, slicings: Slicings): ChartSelection {
  let filter: Filter | undefined;
  try {
    if (filterText !== undefined) {
      const raw: unknown = JSON.parse(filterText);
      if (!object(raw) || Object.keys(raw).some(k => k !== "and") || !Array.isArray(raw.and) || !raw.and.every(c => object(c) && typeof c.kind === "string")) return unavailable("The chart filter cannot be read exactly.");
      filter = raw as unknown as Filter;
    }
    if (within === undefined) return { supported: true, filter, filterText };
    const parent: unknown = JSON.parse(within);
    if (!object(parent) || Object.keys(parent).some(k => k !== "slicing" && k !== "key") || typeof parent.slicing !== "string" || typeof parent.key !== "string") return unavailable("The parent-group selection cannot be read exactly.");
    let grouping = slicings?.find(s => s.id === parent.slicing);
    if (parent.slicing.startsWith("group:")) {
      const inline: unknown = JSON.parse(parent.slicing.slice(6));
      if (!object(inline) || Object.keys(inline).some(k => k !== "attributes" && k !== "bands")) return unavailable("This grouping has unsupported qualifiers.");
      grouping = readGrouping(parent.slicing);
    } else if (!grouping) {
      const known = new Set(slicings?.flatMap(s => s.attributes));
      const attributes = parent.slicing.split(/[+,]/).map(a => a.trim());
      if (attributes.length && attributes.every(a => known.has(a))) grouping = { attributes };
    }
    if (!grouping?.attributes.length || grouping.attributes.length > 3) return unavailable("The parent grouping cannot be resolved to its exact case attributes.");
    if (grouping.bands?.length) return unavailable("Banded parent groups cannot yet be applied exactly to these charts.");
    const values: unknown = JSON.parse(parent.key);
    if (!Array.isArray(values) || values.length !== grouping.attributes.length || !values.every(v => v === null || (typeof v === "string" && v.length > 0))) return unavailable("These group values cannot yet be applied exactly to the charts.");
    // The backend's slice mask treats null and '(missing)' as null OR empty OR the literal sentinel.
    const clauses: FilterClause[] = grouping.attributes.map((field, i) => ({ kind: "attribute", field, in: values[i] === null || values[i] === "(missing)" ? ["(missing)", ""] : [values[i] as string] }));
    const combined: Filter = { and: [...(filter?.and ?? []), ...clauses] };
    return { supported: true, filter: combined, filterText: serializeFilter(combined) };
  } catch {
    return unavailable("The chart selection cannot be read exactly.");
  }
}

export function calibrationSearch(run: Pick<RunWithScope, "caseTableId" | "scope">, constraint?: string) {
  return { caseTable: run.caseTableId, selection: selectionIdOf(run as RunWithScope), tab: "constraints" as const, constraint };
}

export const scoreOn100 = (score: unknown): string => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1 ? fmtNum(score * 100, 1) : "Unavailable";
