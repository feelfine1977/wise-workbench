/**
 * Responses read from the verified run `run_0mtoq44vd14f208ur` (BPIC 2019, workspace_verify, backend of
 * 2026-09-06 with the analytics wired in): the 30 company × spend area rows and the top 50 vendor rows in all
 * four perspectives with γ = 20 and min cases 1 (stability badges, comparison sentences, caveats and plain
 * fields as the API serves them), the slice details of Packaging, Logistics and Real Estate (Automation) and of
 * vendorID_0136 (Finance) with contrast, comparisons, subgroups, guidance refs and headroom, the whole log's
 * process map, Packaging's map, the map focused on Record Goods Receipt, the invoice-to-clear distribution of
 * Packaging, the run summary, the flow types of the case table, the flow-type comparison, the decision kinds,
 * the analytics status, the vendors inside Packaging (drill-in) and the case table's readiness report.
 * Every number equals the API's (rounded to six digits). Slicings outside this set stay illustrative and are
 * marked so in `params.illustrative`.
 */
import type { BacklogRow, Distribution, FlowGraph, Readiness, RunSummary, SliceDetail } from "@wise/api-schema";
import type { AnalyticsStatus } from "@/lib/api/analytics";
import type { BacklogParams as BacklogParamsC2 } from "@/lib/api/exploration";
import type { DecisionKind } from "@/lib/api/readiness";
import type { FlowTypeComparison, FlowTypes } from "@/lib/api/runs";
import analyticsJson from "./verified/analytics.json";
import backlogJson from "./verified/backlog.json";
import caseTableJson from "./verified/casetable.json";
import compareJson from "./verified/compare.json";
import decisionKindsJson from "./verified/decision_kinds.json";
import distJson from "./verified/dist_packaging.json";
import drillJson from "./verified/drill_packaging.json";
import flowAllJson from "./verified/flow_all.json";
import flowFocusJson from "./verified/flow_focus_rgr.json";
import flowPackagingJson from "./verified/flow_packaging.json";
import flowTypesJson from "./verified/flowtypes.json";
import slicesJson from "./verified/slices.json";
import summaryJson from "./verified/summary.json";

export interface VerifiedPage {
  rows: BacklogRow[];
  total: number;
  globalMean: number;
  maxStablePI: number;
  params: BacklogParamsC2;
}

export const VERIFIED_RUN_ID = "run_0mtoq44vd14f208ur";
export const VERIFIED_GAMMA = 20;
export const VERIFIED_MIN_CASES = 1;
export const VERIFIED_CASE_NOUN = "purchase order items";
export const VERIFIED_WINDOW_END = "2019-01-17T15:44:00";
export const VERIFIED_PACKAGING_KEY = '["companyID_0000", "Packaging"]';

const backlog = backlogJson as unknown as Record<string, Record<string, VerifiedPage>>;
const slices = slicesJson as unknown as Record<string, SliceDetail>;

export const verifiedSlicings = Object.keys(backlog);
export const isVerifiedSlicing = (slicing: string) => slicing in backlog;

export function verifiedBacklog(slicing: string, view: string): VerifiedPage | undefined {
  return backlog[slicing]?.[view];
}

export function verifiedSlice(key: string, view: string): SliceDetail | undefined {
  return slices[`${key}|${view}`];
}

export const verifiedFlowAll = flowAllJson as unknown as FlowGraph;
export const verifiedFlowPackaging = flowPackagingJson as unknown as FlowGraph;
export const verifiedFlowFocusedOnGoodsReceipt = flowFocusJson as unknown as FlowGraph;
export const verifiedDistributionPackaging = distJson as unknown as Distribution;
export const verifiedSummary = summaryJson as unknown as RunSummary;
export const verifiedFlowTypes = flowTypesJson as unknown as FlowTypes;
export const verifiedComparison = compareJson as unknown as FlowTypeComparison;
export const verifiedDecisionKinds = decisionKindsJson as unknown as DecisionKind[];
export const verifiedAnalytics = analyticsJson as unknown as AnalyticsStatus;
/** The vendors inside Packaging: `GET /backlog?slicing=case Vendor&drillFrom=…&drillKey=…` (Automation). */
export const verifiedDrillPackaging = drillJson as unknown as VerifiedPage;
export const verifiedCaseTable = caseTableJson as unknown as { readiness: Readiness; activities: { label: string; events: number; cases: number }[]; attributes: string[]; cases: number; events: number };
