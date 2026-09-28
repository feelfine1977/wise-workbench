import { scaleLinear } from "d3";
import { useId } from "react";
import { fmtInt } from "@/lib/format";
import { supportStages } from "./chartData";

export function EvidenceSupport({ group, scored, evaluated, label, view, selected, noun = "cases" }: {
  group: unknown; scored: unknown; evaluated: unknown; label: string; view?: string; selected: boolean; noun?: string;
}) {
  const id = useId();
  const stages = supportStages(group, scored, evaluated);
  const width = scaleLinear().domain([0, Math.max(1, stages?.[0]?.count ?? 0)]).range([0, 580]);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby={`${id}-title`} data-testid="evidence-support">
      <h2 id={`${id}-title`} className="text-base font-semibold">Evidence support funnel</h2>
      <p className="mt-1 text-sm text-text-muted">{label} · {view ?? "this view"}</p>
      <p className="mt-1 text-xs text-text-muted">Whole-group coverage{selected ? "; filters and parent selection do not apply to these counts" : ""}. These populations are nested: evaluated {noun} belong to the scored {noun}, which belong to the group.</p>
      {!stages ? <p className="mt-3 text-sm text-text-muted">Exact nested counts are unavailable. A funnel cannot be inferred from rounded shares or from independent gate checks.</p> : <>
        <svg viewBox="0 0 620 136" className="mt-3 w-full" role="img" aria-label={stages.map((s) => `${s.label}: ${fmtInt(s.count)} ${noun}`).join("; ")}>
          {stages.map((stage, i) => <g key={stage.label}>
            {i < stages.length - 1 && <path d={`M${310 - width(stage.count) / 2},${i * 44 + 28} L${310 + width(stage.count) / 2},${i * 44 + 28} L${310 + width(stages[i + 1]!.count) / 2},${(i + 1) * 44 + 4} L${310 - width(stages[i + 1]!.count) / 2},${(i + 1) * 44 + 4} Z`} className="fill-accent" fillOpacity={0.1} />}
            <rect x={310 - width(stage.count) / 2} y={i * 44 + 4} width={width(stage.count)} height={24} rx={3} className="fill-accent" fillOpacity={0.6} />
          </g>)}
        </svg>
        <ol className="mt-2 grid gap-3 sm:grid-cols-3" aria-label="Nested evidence populations">
          {stages.map((stage, i) => <li key={stage.label} className="rounded-lg bg-surface-sunken p-3"><span className="block text-xs text-text-muted">{i + 1}. {stage.label}</span><strong className="tnum text-xl">{fmtInt(stage.count)}</strong><span className="ml-1 text-xs text-text-muted">{noun}</span></li>)}
        </ol>
      </>}
      <p className="mt-3 text-xs text-text-muted">Coverage is not a conversion rate, confidence level, or approval. The examples below are a limited set of whole-group examples, not this expectation’s complete evaluated population. Acceptance still depends on the evidence and checks.</p>
    </section>
  );
}
