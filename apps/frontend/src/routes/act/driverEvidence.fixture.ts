import type { SolutionCard } from "@/lib/api/solutionCards";
import type { DriverEvidence } from "@/lib/api/driverEvidence";

export const solutionCardFixture = {
  id: "temporal-review", version: 1, title: "Review event timing", intent: "Investigate observed timing before choosing an action.", hubNode: null, process: "p2p",
  blocks: [
    { id: "coverage", kind: "activity_coverage", title: "Activity coverage", question: "Which cases contain the end activity?", requires: ["case identifier", "activity label"], calculation: "Count recorded activities by case.", presentation: "coverage", missingData: "Activity records are unavailable.", interpretation: "Recorded activity coverage is not a compliance result." },
    { id: "duration", kind: "endpoint_duration", title: "Elapsed-time distribution", question: "How long between unique endpoints?", requires: ["case identifier", "start and end labels", "event timestamps"], calculation: "Median and p90 among unique ordered or tied endpoints.", presentation: "summary", missingData: "No usable timestamp pairs.", interpretation: "Duration is descriptive, not contractual lateness." },
    { id: "calendar", kind: "end_day_of_month", title: "Calendar pattern", question: "On which dates do end records occur?", requires: ["end-event timestamps"], calculation: "Count rows and distinct cases for each day of month.", presentation: "day_bars", missingData: "Dated end records are unavailable.", interpretation: "Raw calendar counts do not prove a payment run." },
    { id: "due", kind: "due_date_lead", title: "Release before due date", question: "Was release before payment was due?", requires: ["mapped invoice payment due date", "release timestamp"], calculation: "Invoice payment due date minus release date.", presentation: "availability", missingData: "No mapped invoice payment due date.", interpretation: "Positive lead time may represent planned waiting." },
  ],
} satisfies SolutionCard;

/** Synthetic counts for UI contract tests, unrelated to a measured workspace. */
export const driverEvidenceFixture = {
  solutionCard: solutionCardFixture,
  activityCoverage: { labels: ["Clear Invoice"], observedLabels: ["Clear Invoice"], mappedHeaderLabels: ["Clear Invoice"], eventCount: 100, caseCount: 80, missingTimestampEvents: 1, selectedCases: 100, casesWithActivity: 80, casesWithoutActivity: 20, singleOccurrenceCases: 60, repeatedOccurrenceCases: 20 },
  constraintId: "lag", constraintType: "lag", status: "available", reason: null,
  source: { projectId: "p", runId: "r", caseTableId: "table", datasetId: "dataset", normVersionId: "norm", normFingerprint: "norm-fingerprint", contentHash: "content", selectionId: null, runScope: null, transformCount: 0 },
  scope: { fingerprint: "population", slicing: "company", attributes: ["company"], bands: [], key: ["A"], view: "Finance", filter: null, filtered: false, caseNoun: "purchase order items", fullCaseTableCases: 240, runCases: 200, groupCases: 120, selectedCases: 100, selectedEvents: 400, population: "selected_cases", ruleApplicabilityApplied: false, viewAffectsMeasurements: false },
  endpoints: { start: { labels: ["Remove Payment Block"], observedLabels: ["Remove Payment Block"], mappedHeaderLabels: ["Remove Payment Block"], eventCount: 90, caseCount: 75, missingTimestampEvents: 3 }, end: { labels: ["Clear Invoice"], observedLabels: ["Clear Invoice"], mappedHeaderLabels: ["Clear Invoice"], eventCount: 100, caseCount: 80, missingTimestampEvents: 1 } },
  endDayOfMonth: { buckets: Array.from({ length: 31 }, (_, i) => ({ day: i + 1, eventCount: i === 25 ? 60 : i === 27 ? 39 : 0, caseCount: i === 25 ? 54 : i === 27 ? 31 : 0, monthsPresent: i === 25 || i === 27 ? 2 : 0 })), eventCount: 100, caseCount: 80, datedEventCount: 99, datedCaseCount: 79, missingTimestampEvents: 1, firstTimestamp: "2020-01-26T12:00:00", lastTimestamp: "2020-02-28T12:00:00", representedMonths: 2, topDay: { day: 26, eventCount: 60, caseCount: 54, monthsPresent: 2 }, timezone: null, calendarExposureAdjusted: false },
  duration: { status: "available", reason: null, pairing: "unique_endpoints", unit: "days", pairedCases: 61, median: 12.345, p90: 44.567, partitions: { orderedCases: 60, tiedCases: 1, reversedCases: 2, repeatedEndpointCases: 3, missingTimestampCases: 4, missingStartOnlyCases: 10, missingEndOnlyCases: 5, neitherEndpointCases: 15 }, ordering: { casesWithKnownEndpointTimes: 66, firstEndBeforeFirstStartCases: 4, allDatedEndsBeforeFirstStartCases: 2 } },
  dueDate: { status: "unavailable", reason: "No invoice payment due date is mapped in this case table." },
  caveats: ["Recorded header-level events may be replicated across purchase-order items."],
} satisfies DriverEvidence;
