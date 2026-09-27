import type { UncalibratedExpectation } from "@/lib/api/exploration";
import { Button } from "@/components/ui/button";

function warningLabel(warning: UncalibratedExpectation, numeric: boolean) {
  if (warning.reason === "partly_measured") return { action: "Review measurement coverage", chip: "measurement coverage to review", heading: "Measurement coverage" };
  if (warning.reason === "missing_partner") return { action: "Review missing events", chip: "missing events to review", heading: "Missing events" };
  return numeric
    ? { action: "Calibrate threshold", chip: "a threshold to calibrate", heading: "Threshold calibration" }
    : { action: "Review rule warning", chip: "rule warning to review", heading: "Rule warning" };
}

/** Run warnings include measurement coverage, not just numeric targets. */
export function CalibrationAction({ warning, numeric, name, onClick, className }: { warning: UncalibratedExpectation; numeric: boolean; name: string; onClick: () => void; className?: string }) {
  const label = warningLabel(warning, numeric);
  return (
    <button type="button" className={`rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${className ?? ""}`} aria-label={`${label.action} for ${name}`} title={warning.text} onClick={onClick}>
      <span data-testid="calibration-chip" className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning">
        <span aria-hidden>⚠</span>{label.chip}
      </span>
    </button>
  );
}

export function CalibrationNotice({ warning, numeric, onRule, onApplicability }: { warning?: UncalibratedExpectation; numeric: boolean; onRule: () => void; onApplicability: () => void }) {
  const coverage = warning?.reason === "partly_measured" || warning?.reason === "missing_partner";
  return (
    <div className="mb-3 space-y-2 text-sm" data-testid="calibration-notice">
      {warning && <>
        <h3 className="font-medium">{warningLabel(warning, numeric).heading}</h3>
        <p className="reading">{warning.text ?? "Review this warning against the rule and the available data."}</p>
      </>}
      {coverage && <p className="reading text-text-muted">This warning concerns the events available to measure the rule. Changing a threshold does not supply missing events. Review the rule and its applicability against what this log records.</p>}
      {!numeric && <p className="reading text-text-muted">This constraint has no editable numeric threshold in this calibration view. Review its rule or applicability instead.</p>}
      {(coverage || !numeric) && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRule}>Review the rule</Button>
        <Button size="sm" variant="outline" onClick={onApplicability}>Review applicability</Button>
      </div>}
    </div>
  );
}
