import type { SolutionCard } from "@/lib/api/solutionCards";

const presentations = { coverage: "Activity counts and case coverage", summary: "Descriptive summary and exclusions", day_bars: "Day-of-month bars and exact table", availability: "Availability and interpretation" };

/** The definition explains required evidence; it never manufactures a dataset result. */
export function SolutionCardDefinition({ card }: { card: SolutionCard }) {
  return <section data-testid="solution-card-definition" className="space-y-3">
    <p className="text-sm font-medium">Solution-card template · version {card.version}</p>
    <p className="reading text-sm text-text-muted">{card.intent}</p>
    <p className="reading text-sm text-text-muted">This is an unmeasured template, not a finding about this dataset. Improve fills these questions with evidence for the selected saved run, group and filter.</p>
    <ol className="space-y-3">{card.blocks.map((block, index) => <li key={block.id} className="rounded-xl border border-border bg-surface p-4" data-testid="solution-card-definition-block">
      <div className="mb-2 flex items-center gap-2"><span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-text">{index + 1}</span><h3 className="text-sm font-semibold">{block.title}</h3></div>
      <p className="mt-1 text-sm">{block.question}</p>
      <details className="mt-3"><summary className="cursor-pointer text-sm text-accent-text">Data and calculation details</summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-text-muted">Required data</dt><dd>{block.requires.length ? block.requires.join("; ") : "No required data declared"}</dd>
        <dt className="text-text-muted">Calculation</dt><dd>{block.calculation}</dd>
        <dt className="text-text-muted">Presentation</dt><dd>{presentations[block.presentation] ?? "Unsupported presentation"}</dd>
        <dt className="text-text-muted">Missing data</dt><dd>{block.missingData}</dd>
        <dt className="text-text-muted">Interpretation</dt><dd>{block.interpretation}</dd>
      </dl></details>
    </li>)}</ol>
  </section>;
}
