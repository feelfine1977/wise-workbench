/**
 * The answers the four screens of this cycle read, in the shapes the served backend returns.
 *
 * The knowledge hub's index and seven of its pages are recorded from the verified BPIC 2019 workspace
 * (`verified/hub_index.json`, `verified/hub_pages.json`), so the mocked hub carries the pack's own words
 * rather than invented ones; a node the recording does not hold answers from the index with the blocks it
 * can fill and says the rest is in the pack. *What can we do?* is assembled from the verified slice — its
 * drivers, headroom and contrast — joined to those pages, which is exactly what the server does.
 *
 * Gates are computed per group from the slice's own validation row, so the group-aware readiness gate of
 * R3-03 behaves here as it does on the server: a run-wide readiness reading is stated once and never asks
 * for one waiver per group.
 */
import type { GuidanceText, HubIndex, HubNodeFull, HubPage, UsualAction, UsualReason } from "@/lib/api/cycle4";
import hubIndexJson from "./verified/hub_index.json";
import hubPagesJson from "./verified/hub_pages.json";
import { VERIFIED_CASE_NOUN, verifiedCaseTable, verifiedSlice } from "./verified";
import { tableRecords } from "@/lib/utils";

const INDEX = hubIndexJson as unknown as HubIndex;
const PAGES = hubPagesJson as unknown as Record<string, HubPage>;

export const hubIndex = (): HubIndex => ({ ...INDEX, overlays: overlays.size });

/** Project overlays written on this screen; they live for the session as the findings store does. */
export const overlays = new Map<string, GuidanceText>();

const overlayKey = (kind: string, id: string) => `${kind}:${id}`;

export function hubPage(nodeId: string): HubPage | undefined {
  const recorded = PAGES[nodeId];
  const node = (recorded?.node ?? (INDEX.nodes ?? []).find((n) => n.id === nodeId)) as HubNodeFull | undefined;
  if (!node) return undefined;
  const entryId = node.constraint_id ?? nodeId.split(":").slice(-1)[0] ?? nodeId;
  const kind = node.kind === "expectation" ? "constraint" : node.kind;
  return {
    node,
    guidance: recorded?.guidance ?? { plain_name: node.plain_name, method_name: node.method_name, expectation: node.method_name },
    related: recorded?.related ?? {},
    overlay: overlays.get(overlayKey(kind, entryId)) ?? null,
    process: INDEX.process ?? "p2p",
  };
}

/** The hub node an entry maps to, the way the served hub keys them (`<kind>:<pack>:<id>`). */
export function hubNodeFor(kind: string, entryId: string): string | undefined {
  const wanted = kind === "constraint" || kind === "expectation" ? "expectation" : kind;
  return (INDEX.nodes ?? []).find((n) => n.kind === wanted && (n.id === entryId || n.id.split(":").slice(-1)[0] === entryId))?.id;
}

export function guidanceFor(kind: string, entryId: string) {
  const nodeId = hubNodeFor(kind, entryId);
  const page = nodeId ? hubPage(nodeId) : undefined;
  return { kind, id: entryId, generic: page?.guidance ?? null, overlay: overlays.get(overlayKey(kind, entryId)) ?? null, hub_node: nodeId ?? null };
}

export function setOverlay(kind: string, entryId: string, body: Record<string, unknown>) {
  const now = new Date().toISOString();
  const entry: GuidanceText = {
    note: typeof body.note === "string" ? body.note : undefined,
    author: typeof body.author === "string" ? body.author : undefined,
    plain_name: typeof body.plain_name === "string" ? body.plain_name : undefined,
    review_status: "draft",
    updatedAt: now,
  };
  overlays.set(overlayKey(kind, entryId), entry);
  const node = hubNodeFor(kind, entryId);
  if (node) {
    const found = (INDEX.nodes ?? []).find((n) => n.id === node);
    if (found) found.hasOverlay = true;
  }
  return guidanceFor(kind, entryId);
}

// ---------------------------------------------------------------- gates, per group (R3-03)

type Validation = { censored_share?: number; replicated_share?: number };

export interface MockGate {
  id: string;
  kind: "readiness" | "censoring" | "replication" | "domain";
  status: "pending" | "passed" | "failed" | "waived";
  computed_status: "pending" | "passed" | "failed" | "waived";
  evidence: Record<string, unknown>;
  text: string;
  note: string | null;
  author: string | null;
  decidedAt: string | null;
}

/** Readings the browser has recorded, keyed by (run, slicing, key, gate). */
export const gateDecisions = new Map<string, { status: MockGate["status"]; note: string; author: string; decidedAt: string }>();
const gateKey = (runId: string, slicing: string, sliceKey: string, gateId: string) => `${runId}|${slicing}|${sliceKey}|${gateId}`;

/** The share the readiness report gives the whole log — one reading for the run, not one per group. */
const readinessLevel = () => (verifiedCaseTable.readiness?.items ?? []).some((i) => i.level === "fail") ? "fail" : "warn";

export function gatesFor(runId: string, slicing: string, sliceKey: string, view: string | undefined) {
  const slice = verifiedSlice(sliceKey, view ?? "Automation");
  const v = ((slice?.validation ?? {}) as Validation) ?? {};
  const censored = v.censored_share ?? 0;
  const replicated = v.replicated_share ?? 0;
  const level = readinessLevel();
  const built: MockGate[] = [
    {
      id: "readiness",
      kind: "readiness",
      status: level === "fail" ? "failed" : "passed",
      computed_status: level === "fail" ? "failed" : "passed",
      // no group share: this gate is the log's, and the screen states it once at the run
      evidence: { readinessStatus: level },
      text: `The data-readiness gate on this log is ${level}.`,
      note: null,
      author: null,
      decidedAt: null,
    },
    {
      id: "censoring",
      kind: "censoring",
      status: censored >= 0.4 ? "failed" : censored >= 0.2 ? "pending" : "passed",
      computed_status: censored >= 0.4 ? "failed" : censored >= 0.2 ? "pending" : "passed",
      evidence: { share: censored, warnAt: 0.2, failAt: 0.4, scope: "group" },
      text: `${Math.round(censored * 100)} % of these ${VERIFIED_CASE_NOUN} are still open at the end of the data: late closure cannot be judged for those ${VERIFIED_CASE_NOUN}.`,
      note: null,
      author: null,
      decidedAt: null,
    },
    {
      id: "replication",
      kind: "replication",
      status: replicated >= 0.5 ? "failed" : replicated >= 0.25 ? "pending" : "passed",
      computed_status: replicated >= 0.5 ? "failed" : replicated >= 0.25 ? "pending" : "passed",
      evidence: { share: replicated, warnAt: 0.25, failAt: 0.5, scope: "group" },
      text: replicated > 0 ? `${Math.round(replicated * 100)} % of these ${VERIFIED_CASE_NOUN} carry postings copied from the order header.` : "No replication caveat on this group.",
      note: null,
      author: null,
      decidedAt: null,
    },
  ];
  const gates = built.map((g) => {
    const decided = gateDecisions.get(gateKey(runId, slicing, sliceKey, g.id));
    return decided ? { ...g, status: decided.status, note: decided.note, author: decided.author, decidedAt: decided.decidedAt } : g;
  });
  // a gate the whole run carries never blocks one group's hypothesis; the run screen states it once
  const blocking = gates.filter((g) => g.id !== "readiness" && g.status !== "passed" && g.status !== "waived").map((g) => g.id);
  return { runId, slicing, sliceKey, view: view ?? null, caseNoun: VERIFIED_CASE_NOUN, cases: (slice?.row as { n_cases?: number } | undefined)?.n_cases ?? null, gates, blocking, passed: blocking.length === 0 };
}

export function decideGate(runId: string, slicing: string, sliceKey: string, gateId: string, body: Record<string, unknown>) {
  const status = String(body.status ?? "waived") as MockGate["status"];
  const note = typeof body.note === "string" ? body.note : "";
  const author = typeof body.author === "string" ? body.author : "";
  if ((status === "waived" || status === "passed") && !note) return undefined;
  gateDecisions.set(gateKey(runId, slicing, sliceKey, gateId), { status, note, author, decidedAt: new Date().toISOString() });
  return gatesFor(runId, slicing, sliceKey, undefined).gates.find((g) => g.id === gateId);
}

// ---------------------------------------------------------------- what can we do (R3-01)

type DriverRow = { constraint: string; layer: string; share_violated: number; delta_gap: number; share_of_shortfall?: number; description?: string };
type HeadroomRow = { constraint: string; gain_points?: number | null; gain_percent?: number | null };
type ContrastRow = { constraint: string; plain?: string };
type GuidanceRefRow = { kind: string; id: string; plain_name?: string | null; hub_node?: string | null };

export function whatCanWeDoFor(runId: string, slicing: string, sliceKey: string, view: string | undefined, top: number) {
  const slice = verifiedSlice(sliceKey, view ?? "Automation");
  const gates = gatesFor(runId, slicing, sliceKey, view);
  const drivers = tableRecords<DriverRow>(slice?.drivers as never)
    .filter((d) => d.delta_gap > 0)
    .slice(0, top);
  const headroom = tableRecords<HeadroomRow>(slice?.headroom as never);
  const contrast = tableRecords<ContrastRow>((slice as { contrast?: unknown } | undefined)?.contrast as never);
  const refs = ((slice as { guidance_refs?: GuidanceRefRow[] } | undefined)?.guidance_refs ?? []) as GuidanceRefRow[];
  const comparisons = tableRecords<{ constraint: string; sentence?: string | null }>((slice as { comparisons?: unknown } | undefined)?.comparisons as never);

  return {
    runId,
    slicing,
    sliceKey,
    view: view ?? null,
    caseNoun: VERIFIED_CASE_NOUN,
    reading: (slice as { reading_plain?: string } | undefined)?.reading_plain ?? null,
    drivers: drivers.map((d) => {
      const ref = refs.find((r) => r.kind === "constraint" && r.id === d.constraint);
      const nodeId = ref?.hub_node ?? hubNodeFor("constraint", d.constraint);
      const page = nodeId ? hubPage(nodeId) : undefined;
      const g = page?.guidance ?? {};
      const h = headroom.find((x) => x.constraint === d.constraint);
      return {
        constraint_id: d.constraint,
        plain_name: ref?.plain_name ?? g.plain_name ?? contrast.find((c) => c.constraint === d.constraint)?.plain ?? d.description ?? d.constraint,
        hub_node: nodeId ?? null,
        share_of_shortfall: d.share_of_shortfall ?? null,
        comparison: comparisons.find((c) => c.constraint === d.constraint)?.sentence ?? null,
        headroom_points: h?.gain_points ?? null,
        headroom_percent: h?.gain_percent ?? null,
        meaning_when_missed: g.meaning_when_missed ?? null,
        why_it_matters: g.why_it_matters ?? null,
        what_to_check_first: g.what_to_check_first ?? [],
        usual_reasons: (g.usual_reasons ?? []) as UsualReason[],
        usual_actions: (g.usual_actions ?? []) as UsualAction[],
        kpis: g.kpis ?? [],
        note: null,
      };
    }),
    gates: gates.gates,
    blocking: gates.blocking,
    actions: [],
    guidanceAvailable: true,
  };
}

// ---------------------------------------------------------------- the norm builder's inventory (R3-02)

/** The activities and every case attribute's values with counts, as `GET …/norms/inventory` answers. */
export function inventoryFor(caseTableId: string, cases: number, events: number) {
  const activities = verifiedCaseTable.activities.map((a) => ({ label: a.label, events: a.events, cases: a.cases, share: a.cases / Math.max(1, cases), stage: null, canonicalId: null }));
  const attributes = (verifiedCaseTable.attributes ?? []).map((name, i) => ({
    name,
    kind: "text",
    distinct: 4 + i,
    missing: 0,
    total: 4 + i,
    values: Array.from({ length: Math.min(6, 4 + i) }, (_, j) => ({ value: `${name.replace(/^case /, "")} ${j + 1}`, cases: Math.round(cases / (j + 2)), share: 1 / (j + 2) })),
    numeric: null,
  }));
  return {
    caseTableId,
    cases,
    events,
    caseNoun: VERIFIED_CASE_NOUN,
    activities,
    attributes,
    attributeNames: verifiedCaseTable.attributes ?? [],
    stages: (INDEX.nodes ?? []).filter((n) => n.kind === "stage").map((n, i) => ({ id: n.id.split(":")[1], label: n.plain_name, order: i + 1 })),
  };
}

// ---------------------------------------------------------------- applicability, calibration, what-if

/**
 * What an expectation can be made to apply to on this log (`GET …/norms/applicability`, R3-02): the flow
 * types the case table carries with their counts, the ones its rules name and it has none of with the reason
 * (R3-15), every case attribute, and the shape of each applicability clause.
 */
export function applicabilityOptionsFor(caseTableId: string, cases: number) {
  const inventory = inventoryFor(caseTableId, cases, 0);
  return {
    caseTableId,
    caseNoun: VERIFIED_CASE_NOUN,
    flowTypeAttribute: "case flow_type",
    flowTypes: [
      { name: "standard", cases: Math.round(cases * 0.96), share: 0.96 },
      { name: "rejected", cases: Math.round(cases * 0.03), share: 0.03 },
      { name: "partial delivery", cases: Math.round(cases * 0.01), share: 0.01 },
    ],
    flowTypesAbsent: [{ name: "returns", reason: "matches_nothing" as const, text: "No item of this log takes the return path, so an expectation restricted to it would never be evaluated." }],
    attributes: inventory.attributes,
    kinds: [
      { id: "all", label: "every one of these items", shape: null, available: true },
      { id: "flow_types", label: "only these kinds of flow", shape: { flow_types: [] as string[] }, available: true },
      { id: "attribute", label: "only items with this value", shape: { attribute: "", values: [] as string[] }, available: true },
      { id: "not_applicable", label: "not applicable to this log", shape: { not_applicable: true, note: "" }, available: true, note: "The expectation is left out of the score instead of averaged as a constant." },
    ],
  };
}

/** Rationales and owners recorded on a threshold in this session (`POST …/norms`), keyed by version. */
export const calibrations = new Map<string, { constraint_id: string; rationale?: string; owner?: string; decidedAt?: string }[]>();

/**
 * The calibration state of one norm version (`GET …/norms/{id}/calibration`, R3-02): every threshold with
 * its rationale and its owner, the expectations marked not applicable, and what still keeps the version in
 * `draft`. A threshold changed here without a reason and a name behind it is what `missingRationale` names.
 */
export function calibrationFor(normVersionId: string, status: string, constraints: { id: string; type?: string; params?: Record<string, unknown> }[]) {
  const recorded = calibrations.get(normVersionId) ?? [];
  const thresholds = constraints
    .filter((c) => c.type === "lag" || c.type === "metric" || c.type === "singularity" || c.type === "balance")
    .map((c) => {
      const own = recorded.find((r) => r.constraint_id === c.id);
      return {
        constraint_id: c.id,
        threshold: (c.params ?? {}) as Record<string, unknown>,
        changedHere: !!own,
        rationale: own?.rationale ?? null,
        owner: own?.owner ?? null,
        decidedAt: own?.decidedAt ?? null,
      };
    });
  const missingRationale = thresholds.filter((t) => t.changedHere && (!t.rationale || !t.owner)).map((t) => t.constraint_id);
  return {
    normVersionId,
    status,
    parentId: null,
    author: recorded[0]?.owner ?? null,
    thresholds,
    notApplicable: [] as Record<string, unknown>[],
    missingRationale,
    canLeaveDraft: missingRationale.length === 0,
  };
}

/** Scenarios recorded against a baseline run in this session. */
export const scenarios: { runId: string; name: string | null; baselineRunId: string | null; status: string; note: string | null; transforms: Record<string, unknown>[]; createdAt: string }[] = [];

export function newScenario(baselineRunId: string, body: Record<string, unknown>) {
  const entry = {
    runId: `run_whatif_${scenarios.length + 1}`,
    name: typeof body.name === "string" ? body.name : "scenario",
    baselineRunId,
    status: "queued",
    note: typeof body.note === "string" ? body.note : null,
    transforms: Array.isArray(body.transforms) ? (body.transforms as Record<string, unknown>[]) : [],
    createdAt: new Date().toISOString(),
  };
  scenarios.push(entry);
  return entry;
}

/**
 * What one scenario changed against its frozen baseline (`GET …/runs/{id}/whatif`, R3-27): the groups whose
 * priority moved, with the change in points and in rank, and the ones that entered or left the list.
 */
export function changeTableFor(runId: string, slicing: string, view: string, minCases: number) {
  const rows = [0, 1, 2].map((i) => ({
    key: `["group_${i + 1}"]`,
    keys: { group: `group ${i + 1}` },
    state: (i === 2 ? "entered" : "changed") as "changed" | "entered" | "left",
    baseline: { mean_score: 0.84 - i * 0.02, stable_PI: 900 - i * 200, rank: i + 1 },
    scenario: { mean_score: 0.88 - i * 0.02, stable_PI: 700 - i * 150, rank: i + 2 },
    deltaCases: 0,
    deltaMeanPoints: 4,
    deltaPriority: -(200 - i * 50),
    deltaRank: -1,
    unchanged: false,
  }));
  const scenario = scenarios.find((s) => s.runId === runId);
  return {
    runId,
    baselineRunId: scenario?.baselineRunId ?? "run_41",
    name: scenario?.name ?? "make-to-order items get their own threshold",
    note: scenario?.note ?? null,
    slicing,
    view,
    minCases,
    caseNoun: VERIFIED_CASE_NOUN,
    rows,
    total: rows.length,
    summary: {
      groupsBaseline: 57,
      groupsScenario: 58,
      groupsCompared: 57,
      groupsChanged: rows.length,
      groupsUnchanged: 54,
      entered: ['["group_3"]'],
      left: [],
      topTenOverlap: 0.9,
      leaderBaseline: '["group_1"]',
      leaderScenario: '["group_1"]',
      priorityBaseline: 900,
      priorityScenario: 700,
      rankAgreement: 0.94,
      largestMove: '["group_2"]',
      text: "The leader does not change; one group enters the list and three move by a rank.",
    },
    transforms: scenario?.transforms ?? [],
    normChanges: ["Shipped within the target time: 14 days becomes 30 for make-to-order items"],
    provenance: { baseline: { runId: scenario?.baselineRunId ?? "run_41" }, scenario: { runId } },
  };
}

/** What a transform layer would touch before it is run (`POST …/runs/{id}/whatif/preview`). */
export function transformPreviewFor(runId: string, transforms: Record<string, unknown>[]) {
  return {
    runId,
    caseNoun: VERIFIED_CASE_NOUN,
    transforms: transforms.map((t) => ({ kind: String(t.kind ?? "cap_lag"), spec: t, casesSelected: 1200, casesTouched: 940, eventsMoved: 0, eventsRemoved: 0 })),
  };
}
