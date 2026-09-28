import { fmtNum, fmtShare } from "@/lib/format";

/** Shared reading of analytics.headroom, whose percentage is share_of_PI, not score headroom. */
export function GainExplanation({ view, wholeGroup = false }: { view?: string; wholeGroup?: boolean }) {
  return (
    <div className="reading text-sm text-text-muted" data-testid="gain-explanation">
      <p>
        Gain is the increase in this group’s mean WISE score on a <strong>0–100 scale</strong> if all recorded violations of one constraint were removed.
        These are score points, not priority units, money or days saved. This is a ceiling under the norm, not a forecast of an action’s effect.
      </p>
      {wholeGroup && <p className="mt-2 text-warning">Gains describe the whole group; filters and drilled selections do not change this calculation.</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-accent-text">How gain is calculated</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p>
            Each constraint’s gain is its mean weighted penalty across the group’s scored cases × 100.
            The {view ? `${view} view’s` : "selected view’s"} layer and constraint weights, effective weights, applicability and missing evaluations stay fixed.
            Missing evaluations remain missing.
          </p>
          <p>
            Score-point gains for distinct constraints add up under these assumptions. Across all constraints, they equal 100 minus the current mean score.
            Only the leading constraints are shown here. Changes to weights, applicability or missing data require recalculation.
          </p>
          <p>
            Priority measures the gap to the run’s comparison mean, which stays fixed, along with volume and the small-group adjustment.
            Its reduction is capped at 100% of current priority: reaching the comparison mean removes priority even if the score stays below 100.
            These priority-reduction percentages cannot simply be added. A percentage is undefined when current priority is zero.
          </p>
        </div>
      </details>
    </div>
  );
}

/** Use the same group's served mean; never infer it from the priority-reduction percentage. */
export function GainScenario({ name, meanScore, points, priorityPercent, meter = false }: {
  name: string;
  meanScore?: number | null;
  points?: number | null;
  priorityPercent?: number | null;
  meter?: boolean;
}) {
  const current = typeof meanScore === "number" && Number.isFinite(meanScore) && meanScore >= 0 && meanScore <= 1 ? meanScore * 100 : undefined;
  const after = current !== undefined && typeof points === "number" && Number.isFinite(points) && points >= 0 && current + points <= 100 + 1e-6
    ? Math.min(100, current + points) : undefined;
  const reduction = typeof priorityPercent === "number" && Number.isFinite(priorityPercent) ? Math.max(0, Math.min(100, priorityPercent)) : undefined;
  const reductionLabel = reduction !== undefined ? `${fmtShare(reduction / 100)} of current priority` : undefined;

  return (
    <div className="flex flex-col gap-1 text-sm text-text-muted" data-testid="gain-scenario">
      {after !== undefined && (
        <p className="reading">
          Mean WISE score (0–100): <strong className="tnum">{fmtNum(current, 1)}</strong> now{" "}
          <span aria-hidden="true">→</span><span className="sr-only">to</span>{" "}
          <strong className="tnum">{fmtNum(after, 1)}</strong> in this scenario.
        </p>
      )}
      <p>Priority reduction: {reductionLabel ?? "unavailable"}.</p>
      {meter && reduction !== undefined && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reduction} aria-valuetext={reductionLabel} aria-label={`Priority reduction for ${name}`}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${reduction}%` }} />
        </div>
      )}
    </div>
  );
}
