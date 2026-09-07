/** The pack's own keys in the reader's words (`guidance_and_insight_panel.md` §1: plain language first). */

/** `it_process_owner` → *IT process owner*; the pack's role keys are not words a reader uses. */
export function roleWords(role: string | null | undefined): string | undefined {
  if (!role) return undefined;
  const words = role.replace(/_/g, " ").trim();
  return words.replace(/^(it|ap|sd|mm)\b/i, (m) => m.toUpperCase());
}

/** `standard_work` → *standard work*. */
export const measureWords = (kind: string | null | undefined): string | undefined => (kind ? kind.replace(/_/g, " ") : undefined);

/** The kind of a hub node in the reader's words; `expectation`, `layer`, `failure_mode` are not. */
export const KIND_WORDS: Record<string, string> = {
  stage: "stage of the process",
  layer: "expectation area",
  expectation: "expectation",
  constraint: "expectation",
  failure_mode: "failure mode",
  reason: "usual reason",
  action: "usual action",
  kpi: "indicator",
};

/**
 * The sources of a hub page that mean something to a reader: a report, a standard, a body of practice — never
 * a file of the repository the pack is kept in (P1-13).
 *
 * Every expectation page ended on *Sources: docs/panel/knowledge_hub_panel.md §1 and §5; failure_modes.yaml
 * (p2p); BPI Challenge 2019 reports*. The first two say where the pack is written, which is the pack's own
 * business; the third is a source.
 */
export function readableSources(sources: (string | null | undefined)[] | null | undefined): string[] {
  return (sources ?? [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .filter((s) => !/[\w/-]+\.(md|ya?ml|json|py|tsx?)\b/.test(s));
}
