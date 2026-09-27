import type { NormDocument } from "./normAuthoring";

export type AuthoringSituation = "new" | "known" | "reassess";
export type AuthoringCollaboration = "single" | "workshop" | "async";
export interface AuthoringBrief {
  situation: AuthoringSituation;
  goal: string;
  collaboration: AuthoringCollaboration;
  participants: string;
  owner: string;
  evidence: string;
  openQuestions: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("; ") : "";
}

export function readAuthoringBrief(document: NormDocument): AuthoringBrief {
  const saved = record(document.metadata?.authoring);
  return {
    situation: saved.situation === "known" || saved.situation === "reassess" ? saved.situation : "new",
    goal: text(saved.goal),
    collaboration: saved.collaboration === "workshop" || saved.collaboration === "async" ? saved.collaboration : "single",
    participants: text(saved.participants),
    owner: text(saved.owner),
    evidence: text(saved.evidence) || text(saved.source),
    openQuestions: text(saved.openQuestions) || text(saved.open_questions),
  };
}

/** A brief describes the work; it never supplies calibration, approval or rule changes. */
export function withAuthoringBrief(document: NormDocument, brief: AuthoringBrief): NormDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      authoring: { ...record(document.metadata?.authoring), ...brief },
    },
  };
}

export function readLayerGuidance(document: NormDocument, layerId: string) {
  const saved = record(record(record(document.metadata?.guidance).layers)[layerId]);
  const rawChecks = saved.what_to_check_first;
  return {
    expectation: text(saved.expectation),
    why: text(saved.why_it_matters),
    checks: Array.isArray(rawChecks) ? rawChecks.filter((item): item is string => typeof item === "string") : text(rawChecks) ? [text(rawChecks)] : [],
    owner: text(saved.owner_role),
    stakeholders: text(saved.stakeholders),
  };
}
