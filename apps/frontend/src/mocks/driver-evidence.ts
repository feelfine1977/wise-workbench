import { http, HttpResponse } from "msw";
import type { components } from "@wise/api-schema";
import { db } from "./db";

type Evidence = components["schemas"]["DriverEvidence"];
type Example = { vendor: string; company: string; area: string; start: string[]; end: string[] };
const examples: Example[] = [
  { vendor: "vendorID_0136", company: "companyID_0000", area: "Packaging", start: ["2018-01-01T00:00:00Z"], end: ["2018-01-26T00:00:00Z"] },
  { vendor: "vendorID_0136", company: "companyID_0000", area: "Packaging", start: ["2018-01-20T00:00:00Z"], end: ["2018-01-28T00:00:00Z"] },
  { vendor: "vendorID_0136", company: "companyID_0000", area: "Packaging", start: ["2018-02-01T00:00:00Z"], end: [] },
  { vendor: "vendorID_0137", company: "companyID_0000", area: "Packaging", start: ["2018-02-01T00:00:00Z"], end: ["2018-02-26T00:00:00Z", "2018-02-28T00:00:00Z"] },
  { vendor: "vendorID_0137", company: "companyID_0001", area: "Logistics", start: [], end: ["2018-02-26T00:00:00Z"] },
  { vendor: "vendorID_0137", company: "companyID_0001", area: "Logistics", start: ["2018-02-02T00:00:00Z"], end: ["2018-02-01T00:00:00Z"] },
];
const attributes = { "case Vendor": "vendor", "case Company": "company", "case Spend area text": "area" } as const;
const fields = (row: Example, name: string) => row[attributes[name as keyof typeof attributes]];
const failure = (status: number, detail: string) => HttpResponse.json({ status, title: "Demo evidence unavailable", detail, code: "driver_evidence.demo_scope" }, { status, headers: { "Content-Type": "application/problem+json" } });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function filterOf(raw: string | null): { and: Record<string, unknown>[] } | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed)) throw new Error("The filter must be an object.");
  const value = "and" in parsed ? parsed : { and: Object.keys(parsed).length ? [parsed] : [] };
  if (Object.keys(value).some(k => k !== "and") || !Array.isArray(value.and)) throw new Error("Use a filter with an and list.");
  const clauses = value.and;
  for (const clause of clauses) {
    if (!object(clause)) throw new Error("Invalid filter clause.");
    if (clause.kind === "open" && typeof clause.value === "boolean" && Object.keys(clause).every(k => ["kind", "value"].includes(k))) continue;
    if (clause.kind === "attribute" && typeof clause.field === "string" && Object.hasOwn(attributes, clause.field) && Object.keys(clause).every(k => ["kind", "field", "eq", "in"].includes(k))) {
      if (typeof clause.eq === "string" && !("in" in clause)) continue;
      if (!("eq" in clause) && Array.isArray(clause.in) && clause.in.length > 0 && clause.in.every(v => typeof v === "string")) continue;
    }
    throw new Error("This demo supports only open and exact case-attribute filters. No unfiltered evidence was substituted.");
  }
  return { and: clauses as Record<string, unknown>[] };
}
function matches(row: Example, clause: Record<string, unknown>): boolean {
  if (clause.kind === "open") return (row.end.length === 0) === clause.value;
  const value = fields(row, String(clause.field));
  return Array.isArray(clause.in) ? clause.in.includes(value) : value === clause.eq;
}
const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), i = (sorted.length - 1) * p, lo = Math.floor(i);
  return sorted[lo]! + (sorted[Math.ceil(i)]! - sorted[lo]!) * (i - lo);
};
const recipe: NonNullable<Evidence["solutionCard"]> = {
  id: "synthetic-invoice-timing", version: 1, title: "Synthetic invoice-to-clearing example", process: "p2p", hubNode: null,
  intent: "Six invented cases demonstrate the evidence display. These are not measurements of BPIC or the saved score population.",
  blocks: [
    { id: "coverage", kind: "activity_coverage", title: "Endpoint coverage", question: "Which example cases contain each activity?", requires: ["case identifiers", "activity labels"], calculation: "Count each endpoint's records and distinct example cases.", presentation: "coverage", missingData: "Coverage unavailable.", interpretation: "A case can contain both endpoints." },
    { id: "duration", kind: "endpoint_duration", title: "Elapsed time", question: "How long between unique ordered endpoints?", requires: ["dated start and end events"], calculation: "Median and interpolated p90 of unique nonnegative durations in days.", presentation: "summary", missingData: "No usable endpoint pairs.", interpretation: "Descriptive duration does not establish lateness or cause." },
    { id: "calendar", kind: "end_day_of_month", title: "Calendar pattern", question: "On which days are end events recorded?", requires: ["dated end events"], calculation: "Count rows and distinct cases by UTC calendar day.", presentation: "day_bars", missingData: "No dated end records.", interpretation: "Raw calendar counts are not adjusted for exposure." },
  ],
};

/** Explicit six-case synthetic population; refuse scopes whose membership cannot be reproduced. */
export const driverEvidenceHandlers = [http.get("*/api/v1/projects/:projectId/runs/:runId/driver-evidence", ({ params, request }) => {
  const run = db.runs.find(r => r.id === params.runId);
  const table = run && db.caseTables.find(t => t.id === run.caseTableId);
  const dataset = table && db.datasets.find(d => d.id === table.datasetId);
  if (params.projectId !== "p2p2018" || !run || !table || !dataset) return failure(404, "The run was not found in this project.");
  if (run.id !== "run_41" || run.status !== "done" || run.scope || run.caseTableId !== "ct_1" || run.normVersionId !== "nv_7") return failure(422, "No synthetic event population is registered for this run or cohort.");
  const q = new URL(request.url).searchParams;
  if ([...q.keys()].some(k => !["constraintId", "slicing", "key", "view", "filter"].includes(k))) return failure(422, "This demo cannot evaluate extra grouping, band or drill parameters.");
  const constraintId = q.get("constraintId"), slicing = q.get("slicing"), rawKey = q.get("key"), view = q.get("view") ?? run.views?.[0];
  if (!slicing || rawKey === null || !constraintId) return failure(422, "constraintId, slicing and key are required.");
  if (constraintId !== "c_l3_invoice_to_clear_days") return failure(422, "This demo only carries invoice-to-clearing example events.");
  if (!view || !run.views?.includes(view)) return failure(422, "The selected view is not part of this run.");
  if (!["case Vendor", "case Company+case Spend area text"].includes(slicing)) return failure(422, "This demo has no exact event population for that grouping.");
  let key: unknown, filter: ReturnType<typeof filterOf>;
  try { key = JSON.parse(rawKey); filter = filterOf(q.get("filter")); } catch (error) { return failure(422, error instanceof Error ? error.message : "Invalid selection."); }
  const attrs = slicing.split("+");
  if (!Array.isArray(key) || key.length !== attrs.length || !key.every(k => typeof k === "string")) return failure(422, "The group key must name one value for each grouping column.");
  const group = examples.filter(row => attrs.every((a, i) => fields(row, a) === key[i]));
  if (!group.length) return failure(422, "This demo has no registered cases for that group. No other group was substituted.");
  const selected = group.filter(row => filter?.and.every(clause => matches(row, clause)) ?? true);
  const endpoint = (side: "start" | "end") => ({ labels: [side === "start" ? "Record Invoice Receipt" : "Clear Invoice"], observedLabels: selected.some(r => r[side].length) ? [side === "start" ? "Record Invoice Receipt" : "Clear Invoice"] : [], mappedHeaderLabels: [], eventCount: selected.reduce((n, row) => n + row[side].length, 0), caseCount: selected.filter(row => row[side].length).length, missingTimestampEvents: 0 });
  const endpoints = { start: endpoint("start"), end: endpoint("end") };
  const partitions: NonNullable<Evidence["duration"]>["partitions"] = { orderedCases: 0, tiedCases: 0, reversedCases: 0, repeatedEndpointCases: 0, missingTimestampCases: 0, missingStartOnlyCases: 0, missingEndOnlyCases: 0, neitherEndpointCases: 0 };
  const durations: number[] = [];
  for (const row of selected) {
    if (!row.start.length && !row.end.length) partitions.neitherEndpointCases++;
    else if (!row.start.length) partitions.missingStartOnlyCases++;
    else if (!row.end.length) partitions.missingEndOnlyCases++;
    else if (row.start.length > 1 || row.end.length > 1) partitions.repeatedEndpointCases++;
    else {
      const duration = (Date.parse(row.end[0]!) - Date.parse(row.start[0]!)) / 86400000;
      if (duration < 0) partitions.reversedCases++;
      else { durations.push(duration); if (duration === 0) partitions.tiedCases++; else partitions.orderedCases++; }
    }
  }
  const ends = selected.flatMap(row => row.end).sort();
  const buckets = Array.from({ length: 31 }, (_, i) => {
    const day = i + 1, onDay = (t: string) => new Date(t).getUTCDate() === day;
    return { day, eventCount: ends.filter(onDay).length, caseCount: selected.filter(r => r.end.some(onDay)).length, monthsPresent: new Set(ends.filter(onDay).map(t => t.slice(0, 7))).size };
  });
  const scope: Evidence["scope"] = { fingerprint: `synthetic-v1:${JSON.stringify({ slicing, key, filter, view })}`, slicing, attributes: attrs, bands: [], key, view, filter, filtered: !!filter?.and.length, caseNoun: "synthetic example cases", fullCaseTableCases: examples.length, runCases: examples.length, groupCases: group.length, selectedCases: selected.length, selectedEvents: selected.reduce((n, r) => n + r.start.length + r.end.length, 0), population: "selected_cases", ruleApplicabilityApplied: false, viewAffectsMeasurements: false };
  const known = selected.filter(r => r.start.length && r.end.length);
  const result: Evidence = {
    constraintId, constraintType: "lag", status: selected.length ? "available" : "unavailable", reason: selected.length ? null : "No synthetic cases remain in this exact selection.",
    source: { projectId: String(params.projectId), runId: run.id, caseTableId: table.id, datasetId: dataset.id, normVersionId: run.normVersionId, normFingerprint: "synthetic-demo-norm-v1", contentHash: "synthetic-six-case-event-fixture-v1", selectionId: null, runScope: null, transformCount: 0 }, scope, solutionCard: recipe, endpoints,
    activityCoverage: { ...endpoints.end, selectedCases: selected.length, casesWithActivity: endpoints.end.caseCount, casesWithoutActivity: selected.length - endpoints.end.caseCount, singleOccurrenceCases: selected.filter(r => r.end.length === 1).length, repeatedOccurrenceCases: selected.filter(r => r.end.length > 1).length },
    duration: { status: durations.length ? "available" : "unavailable", reason: durations.length ? null : "No unique ordered or tied endpoint pairs in these examples.", pairing: "unique_endpoints", unit: "days", pairedCases: durations.length, median: percentile(durations, 0.5), p90: percentile(durations, 0.9), partitions, ordering: { casesWithKnownEndpointTimes: known.length, firstEndBeforeFirstStartCases: known.filter(r => r.end[0]! < r.start[0]!).length, allDatedEndsBeforeFirstStartCases: known.filter(r => r.end.every(t => t < r.start[0]!)).length } },
    endDayOfMonth: { buckets, eventCount: ends.length, caseCount: endpoints.end.caseCount, datedEventCount: ends.length, datedCaseCount: endpoints.end.caseCount, missingTimestampEvents: 0, firstTimestamp: ends[0] ?? null, lastTimestamp: ends.at(-1) ?? null, representedMonths: new Set(ends.map(t => t.slice(0, 7))).size, topDay: ends.length ? [...buckets].sort((a, b) => b.eventCount - a.eventCount || a.day - b.day)[0]! : null, timezone: "UTC", calendarExposureAdjusted: false },
    dueDate: { status: "unavailable", reason: "No due dates exist in the synthetic fixture." },
    caveats: ["Synthetic example only: six invented cases; not measurements of BPIC 2019, the saved score population or a sample of it."],
  };
  return HttpResponse.json(result);
})];
