/** Feature API: knowledge. Generated DTOs remain the wire contract. */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "./transport";
import type { components } from "@wise/api-schema";
type S = components["schemas"];
const enc = encodeURIComponent;
const IMMUTABLE = 1000 * 60 * 30;

const knowledgeKeys = {
  hub: (p: string, process: string) => ["projects", p, "knowledge", "hub", process] as const,
  hubPage: (p: string, nodeId: string) => ["projects", p, "knowledge", "hub", "node", nodeId] as const,
  guidance: (p: string, kind: string, id: string) => ["projects", p, "guidance", kind, id] as const,
};

export type GuidanceRef = S["GuidanceRefOut"];

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

export type HubIndex = S["HubIndex"];

export type HubNode = S["HubNode"];

export type HubEdge = S["HubEdge"];

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

/** Only the open content blocks are refined; named outer fields come from the DTO. */
export type HubPage = Omit<S["HubPage"], "node" | "guidance" | "related" | "overlay"> & {
  node: HubNodeFull; guidance?: GuidanceText | null; related?: HubRelated; overlay?: GuidanceText | null;
};

export type Guidance = Omit<S["Guidance"], "generic" | "overlay"> & { generic?: GuidanceText | null; overlay?: GuidanceText | null };

/** What a hub chip needs to open a page: a node id, or the kind and id the guidance endpoint resolves. */
export interface HubTarget {
  nodeId?: string | null;
  kind?: "layer" | "constraint" | "expectation" | "failure_mode";
  entryId?: string;
  /** What the chip is attached to, for the panel's title before the answer arrives. */
  label?: string;
}

export const hubQuery = (projectId: string, process?: string) =>
  queryOptions({
    queryKey: knowledgeKeys.hub(projectId, process ?? ""),
    queryFn: () => http.get<HubIndex>(`/projects/${enc(projectId)}/knowledge/hub`, { process }),
    staleTime: IMMUTABLE,
    retry: false,
  });

export const hubPageQuery = (projectId: string, nodeId: string, process?: string) =>
  queryOptions({
    queryKey: knowledgeKeys.hubPage(projectId, nodeId),
    queryFn: () => http.get<HubPage>(`/projects/${enc(projectId)}/knowledge/hub/${enc(nodeId)}`, { process }),
    staleTime: IMMUTABLE,
    enabled: !!nodeId,
    retry: false,
  });

export const guidanceQuery = (projectId: string, kind: string, entryId: string, normVersionId?: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.guidance(projectId, kind, entryId), normVersionId ?? ""] as const,
    queryFn: () => http.get<Guidance>(`/projects/${enc(projectId)}/guidance/${enc(kind)}/${enc(entryId)}`, { normVersionId }),
    staleTime: IMMUTABLE,
    enabled: !!entryId,
    retry: false,
  });

/** *Your organisation's note* (RK-5): added to the pack's text, never instead of it. */
export function useSetOverlay(projectId: string, kind: string, entryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { note?: string; author?: string; plain_name?: string }) =>
      http.put<Guidance>(`/projects/${enc(projectId)}/guidance/${enc(kind)}/${enc(entryId)}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.guidance(projectId, kind, entryId) });
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
