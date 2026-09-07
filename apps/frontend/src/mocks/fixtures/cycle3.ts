/**
 * The operations the third-release backend added to the contract but no screen of this cycle reads yet
 * (the knowledge hub, guidance, review entities, gates, the norm inventory, the run manifest view, the
 * activity profile and the decisions of one case table). The mocks answer them in the contract's shapes so
 * the contract test covers every operation and the screens of the next increments have something to render
 * against; where a payload would need content the pack owns, the answer carries the empty list rather than
 * invented text.
 */
import { db, summaryFor } from "../db";
import { verifiedCaseTable, verifiedFlowAll, VERIFIED_CASE_NOUN } from "./verified";
import { bpic19Norm } from "./norm";

export interface MockReviewItem {
  id: string;
  projectId: string;
  kind: "hypothesis" | "gate" | "finding" | "action";
  status: string;
  title?: string;
  runId?: string | null;
  slicing?: string | null;
  sliceKey?: string | null;
  view?: string | null;
  author?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Review entities live in memory for the session, as the findings store does in the browser. */
export const review: MockReviewItem[] = [];

export function newReviewItem(projectId: string, kind: MockReviewItem["kind"], body: Record<string, unknown>): MockReviewItem {
  const now = new Date().toISOString();
  const item: MockReviewItem = {
    id: `${kind}_${(review.length + 1).toString(36)}`,
    projectId,
    kind,
    status: kind === "action" ? "proposed" : "open",
    title: typeof body.title === "string" ? body.title : typeof body.constraint_id === "string" ? `Hypothesis on ${body.constraint_id}` : undefined,
    runId: typeof body.run_id === "string" ? body.run_id : null,
    slicing: typeof body.slicing === "string" ? body.slicing : null,
    sliceKey: typeof body.slice_key === "string" ? body.slice_key : null,
    view: typeof body.view === "string" ? body.view : null,
    author: typeof body.author === "string" ? body.author : null,
    note: typeof body.note === "string" ? body.note : null,
    createdAt: now,
    updatedAt: now,
  };
  review.push(item);
  return item;
}

export function updateReviewItem(item: MockReviewItem, body: Record<string, unknown>): MockReviewItem {
  if (typeof body.status === "string") item.status = body.status;
  if (typeof body.note === "string") item.note = body.note;
  if (typeof body.title === "string") item.title = body.title;
  item.updatedAt = new Date().toISOString();
  return item;
}

/** The three gates of a group (R2-02): read-only until the review endpoints are wired to a screen. */
export type GateStatus = "pending" | "passed" | "failed" | "waived";

export interface MockGate {
  id: string;
  kind: "readiness" | "censoring" | "replication" | "domain";
  status: GateStatus;
  text: string;
}

export function gatesFor(runId: string, slicing: string, sliceKey: string, view: string | undefined) {
  const gates: MockGate[] = [
    { id: "readiness", kind: "readiness", status: "passed", text: "The readiness report of this case table has no failing item." },
    { id: "censoring", kind: "censoring", status: "pending", text: "14 % of these purchase order items were still open when the data was extracted; their waiting times are cut off." },
    { id: "replication", kind: "replication", status: "pending", text: "Some of these items carry postings copied from the order header." },
  ];
  const blocking = gates.filter((g) => g.status !== "passed" && g.status !== "waived").map((g) => g.id);
  return { runId, slicing, sliceKey, view: view ?? null, caseNoun: VERIFIED_CASE_NOUN, cases: null, gates, blocking, passed: blocking.length === 0 };
}

export function whatCanWeDoFor(runId: string, slicing: string, sliceKey: string, view: string | undefined) {
  const gates = gatesFor(runId, slicing, sliceKey, view);
  return {
    runId,
    slicing,
    sliceKey,
    view: view ?? null,
    caseNoun: VERIFIED_CASE_NOUN,
    reading: null,
    drivers: [],
    gates: gates.gates,
    blocking: gates.blocking,
    actions: review.filter((r) => r.kind === "action"),
    guidanceAvailable: false,
  };
}

export function hubIndex() {
  return { pack: "p2p", process: "p2p", case_noun: VERIFIED_CASE_NOUN, nodes: [], edges: [], overlays: 0 };
}

export function hubPage(nodeId: string) {
  return { node: { id: nodeId, kind: "constraint", title: nodeId }, guidance: null, related: {}, overlay: null, process: "p2p" };
}

export function guidanceFor(kind: string, entryId: string) {
  return { kind, id: entryId, generic: null, overlay: null, hub_node: null };
}

export function guidanceQuestions(kind: string, id: string | undefined) {
  return { kind, id: id ?? null, questions: [] };
}

/** The norm builder's inventory (R3-O6): the activities and attributes a constraint may be written on. */
export function inventoryFor(caseTableId: string) {
  const table = db.caseTables.find((c) => c.id === caseTableId);
  return {
    caseTableId,
    cases: table?.cases ?? verifiedCaseTable.cases,
    events: table?.events ?? verifiedCaseTable.events,
    caseNoun: VERIFIED_CASE_NOUN,
    activities: verifiedCaseTable.activities.map((a) => ({ label: a.label, events: a.events, cases: a.cases })),
    attributes: [],
    attributeNames: verifiedCaseTable.attributes,
    stages: [],
  };
}

/** The run manifest in two blocks: what a person needs, and the fingerprints behind "Technical details" (R3-O7). */
export function manifestFor(runId: string) {
  const run = db.runs.find((r) => r.id === runId);
  const summary = summaryFor(runId);
  return {
    runId,
    status: run?.status ?? "done",
    caseNoun: VERIFIED_CASE_NOUN,
    plain: [],
    technical: (run?.manifest ?? {}) as Record<string, unknown>,
    uncalibrated: [],
    params: { cases: summary.cases ?? null },
  };
}

/** Everything the map knows about one activity, paths from the full relation included (R3-O8). */
export function activityProfile(activityId: string) {
  const node = verifiedFlowAll.nodes.find((n) => n.id === activityId || n.label === activityId);
  const follows = verifiedFlowAll.edges.filter((e) => e.kind === "follows");
  const id = node?.id ?? activityId;
  const rows = (list: typeof follows, direction: "in" | "out") =>
    list.map((e) => ({
      node: direction === "in" ? e.source : e.target,
      from: verifiedFlowAll.nodes.find((n) => n.id === e.source)?.label ?? e.source,
      to: verifiedFlowAll.nodes.find((n) => n.id === e.target)?.label ?? e.target,
      count: Math.round(e.metrics?.count ?? 0),
      cases: Math.round(e.metrics?.cases ?? 0),
    }));
  return {
    id,
    label: node?.label ?? activityId,
    onMap: !!node,
    stage: node?.group ?? null,
    cases: Math.round(node?.metrics?.cases ?? 0),
    events: Math.round(node?.metrics?.events ?? 0),
    shareOfCases: node?.metrics?.share ?? null,
    metrics: (node?.metrics ?? {}) as Record<string, number>,
    paths: { focus: id, incoming: rows(follows.filter((e) => e.target === id), "in"), outgoing: rows(follows.filter((e) => e.source === id), "out") },
    constraintsTouching: [],
    meta: {},
  };
}

/** The decisions of one case table with its lineage (R3-O1, R3-O3). */
export function decisionItemsFor(caseTableId: string) {
  const table = db.caseTables.find((c) => c.id === caseTableId);
  const decisions = db.decisions.filter((d) => d.caseTableId === caseTableId || d.resultCaseTableId === caseTableId);
  return {
    caseTableId,
    requestedCaseTableId: caseTableId,
    mappingId: table?.mappingId ?? null,
    version: decisions.length,
    lineage: decisions.map((d) => ({ caseTableId: d.resultCaseTableId, version: d.version, kind: d.kind })),
    items: [],
  };
}

/** One constraint checked against a case table before it joins the norm (R3-O6). */
export function constraintCheck(caseTableId: string, constraint: Record<string, unknown>) {
  const id = typeof constraint.id === "string" ? constraint.id : null;
  const known = bpic19Norm.constraints.find((c) => c.id === id);
  const activities = ((constraint.activities as string[] | undefined) ?? []).map((label) => ({
    label,
    known: verifiedCaseTable.activities.some((a) => a.label === label),
    cases: verifiedCaseTable.activities.find((a) => a.label === label)?.cases ?? 0,
  }));
  const missing = activities.filter((a) => !a.known);
  return {
    valid: missing.length === 0,
    errors: missing.map((a) => ({ field: "activities", message: `${a.label} is not an activity of this log` })),
    id,
    layer: (constraint.layer as string | undefined) ?? known?.layer ?? null,
    type: (constraint.type as string | undefined) ?? known?.type ?? null,
    sentence: id ? `${id} is checked against the case table.` : null,
    rule_sentence: null,
    applicability_sentence: null,
    activities,
    casesInScope: verifiedCaseTable.cases,
    casesEvaluated: verifiedCaseTable.cases,
    casesMissing: null,
    shareMissing: null,
    note: null,
    caseTableId,
    caseNoun: VERIFIED_CASE_NOUN,
  };
}
