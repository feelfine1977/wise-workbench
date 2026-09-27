import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import type { ConstraintEvidence } from "./sceneEvidence";

const timeUnits: Record<string, string> = { D: "calendar days", h: "hours", min: "minutes", s: "seconds", ms: "milliseconds", W: "weeks" };
const number = (n: number) => fmtNum(n, Number.isInteger(n) ? 0 : 3);

function rule(constraint: ConstraintEvidence): string {
  const { type, threshold, width, unit, direction } = constraint;
  if (type === "lag" && threshold !== undefined && threshold >= 0 && unit && timeUnits[unit]) {
    return `Target: within ${number(threshold)} ${timeUnits[unit]}${width !== undefined && width >= 0 ? width === 0 ? " · full penalty immediately beyond target" : ` · full penalty at ${number(threshold + width)} ${timeUnits[unit]}` : " · tolerance unavailable"}`;
  }
  if (type === "metric" && threshold !== undefined && unit && (direction === "high" || direction === "low")) {
    return `Target: ${unit} ${direction === "high" ? "≤" : "≥"} ${number(threshold)}${width !== undefined && width >= 0 ? width === 0 ? " · full penalty immediately beyond target" : ` · full penalty ${direction === "high" ? "at or above" : "at or below"} ${number(direction === "high" ? threshold + width : threshold - width)}` : " · tolerance unavailable"}`;
  }
  return threshold !== undefined ? `Configured threshold: ${number(threshold)}${unit ? ` ${unit}` : ""}${width !== undefined ? ` · graded width: ${number(width)}` : ""}` : "Numeric target and tolerance unavailable.";
}

/** Results belong to the supplied case selection, independently of drawable map anchors. */
export function ConstraintResult({ constraint, noun, hasSuppliedOverlay, hasVisibleOverlay }: {
  constraint: ConstraintEvidence;
  noun: string;
  hasSuppliedOverlay: boolean;
  hasVisibleOverlay: boolean;
}) {
  const { evaluated, violationShare, meanViolation, cases } = constraint;
  const consistent = evaluated !== undefined && (cases === undefined || evaluated <= cases);
  const result = !consistent
    ? "WISE result unavailable: evaluated denominator missing or inconsistent."
    : evaluated === 0
      ? `No evaluated ${noun} in this selection; compliance is unknown.`
      : violationShare === undefined
        ? `Missed share unavailable · ${fmtInt(evaluated)} evaluated ${noun}`
        : `${fmtPct(violationShare, 1)} miss this constraint · ${fmtInt(evaluated)} evaluated ${noun}`;
  const coverage = consistent && cases !== undefined
    ? `Evaluated ${fmtInt(evaluated)} of ${fmtInt(cases)} ${noun} in the current selection${cases > 0 ? ` (${fmtPct(evaluated / cases, 1)} coverage)` : ""}.`
    : "Evaluation coverage unavailable.";
  const briefCoverage = consistent && cases !== undefined && cases > 0 ? `${fmtPct(evaluated / cases, 1)} evaluation coverage` : "Coverage unavailable";
  const placement = hasVisibleOverlay
    ? "WISE relationship, not a path share"
    : hasSuppliedOverlay
      ? "Map overlays hidden; case result shown"
      : "Case result only; no map anchor";

  return <section aria-label="Selected constraint result" tabIndex={0} className="h-28 overflow-y-auto rounded border border-border bg-surface px-3 py-2 text-xs" data-testid="constraint-result">
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 truncate font-medium text-text" title={constraint.name}>{constraint.name}</p>
      <Popover>
        <PopoverTrigger asChild><Button variant="outline" size="sm" className="shrink-0">Meaning and coverage</Button></PopoverTrigger>
        <PopoverContent align="start" className="max-h-[60vh] w-96 max-w-[90vw] space-y-2 overflow-y-auto text-sm" aria-label="Meaning and coverage">
          <p className="font-medium">{constraint.name}</p>
          <p data-testid="constraint-meaning">{constraint.description}</p>
          <p className="break-words text-xs text-text-muted">{constraint.id}{constraint.layer ? ` · ${constraint.layer}` : ""}</p>
          <p>{result}</p>
          <p data-testid="constraint-full-coverage">{coverage}</p>
          <p>Configured norm target. {rule(constraint)}.</p>
          {constraint.width !== undefined && constraint.width >= 0 && <p>Graded tolerance: {number(constraint.width)}{constraint.type === "lag" && constraint.unit && timeUnits[constraint.unit] ? ` ${timeUnits[constraint.unit]}` : ""} beyond the target, over which the penalty reaches its maximum.</p>}
          {constraint.type === "lag" && <p>Missing-endpoint and repeated-activation policies are not supplied in this flow response. A missed constraint is not necessarily a measured duration beyond the target.</p>}
          <p>Missed share counts evaluated {noun} with a positive WISE violation; it is not the raw event or threshold share.</p>
          <p data-testid="constraint-mean">{consistent && evaluated > 0 && meanViolation !== undefined ? `Mean violation: ${fmtNum(meanViolation, 3)} / 1. ` : "Mean violation unavailable. "}This averages the constraint's WISE violation values over evaluated {noun}.</p>
          <p>These are unweighted constraint results. Overall dashboard scores also depend on the selected perspective and aggregation.</p>
          <p>WISE arcs connect constraint endpoints; they do not represent an observed directly-follows route or a path share.{!hasSuppliedOverlay ? " No map anchor was supplied for this constraint." : !hasVisibleOverlay ? " Its overlays are hidden by detail or legend settings." : ""}</p>
          <p>Start and end mark the first and last recorded event; they do not establish business completion.</p>
        </PopoverContent>
      </Popover>
    </div>
    <p className="text-text" data-testid="constraint-denominator">{result}</p>
    <p data-testid="constraint-rule">{rule(constraint)}</p>
    <p><span data-testid="constraint-placement">{placement}</span> · <span data-testid="constraint-coverage">{briefCoverage}</span></p>
  </section>;
}
