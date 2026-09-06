/**
 * The plain-language layer (panel report, section 2): one table with the plain label, the method's
 * term and a one-sentence definition per concept. Every column header, badge, filter label, chart axis
 * and popover reads its words from here; the ribbon's vocabulary switch decides which of the two is
 * primary. Plain is the default; the other vocabulary appears as a muted secondary label.
 */
import type { HotspotType, Kind, Stability } from "@wise/api-schema";
import tokens from "@wise/design-tokens";

export type Vocabulary = "plain" | "method";
export const VOCABULARIES: readonly Vocabulary[] = ["plain", "method"];

export interface TermEntry {
  id: string;
  plain: string;
  method: string;
  definition: string;
  /** Formula in the method's notation, shown in popovers and the glossary. */
  formula?: string;
  /** The comprehension test's better plain wording (cycle-1 review §9), shown in the glossary beside the label. */
  reworded?: string;
}

export const TERMS: readonly TermEntry[] = [
  { id: "slice", plain: "group", method: "slice", definition: "a set of cases that share a value, e.g. one vendor or one spend area", reworded: "group of purchase order items" },
  { id: "constraint", plain: "expectation", method: "constraint", definition: 'a rule the process is expected to follow, e.g. "invoice cleared within 30 days of receipt"', reworded: "rule" },
  { id: "layer", plain: "expectation area", method: "layer", definition: "a family of expectations, e.g. timeliness, completeness, change discipline", reworded: "what is mostly wrong: invoices waiting too long, repeated postings, …" },
  { id: "view", plain: "perspective", method: "view", definition: "whose expectations count and how much, e.g. Finance or Logistics", reworded: "Finance perspective: payment and closure weigh most" },
  { id: "violation_share", plain: "cases missing the expectation", method: "violation share", definition: "the share of cases in the group that do not meet the rule", reworded: "items missing this rule: 42 %" },
  { id: "score", plain: "share of rules met", method: "score", definition: "the weighted share of applicable expectations a case meets; 100 % means every rule is met", reworded: "share of rules met: 71 %" },
  { id: "gap", plain: "shortfall", method: "gap", definition: "how far the group's average score is below the overall score, in score points; the percent in brackets is relative to the overall score", formula: "gap = (μ̄ − μ_s)₊", reworded: "0.9 points below the overall score of 84.4 (about 1 % lower)" },
  { id: "stable_gap", plain: "shortfall, small groups discounted", method: "stable gap", definition: "the shortfall after pulling small groups towards the average (γ)", formula: "μ̃_s = n/(n+γ)·μ_s + γ/(n+γ)·μ̄ ;  stable gap = (μ̄ − μ̃_s)₊ = n/(n+γ) · gap", reworded: "shortfall, small groups count less" },
  { id: "PI", plain: "priority", method: "PI", definition: "shortfall × number of cases: how much is at stake", formula: "PI = n · (μ̄ − μ_s)₊", reworded: "size of the problem (items × points), shown as a bar and as rank 1 of 30" },
  { id: "stable_PI", plain: "priority, small groups discounted", method: "stable PI", definition: "the priority used for ranking", formula: "stable PI = n · stable gap" },
  { id: "gamma", plain: "caution against small groups", method: "γ", definition: "how strongly small groups are pulled towards the average; a group with as many cases as γ keeps half of its shortfall", reworded: "small groups count less (groups under γ items are pulled towards the average)" },
  { id: "kind", plain: "kind of problem", method: "hotspot type", definition: "acute (few cases, far off), systematic (one pattern behind it) or widespread (many cases, slightly off)" },
  { id: "kind_acute", plain: "acute", method: "hotspot type: severity", definition: "a small group with a large shortfall: few cases, far off" },
  { id: "kind_systematic", plain: "systematic", method: "hotspot type: mechanism", definition: "a group whose shortfall comes from one recurring expectation area: one pattern behind it", reworded: "one kind of problem explains most of it" },
  { id: "kind_widespread", plain: "widespread", method: "hotspot type: reservoir", definition: "a large group with a small shortfall each, big in total: many cases, slightly off" },
  { id: "stability", plain: "confidence in rank", method: "stability", definition: "whether the rank held when the cases were resampled" },
  { id: "stability_stable", plain: "high confidence in the rank", method: "stability: stable", definition: "the rank held in at least 80 % of resamples", reworded: "the position in this list is reliable (held in 8 of 10 resamples)" },
  { id: "stability_fragile", plain: "medium confidence", method: "stability: fragile", definition: "the rank moved in resamples", reworded: "the position may move" },
  { id: "stability_insufficient_support", plain: "not enough cases to be sure", method: "stability: insufficient support", definition: "fewer cases than the rule needs", reworded: "too few items to say" },
  { id: "stability_unknown", plain: "confidence not computed", method: "stability: unknown", definition: "the resampling analysis has not run for this run" },
  { id: "dominant_layer", plain: "most-missed expectation area", method: "dominant layer", definition: "the expectation area that explains most of the shortfall", reworded: "what is mostly wrong" },
  { id: "driver", plain: "expectation behind the shortfall", method: "driver", definition: "one missed expectation and how much of the shortfall it explains", reworded: "the rule that explains most of it" },
  { id: "contribution", plain: "share of the shortfall", method: "contribution", definition: "how much of the shortfall this expectation accounts for", formula: "Δ = mean penalty in the group − mean penalty in the log; the Δ sum to the gap" },
  { id: "applicability", plain: "applies to", method: "applicability", definition: "which cases an expectation is meant for" },
  { id: "in_scope", plain: "counted", method: "in scope", definition: "cases the expectation applies to", reworded: "this rule applies to 92 % of the items" },
  { id: "censoring", plain: "still open at the end of the data", method: "right-censored", definition: "cases that had not finished when the data was extracted" },
  { id: "replication", plain: "duplicated events", method: "replication", definition: "the same event copied onto several cases (e.g. a header line)", reworded: "the same posting copied onto every item of the order" },
  { id: "headroom", plain: "possible gain", method: "headroom", definition: "how much the group would improve if this expectation were fully met", reworded: "what would be gained if this rule were always met" },
  { id: "readiness", plain: "data caveats", method: "readiness", definition: "what in the data could distort the results", reworded: "what could distort this" },
  // terms the screens need beyond the panel's table, in the same spirit
  { id: "n_cases", plain: "cases", method: "n_cases", definition: "scored cases in the group; groups under the minimum are not ranked" },
  { id: "mean_score", plain: "average how-well score", method: "mean score (μ_s)", definition: "average of the group's case scores in the chosen perspective" },
  { id: "global_mean", plain: "overall average", method: "global mean (μ̄)", definition: "average score of all cases; every shortfall is measured against it" },
  { id: "PI_lower", plain: "priority, cautious", method: "PI lower bound", definition: "the priority with a statistical margin subtracted", formula: "PI_lower = n · (stable gap − z·se)₊" },
  { id: "rank", plain: "rank", method: "rank", definition: "position in the list ordered by priority, small groups discounted" },
  { id: "min_cases", plain: "at least … cases", method: "min cases", definition: "groups with fewer scored cases are not ranked" },
  { id: "penalty_mass", plain: "where the shortfall sits", method: "penalty mass", definition: "sum of 1 − score over the cases of a sub-group" },
  { id: "gate", plain: "check before acting", method: "validation gate", definition: "a check on data quality, open cases, duplicated events or plausibility that a finding passes, fails or is waived with a note" },
  { id: "reading", plain: "reading", method: "reading sentence", definition: "one plain sentence per group: cases, shortfall, kind, most-missed area, confidence, priority" },
  { id: "worst_cases", plain: "cases furthest off", method: "worst cases", definition: "the cases with the lowest score in the group" },
  { id: "trace", plain: "what happened in the case", method: "trace", definition: "the events of one case in time order with the expectations it missed" },
  { id: "flow", plain: "where in the flow", method: "process map", definition: "activities and paths with the expectations drawn on them" },
  { id: "backlog", plain: "where is it worst", method: "backlog", definition: "the ranked list of groups" },
  { id: "signal", plain: "signal", method: "hotspot", definition: "a group worth a closer look" },
  // cycle 2
  { id: "case_noun", plain: "purchase order items", method: "cases", definition: "the business name of a case from the mapping; the word the screens use instead of \"cases\"" },
  { id: "comparison", plain: "compared with everyone else", method: "contrast", definition: "one real-unit sentence from the top expectation: what happens here against elsewhere (days, postings, shares)" },
  { id: "caveat", plain: "data caveat on this group", method: "readiness item share", definition: "how much of the group a data caveat touches, e.g. 14 % still open at the end of the data" },
  { id: "flow_type", plain: "flow type", method: "flow type", definition: "one way the process runs (e.g. three-way match with the invoice after goods receipt); flow types have their own expectations" },
  { id: "scope", plain: "one flow type only", method: "run scope", definition: "a run restricted to one flow type: its own ranked list, map and reasons; applicability rules stay untouched" },
  { id: "filter", plain: "cases in / out", method: "filter model", definition: "clauses that keep or exclude cases on the map, the ranked list and the analytics; they travel in the address and never change applicability" },
  { id: "decision", plain: "decision on a data caveat", method: "mapping decision", definition: "what you decided about a caveat (drop, collapse, censor, …), with author and note; it rebuilds the case table" },
  { id: "snapshot", plain: "frozen screen", method: "snapshot", definition: "a picture of a screen with its numbers, its context and your note, kept in the notebook" },
  { id: "drill", plain: "drill into this group", method: "nested slicing", definition: "a finer grouping restricted to one group's cases, e.g. vendors inside Packaging" },
];

const byId: Record<string, TermEntry> = Object.fromEntries(TERMS.map((t) => [t.id, t]));

/** The primary label of a term in the given vocabulary. Unknown ids come back unchanged. */
export function label(id: string, vocabulary: Vocabulary = "plain"): string {
  const t = byId[id];
  if (!t) return id;
  return vocabulary === "plain" ? t.plain : t.method;
}

/** The other vocabulary's label (the muted secondary label). */
export function secondary(id: string, vocabulary: Vocabulary = "plain"): string | undefined {
  const t = byId[id];
  if (!t) return undefined;
  return vocabulary === "plain" ? t.method : t.plain;
}

export function definition(id: string): string | undefined {
  return byId[id]?.definition;
}

export function term(id: string): TermEntry | undefined {
  return byId[id];
}

// ---------------------------------------------------------------- kinds of problem
export const KIND_OF_HOTSPOT: Record<HotspotType, Kind> = { severity: "acute", mechanism: "systematic", reservoir: "widespread" };
export const HOTSPOT_OF_KIND: Record<Kind, HotspotType> = { acute: "severity", systematic: "mechanism", widespread: "reservoir" };
export const KINDS: readonly Kind[] = ["acute", "systematic", "widespread"];

export function kindOf(row: { kind?: Kind | null; hotspot_type?: HotspotType | null } | undefined): Kind | undefined {
  if (!row) return undefined;
  if (row.kind) return row.kind;
  return row.hotspot_type ? KIND_OF_HOTSPOT[row.hotspot_type] : undefined;
}

export const kindGlyph: Record<Kind, string> = {
  acute: tokens.semantic.kind.acute.glyph,
  systematic: tokens.semantic.kind.systematic.glyph,
  widespread: tokens.semantic.kind.widespread.glyph,
};

export function kindReading(kind: Kind): string {
  return tokens.semantic.kind[kind].reading;
}

export function kindLabel(kind: Kind, vocabulary: Vocabulary = "plain"): string {
  return vocabulary === "plain" ? kind : HOTSPOT_OF_KIND[kind];
}

// ---------------------------------------------------------------- confidence in the rank
export const STABILITIES: readonly Stability[] = ["stable", "fragile", "insufficient_support", "unknown"];

export const stabilityGlyph: Record<Stability, string> = {
  stable: tokens.semantic.stability.stable.glyph,
  fragile: tokens.semantic.stability.fragile.glyph,
  insufficient_support: tokens.semantic.stability.insufficient_support.glyph,
  unknown: tokens.semantic.stability.unknown.glyph,
};

/** "high", "medium", "not enough cases to be sure", "not computed" — the plain confidence words. */
export function confidenceOf(stability: Stability | null | undefined): string {
  switch (stability ?? "unknown") {
    case "stable":
      return "high";
    case "fragile":
      return "medium";
    case "insufficient_support":
      return "not enough cases to be sure";
    default:
      return "not computed";
  }
}

export function stabilityLabel(stability: Stability | null | undefined, vocabulary: Vocabulary = "plain"): string {
  const s: Stability = stability ?? "unknown";
  return vocabulary === "plain" ? confidenceOf(s) : s.replace("_", " ");
}

/** The ranking rule in one sentence, in the chosen vocabulary. */
export function rankingRule(vocabulary: Vocabulary, gamma: number): string {
  return vocabulary === "plain"
    ? `Ranked by how many cases × how far below expectation, with small groups discounted (γ = ${gamma}).`
    : `Ranked by stable PI = n · (μ̄ − μ̃_s)₊, the shrinkage form of the priority index with γ = ${gamma}.`;
}
