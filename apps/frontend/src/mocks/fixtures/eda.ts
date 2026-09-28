import type { EDARow } from "@/lib/api/eda";

/** Small, explicitly illustrative fixture. Counts are derived from these rows, never scaled to BPIC totals. */
export const edaCases: (Omit<EDARow, "category"> & { flow_type: string | null; vendor: string | null })[] = [
  { caseId: "demo-001", events: 3, firstRecorded: "2018-01-03T00:00:00", lastRecorded: "2018-01-04T00:00:00", spanDays: 1, flow_type: "DF1", vendor: "Vendor A" },
  { caseId: "demo-002", events: 5, firstRecorded: "2018-01-10T00:00:00", lastRecorded: "2018-01-18T00:00:00", spanDays: 8, flow_type: "DF2", vendor: "Vendor B" },
  { caseId: "demo-003", events: 4, firstRecorded: "2018-02-10T00:00:00", lastRecorded: "2018-02-12T00:00:00", spanDays: 2, flow_type: "DF1", vendor: "Vendor A" },
  { caseId: "demo-004", events: 1, firstRecorded: "2018-02-15T00:00:00", lastRecorded: "2018-02-15T00:00:00", spanDays: 0, flow_type: "Consignment", vendor: null },
  { caseId: "demo-005", events: 2, firstRecorded: null, lastRecorded: null, spanDays: null, flow_type: null, vendor: null },
  { caseId: "demo-006", events: 2, firstRecorded: "1948-01-26T00:00:00", lastRecorded: "1948-01-27T00:00:00", spanDays: 1, flow_type: "DF2", vendor: "Vendor B" },
];
