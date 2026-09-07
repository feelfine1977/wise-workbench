/**
 * Fourth-release sources: the four answers the server already gives and no screen read until now —
 * *What can we do?* for one group, the gates and the review records behind a hypothesis, the knowledge
 * hub with a page per node, and the inventory the norm builder writes its pickers from.
 *
 * Every operation is in `packages/api-schema/openapi.yaml`; the response shapes come from the generated
 * types where the contract names them and are written here where the contract leaves an object open
 * (`WhatCanWeDoDriver.usual_reasons`, `HubPage.node`, `Guidance.generic`). A backend that does not serve an
 * operation yet answers 404 or 405, and the queries below say so in one sentence instead of hanging: the
 * screens read `notServed` and render their own "not on this backend" state.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import { c2 } from "@/lib/api/cycle2";

type S = components["schemas"];

const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

/** An operation this backend does not serve; the screen says so rather than showing a status code. */
export const notServed = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);

// ---------------------------------------------------------------- shapes

/** One candidate cause of a driver: what to check in the log, or whom to ask outside it. */
export interface UsualReason {
  text: string;
  where?: "log" | "outside" | string;
  check?: string | null;
  reading?: string | null;
}

/** One improvement action of a driver, with the countermeasure type and the role that owns it. */
export interface UsualAction {
  text: string;
  countermeasure?: string | null;
  owner_role?: string | null;
  effect_area?: string | null;
}

/**
 * One driver of `WhatCanWeDo`. The contract's own type carries an open index signature, which erases the
 * field types under `Omit`, so the fields the screen reads are written out here; they are the contract's,
 * name for name (`WhatCanWeDoDriver`).
 */
export interface Driver {
  constraint_id: string;
  plain_name?: string | null;
  hub_node?: string | null;
  share_of_shortfall?: number | null;
  comparison?: string | null;
  /** Score points the group would gain if this expectation were always met. */
  headroom_points?: number | null;
  headroom_percent?: number | null;
  meaning_when_missed?: string | null;
  why_it_matters?: string | null;
  what_to_check_first?: string[];
  usual_reasons?: UsualReason[];
  usual_actions?: UsualAction[];
  kpis?: string[];
  note?: string | null;
}

export interface WhatCanWeDo {
  runId: string;
  slicing: string;
  sliceKey: string;
  view?: string | null;
  caseNoun?: string | null;
  reading?: string | null;
  drivers?: Driver[];
  gates?: Gate[];
  blocking?: string[];
  actions?: ReviewItem[];
  guidanceAvailable?: boolean;
}
export type Gate = S["Gate"];
export type GateState = NonNullable<Gate["status"]>;
export type Gates = S["Gates"];
export type ReviewItem = S["ReviewItem"];
export type HubIndex = S["HubIndex"];
export type HubNode = S["HubNode"];
export type HubEdge = S["HubEdge"];
export type Inventory = S["Inventory"];
export type ActivityInventory = S["ActivityInventory"];
export type AttributeInventory = S["AttributeInventory"];
export type GuidanceQuestions = S["GuidanceQuestions"];

/** The blocks of one guidance tier (`knowledge_hub_panel.md` §1); the contract leaves the object open. */
export interface GuidanceText {
  kind?: string;
  id?: string;
  plain_name?: string | null;
  missed_label?: string | null;
  expectation?: string | null;
  meaning_when_missed?: string | null;
  why_it_matters?: string | null;
  how_detected?: string | null;
  usual_reasons?: UsualReason[];
  usual_actions?: UsualAction[];
  what_to_check_first?: string[];
  examples?: { kind?: string; text?: string; trace?: string | null }[];
  kpis?: string[];
  owner_role?: string | null;
  stakeholders?: string | string[] | null;
  sources?: string[];
  review_status?: string | null;
  version?: string | null;
  note?: string | null;
  author?: string | null;
  updatedAt?: string | null;
  hub_node?: string | null;
  method_name?: string | null;
}

/** The node block of a hub page: the plain name is the title, the method name the subtitle. */
export interface HubNodeFull extends HubNode {
  template?: string | null;
  constraint_id?: string | null;
  constraint_type?: string | null;
  layer?: string | null;
  missed_label?: string | null;
  stage?: string | null;
  order?: number | null;
}

export interface HubRelated {
  stage?: HubNode | null;
  expectations?: HubNode[];
  failure_modes?: HubNode[];
  kpis?: HubNode[];
  reasons?: HubNode[];
  actions?: HubNode[];
  layers?: HubNode[];
  playbook?: { question?: string; id?: string }[];
}

export interface HubPage {
  node: HubNodeFull;
  guidance?: GuidanceText | null;
  related?: HubRelated;
  overlay?: GuidanceText | null;
  process?: string | null;
}

export interface Guidance {
  kind: string;
  id: string;
  generic?: GuidanceText | null;
  overlay?: GuidanceText | null;
  hub_node?: string | null;
}

/** What a hub chip needs to open a page: a node id, or the kind and id the guidance endpoint resolves. */
export interface HubTarget {
  nodeId?: string | null;
  kind?: "layer" | "constraint" | "expectation" | "failure_mode";
  entryId?: string;
  /** What the chip is attached to, for the panel's title before the answer arrives. */
  label?: string;
}

// ---------------------------------------------------------------- keys

export const keys4 = {
  whatCanWeDo: (p: string, r: string, slicing: string, key: string, view: string) => ["projects", p, "runs", r, "what-can-we-do", slicing, key, view] as const,
  gates: (p: string, r: string, slicing: string, key: string, view: string) => ["projects", p, "runs", r, "gates", slicing, key, view] as const,
  review: (p: string, collection: string) => ["projects", p, collection] as const,
  hub: (p: string, process: string) => ["projects", p, "knowledge", "hub", process] as const,
  hubPage: (p: string, nodeId: string) => ["projects", p, "knowledge", "hub", "node", nodeId] as const,
  guidance: (p: string, kind: string, id: string) => ["projects", p, "guidance", kind, id] as const,
  inventory: (p: string, caseTableId: string) => ["projects", p, "norms", "inventory", caseTableId] as const,
  guidanceQuestions: (p: string, kind: string, id: string) => ["projects", p, "norms", "guidance-questions", kind, id] as const,
};

// ---------------------------------------------------------------- what can we do (R3-01)

export const whatCanWeDoQuery = (projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string; top?: number }) =>
  queryOptions({
    queryKey: keys4.whatCanWeDo(projectId, runId, params.slicing, params.sliceKey, params.view ?? ""),
    queryFn: () =>
      c2.get<WhatCanWeDo>(`/projects/${enc(projectId)}/runs/${enc(runId)}/what-can-we-do`, {
        slicing: params.slicing,
        key: params.sliceKey,
        view: params.view,
        top: params.top ?? 3,
      }),
    staleTime: IMMUTABLE,
    retry: false,
  });

// ---------------------------------------------------------------- gates (R3-03)

export const gatesQuery = (projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string }) =>
  queryOptions({
    queryKey: keys4.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? ""),
    queryFn: () =>
      c2.get<Gates>(`/projects/${enc(projectId)}/runs/${enc(runId)}/gates`, {
        slicing: params.slicing,
        key: params.sliceKey,
        view: params.view,
      }),
    staleTime: 0,
    retry: false,
  });

export interface GateDecision {
  status: "passed" | "failed" | "waived";
  note: string;
  author: string;
}

/**
 * Pass, fail or waive one gate, with a note and an author that the endpoint requires (§1.8). The answer
 * replaces the cached gate list, so the hypothesis form unblocks in the same tick as the decision.
 */
export function useDecideGate(projectId: string, runId: string, params: { slicing: string; sliceKey: string; view?: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { gateId: string } & GateDecision) =>
      c2.post<Gates>(
        `/projects/${enc(projectId)}/runs/${enc(runId)}/gates/${enc(input.gateId)}`,
        { status: input.status, note: input.note, author: input.author },
        { slicing: params.slicing, key: params.sliceKey, view: params.view },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys4.gates(projectId, runId, params.slicing, params.sliceKey, params.view ?? "") });
      void qc.invalidateQueries({ queryKey: keys4.whatCanWeDo(projectId, runId, params.slicing, params.sliceKey, params.view ?? "") });
    },
  });
}

/**
 * The gates that block this group's own hypothesis (R3-03): a gate whose computed state on **this group**
 * is not passed and which has not been waived. A run-wide gate — one that reads the same on every group of
 * the log — is stated once at the run and never counted 57 times here.
 */
export function blockingGates(gates: Gate[] | undefined): Gate[] {
  return (gates ?? []).filter((g) => g.status !== "passed" && g.status !== "waived" && !isRunWide(g));
}

/** A gate whose evidence names the log rather than the group: the readiness report of the case table. */
export function isRunWide(gate: Gate): boolean {
  if (gate.kind === "readiness") {
    const evidence = (gate.evidence ?? {}) as { share?: number | null; scope?: string };
    // a readiness gate the backend computes per group carries the group's own share; without one it is the log's
    return evidence.scope !== "group" && (evidence.share === undefined || evidence.share === null);
  }
  return false;
}

// ---------------------------------------------------------------- review records: findings, actions, hypotheses (R3-01, R3-03)

export type ReviewCollection = "findings" | "actions" | "hypotheses";

export const reviewQuery = (projectId: string, collection: ReviewCollection, params?: { runId?: string; slicing?: string; sliceKey?: string }) =>
  queryOptions({
    queryKey: [...keys4.review(projectId, collection), params?.runId ?? "", params?.slicing ?? "", params?.sliceKey ?? ""] as const,
    queryFn: () =>
      c2.get<ReviewItem[]>(`/projects/${enc(projectId)}/${collection}`, {
        runId: params?.runId,
        slicing: params?.slicing,
        sliceKey: params?.sliceKey,
      }),
    staleTime: 0,
    retry: false,
  });

export function useCreateReviewItem(projectId: string, collection: ReviewCollection) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => c2.post<ReviewItem>(`/projects/${enc(projectId)}/${collection}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys4.review(projectId, collection) }),
  });
}

export function useUpdateReviewItem(projectId: string, collection: ReviewCollection) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: Record<string, unknown> }) =>
      c2.patch<ReviewItem>(`/projects/${enc(projectId)}/${collection}/${enc(input.id)}`, input.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys4.review(projectId, collection) }),
  });
}

// ---------------------------------------------------------------- the knowledge hub (R3-05)

export const hubQuery = (projectId: string, process?: string) =>
  queryOptions({
    queryKey: keys4.hub(projectId, process ?? ""),
    queryFn: () => c2.get<HubIndex>(`/projects/${enc(projectId)}/knowledge/hub`, { process }),
    staleTime: IMMUTABLE,
    retry: false,
  });

export const hubPageQuery = (projectId: string, nodeId: string, process?: string) =>
  queryOptions({
    queryKey: keys4.hubPage(projectId, nodeId),
    queryFn: () => c2.get<HubPage>(`/projects/${enc(projectId)}/knowledge/hub/${enc(nodeId)}`, { process }),
    staleTime: IMMUTABLE,
    enabled: !!nodeId,
    retry: false,
  });

export const guidanceQuery = (projectId: string, kind: string, entryId: string, normVersionId?: string) =>
  queryOptions({
    queryKey: [...keys4.guidance(projectId, kind, entryId), normVersionId ?? ""] as const,
    queryFn: () => c2.get<Guidance>(`/projects/${enc(projectId)}/guidance/${enc(kind)}/${enc(entryId)}`, { normVersionId }),
    staleTime: IMMUTABLE,
    enabled: !!entryId,
    retry: false,
  });

/** *Your organisation's note* (RK-5): added to the pack's text, never instead of it. */
export function useSetOverlay(projectId: string, kind: string, entryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { note?: string; author?: string; plain_name?: string }) =>
      c2.put<Guidance>(`/projects/${enc(projectId)}/guidance/${enc(kind)}/${enc(entryId)}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys4.guidance(projectId, kind, entryId) });
      void qc.invalidateQueries({ queryKey: ["projects", projectId, "knowledge"] });
    },
  });
}

/** The hub node an id of the application maps to, for the *What does this mean?* chips. */
export function hubNodeOf(index: HubIndex | undefined, kind: string, id: string): string | undefined {
  if (!index?.nodes?.length) return undefined;
  const wanted = new Set<string>([id, `${kind}:${id}`]);
  for (const node of index.nodes) {
    if (wanted.has(node.id)) return node.id;
    const own = node as HubNodeFull;
    if (kind === "constraint" && own.constraint_id === id) return node.id;
    if (kind === "layer" && own.layer === id) return node.id;
    // node ids are `<kind>:<pack>:<id>`; the last segment is the entry
    const tail = node.id.split(":").slice(-1)[0];
    if (tail === id && node.kind.startsWith(kind === "constraint" ? "expectation" : kind)) return node.id;
  }
  return undefined;
}

// ---------------------------------------------------------------- the norm builder's inventory (R3-02)

export const inventoryQuery = (projectId: string, caseTableId: string) =>
  queryOptions({
    queryKey: keys4.inventory(projectId, caseTableId),
    queryFn: () => c2.get<Inventory>(`/projects/${enc(projectId)}/norms/inventory`, { caseTableId }),
    staleTime: IMMUTABLE,
    enabled: !!caseTableId,
    retry: false,
  });

export const guidanceQuestionsQuery = (projectId: string, kind: string, id?: string) =>
  queryOptions({
    queryKey: keys4.guidanceQuestions(projectId, kind, id ?? ""),
    queryFn: () => c2.get<GuidanceQuestions>(`/projects/${enc(projectId)}/norms/guidance-questions`, { kind, id }),
    staleTime: IMMUTABLE,
    retry: false,
  });

/** One constraint checked against the case table before it joins the norm: the plain sentence and the misses. */
export interface ConstraintCheck {
  valid: boolean;
  errors?: { field?: string; message: string }[];
  id?: string | null;
  layer?: string | null;
  type?: string | null;
  sentence?: string | null;
  rule_sentence?: string | null;
  applicability_sentence?: string | null;
  activities?: { label: string; known: boolean; cases?: number }[];
  casesInScope?: number | null;
  casesEvaluated?: number | null;
  casesMissing?: number | null;
  shareMissing?: number | null;
  note?: string | null;
  caseNoun?: string | null;
}

export async function checkConstraint(projectId: string, caseTableId: string, constraint: Record<string, unknown>): Promise<ConstraintCheck> {
  return c2.post<ConstraintCheck>(`/projects/${enc(projectId)}/norms/constraints/check`, { caseTableId, constraint });
}
