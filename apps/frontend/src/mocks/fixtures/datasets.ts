import type { CaseTable, ColumnProfile, DatasetVersion, Readiness } from "@wise/api-schema";

const col = (name: string, dtype: string, nulls: number, distinct: number, sample: unknown[]): ColumnProfile => ({ name, dtype, nulls, distinct, sample });

export const bpic19Columns: ColumnProfile[] = [
  col("eventID", "number", 0, 1656108, ["239818088906755", "239818088906788", "239818088906837"]),
  col("case Spend area text", "string", 0.0011, 21, ["Packaging", "Logistics", "Facilities", "Marketing"]),
  col("case Company", "string", 0, 4, ["companyID_0000", "companyID_0001", "companyID_0002"]),
  col("case Document Type", "string", 0, 3, ["Standard PO", "Framework order", "EC Purchase order"]),
  col("case Sub spend area text", "string", 0.0011, 97, ["Corrugated", "Freight", "Cleaning"]),
  col("case Purchasing Document", "string", 0, 76349, ["4507000001", "4507000002", "4507000003"]),
  col("case Purch. Doc. Category name", "string", 0, 2, ["Purchase order", "Framework order"]),
  col("case Vendor", "string", 0, 1987, ["vendorID_0128", "vendorID_0093", "vendorID_0341"]),
  col("case Item Type", "string", 0, 6, ["Standard", "Service", "Consignment", "Subcontracting", "Third-party"]),
  col("case Item Category", "string", 0, 4, ["3-way match, invoice after GR", "3-way match, invoice before GR", "2-way match", "Consignment"]),
  col("case Spend classification text", "string", 0, 3, ["NPR", "PR", "Other"]),
  col("case Source", "string", 0, 1, ["SAP ERP"]),
  col("case Name", "string", 0.0003, 1985, ["vendor_0128", "vendor_0093", "vendor_0341"]),
  col("case GR-Based Inv. Verif.", "string", 0, 2, ["True", "False"]),
  col("case Item", "string", 0, 108, ["00010", "00020", "00030"]),
  col("case concept:name", "string", 0, 251734, ["4507000001_00010", "4507000002_00010", "4507000002_00020"]),
  col("case Goods Receipt", "string", 0, 2, ["True", "False"]),
  col("event User", "string", 0.021, 627, ["user_001", "batch_06", "NONE"]),
  col("event org:resource", "string", 0.021, 627, ["user_001", "batch_06", "NONE"]),
  col("event concept:name", "string", 0, 42, ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice", "Vendor creates invoice"]),
  col("event Cumulative net worth (EUR)", "number", 0, 41260, ["1250.0", "380.5", "21990.0"]),
  col("event time:timestamp", "timestamp", 0, 38102, ["02-01-2018 10:12:00.000", "15-01-2018 08:00:00.000", "07-03-2018 14:30:00.000"]),
];

export const datasets: DatasetVersion[] = [
  {
    id: "ds_1",
    name: "BPI_Challenge_2019.csv",
    status: "ready",
    contentHash: "7d592fb425690d13011d1b874fe2af63f61a66acfc368ecf87b4ed266e6cdb00",
    events: 1595923,
    columns: bpic19Columns,
    createdAt: "2026-06-02T08:14:00Z",
    sourceKind: "csv",
  },
];

/** The readiness report with the backend's item ids and evidence keys (CP-A1 on BPIC 2019). */
export const readinessWarn: Readiness = {
  status: "warn",
  items: [
    { id: "volume", level: "info", message: "1,595,923 events in 251,734 cases over 42 activities.", evidence: { events: 1595923, cases: 251734, activities: 42 } },
    { id: "window", level: "info", message: "Observation window 2017-12-31 23:59:00 to 2019-01-17 15:44:00 (robust quantiles); raw timestamps span 1948-01-26 23:59:00 to 2020-04-09 23:59:00.", evidence: { start: "2017-12-31T23:59:00", end: "2019-01-17T15:44:00", rawMin: "1948-01-26T23:59:00", rawMax: "2020-04-09T23:59:00" } },
    { id: "timestamp_outliers", level: "warn", message: "578 events lie outside the observation window (earliest 1948-01-26 23:59:00, latest 2020-04-09 23:59:00); lags touching them are unreliable.", evidence: { events: 578, earliest: "1948-01-26T23:59:00", latest: "2020-04-09T23:59:00", share: 0.00036 } },
    { id: "sentinel_dates", level: "warn", message: "11 timestamp value(s) look like placeholders (identical stamp on many events or a known sentinel date); most frequent: 2017-12-04T23:59:00 on 74 events.", evidence: { values: [{ timestamp: "2017-12-04T23:59:00", events: 74, outsideWindow: true }] } },
    { id: "timestamp_precision", level: "warn", message: "Timestamp precision per activity (minute: 41, day: 1). Day-level activities: Create Purchase Requisition Item; sub-day lags on them are not meaningful.", evidence: { activities: [{ activity: "Create Purchase Requisition Item", precision: "day", events: 1140 }] } },
    { id: "duplicate_events", level: "warn", message: "180,913 events are exact duplicates (same case, activity and timestamp); counts and singularity constraints are inflated.", evidence: { events: 180913, share: 0.1134 } },
    { id: "tied_timestamps", level: "info", message: "17.4% of events share their timestamp with another event of the same case; order between them is undefined.", evidence: { share: 0.174, casesShare: 0.31 } },
    { id: "zero_exposure", level: "info", message: "16,378 cases have exposure 0; exposure-weighted priorities ignore them.", evidence: { cases: 16378 } },
    { id: "header_event_replication", level: "warn", message: "Header events (Create Purchase Order Item, Vendor creates invoice, Record Invoice Receipt, Clear Invoice, Remove Payment Block) are replicated onto items: 93.1% of their events share activity and timestamp with another case. 4,323 cases (1.7%) have more than 2 events per distinct timestamp.", evidence: { headerEvents: ["Create Purchase Order Item", "Vendor creates invoice", "Record Invoice Receipt", "Clear Invoice", "Remove Payment Block"], replicatedShare: 0.931, casesFlagged: 4323, ratioFlag: 2 } },
    { id: "right_censored", level: "warn", message: "34,947 cases (13.9%) are still open within 60 days of the window end; their missing closure is a window artefact until proven otherwise.", evidence: { cases: 34947, closure: ["Clear Invoice"], window: "60D" } },
    { id: "flow_types", level: "info", message: "Flow types: DF2: 221,010, DF1: 15,182, Consignment: 14,498, 2-way: 1,044.", evidence: { counts: { DF2: 221010, DF1: 15182, Consignment: 14498, "2-way": 1044 }, untyped: 0 } },
  ],
};

export const activities = [
  { label: "Record Goods Receipt", events: 314097, cases: 234479 },
  { label: "Create Purchase Order Item", events: 251734, cases: 251734 },
  { label: "Record Invoice Receipt", events: 228760, cases: 214412 },
  { label: "Vendor creates invoice", events: 224117, cases: 214920 },
  { label: "Clear Invoice", events: 217480, cases: 208893 },
  { label: "Remove Payment Block", events: 61230, cases: 58811 },
  { label: "Record Service Entry Sheet", events: 45872, cases: 22314 },
  { label: "Change Price", events: 12988, cases: 11240 },
  { label: "Change Quantity", events: 9021, cases: 8402 },
  { label: "Cancel Invoice Receipt", events: 6312, cases: 5920 },
  { label: "Cancel Goods Receipt", events: 4118, cases: 3902 },
  { label: "Delete Purchase Order Item", events: 3611, cases: 3611 },
  { label: "Vendor creates debit memo", events: 2114, cases: 2009 },
  { label: "Vendor creates credit memo", events: 1802, cases: 1710 },
  { label: "Change Approval for Purchase Order", events: 1470, cases: 1301 },
  { label: "Change Payment Terms", events: 611, cases: 590 },
];

export const caseTableAttributes = ["n_events", "first_ts", "last_ts", "case Company", "case Spend area text", "case Vendor", "case Item Type", "case Purchasing Document", "case Document Type", "case Item Category", "exposure", "flow_type", "header_event_count"];

export const caseTables: CaseTable[] = [
  {
    id: "ct_1",
    datasetId: "ds_1",
    mappingId: "map_2",
    cases: 251734,
    events: 1595923,
    status: "ready",
    readiness: readinessWarn,
    activities,
    attributes: caseTableAttributes,
    createdAt: "2026-06-02T08:20:00Z",
  },
];
