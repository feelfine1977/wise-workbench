/**
 * Glossary (UX-18): both vocabularies, from the translation table. Descriptive wording only:
 * "coincides with", "driven by (in the score)"; never "root cause", "fault" or "effect" in generated text.
 */
import { TERMS, type TermEntry } from "./vocabulary";

export interface GlossaryEntry {
  id: string;
  /** Plain label. */
  term: string;
  /** The method's term. */
  method: string;
  definition: string;
  formula?: string;
}

const HELP_ONLY: TermEntry[] = [
  { id: "worst_cases", plain: "cases furthest off", method: "worst cases", definition: "the cases with the lowest score in the group" },
];

export const glossary: GlossaryEntry[] = [...TERMS, ...HELP_ONLY.filter((h) => !TERMS.some((t) => t.id === h.id))].map((t) => ({
  id: t.id,
  term: t.plain,
  method: t.method,
  definition: t.definition,
  formula: t.formula,
}));

export const glossaryById: Record<string, GlossaryEntry> = Object.fromEntries(glossary.map((g) => [g.id, g]));
