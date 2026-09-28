import { http, HttpResponse } from "msw";
import type { EDAResult } from "@/lib/api/eda";
import { db } from "./db";
import { edaCases } from "./fixtures/eda";

type DemoCase = (typeof edaCases)[number];
type Insights = NonNullable<EDAResult["insights"]>;
class EDAError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// The illustrative mapping uses the default missing sentinel. Display labels are ordinary values.
const categoryValue = (value: unknown): string | null => value == null || value === "" || value === "(missing)" ? null : typeof value === "boolean" ? (value ? "True" : "False") : String(value);
const eventCuts = [0, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500];
const sumEvents = (rows: DemoCase[]) => rows.reduce((sum, row) => sum + (row.events ?? 0), 0);
const quantile = (values: (number | null)[], p: number) => {
  const sorted = values.filter((n): n is number => n !== null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p, lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
};
const counts = (selected: DemoCase[], predicate: (row: DemoCase) => boolean) => ({ total: edaCases.filter(predicate).length, selected: selected.filter(predicate).length });
const attributes = ["flow_type", "vendor"] as const;
type Attribute = (typeof attributes)[number];
const attr = (value: unknown, status = 422): Attribute => {
  if (!attributes.includes(value as Attribute)) throw new EDAError("Unknown EDA attribute", status);
  return value as Attribute;
};
function domain(field: Attribute) {
  const totals = new Map<string, number>();
  for (const row of edaCases) {
    const value = categoryValue(row[field]);
    if (value !== null && [...value].length <= 512) totals.set(value, (totals.get(value) ?? 0) + 1);
  }
  const values = [...totals].sort(([a, an], [b, bn]) => bn - an || compare(a, b)).slice(0, 20).map(([value]) => value);
  const keys = new Map(values.map((value, i) => [value, `v${i + 1}`]));
  const categories: Omit<EDAResult["categories"][number], "total" | "selected">[] = values.map((value) => ({ key: keys.get(value)!, label: value, kind: "value", value }));
  categories.push({ key: "other", label: "Other categories", kind: "other", value: null }, { key: "missing", label: "Unknown / missing", kind: "missing", value: null });
  return { field, categories, keyOf: (row: DemoCase) => { const value = categoryValue(row[field]); return value === null ? "missing" : keys.get(value) ?? "other"; } };
}
type Domain = ReturnType<typeof domain>;

const validKeys = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unsupported EDA filter fields");
};
const bad = (status: number, detail: string) => HttpResponse.json({ type: "about:blank", title: "EDA request rejected", detail, status, code: "eda.mock_selection", errors: [] }, { status });
const numeric = (params: URLSearchParams, name: string, fallback?: number): number | undefined => {
  const raw = params.get(name);
  const n = raw === null ? fallback : Number(raw);
  if (n !== undefined && (!Number.isFinite(n) || n < 0 || raw === "")) throw new Error(`Invalid ${name}`);
  return n;
};
const flag = (params: URLSearchParams, name: string) => {
  const value = params.get(name)?.toLowerCase() ?? null;
  const truthy = ["1", "true", "t", "yes", "y", "on"], falsy = ["0", "false", "f", "no", "n", "off"];
  if (value !== null && ![...truthy, ...falsy].includes(value)) throw new Error(`Invalid ${name}`);
  return value !== null && truthy.includes(value);
};

const utcStamp = (value: string) => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}${value.includes("T") ? "" : "T00:00:00"}Z`);

function matchesFilter(raw: string | null): (row: DemoCase) => boolean {
  if (raw === null) return () => true;
  const decoded: unknown = JSON.parse(raw);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid filter object");
  const object = decoded as Record<string, unknown>;
  const clauses = "and" in object ? object.and : Object.keys(object).length ? [object] : [];
  if ("and" in object) validKeys(object, ["and"]);
  if (!Array.isArray(clauses)) throw new Error("Invalid filter.and");
  const tests = clauses.map((value: unknown): ((row: DemoCase) => boolean) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid filter clause");
    const clause = value as Record<string, unknown>;
    if (clause.kind === "attribute") {
      validKeys(clause, ["kind", "field", "eq", "in", "min", "max"]);
      const field = attr(clause.field);
      const forms = Number("eq" in clause) + Number("in" in clause) + Number("min" in clause || "max" in clause);
      if (forms !== 1) throw new Error("Invalid attribute filter");
      if ("eq" in clause) {
        if (!["string", "number", "boolean"].includes(typeof clause.eq)) throw new Error("Invalid eq");
        return (row) => row[field] !== null && String(row[field]) === String(clause.eq);
      }
      if ("in" in clause) {
        if (!Array.isArray(clause.in) || !clause.in.length || clause.in.some((v) => !["string", "number", "boolean"].includes(typeof v))) throw new Error("Invalid in");
        const values = clause.in.map(String);
        return (row) => row[field] === null ? values.includes("(missing)") || values.includes("") : values.includes(row[field]!);
      }
      for (const key of ["min", "max"]) if (clause[key] !== undefined && (typeof clause[key] !== "number" || !Number.isFinite(clause[key]))) throw new Error("Invalid bound");
      if (typeof clause.min === "number" && typeof clause.max === "number" && clause.min > clause.max) throw new Error("Reversed attribute range");
      return (row) => row[field] !== null && Number.isFinite(Number(row[field])) && (clause.min === undefined || Number(row[field]) >= Number(clause.min)) && (clause.max === undefined || Number(row[field]) <= Number(clause.max));
    }
    if (clause.kind === "time") {
      validKeys(clause, ["kind", "field", "from", "to"]);
      const field = clause.field ?? "case_start";
      if (!["case_start", "first_ts", "start", "case_end", "last_ts", "end"].includes(String(field))) throw new Error("Unsupported time field");
      if (!("from" in clause || "to" in clause)) throw new Error("Time range needs a bound");
      for (const key of ["from", "to"]) if (clause[key] !== undefined && (typeof clause[key] !== "string" || !Number.isFinite(utcStamp(String(clause[key]))))) throw new Error("Invalid time bound");
      const from = clause.from === undefined ? -Infinity : utcStamp(String(clause.from));
      const to = clause.to === undefined ? Infinity : utcStamp(String(clause.to));
      if (from > to) throw new Error("Reversed time range");
      return (row) => {
        const stamp = ["case_start", "first_ts", "start"].includes(String(field)) ? row.firstRecorded : row.lastRecorded;
        return stamp !== null && utcStamp(stamp) >= from && utcStamp(stamp) <= to;
      };
    }
    throw new Error("Only case attribute and start/end time filters are supported");
  });
  return (row) => tests.every((test) => test(row));
}

/** Preserve int64 JSON boundaries before JSON.parse can round them across the exclusive upper bound. */
function selectionJSON(raw: string): unknown {
  let prefix = "__eda_integer__";
  while (raw.includes(prefix)) prefix += "_";
  const integers = new Map<string, bigint>();
  const encoded = raw.replace(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
      const key = `${prefix}${integers.size}`;
      integers.set(key, BigInt(token));
      return JSON.stringify(key);
    }
    return token;
  });
  return JSON.parse(encoded, (_key, value: unknown) => typeof value === "string" && integers.has(value) ? integers.get(value) : value);
}

/** One evaluator for GET and saved-cohort resolution, including nondisplayed facets. */
function matchesSelection(raw: string | null, keys: string[], keyOf: (row: DemoCase) => string) {
  if (raw === null) return () => true;
  if (raw.length < 2 || raw.length > 131072) throw new Error("Invalid selection length");
  const selection = selectionJSON(raw);
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("Invalid selection");
  const s = selection as Record<string, unknown>;
  validKeys(s, ["numericFacets", "jointAny", "facets", "eventRanges", "eventMissing", "categoryKeys", "timeRanges", "timeMissing", "spanRanges", "spanMissing"]);
  for (const field of ["timeMissing", "spanMissing", "eventMissing"]) if (s[field] !== undefined && typeof s[field] !== "boolean") throw new Error("Invalid missing flag");
  for (const [field, limit] of [["numericFacets", 16], ["jointAny", 24], ["facets", 16], ["eventRanges", 11], ["categoryKeys", 22], ["timeRanges", 121], ["spanRanges", 11]] as const) {
    if (s[field] != null && (!Array.isArray(s[field]) || !s[field].length || s[field].length > limit)) throw new Error("Invalid selection list");
  }
  const wanted = s.categoryKeys as string[] | null | undefined;
  if (wanted?.some((k) => typeof k !== "string" || !keys.includes(k))) throw new Error("Unknown category key");
  const readFacets = (list: unknown[]) => {
    const fields = new Set<string>();
    return list.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid facet");
      const facet = value as Record<string, unknown>;
      validKeys(facet, ["field", "keys", "values"]);
      if (typeof facet.field !== "string" || !facet.field.length || facet.field.length > 256 || fields.has(facet.field)) throw new Error("Invalid or duplicate facet field");
      fields.add(facet.field);
      const keys = facet.keys ?? [], values = facet.values ?? [];
      if (!Array.isArray(keys) || keys.length > 22 || keys.some((key) => typeof key !== "string" || !key.length || key.length > 32)) throw new Error("Invalid facet keys");
      if (!Array.isArray(values) || values.length > 50 || values.some((value) => typeof value !== "string" || !value.length || [...value].length > 4096) || (!keys.length && !values.length)) throw new Error("Invalid exact values");
      const field = attr(facet.field, 400), d = domain(field);
      if (keys.some((key) => !d.categories.some((category) => category.key === key))) throw new EDAError("Unknown facet key", 400);
      return (row: DemoCase) => keys.includes(d.keyOf(row)) || (categoryValue(row[field]) !== null && values.includes(categoryValue(row[field])));
    });
  };
  const facetTests = readFacets((s.facets ?? []) as unknown[]);
  const branches = ((s.jointAny ?? []) as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid joint branch");
    const branch = value as Record<string, unknown>;
    validKeys(branch, ["facets"]);
    if (!Array.isArray(branch.facets) || !branch.facets.length || branch.facets.length > 3) throw new Error("A branch needs 1–3 distinct fields");
    return readFacets(branch.facets);
  });
  // This fixed demo contains two text context fields and no typed numeric attribute.
  if (s.numericFacets != null) throw new Error("The demo has no typed numeric case attribute; use a prepared dataset for numeric attribute ranges.");
  const ranges = (field: "timeRanges" | "spanRanges") => ((s[field] ?? []) as unknown[]).map((range) => {
    if (!range || typeof range !== "object" || Array.isArray(range)) throw new Error("Invalid range");
    const r = range as Record<string, unknown>;
    const time = field === "timeRanges", lo = time ? "from" : "min", hi = time ? "before" : "max";
    validKeys(r, [lo, hi]);
    if (r[lo] == null && r[hi] == null) throw new Error("Range needs a bound");
    const bound = (key: string, fallback: number) => {
      if (r[key] == null) return fallback;
      if (time ? typeof r[key] !== "string" || String(r[key]).length > 64 || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(String(r[key])) : typeof r[key] !== "number" || Number(r[key]) < 0) throw new Error("Invalid bound");
      const value = time ? utcStamp(String(r[key])) : Number(r[key]);
      if (!Number.isFinite(value)) throw new Error("Invalid bound");
      return value;
    };
    const lower = bound(lo, -Infinity), upper = bound(hi, Infinity);
    if (lower >= upper) throw new Error("Reversed range");
    return { lower, upper };
  });
  const times = ranges("timeRanges"), spans = ranges("spanRanges");
  const events = ((s.eventRanges ?? []) as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid event range");
    const range = value as Record<string, unknown>;
    validKeys(range, ["min", "max"]);
    const bound = (value: unknown) => {
      if (value == null) return null;
      if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value))) throw new Error("Event bounds must be integers");
      const n = BigInt(value as bigint | number);
      if (n < 0n || n > 9223372036854775807n) throw new Error("Event bounds must be nonnegative int64 values");
      return n;
    };
    const min = bound(range.min), max = bound(range.max);
    if ((min === null && max === null) || (min !== null && max !== null && min >= max)) throw new Error("Invalid event range");
    return { min, max };
  });
  return (row: DemoCase) => (!wanted || wanted.includes(keyOf(row)))
    && facetTests.every((test) => test(row))
    && (!branches.length || branches.some((tests) => tests.every((test) => test(row))))
    && (!(events.length || s.eventMissing) || (row.events === null ? s.eventMissing === true : events.some(({ min, max }) => (min === null || BigInt(row.events!) >= min) && (max === null || BigInt(row.events!) < max))))
    && (!(times.length || s.timeMissing) || (row.firstRecorded === null ? s.timeMissing === true : times.some((r) => utcStamp(row.firstRecorded!) >= r.lower && utcStamp(row.firstRecorded!) < r.upper)))
    && (!(spans.length || s.spanMissing) || (row.spanDays === null ? s.spanMissing === true : spans.some((r) => row.spanDays! >= r.lower && row.spanDays! < r.upper)));
}

function insights(selected: DemoCase[], primary: Domain, comparison: Attribute | null, spans: EDAResult["spans"]): Insights {
  const domains = [primary, ...(comparison !== null && comparison !== primary.field ? [domain(comparison)] : [])];
  const facets = domains.map((d) => ({ field: d.field, categories: d.categories.map((c) => ({ ...c, ...counts(selected, (row) => d.keyOf(row) === c.key) })) }));
  const right = domains[1];
  const joint = right ? primary.categories.flatMap((left) => right.categories.map((r) => ({ leftKey: left.key, rightKey: r.key, ...counts(selected, (row) => primary.keyOf(row) === left.key && right.keyOf(row) === r.key) }))) : [];
  const inBin = (n: number | null, bin: { min: number | null; max: number | null; missing: boolean }) => bin.missing ? n === null : n !== null && n >= bin.min! && (bin.max === null || n < bin.max);
  const eventBins: Insights["eventBins"] = eventCuts.map((min, i) => {
    const max = eventCuts[i + 1] ?? null, bin = { min, max, missing: false };
    return { key: String(i), label: max === null ? `≥${min} events` : `${min}–<${max} events`, ...bin, ...counts(selected, (r) => inBin(r.events, bin)) };
  });
  if (edaCases.some((r) => r.events === null)) eventBins.push({ key: "missing", label: "Unknown event count", min: null, max: null, missing: true, ...counts(selected, (r) => r.events === null) });
  const density = spans.flatMap((span) => eventBins.map((event) => ({ spanKey: span.key, eventKey: event.key, ...counts(selected, (row) => inBin(row.spanDays, span) && inBin(row.events, event)) })));
  const concentration = primary.categories.map((c) => {
    const rows = selected.filter((row) => primary.keyOf(row) === c.key);
    return {
      key: c.key, label: c.label, ...counts(selected, (row) => primary.keyOf(row) === c.key),
      knownSpanCases: rows.filter((row) => row.spanDays !== null).length,
      unknownSpanCases: rows.filter((row) => row.spanDays === null).length,
      unknownEventCases: rows.filter((row) => row.events === null).length,
      medianSpanDays: quantile(rows.map((r) => r.spanDays), .5), p90SpanDays: quantile(rows.map((r) => r.spanDays), .9), events: sumEvents(rows),
    };
  });
  const columns: { name: string; field: keyof DemoCase; dataType: string; role: Insights["fields"][number]["role"] }[] = [
    { name: "caseId", field: "caseId", dataType: "string", role: "case_id" },
    { name: "n_events", field: "events", dataType: "int64", role: "events" },
    { name: "first_ts", field: "firstRecorded", dataType: "timestamp[ns]", role: "timestamp" },
    { name: "last_ts", field: "lastRecorded", dataType: "timestamp[ns]", role: "timestamp" },
    ...attributes.map((field) => ({ name: field, field, dataType: "string", role: "attribute" as const })),
  ];
  const fields = columns.map(({ field, ...column }) => {
    const finite = selected.map((r) => r[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return { ...column, distinct: new Set(edaCases.map((r) => categoryValue(r[field])).filter((v) => v !== null)).size, missing: counts(selected, (r) => categoryValue(r[field]) === null), numeric: column.role === "events" ? { min: finite.length ? Math.min(...finite) : null, max: finite.length ? Math.max(...finite) : null, median: quantile(finite, .5), p90: quantile(finite, .9) } : null };
  });
  return { compareAttribute: comparison, fields, facets, joint, density, eventBins, concentration };
}

export function evaluateMockEda(params: URLSearchParams, datasetId: string, caseTableId: string): EDAResult {
  validKeys(Object.fromEntries(params), ["datasetId", "attribute", "insight", "compareAttribute", "filter", "selection", "categoryMode", "timeMissing", "spanMissing", "spanMin", "spanMax", "page", "pageSize"]);
  const attribute = attr(params.get("attribute") ?? "flow_type");
  const insight = flag(params, "insight");
  const explicitComparison = params.get("compareAttribute");
  if (explicitComparison !== null && (!explicitComparison.length || explicitComparison.length > 256)) throw new Error("Invalid comparison field");
  const candidates = attributes.filter((field) => field !== attribute);
  const useful = candidates.filter((field) => { const n = new Set(edaCases.map((r) => categoryValue(r[field])).filter((v) => v !== null)).size; return n >= 2 && n <= 20; });
  const ordinary = useful.filter((field) => !/(^|[_\W])(id|uuid|guid|identifier|case)([_\W]|$)|Id$|ID$/.test(field));
  const comparison = explicitComparison !== null ? attr(explicitComparison, 400) : (ordinary[0] ?? useful[0] ?? candidates[0] ?? null);
  const min = numeric(params, "spanMin"), max = numeric(params, "spanMax");
  const page = numeric(params, "page", 1)!, pageSize = numeric(params, "pageSize", 25)!;
  if (!Number.isInteger(page) || page < 1 || page > 10_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid pagination");
  const spanMissing = flag(params, "spanMissing"), timeMissing = flag(params, "timeMissing");
  if ((min !== undefined && max !== undefined && min >= max) || (spanMissing && (min !== undefined || max !== undefined))) throw new Error("Invalid span range");
  const mode = params.get("categoryMode");
  if (mode !== null && !["missing", "other"].includes(mode)) throw new Error("Invalid category mode");
  const filter = matchesFilter(params.get("filter"));
  const primary = domain(attribute), keyOf = primary.keyOf;
  const selection = matchesSelection(params.get("selection"), [...new Set(edaCases.map(keyOf))], keyOf);
  const selected = edaCases.filter((r) => filter(r) && selection(r)
    && (mode === null || keyOf(r) === mode)
    && (!spanMissing || r.spanDays === null) && (!timeMissing || r.firstRecorded === null)
    && (min === undefined || (r.spanDays !== null && r.spanDays >= min))
    && (max === undefined || (r.spanDays !== null && r.spanDays < max)));
  const count = (predicate: (row: DemoCase) => boolean) => ({ total: edaCases.filter(predicate).length, selected: selected.filter(predicate).length });
  // Legacy categories include occupied buckets; insight facets also retain zero Other/missing buckets.
  const categories: EDAResult["categories"] = primary.categories.map((c) => ({ ...c, ...count((r) => keyOf(r) === c.key) })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total || compare(a.key, b.key));
  const months = [...new Set(edaCases.map((r) => r.firstRecorded?.slice(0, 7)).filter((m): m is string => Boolean(m)))].sort();
  const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const trend: EDAResult["trend"] = months.map((month) => {
    const index = monthIndex(month);
    const next = new Date(Date.UTC(Math.floor((index + 1) / 12), (index + 1) % 12, 1));
    const end = new Date(next.getTime() - 1).toISOString().replace(".999Z", ".999999999");
    return { key: `month:${index}`, label: month, from: `${month}-01T00:00:00`, to: end, ...count((r) => r.firstRecorded?.startsWith(month) ?? false) };
  });
  if (edaCases.some((r) => r.firstRecorded === null)) trend.push({ key: "missing", label: "Unknown start", from: null, to: null, ...count((r) => r.firstRecorded === null) });
  const cuts = [0, 1, 3, 7, 14, 30, 60, 90, 180, 365];
  const spans: EDAResult["spans"] = cuts.map((lower, i) => {
    const upper = cuts[i + 1] ?? null;
    return { key: String(i), label: upper === null ? `≥${lower} d` : `${lower}–<${upper} d`, min: lower, max: upper, missing: false, ...count((r) => r.spanDays !== null && r.spanDays >= lower && (upper === null || r.spanDays < upper)) };
  });
  if (edaCases.some((r) => r.spanDays === null)) spans.push({ key: "missing", label: "Unknown span", min: null, max: null, missing: true, ...count((r) => r.spanDays === null) });
  const known = selected.map((r) => r.spanDays).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const quantile = (p: number) => {
    if (!known.length) return null;
    const index = (known.length - 1) * p, low = Math.floor(index), high = Math.ceil(index);
    return known[low]! + (known[high]! - known[low]!) * (index - low);
  };
  const firsts = selected.map((r) => r.firstRecorded).filter((v): v is string => v !== null).sort();
  const lasts = selected.map((r) => r.lastRecorded).filter((v): v is string => v !== null).sort();
  const ordered = [...selected].sort((a, b) => (b.firstRecorded ?? "").localeCompare(a.firstRecorded ?? "") || a.caseId.localeCompare(b.caseId));
  return {
    datasetId, caseTableId, attribute, attributes: [...attributes], caseNoun: "demo cases",
    summary: {
      cases: { total: edaCases.length, selected: selected.length }, events: { total: sumEvents(edaCases), selected: sumEvents(selected) },
      knownSpanCases: known.length, unknownSpanCases: selected.length - known.length,
      unknownStartCases: selected.filter((r) => r.firstRecorded === null).length,
      medianSpanDays: quantile(.5), p90SpanDays: quantile(.9), firstRecorded: firsts[0] ?? null, lastRecorded: lasts.at(-1) ?? null,
    },
    insights: insight ? insights(selected, primary, comparison, spans) : null,
    categories, trend, trendMonthsPerBucket: 1, trendOmittedEmptyMonths: months.length ? monthIndex(months.at(-1)!) - monthIndex(months[0]!) + 1 - months.length : 0,
    spans, details: { total: selected.length, page, pageSize, rows: ordered.slice((page - 1) * pageSize, page * pageSize).map(({ flow_type, vendor, ...row }) => ({ ...row, category: categoryValue(attribute === "flow_type" ? flow_type : vendor)?.slice(0, 512) ?? null })) },
    notes: ["Illustrative mock fixture: six fixed demo cases, not BPIC19 measurements. All displayed counts are computed from these six rows.", "Recorded span is first-to-last dated event, not business completion. Unknown spans remain in counts and are excluded from percentiles.", "Monthly bars omit empty calendar gaps without excluding any case. Selections apply to all charts and case details.", ...(insight ? ["Field distinct counts describe the full table; missing counts describe full and selected populations. Numeric profiles and concentration statistics describe selected cases. Facet and event-bin domains stay fixed for the full table."] : [])],
  };
}

export const edaHandlers = [http.get("*/api/v1/projects/:projectId/case-tables/:caseTableId/eda", ({ request, params }) => {
  const query = new URL(request.url).searchParams;
  const datasetId = query.get("datasetId");
  if (!datasetId) return bad(422, "datasetId is required");
  const table = db.caseTables.find((row) => row.id === params.caseTableId);
  if (!db.projects.some((row) => row.id === params.projectId) || !table || table.datasetId !== datasetId) return bad(404, "Case table not found for the selected dataset");
  if (table.status !== "ready") return bad(422, "Case table is not ready");
  try { return HttpResponse.json(evaluateMockEda(query, datasetId, table.id)); }
  catch (error) { return bad(error instanceof EDAError ? error.status : 422, error instanceof Error ? error.message : "Invalid EDA selection"); }
})];

edaHandlers.push(http.post("*/api/v1/projects/:projectId/case-tables/:caseTableId/eda/query", async ({ request, params }) => {
  try {
    const body = await request.json() as Record<string, unknown>;
    validKeys(body, ["datasetId", "attribute", "insight", "compareAttribute", "filter", "selection", "categoryMode", "timeMissing", "spanMissing", "spanMin", "spanMax", "page", "pageSize", "valueField", "valueSearch", "valuePage", "hierarchyFields", "eventInsight", "activitySearch", "activityPage", "endpointStart", "endpointEnd", "traceCaseId", "tracePage"]);
    const table = db.caseTables.find((row) => row.id === params.caseTableId);
    if (!db.projects.some((row) => row.id === params.projectId) || !table || table.datasetId !== body.datasetId) return bad(404, "Case table not found for the selected dataset");
    if (table.status !== "ready") return bad(422, "Case table is not ready");
    if (body.eventInsight) return bad(422, "This illustrative case-only demo has no prepared event records. Activity, endpoint and trace evidence requires a prepared dataset; no events are inferred from case totals.");
    if (body.hierarchyFields) return bad(422, "The illustrative demo has only two context attributes.");
    const base = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (value !== undefined && !["valueField", "valueSearch", "valuePage"].includes(key)) base.set(key, String(value));
    const result = evaluateMockEda(base, String(body.datasetId), table.id);
    if (body.valueField !== undefined) {
      const field = attr(body.valueField), search = String(body.valueSearch ?? ""), page = Number(body.valuePage ?? 1);
      if (search.length > 256 || !Number.isInteger(page) || page < 1 || page > 100_000) throw new Error("Invalid value search");
      const allSelected = evaluateMockEda(new URLSearchParams({ ...Object.fromEntries(base), page: "1", pageSize: "100" }), String(body.datasetId), table.id);
      const ids = new Set(allSelected.details.rows.map((r) => r.caseId));
      const values = [...new Set(edaCases.map((r) => categoryValue(r[field])))].filter((v): v is string => v !== null && v.toLowerCase().includes(search.toLowerCase()));
      const rows = values.map((value) => ({ value, selectable: [...value].length <= 4096, ...counts(edaCases.filter((r) => ids.has(r.caseId)), (r) => categoryValue(r[field]) === value) })).sort((a, b) => b.total - a.total || compare(a.value, b.value));
      result.values = { field, query: search, page, pageSize: 40, totalValues: rows.length, rows: rows.slice((page - 1) * 40, page * 40) };
    }
    return HttpResponse.json(result);
  } catch (error) { return bad(error instanceof EDAError ? error.status : 422, error instanceof Error ? error.message : "Invalid explorer query"); }
}));
